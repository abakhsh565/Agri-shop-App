# Engineering OS — Project State

**As of:** 2026-09-21 · **Commit:** `dc334cd` (last verified) + uncommitted duplicate-action work (0138–0139) · **Environment:** QA only (`bpybjrjenwccowvtrevu`)

Production has not been touched. Every claim below names the evidence that supports it.

## 0. Live checkpoint (machine-written — do not hand-edit)

<!-- ENGINEERING-OS-CHECKPOINT:BEGIN -->
```json
{
  "updatedAt": "2026-09-27T19:26:54.079Z",
  "branch": "main",
  "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398",
  "nextCommand": null,
  "note": null,
  "server": {
    "port": 5173,
    "up": true,
    "mode": "qa"
  },
  "verified": {
    "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398",
    "at": "2026-09-23T20:57:24.182Z",
    "treeHash": "180304489445a40e32c5"
  },
  "lanes": {
    "accessUx": {
      "status": "pass",
      "hash": "a8a59367f3f15d956ec9",
      "at": "2026-09-27T19:26:53.989Z",
      "head": "91ae70e6c6fa5021b7643a6d71daf98fff49114d"
    },
    "actionCenter": {
      "status": "pass",
      "hash": "69351adb68674b31fc32",
      "at": "2026-09-23T23:58:01.162Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "crossScreenSync": {
      "status": "pass",
      "hash": "6cff70491e57ea574c68",
      "at": "2026-09-24T00:10:58.708Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "dashboardScope": {
      "status": "pass",
      "hash": "8953eb20153fcf3431b5",
      "at": "2026-09-24T00:12:21.829Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "imageSync": {
      "status": "pass",
      "hash": "3a0543b2d56bbe751574",
      "at": "2026-09-24T09:46:33.555Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "rtlLtr": {
      "status": "pass",
      "hash": "7e737cfed8d6085ace17",
      "at": "2026-09-24T09:56:13.841Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "splitPayment": {
      "status": "pass",
      "hash": "367b2ec9e608320a073f",
      "at": "2026-09-24T09:59:34.626Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "accessibility": {
      "status": "pass",
      "hash": "bef5487e2f51a76f6004",
      "at": "2026-09-27T19:24:35.256Z",
      "head": "91ae70e6c6fa5021b7643a6d71daf98fff49114d"
    },
    "adminMicrocopy": {
      "status": "pass",
      "hash": "cddbb0d1c70fdc974ec1",
      "at": "2026-09-24T00:06:58.054Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "dependencyContinuity": {
      "status": "pass",
      "hash": "d2fbd8fb52ac43584ecd",
      "at": "2026-09-24T00:13:50.812Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "designLanguage": {
      "status": "pass",
      "hash": "e0c87cd7fc1a1ac23584",
      "at": "2026-09-24T00:14:22.514Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "doubleTapSafety": {
      "status": "pass",
      "hash": "7d4db8b22be3eeec23f5",
      "at": "2026-09-24T00:15:22.718Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "education": {
      "status": "pass",
      "hash": "f078667f491bc365cad3",
      "at": "2026-09-24T09:40:52.104Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "employeeStatusSafety": {
      "status": "pass",
      "hash": "c962f9faf031a34b5aeb",
      "at": "2026-09-24T09:44:14.561Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "interactionLayer": {
      "status": "pass",
      "hash": "cebfefbbbf16d2f917c7",
      "at": "2026-09-24T09:48:11.189Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "logicalDirection": {
      "status": "pass",
      "hash": "1152c61aa0ffe7b747de",
      "at": "2026-09-24T09:49:18.659Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "otpResume": {
      "status": "pass",
      "hash": "7a3ddb2fe421e66e4d4a",
      "at": "2026-09-24T09:49:31.377Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "overlayAboveNav": {
      "status": "pass",
      "hash": "e228d9cc0e0f997c8327",
      "at": "2026-09-24T09:50:20.560Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "overlayRtl": {
      "status": "pass",
      "hash": "12ec28e67ee45d04a0e1",
      "at": "2026-09-24T09:51:18.306Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "productOpeningStock": {
      "status": "pass",
      "hash": "8a0225a966d079dd0c20",
      "at": "2026-09-24T09:51:53.292Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "roleDeleteSafety": {
      "status": "pass",
      "hash": "7bd4237eeb046ba8e90c",
      "at": "2026-09-24T09:52:30.436Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "setupCompletion": {
      "status": "pass",
      "hash": "729659e6f3de8e0403ac",
      "at": "2026-09-24T09:57:59.459Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "skeletonCoverage": {
      "status": "pass",
      "hash": "00bed01b2c7e7507cfa3",
      "at": "2026-09-24T09:58:50.995Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "systemDrive": {
      "status": "pass",
      "hash": "55a2db60ebc57fb3fe68",
      "at": "2026-09-24T10:00:24.004Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "adminFullAccess": {
      "status": "pass",
      "hash": "4045a8b1c8d931f3a2bc",
      "at": "2026-09-23T23:59:07.711Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    },
    "educationHelp": {
      "status": "pass",
      "hash": "96c4aec385f2c94c1154",
      "at": "2026-09-24T09:42:48.476Z",
      "head": "7e8eb294ec6ac3e65f8a9c36b1ea7f2ab0a8e398"
    }
  },
  "lastVerify": {
    "at": "2026-09-27T19:26:54.077Z",
    "tier": 2,
    "result": "running",
    "seconds": 362,
    "ran": [
      "tsc --noEmit",
      "vitest (full)",
      "E2E accessibility",
      "E2E accessUx"
    ],
    "skipped": [],
    "reason": null
  },
  "metrics": [
    {
      "at": "2026-09-23T18:16:01.202Z",
      "tier": 2,
      "seconds": 131,
      "result": "fail",
      "runs": 24,
      "skips": 0,
      "changed": 72
    },
    {
      "at": "2026-09-23T18:40:22.422Z",
      "tier": 2,
      "seconds": 1275,
      "result": "fail",
      "runs": 24,
      "skips": 0,
      "changed": 73
    },
    {
      "at": "2026-09-23T19:06:37.371Z",
      "tier": 2,
      "seconds": 422,
      "result": "fail",
      "runs": 12,
      "skips": 12,
      "changed": 69
    },
    {
      "at": "2026-09-23T19:15:15.911Z",
      "tier": 2,
      "seconds": 142,
      "result": "fail",
      "runs": 9,
      "skips": 15,
      "changed": 70
    },
    {
      "at": "2026-09-23T19:39:32.965Z",
      "tier": 2,
      "seconds": 291,
      "result": "pass",
      "runs": 2,
      "skips": 22,
      "changed": 71
    },
    {
      "at": "2026-09-23T20:41:52.186Z",
      "tier": 2,
      "seconds": 2364,
      "result": "fail",
      "runs": 23,
      "skips": 2,
      "changed": 72
    },
    {
      "at": "2026-09-23T20:48:55.235Z",
      "tier": 2,
      "seconds": 157,
      "result": "pass",
      "runs": 1,
      "skips": 24,
      "changed": 72
    },
    {
      "at": "2026-09-23T20:57:23.933Z",
      "tier": 2,
      "seconds": 216,
      "result": "pass",
      "runs": 1,
      "skips": 24,
      "changed": 72
    },
    {
      "at": "2026-09-23T21:48:35.673Z",
      "tier": 2,
      "seconds": 195,
      "result": "fail",
      "runs": 24,
      "skips": 2,
      "changed": 98
    },
    {
      "at": "2026-09-23T22:31:49.543Z",
      "tier": 2,
      "seconds": 2327,
      "result": "fail",
      "runs": 24,
      "skips": 2,
      "changed": 100
    },
    {
      "at": "2026-09-24T00:21:58.782Z",
      "tier": 2,
      "seconds": 1216,
      "result": "fail",
      "runs": 22,
      "skips": 4,
      "changed": 116
    },
    {
      "at": "2026-09-24T10:00:39.622Z",
      "tier": 2,
      "seconds": 1483,
      "result": "fail",
      "runs": 16,
      "skips": 10,
      "changed": 114
    },
    {
      "at": "2026-09-27T18:27:04.727Z",
      "tier": 2,
      "seconds": 122,
      "result": "fail",
      "runs": 27,
      "skips": 0,
      "changed": 190
    },
    {
      "at": "2026-09-27T18:44:45.089Z",
      "tier": 2,
      "seconds": 130,
      "result": "fail",
      "runs": 27,
      "skips": 0,
      "changed": 190
    },
    {
      "at": "2026-09-27T18:58:49.525Z",
      "tier": 2,
      "seconds": 239,
      "result": "fail",
      "runs": 27,
      "skips": 0,
      "changed": 191
    }
  ],
  "dirty": 68
}
```
<!-- ENGINEERING-OS-CHECKPOINT:END -->

---

## 0b. Speed path — the workflow these scripts implement

**Permanent rule: speed must come from a smarter workflow, never from weaker QA.**
`NO ACTUAL EVIDENCE = NO PASS = NO ADVANCEMENT` stands unchanged; everything below removes
re-derivation, repetition and environment mistakes — not verification.

| Command | What it does | Why it exists |
|---|---|---|
| `npm run resume` | prints the live checkpoint (branch, HEAD, server mode, lane greens, next command) | a restarted session used to re-derive all of it by reading files |
| `npm run preflight` | 5s environment gate: git state, dev-server mode, DB reachability, 4 fixture accounts, QA row count | wrong-mode server / unreachable DB / missing fixtures are the failures that cost minutes |
| `npm run verify:plan` | prints the computed tier, changed files, and which lanes would run or be skipped | makes the gate inspectable before paying for it |
| `npm run verify` | runs the smallest sufficient gate (below) and records metrics in the checkpoint | the gate is sized by the change, not by habit |
| `npm run verify:full` | forces Tier 2 with no lane caching | the escape hatch — never a downgrade |
| `npm run lane:new <name>` | scaffolds a lane with console capture and helper pointers, and registers its coverage | harness mistakes cost a full cycle each |
| `npm run qa:count` / `qa:clean` / `qa:seed baseline\|e2e` | independent counts, clean-then-recount, named seed scenarios | the cleaner's own output is not evidence |
| `npm run index:build` | regenerates `SCREEN-INDEX.md` (route → file → covering lanes) | removes repeated discovery from every impact map |

**Tiers** — computed from changed files by `scripts/dev/verify.mjs`, never chosen by feel:

| Tier | Trigger | Gate |
|---|---|---|
| 0 | documentation only | `tsc` + build |
| 1 | UI / component / copy / settings / education | `tsc` + unit guards + affected E2E lanes + build |
| 2 | money, RBAC/security, migrations, destructive actions, integration tests, release workflow | `tsc` + full vitest + canonical E2E lanes (**forced, never skipped**) + affected lanes + build + independent QA row count |

The tier may only be **raised** (`--tier N`); `verify.mjs` refuses to lower a computed tier, and
a change that cannot be classified conservatively is treated as Tier 2.

**Lane caching.** A lane is skipped only if it was green AND every file its
`scripts/dev/lane-map.json` globs cover is byte-identical to that green run. Skips print as
`SKIPPED — unchanged since green`; unmapped lanes default to `src/**`, so a new lane can never
be silently skipped.

**APK / release.** No APK during development or QA loops. It is an end-of-session, on-request
deliverable produced only through the decided GitHub Actions path
(`.github/workflows/build-apk.yml`) — never another build source.

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
| Reset to role defaults | Verified | Browser: "Use role access only" → DB override rows 0 → UI back to the role's set. Also asserted in `tests/e2e/accessUx.spec.ts` (§1.8). |
| Effective access | Verified | Role defaults + overrides + branch scope + active status, resolved server-side; `get_my_permissions()` returns the authoritative set. |
| Branch scope | Verified | `branch_id` on 7 operational tables + 7 enforcement triggers + RESTRICTIVE read policies. 0 records without a branch. 9/9 branch tests. |
| Backend authorization | Verified | 36 of 43 write RPCs carry an authorization guard; the remainder are internal/trigger helpers or admin-gated and are explicitly allowlisted. `create_employee` now carries its own entry-point guard and asserts tenant context (0137). |
| Invitation acceptance | Verified | An invited employee can sign in and activate: `provision_member_login` (0135) creates the identity with `id = users.id` as part of the invitation; one canonical phone form on both sides (0136). Browser + API evidence and a falsified regression test in §1.17. |
| RLS correctness | Verified | 0 app-facing tables with RLS enabled and zero policies (the failure mode that silently broke `shops`, settings and reminders). |
| Anonymous-write protection | Verified | anon-executable writes: 23 → 1 (`insert_shop_request`, the registration form). |
| Tenant isolation | Verified | Real JWT tests: cannot read or mutate another tenant's rows, roles, business areas, employees, or run its RPCs. Cross-tenant writes refused. |
| Audit | Verified | `audit_events` records role/access changes with the acting user; employee override save + reset both attributed. |
| Live session behaviour | Verified | Role change / membership deactivation revoke access at the next authorization boundary; no stale client cache can grant it. |
| Role lifecycle safety | Verified | `ROLE_IN_USE` (employees still on it), `SYSTEM_ROLE_READ_ONLY`. |
| QA verification | Verified | **389/389 Vitest across 33 files, 3 consecutive full runs** (after resolving two fixture-identity collisions — §1.18); TypeScript clean; production build passes; Playwright in real Chrome — 58/58 at the last full run, plus 19/19 for the suites affected by the latest change. |
| Duplicate-action safety | Verified | One confirm = one action, protected in the database, for sale (0134), supplier payment and void (0138) and stock adjustment (0139); every money page holds one key per attempt. Browser double-tap proof + falsification, and a permanent integration suite — see §1.18. |
| Permanent regression protection | Verified | `tests/integration/rbacInvariants.test.ts` fails the build if any original defect class returns. |
| Display attribution integrity | Verified | Every denormalized party name is backfilled and structurally stamped (0124/0125) — see §1.1. |

### 1.1 Display attribution integrity (dashboard-stage inspection)

Found while inspecting the dashboard stage, on the live screen rather than in code:

- **Reproduced:** `/admin/dashboard` → Recent Sales rendered three rows with a blank
  customer name and `Sold by:` followed by nothing.
- **Root cause (two parts, both evidenced):** `sales.customer_name_snapshot` only
  arrived in migration 0102, so earlier rows were NULL and
  `src/stores/salesStore.ts` maps it with no fallback; and `recorded_by_name` on
  `purchases`, `customer_payments`, `supplier_payments` and `payments` is stamped by
  **no function at all**, so those columns were permanently blank.
- **Fix — table-level, not per-screen:** 0124 backfills every NULL from the FK that
  already knows the answer and installs one declarative `BEFORE INSERT OR UPDATE`
  trigger that fills only NULLs and **never overwrites** (historical snapshot
  semantics preserved). 0125 extends it to capture the JWT actor when a write path
  omits `recorded_by`; in a system/non-JWT context it leaves the column NULL rather
  than inventing attribution. **This is display integrity, not authorization.**
- **Evidence:** nulls `sales.customer_name_snapshot 5/6 → 0/6`, `sales.employee_name
  5/6 → 0/6`; trigger proof (resent a NULL-named row → names resolved from FK, a
  pre-existing name preserved, rolled back clean); real path proof — signed in via
  Supabase Auth, `create_purchase` through PostgREST → DB row `recorded_by` = JWT
  `sub` (=== `users.id`) and `recorded_by_name` = the user's name, probe row deleted;
  browser re-check shows the customer names and `Sold by:` restored.
- **Not recoverable:** 2 historical purchases have `recorded_by = NULL`. The actor
  cannot be known retroactively, so it was deliberately left NULL.

### 1.2 Dashboard financial correctness — gross profit was double the truth

Found by reconciling every admin-dashboard figure against the database rather than
by looking at the screen.

- **Reproduced:** `/admin/dashboard` (filter = All) showed **GROSS PROFIT Rs. 12,000**;
  the database says **Rs. 6,000**. Total Sales, Credit Collect, overdue, Out of stock,
  Action needed and the alerts all reconciled — only profit was wrong.
- **Root cause:** the dashboard built its cost lookup from the products store, which
  loads **active products only** (`productsStore.ts: .eq("is_active", true)`), then
  defaulted a missing cost to **zero**: `(unitPrice - (variantCost.get(variantId) ?? 0)) * qty`.
  Every item whose product had since been deactivated silently cost nothing. The
  delta proves it exactly: `12,000 − 6,000 = 6,000 = 3000 × 2`, the whole COGS of the
  one item on an inactive product.
- **The trap underneath:** `sale_items.cogs_amount` — the authoritative snapshot
  column — existed as `NOT NULL DEFAULT 0` with **every row 0** and **no function
  writing it**, while migration 0012 had intended `cost × qty` and returned `cogsTotal`.
- **Fix:** 0127 backfills the column as **line COGS (`cost × qty`)** and stamps it on
  insert via a dedicated trigger that only fills NULLs. `salesStore` maps `cogsAmount`
  and the dashboard computes revenue − recorded COGS, using the variant lookup only
  as a fallback for pre-snapshot rows. Verified: browser now shows **Rs. 6,000**,
  matching the DB; regression 337/337, tsc clean, build passes.
- **Rule recorded:** a financial figure must come from a snapshot taken at
  transaction time (today's cost is not yesterday's cost), and a lookup that can miss
  must never fall back to a value that flatters the number — zero cost is maximum profit.

### 1.3 Authorization-helper robustness (found while proving the above)

