# Engineering OS — Project State

**As of:** 2026-09-20 · **Commit:** `972b3b9` (foundation) · **Environment:** QA only (`bpybjrjenwccowvtrevu`)

Production has not been touched. Every claim below names the evidence that supports it.

---

## 1. Built + Verified

| Area | Status | Evidence |
|---|---|---|
| Global identity + session | Verified | Deterministic Auth session per phone (`src/lib/auth.ts`); a failed session is surfaced to the user, never swallowed. Browser: real JWT, PostgREST reads 200. |
| Tenant / Organization | Verified | `shops` = tenant. Tenant is resolved from membership, never from a parameter (`current_shop_id()`). Tenant SELECT policy added in 0115 (was invisible to its own tenant). |
| Memberships | Verified | `memberships` (user, tenant, role, role_id, status, branch_scope). Admin can read own-tenant memberships (0117). Invariant D: 0 users with a shop but no membership; enforced structurally by 0113. |
| Roles | Verified | `roles` + `role_permissions`. 4 system roles, 62 role-permission rows. Data-driven — no role permissions in frontend code. |
| Business areas | Verified | `business_areas` (14). Roles group permissions by area; UI shows business language ("Customers · View, Create, Edit"), never codes. |
| Permissions | Verified | `permissions` (32, with EN/UR labels). `get_effective_permissions()` / `has_effective_permission()` are the single source of truth. |
| Role defaults | Verified | Changing a role updates every member on it, live (no permission snapshot copied onto the employee). Tests: rbacEnforcement propagation (added + removed). |
| Employee overrides | Verified | `user_permissions.is_override`. Explicit allow and explicit deny both proven. Browser: Save → DB row → UI 6→7 permissions. |
| Reset to role defaults | Verified | Browser: "Reset to Role Defaults" → DB override rows 0 → UI back to 6. |
| Effective access | Verified | Role defaults + overrides + branch scope + active status, resolved server-side; `get_my_permissions()` returns the authoritative set. |
| Branch scope | Verified | `branch_id` on 7 operational tables + 7 enforcement triggers + RESTRICTIVE read policies. 0 records without a branch. 9/9 branch tests. |
| Backend authorization | Verified | 36 of 43 write RPCs carry an authorization guard; the remainder are internal/trigger helpers or admin-gated and are explicitly allowlisted. |
| RLS correctness | Verified | 0 app-facing tables with RLS enabled and zero policies (the failure mode that silently broke `shops`, settings and reminders). |
| Anonymous-write protection | Verified | anon-executable writes: 23 → 1 (`insert_shop_request`, the registration form). |
| Tenant isolation | Verified | Real JWT tests: cannot read or mutate another tenant's rows, roles, business areas, employees, or run its RPCs. Cross-tenant writes refused. |
| Audit | Verified | `audit_events` records role/access changes with the acting user; employee override save + reset both attributed. |
| Live session behaviour | Verified | Role change / membership deactivation revoke access at the next authorization boundary; no stale client cache can grant it. |
| Role lifecycle safety | Verified | `ROLE_IN_USE` (employees still on it), `SYSTEM_ROLE_READ_ONLY`. |
| QA verification | Verified | 337/337 tests across 23 files — **5 consecutive full runs, 0 failures**; TypeScript clean; production build passes. |
| Permanent regression protection | Verified | `tests/integration/rbacInvariants.test.ts` fails the build if any original defect class returns. |

### Evidence commands

```bash
node scripts/rbac-evidence.mjs        # live snapshot of the authorization foundation
npx vitest run                        # full suite (337 tests, stable across repeated runs)
npx tsc --noEmit && npm run build     # typecheck + production build
node scripts/reset-qa-baseline.mjs    # restore the clean QA baseline
node scripts/record-engineering-memory.mjs  # re-record verified learnings
```

Engineering Memory now holds 8 active entries; the earlier entry that blamed
PgBouncer pooler visibility for the intermittently failing credit-request test is
**superseded** — the verified cause was shared-fixture teardown.

