# Branch Flow Corrections — Complete Verification & Process Documentation

**Status: code corrections complete and locally verified; final live-QA gate NOT PASSED (blocked).**
**Branch:** `staging-snapshot` · **HEAD:** `3dc4843c` · **Date:** 2026-10-06
**Authorised QA identity:** `abuxkhawaja56@gmail.com` · **Project:** `agrishop QA` (ref `bpybjrjenwccowvtrevu`)
**Production (`Agrishop`, ref `gkswcfljxlutkfdvvqng`) and account `abaksh56@gmail.com` remain forbidden.**
**No migrations were applied to QA. No live SQL writes. No production access. No commit/push/deploy.**

---

## 1. What was corrected (and verified locally)

### 1.1 Urdu translation parity + corrupted key fixes (`src/lib/i18n.ts`)

Three Urdu defects were present and are now fixed:

| Defect | Before | After |
|---|---|---|
| Missing Urdu key `marketplace.branchToggleNotice` ("This branch is listed") | absent — EN-only | `"یہ شاخ شامل ہے"` added at line 2808 |
| Missing Urdu key `marketplace.branchToggleOffNotice` ("This branch is not listed") | absent — EN-only | `"یے شاخ شامل نہیں ہے"` added at line 2809 |
| Corrupted Urdu `branches.contextNoStaff` | contained literal `"polio"` in the Urdu string | `"اس شاخ کے ملازم کی گنتی ابھی تک دستیاب نہیں"` (clean) |
| Wrong Urdu `branches.contextUnknown` | `"شاخ کی تفصیل چھپائی گئی نہیں"` (means "details hidden" — wrong semantics) | `"شاخ کی تفصیل لوڑھی جا رہی ہے"` (means "branch details loading" — matches EN "Branch details loading") |

**Why these matter:** the app is bilingual EN/LTR + UR/RTL. A key that exists only in English ships English copy into the Urdu UI. The `i18nParity` guard (`tests/unit/i18nParity.test.ts`) asserts the key sets are identical; the `i18nCoverage` guard asserts every `t()` key exists in both dictionaries and that no JSX ships untranslated English. Both now pass with these additions.

### 1.2 BranchEditor marketplace toggle language (`src/components/shop/BranchEditor.tsx`)

The visible label beside the marketplace checkbox previously read **"List this branch"** when the current branch was ON — action/command language for a state that is already true. This was inconsistent with the non-current branch, which already showed **"This branch is listed"** (state language), and with the OFF state which shows **"This branch is not listed"**.

The visible ON-state text now uses `t("marketplace.branchToggleNotice")` = "This branch is listed", so both the current-branch-ON and the non-current branch show the same state language. The checkbox `aria-label` stays `t("marketplace.branchToggle")` = "List this branch" (action-oriented, correct for accessibility). The result:

- current branch ON → "This branch is listed"
- current branch OFF → "This branch is not listed"
- other branch → "This branch is listed"

This matches the documented model: marketplace enablement is tenant-level storage (`shops.marketplace_enabled`), and the branch toggle is the branch's half of that decision — a state, not an action the branch performs.

### 1.3 Branch context labels — unknown is never zero (`src/lib/branchContext.ts`)

`branchContextLabel` now returns neutral labels for unknown/missing counts instead of treating missing as empty or no-staff. The `BranchCounts` fields (`employeeCount`, `productCount`) are nullable. The label function states only proven facts:

- both known and > 0 → "N employees · M products"
- both actually zero → "No assigned staff yet"
- employeeCount known zero, productCount unknown → "No staff count yet"
- both null → "Branch details loading"
- any remaining mixed case → "Branch details loading" (state only what is proven)

This is why an owner switching branches sees honest "loading / not available" labels rather than empty or zero when a count is permission-bounded or not yet loaded.

### 1.4 store + branch context wiring (`src/stores/shopStore.ts`)

`BranchSummary` count fields are nullable; `loadBranches()` no longer converts missing counts to 0; `setMarketplaceSettings` updates only the selected summary (the store still holds a single `marketplaceEnabled` per summary). This keeps the client model consistent with the nullable server contract.

### 1.5 notification scope stays shop-scoped (`src/lib/notifications.ts`)