`request.jwt.claims` set to **empty** (not missing) made `…::json` throw `22P02`,
which cascaded `app_current_user_id()` → `current_branch_scope()` →
`enforce_branch_scope()` and aborted the write with a JSON syntax error. Eleven
functions parse that GUC; 0126 hardened the six that were unguarded with
`NULLIF(…, '')`, leaving the three already-safe ones (`get_authenticated_user_id`,
`record_incident`, `is_trusted_context`) untouched. Authorization decisions did not
change — only how "no claim" is represented. Verified: the previously fatal context
now returns `NULL`/`false` and the write proceeds with the actor left NULL.

### Evidence commands

```bash
node scripts/rbac-evidence.mjs        # live snapshot of the authorization foundation
npx vitest run                        # full suite (337 tests, stable across repeated runs)
npx tsc --noEmit && npm run build     # typecheck + production build
node scripts/reset-qa-baseline.mjs    # restore the clean QA baseline
node scripts/record-engineering-memory.mjs  # re-record verified learnings
```

Engineering Memory now holds 12 active entries; the earlier entry that blamed
PgBouncer pooler visibility for the intermittently failing credit-request test is
**superseded** — the verified cause was shared-fixture teardown.

### 1.4 Dashboard scope completed (locked spec) + E2E harness reality

The locked dashboard scope from `SCREENS.md` / `CR-008` was completed and
reconciled against the QA database, not against appearances:

* Admin dashboard now renders the required figures: **Paid** and **Credit** sales
  (computed but dead code before) alongside Total Sales, Gross Profit, Outstanding,
  Supplier Payable, Low Stock and **Expiring**, plus the Action/Credit alert counts.
  Verified arithmetic in the browser: Paid 1,200 + Credit 26,000 = Total Sales 27,200.
* Employee dashboard now renders transactions and customers served.
* **Employee Performance vs Total Sales was not a defect.** A truncated read had
  suggested the list explained only 10,000 of 27,200; the full list accounts for all
  four sellers (10,000 + 7,200 + 5,000 + 5,000 = 27,200). No business meaning was
  changed, because nothing was wrong.
* One new string (`admin.expiring`, EN + UR) was added; every other label reuses
  existing EN/UR keys. Urdu/RTL verified in the browser (`dir=rtl`, translated labels).

**The E2E suite was not healthy — 14 of 58 specs failed — and the cause was the
harness, not the product.** The specs predated the authorization migration: their
headers stated that no browser JWT was needed and that RPCs read the actor from
Zustand, which stopped being true once the backend began authorizing from the JWT.
`injectAdminAuth` then fabricated a user carrying only a legacy role field, so
`PermissionGuard` correctly denied every deep `/admin/*` path and the spec timed out
waiting for controls that never rendered — a misleading symptom for an authorization
redirect. The helper now signs in through the real login path and persists a user
mirroring the QA admin's actual membership (owner, tenant, `*`), and the suite went
**44 passed / 14 failed -> 58 passed / 0 failed**. This matters beyond tidiness: the
APK job in `.github/workflows/build-apk.yml` is gated on that E2E job, so the harness
drift was blocking the release path.

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

### 1.5 The E2E harness could not log in from a clean baseline (root-caused, not worked around)

Running the suite from the cleaned baseline (2 users, 0 business rows) failed broadly,
and the visible symptom was misleading: the login screen said *"Could not start a
secure session for this account. Please try again, or ask the shop owner to
re-provision your login."* and every spec then timed out waiting for a URL change.

The network trace proves the real sequence rather than assuming it:

1. `POST /auth/v1/token?grant_type=password` -> **400 `invalid_credentials`** (the
   fixture user exists in `users` but has no Auth credential),
2. the app's fallback `POST /auth/v1/signup` -> **429 `over_email_send_rate_limit`**.

So `signUp` can never self-heal a fresh credential, and a provisioning script run
before the suite cannot help either, because the fixture user is created *inside* the
suite by `setupFixtures()`. Fixed in the shared helper: `ensureAuthSession(phone)` now
provisions the credential out-of-band with `email_confirm: true` (the same thing
`scripts/provision-auth-sessions.mjs` does) before the UI drives the login. Verified:
sign-in returns **200** with `sub=10000000-…-0001`, the flow reaches `/login/pin-set`,
and the suite runs green from a cleaned baseline (**57 passed / 1 failed**, the single
failure being this spec's own copy assertion, replaced with a DB-reconciled one).

Two harness defects were fixed alongside it, both with evidence:

* `scripts/clean-test-data.mjs` swallowed every delete error, so a blocked delete was
  indistinguishable from a missing table. `purchase_items`/`purchases` were missing from
  the delete list, so their FKs silently blocked product/variant/company cleanup and left
  a dirty baseline. Both fixed; the script now reports real errors.
* 14 assertions of the form `expect(await el.isVisible()).toBe(true)` in
  `crossScreenSync.spec.ts` took a one-shot visibility snapshot right after
  `networkidle`, racing store hydration. They now use Playwright's auto-waiting
  `toBeVisible()`, which is the same semantics without the race (13/13 pass).

### 1.6 Inventory unit model resolved: the variant is the stock of record

The dashboard work exposed the same class of defect in inventory. Two columns existed
with three competing models:

* Legacy migrations (0015 "flexible units", and every RPC through 0049) treat
  `products.stock_qty` as **base units** and deduct `qty * unit_size`.
* The current RPCs (`create_sale`, `create_purchase`, `process_return`) mutate
  `product_variants.stock_qty` by `qty`.
* `adjust_stock` states the intended model in its own comment — *"the variant is the
  authoritative stock level"* — and recomputes `products.stock_qty` as `SUM(variants)`.

Nothing but `adjust_stock` ever recomputed that sum, so the product column went stale
after every sale/purchase/return; and `void_sale` — the function the app actually calls
(`src/lib/db.ts`, `offlineQueue`) — restored `products.stock_qty += qty * unit_size`
while never touching the variant, so stock was permanently lost from the level sales
deduct and inflated on the level nothing sells from.

**Decision (from the product owner's standing instruction that variant-level is the
actual inventory): the variant is the stock of record; `products.stock_qty` is derived.**

* **0128** installs one `SECURITY DEFINER` trigger on `product_variants` that keeps
  `products.stock_qty` equal to `SUM(active variants)` for every write path (the same
  semantic `adjust_stock` already defined), backfills any drifted row, and rewrites
  `void_sale` so it restores the **variant** (honouring quantities already returned),
  with all void semantics preserved.
* Screens no longer invent availability: `VariantSelectorPage`, `BrowseProductsPage` and
  `CartPage` derive sellable quantity from the variant's own stock (never
  `product.stockQty / unit_size`), and a sale's low-stock notification now uses the
  variant's remaining stock, once per variant.
* Low stock is one definition everywhere (dashboard, reports, inventory alerts) via
  `productLowStockThreshold()` in `src/lib/formatters.ts`.

Evidence (rolled-back transaction, nothing persisted): variant stock 10 -> product
rollup 10; `create_sale qty 4` -> variant 6.00 **and** rollup 6.00 (previously the
rollup stayed at 10); `void_sale` -> variant 10.00, rollup 10.00, `restoredStock=4`,
void movement `6.00 -> 10.00`.

Not settled by this decision, and deliberately left alone: what **unit** a variant holds
for display, because labels such as *"Total stock: N kg"* still read the derived total
with the product's base unit. That is a product-wording/units decision, recorded here
rather than silently changed.

### 1.7 Dashboard scope gaps closed, and one alarm that was not a defect

* `SCREENS.md` ADM-DASH-HOME figures that were computed and never rendered — **Paid**,
  **Credit**, **Low Stock**, **Expiring** — are now on the dashboard, reconciled in the
  browser against the DB (Paid 1,200 + Credit 26,000 = Total Sales 27,200).
* The employee dashboard now shows **Transactions** and **Customers Served**.
* **Employee Performance vs Total Sales is not a defect.** A truncated read had suggested
  the list explained only 10,000 of 27,200; the full list accounts for all four sellers
  (10,000 + 7,200 + 5,000 + 5,000 = 27,200), and `create_sale` stamps `employee_id` from
  the authenticated actor, so every product-created sale is attributed. Unattributed rows
  can only come from raw fixture SQL. No business meaning changed.

### 1.8 Employee / job-access screens speak the owner's language (and one real bug fell out)

The award for the simplest thing to get wrong: the access screens were built from the
inside out, showing the shop owner permission counts, "effective permissions",
"employee exceptions", "inherited from role", "branch scope" and "role template" — and
asking the same question twice (a legacy Owner/Admin/Employee chip beside the real role).
They now read as three decisions and one optional step:

| Screen | Now shows |
|---|---|
| Add Employee | **who** (name, phone, optional photo/job title) → **what job** (role, with the access it gives in business areas) → **where** (a branch only when more than one exists) → **Review** |
| Employee Detail | Role · Can work at · Access (business areas) · **Customize access** on demand · Deactivate/Reactivate |
| Customize access | Role, where they can work, then areas with plain actions; legend **Comes from their role / Only for this employee / Turned off for this employee**; **Use role access only** + **Save** |
| Roles & Access | Each role described by what it does and the areas it opens, plus **Employees: n** from the membership rows |

**The real bug this uncovered:** the employee list printed an "Admin" chip on *every*
employee. `employeesStore` maps the `users` table, which has no `membership_role` column,
so `emp.membershipRole` is always `undefined` and the ternary fell through to the admin
label. The list now shows the **Owner** chip only for `isOriginalOwner`, and the detail
page takes the authoritative role from `get_employee_access()`. The users list is not the
membership; nothing owner-facing may branch on membership fields it does not carry.

Second copy defect: `permissions.action` is not a closed verb set (it contains
`supplier`), so the raw-action fallback printed `View, supplier`. Area and action wording
now comes from one shared module (`src/lib/permissionLabels.ts` + `area.*`/`action.*` keys
in **EN and UR**), and the Urdu legend, headings and buttons render correctly with RTL and
zero horizontal overflow.

Verified: `tests/e2e/accessUx.spec.ts` **5/5** — the areas shown for a role equal that
role's `role_permissions` modules (exact set equality, recomputed from the QA database); a
created employee lands with the chosen `role_id`, `status='active'` and `branch_scope`;
Customize access writes an `is_override` row and **Use role access only** removes it; no
EN copy leaks into the Urdu flow; QA baseline returns to 4 users / 0 overrides.

### 1.8 EN/UR coverage sweep — three classes of hardcoded English closed (2026-09-20)

A "no hardcoded user-facing English" gate cannot be checked by looking for one pattern.
There are **three** classes, and the first sweep only caught the first:

1. JSX text nodes on one line (`>Scan Barcode<`)
2. **JSX text on its own line** (`>\n  Gross Profit\n<` — invisible to a line-based regex)
3. **Strings in arrays/props/templates** (`{ key: "today", label: "Today" }`,
   `label="Transactions"`, `` `<title>Print Barcodes</title>` ``)

Closed in this pass: shell chrome (PIN prompt, barcode sheet, offline sync label,
`ErrorBoundary` — a class component now renders a functional `ErrorFallback` that can use
`useT()`), all auth screens (login, PIN, OTP, forgot-PIN, splash, deactivated, not
registered, rejected, under review), purchase/inventory/payment/reports labels, empty
states, returns, register flow, and the Reports screen end-to-end (its PERIODS array now
carries `labelKey` and resolves through `t()` — the array is module-level, so it can never
call a hook).

Evidence: Reports in Urdu/RTL renders `رپورٹس · آج · اس ہفتے · اس مہینے · اب تک ·
حسب ضرورت · مجموعی منافع · لین دین · سامان کی لاگت · وصول شدہ نقدی` with **zero horizontal
overflow**; `Reports`/`Today`/`TRANSACTIONS`/`COST OF GOODS` were English before the change.
Live login page in Urdu shows `خوش آمدید`, the phone hint, the 6-digit hint and `کوڈ بھیجیں`.

**Permanent guard:** `tests/unit/i18nCoverage.test.ts` (8 checks) — every `t()` key in `src`
must exist in **both** dictionaries (both quote styles), every `*Key` config property must
resolve, no hardcoded JSX text / UI attribute / ternary label, the signal engine must hand
the UI keys, an inline-bilingual ratchet, and the AST ratchet described in 1.9.
348/348 tests, `tsc` clean, production build clean.

**Deliberately not translated:** the `AgriShop` brand, `Rs.` currency prefix from
`formatCurrency`, the Observation Bot's generated diagnostic report body (an
engineer-facing dump, not product copy), role names and descriptions (tenant data in
the DB), crop names (data), and the language names in the picker (`English` / `اردو`,
each written in its own script by convention).

**Dead code removed (verified by reference check, not assumed):** `src/imports/**`
(163 unreferenced Figma mock-ups) and `src/components/ui/RTL.tsx` (zero importers; five
of its six exports had zero references). Both were deleted after a repo-wide search for
static imports, dynamic `import()`, `import.meta.glob`, `require.context`, tsconfig /
vite / tailwind / index.html references, and the build entry graph. The two guard
exception lists that named them (`i18nCoverage`, `listPrimitiveGuard`) are now empty on
purpose, so neither can hide behind a file that no longer exists.

### 1.9 Three blind spots the browser found — the AST guard that closes them (2026-09-20)

Translation coverage was re-checked by driving the **real Urdu UI through every route** and
reading the rendered DOM, not by re-reading the sweep that had already "passed". It found
three classes the pattern-based checks could not see:

1. **Single-quoted calls.** `t('overview') || 'Overview'` — the guard only matched `t("…")`,
   so the Observation Bot panel's 12 keys silently fell back to English in Urdu. The owner's
   **More** menu also rendered the raw key `admin.observationBot` (referenced indirectly as
   `labelKey: "admin.observationBot"` in a config array, never as a `t()` argument).
2. **JSX text containing an expression or parentheses.** `Credit Limit (Optional)`,
   `Stock ({baseUnit})`, `Actual inventory in {baseUnit}. Sellable units consume from this
   pool.`, `Select All ({maxEligible})` — the text-node regex excluded `{}` and `()`.
3. **One-sided ternaries and JSX expression literals.** `cond ? "All products are
   well-stocked" : \`…\``, `{company ? company.name : "Select supplier…"}`, the barcode
   screen's `Select All` / `N selected` / `Generate N Barcodes`. A regex needs *both* arms
   to be literals, so these shipped English.

Two smaller findings in the same pass: the base-unit **token** (`piece`) was interpolated
straight into user-visible labels instead of its translated label (`products.unit.*`), and
`products.variants` was translated as `ورژن` ("version"). Both corrected; unit labels now
resolve through the unit's own i18n key.

Closed in this pass: More menu, Observation Bot panel, barcode generation, reorder
suggestions, record purchase, add product, add customer, activity log, employee
notification groups, search results (`N variants` / `N units`), and the shop-registration
form (business types, City, Business Registration, validation errors, submission toast).
Live Urdu evidence: `آبزرویشن بوٹ` in the More menu (was the raw key), `👁️ جان — مشاہدہ کار /
ایکسپورٹ / تازہ کریں / جائزہ / کارروائیاں / خرابیاں / رائے` on the Observation Bot screen,
and zero English on `/admin/purchases/new`, `/admin/inventory/reorder`,
`/admin/inventory/barcodes`, `/admin/customers/new`, `/admin/inventory/new`,
`/register/shop-details`, `/employee/notifications`, all with `dir=rtl` and **0 px**
horizontal overflow.

**Prevention:** the guard now parses the JSX with the TypeScript AST
(`ts.createSourceFile` + `ScriptKind.TSX`) and ratchets every rendered literal — JSX text
nodes *and* string literals inside `{…}` — excluding keyboard tokens and the English arm of
an inline bilingual ternary. Baseline 97 (measured, may only decrease); the same scan is
what produced this fix list, so the gate is now able to see all three classes.

### 1.10 Two test-suite defects root-caused — never labelled "flaky" (2026-09-20)

**A. A suite that borrowed another suite's identity.** `rbacFoundation.test.ts` authenticated
as `e1000000-…0001` — an admin `employeePermissions.test.ts` both seeds *and deletes* in its
`afterAll`. On a clean database (or whenever that file had not run first) all four of its
tests failed with `NOT_AUTHORIZED: tenant access denied`; it only passed by file order.
Proven by running the file alone on a cleaned QA database: **4/4 fail before**, and after
seeding its own private admin (the `users` insert also creates the owner membership via the
`ensure_user_membership` trigger): **4/4 pass alone**. A per-file isolation audit then ran
every integration suite alone on a clean database — 11/12 passed; the 12th was a transient
3-in-a-row pass after re-run (see B-class timing below), not a fixture dependency.

**B. A cleanup that wiped a parallel suite's rows.** `tests/setup/fixtures.ts`
`cleanupTestData()` ran unscoped `DELETE FROM reminder_logs / reminder_occurrences /
reminder_configs`. Three other suites call it in `beforeAll`, and they run in parallel with
`tenantIsolationOps`, whose own reminder config vanished mid-test →
`insert or update on table "reminder_occurrences" violates foreign key constraint
"reminder_occurrences_config_id_fkey"`, about **1 run in 3**. The deletes are now scoped to
the fixtures the helper owns — the same rule the file's own comment already states for
identities. Evidence: 4 consecutive full integration runs, **21/21 files each, 0 failures**
(before: 1 failure in 3 runs).

