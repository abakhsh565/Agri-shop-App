# RBAC + Branch Scope + Accountability — Gate Readiness Report

**Type:** report only. No code, schema, test, or data changes were made to produce it.
**Date:** 2026-10-06 · **Branch:** `staging-snapshot` @ `3dc4843c` (worktree changes uncommitted)
**Sources:** `RBAC_BRANCH_SCOPE_AUDIT.md` (discovery), `RBAC_BRANCH_IMPLEMENTATION_STATUS.md`
(checkpoint), `docs/BRANCH_FLOW_CORRECTIONS_VERIFICATION.md`, and this session's live work
(migrations 0188–0195 applied to QA, real-browser login, home screen + branch switcher capture).
**Status vocabulary:** DONE · PARTIAL · NOT DONE · BLOCKED · UNKNOWN (UNKNOWN is never reported as PASS).

---

## 0. What changed since the three source documents

The source documents state "No migrations were applied to QA." **That is now stale.** With explicit
user authorization this session:

- Baseline re-captured read-only: `backups/backup-staging-bpybjrjenwccowvtrevu-2026-10-06T17-00-31.sql`
  (sha256 `e60ab15e…b218c`, 3316 statements / 2267 data, ledger 179/0187).
- **0188–0195 applied to QA** via `scripts/migrate.mjs apply --env staging --apply` (8 files, 95 statements).
- `migrate.mjs verify --env staging` → **VERIFY: PASS**, 187 files ↔ 187 rows, hashes match.
- Baseline record updated + validated; guards re-run **40/40 PASS** (`schemaBaseline`,
  `migrationReplayability`, `migrationLedger`).
- **Live browser proof:** real OTP login → `/admin/dashboard` renders real data with a real branch
  ("Default Shop - Main"), and the switcher lists real branches **Main, Warehouse** — i.e. the old
  `get_my_branches()` tenant-row contract is gone on live QA. Evidence PNGs:
  `.freebuff/home-screen-working.png`, `.freebuff/branch-switcher.png` (canvas-decoded: 2655 / 2152
  distinct colors — not blank frames).

So the *deployment* half of items 1A/1B is now live. The *verification* half is largely not.

---

## 1. Confirmed branch-model issues — status