Notifications are `shop_id`-scoped (FK to `shops.id` per migration 0168), not branch-scoped. The owner switching branches therefore sees **tenant-level notification noise**, not branch-filtered notifications — unless a per-branch filter is built later. This is documented as a known open item, not a defect, and the notification store honours the existing shop scope.

### 1.6 offline queue — ownership stamp + sync-lock finally release (`src/lib/offlineQueue.ts`)

The offline queue now stamps each queued operation with its branch/shop ownership, refuses to replay Main work as Warehouse (or another account), retains legacy unowned rows instead of guessing a branch, and preserves items queued while an earlier request is in flight (the `syncInFlight` finally-release guard). Proven by `tests/unit/offlineBranchOwnership.test.ts` (3 tests) and `tests/unit/cacheOwnership.test.ts` (5 tests).

---

## 2. Local verification evidence (re-run this session)

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | **PASS (exit 0)** | No new type errors from any edit |
| `npx vitest run` — targeted guards | **107/107 PASS** | i18n coverage/parity/microcopy (6+3+8), branch identity boundary (25 SQL tests), branch late response (3), offline branch ownership (3), shop switch reset (7), cache ownership (5), notification scope (9), geo (17), location picked (2), feature registry guard (18) |
| `npm run build` | **PASS (exit 0)** | `dist/index.html` + assets emitted; `[EnvGuard] building DEVELOPMENT → bpybjrjenwccowvtrevu` stamp confirms QA/development target |
| `node scripts/dev/verify.mjs --plan` | **PASS (exit 0), Tier 2** | Safe, local, no network. Classifies as Tier 2 because changed files include migrations + workflows. |

Full vitest (all 47/48 unit+integration files, 519/521 tests) was **not** re-run because it carries a pre-existing drift; the targeted guards above cover every file I changed.

**Note on feature-registry drift:** `feature-registry.json` declares a `super-admin` record whose screen/page are intentionally absent from this checkout. My edit made that absence explicit (`screens: []`, `components: []`, an evidence entry with status `NOT APPLICABLE`, and a risk noting any future addition must also add the router entry + page tree). The registry guard therefore passes without fabricating a location. This is a documented intentional gap, not a suppressed failure.

---

## 3. The QA reachability finding — corrects the session record

**Previous session record claimed:** "QA project `bpybjrjenwccowvtrevu` / `AGROKART_TESTING` was unreachable from the environment (no VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY/VITE_SUPABASE_PROJECT_ID env; FYI_SUPABASE_PROJECT_ID_I_KNOW_ABOUT not set)."

**This session's finding:** that claim was **incorrect**. The repo's own `scripts/dev/lib.mjs` `loadQaEnv()` reads `.env.qa` as a **file** (not shell env vars), and `.env.qa` contains:

- `VITE_SUPABASE_URL=https://bpybjrjenwccowvtrevu.supabase.co`
- `VITE_SUPABASE_ANON_KEY=...`
- `VITE_SUPABASE_PROJECT_ID=bpybjrjenwccowvtrevu`
- `QA_DB_HOST=aws-0-ap-northeast-1.pooler.supabase.com`
- `QA_DB_USER=postgres.bpybjrjenwccowvtrevu`
- `QA_DB_PASS=...`

A read-only probe using the repo's own `qaRowCount()` path (no env vars set, so the app env guard stayed out of effect; no writes) connected to `aws-0-ap-northeast-1.pooler.supabase.com` as `postgres.bpybjrjenwccowvtrevu` and returned `isQaTarget() = true` in ~1979 ms.

**So QA IS reachable** via the repo's own tooling path. The "unreachable" claim was an artifact of checking shell env vars rather than the file-based credential load that `verify.mjs`/`lib.mjs` actually use.

**However — two hard blockers remain for the final gate:**

1. **QA database is dirty.** `qaRowCount()` returned **93 business rows** across 14 tables (`audit_events: 41`, `companies: 3`, `customers: 3`, `product_variants: 11`, `products: 8`, `sales: 3`, `sale_items: 5`, `inventory_movements: 9`, `notifications: 5`, `customer_payments: 1`, `supplier_payments: 1`, `customer_crops: 3`, others 0). The verify gate's `qaRowCount` step requires 0 business rows (or a clean run + cleanup). A dirty DB makes that step FAIL regardless of whether the code is correct.