Full-suite state after these fixes: **Vitest 348/348 across 25 files**, integration run
repeatedly clean, and the Playwright suite re-run end-to-end.

### 1.11 The full suite run to the end, the "hang" disproved, and the app's own title (2026-09-20)

**A. The complete Playwright suite passed sequentially, in one process.** The earlier
full-suite attempts that ended in a timeout were investigated, not accepted: every spec
was first run alone (all 63 passed), then the whole suite was launched detached and the
log polled until it finished. Result: **63/63 passed in 16.9 min, 0 failed, 0 retried,
0 skipped** — the ordering under which the previously-flaky integration defects appeared.

**B. The "full-suite failure" was a local tool limit, and it was misdiagnosed once as a
hang.** The suite now takes **16.9 min** (it grew from the 113 s / 13-test baseline recorded
on 2026-09-14: 7 files, 63 tests). A local run is therefore capped by the 10-minute command
budget, not by the app. The intermediate symptom `worker process exited unexpectedly
(code=143, signal=null)` is `SIGTERM` from the local `timeout` wrapper (143 = 128 + 15),
**not** a browser or test failure. The CI job allows `timeout-minutes: 60`, so 16.9 min is
comfortably inside it. Expected runtime is now recorded so the next reader does not
re-derive it as a defect.

**C. A real shipped-UI defect: the app shipped the Figma template's title and description.**
`.figma/make/site.json` carried no `title`, so `vite.config.ts` fell back to its default
`"Figma Make App"`, and the template's marketing blurb was emitted as our `<meta
name="description">` and `og:title`. Verified in the built artifact before the fix
(`dist/index.html` → `<title>Figma Make App</title>`), and after it:
`<title>AgriShop</title>` with an AgriShop description. The rendered `<html lang>`/`dir`
were already correct — `applyDirection()` in `stores/themeStore.ts` sets both at runtime —
so only the static document metadata was wrong.

**Evidence commands**

    npx vitest run                              # 348/348 across 25 files
    npx tsc --noEmit                            # clean
    npm run build                               # ✓ built in 2.83s
    npm run build && grep -o '<title>[^<]*</title>' dist/index.html   # <title>AgriShop</title>
    npx playwright test                         # 63/63, 16.9m (single sequential run)
    node scripts/check-qa-connectivity.mjs      # QA reachable in 1302ms
    node scripts/clean-test-data.mjs            # CLEAN — 0 rows removed, seed accounts kept

**Open blocker (not a code defect): GitHub Actions cannot start a runner on this account.**
Run 35524709132 (`build-apk.yml` on `acbc58c`) failed with *"The job was not started because
recent account payments have failed or your spending limit needs to be increased"* — **zero
steps executed**, so no result about this code was produced. The workflow's own commands were
therefore reproduced locally against QA (connectivity check, Vitest, Playwright, build) and
all pass; the APK job itself cannot be exercised until billing is resolved.

### 1.12 The employee lifecycle, and one defect wearing its clothes (2026-09-20)

**A. Adding an employee now issues an INVITATION.** `create_employee` (0113) wrote
`memberships.status = 'active'` directly, so a person the owner had merely added already
held full tenant access before ever signing in — the invitation, the employee record and the
person's access were all the same act. The activation point was not chosen, it was derived:
the device PIN is device-only (`lib/pinLock.ts` hashes it into localStorage and never sends
it, so `users.pin_hash` is unused and there is **no** server-visible "PIN set" event), which
leaves a successful phone OTP — the event that also establishes the JWT
`app_current_user_id()` reads — as the only server-observable proof that the invitee
accepted. `complete_member_onboarding()` is therefore a SECURITY DEFINER RPC that activates
**only the caller's own** memberships, **only from `pending`**, and refuses while the user row
is inactive. A second hole was closed in `sync_membership_status()`: because it derived status
purely from `users.is_active`, reactivating a pending invite promoted it, and cancelling an
invite then re-enabling it *lost* the pending marker and restored access to somebody who had
never signed in. Reactivation now returns an employee who has never signed in to `pending`.

**B. The "fake performance" on an employee page was borrowed data, not invented data.**
The performance panel filtered sales with
`s.employeeId === emp.id || s.employeeName === emp.name`. `sales.employee_id` is **NOT NULL**,
so the name arm could only ever add false positives: any colleague sharing a name fed their
revenue, sale count and recent-sale list into this person's screen. The name arm is gone, and
operational data is gated on the invitation having been accepted — a pending employee sees an
"Invitation sent" state rather than zeros under a Performance heading (which read as a result
rather than as absence).

**C. Role is the job profile, so the separate job-title field is gone.** Step 1 of Add
Employee asked "what do they do?" for the role *and* offered a free-text "Job title
(optional)". The field, its review row and the `jobTitle` argument are removed; the column
stays for existing rows (nothing is destroyed). Two surfaces that used `jobTitle` as a
stand-in for a person's role were corrected with it: the employee settings screen showed the
hardcoded English `"Store Associate"` for anyone without one — which the removal would have
made *always* visible in Urdu mode — and the employee detail header printed a second,
competing answer to "what does this person do?".

**D. The E2E suite got 39% faster without touching coverage.** 63 tests serially took
16.9 min. Raising the worker count globally is unsafe for a checkable reason: `dashboardScope`
reconciles rendered figures against same-tenant aggregates and `actionCenter` counts
same-tenant signals, so a concurrent writer changes the aggregate between the UI read and the
DB read. The lanes are therefore split by **what each spec asserts** — writers-that-mint-their-
own-rows in a parallel lane, tenant-wide reconcilers in a serial lane, one lane after the
other.

**Evidence**

    node scripts/deploy-single.mjs supabase/migrations/0129_employee_invite_lifecycle.sql
    npx vitest run                                  # 353/353 across 26 files
    npx tsc --noEmit                                # clean
    npm run build                                   # ✓ built
    npx playwright test tests/e2e/accessUx.spec.ts  # 5/5 (invite labelled, no performance)
    npx playwright test tests/e2e/crossScreenSync.spec.ts   # 13/13
    node scripts/run-e2e-lanes.mjs                  # 63/63 in 10m21s (was 16.9m serial)

New regression suite `tests/integration/employeeInviteLifecycle.test.ts` (5 tests) proves the
security properties rather than the UI state: an invited employee resolves to no permissions
and a real `create_customer` is refused with **no row created**; onboarding activates once and
is idempotent; an active employee cannot activate a colleague's invite; a suspended membership
is never revived by the deactivated person signing in; and a cancelled invite returns to
`pending`, not to `active`. `tests/e2e/accessUx.spec.ts` now asserts against the locked intent
— that the review step does **not** contain "Job title", and that a new employee is labelled
"Invited" with no "Recent sales" panel.

### 1.13 The returns path was missing every rule it was supposed to enforce (2026-09-20)

**A. A function rewrite silently deleted the return rules.** 0052 was the last version of
`process_return` that enforced anything. 0112 rewrote the function to add the RBAC gate and to
follow the 0128 schema — and left only an existence check, so a return could be made on a
**voided** sale (double-restoring stock that the void had already restored), for **more than was
sold**, from a line belonging to a **different sale**, at a **client-chosen unit price**, with
**no reason**, and **repeatedly**. The client has always sent an `idempotency_key`
(`src/lib/db.ts:170`) and `returns.idempotency_key` has been UNIQUE since 0014, yet nothing read
it: a retried or double-submitted return created a SECOND refund and restored stock twice.

Two fingerprints identified the loss without needing to know 0052 existed: `db.ts` maps
`RETURN_WINDOW_EXPIRED` / `EXCESS_RETURN` / `ITEM_NOT_OWNED` / `SALE_ITEM_NOT_FOUND` /
`REASON_REQUIRED` to user-facing messages — error codes nothing could produce any more — and it
reads `data.return_number` / `data.total_refund` while the live function returned camelCase, so
the return number rendered as `undefined` and the refund as `0`. All are restored in **0130**,
with the RBAC gate from 0112 kept intact.

**B. Restoring the guards introduced a NULL that only a value assertion could catch.** The
restored function ran an idempotency probe — `SELECT r.id, r.return_number, r.total_refund
INTO v_id, v_return_number, v_total` — and plpgsql assigns NULL to **every** target when no row
matches, wiping the `v_total numeric(14,4) := 0` initialiser. Every refund was therefore computed
from NULL, stored as NULL (`returns.total_refund` is nullable), and propagated into the customer
balance through `GREATEST(0, outstanding_balance - NULL)`. **All six guard tests passed while the
happy path wrote NULL**; it was reproduced with no client at all (`SET LOCAL role authenticated`
+ JWT claims → `{"total_refund":null}` in both the response and the row). 0052 had an explicit
`v_total_refund := 0; v_return_id := NULL; v_return_number := NULL;` reset line after that probe;
dropping it was the whole bug. Both the guards and the value are now pinned by tests.

**C. Flagged for a product decision — not changed.** For a return, `process_return` reduces
`customers.outstanding_balance` by the full refund for **both** resolutions. BUSINESS-RULES.md
§8 says a **cash refund leaves outstanding unaffected** (cash is handed back) and only a **credit
adjustment** reduces it; 0052 instead reduced it by the credit *ratio* of a partially-paid sale.
The live behaviour matches neither. Two historical implementations and the spec disagree, so the
right answer is a business call, not a technical one — see the DECISION REQUIRED note below.
Nothing was changed here because guessing would silently rewrite how every shop's customer
balances move.

**Evidence**

    node scripts/deploy-single.mjs supabase/migrations/0130_restore_return_integrity_guards.sql
    npx vitest run tests/integration/returnIntegrityGuards.test.ts   # 6/6
    npx vitest run                                                  # 359/359 across 27 files
    npx tsc --noEmit ; npm run build                                # clean

`tests/integration/returnIntegrityGuards.test.ts` proves each rule behaviourally through the real
RPC **and asserts that no row was written** when a return is rejected — "it threw" is not evidence
that nothing was refunded. It also pins the value of a successful return, the stored row, the
non-NULL customer balance, and idempotency (same key → same return id, no second row).

### 1.14 Return movement history is incomplete (found, not yet fixed)

Sales write `inventory_movements` (0128), but the 0112 `process_return` restores
`product_variants.stock_qty` without recording a movement — 0052 did write a `'return'` movement.
So a returned item's stock history has a gap. This is recorded rather than fixed because the
authoritative contract of `inventory_movements` for returns needs confirming first (movement type
list, and whether the 0128 rollup trigger is expected to cover it). It is a reporting/history gap,
not a stock-correctness one: the variant quantity itself is correct.

### 1.15 Employee onboarding made obvious — and two defects it exposed (2026-09-21)

Scope was the owner-facing onboarding experience only; the RBAC model, the pending → OTP →
active lifecycle, role defaults, employee overrides and branch scope were all held as they were.

**A. The flow asked the same thing twice and hid a decision behind a read-only list.** The
three steps were Employee → "Job & Access" → Review, where step 2 carried the role question,
the role's whole access panel **and** the branch question below it, and step 3 reprinted all of
it as a second full sheet before the commit. Reordered to Employee → Role → Where, one decision
per step: the branch question has its own named step, the role's access renders under the card
that was just chosen (not after every other card), and the last step is the only place the
details are collected. The step rail had names in i18n that were never rendered — three
anonymous dots — so the journey now names itself (Employee / Role / Where, EN + UR).

**B. Two things the flow should not have been asking at all.** Photo was the first control on
step 1 despite being optional, ahead of both required fields; and no role is preselected any
more, because a default let the owner hand out access by pressing Next without ever deciding
what the person does (Next is disabled, with a plain-language reason).

**C. The commit did not say what it was committing to.** Adding somebody issues an invitation
(§1.12 A), but the button said "Create Employee" and the flow returned to the list with a
toast, so nothing in the product said what happens next. It now says **Send invitation**, states
that the employee signs in with this number and sets their own PIN, and lands on the new
employee's page — where the invitation and its next step are visible.

**D. An authorization enum was being invented in a .tsx file (real security defect, fixed).**
`memberships.role` / `users.role` gate authorization, and both were written from a payload the
client composed — `create_employee` read `payload->>'membershipRole'`, and Add Employee derived
it from the selected role's **display name**
(`r.name.toLowerCase().includes("admin") ? "admin" : "employee"`). All four system roles are
English names with no "admin" in them, so it always produced `employee` and every fixture agreed
— it only misfired on a name an owner had invented: "Branch Admin" produced `users.role =
'admin'`, and 0106/0107 grant RLS INSERT/UPDATE/DELETE on `roles` and `role_permissions` to
`users.role = 'admin'`, i.e. that employee could rewrite the tenant's whole RBAC model.
`update_employee_access` was the same field one step further: `membershipRole = 'owner'` promoted
an employee to full ownership. 0131 derives it in `create_employee`, refuses it in
`update_employee_access`, and the frontend no longer sends it. Pinned by
`employeeInviteLifecycle.test.ts` (8/8) by the fields authorization actually reads.

**E. A pending membership's authorization denial was drawn as an access configuration.**
`get_employee_access` returns `defaults`, `overrides` and `effective`; only `effective` depends
on membership status and it correctly returns nothing while an invitation is pending. The detail
screen rendered `effective` as the access line and inferred "changed for <name>" by diffing it
against the defaults, so a just-invited employee showed "This role has no access yet" and a
change line, against a database holding **12 role defaults and 0 overrides** — false in both
directions. It now renders role defaults + stored overrides (the model the DB documents, and
identical for an active employee) and counts exceptions from `user_permissions`. The same state
also offered "Deactivate employee" with "their sales and past activity stay on record" for
somebody who had never worked; it reads **Cancel invitation** with an honest confirm.

**Evidence:** browser walkthrough of the whole journey (step 1 → step 3 → invited employee page),
`accessUx.spec.ts` **5/5** (now asserts no preselected role, the branch question is *not* on the
role step, the CTA, the Urdu rail, overflow on steps 2 and 3, the invited employee's areas,
no false change line, and that "Deactivate employee" is absent), `employeeInviteLifecycle.test.ts`
**8/8**, Vitest **362/362** across 27 files, `tsc` clean, QA baseline restored (4 users, 0 pending
memberships, 2 branches, 4 roles).

**Open, not silently decided:** role *names and descriptions* are tenant data stored in English
("Sales Manager", "Shop floor: sales, customers, product viewing"), so they render as entered in
Urdu mode. That is data, not UI copy — translating it would mean either a translation table keyed
by role or seeded Urdu role text, which is a product decision (see §2).

### 1.16 Access can be managed where the decision is made — and a role change no longer deletes it (2026-09-21)

**A. The access model is now one definition, rendered in both places.** The rule the
database enforces is `effective = (role defaults ∪ granted overrides) ∖ denied overrides`
(0108 `get_effective_permissions`). That now lives in `src/lib/accessModel.ts`
(`applyOverrides`, `diffOverrides`, `overridesToStore`) and is drawn by one component,
`EmployeeAccessEditor`, used both in Add Employee and on the employee page — so the owner
cannot get two different answers to "what will this person actually have?" depending on which
screen they are on.

**B. Access can be customized while inviting.** `create_employee` accepted a legacy
`permissions` field and ignored it, so customizing somebody meant creating them and then
opening their page to change one thing — two writes for one decision, and a half-configured
employee if the second failed. 0132 accepts the same `overrides` object
`update_employee_access` already takes and writes it in the same transaction (unknown codes are
skipped, not fatal). The role step says the role's access is the starting point
(`Uses the role's access as it is`), offers **Customize access** in place, and the confirmation
step reports the effective result plus `N changes from <role>`. Authorization is untouched: the
write still requires `employees.manage`, the membership is still `pending`, and holding
exceptions grants nothing until the invitee signs in for the first time (asserted).

**C. A role change used to delete the employee's exceptions (real defect, fixed).** The editor
held the selected role's defaults as its edit state, so choosing a different role reset it and
Save then sent `overrides = {}` — which `update_employee_access` takes as "replace the whole
collection", i.e. `DELETE FROM user_permissions WHERE is_override`. Reproduced against the live
database: 3 granted `companies.*` rows → open Customize access → select Store Manager → Save →
**0 rows**, with no warning and no message; the "changed for" line just disappeared. The server
rule is the opposite (a role change leaves `user_permissions` alone), so the screen was
destroying owner intent on the very surface whose purpose is to record it. The editor's value is
now the effective set, a role change re-derives it as `applyOverrides(newDefaults, stored)`, and
Save writes `overridesToStore(...)` — the visible differences plus any stored exception that is
currently a no-op for the selected role, so the owner's decisions survive a role change instead
of quietly retiring or resurrecting themselves.

**Not part of this change:** role names and descriptions remain English tenant data (role *names*
are shown as entered), which stays an open product decision recorded below.

**Evidence:** browser walkthrough of the role step and confirmation in EN (customization made in
flow: "3 changes from Sales Employee", Suppliers in the effective access) and UR/RTL;
`accessUx.spec.ts` **6/6** (new test 6 covers in-flow customization → stored rows → role change
keeps them), `employeeAccessOverrides.test.ts` **4/4** (real JWT → PostgREST → RPC → DB: written
with the employee, both grant and denial reach authorization, role change keeps them, reset
clears them), Vitest **366/366** across 28 files, `tsc` clean, production build clean, QA baseline
restored (4 users, 2 owners, 0 pending memberships, 0 override rows, 4 roles, 2 branches).

---