### Test-suite stability (fixed, not tolerated)

Two shared-fixture races were the real cause of the intermittent credit-request
failure, and both are fixed:

1. `setupCustomers()` deleted the fixture customers before re-inserting them,
   opening a window where a parallel suite saw `CUSTOMER_NOT_FOUND`. It now only
   upserts, which is atomic for concurrent readers.
2. `cleanupTestData()` deletes credit requests for the shared customers A/B/C, and
   `creditRequest.test.ts` created its request against `customerC` — so any suite
   finishing mid-run wiped it. The suite now owns dedicated customers, so no
   other suite can touch its data.

A third cause was in the new guard itself: invariants C and D asserted global
row-level conditions while other suites were mid-write. They now assert the
structural guarantee (column + trigger present) plus a data check that excludes
rows the current parallel run is still inserting. A real defect still fails.

Known remaining test-infrastructure smell (not product): `qa-client.ts` shares one
`pg.Client` per process and some suites issue concurrent queries on it, which pg
warns about. It has not produced a failure; it is recorded here rather than
silently ignored.

---

## 2. Explicitly Not Built

These are **not bugs**. They are open decisions that need product/business intent.
They must not be implemented by assumption.

### 2.1 `business_settings.crops` default/data behaviour
The app asks for a single `crops` setting row that does not exist, so PostgREST
answers 406 and the screen falls back to empty. Whether the product should seed a
default crop list, treat crops as user-managed, or remove the setting is a
**business decision**. Authorization is not involved: the table is readable and
writable for the tenant.

### 2.2 Branch selector UI
`branch_id` ownership and enforcement exist and are verified. There is no UI for a
user who works across branches to *choose* the active branch, so an all-branch
member's records are stamped with the tenant's default branch. Adding a branch
switcher is a **product feature**, not a fix.

### 2.3 The 7 write RPCs without a permission check
`update_incident_status`, `update_memberships_updated_at`, `update_updated_at_column`,
`record_cash_reconciliation_v1`, `approve_shop_request`, `record_attempt` (and the
recorded internals around them) are allowlisted in the invariant test with a written
reason: Engineering-OS internals, trigger helpers, admin-gated reconciliation, and
platform onboarding approval. Whether any of them should become fine-grained
permission-gated is a **product decision**. They are allowlisted explicitly so they
cannot hide silently.

### Also not yet built (noted, not requested)
- Branch scoping of **reads** outside transactional tables (customers, suppliers,
  products are tenant-wide today).
- Per-action UI hiding driven by the server-resolved permission set (route-level
  `PermissionGuard` exists; individual buttons are not yet all driven by permissions).

---

## 3. Next Development Stage

The authorization foundation is closed and verified, so the next stage is the one
the owner controls directly: **the dashboard / data-entry form layer**.

**Do not start implementing forms yet.** The dashboard/form artifact is expected
from the product owner. When it arrives, review it against this real system
*before* writing code:

1. What does it represent in the actual business flow?
2. Which stage does it belong to — existing functionality, next implementation,
   QA/review, later, or a product decision?
3. Dependencies: does the DB table, RPC, store, auth, permission and branch path
   already exist?
4. **The showcase test:** is everything it needs already real? If the answer is no,
   say so before building, otherwise the form becomes a screen that looks complete
   and does nothing.
5. Preservation: existing design system, components and mobile-first layout; no
   redesign for appearance alone.
6. The finished feature must connect end to end —
   `UI → store → authorization → RPC → DB → related screens → reload → audit`.
7. Then define the following form/review stage, so the work stays a flow rather
   than a series of isolated screens.

### Per-feature checklist (applies to every future feature)

tenant · role · permission · branch/scope · DB persistence · backend authorization ·
related screens · loading/error/empty/success states · audit/history · regression ·
Urdu/RTL + English/LTR (`ps-*`/`pe-*`, `text-start`/`text-end`, `useT()`, EN **and** UR
keys) · QA evidence.

**NO ACTUAL EVIDENCE = NO PASS = NO ADVANCEMENT.**