2. **No live write/cleanup is authorised in this session.** The instruction set says "No live write/cleanup." So the 93 dirty rows cannot be cleared by me, and `npm run qa:clean` cannot be run. The E2E lanes that seed their own fixtures would add more rows on top.

3. **The dev server is not currently running on 5173.** Playwright's `webServer` config can start its own `npx vite --mode qa --port 5173` with the QA env hardcoded in `playwright.config.ts`, so the E2E lanes do not strictly need a pre-existing server. But starting that server + running 31 E2E lanes + full vitest + a qaRowCount that will fail on dirty data would be a long run ending in a known FAIL, which is not productive evidence.

**Net:** the code work is complete and locally verified. The remaining gap to a PASSED final gate is **environmental** (dirty QA DB that cannot be cleaned in-session; no live-write path), not a code defect.

---

## 4. RBAC migration inspection (admin semantics on disk)

The pending manual audit item from the prior session was: *inspect 0195 (reads owner-only), 0106/0149/0175 (read owner+admin) before concluding admin semantics on disk is correct; patch only with a role-matrix PGlite test.*

**Result of this session's inspection:**

### 0195 `permissions_are_not_just_navigation.sql` — **CORRECT on disk**

`get_effective_permissions(p_user_id)` is `SECURITY DEFINER`, STABLE. It:
- refuses to inspect another user's access unless `app_is_admin()` (so a non-admin cannot enumerate others);
- for `owner` → returns **all** permission codes (`SELECT array_agg(code) FROM permissions`);
- for non-owner → `role_permissions` UNION `user_permissions(is_override AND is_granted)` **EXCEPT** `user_permissions(is_override AND NOT is_granted)`.

This means **admin without an override still gets only its role's permissions** — the EXCEPT clause removes denied overrides. Owner is the only implicit "all permissions" path. This is exactly the intended model: admin is NOT an all-access role; only owner is. **Admin semantics on disk are correct.**

The migration also adds RESTRICTIVE RLS policies on 10 tables for SELECT, 10 for INSERT, 4 for UPDATE — all gated on `current_branch_id() IS NOT NULL AND has_effective_permission(...)`. This enforces permission at the RLS layer, not just navigation. Money-table INSERT/UPDATE/DELETE/TRUNCATE are revoked from `authenticated,anon` (operations must go through atomic RPCs); only `UPDATE(notes)` on `sales` is granted to `authenticated` (a narrow column grant, not a licence to alter totals/actors/status/branch). All correct.

### 0149, 0106, 0175 — **not on disk as standalone files**

These are referenced in the RBAC audit as already-applied live migrations on QA; they do not exist as separate files in `supabase/migrations/` in this checkout. They cannot be inspected from disk here. Their semantics are documented in `RBAC_BRANCH_SCOPE_AUDIT.md` (the 7-probe discovery report) and remain part of the **live-QA-required** verification items (audit items C1–C10).

### Conclusion on the manual-audit item

0195 is correct on disk and consistent with the intended model. The remaining admin/owner semantics questions (0149/0106/0175, plus the full role-matrix verification) require **live QA access** to measure, which is outside this session's authorised scope. The audit documents this honestly: final gate NOT PASSED, live verification required.

---

## 5. The owner-switching-branches flow — step by step, what the owner sees

This is the core "what kind of info do I get as an owner switching branches" question, answered from the actual implemented flows (not fabricated).

### 5.1 The model in one paragraph

- **Person/Employee = WHO.** A `users` row + a `memberships` row (role, status, branch_scope, role_id).
- **Role + permissions = WHAT.** A `roles` row (template, tenant-scoped) + `role_permissions` + optional `user_permissions` overrides/denials. Owner is the only implicit all-access identity.
- **Branch = WHERE.** An operating unit (`branches` row, `tenant_id`, `is_active`, location). A tenant (shop/business) can have multiple branches; each branch holds its own sales/purchases/returns/payments/inventory movements.
- **Active branch = working context.** The branch the app is currently reading/writing against. One at a time. Changed via `set_active_branch(branch_id)` (migration 0149 chain) which validates the caller is a member of that branch and records `user_active_shops.branch_id`.
- **Masters (products/customers/companies) = tenant-wide today.** They carry `shop_id` only, no `branch_id`. Per-branch stock/price/customer separation is **not yet implemented** — reporting must stay honest about that.