### 1.17 An invitation can finally be accepted — and the three defects that hid it (2026-09-21)

**The reported symptom.** An invited employee opened the invite link, received the code,
typed it correctly, and landed on *"Could not start a secure session for this account."*
The invitation had never been usable — the product asked for trust in a credential it could
not supply.

**Root cause.** `app_current_user_id()` reads the JWT `sub`, so an employee's Supabase Auth
identity must have `id = public.users.id`. Only `scripts/provision-auth-sessions.mjs` ever
created one, and that is an operator step, so a new invitee could hold a session for an
identity the app did not recognize. The browser cannot repair this: Supabase rejects the
fabricated local domain at `signUp` (*"Email address … is invalid"*) and rate-limits `signUp`
on top, so the app must not be minting identities at all.

**Fix (0135 + 0136 + 0137).** `provision_member_login(user)` — SECURITY DEFINER, guarded by
`authorize_business_action('employees.manage')`, restricted to a user inside the caller's own
tenant, idempotent (an existing row is repaired, never duplicated), writing the same derived
credential the app already signs in with, so no client change and no new secret to hand over.
`create_employee` calls it after writing the invite and tolerates failure by recording
`member_login_provision_failed`, so a provisioning problem never loses the employee record.
0137 restates the wrapper with its **own** entry-point guard (Invariant E caught that the
delegating wrapper's authority was invisible) and asserts the employee landed in the tenant
the guard authorized.

**Second defect on the same path.** `lookup_user_by_phone` compared raw strings while sign-in
always queries the normalized e164 form, so an employee stored in local format (`0300…`) was
unreachable — a correctly typed code answered *"this number isn't registered with any shop"*.
Both sides now compare through one IMMUTABLE helper, `public.canonical_phone()`.

**Verified.** Browser: invite link → code `123456` → Set PIN → `/employee/dashboard`, with
membership `pending` before sign-in and `active` after, `first_login_at` set, login with
`id = user id`, `get_my_permissions()` returning the role defaults. API: owner JWT invites →
`auth.users` row exists with `id = employee id` → employee signs in with the derived credential
(no error, `jwt sub = user id`) → `complete_member_onboarding` `activated: 1`.
**Falsification:** with `provision_member_login` dropped, the new regression test fails with
*"inviting an employee did not create their login"* and *"the invitee cannot sign in"* — the
exact user-facing symptom — while the other 8 tests still pass, proving the tolerance path.

**Why the suite could not catch it before.** `execRpcAsUser()` calls `getAuthClient()`, which
CREATES a missing credential so the test can act as the user. The harness supplied exactly what
the product did not. The new test therefore reads `auth.users` directly after `create_employee`,
before any test-side sign-in, and then accepts the invite through a plain client that
provisions nothing.

**Two test-infrastructure defects found while proving it (both root-caused, neither "flaky").**

1. `tests/setup/global-teardown.ts` kept only 2 of the 4 QA fixture phones, while
   `scripts/clean-test-data.mjs` kept 4 and documented why (deleting a `users` row deletes its
   `auth.users` credential, which the app cannot re-create). So **every** `vitest run` deleted
   QA Admin and QA Employee — rows and credentials — and the next sign-in failed with the
   secure-session / not-registered message that looks like a product bug.
   `tests/unit/qaFixtureKeepList.test.ts` now fails if the two lists ever disagree.
2. `employeeAccessOverrides` / `employeeInviteLifecycle` seed their own owner with
   `INSERT … ON CONFLICT DO UPDATE`, but the User→Membership invariant is an **AFTER INSERT**
   trigger — so on any run where that owner row survived, no membership existed and every RPC
   answered `NOT_AUTHORIZED: tenant access denied`, cascading into 3 more failures with
   misleading invalid-uuid errors. Both now ensure the membership explicitly, and the suites
   were re-run consecutively (including the exact re-run that used to fail).

**Regression at this point:** vitest **381/381 across 31 files, two consecutive full runs** ·
tsc clean · production build clean · `accessUx` 7/7 in real Chrome · QA baseline
2 users / 0 pending / 0 overrides / 4 roles / 2 branches / **0 employees without a login** ·
Engineering Memory `active=35, superseded=1` · production untouched.

**Open, not silently decided.** (a) The invitation is delivered by hand today (copy/WhatsApp/SMS
of a link that carries the code in demo mode); a real SMS provider is a product decision, and
`VITE_OTP_DELIVERY=sms` is the single switch. (b) Writing to the `auth` schema directly is
version-dependent — the equivalent admin-API call inside a server-side function is the
long-term home; the gate, idempotency and credential contract stay the same either way.
(c) Role *names and descriptions* are tenant data, so they render as entered in Urdu mode;
translating them means a translation table or seeded Urdu role text.

---

### 1.18 The double-tap fix was one instance of a class (2026-09-21)

The owner's report — *"I double-click confirm and it creates two sales"* — was fixed for
sales in 0134. Rather than close it there, **every** consequential money/inventory action was
submitted the way the UI submits it (two simultaneous calls with a real JWT) and judged on the
database. Three more instances were real:

| Action | Defect found (reproduced on QA) | Fix |
|---|---|---|
| Record supplier payment | No idempotency at all — two payments recorded, payable reduced twice (10,000 → 9,000 instead of 9,500). Money the shop never paid. | **0138**: `idempotency_key` + partial unique index; the key is CLAIMED by the insert before the payable moves |
| Void a sale | Read-then-act race: both calls passed the `is_voided` check, wrote two `voids` rows, two inventory movements, and both wrote the variant stock (a lost update, so the restored quantity was whatever the last writer computed) | **0138**: the sale is read `FOR UPDATE`, so the decision is held until it is carried out; the loser waits, sees the truth, and is refused with the message the UI already shows |
| Adjust stock | No idempotency either — the adjustment applied twice, moving stock 50 → 60 and logging two movements for one decision | **0139**: same claim-then-apply shape |

**The client half, which the database cannot cover.** The payment and return **pages** minted
their key inside the submit handler, so even the paths that already had a unique index sent a
different key on each tap — the guard was present, tested, and still ineffective in the
product. Every one of those pages now holds **one key per attempt** (minted once, retired on
success, kept on failure so a retry after a lost response returns the recorded action instead
of repeating it) and refuses a re-entrant confirm synchronously, because the button's
`disabled` state only applies on the next render. That last point is the whole bug: React
re-renders *after* the handler, so a second click in the same task reaches the RPC twice.

**Evidence.**

- Database, real JWT (`.freebuff/tmp/prove-duplicate-taps.mjs`, `prove-more-taps.mjs`): before
  → supplier payment 2 rows / payable 9,000, double void 2 voids + 2 movements, return 2 rows
  and stock 48→50 (instead of 49), adjustment 2 movements and stock 50→60 (instead of 55),
  customer payment submitted the old way 2 rows / balance 1,000→400. After → one row each,
  money and stock moving once.
- Browser (`tests/e2e/doubleTapSafety.spec.ts`, 2/2): both clicks are dispatched in **one
  JavaScript task**, which is the only faithful reproduction of a double tap — two awaited
  Playwright clicks are not, because the browser re-renders between them and the button is
  already disabled. Double-tapping the customer and supplier payment confirms each records
  exactly **one** row and moves the balance/payable once.
- **Falsification:** with the page's re-entry guard removed the browser test fails with
  `Received: 2` — the reported defect, reproduced by the test.
- Permanent regression: `tests/integration/duplicateActionSafety.test.ts` 7/7 (concurrent
  duplicate, sequential retry returning `idempotent:true`, and un-keyed backward compatibility
  for supplier payments and adjustments; a concurrent void refused with *"already voided"* and
  stock restored once).

**Two test-infrastructure root causes found while proving the above (neither "flaky").**

1. `employeeAccessOverrides` failed about 1 full run in 4 with `NOT_AUTHORIZED: tenant access
denied` on `create_employee` — for an owner it had just authorized, and its own precondition
assertions passed moments earlier. Instrumenting the refusal named it in one run:
`jwt-sub=<the owner> user-row=[] membership=[]` — the actor was right and the rows were GONE.
Two suites declared the same owner UUID (`c3000000-…-0001`) with different phones; because one
suite's upsert did not refresh `phone`, the shared row kept the other's number, so whichever
suite cleaned up first deleted a row the other was mid-run using. The same scan found a second
instance (`branchScopeEnforcement` asserted against a shop `tenantIsolationOps` **deletes and
recreates**) and a third, subtler one (`duplicateActionSafety` built its sale and stock movement
on the shared QA baseline, which neighbours' cleanup deletes — surfacing as "Sale not found" on
both halves of a concurrent void, and an adjustment movement count of 0). All three now own
their identifiers, and `tests/unit/fixtureIdCollision.test.ts` fails the build if two files ever
claim one id again (with a documented allowlist for values shared on purpose: the seeded QA
baseline, system roles, the nil UUID).
2. The fix for the void dialog's double fire needed a test that could actually see the client
guard: the first version asserted only the final row count and **passed with the guard removed**,
because the database already covered the outcome. It now samples the toast surface for the whole
life of a toast (they self-dismiss after 3s, so one check at the end is vacuous) with a control
that the success toast was observed, and fails on the right symptom when the guard is gone.

**Regression at this point:** vitest **389/389 across 33 files, 3 consecutive full runs** ·
`tsc` clean · production build clean · affected E2E in real Chrome: `doubleTapSafety` 2/2,
`voidSaleSafety` 1/1, `splitPayment` 2/2, `crossScreenSync` 13/13 (the full Playwright suite
was not re-run for this change) · QA baseline clean (4 users, 0 sales/payments/voids/
adjustments, 0 users without a membership) · Engineering Memory `active=39, superseded=1` ·
production untouched.

### 1.19 Home's "overdue" was the whole customer debt, and it was a second copy of the rule (2026-09-22)

The owner asked what the overdue figure on Home meant, and the honest answer was nothing. The card
rendered `customers.reduce((s, c) => s + c.outstandingBalance, 0)` — every rupee any customer owed
— and labelled it **overdue**, so a shop with no late payments still showed overdue money, and
"outstanding" and "overdue" could never be told apart. The authoritative answer already existed:
`signalEngine`'s S1 signal is `outstanding > 0 AND due_date past` (Pakistan time), and the Action
Center has been listing exactly those customers all along. So the defect was not a wrong formula
but a **second implementation** of one — the S1 predicate sat inline inside
`computeOverdueCreditSignals`, leaving Home no way to reuse it except to copy it.

The predicate is now exported once (`isCreditOverdue`) and both the card
(`computeOverdueCreditTotal`) and the signals read it, so the two screens cannot disagree.
Verified against the QA database with money created through the real RPCs: total outstanding
Rs. 1,700 vs genuinely overdue Rs. 1,100, Home reads **Rs. 1,100 overdue**; a Rs. 100 payment made
after the credit was already overdue moved both the database and the screen to Rs. 1,000; after
cleanup Home reads Rs. 0. Urdu/RTL: `Rs. 1,000 واجب الادا`, `dir=rtl`, no overflow, no English left
in the metric.

**On seeding overdue state at all:** migration 0034 added
`CHECK (due_date IS NULL OR due_date >= CURRENT_DATE)`, so a past due date cannot be written —
overdue arises only from time passing. The fixture writes it under a session timezone in which
that date is still today, which satisfies the constraint while storing a date genuinely before
Pakistan's today. Nothing was disabled or dropped.

**Regression:** `tests/unit/overdueCredit.test.ts` 12/12 (falsified: the old formula gives 12,000
where the correct figure is 9,000) · `dashboardScope` 6/6, its overdue assertion now recomputed
from the database and paired with a guard that fails if total outstanding is shown again
(falsified by reverting the card, which failed at `tests/e2e/dashboardScope.spec.ts:167`) ·
`actionCenter` + `crossScreenSync` 25/25 · vitest **415/415 across 37 files** · `tsc` clean ·
production build clean · QA baseline clean (0 fixture rows across customers, products, companies,
sales, customer_payments) · production untouched.

### 1.20 The escalating reminder sequence was unreachable — and no reminder could be saved at all (2026-09-22)

The escalating sequence in the reminder mockup (Gentle 15 / Firmer 30 / Final notice 45) was missing
from creation for two independent reasons.

1. **The group sheet shipped an empty sequence.** `GroupReminderSheet` had
   `escalation: []`, so choosing *Escalating sequence* rendered an empty block — no steps, and no way
   to add any. The engine maps a stage's **position** to its tone and falls back to a **single** stage
   when the list is empty, so the reminder silently did not escalate. The sequence now comes from one
   exported definition (`DEFAULT_ESCALATION`), both screens seed it when the option is chosen, and an
   out-of-order sequence (equal or descending days) shows *"Each step must come later than the one
   before it."* and blocks Save — the engine sends the final notice by position, so the order is not
   cosmetic. Both engine branches now share `escalationStages(config)`.
2. **Every save failed anyway.** `reminder_configs` still carries its original `name` and `type`
   columns as NOT NULL, while migration 0122 moved the contract to the columns every writer actually
   sends. The insert returned `23502 null value in column "name" … violates not-null constraint`; the
   browser logged *Failed to save reminder configs* on a 400 and the table held **zero rows**. So
   reminder creation — group **and** single — had been failing at the write. 0141 drops NOT NULL on
   the two legacy columns; `escalation` stays `text` and the array is stored as the JSON string the
   loader already parses (both write shapes were checked, so nothing had to change in the app).

**Proof:** the three steps render at 15/30/45 in the real browser and Save wrote a row with
`repeat_type = escalate` and the full sequence; the ordering rule was shown blocking Save and then
clearing. **Regression:** vitest **428/428 across 38 files** · `tsc` clean · production build clean ·
migration guard 6/6 — it caught this migration colliding with existing `0135`/`0140` versions before
release. Reminder creation already sits behind `PermissionGuard requires="alerts.view"`, so the
escalating part inherits that role gate; no new permission was invented. QA cleaned (0 leftover
fixture customers, 0 reminder configs); production untouched.

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

Inspection of this stage has already begun and immediately surfaced two real
defects (§1.1, §1.2), both now fixed and verified. That is the intended shape of
this stage: the anchor screen must show authoritative business data before any
new form is added on top of it.

**Superseded (2026-09-20): the wait for a new dashboard artifact is void.** The product
owner locked the scope to the repository's own specification — `dev-guide-extracted/SCREENS.md`,
`ROADMAP.md` and `changes/CR-008…CR-027` — so no external design file is required before
implementing. The earlier conclusion that implementation must pause until a PNG arrives was
wrong and is recorded here so it is not re-applied. The dashboard stage is now closed with
reconciled evidence (§1.2, §1.4, §1.7, and the `dashboardScope` E2E suite reconciling the
rendered figures against the database), and the remaining locked scope is the CR list above,
not a single form. The only dashboard artifacts that were ever present are older image
references (`Redesing/Home Dashboard admin.png`, `Redesing/Home dashboard.png`, four
bottom-nav PNGs and `redesign-view.html`); they are now reference material only.

Review any *future* artifact or CR against this real system *before* writing code:

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

---

## Stage: consequential-action safety closure (2026-09-21)

Started as verification of one change (the employee deactivate/reactivate confirmation)
and closed the whole class it belongs to. Every item below has real evidence: real Chrome
through Playwright, or a real JWT through PostgREST into the RPC, judged on the database.

### What was found, and what was done

| # | Defect (all reproduced first) | Fix | Evidence |
|---|---|---|---|
| 1 | Employee deactivate/reactivate confirmation guarded by React STATE. Two clicks in one task both read the pre-render `false`, so two `deactivate_employee_v1` calls went out and the owner saw an ERROR right after the deactivation had succeeded | `statusBusyRef` | `employeeStatusSafety` 3/3; falsified: reverting to the state guard gives `Received: 2` |
| 2 | `delete_role` confirmation had the identical flaw | `deletingRef` | `roleDeleteSafety` 1/1; falsified: `Received: 2` |
| 3 | Four create screens had NO re-entry guard at all — only `disabled={loading}`, which is applied on the re-render: Add Employee, Record Purchase, Add Product, Add Company | `creatingRef` / `savingRef` | `reentrancyGuard` unit guard; falsified by removing one |
| 4 | **Recording a purchase failed completely.** `purchase_items.line_total` is NOT NULL and the RPC read it from a field the page never sends, so every purchase raised `null value in column "line_total"` and rolled back — no purchase, no stock, no payable. The same NULL propagated into the total, and there was no idempotency and no actor either | Migration 0140 | `createOnceSafety` 2/2: one purchase, stock 0→3, payable 300; falsified: without the key, 2 purchases |
| 5 | **Opening stock typed on Add Product was discarded.** `create_product` reads stock from each variant; the form collects one figure and sent it at product level, so every product was created with 0 stock while the field's own hint promises sellable units come out of it | Page now sends it where the database reads it (single unit row) | `productOpeningStock` E2E |
| 6 | A SQL error reported in-band looked like data: `execSql`/`runSqlHttp` returned `{error}` as a row, so a failed fixture write read as "the row isn't there" and the spec blamed the product | Both helpers throw | the first run of `employeeStatusSafety` failed on a product assertion that was really a bad fixture enum value |
| 7 | `"Saving…"` hardcoded on Add Product — English in Urdu mode; the existing guards do not see a literal inside a JSX ternary | `t("common.saving")` | source |
| 8 | **Migration 0012 cannot be replayed from scratch**, so the `Supabase Preview` check has failed on every commit since the first one: a bare `o` plus a newline split `outstanding_payable`, and a fresh database stops at `syntax error at or near "utstanding_payable"`. The live databases never hit it because 0015 and 0027 redefine the same function | the line joined back into one statement | replayed in an in-process Postgres: corrupt text → CI's byte-identical error; joined text → clean; `migrationReplayability` guard fails naming `0012:167` |
| 9 | **A reload on the code screen restarted sign-in.** `pendingPhone` — the only state saying "a sign-in is in progress" — was memory-only (`partialize` kept just `user`), and every code screen guards on it at mount, so an in-flow reload silently threw the owner back to "enter your phone number". On a slow rural connection that is ordinary, and it is the reported "login takes ages" friction | kept in `sessionStorage` (this tab, this session), cleared on sign-in and logout | reached `/login/otp`, reloaded → landed on `/login`; with the fix `/login/otp` survives with all six boxes, a second tab still starts clean, and reverting it fails `otpResume` at line 39 |

Durable prevention: `tests/unit/reentrancyGuard.test.ts` fails on any
`if (<boolean useState>) return;` in `src/`, on any listed consequential submit that lost
its ref, and on any submit that stopped claiming its idempotency key.

### Release pipeline — what running it actually showed

The release commit is `c15d85a` (pushed; `HEAD == origin/main`). Running the sanctioned
workflow exposed two further things: one real defect in this repository, and one
account-level blocker no change in this repository can fix.

**Fixed — migration 0012 could not be replayed from scratch.** The `Supabase Preview`
check fails on every commit with
`ERROR: syntax error at or near "utstanding_payable" (SQLSTATE 42601)`, and has failed
that way since the first commit: line 167 of `0012_update_existing_rpcs.sql` ends with a
bare `o` and the next line continues `utstanding_payable`, so Postgres reads one
identifier as `o utstanding_payable`. Applying the file to a **fresh** database stops
there. Reproduced in an in-process Postgres: the corrupt text fails with CI's
byte-identical message, the joined line replays without error, and reintroducing the split
makes `tests/unit/migrationReplayability.test.ts` fail naming `0012…:167`.

**Fixed — ten migration versions collided, so a fresh database could never be
provisioned.** With 0012 joined, the check moved past it and failed at
`ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
Key (version)=(0014) already exists`. Two files shared version 0014, and the runner keys
its bookkeeping on the version, so the second one always fails. Ten versions collided in
total (0014, 0028, 0029, 0042, 0047, 0056, 0057, 0058, 0091, 20260903): these were
authored in pairs and applied by hand in the SQL editor, which is why nothing ever
noticed. Each pair is now ONE file per version containing both bodies in the order the
runner would have used them — the version set is unchanged, so no existing database
re-runs anything, and no statement moves relative to another. Migrations 143 → 133.
Content preservation is asserted byte-for-byte when the merge is written, and
`migrationReplayability` now fails on any shared version (falsified: duplicating a file
made it name `0015: 0015_flexible_units.sql, 0015_zz_temp_duplicate.sql`).

### Migration state — authoritative determination (evidence, not inference)

Asked why the preview environment has objects before the migration that defines them, the answer is
not a fork detail. It is that **`supabase/migrations` is a patch set, not a baseline, and cannot
produce the application's schema from nothing under any circumstances.**

Evidence, all read-only:

| Question | Finding |
|---|---|
| Which versions does the parent record as applied? | **Only 0009, 0010, 0011** — `complete_schema`, `comprehensive_rls`, `new_rpc_functions` |
| Is 0009 a baseline? | **No.** Its first statements are `ALTER TABLE users ADD COLUMN shop_id uuid REFERENCES shops(id)` and `INSERT INTO shops(...)`: it assumes a provisioned database. It is a *patch named complete_schema* |
| Does any migration create the base tables? | **No.** Nothing creates `users`, `products`, `customers`, `shops` or `sales` (checked across all 133 files). Only `memberships` (0094) and `roles` (0107) are created here |
| Is the parent's schema behind its ledger? | **The opposite.** The parent has `roles`, `user_permissions`, `business_areas`, `reminder_configs`, `engineering_memory`, `sales.branch_id` and `adjust_stock(payload jsonb)` — i.e. the state produced by the END of the history, while its ledger stops at 0011 |
| Can the directory replay onto an empty database? | **No.** Replayed onto an empty in-process Postgres with Supabase's scaffolding stubbed, 0009 fails immediately with `relation "users" does not exist` and the failure cascades: **54/133 applied, 79 failures** |
| Why does the preview collide with `adjust_stock`? | `adjust_stock` appears nowhere before 0015, so a function that does not exist yet can only already exist if the database already has it. The preview branch forks the provisioned project and inherits a 3-row ledger, so 0012 onward replays on top of a schema that already contains their objects |

**What this means.** Two defect classes were being reported as one:

* **DB-independent** — real defects that would fail anywhere: 0012's split identifier, the ten duplicate
  versions (both fixed in this session). These block fresh provisioning and were worth fixing on their own merits.
* **Fork-dependent** — cannot fail on an empty database, only on a fork that already has the schema: the
  `42P13` parameter renames. The `DROP`-first edits made in this session are still correct (0015 is simply the
  file that was missing the pattern 0025/0027/0028 already use), but they are not *sufficient*, because the next
  fork-only conflict is always waiting.

**The decision, which is the project owner's and not a fix.** A preview branch always starts from the
provisioned schema, so replaying 0012+ there is wrong regardless of file contents:

* **A — synchronize the ledger** with what the parent schema actually reflects (`supabase migration repair
  --status applied`), so the fork inherits a complete history and future migrations get a meaningful check.
  This writes to the parent database, so it is not done unilaterally here; note also that it makes the
  *ledger* truthful without making the directory *replayable*.
* **B — build a baseline** by dumping the real schema, for anyone who wants to provision a fresh environment.
  The directory cannot supply it (see the 54/133 above). This rewrites history, so it is a deliberate call.

Neither was performed. No production database was touched: `.env.qa` and `.env.local` both point at the QA
project `bpybjrjenwccowvtrevu`, production is the separate project `gkswcfljxlutkfdvvqng`, and no credentials
for it exist in this checkout.

**Decision recorded 2026-10-01 — see [`SCHEMA_STRATEGY.md`](SCHEMA_STRATEGY.md).** Measurements since
then show neither A nor B alone is sufficient: the directory also fails to apply onto a captured
baseline (30/169 files onto production, 24/169 onto staging, 26 onto `COMPLETE_DATABASE_SETUP.sql`).
The strategy is therefore **frozen environment baselines + forward-only files, each verified against
the target's own baseline before it is applied anywhere**. Staging's ledger is synchronized by
adoption (169 files, 0009→0177); production's baseline is captured and read-only, and the migration
runner refuses production by policy. The credential sentence above predates the sanctioned Phase 2A
credential intake; production is still never contacted by the migration tooling.

### Permanent protection added

`tests/unit/migrationReplayability.test.ts` now has four checks, each falsified by deliberately breaking it:

1. no identifier split across a line break (caught the real 0012 defect)
2. no two files sharing a version (caught all ten real collisions)
3. no same-arity parameter rename without a `DROP` (caught the three real 42P13 cases)
4. the directory must stay honest that it is a patch set — it fails if a base table ever *is* created here, so
   the strategy gets re-decided instead of inherited silently

A fifth check is deliberately **not** added: "the chain applies to an empty database" would fail forever by
design, because the base schema is not in this directory (54/133). A permanently-red test is indistinguishable
from no test — that is the same lesson the preview check taught.

**Beyond the migration question, the preview check cannot be made green by editing migration files.** Two failures
later the shape repeated: `42P13 cannot change name of input parameter "payload"` at 0015,
and after that `42809 "idx_customers_phone_unique" is a partial index — Cannot create a
primary key or unique constraint using such an index`. The 0015 one is decisive, because
`adjust_stock` is defined **nowhere earlier in this repository** — it is 0015 that creates
it first. A function that does not exist yet cannot collide with anything, so the database
being pushed into must already contain it. That is what a Supabase preview branch is: a
FORK of the project's current schema, whose `schema_migrations` inherits only what the
parent project has recorded — **QA has just 0009, 0010 and 0011** — so every version from
0012 up is considered unapplied and the entire history replays on top of a schema that
already has all of its objects. Each old file therefore rewrites current objects back to
older definitions until a later file rewrites them forward again; convergence is only
accidental. Nothing in the migration directory fixes that. It needs a decision: record the
applied versions on the parent project, or replace the pre-0140 history with a baseline
that a fresh environment starts from.

**Blocked, needs the account owner — no workflow job can start.** Every run of
`build-apk.yml` and `backup-database.yml` fails with the job never reaching a runner:
`runner_name=""`, `steps=0`, whole job 3 seconds (`2026-09-21T15:37:19Z` →
`15:37:22Z` for run 35620183865, job 106400986311). The repo is private and its Actions
settings are healthy (`enabled:true`, `allowed_actions:"all"`), so this is an
account-level restriction (Actions minutes/spending limit, or a failed payment) rather
than a workflow defect — the same workflow produced `apk-build-262` with an APK asset on
2026-09-14, and nothing under `.github/workflows/` changed after `d348c0c`. No APK can be
generated through the sanctioned path until that is cleared, and it is deliberately not
worked around: a locally built APK is not the release artifact.

### PRODUCTION READY: NO — remaining blockers

1. **The release pipeline cannot start a job (account-level, above).** Blocks both the APK
   and CI's run of the full suite; needs the repository owner to clear it.
2. **Opening stock with more than one unit row is an open product decision.** The form has
   one stock field and the product may have several units; the fix applies it to the single
   unit row. For two or more units the form cannot express per-unit opening stock — needs
   either per-unit fields or hiding the single field. Not guessed at.
3. **`void_sale` does not receive an idempotency key from the screen.** The ref guard plus
   the 0138 `FOR UPDATE` refusal make a double tap safe, but a retry after a lost answer
   reports an error instead of returning the original void.
4. `create_product` / `create_company` are ref-guarded in the UI but have no database
   idempotency, so a lost-answer retry could duplicate.
5. Employee-side screens still hold English literals (the earlier microcopy pass was
   scoped to the admin side).
6. The full local Playwright suite has not been re-established in ONE clean pass since the
   test-helper change (it was 77 passed / 1 infrastructure failure before it); the affected
   run is green at **22/22** for the seven specs this stage touches, and CI would otherwise
   supply the full run if item 1 did not block it.
7. **The migration history cannot be replayed onto the project's own schema, and that is a
   decision, not a fix.** The `Supabase Preview` check moved forward three times in this
   session (0012 syntax → 0014 duplicate version → 0015 parameter rename → a partial-index
   constraint), and each push bought exactly one more failure. The rest of the chain will
   be the same shape, so grinding it file-by-file is not a plan. It needs the project owner
   to choose: record the applied versions in the parent project's
   `supabase_migrations.schema_migrations` (so the fork inherits them and nothing replays),
   or replace the pre-0140 history with a baseline that a fresh environment can start from.
   The fixes already made are correct regardless and are kept: 0012 was unappliable even to
   an empty database, ten versions were duplicated, and the renamed-parameter
   redefinitions could not apply onto an existing schema either.
   **Decided 2026-10-01:** [`SCHEMA_STRATEGY.md`](SCHEMA_STRATEGY.md) — frozen baselines +
   forward-only files verified against the target baseline. Not replaying history on any environment
   is what addresses this whole class; staging's ledger was synchronized by adoption, and production
   stays read-only.

## Stage: company / customer / reminder / stock-integrity pass (2026-09-22)

Reported symptoms, all reproduced first and fixed at the layer that owned the defect.
Migrations 0142–0145 are applied to QA. Engineering Memory holds a `failure_pattern` entry
for each of the eight root causes below.

### What was actually broken

1. **Every live update in the app was dead code.** `supabase_realtime` held no tables, so
   none of the seven subscribed tables (`products`, `product_variants`, `customers`,
   `sales`, `companies`, `notifications`, `users`) could ever emit a change. 0144 publishes
   exactly those. Proven with a Node probe before and after, independent of the UI.
2. **A “fresh” cache outranked the database.** `products`/`customers`/`sales` stores
   returned cache AND skipped the network for five minutes, so the app could not see its own
   writes: a purchase left stock at 50 on screen while the database held 150, pull-to-refresh
   did nothing, and a saved customer photo reverted to an initial. The cache is now a render
   hint that always revalidates.
3. **Unpaid purchases read “PAID”.** `fetchPurchases` mapped `outstanding_payable` and
   `cost_price`; the real columns are `amount_due` and `unit_price`. `Number(undefined)` is
   NaN, and NaN is not `> 0`, so every delivery looked settled and the payable header read
   Rs. 0 against Rs. 140,000 owed.
4. **Editing a product saved nothing.** `update_product` had no variant handling at all —
   the selling and cost prices the Edit Product screen collects were silently discarded, so a
   price could not be changed. 0145 writes variants by id (never `stock_qty`, never a
   delete).
5. **A customer reminder configuration was collected and dropped.** `AddCustomerPage`
   persisted the photo and the crops but never the reminder config.
6. **The same reminder schedule could exist twice**, reminding a customer twice every two
   days. 0143 makes one rule per customer structural (`dedupe_key` + unique index) and
   repaired the duplicates that existed (3 configs / 63 occurrences → 2 / 33).
7. **A customer photo rendered as an initial** in the follow-up list because
   `GeneratedReminder` did not carry the image.
8. **Company Details had no Add Product, Edit or Remove.** Added; Remove is a gated soft
   archive (0142) that refuses while the supplier is still owed money.

### Verified

- Purchase → Inventory → Sale → COGS → Profit driven through the real RPCs as the real
  owner: **21/21 assertions**, including that purchase 1 keeps cost 700 after purchase 2 at
  900, that stock goes 100 → 150 → 140, that the sale uses the current selling price
  (1200) with COGS from the actual cost (9,000) and profit 3,000, and that later price
  changes rewrite neither past purchases nor past sales.
- UI + database + fresh read for every fix above; EN/LTR and UR/RTL.
- `vitest` **432/432 across 38 files**, `tsc` clean, production build clean.
- QA baseline clean: every business table 0, four fixture accounts kept.
- **Decision left with the owner:** a purchase records its own cost but does NOT update the
  variant's cost basis, so COGS uses the cost the owner set on the product screen. Both
  readings of “the actual inventory cost” are defensible; changing it moves COGS and profit,
  so it was not decided silently.

## Stage: waiting-state coverage — no list jumps from nothing to content (2026-09-23)

The screens had a loading story, but only on the screens someone had already fixed. Everywhere
else a list read from a store that had not loaded yet, and the first thing it printed was its
verdict: “No sales recorded”, “No products found”, “No companies yet.” — a false statement
about data still in flight — then it jumped when the rows landed. Three detail screens rendered
nothing at all, and one history screen showed a lone spinner where its own shape belonged.

### What was actually broken

1. **Fabricated reminder history.** `ReminderHistoryPage` wrote two invented reminder entries
   (`mock-1`, `mock-2`) into `localStorage` whenever a customer had none, then displayed them
   as if they had been sent. A shop owner reading a customer's reminder history saw messages
   that never existed. The seed is deleted; an empty history now stays empty.
2. **A hook-order crash, introduced and caught in this pass.** Writing the readiness gate as
   `useA(...) && useB(...)` short-circuits, so the second hook is not called while the first
   store is loading — React then sees a different hook order and `/admin/activity` died with
   `Cannot read properties of undefined (reading 'length')`. All nine sites now make each
   store read its own unconditional call and combine only the booleans.
3. **Empty verdicts before data.** 23 screens/components gated and given a shaped placeholder;
   three detail screens (product, customer profile, variant picker) stopped rendering a blank
   page while their store was still loading, and payment history's spinner became the card
   skeleton.

### Verified

- New lane `tests/e2e/skeletonCoverage.spec.ts`: 11 routes opened with **every** `/rest/v1`
  read held, each **cold-started with its cache cleared**, asserting a `.ds-skeleton` is on
  screen, that the shape sits inside the grouped card at the real 46–64pt row band and
  shimmers, and that the screen does **not** print its empty-state sentence during that
  window; then the hold is released and the placeholders must settle into real rows. 2/2,
  including the customer picker inside the group-reminder sheet.
- New unit guard `tests/unit/skeletonCoverageGuard.test.ts` (36 assertions): every fetching
  list must still carry both halves — its own gate and a placeholder — with the fabricated-
  reminder seed asserted absent. Proved non-vacuous by deleting one gate and watching it fail.
- Full Playwright **112/112 in one clean pass (26.6m)**; after the final picker change, the
  sheet/overlay/RTL/design/microcopy lanes re-run **43/43**.
- `vitest` **495/495 across 44 files**, `tsc` clean, production build clean.
- QA counted independently through `run_sql` (table list taken from the database, not
  hardcoded): **0 shop business rows**, 4 fixture accounts, 4 memberships.

### Still open (named, not carried silently)

- `RemindersOverviewPage`'s reminder feed derives from three stores plus local reminder logs,
  so its empty-state decision needs its own shape rather than a copy of a list gate.
- `SearchPage` is query-driven — nothing fetches at mount, so there is no empty screen to
  shape (checked, deliberately unchanged).
- `SuperAdminDashboard` (shop requests) is not gated; it is not on the shop owner's path.
- `index.html` declares header-only security directives (`X-Frame-Options`,
  `X-Content-Type-Options`) as `<meta>`, so the browser ignores them and logs a warning on
  every load. Named in the lane rather than swallowed.

## Stage: browser lane closure — the reds resolved, one real app regression, every lane run (2026-10-02)

The four red browser tests are closed, the lanes that had never been executed have been executed,
and one genuine app regression was found by them. Detail and per-run logs: `PHASE_2_BROWSER_SAFETY.md`
§10–§16. QA only (`bpybjrjenwccowvtrevu`); production untouched.

### What was actually broken

1. **A real app regression: hooks below an early return.** `EmployeeDetailPage` declared
   `loginFixing`/`loginFixed` after `if (!emp) return (…)`. Any deep link to an employee page
   crashed with React's "Rendered more hooks than during the previous render" once the store
   loaded — the page only worked when the employee was already in the store. Hooks moved to the
   top of the component; `overlayRtl` 2/2 and `employeeStatusSafety` 3/3 went green on the next run.
2. **The employee door asks two questions.** The sign-in tab refuses a number typed on the other
   tab, and the employee tab additionally requires the **shop code** (`shop-id-input`, migration
   0169). That one fact explained 27 batch-6 `waitForURL` timeouts: a code is never sent until the
   shop is named. `loginViaUi` now takes the side and the shop; employee-side lanes pass.
3. **Stale test fixtures/selectors, never a weakened assertion.** The invitation hint moved to
   `auth.invitedToShop`; deletion became a 4-step `DeleteTargetSheet`; the product form became one
   card per pack (`product-pack-*`); the role editor's delete became its own row; the supplier
   picker deliberately has no close button; `accessUx` pinned a seeding uuid that no longer exists
   (now resolved from the phone in `beforeAll`).

### Verified

- `imageSync` + `actionCenter` **22/22** (6.1m) — the two lanes that had never been run.
- `dashboardScope` **6/6**, `setupCompletion` **5/5**, `dependencyContinuity` **4/4**, `education`
  **9/9**, `accessUx` **7/7**, `roleDeleteSafety` PASS, batch 10 44 passed / 9 failed **all triaged**.
- New browser proof for retry-after-timeout: `tests/e2e/retryAfterTimeout.spec.ts` — first
  `create_sale` answered with a 504, the retry carries the **same** `idempotencyKey`, and the
  database ends with one sale, one line, one submission row, stock 99, `total_purchases` 80500.
- Playwright's own webServer spawn verified (manual `vite` killed; `[WebServer]` boot lines seen).
- Harness defects fixed at the test layer: `dependencyContinuity`'s cleanup deleted parents before
  children, so its FK error was swallowed and its "empty shop" premise was never true — now
  children first and the empty catalogue is asserted; `setupCompletion` compares the count's
  numbers rather than one copy string.
- `tsc` 0 · `npm run build` clean · `migrate:verify` PASS (169 ↔ 169, hashes match) · `vitest`
  (`backups/final-vitest.log`) · QA cleaned and re-counted independently after the runs.

### Still open (named, not carried silently)

- The batch-6 `education` console 404 did not reproduce on the clean lane run (9/9, console clean);
  the assertion now prints the failing URL so the next occurrence is diagnosable.
- `<meta>`-declared security headers remain ignored by the browser (as above); unchanged here.
- No APK was built; the release path stays `.github/workflows/build-apk.yml` at the release gate.

---

## Stage: whole-app completion gate — evidence matrix, one proven cross-tenant leak, two shell fixes (2026-10-02)

The gate was driven by an **evidence matrix** rather than by habit: every already-green area was
marked REUSED with the log that proves it, and only materially different contexts were run. The
matrix, the per-lane invalidation and the raw logs live in `PHASE_2_BROWSER_SAFETY.md` §17.
QA only (`bpybjrjenwccowvtrevu`); production untouched.

### Permanent rule — evidence is reusable

> **Evidence is reusable.** A test is required only when its purpose, context, risk,
> implementation, dependency, expected behaviour, or covered layer is materially different, or
> when relevant code, data, configuration, or environment has changed. If the same behaviour has
> already been tested and proven and nothing relevant has changed, reuse the existing evidence
> instead of repeating the test. Every future agent must review existing evidence and dependency
> impact before starting a new verification run.

This is now executable, not prose: `node backups/gap-check.mjs` reads `scripts/dev/lane-map.json`,
finds each lane's newest green log in `backups/`, and compares it with the newest mtime of every
file that lane's globs cover. It prints `REUSE` or `RERUN` per lane with the file that invalidated
it. 22 of 28 lanes came back REUSE on the first pass; the 6 that did not (all invalidated by
`src/index.css`, which every visual lane maps) were the only browser work started.

### What was actually broken

1. **A real cross-tenant leak on `product_variants` — read, write and cost data.** The table was
   the only business table with a literal `USING (true)` SELECT policy and has no `shop_id`
   column, so the tenant boundary was one join away on `products.shop_id` and nothing enforced it.
   Proven through the real JWT → PostgREST → RLS path with two tenants
   (`tests/integration/variantIsolation.test.ts`): an admin of shop A read shop B's variant and its
   `cost_price`; **UPDATEd shop B's `stock_qty` 100 → 1 and `selling_price` 700 → 1**, both
   committed; and INSERTed a variant onto shop B's product. The UI never showed it because the
   app filters its own reads — which is exactly why the boundary has to be the policy.
   Fixed by **0178** (all three policies scoped to the owning shop; `USING` sees the old row and
   `WITH CHECK` the new, so a row cannot be moved between tenants) and **0179** (see 2).
2. **`product_variants_public` did not exist in either environment.** `0015_flexible_units.sql`
   created it ("no cost_price for employees"), the ledger records 0015 as applied, and the table
   and index it adds are present — only the view is absent (the staging dump has zero occurrences;
   production carries one). So the non-admin branch of `productsStore` has never read the view it
   names, and `cost_price` had no redaction at all. **0179** restores the projection without
   `cost_price`, scoped to the caller's shop (a view runs with its owner's rights, so its `WHERE`
   is the enforcement — stated in the file), and narrows the base table to the owning shop's
   admins.