| Item | Status | Evidence held | Gap |
|---|---|---|---|
| **1A `get_my_branches()`** | **PARTIAL** | Migration 0188 (real `branch_id`/`tenant_id` rows, per-branch counts authorized, no tenant-wide counts, definer OLD-row guard, fail-closed missing scope) — applied + ledger-verified on QA; regression suite `tests/unit/branchIdentityBoundary.test.ts` (25 SQL tests, includes the original 5000-warehouse-aggregate leak not appearing in Main's result); live browser shows real branch records | The audit's **T1 probe re-run against live QA post-apply** (read `get_my_branches().sales_total` as a Main-scoped employee and diff vs RLS-visible rows) has **not been executed**. Local PGlite ≠ live DB. |
| **1B tenant vs branch identity** | **PARTIAL** | `shopStore` now holds `activeShopId` (tenant) separate from `activeBranchId`; `switchBranch` uses the guarded branch RPC; Add/Move/profile/branch controls use branch IDs; guards `branchIdentityBoundary` 25 + `shopSwitchReset` 7 + `cacheOwnership` 5 + `branchLateResponse` 3 + `offlineBranchOwnership` 3 — all green locally; live header shows a **branch** name | No systematic live audit that *every* remaining `activeShopId` consumer means tenant. Frontend had zero `branch_id` in queries at audit time (G14) — write-path branch stamping is server-side (0188/trigger); live write stamping not yet observed on QA. |
| **1C employee enrollment** | **PARTIAL** | Migration 0190 (create_employee_core requires role + explicit valid scope; omitted scope defaults to **selected** branch; explicit NULL refused); AddEmployee prefill compares against `activeBranchId` (audit G7/R7 cause removed); local SQL test "normal Warehouse enrollment and onboarding" passes | **No DB + browser evidence on live QA**: the prompt's exact scenario (create employee from Branch B → verify scope = B through onboarding) has not been run against the real backend. |

## 2. Employee / branch model (Add vs Move) — status

**PARTIAL.** Migration 0189 implements Add/Move on the locked membership row: idempotent repeats, no
person/phone/role/history change, historical records untouched. `tests/e2e/branchFlowCorrections.spec.ts`
(2/2, EN + UR) proves the UI contract — two explicit actions, confirm gate, exact RPC payloads
`{p_employee_id, p_branch_id, p_action: 'add'|'move'}` — but with **fully intercepted/mocked transport**.
The SQL suite proves idempotency + history invariance on fixtures. **Missing:** the same two flows
driven end-to-end against live QA with a real employee row, plus reload checks. The audit's own note
("not live backend proof") still applies.

## 3. `NULL = all branches` removal — status

**PARTIAL.** 0188 makes missing employee/admin scope **fail closed**, and the local SQL suite proves
"missing scope read/write denial with a valid permission" and "wrong-branch/tenant write refusal".
The employee access editor no longer writes a NULL grant. What is **not** proven: the audit measured
**2 real QA employees with `branch_scope = NULL`**; whether they now fail closed on live reads/writes,
and whether **direct PostgREST/API calls** (bypassing the UI) are refused, has not been tested live.
The prompt explicitly requires direct API/RPC evidence — that test does not exist yet.

## 4. Cross-branch behavior — status

**UNKNOWN (live) / DONE (local).** This is the audit's R3, deliberately left UNKNOWN because at
discovery time every stamped row in the employees' tenant sat in one branch, so no contrast existed.
The PGlite suite now covers Main/Warehouse read isolation and owner multi-branch switching with
synthetic fixtures. **Live QA still has no controlled Main-vs-Warehouse dataset**, so the four
personas (Owner, Main-scoped, Warehouse-scoped, multi-branch) have not been tested against the real
backend. Requires: authorized seeding inside one tenant → API + browser checks → full cleanup
(item 10). Blocked on live-write/cleanup authorization and on QA being dirty.

## 5. Audit / accountability — status

**PARTIAL.** 0189 extends the **existing** `audit_events` (no duplicate system) with
tenant / branch / role-at-time / scope attribution, session-actor precedence (caller-supplied identity
never wins), a normal `sale_created` row, and `activity.view` controlling audit reads. Local tests:
sale audit attribution, immutable role snapshot, actor unchanged across branch selection.
Audit S6 already verified session-wins for void. **Gaps:** no live audit rows inspected on QA for the
prompt's list (sale creation ✅-written-locally, sale void, returns/refunds, payments, stock
adjustments, employee access changes, role changes, branch changes); "Owner acts in Branch B →
actor = Owner, branch = B, responsible person unchanged" has local tests but no live row; legacy rows
correctly remain unbackfilled (per C4); the Activity screen still derives a sales/payment feed rather
than `audit_events` (status doc open item 6 — wiring preserved, not redesigned, not live-verified).

## 6. Roles & permissions — status

**PARTIAL.** The real matrix was measured live in discovery (32 codes, 14 modules; full role table in
the audit §S11) and the architecture is explicitly locked — no redesign needed or proposed.
`0195 get_effective_permissions` inspected **correct on disk** (owner → all codes; non-owner →
role ∪ granted overrides ∖ revoked; non-admin cannot inspect others). `activity.view` was inert (R8);
0189 now makes it the actual gate on audit reads — but the audit's T10 (Store Manager opens Activity
and sees rows) has not been re-run live. **No permission has been proven to produce a real
authorization result on the live backend for every role** — the prompt's requirement (test each role
against backend behavior, including destructive, sales, inventory, purchases, customer, role
management, `activity.view`) is exactly the "full role matrix on actual backend paths including
direct API bypasses" item still listed as remaining in the checkpoint.

## 7. Branch switching — status

**PARTIAL.** Frontend: `switchBranch` → guarded RPC, resets stores/cart/back stack, clears cache
before adopting a same-tenant branch; guards `shopSwitchReset` 7/7, `cacheOwnership` 5/5,
`branchLateResponse` 3/3. Live this session: switcher opens and lists real branches. **Not done live:**
the actual prompt sequence `Owner → Branch A → action → Branch A data` then `Branch B → same action →
Branch B data`, verifying the actor stays identical, queries re-scope, no stale Zustand/cache data,
and reload preserves selection. Note also the audit's R6: server-side write stamping historically used
`default_branch_id` — 0188/0189 aim to fix this, but no live sale has been stamped-and-inspected
post-apply.

## 8. Destructive & consequential actions — status

**PARTIAL / NOT DONE.** The audit's flow-trace table is the action inventory (sale, void, stock
adjust, purchase, supplier/customer payment, employee enrol, onboarding, branch switch, branch
list read, reports, activity read, role CRUD, product delete / customer archive, branch
create/rename/delete). Verified already and not to be reopened: void preserves history + correct
actor (S6), stock history before/after (S7), client audit writes closed (S8), onboarding doesn't move
scope (S9). **Safety refusal in place:** legacy `delete_branch` (which deletes a *tenant*) is refused
for real branch records — the status doc is explicit this is *not* completed deletion functionality.
No per-action live `state → confirmation → backend → audit → reload → repeat` matrix has been run on QA.

