# Phase 2 — Integration-failure triage, the 0165 regression, and QA restoration

**Date:** 1 October 2026 · **Scope:** the 14 Vitest integration failures, QA row restoration,
post-cleanup regression. **Production was not contacted in this work (zero connections).**
Phase 2A tooling and reports are untouched.

---

## 1. Method

1. Every failing suite was run **individually** with its own log (`backups/FAIL-<suite>.log`),
   not inferred from the full run: all 14 reproduce in isolation with identical counts, so none is
   cross-test interference.
2. Root causes were read from *primary sources* — the deployed functions on QA
   (`pg_get_functiondef`, read-only), the local migrations that define them, and `git log` for the
   commits that changed each contract — not from the earlier Phase 1 summary.
3. QA was restored by removing **only rows created inside the failing run's window**, FK-aware and
   dry-run first. Nothing else was deleted; `qa:clean` was not run.
4. The one failure that proved to be a real defect was fixed at its source (a migration, QA-first)
   and re-verified by the same suites.

---

## 2. The 14 failures — classification

| File | Tests | Symptom | Root cause (proven) | Introduced by | Class |
|---|---|---|---|---|---|
| `splitPayments` | 8 | `error: NOT_AUTHENTICATED`; then `expected +0 to be 1/2/3` | The suite calls `record_customer_payment` **over direct SQL** with a payload `actorId`. The deployed RPC authenticates through `app_current_user_id()` → `request.jwt.claims` → NULL on a raw connection. 0112 (Sep 20) removed caller-supplied `actorId` trust on purpose — its own header says so | `0112` (Sep 20, `dbdf10da`) | **Stale test vs intentional security hardening** — pre-existing, documented |
| `employeeAccessOverrides` | 3 | denies not applied; a **pending** invitee sees access | 0165 replaced `get_effective_permissions` with a body whose override query has no `is_granted` filter, so denial rows are treated as *additions* (grants); the no-active-membership gate is gone; the `owner`/`admin` branch lost `admin` | **`0165` (Sep 29, `087b493f`)** | **Real regression from current work** — fixed by 0175 |
| `rbacFoundation` | 1 | `expected [...] to not include 'sales.create'` | same resolver | `0165` | same — fixed |
| `rbacEnforcement` | 1 | `expected [...] to not include 'sales.view'` | same resolver; `has_effective_permission` is `get_effective_permissions(...) ? code`, so this is the **enforcement** path too — explicit denials were silently ineffective (and a denial on a permission the role never had became a grant) | `0165` | same — fixed |
| `tenantResolverReplay` | 1 | `expected [...] to deeply equal ['resolve_active_shop']` | The test pins the exact list of functions matching `ORDER BY m.created_at ASC`; QA legitimately holds more (before 0175: `authorize_business_action`, `get_effective_permissions`, `resolve_active_shop`, `resolve_invite`; after 0175: the first, third and fourth) | accumulation (`0147`/`0149`/`0163`/`0165`) | **Fragile snapshot test** — the database is right, the expectation is stale; documented |
| `priceTraceability` | whole file (7 skipped) | `create_product: INVALID_UNIT: a product is measured in kg or liter, not "piece"` | The test's fixture sends `piece`. 0158/0161 defined the current product contract (kg/liter; `piece` is legacy for existing rows — `src/lib/packSize.ts` says so). The test predates the change | `0158` (Sep 28) / `0161` (Sep 29) | **Stale test vs intentional contract change** — documented |

**What was NOT the cause, checked and ruled out:** the six files import only `vitest` and
`../setup/qa-client`; none imports anything Phase 2A/2B changed; the uncommitted migrations
0170–0174 mention these names only inside their own new functions; and no test in the lane deletes
arbitrary rows — every `DELETE FROM sales` is keyed to suite-owned fixture ids or name prefixes.

---

## 3. The one real defect, and its fix — migration 0175

**Evidence of the regression:** 0149 (the active-shop source of truth) implements the override
contract as `role defaults ∪ (is_override AND is_granted = true) EXCEPT (is_override AND is_granted = false)`,
with a `v_tenant IS NULL → []` gate for invitations and an `owner`/`admin` full-permission branch.
Migration 0165's replacement body contains none of those three; its comments ("For now, simple:
role perms + explicit adds") read as a copy of an older draft. `docs`-level intent agrees with 0149:
`0108` defines the column with `COMMENT … 'true adds access, false denies role-derived access.'`

**Fix:** `supabase/migrations/0175_a_denial_still_denies.sql` restores 0149's implementation
verbatim (no new design). Applied to **QA only**, in one transaction.

Read-back from QA after applying:

```
is_granted = true: true | is_granted = false: true | v_tenant IS NULL gate: true
admin branch: true | caller check ('cannot inspect another user access'): true
```

**Result (same suites, re-run):** `employeeAccessOverrides` exit 0, `rbacFoundation` exit 0,
`rbacEnforcement` exit 0. The full integration lane moved from **6 failed files / 14 failed
tests** to **3 failed files / 9 failed tests** (the three stale-test files above; `Test Files 3
failed | 30 passed (33)`).

Production does not carry the membership/role model yet, so 0175 is a QA-first migration; its
production application belongs to the schema-strategy decision, not to this task.

---

## 4. QA restoration