3. **Two real UI defects, found by the lanes the invalidation flagged.** The admin/employee tab
   bars rendered 41px tall, so the accessibility lane's frozen structural baseline refused the
   assistant tab (44 → 55 undersized targets). Fixed in the shell, not the baseline: every tab now
   carries `min-h-[44px]`, and `smallTarget` is pinned at **0** — the gap is gone, not recorded.
   And `adminMicrocopy` pinned an Urdu literal (`اپنے 6 نمبر لکھیں`) that the plain-language pass
   replaced; the code screen rendered correct Urdu throughout. The assertion now reads the shipped
   `auth.verifyOtp` + `auth.enterCode` pair and asserts English is absent, so it can no longer
   pass against a screen that reverted to English.

### Verified

- `accessibility` 3/3 · `adminMicrocopy` 4/4 · `overlayRtl` 2/2 · `actionCenter` 12/12 ·
  `education` 9/9 · `logicalDirection` 3/3 · `crossScreenSync` 13/13 · `retryAfterTimeout` 1/1 ·
  `rtlLtr` 16/16 — **64 passed, 0 failed** (`backups/gate-gap2.log`), which is the complete set the
  shell changes invalidated.
- `variantIsolation` **8/8** (`tests/integration/variantIsolation.test.ts`), the suite written to
  settle the leak; 5 of its 8 assertions were red before 0178/0179 and none were weakened after.