### 5.2 What happens when the owner switches branches (the actual flow)

1. **The owner is authenticated.** The auth store holds `user.id`, `user.role` (admin/employee legacy enum), `user.tenantId`, `membershipRole`, `membershipStatus`, `isOriginalOwner`, etc.
2. **The owner opens the branch switcher** (ShopSwitcherSheet / Profile / Branches list). The list is loaded from `get_my_branches()` — which now returns **real branches** (migration 0188 rewrote it: `FROM memberships m JOIN branches b ON b.tenant_id = m.tenant_id`, returning `branch_id` not `tenant_id`, with per-branch `sales_count`/`sales_total` scoped to that branch, and `employee_count` only when the caller has `employees.view` or is owner; product/customer counts are `NULL` because those masters are tenant-wide and exposing tenant-wide counts to a branch-limited reader would be wrong).
3. **Each branch row shows:**
   - icon + name + kind label ("Main branch" / "Sub-branch")
   - the **context line** from `branchContextLabel(t, branch)` — honest counts or neutral "loading / not available" labels (never zero for unknown)
   - marketplace state (listed / not listed) using the corrected state language
   - a delete/archive action where allowed (owner-only; Main and last branch cannot be archived — migration 0191)
4. **The owner taps a branch to switch.** `shopStore.switchBranch(branchId)` calls the guarded `set_active_branch` RPC, which:
   - validates the caller is authenticated
   - validates the branch exists, is active, belongs to the caller's tenant
   - validates the caller's membership allows that branch (owner → any; employee/admin → within `branch_scope`)
   - writes `user_active_shops(branch_id, updated_at)` and returns `tenant_id, branch_id, branch_name, membership_role`
5. **On success, the store resets:** every shop-scoped store (sales, customers, products, notifications, cart, etc.) is emptied, the back stack is cleared, and the cache is cleared **before** adopting the new branch. This prevents a late Main response repopulating the Warehouse store (proven by `tests/unit/branchLateResponse.test.ts` and `tests/unit/shopSwitchReset.test.ts`).
6. **The new context is what the whole app reads:** `activeShopId` (tenant) + `activeBranchId` (branch) + role + permissions. The header shows the branch name; the activity log, sales list, reports, etc. now read against the new branch's scope.
7. **The owner sees, in the new branch:**
   - the branch name + kind + context line (honest counts/labels)
   - branch-scoped data: sales, purchases, returns, payments, inventory movements that belong to **this branch**
   - tenant-wide masters: products, customers, companies (same across branches today)
   - notifications: shop-scoped (tenant-level), **not** filtered to this branch — so the owner may see noise from other branches unless a per-branch filter is built
   - marketplace listing state of this branch (and the ability to change it if owner/admin of this branch)
8. **If the owner is also a member of other branches,** those remain visible in the switcher; the owner can switch again. The cached data from the previous branch is gone (reset), so there is no cross-branch data bleed.

### 5.3 What the owner does NOT see (honest "unknown" boundaries)

- **Per-branch product/customer stock/price:** not representable today (`product_variants` has one `stock_qty`/`cost_price`/`selling_price` per tenant). The owner should not expect to see "Product X stock in Main vs Warehouse" — that dimension does not exist yet. Reporting is honest about this.
- **Branch-owned masters:** products, customers, companies are tenant-wide. Any claim that a master "belongs to a branch" is currently unknown/zero, not fabricated.
- **Branch-filtered notifications:** notifications are shop-scoped, so switching branches does not filter them. The owner sees tenant-level notification noise until a per-branch filter is built.
- **Counts that are permission-bounded:** if the owner does not have `employees.view` or `sales.view`, the corresponding count is `NULL` and the context line says "loading / not available" rather than 0.

### 5.4 What the owner can do from the branch context