## 9. Verification process — status

| Step | Status |
|---|---|
| Targeted Vitest | **DONE** — 107/107 focused guards this era; 40/40 baseline/ledger guards after baseline edit |
| Targeted Playwright | **PARTIAL** — 2/2 branch-correction lanes, mocked transport; real-browser login/home/switcher verified by hand this session; the 31-lane suite not run |
| TypeScript | **DONE** — `npx tsc --noEmit` exit 0 |
| Production build | **DONE** — `npm run build` exit 0 (QA/development target stamp, not a deployment) |
| Full Tier-2 `npm run verify` | **NOT RUN** — its `qaRowCount` step requires 0 business rows; QA is dirty (93 rows pre-session + login/PIN/session rows from this session's real logins) |
| Direct API/RPC enforcement tests | **NOT DONE** |
| Reload / repeat / invalid-action testing live | **NOT DONE** (mocked/local only) |

## 10. QA cleanup — status

**NOT DONE — BLOCKED.** QA carries ≥93 business rows (audit-era census across 14 tables) plus rows
produced this session by real logins (PIN set, session provisioning) and whatever the migration
session touched. `npm run qa:clean` has not been run and was not authorized in this session. Orphan
checks, removal of temporary employees/roles/branches/transactions/images, and "restore the clean
baseline" cannot be reported until an authorized cleanup pass runs **after** item 4's fixtures.

## 11. Final gate checklist

| Gate item | Verdict | Basis |
|---|---|---|
| Real branch records | **LIKELY PASS** (live browser evidence; ledger-verified function) | Needs the T1 live DB probe to be formal |
| Tenant/branch identity separation | PARTIAL | local guards + live header; no full live audit |
| Branch-scoped reads | NOT PROVEN LIVE | local PGlite only; T1/T2 not re-run on QA |
| Branch-scoped writes | NOT PROVEN LIVE | trigger/0189 local only |
| Owner global access | NOT PROVEN LIVE | local tests only |
| Employee branch enrollment | NOT PROVEN LIVE | 0190 local only |
| Add vs Move | PARTIAL | mocked browser + local SQL; no live rows |
| Multi-branch employee | NOT PROVEN LIVE | local fixtures only |
| Branch switching | PARTIAL | local + store guards; no live A→B action test |
| Role & permission enforcement | PARTIAL | matrix measured; per-role backend enforcement unproven live |
| Audit actor | PARTIAL | local tests; no live rows inspected |
| Audit branch | PARTIAL | columns/writers added; no live rows inspected |
| Audit role-at-time | PARTIAL | same |
| Consequential-action history | NOT PROVEN LIVE | inventory exists (audit flow table); matrix not run |
| Cross-branch isolation | **UNKNOWN** | no controlled live dataset (R3) — explicitly not PASS |
| Database enforcement | PARTIAL | local schema tests; no live PostgREST bypass tests |
| Browser behavior | PARTIAL | login/home/switcher live; flows not |
| Regression results | PARTIAL | targeted green; Tier-2 verify + lanes not run |
| TypeScript | **PASS** | exit 0 |
| Production build | **PASS** | exit 0 |
| Clean QA baseline | **FAIL** | dirty; cleanup not authorized/run |

**VERDICT: RBAC + BRANCH SCOPE + ACCOUNTABILITY: NOT PASSED.**

---

## What blocks PASS — ordered

1. **Authorized live-write + cleanup window on QA** (unblocks items 4, 10, and every "NOT PROVEN LIVE").
2. **Live enforcement battery**: T1/T3/T4/T6/T10 from the audit against real QA with real JWTs,
   including direct PostgREST/API calls (prompt §3, §9.6).
3. **Controlled cross-branch dataset** in one tenant + four-persona test + cleanup (§4).
4. **Live audit-row verification** for the full consequential-action list, incl. Owner-in-Branch-B
   attribution (§5, §8).
5. **Full role matrix on backend paths** (§6).
6. **Live Add/Move + enrollment + switch flows** with DB and browser evidence (§1C, §2, §7).
7. **Tier-2 `npm run verify` + affected lanes** once QA is clean (§9), then cleanup + independent row
   count (§10).

**Constraints observed:** production untouched; no commit/push/deploy/reset/stash; no redesign of the
locked model (WHO/WHAT/WHERE, role-as-template, two account roles, existing audit system); discovered
UI and locked business rules not reopened.