- 0178 and 0179 both replay cleanly onto the frozen staging baseline (`npm run verify:baseline`)
  and were applied to QA through the ledger (`npm run migrate:apply --env staging --apply`),
  each recorded in the same transaction.
- Read-only schema probes recorded as evidence: zero tables without RLS, zero `anon` grants on
  business tables, zero orphan rows across eight parent/child pairs, exactly the four fixture
  accounts. Four permissive-`true` policies were found in total — the variants one is fixed here;
  `app_settings_select` and `permissions_select` are reference data, and `audit_events_insert` is
  the insert half of an append-only log and is the next thing to look at, named rather than
  silently accepted.

### Still open (named, not carried silently)

- `audit_events_insert` is `WITH CHECK (true)`: any authenticated session may write an audit row
  with any `user_id`/`shop_id`. It is an append-only table, so the damage is forged history rather
  than lost data, but it is a real gap and is not covered by 0178/0179.
- The batch-6 `education` console 404 still has not reproduced (the lane prints the URL if it
  returns). `<meta>`-declared security headers remain ignored by the browser, unchanged.
- No APK was built; the release path stays `.github/workflows/build-apk.yml` at the release gate.

### 0180 — the leak was a class, and the sweep found the rest of it

`0178` was found by asking the live catalog one question: *which policies are reachable by an
authenticated session but never constrain the row to the caller's shop?* After fixing the
variants table the same question was asked of everything else. Two more tables were in that
shape, and both are money-adjacent:

| Table | Policies found | Reproduced | Fixed |
|---|---|---|---|
| `stock_adjustments` | INSERT `app_is_admin()`; SELECT `app_is_admin()` **OR** branch-scope (which had no shop predicate either, so a caller with no branch scope matched every shop) | tenant A's admin read tenant B's adjustment row — 1 row returned | 0180: shop scope on SELECT and INSERT; the branch policy is replaced, not kept |
| `cash_reconciliations` | INSERT `app_is_admin()`; SELECT `app_is_admin()` | same cross-tenant read, 1 row returned | 0180 |

Measured and left alone, with the reason recorded: `notifications` scopes through
`my_shop_ids()`; `app_settings` and `permissions` are reference data with no `shop_id`;
`sale_submissions` denies clients outright; `user_permissions` INSERT/DELETE are refused by RLS
in the cross-tenant case. The sweep suite asserts all four states, so a policy that loses its
boundary later fails a test instead of waiting for an audit. New coverage:
`tests/integration/tenantBoundarySweep.test.ts` (4 cases) alongside
`tests/integration/variantIsolation.test.ts` (8 cases).

**A second permanent guard, because the same harness defect happened twice.** Two new suites
collided with existing fixtures on *phone numbers* (`branchScopeEnforcement` owns
`923009790001`–`3`), and the symptom was a whole file failing to start with
`duplicate key value violates unique constraint "users_phone_key"` — which reads like
infrastructure, not like a fixture collision. `fixtureIdCollision` already checked UUIDs; it now
checks phone literals too, with the four seeded accounts and the three seeded customers listed
as shared-on-purpose. Proven non-vacuous: it caught the two collisions that had just cost a run.

### Gate numbers (final, QA only)

- `npx tsc --noEmit` → clean.
- `npx vitest run` → **80 files / 867 tests, 0 failed** (`backups/final-vitest2.log`), up from
  78/854 at the start of the gate.
- Browser lanes: `gate-gap2.log` **64 passed / 0 failed** (the full invalidated set),
  `gate-lanes.log` **45 passed / 0 failed** (employee product paths after 0179),
  `gate-lanes2.log` **13 passed / 0 failed** (the screens that read the 0180 tables).
- `npm run build` → success (`backups/gate-build.log`).
- `npm run migrate:verify` → **172 files ↔ 172 ledger rows, every hash matches**.
- `npm run verify:baseline -- --baseline staging --since 0178|0179|0180` → PASS for all three.
- QA restored and independently re-counted: **0 business rows** in every business table, exactly
  the four fixture accounts (all active), 4 memberships, 0 `shop_requests`, 0 leftover sales /
  payments / returns / adjustments / reconciliations / products / variants.
- Production untouched throughout: no query against it, no migration, no backup write.

### WHOLE APP COMPLETION: PASS

Every requirement area in `PHASE_2_BROWSER_SAFETY.md` §17 is PASS, REUSED with the log that
proves it, FIXED + VERIFIED, or named as remaining uncertainty. Nothing is UNKNOWN, and no
UNKNOWN was converted into a pass. The one item carried forward as genuinely unfixed is
`audit_events_insert` (`WITH CHECK (true)`), documented with its exact condition and impact.

Release has not been authorized and no APK was built; the release path remains
`.github/workflows/build-apk.yml` when it is.

---

### 0181 — audit rows are written by the system, not by the caller (the carried-forward gap)

The whole-app gate carried one named item: `audit_events_insert` was `WITH CHECK (true)`.
Its SELECT policy was `app_is_admin()` — a role check with no shop predicate, on a table with
no `shop_id` column at all. Both were investigated before anything was changed.

**What is true, measured on QA** (`backups/audit-probe3.mjs`, read-only):

- `audit_events` columns are `id, user_id, action, entity_type, entity_id, details,
  ip_address, created_at`. No `shop_id`; attribution is `user_id → users.shop_id`. No triggers.
- The forgery was **NOT reachable from a client** at the moment it was found, and that is stated
  exactly rather than dramatised: `authenticated` and `anon` hold **no INSERT privilege** on the
  table, so PostgREST refuses the write at the grant layer before RLS is consulted. The policy was
  the one remaining gate that would still have said yes — a *latent* hole, reopened by a single
  future `grant insert`. A boundary that depends on a privilege nobody looks at is not a boundary.
- The SELECT side **was live**: an admin of shop A read shop B's audit row — 1 row returned through
  the real JWT path.
- The trusted writers are intact: ~34 SECURITY DEFINER RPCs with `search_path=public`
  (`void_sale`, `process_return`, `adjust_stock`, `delete_role`, `record_customer_payment`,
  `create_purchase`, `create_employee`, …) insert their audit row in the same transaction as the
  business change, with attribution they derive from the session. No app screen reads the table
  (zero matches in `src/`).

**Fix — `0181_audit_rows_are_written_by_the_system_not_by_the_caller.sql`** (forward-only,
applied to QA through the ledger): drops the permissive INSERT policy and replaces it with
`audit_events_no_client_writes` (`WITH CHECK (false)` — both gates must say no), and scopes
SELECT to `app_is_admin() AND (user_id IS NULL OR actor's shop = current_shop_id())`. The
NULL-actor carve-out keeps pre-account history (registration / provisioning) visible to a shop's
admin, and the FK is `ON DELETE NO ACTION`, so a NULL never means "the actor went away".
Self-proof DO block inside the migration raises if any permissive INSERT or shop-less SELECT
policy remains.

**Evidence.**

- `supabase/migrations/0181_…`: `verify:baseline --baseline staging --since 0181` → PASS
  (6 statements, 0 failures); applied via the ledger.
- `tests/integration/auditIntegrity.test.ts` (6 tests): **4 failed → 6/6 passed**. It asserts the
  boundary, not one mechanism: the client insert must be refused (by RLS, by privilege, or both)
  *and* the catalog must contain no permissive INSERT policy, so a later grant cannot reopen it.
- Regression chain (`backups/gate-chain4.log`): vitest over the 9 affected suites
  (`auditIntegrity + variantIsolation + tenantBoundarySweep + financialIntegrity +
  inventoryIntegrity + destructiveSafety + securityAudit + employeeAccessOverrides +
  rbacEnforcement`) → **9 files / 116 tests, 0 failed** (`gate-vitest3.log`); lanes
  `voidSaleSafety + adminFullAccess + employeeStatusSafety` → **8 passed** (`gate-lanes3.log`),
  which exercise the RPC writers through real UI flows; `migrate:verify` → **173 files ↔ 173
  rows**; `tsc --noEmit` → clean.
- QA cleaned and independently re-counted → 0 business rows; the four fixture accounts, all
  active. Production untouched: no query, no migration, no write.

Status upgrade from the gate text above: the audited item is **closed, not carried**. A migration
change here re-ran only what 0181 can affect (RPC writers via UI, history/tenant suites) — the
earlier whole-app evidence (64+45+13 lane greens, 867-test vitest, build) was reused, not rerun,
because none of its files or dependencies changed.

### 0182 — a shop's settings belong to that shop (found by re-probing after 0181)

After 0181, the 0178/0180 question was asked one more time of the live catalog: *which policies
are reachable by an authenticated session but do not constrain the row to the caller's shop?*
`app_settings` was the answer.

**Correction to the record.** The §0180 stage above called `app_settings` "reference data with
no `shop_id`". That was wrong, and it was never measured — the misclassification is exactly why
the 0180 sweep did not test it. Measured: `app_settings` has a `shop_id` column, a unique
`(shop_id, setting_key)` constraint and an FK to `shops`; it holds the owner's stock-alert
threshold and frequency plus `void_window_hours`, `expiry_warning_days` and
`credit_limit_override_policy`, per shop. This section supersedes that sentence.

**The leak, as found.** `app_settings_select` was `USING (true)`; `app_settings_insert` was
`WITH CHECK (app_is_admin())` and `app_settings_update` was bare `app_is_admin()` — the 0180
shape, on a per-shop table. All three were reachable by `authenticated` with RLS enabled, over
PostgREST.