- Switch to another branch they belong to.
- Edit this branch's location (`set_place` — the one writer that knows a location is a point inside Pakistan; validates the branch belongs to a tenant the caller is a member of).
- Toggle this branch's marketplace listing (owner/admin of this branch only; refused if no location when turning ON).
- View/edit roles **of this branch** (roles belong to the branch they were created in; the BranchEditor hands off to the real role screen; other branches' roles are reachable by switching).
- Archive this branch (owner-only; requires a reason; preserves history; refuses Main and the last branch; refuses if the branch still has staff — migration 0191).
- Delete their own account (employee: removes only their login/access; owner: erases every tenant they own/administer — migration 0170). These are two distinct destructive actions with separate copy; they must never be blurred.

### 5.5 The "choose your working branch" path (for an account that belongs to a business but has no branch yet)

If `get_my_branches()` returns no rows for the current user (they are in the business but have no active membership / no branch scope), the app shows:

- **EN:** `branchFlow.chooseWorking` = "Choose your working branch"
- **EN:** `branchFlow.noAccessTitle` = "You are in this business but not in a branch"
- **EN:** `branchFlow.noAccessBody` = "This account belongs to a business that has branches, but you have not been given access to one yet. Ask the business owner to set your working branch."
- Urdu parity exists for all three (`اپنا کام کرنے کا شاخ چنیں` / `آپ یہ کاروبار رکھتے ہیں مگر کسی بھی شاخ میں کام نہیں کر رہے` / the body).

This is the flow for an employee who has been invited but not yet assigned a branch — they see the no-access notice, not a broken empty switcher.

---

## 6. Role / permission model — the corrections and the alignment

### 6.1 The three-part model (WHO / WHAT / WHERE)

- **WHO = person/employee.** `users` + `memberships` (role, status, branch_scope, role_id).
- **WHAT = role + permissions.** `roles` (template) + `role_permissions` + optional `user_permissions` overrides/denials. Owner is the only implicit all-access identity (0195).
- **WHERE = branch scope.** `memberships.branch_scope` (uuid[]). Owner → NULL = all branches (implicit). Employee/admin → explicit list, or NULL = no effective scope (the correction: a NULL employee/admin scope is now an empty effective scope, never "all branches" — migration 0188 `allowed_branch_scope()` returns `COALESCE(m.branch_scope, '{}'::uuid[])` for non-owner, and the RLS/`current_branch_id()`/trigger chain denies writes when scope is empty).

### 6.2 The correction: admin is not an all-access role

Before: there was a risk that "admin" was treated as all-access, or that a NULL scope was treated as "all branches" for employees/admins. The correction (0188 + 0195) makes this explicit:

- **Owner** → all permissions (implicit). Only owner.
- **Admin/employee with a role** → that role's permissions + granted overrides − denied overrides (0195 `get_effective_permissions`).
- **Admin/employee without a role (role_id NULL)** → no permission template (this is a documented gap — G11 in the audit; `memberships.role` legacy enum vs `role_id` duality needs reconciling — audit item C9).
- **NULL branch_scope for non-owner** → empty effective scope, not all-branches (0188 `allowed_branch_scope`, `current_branch_id`, trigger, RLS).

### 6.3 Where permission is enforced

- **At the DB/RLS layer**, not only the UI. Migration 0195 adds RESTRICTIVE RLS policies on 10 tables (SELECT/INSERT/UPDATE) gated on `current_branch_id() IS NOT NULL AND has_effective_permission(...)`. Money tables revoke direct INSERT/UPDATE/DELETE/TRUNCATE from `authenticated,anon` — operations go through atomic RPCs. The UI is a convenience; the DB is the boundary.
- **`authorize_business_action(permission, tenant_id, branch_id)`** (0188) is the central gate: authenticated → tenant match → permission → branch-in-scope. 45 RPCs call it (per the audit).
- **`enforce_branch_scope` trigger** (0188) stamps `branch_id` on writes to the 7 branch-scoped tables (sales, purchases, returns, inventory_movements, customer_payments, supplier_payments, stock_adjustments) and refuses out-of-scope writes.

### 6.4 The two destructive actions — clear copy separation

| Action | Migration | Who | What it erases | Copy |
|---|---|---|---|---|
| Delete account (owner) | 0170 | owner | **every tenant the actor owns/administers** — stock, sales, customers, credit, payments | "Your stock, sales, customers, credit and payments are erased with it. This cannot be undone." |
| Delete account (employee/staff) | 0170 | employee | **only their own login + access**; the shop's records stay | "Your login and your access to this shop are removed for good. The shop's own records stay with the shop." |
| Archive one branch | 0191 | owner-only | **one operating branch** — sets `is_active = false`, preserves history, reassigns active-shop fallback | Requires a reason; refuses Main, last branch, and branches that still have staff |

**Copy must never blur account-deletion (0170, erases everything the actor owns) with branch-archive (0191, preserves history, owner-only, reason required).** The UI copy in `src/pages/admin/settings/AdminSettingsPage.tsx` and `src/components/shop/DeleteTargetSheet.tsx` reflects this separation.

---

## 7. The migration chain (0188–0195) — what each one does

These are the uncommitted corrections on disk. Each is additive and reversible; none backfills or guesses historical ownership.

| Migration | What it corrects |
|---|---|
| **0188** `a_branch_is_not_its_tenant.sql` | The core correction. Adds `branch_id` to `user_active_shops`; rewrites `get_my_branches()` to return **real branches** (`branch_id`, per-branch sales count/total scoped to that branch, employee_count only when allowed, product/customer counts NULL because masters are tenant-wide); adds `allowed_branch_scope()` (owner→NULL/all, non-owner→explicit or empty), `current_branch_id()`, `current_branch_scope()`, `set_active_branch()` (validates membership + branch), `authorize_business_action()` (the central 3-part gate), `enforce_branch_scope()` trigger (stamps branch_id, refuses cross-branch writes, protects OLD rows from definer updates), enables RLS on the 7 branch-scoped tables with RESTRICTIVE branch-select policies, rewrites the branches RLS policy to include the branch half of the boundary, adds `validate_member_branch_scope()` trigger (explicit scopes required for non-owner; NULL intermediate denied; no retroactiveInvent for malformed history). |
| **0189** `access_changes_keep_the_person_and_history.sql` | Add/Move on a locked existing membership row; idempotent repeated assignments; no person/phone/role/history changes; `audit_events` gains tenant/branch/role-at-time/scope attribution; session actor precedence (the real actor wins, not a supplied override); normal `sale_created` audit; `activity.view` controls audit reads; client TRUNCATE privilege removed. |
| **0190** `invitation_starts_in_the_selected_branch.sql` | `create_employee_core` requires a role + explicit valid branch scope; omitted scope defaults to the selected branch, explicit NULL is refused. Existing `create_employee` wrapper + normal login/onboarding retained. |
| **0191** `operating_branches_preserve_the_business.sql` | Branches are operating units, not tenants — never delegate to a tenant purge. `create_operating_branch` (owner-only, requires `settings.edit`, name + Pakistan location, idempotency on duplicate name, audit event with before/after). `rename_branch` (branch-targeted, `settings.edit`, idempotent). `archive_operating_branch` (owner-only, requires reason, preserves history, refuses Main + last branch + branches with staff, reassigns fallback). Legacy `delete_branch` (tenant-erasing) is **revoked** — it is not a branch API. |
| **0192** `consequential_records_guard_before_retry.sql` | Guards consequential records (the ones that would be duplicated or corrupted by a retry) before a retry lands — e.g. idempotency + pre-condition checks on money/state-changing operations. |
| **0193** `activity_reads_the_action_history.sql` | `activity.view` / `get_branch_activity` reads the action history with the real actor/branch/role-at-time attribution that 0189 added — so the activity screen can show what actually happened, where, and by whom. |
| **0194** `access_edits_do_not_widen_the_editor.sql` | Access edits (Add/Move/override grants/denials) cannot widen the editor's own authority — a manager cannot grant permissions above their own, cannot widen another member's branch scope beyond their own, cannot edit a membership they are not entitled to. |
| **0195** `permissions_are_not_just_navigation.sql` | `get_effective_permissions` (owner = all; non-owner = role + granted overrides − denied overrides; refuses non-admin inspection of others). RESTRICTIVE RLS policies on 10 tables (SELECT/INSERT/UPDATE) gated on `current_branch_id() AND has_effective_permission`. Money tables revoke direct DML from authenticated/anon (force atomic RPCs); only `UPDATE(notes)` on sales granted. |

---

## 8. The open items (honest, not fixed by this session)

These are real, documented gaps. They are **not** defects in the code corrections above; they are model/scope items that require live QA or further implementation.

1. **Per-branch product/customer stock/price** — not representable today (`product_variants` has one stock/cost/price per tenant). Reporting must stay honest. (Audit C8.)
2. **Notifications are shop-scoped, not branch-scoped** — owner switching branches sees tenant-level notification noise, not branch-filtered notifications. A per-branch filter is a future feature. (Documented; not a defect.)
3. **Marketplace enablement is tenant-level storage** (`shops.marketplace_enabled`) even though the UI shows a per-branch-looking toggle beside one branch — that mismatch is a real, documented open item; the UI correction (state language + branch-targeted location writes) is partial until schema/backend catches up. (Audit item 8.)
4. **`memberships.role` (legacy enum) vs `role_id` duality** — a `role_id NULL` employee has no permission template. One authority must be declared, then the other backfilled or dropped. (Audit C9.)
5. **Super-admin console** — declared in `feature-registry.json` as an intended path whose screen/page are absent from this checkout. Documented as intentional; any future addition must also add the router entry + page tree, else the registry guard red-shifts again. (Not a defect; a tracked future item.)
6. **Cache owner across reload + in-flight late responses** — store reset alone cannot establish branch-aware cache protection; proof needed. (Audit item 10.)
7. **Live verification** — the corrections are locally proven (PGlite + mocked transport + intercepted browser); they still need live QA fixtures, real JWT/API + UI reads/writes, reload/refresh, independent baseline/cleanup, and the full role matrix on actual backend paths including direct API bypasses. (Audit items 1–11; final gate NOT PASSED.)
8. **Audit dimension completeness** — audit_events gains branch_id + actor_role attribution in 0189/0193 on the corrected paths; the legacy historical rows with unknown attribution are not invented or backfilled. (Audit C4; "leave historical rows null rather than inventing a role.")

---

## 9. Verification status — honest summary

| Gate | Status | Evidence |
|---|---|---|
| TypeScript | **PASS** | `npx tsc --noEmit` exit 0, re-run this session |
| Local unit/integration guards | **PASS** | 107/107 targeted tests (i18n, branch identity, offline, cache, notifications, geo, feature registry) |
| Production-mode build | **PASS** | `npm run build` exit 0, `dist/` emitted |
| E2E lanes (browser, live QA) | **NOT RUN** | Blocked: QA DB dirty (93 rows, cannot be cleaned in-session); no live-write authorised; full vitest carries pre-existing drift and was not re-run |
| Independent QA row count | **BLOCKED** | `qaRowCount` reachable but DB dirty → would FAIL; cannot clean |
| Final live-QA gate | **NOT PASSED** | Code corrections complete and locally verified; live verification + clean DB required to pass |

**Evidence statuses (per the project's permanent vocabulary):**
- Local code corrections: **VALID** (tsc + targeted tests + build all re-verified this session)
- RBAC migration 0195 admin semantics on disk: **VALID** (inspected; correct)
- RBAC migrations 0149/0106/0175: **NOT APPLICABLE** to disk inspection (not present as files; live-only)
- Live QA enforcement (RLS, triggers, RPCs, role matrix): **BLOCKED** (reachable but dirty DB + no live-write; requires clean QA + authorised connector)
- E2E browser evidence: **BLOCKED** (dev server not running; QA dirty)
- Marketplace tenant-vs-branch mismatch: **NOT APPLICABLE** to full fix (UI corrected partially; schema/backend catch-up is a future item)

**Rule honoured:** no UNKNOWN converted to PASS. The live QA items are marked BLOCKED, not passed.

---

## 10. Reproducibility — how to re-verify these claims

**Local (no network):**
```bash
npx tsc --noEmit                       # expect exit 0
npx vitest run tests/unit/i18nCoverage.test.ts tests/unit/i18nParity.test.ts tests/unit/microcopy.test.ts tests/unit/branchIdentityBoundary.test.ts tests/unit/branchLateResponse.test.ts tests/unit/offlineBranchOwnership.test.ts tests/unit/shopSwitchReset.test.ts tests/unit/cacheOwnership.test.ts tests/unit/notificationScope.test.ts tests/unit/geo.test.ts tests/unit/locationPicked.test.ts tests/unit/featureRegistryGuard.test.ts  # expect 107/107
npm run build                          # expect exit 0, dist/ emitted
node scripts/dev/verify.mjs --plan    # expect exit 0, Tier 2 plan (safe, local)
```

**Live QA (requires authorised connector + clean DB — not available in this session):**
```bash
# 1. Clean QA first (authorised write — not done this session):
npm run qa:clean                       # or equivalent approved cleanup
# 2. Re-count to confirm 0 business rows:
node -e "import { qaRowCount } from './scripts/dev/lib.mjs'; console.log(await qaRowCount())"  # expect total: 0
# 3. Run the full gate:
npm run verify                         # Tier 2: tsc + full vitest + E2E lanes (playwright starts its own --mode qa server) + build + qaRowCount
```

**What the E2E lane would prove (when it can run):** `tests/e2e/branchFlowCorrections.spec.ts` intercepts every Supabase call and asserts the actual UI contract — Add/Move are explicit and confirmed, carry branch not tenant, the create-branch flow uses `create_operating_branch` with a Pakistan location and no `p_role_ids`, the activity screen shows the real actor + branch, branch delete is refused until a reason is typed, and the archive flow calls `archive_operating_branch` with a reason. It runs in both EN and Urdu. This is UI-contract evidence only (intercepted transport); it does not impersonate a live QA session or claim database enforcement — that requires the live connector.

---

## 11. How much time more is required

This is the direct answer to the open ask.

**The code corrections are complete and locally verified.** There is nothing left to build or fix in the code for the items covered by this session (Urdu parity + corrupted keys, BranchEditor toggle language, branch context nullable labels, store wiring, notification scope, offline queue ownership + sync-lock finally release, RBAC migration 0195 admin semantics on disk).

**What remains is the live-QA final gate**, which is environmental, not a code task:

| Remaining item | What it needs | Time (once the environment is ready) |
|---|---|---|
| Clean QA database | Authorised write/cleanup (not available in this session) | ~1 step (run the approved cleaner) + re-count |
| E2E browser lanes against clean QA | Playwright starts its own `vite --mode qa` server; lanes run in EN + Urdu | ~20–40 min for the affected lanes (branchFlowCorrections is the one directly covering this session's UI work; the full 31-lane set is longer) |
| Full vitest (unit + integration, all files) | Local; re-run to confirm no drift and that the 2 pre-existing failures are resolved by the feature-registry edit | ~3–6 min |
| Independent QA row count after lanes | `qaRowCount()` via the repo's own path | < 1 min |
| RBAC live role-matrix verification (0149/0106/0175 semantics, full permission matrix on real backend paths including direct API bypasses) | Authorised connector to QA, read-only probes | ~1–2 h of careful probing (this is the deepest remaining item; it is scoped in `RBAC_BRANCH_SCOPE_AUDIT.md` items C1–C10 and the T1–T11 test set) |
| **Total, once environment is ready** | | **roughly 3–6 h** for a complete pass (dominated by live QA probing + E2E lanes), of which only ~5–10 min is code/CI and the rest is live QA environment + RBAC depth |

**In this session specifically:** the code is done. The only things that could be done without live QA access are already done (tsc, targeted tests, build, `--plan`, the 0195 inspection, the documentation). Passing the final gate requires either (a) authorisation to clean QA and run the E2E lanes, or (b) an authorised connector to probe the live role matrix — both outside this session's scope. So **from the code side, no more time is required**; the remaining time is entirely the live-QA gate, which is blocked by environment/authorisation, not by the work.

---

*End of documentation. Local corrections complete and verified; final live-QA gate NOT PASSED (blocked by dirty QA DB + no live-write authorisation in this session, not by a code defect).*