**Baseline measured before the runs:** `qa:count` = **398** (audit_events 331, credit_limit_requests
12, customers 11, product_variants 10, products 10, sales 8, sale_items 6, voids 4, companies 3,
shop_requests 3). After the full suite: **436** (+38). Uncounted tables also grew:
`impact_analyses` +20, `sale_submissions` +1, `product_barcodes` +1.

**Window:** the full-suite run started at `2026-10-01 16:28:44 +05:00` (its own log), so the window
is `created_at >= 2026-10-01T16:28:44+05:00`. Everything after that — including the individual
reproduction runs — is test activity.

**Procedure:** `backups/qa-restore-window.mjs` — dry run first, then apply:

* Parent sets identified by `created_at` inside the window (10 tables).
* Children removed first via the **real FK graph** (no composite FKs exist; verified).
* Dry run printed every planned deletion and reported **no pre-existing row** in scope, because a
  row written before the window cannot reference a parent created inside it.
* First pass deleted 66 rows (7 child + 59 parent); later passes deleted only what subsequent
  lane runs wrote (0, then 59, then 0). **No pre-existing row was ever touched.**

**Result:** `qa:count` = **392** and stable across repeated runs.

**The 6-row difference from 398 is not unexplained.** 4 `sales` and 2 `sale_items` that existed
before the runs were removed **by the suites' own scoped cleanups**, not by this restoration:
`priceTraceability.clean()` deletes by its own customer prefix (`QA-PRICEGUARD`), and
`destructiveSafety` deletes its own `D1000000…` customers' rows — both run in `beforeAll`. The four
surviving sales belong to a different suite's fixtures (`QA Dup-safe Customer`, created Sep 30).
Those deleted rows were earlier runs' suite-owned fixtures, regenerated per run — they cannot be
"restored" because they are not state, they are leftovers.

**Correct baselines, stated plainly:**
* *Pre-run snapshot:* 398.
* *Repo's canonical clean state:* **0 business rows + 4 fixture accounts** (`scripts/reset-qa-baseline.mjs`
  / `npm run qa:clean`). That is a destructive, sanctioned clean — **not run here**, because the
  instruction was to remove only what the test run created. If the canonical 0 is wanted next, that
  command is the tool, and the surviving 392 rows are all earlier test debris (audit history,
  fixture customers/products, the Dup-safe sales).

---

## 5. Regression after cleanup

| Check | Result |
|---|---|
| Unit lane (`npm run test:unit`) | **42 files / 421 tests passed** |
| Fixed suites | employeeAccessOverrides 4/4, rbacFoundation 4/4, rbacEnforcement 17/17 |
| Integration lane | 30/33 files pass; the 3 red files are the classified stale tests (9 failures) — all three fixed later the same day: 33/33, 393 tests, 0 failures |
| `qa:count` | 392, stable; every lane run's writes removed by the same window cleanup |
| Production | zero connections; nothing changed there |
| Phase 2A artefacts/tooling | untouched |

---

## 6. Open items — **all three CLOSED 2026-10-01**

1. **`splitPayments`** — ✅ its `recordPayment` now calls the RPC through the real authenticated path
   (`execRpcAsUser`, like `paymentIdempotency`), with the QA fixture admin whose auth credential
   `getAuthClient()` self-heals. 12/12 pass (log `backups/FIX2-splitPayments.log`).
2. **`priceTraceability`** — ✅ the fixture sends `baseUnit: 'kg'`, the current product contract
   (0158/0161); `piece` is legacy-only. 7/7 pass (log `backups/FIX2-priceTraceability.log`).
3. **`tenantResolverReplay`** — ✅ asserts the *property* instead of pinning a list: the first-membership
   shape must still exist and belong to `resolve_active_shop`, and any caller-scoped function that
   contains it must consult the chain **before** falling back. 6/6 pass (log
   `backups/FIX2-tenantResolverReplay.log`).

**Non-vacuity of item 3, proved by injection:** a temporary `zz_proof_bad_resolver` with the
caller-scoped derivation and no chain call was created on QA — the test failed with the intended
message (`backups/FIX2-tenantResolverReplay-injected.log`) — then dropped and re-run green. The first
attempt at that injection stayed *green*, which exposed a real weakness: the discovery query used a
case-sensitive `LIKE`, so a lower-case reintroduction was invisible. It is now `ILIKE`.

**Lane result after the fixes:** `npx vitest run tests/integration/` → **33 files / 393 tests passed,
0 failures** (`backups/integration-after-fixes.log`), up from `3 failed files / 9 failed tests`.
Business rules were not changed to satisfy any of the three; only the call path, the fixture unit and
the assertion shape.

## 7. Evidence index

| Artefact | Path |
|---|---|
| Per-suite reproductions (before) | `backups/FAIL-<suite>.log` |
| Per-suite re-runs (after cleanup) | `backups/FAIL2-<suite>.log` |
| Fixed-suite runs (after 0175) | `backups/FIXED-<suite>.log` |
| Full integration lane after fix | `backups/integration-after-fix.log` |
| Unit lane after fix | `backups/unit-after-fix.log` |
| QA counts (before/after/restored) | `backups/qa-after-runs.log`, `backups/qa-after-restore.log`, `backups/qa-final-restore*.log` |
| Restoration script (dry-run default) | `backups/qa-restore-window.mjs` |
| The fix | `supabase/migrations/0175_a_denial_still_denies.sql` |