**Why the client path can be closed without losing anything.** All three functions that touch
the table are SECURITY DEFINER with `search_path` pinned (measured with `prosrc`/`prosecdef`):
`get_stock_alert_settings` (reader, authorizes `products.view`), `set_stock_alert_settings`
(writer, authorizes `products.edit`, derives shop and actor via `resolve_shop_and_actor`), and
`void_sale_v1` (reads the void window for the sale's own shop). No screen reads the table
directly — zero `.from('app_settings')` matches in `src/`. Definer rights bypass the narrowed
policies, so no legitimate read or write is on the closed path.

**Reproduction (red before the fix).** `tests/integration/appSettingsIsolation.test.ts`, real
JWT → PostgREST → RLS, two tenants (`backups/appsettings-red.log`): **5 failed / 4 passed** —

| Probe as shop A | Result before 0182 |
|---|---|
| admin reads shop B's setting | 1 row returned |
| employee reads shop B's setting | 1 row returned |
| admin updates shop B's setting | row matched, value '77' → rewritten |
| admin inserts a row tagged `shop_id = B` | row written |
| catalog posture | `app_settings_select` still `USING (true)` |

**Fix — `0182_settings_belong_to_their_shop.sql`** (forward-only, applied to QA through the
ledger): all three policies scoped to `shop_id = current_shop_id()` (writes additionally require
`app_is_admin()`), with a comment on each, and a self-proof DO block that raises if any policy on
the table lacks a shop predicate or is again the literal `true`. `permissions` is untouched —
it is global reference data with no `shop_id`, which is now the only permissive-true policy left
in the schema and is correct there.

**Evidence.**

- `verify:baseline --baseline staging --since 0181` → PASS (0182: 10 statements, 0 failures).
- Applied via the ledger → `migrate:verify` **174 files ↔ 174 rows, every hash matches**.
- Same suite after: **9/9 passed** (`appsettings-green2.log`), including the two tests that prove
  the legitimate path survived: the DEFINER `set_stock_alert_settings`/`get_stock_alert_settings`
  pair still writes and reads for both admin and employee, the shop's own people still read the
  table, and an employee still cannot write it.
- **Permanent class guard** — `tests/integration/shopScopedPolicyGuard.test.ts`: no policy with a
  literal-`true` predicate may sit on a table that has a `shop_id` column, and no INSERT policy
  anywhere may be permissive-`true` (the 0181 shape). 2/2 green, and proven **non-vacuous** by
  injecting a throwaway table with a `USING (true)` policy and watching the same predicate surface
  it — probe table dropped immediately.
- Fixture discipline: the collision guard caught the first draft reusing shop `…d0d0`, which
  `variantIsolation` already owns; the suite moved to `…a0a0` and the guard is green.
- Targeted regression: `financialIntegrity` **19/19** (its void path is `void_sale_v1`, which
  reads `app_settings`) + `fixtureIdCollision` 2/2 + `tsc --noEmit` clean.
- Final catalog snapshot (`backups/audit-probe5.log`): **0** permissive-true INSERT policies;
  `audit_events` = `no_client_writes(false)` + shop-scoped SELECT with client write privileges off;
  the only permissive-true policy left is `permissions_select` (no `shop_id`, correct); zero
  permissive INSERT policies on any history-sensitive table; all definer audit writers intact.

**Evidence-reuse decision.** No browser lane was re-run for 0182: no file under `src/**` changed,
lane invalidation is glob-based (`scripts/dev/lane-map.json`), and the settings path the UI uses
is the RPC pair the new suite exercises directly against the real database. Re-running RTL/copy
lanes for a policy predicate would have produced green counts, not new evidence.

**QA cleanup.** `npm run qa:clean` removed 45 rows across the suites' leftovers; then an
independent recount (`backups/final-recount-0182.log`) — **0 rows in every business table
including `app_settings`**, exactly 1 shop (Default Shop), 4 auth users, the 4 fixture accounts
all active, 0 stray `QA …` shops or audit rows, 0 `d7-`/`d4000000-`/`d5000000-`/`d6000000-`
leftovers. Production untouched: no query, no migration, no write.

### WHOLE APP + SECURITY: PASS

Both carried/named security gaps are now closed the same way — reproduce on QA with a real JWT →
smallest forward-only migration → red-to-green suite → permanent guard → ledger + baseline
verification → cleanup with an independent recount:

| Gap | Reachability when found | Closed by | Guard |
|---|---|---|---|
| `audit_events_insert` `WITH CHECK (true)` | latent (no client INSERT privilege) | 0181 | `auditIntegrity` + INSERT-policy catalog guard |
| `audit_events_select` shop-blind | **live** — cross-tenant read reproduced | 0181 | same suite |
| `app_settings` broad read + shop-blind writes | **live** — reads and writes reproduced across tenants | 0182 | `appSettingsIsolation` + `shopScopedPolicyGuard` |

No permissive-true policy remains on any table with a `shop_id`; no INSERT policy anywhere
accepts whatever the caller sends; the only permissive policy left is on global reference data.
Every claim above cites a log under `backups/`. Nothing was downgraded from FAIL or converted
from UNKNOWN.

Remaining named uncertainties (unchanged, unrelated to security gates): the batch-6 `education`
console 404 still has not reproduced (the lane prints the URL if it returns), and the
`<meta>`-declared security headers in `index.html` are still ignored by the browser — a
pre-existing deployment-layer matter, not a policy. Release has still not been authorized and no
APK was built; the release path remains `.github/workflows/build-apk.yml` when it is.

**Committed:** `a9e2d413` — *fix(security): close audit and settings tenant isolation gaps*
(7 files, +910). Staged as an isolated patch: the two migrations, `auditIntegrity`,
`appSettingsIsolation`, `shopScopedPolicyGuard`, the `updateAsUser` QA helper, and this security
section only. Re-verified immediately before committing: **17/17** (6 + 9 + 2) against QA; QA left
at 0 business rows after `npm run qa:clean` with an independent re-count. `main` is now 2 commits
ahead of `origin/main`; nothing was pushed. The 0180 sweep's files (`tenantBoundarySweep`,
`variantIsolation`, the `fixtureIdCollision` phone guard) and the browser-lane closure stage remain
uncommitted and untouched.

---

## §18 — MVP feature registry, dependency map and change-impact system

**Question this stage had to answer permanently:** what exists, what depends on it, what could be
affected by a change, and what evidence shows the affected behaviour is still safe?

### Inspection first (what already existed and was reused)

| Existing authority | Role |
|---|---|
| `SCREEN-INDEX.md` (generated) | route → component → file → covering lanes |
| `dependency_graph.json` + `scripts/scan-frontend-deps.cjs` | file → tables / RPCs / stores / layers |
| `scripts/dev/lane-map.json` + `scripts/dev/verify.mjs` | tier computation, byte-identical lane skipping, canonical lanes |
| `0077/0078_*impact_intelligence*.sql` + `tests/integration/*Impact*.test.ts` | DB-side impact analysis (`analyze_table_impact`, `analyze_function_impact`, `load_dependency_graph`) |
| `PHASE_2_BROWSER_SAFETY.md` §17 (+ addendum) | the frozen evidence matrix and the 0181/0182 corrections |
| `AGENTS.md` §4 impact map, §7 speed path; per-feature checklist | the shorter workflow this stage extends |

Missing: a feature-level registry, a single evidence vocabulary, a permanent 13-step workflow with
automatic entry, and a guard keeping all of it true. Those were added — nothing above was
rebuilt.

### Added (smallest permanent version)

- `FEATURE-MAP.md` — registry summary (26 capabilities), dependency chains + reverse dependencies,
the 13-step change-impact workflow, the six evidence statuses, reuse/invalidation rules, the
"new or modified feature enters automatically" rule, the 11 source-of-truth pointers, MVP scope
protection, and the worked example below.
- `feature-registry.json` — machine-readable records (screens, components, state, libs, tables,
RPCs, permissions, rules, `dependsOn`/`dependedBy`, tests, evidence, last verified, risks).
- `tests/unit/featureRegistryGuard.test.ts` — 14 assertions against the real authorities: router
paths, `requires="…"` keys, files on disk, dependency graph + migrations, symmetric edges,
evidence vocabulary, and the workflow document itself.
- `AGENTS.md` §8 (permanent workflow + auto-entry), `ARCHITECTURE.md` pointer and stale counts
fixed (139 → 174 migrations, 23 → 28 specs), `package.json` `registry:build` repointed off the
orphaned `changes/registry-sync.mjs`, `src/lib/dependencyGraph.ts` header now points at the map.

### Guard is non-vacuous (proved)

Injected `notifications.vieX` into the registry → guard FAILED with
`reminders names permission "notifications.vieX" which no route requires` → restored →
45 unit files / 472 tests green, including the guard's 14.

### Controlled example change (the workflow, not the plan)

Change: pointer comment in `src/lib/dependencyGraph.ts` (comment only — no behaviour, no schema,
no permission, no user-facing copy). Impact map: feature = entity-creation dependency continuity;
direct deps `src/lib/setupStatus.ts` + checklist surfaces; reverse deps dashboard/setup flow;
no DB/RPC/permission change; EN/LTR + UR/RTL not touched. Mechanically affected lanes:
`dependencyContinuity` and `setupCompletion` (their globs name the file), `crossScreenSync`
(`src/**`), plus the unmapped `rtlLtr` and `retryAfterTimeout` (default globs) — exactly five.
Targeted verification run: `npx tsc --noEmit` clean; `npx vitest run tests/unit/` 45 files / 472
tests green; the five lanes → `backups/example-change-lanes.log`: **40 passed (10.9m), EXIT:0**
(EnGuard printed `Environment verified: bpybjrjenwccowvtrevu` for every worker).
Security evidence from §17 remains **VALID** (nothing it covers changed); no full-suite rerun was
performed for documentation. `npm run verify:plan` currently computes Tier 2 because the working
tree is 390 files away from HEAD (uncommitted migrations, workflows and other threads' files) —
that is a pre-existing pending state, not this stage; it is recorded here rather than hidden.

Evidence for this stage: `backups/example-change-lanes.log`, the guard runs above, and the files
listed. QA left clean after the run: lane data produced 1 `notifications` row, removed by
`npm run qa:clean`, independent re-count **0 business rows**. Production untouched; no release
attempted; no APK built.

**Committed:** `c1c893a3` — *feat(engineering-os): add feature registry and change-impact system*
(8 files, +1252/−4). The commit deliberately carries only this §18 section of this file and only
the `registry:build` hunk of `package.json`; the earlier uncommitted stages, the pending
`package.json` script additions and every other thread's changes remain in the working tree.
`main` is ahead of `origin/main` by this one commit; nothing was pushed.

---

## Stage: staging/QA APK path — source published, three CI blockers cleared, one open (2026-10-02)

Moving from MVP closure to staging. Source published: `4e57d50f..b3fbda09` on `origin/main`
(three commits: `c1c893a3` §18 registry, `a9e2d413` 0181/0182 security, `b3fbda09` the CI env fix
below). Production untouched; the workflow references QA secrets only.

### Blockers found, in order

1. **GitHub Actions would not start any job (external).** Runs 36782862355 and 36782310591 (and the
   scheduled backups) failed with the annotation: *"The job was not started because recent account
   payments have failed or your spending limit needs to be increased."* Jobs started again once
   that account state changed; it was never a repository defect.
2. **The APK build had no environment (repository defect, fixed in `b3fbda09`).** `npm run build`
   ran with no env while `vite.config.ts` refuses to build without an explicit `VITE_APP_ENV` and
   `src/lib/envGuard.ts` refuses to start without it. Both app-touching steps now carry: staging,
   project `bpybjrjenwccowvtrevu`, demo OTP, QA secrets only. Proved locally with the workflow's
   exact env: `[EnvGuard] building STAGING → bpybjrjenwccowvtrevu (otp: demo, key verified)`,
   build exit 0.
3. **`QA_DB_HOST` did not resolve on the runner (CI secret defect, fixed).** Run 37050426260 failed
   the reachability gate with `ENOTFOUND`. The local `.env.qa` values were proven against QA
   (pooler host `aws-0-ap-northeast-1.pooler.supabase.com`, user `postgres.<ref>`; A record present;
   actual `select 1` OK) and the three QA_DB secrets were set from those proven values. Run
   37051191071 then passed "Verify QA Database Reachability".
4. **Android signing secrets are absent (external, open).** `gh secret list` contains no
   `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
   `ANDROID_KEY_PASSWORD`, and the build job's "Decode release keystore" step exits 1 when the
   base64 secret is unset. Until those four secrets exist (see `.github/inject-signing.cjs`), no
   APK can be produced by `build-apk.yml` — an account/secret prerequisite, not code.

### Runs

| Run | Trigger | Result |
|---|---|---|
| 37050426260 | push `b3fbda09` | failed at QA reachability (`ENOTFOUND`); the APK job never started |
| 37051191071 | `workflow_dispatch` | connectivity gate ✓; vitest 63/67 files green in parallel — three files failed on shared-fixture races (below); the APK job never started |
| 37053824025 | push `f6672a34` | unit parallel + integration serial; outcome pending |

### Test-job races: analysed, not hand-waved (commits `115255c6`, `f6672a34`)

Run 37051191071's vitest step failed 4/67 files. One was a real §18 defect and three were races:

* `tests/unit/featureRegistryGuard.test.ts` — `ENOENT dependency_graph.json`: the guard validated
  against a generated file that was never committed, so only a clean checkout could expose it.
  Fixed in `115255c6`: the graph (31 tables / 22 RPCs, regenerated) is now committed like
  `SCREEN-INDEX.md`, and `npm run registry:build` refreshes the graph, the index and the guard.
* `splitPayments`, `priceTraceability`, `tenantResolverReplay` — each **passed in isolation**, passed
  again after a full clean, and the whole integration folder (39 files) passed locally under two
  workers (`backups/ci-parity-2workers.log`, EXIT:0). The CI log also shows the QA environment was
  correct (`[EnvGuard] Environment verified: bpybjrjenwccowvtrevu` ×30), so the reds were
  shared-fixture races on the 2-core runner: concurrent files mutate the shared users' active shop
  and permission rows, and one file introspects `pg_proc` while others work. Fixed in `f6672a34`:
  unit tests stay parallel, the integration folder runs one file at a time against the one QA
  database — the same serialisation the E2E lanes already use for the same reason.
* Run 37053824025's unit step then failed the registry guard in the clean checkout: it referenced
  `src/lib/entryDoor.ts`, `src/lib/phoneInput.ts` and thirteen test files, the `assistant` route and
  `product_barcodes`/`sale_submissions` — all present in the working tree, none committed. A
  registry that describes one developer's tree is not a source of truth. Fixed in `ca1e0c2b` by
  removing the uncommitted references (not by relaxing the guard), with the pending assistant
  console recorded as a risk. Proved by the guard locally (14/14) **and** by a parity check against
  HEAD (tracked files, committed router, committed graph, committed migrations): clean.

### The capture gap, and the snapshot branch (2026-10-02, user-authorised)

Runs 37053824025 and 37055186570 kept failing in CI in files that pass locally. Root cause, proven
by reading the committed versions: CI builds the **committed** source, which was an older app than
the verified one — 13 migrations (0170–0180 plus the 0042/0060 renames) untracked, 63 `src/` and
36 `tests/` files modified. The committed `tenantResolverReplay` still asserts
equal(['resolve_active_shop']) and the committed `splitPayments` has no fixture-permission setup,
so both fail against the current QA database no matter how the runner is configured.

Decision (user): snapshot the verified working tree on a dedicated branch rather than bulk-commit
to `main`. `staging-snapshot` = `2f5912d9` (149 files captured; `.freebuff` logs excluded) and
`eb2395f4` (`.gitattributes`). `main` keeps only the isolated §18, security and CI commits.

### The ledger mismatch the snapshot exposed

Run 37057360411 failed `migrate verify`: nine applied files (0009–0017) “changed after it was
applied”. Cause: `core.autocrlf=true` on this Windows checkout produced CRLF bytes, the ledger
recorded hashes of those CRLF bytes, and a clean Linux checkout has LF. Fixed with the tool's own
guard, not by loosening the check: `.gitattributes` pins `supabase/migrations/*.sql` to `eol=lf`,
the working tree was re-materialised as LF, and the nine entries were reconciled with
`reconcile --apply --reason "line endings normalised to LF; statements unchanged"` — the tool
compared statements ignoring comments/whitespace, found them identical, and recorded
`reconciled_at`/`reconcile_note`. Result: **174 files ↔ 174 rows, every hash matches, directory
and ledger agree exactly**.

### Runs 37058491355 → 37076349097: every test-side blocker reproduced, fixed, re-proven

Each defect below was reproduced locally, fixed at the layer that owned it, and re-run in CI:

- **37058491355** — unit tests: 9 files red. The vitest steps ran without `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_PROJECT_ID`, so every module that resolves its
  environment at import time refused (`[CONFIG] Neither VITE_SUPABASE_URL nor …`), and
  `authSafetyGuard` read a refused configuration as "sms". Reproduced by clearing those three
  names locally (9/9 files red, same errors); fixed by giving the test job the three names (9/9
  files, 82 tests green locally).
- **37060217062** — unit tests: 8 files red with `Invalid supabaseUrl`. `QA_SUPABASE_URL` was set
  on 2026-09-12 carrying the bracket decoration this repository's older tools stripped
  (`[https://…]`); `src/lib/supabase.ts` trims but does not strip decorations, so the value never
  matched `^https?://`. Fixed by re-setting the QA secret from the verified `.env.qa` value
  (40 chars, `https://bpybjrjenwccowvtrevu.supabase.co`).
- **37061131859** — integration: exactly one file red, `assistantPermission.test.ts`, with
  `ENOENT … .env.qa`. A CI checkout has no such file. The test now reads it only when it exists
  and takes credentials from the environment; `scripts/provision-auth-sessions.mjs` had the same
  unconditional read and was fixed the same way.
- **37062366661** — first run with unit and integration green; Playwright ran for the first time:
  **132/133 passed**. The one failure was real: the Urdu microcopy scan on `/admin/products` found
  the word “RPC” on screen — a product named `Perm Test Product RPC` created by the integration
  lane's admin `create_product` call and never cleaned up, because `cleanup()` matched only its own
  ids. Cleanup now deletes that product (and the employee's attempt) by name, in FK order.
- **37068142514** — 132/133 again; this time `dependencyContinuity` failed with “saving the product
  did not return to the sale” after a fixed 3.5s wait, although the same step returned in time in
  the previous run. The lane was failing for being early on a 2-core runner; both return steps now
  wait for the navigation with a 30s bound and keep their original assertion messages.
- **37072640900** — **test job green: unit 45/45 files (472 tests), integration 39/39 files (426
  tests), Playwright 133/133.** The build job then failed inside `android-actions/setup-android@v3`
  (“Warning: Failed to find package 'tools'”, exit 1) — a package removed from the SDK repository,
  so the action could not run at all. Replaced by locating the SDK `ubuntu-latest` already carries.
- **37076349097 (final)** — **Run Tests: success**: 472 unit tests, 426 integration tests,
  provisioning (9 already valid, 1 created, 0 failed), 133 E2E tests passed in 33.5m, cleanup step
  executed. **Build APK: the eight pre-signing steps all succeeded** — SDK located, platform 35 +
  build-tools 35.0.0 installed, staging web build (EnvGuard accepted), Capacitor platform added and
  synced, manifest entries injected — then **“Decode release keystore” failed**, exactly as
  predicted, with `ANDROID_KEYSTORE_BASE64 is not set — cannot release-sign.` No APK artifact
  exists.

Verdict for this stage: the pipeline up to the signing gate is **PROVEN** — test job green, build
job green through the manifest step, every step run against the QA project only (the production
project ref appears 0 times in the run log), and QA cleanup confirmed by an independent recount
(0 business rows). The signed-APK gate is **BLOCKED** on the owner's keystore secrets: no artifact,
therefore no install/startup/smoke run — BLOCKED, not skipped, and not replaced by a local build.

### Blocker 4 is now the only prerequisite left

Run 37076349097 confirmed it end to end: `gh secret list` has no `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` or `ANDROID_KEY_PASSWORD`, and the workflow's
“Decode release keystore” step exits 1 without the base64 secret — so no signed APK can be produced
until those four repository secrets exist (see `.github/inject-signing.cjs` for the exact names and
the keystore format). This is account-level owner action: the keystore must be the owner's, because
losing it breaks install-over-update.

Real-device installation/startup/smoke checks cannot begin until an APK artifact exists; they are
BLOCKED by the prerequisite above, not skipped.

---

## Stage: final staging gate — targeted RBAC, deleting an assigned role revokes access (0183), APK still blocked (2026-10-03)

Requirement change mid-stage: deleting a role that employees still hold must **succeed and revoke**,
not refuse as 0164 did. The owner confirmed the five-employee scenario — after deletion every
role-granted permission is gone, protected actions stay denied until a new role is assigned, and
history stays intact.

### 0183 — deleting a role revokes, from the database up

`supabase/migrations/0183_deleting_a_role_revokes_its_access.sql` replaces the refusal with
revocation: `delete_role` authorises `settings.edit`, resolves the role by tenant (404s
`ROLE_NOT_FOUND_OR_NOT_AUTHORIZED`), sets `memberships.role_id = NULL` for every holder in that
tenant (GET DIAGNOSTICS into `revokedFrom`), deletes the role, and writes one `role_deleted` audit
row carrying `{wasSystemRole, revokedFrom}`. The migration asserts the memberships→roles FK exists
before it can orphan anything. Applied to QA through `scripts/migrate.mjs` (4 statements,
recorded); `migrate:verify` 175↔175.

Why NULL and not a cascade: `get_effective_permissions` resolves employee access as
`role_permissions` joined through `memberships.role_id` UNION explicit overrides. A NULL role joins
nothing, so every role-granted permission disappears on the next RPC call — there is no permission
cache anywhere to go stale. `membership_in_active_shop` needs only `status='active'`, so identity,
branch scope and history stay intact.

### UI + language (EN/LTR and UR/RTL in the same change)

`RolesAccessPage` no longer disables the delete row — `deleteConsequence()` states what happens
instead: in the row, “{count} employees will lose this access.”; in the dialog, the full sentence
that they keep their account and their history and can be given another role at any time. Both
sentences exist in Urdu. The old `roles.deleteBlocked` copy is gone.

### Evidence

- `tests/integration/rbacRoleLifecycleTargeted.test.ts` (new, 11 tests): Owner creates a Manager
  role granting `sales.view/create/void` (row confirmed in `role_permissions`) → assigns it → the
  employee voids a real seeded sale (is_voided, stock restored, voids row, movement row) → an
  ungranted action is refused with `NOT_AUTHORIZED … products.delete` and writes nothing →
  revoking `sales.void` blocks the same call → re-granting through a new role allows it again.
  Deletion lifecycle: employee cannot delete the role; the owner deletes it (`revokedFrom == 1`); no
  orphan `role_permissions`/memberships; employee active with `role_id NULL`; voided history
  intact; revoked void refuses with nothing written; parallel double delete both refuse
  `ROLE_NOT_FOUND_OR_NOT_AUTHORIZED`; a deleted role cannot be assigned.
- `tests/e2e/roleInUseDeletion.spec.ts` (new, 2 tests, real browser + real QA database): row and
  dialog carry the revocation copy; delete succeeds and polls the database for role gone / holders
  zero / employees active with NULL role; the second test repeats the delete through direct
  PostgREST with the browser's own JWT — refused, role not recreated.
- `tests/integration/rbacLifecycleAndSessions.test.ts`: the three 0164 refusal tests replaced by
  five revocation tests.
- Regression: tsc clean; full vitest 85 files / 910 tests; sibling RBAC/audit/destructive suites
  85/85; `accessUx` 7/7; `adminFullAccess` + `adminMicrocopy` + `roleDeleteSafety` 9/9 together;
  production build clean; feature registry guard green; `SCREEN-INDEX.md` regenerated.

### One failure found during the stage, and what it actually was

A combined Playwright run reported 5 failed / 3 did not run / 1 passed. Re-run individually and
again as one invocation: 9/9 passed. The earlier output was an **interrupted run** (the working
session was cut mid-process, so in-flight tests counted as failures and the rest never started),
not an implementation defect — each lane now passes and is evidenced separately.

### Fixture leak found by this stage's own E2E, fixed at the source

The first `afterAll` restored employee roles with `WHERE role_id = '<the deleted role>'`, which
matched nothing once deletion had nulled it — leaving the shared QA Employee fixture roleless and
reddening the app-settings isolation test. Restore now matches `user_id + tenant_id`; the QA
fixture was repaired by hand and re-verified (employee back on Sales Employee, zero leftovers).

### QA state at hand-off

`npm run qa:clean` removed 142 rows; the independent re-count (never the cleaner's own output)
reports 0 business rows. Fixture identity rows intact: four accounts (two owners with NULL
`role_id`, two employees on the Sales Employee template), four system roles, zero throwaway
roles/users, zero audit rows, zero orphaned memberships.

### APK gate — still the owner's four secrets

Re-checked live: `gh secret list` contains no `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Per the standing
instruction the APK path stops here: no local Gradle, no other workflow; the only permitted path
`.github/workflows/build-apk.yml` already proved every pre-signing step green (run 37076349097)
and stops exactly at “Decode release keystore”. No artifact, so installation/startup/device QA are
BLOCKED, not skipped.

Stage verdict: RBAC role/permission and role-deletion revocation are PASS with database-level
evidence; production untouched; **“STAGING APK READY FOR USER REAL-DEVICE ACCEPTANCE” is NOT
declared** — the signed APK prerequisite is the missing owner keystore secrets.

## Stage: farmer marketplace integration foundation — owner side (2026-10-04)

Approved workstream, implemented in full: a product-level *List on Farmer Marketplace* switch, a
per-branch *List this branch* switch with a coverage distance, a curated read contract a future
Farmer App can consume without a login, and the QA evidence for all of it. The Farmer App itself
is explicitly **not built** (no ordering, chat, credit, payments, field visits). Owner App stays
the single source of truth; no second product or inventory system exists.

### The decisive finding: the app's branch IS a `shops` row

Measured, not assumed: `get_my_branches()` returns `m.tenant_id` joined to `shops`;
`shopStore` maps `r.shop_id → Branch.id`; `BranchEditSheet` writes the location with
`set_place(p_table => 'shops')`. So Lahore / Multan are two existing `shops` rows, each with its
own pin from 0172. The `branches` table is a finer sub-location (Main / Warehouse) used only to
stamp inventory movements, and is deliberately not part of this design. Two additive columns on
the row that already *is* the branch are the whole schema change.

### What was built

- `0184` — `shops.marketplace_enabled` (default false), `shops.marketplace_radius_km` (default 25,
  CHECK 1–200), and `set_marketplace_settings(...)`: SECURITY DEFINER, owner/admin of **that**
  branch, refuses to list a branch with no pin, refuses a radius outside 1–200, keeps the chosen
  distance when the switch goes off, audits `marketplace_settings_changed`, revoked from `anon`.
- `0185` — `products.marketplace_listed` + `marketplace_listed_at`; recreated `create_product`
  and `update_product` to carry the switch (absent = unchanged, present false = unlist + clear the
  moment, present true = list); `marketplace_distance_km` (haversine, no PostGIS); the
  `marketplace_listings` view — a fixed 20-column allowlist readable anonymously; and
  `search_marketplace(...)`, which clamps the radius to 1–200 km and the page to 100 rows, refuses
  a point outside Pakistan and an unknown category, applies `LEAST(searcher radius, branch
  coverage)`, and orders nearest-first with deterministic tie-breaks. The file refuses to apply
  if a forbidden column name reaches the view or if `anon` loses SELECT.
- `0186` — `get_my_branches()` carries `marketplace_enabled` / `marketplace_radius_km` so the
  branch sheet can show the decision before changing it (revoked from `anon`).
- UI — the product switch on Add/Edit product (saved by the same button as the product, sent only
  when it changed on an edit, always on create); the branch switch and distance in the branch
  sheet, with an honest state for a branch with no pin and the same-save ordering that writes the
  pin before the listing; EN + UR copy that passes the microcopy ban list.
- `FARMER_MARKETPLACE_INTEGRATION.md` — the contract: eligibility chain, both radii, nearest
  priority, the redaction boundary, a worked Lahore/Multan/Sheikhupura example, and what a
  consumer must and must not do.

### One real defect found while building it, and fixed

The product form writes the whole product, so a form that cannot see the stored listing flag would
save `false` and **unlist a listed product as a side effect of an unrelated edit**. The write path
had the flag; the product-list mapper did not. Fixed in `productsStore` (the column is read) and in
the form (on an edit the flag is only sent when the person moved it, so "absent = unchanged" is
used honestly). `tests/e2e/marketplaceListing.spec.ts` proves the round trip, and the read-back
assertion was proven non-vacuous by reintroducing the defect and watching the lane fail.

### Evidence (all against QA `bpybjrjenwccowvtrevu`; production untouched)

- `tests/integration/marketplaceContract.test.ts` — **28/28 PASS**: anon reads the view; anon
  refused on `products`, `product_variants`, `shops`, `inventory_movements` (42501); anon refused
  `set_marketplace_settings`; anon refused an insert into the view; column-set **equality** with
  the allowlist; forbidden keys absent; switch-off removes; per-branch switch-off removes only
  that branch; archive / zero stock / inactive pack / unpinned branch / zero price all remove; far
  search sees neither branch; a branch outside its own coverage absent **with stock**; each radius
  enforced independently in both directions; non-Pakistan point and unknown category refused;
  nearest-first in both directions with one row per branch; owner sets switch + radius; employee
  refused; radius 0 and 5000 refused; listing an unpinned branch refused with before/after values
  compared.
- `tests/unit/marketplaceContractGuard.test.ts` — **16/16 PASS**, non-vacuous against the real
  file (injected `v.cost_price`, guard failed with the discloses-margin message, file restored,
  ledger hash intact).
- `tests/e2e/marketplaceListing.spec.ts` (new lane `marketplaceListing` in lane-map) — **3/3
  PASS**: the product tick is stored with its moment, a listed product opens listed, an unrelated
  save does not unlist it, unticking unlists and clears the moment; the branch switch + distance
  save together, make the product reachable through `marketplace_listings`, and turning the branch
  off removes it while keeping the chosen distance; and the same lane switches the app to Urdu,
  asserting both new controls are announced in Urdu, the distance unit reads in Urdu, and no
  English copy is left on either card (EN + LTR / UR + RTL both covered by the same lane).
- Existing affected lanes this stage: `productOpeningStock` + `adminMicrocopy` + `accessUx` —
  **12/12 PASS**. `imageSync` **10/10 PASS** run alone (a manual 3-specs-4-workers invocation
  failed in `setupFixtures` because three `beforeAll`s raced to seed the same rows; re-run alone,
  green — test invocation, not a product defect).
- Regression: `tsc --noEmit` clean; full vitest **87 files / 954 tests PASS**; `npm run build`
  clean; `npm run registry:build` guard 14/14; `npm run migrate:verify -- --env staging` —
  **178 files ↔ 178 rows, VERIFY: PASS**.
- QA state: `npm run qa:clean` removed 252 rows; the independent re-count reports **0 business
  rows**, fixtures intact (4 accounts, 4 system roles).

### Gate honesty — what was NOT run

The Urdu/RTL pass over the two new controls was added after the first lane run and is green
(3/3). What follows is the gate detail.

`npm run verify:plan` computed **Tier 2** (its fingerprint base is stale — it reports 397 changed
files against a checkpoint from a different head; `git status` shows the true 20-file change set).
Executed: full vitest, the canonical lanes that cover the changed surface (`accessUx`, `rtlLtr`,
`imageSync`, `splitPayment` — the latter three each green; `imageSync` re-run alone after the
invocation race above), the affected lanes `productOpeningStock` + `adminMicrocopy`, and the new
`marketplaceListing` lane. **Not re-run this stage:** `actionCenter`, `dashboardScope`,
`crossScreenSync`, and every other lane whose globs name `src/lib/i18n.ts` — the i18n edit
invalidates them mechanically, and per `FEATURE-MAP.md` §C that is the engine being conservative
about files rather than a demand for the full suite. They carry no marketplace behaviour. `rtlLtr` and `splitPayment` passed inside the 3-spec
invocation (18 passed there); the 9 that did not run were `imageSync`'s own remaining tests, and
that file was then run alone, 10/10 green.

### Not built, on purpose

No Farmer App screens, no ordering, chat, credit, payments, field visits or notifications; no
anonymous write of any kind; nothing widened beyond the fixed 20-column projection. Production was
never touched, and no commit or push was made in this stage.

### Correction before commit — the distance belongs to the farmer, not the branch (0187)

The product owner corrected the model before this work was committed: a shop owner must never
choose how far a farmer's search reaches. The radius is a SEARCH input on the farmer's side
("show me within 20 km"), and the owner's whole contribution is a location on a branch plus the
listing switch. `0187_the_distance_belongs_to_the_farmer_not_the_branch.sql` makes the code match
the corrected model:

- `shops.marketplace_radius_km` and its CHECK are dropped.
- `set_marketplace_settings(uuid, boolean, numeric)` is replaced by
  `set_marketplace_settings(uuid, boolean)`; the switch is the whole decision, the audit carries
  only the before/after switch state, and the no-location refusal stays.
- `get_my_branches()` is recreated without the radius column.
- `search_marketplace(...)` keeps its signature and result shape; its eligibility rule is now the
  single honest bound, `marketplace_distance_km(...) <= v_radius`, with no branch-side term.
- On the client, the branch sheet's distance field, its state and the four i18n keys are gone;
  the sheet saves the switch alone (`setMarketplaceSettings(shopId, enabled)`).

Re-verification after the correction (same day, same QA project `bpybjrjenwccowvtrevu`):

- `npx tsc --noEmit` clean; full vitest **87 files / 955 tests PASS**; `npm run build` clean.
- `tests/integration/marketplaceContract.test.ts` — **28/28 PASS**, rewritten: the farmer's radius
  is the only distance rule and is checked in both directions; the writer takes exactly the switch;
  a stale three-argument call fails; `get_my_branches` carries the switch and no distance.
- `tests/unit/marketplaceContractGuard.test.ts` — **17/17 PASS**; the new check fails if the rule
  stops being `<= v_radius` or a branch-side distance reappears, proven non-vacuous by injecting
  `LEAST(v_radius, s.marketplace_radius_km)` back into the search rule and watching it caught.
- `tests/e2e/marketplaceListing.spec.ts` — **3/3 PASS**; the Urdu test now also asserts the
  owner-side distance row is absent in every language.
- `npm run registry:build` guard **14/14**; `npm run migrate:verify -- --env staging` —
  **179 files ↔ 179 rows, VERIFY: PASS**; `npm run qa:clean` followed by an independent
  `npm run qa:count` — **0 business rows**.
- Docs updated to the corrected model: `FARMER_MARKETPLACE_INTEGRATION.md` (§3.3 is now "the
  farmer's radius is the only one"), `feature-registry.json`, `FEATURE-MAP.md`, `FUTURE_VISION.md`
  §5, `DECISION_REGISTER.md` D23.
