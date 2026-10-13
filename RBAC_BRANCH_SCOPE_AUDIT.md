# RBAC, Branch Scope, and Accountability — Discovery Report

**Scope:** read-only inspection. Nothing implemented.
**Environment:** QA Supabase `bpybjrjenwccowvtrevu`, live Postgres via `pg` (the `run_sql` service RPC returns
the literal string `ok` for every query and is unusable as evidence).
**Method:** 7 read-only probes. Every claim below is either **measured on QA this session**, marked
**REUSED** (verified in an earlier session, not re-measured now), or marked **UNKNOWN**.

---

## 1. Current State — what already works and must not be rebuilt

**S1. The authorization gate is correctly shaped.**
`authorize_business_action(p_permission varchar, p_tenant_id uuid, p_branch_id uuid)` — source read live — runs a
three-part check: authenticated → tenant match → permission → branch-in-scope, raising
`NOT_AUTHORIZED: missing permission %` and `NOT_AUTHORIZED: branch access denied`. 45 RPCs call it.
This is the target model's *Person → Role → Branch Scope → Permission → Action* already expressed at the DB layer.

**S2. A `BEFORE` trigger enforces branch on writes.** `enforce_branch_scope_trg` / `enforce_branch_scope` exists on
**7** tables — `sales`, `purchases`, `returns`, `inventory_movements`, `customer_payments`, `supplier_payments`,
`stock_adjustments`. For a branch-limited member it stamps `NEW.branch_id := v_scope[1]` when unset and raises
`NOT_AUTHORIZED: branch access denied` when a branch_id is out of scope. `marketplace_listings` also carries
`branch_id` but has **no** trigger (8 stamped tables total).

**S3. Branch scope is bound to the active shop.** `current_branch_scope()` reads through
`membership_in_active_shop(NULL)` (migration `0149`). Measured live for 3 real employees.

**S4. Roles are already reusable templates with no person name.** `roles(id, tenant_id, name, description,
is_system, created_at, updated_at)` — **no name column carrying a person**. `role_permissions(role_id,
permission_id)` over 32 permission codes. Measured live: 11 role rows across 3 tenants; template sets
Sales Employee / Inventory Clerk / Sales Manager / Store Manager.
This already satisfies "a role must never contain a person's name". Do not redesign it.

**S5. Two account roles only.** `user_role` enum = `admin | employee` (migration `0167`). Confirmed.

**S6. Void preserves history and attributes the real actor.**
`sales` carries `is_voided, void_reason, voided_by, voided_by_name, voided_at, status`.
`void_sale` head read live: `v_actor := COALESCE(app_current_user_id(), p_voided_by)` — the **session user wins**;
`void_sale_v1` is stricter still: `v_actor_id uuid := app_current_user_id()` with no override parameter at all.
Both gate on `authorize_business_action('sales.void', …)`. The Branch Manager is never substituted as actor.

**S7. Stock history is retained with before/after.** `inventory_movements` carries
`qty_before, qty_change, qty_after, reference_type, reference_id, unit_cost, branch_id`.
`stock_adjustments` adds `adjustment_type, reason, idempotency_key`.

**S8. Client writes to the audit log are closed.** `audit_events_no_client_writes` is `PERMISSIVE INSERT
WITH CHECK (false)` and `authenticated` holds **no** INSERT privilege on `audit_events` (grants measured:
SELECT/REFERENCES/TRIGGER/TRUNCATE only). Double gate, working.

**S9. Onboarding does not move the employee.** `complete_member_onboarding()` only flips
`memberships.status pending → active`; it touches neither `tenant_id`, `shop_id`, nor `branch_scope`.
Migration `0171` refuses an empty `branch_scope`. So *Employee → Assigned Branch* survives onboarding —
**provided the scope written at enrolment was correct** (see G7).

**S10. Reporting permission exists and is granted sensibly.** `reports.view` is held by Sales Manager and
Store Manager; `settings.edit` and `employees.manage` are held by neither.

**S11. Role permission matrix (measured live, tenant `00000000-…-0001`; the other two tenants carry the
same three templates).** 32 permission codes total over 14 modules.

| Role | Count | Permissions |
|---|---|---|
| **Inventory Clerk** | 12 | `products.view/create/edit`, `inventory.view/adjust`, `purchases.view/create`, `payments.view/supplier`, `companies.view/create/edit` |
| **Sales Manager** | 12 | `sales.view/create/void`, `returns.view/create`, `customers.view/create/edit/payments`, `products.view`, `inventory.view`, `reports.view` |
| **Store Manager** | 29 | Everything above **plus** `products.delete`, `customers.delete`, `activity.view`, `alerts.view/manage`, `notifications.view`, `settings.view` — i.e. every code except `settings.edit` and `employees.manage` |
| **Sales Employee** | *partial* | Exists **only** in tenant `1e5f7e4b-…` (not one of the other two). Probe output truncated its full set; rows observed were `customers.view`, `sales.create`. **UNKNOWN — not re-measured.** |

Consequences that matter for the target model:

* **Inventory Clerk cannot sell** — no `sales.*` permission at all.
* **Sales Manager cannot restock** — no `inventory.adjust`, no `products.create/edit`, no `purchases.*`.
* **Destructive actions belong to Store Manager alone**: `products.delete`, `customers.delete`.
* `activity.view` is held by Store Manager only, and is **inert** (G15).
* No role holds `employees.manage` or `settings.edit` except the owner's implicit authority.
* **No role or permission for branches exists** (G12).
* Roles are **duplicated per tenant** (11 role rows / 3 tenants), so a template edit in one tenant does not
  propagate to another.

---

## 1b. Flow trace — Actor → Branch Scope → Permission → Action → Data Affected → Result → Audit/History

Every important path, traced against measured behaviour. `branch` = the branch the action should belong to.

| Flow | Actor | Branch Scope used | Permission gate | Data affected | Result | Audit / History |
|---|---|---|---|---|---|---|
| **Record a sale** | Owner / Store Manager / Sales Manager | Owner: `NULL` → any branch. Others: `v_scope` | `sales.create` via `authorize_business_action`; branch backstop is the trigger, not the gate | `sales` + `inventory_movements` (**branch-stamped**) | Written | **None for a normal sale** (G4). Only `sale_credit_limit_override` when over limit **and** admin. **No branch, no role** (G3) |
| **Record a sale, branch-limited employee** | Inventory Clerk **cannot** — no `sales.create` | — | refused | — | `NOT_AUTHORIZED: missing permission` | n/a |
| **Void a sale** | Store Manager / Sales Manager | Scope `NULL` → any branch in tenant; scoped → restricted only by the trigger | `sales.void` | `sales.is_voided`, `void_reason`, `voided_by`, `voided_by_name`, `voided_at`, stock restored via `inventory_movements` | Preserved, not deleted | `audit_events` `sale_voided`, actor = `COALESCE(app_current_user_id(), p_voided_by)`; details `{reason, reversedOutstanding}` — **no branch, no role** (G5) |
| **Adjust stock** | Inventory Clerk / Store Manager | `NULL` → any branch. Scoped → `v_scope[1]` if unset, else refused | `inventory.adjust` | `product_variants.stock_qty` (tenant-wide, **no branch dimension** — G8), `stock_adjustments` + `inventory_movements` (branch-stamped) | Written | `audit_events` `stock_adjusted`, entity_type `product`; details `{type, before, after}` — **no branch, no reason** (G5) |
| **Create a purchase** | Inventory Clerk / Store Manager | as above | `purchases.create` | `purchases`, `supplier_payments`, stock via movements | Written | `audit_events` `purchase_recorded`; details carry `shopId` = **the tenant, not the branch** (G5) |
| **Record supplier payment** | Inventory Clerk / Store Manager | as above | `payments.supplier` | `supplier_payments` (branch-stamped) | Written | `audit_events` `supplier_payment_recorded` (1 row on QA) |
| **Record customer payment** | Sales Manager / Store Manager | as above | `customers.payments` | `customer_payments` (branch-stamped) + `customers.outstanding` | Written | `audit_events` writer present in source; **no rows on QA to confirm shape — UNKNOWN** |
| **Enrol an employee** | Owner | Branch picker reads the real `branches` table, scoped by RLS to the active tenant | `employees.manage` → `authorize_business_action` returns the tenant; `create_employee_core` sets `users.shop_id` = that tenant | `users` (+`branch_scope` written into `memberships`), status `pending` | Created | `audit_events` `employee_created` (1 row) — **no branch, no role-at-time** |
| **Complete OTP onboarding** | The employee | Unchanged — `complete_member_onboarding()` touches neither tenant, shop, nor scope | none | `memberships.status pending → active` | Scope **survives** | `audit_events` `member_onboarding_completed` (1 row) |
| **Switch branch / shop** | Any member | `set_active_shop(p_shop_id)` — the id passed is a **tenant** id (G2) | membership must be `active` | `user_active_shops`; `resolve_active_shop()` → first active membership → legacy `users.shop_id` | Header changes; **the tenant changes, and no branch selection is recorded** | none |
| **Read the branch list** | Any member | **Not consulted** — `get_my_branches()` never reads `branch_scope` and is `SECURITY DEFINER` | none | — | Returns **tenants** with tenant-wide `sales_count` / `sales_total` | none — **this is the live leak (R1)** |
| **Read reports** | Sales Manager / Store Manager / Owner | Inherited from RLS on the underlying tables only | `reports.view` | — | Every figure computed client-side from RLS-visible rows; **no server-side overall-vs-branch aggregate exists** (G10) | none |
| **Read the activity log** | Store Manager / Owner | `audit_events_select` requires `app_is_admin()` **and** actor's `users.shop_id = current_shop_id()` | `activity.view` (inert) | — | Store Manager: **0 rows** (measured). Owner: rows of their tenant only, **never filtered by branch** | n/a |
| **Create / edit / delete a role** | Owner | tenant only | owner authority; `0131` forbids authority from a role *name*; `0183` revokes access on role delete | `roles`, `role_permissions` | Written | `audit_events` `role_deleted` (1 row); `create_role` / `update_role` / `delete_role` all write |
| **Delete a product / archive a customer** | Store Manager | tenant only — **no branch dimension on `products` / `customers`** (G8) | `products.delete` / `customers.delete` | `products`, `customers` | Written | `audit_events` `product_deleted` (3 rows), `company_archived` (1 row) |
| **Create / rename / delete a branch** | Owner | tenant only | **no branch permission exists** (G12); branch/main-branch deletion refusals are separate | `shops` + `branches` | Written | `audit_events` writers exist in source (`delete_branch`, `rename_branch`) |

**The single pattern to notice:** every flow above records *who* and *what*. **Not one of them records the
branch the action happened in**, and none records the actor's role at that time. That is G3/G5, and it is why
R4 stands.

---

## 2. Gaps

**G1. `get_my_branches()` ignores branch scope completely.** Source read live — its subqueries are
`(SELECT count(*) FROM sales v WHERE v.shop_id = m.tenant_id)` and
`(SELECT COALESCE(sum(v.total_amount),0) FROM sales v WHERE v.shop_id = m.tenant_id)`, with matching
`products` / `customers` / `memberships` counts. It never reads `branch_scope` or `branch_id` and it is
`SECURITY DEFINER`, so RLS does not apply. It feeds `shopStore.loadBranches` → the `salesCount` / `salesTotal`
rendered in the branches widget.

**G2. `get_my_branches()` returns tenants, not branches.** Its FROM is `memberships m JOIN shops s ON
s.id = m.tenant_id` and it returns `m.tenant_id`. Consequently `shopStore.branches[].id`, `activeShopId`,
`adoptShop(user.tenantId)`, `set_active_shop`, and `switchTo` are all **tenant** ids. QA is 3 tenants /
4 branches. "Create new branch" creates a tenant + default branch.

**G3. `audit_events` has no branch and no role-at-time.** Columns measured:
`id, user_id, action, entity_type, entity_id, details, ip_address, created_at`. The requirement
*who → role at that time → branch where it happened → action → record → timestamp → reason → before/after*
cannot be answered for **branch** or **role**.

**G4. A normal sale writes no audit row.** `create_sale_unchecked` only inserts an audit row for
`sale_credit_limit_override`, and only when the credit limit is exceeded **and** `app_is_admin()`.
Measured: 37 audit rows total, **zero** with an action containing `sale`.
Present actions: `marketplace_settings_changed` 22, `product_updated` 6, `product_deleted` 3, `role_deleted` 1,
`company_archived` 1, `employee_created` 1, `member_login_provisioned` 1, `supplier_payment_recorded` 1,
`member_onboarding_completed` 1.

**G5. The audit writers that do fire record the tenant, not the branch.**
- `adjust_stock` → `stock_adjusted`, entity_type `product` (not the adjustment row), details `{type, before, after}` — no branch, no reason.
- `create_purchase` → `purchase_recorded`, details `{purchaseNumber, totalAmount, shopId}` — `shopId` is the **tenant**.
- `void_sale` → `sale_voided`, details `{reason, reversedOutstanding}` — no branch.

**G6. `branch_scope IS NULL` means "all branches" for reads *and* writes.** `enforce_branch_scope`: when
`v_scope IS NULL` it accepts **any** `branch_id` and only fills in `default_branch_id(v_tenant)` when one is absent.
The matching RLS predicate is `current_branch_scope() IS NULL OR branch_id = ANY(current_branch_scope())`.
Measured: **2 of 3 live employees have `branch_scope = NULL`** (`923001122334`, `923008888888`).

**G7. The enrolment default never fires on a multi-branch tenant.**
`AddEmployeePage.tsx` loads branches from the real `branches` table (so `branches[].id` are genuine **branch** ids),
but compares them against `activeBranchId = useShopStore(s => s.activeShopId)`, which is a **tenant** id (G2):

```
if (b.length > 1 && activeBranchId && b.some((x) => x.id === activeBranchId)) setBranchScope([activeBranchId]);
```

`b.some(...)` is therefore always false, `branchScope` stays `null`, and the UI renders **"All branches"**
as the selection — the exact outcome the surrounding comment says must be impossible. This is consistent with
the 2 measured NULL scopes in G6.

**G8. No branch dimension on the product/customer/master data.**
`products`, `product_variants`, `customers`, `companies`, `users` carry `shop_id` only — no `branch_id`.
`product_variants` holds one `stock_qty`, one `cost_price`, one `selling_price` per tenant.
"The same product in two branches with its own stock/cost/price" is **not representable today**.

**G9. `branches` has no Primary Responsible Person.** Columns:
`id, tenant_id, name, is_default, address, phone, is_active, created_at, latitude, longitude, location_label,
location_source`. The accountability feature has no column to stand on.

**G10. No reporting RPC exists.** `reports.view` gates the screen, but every figure is computed client-side
from whatever rows RLS returns. There is no server-side overall-vs-branch summary to scope.

**G11. `memberships` carries two role sources.** Columns: `id, user_id, tenant_id, role` (legacy enum
`owner|admin|employee`), `status`, `branch_scope uuid[]`, `created_at, updated_at, role_id` (FK → `roles`).
Measured: 4 rows `owner` with `role_id NULL`; 2 rows `employee` with `role_id NULL`; 1 row `employee` +
Inventory Clerk. A `role_id NULL` employee has **no permission template**.

**G12. There is no branch-management permission.** None of the 32 codes covers branches. Branch create /
rename / delete are gated by other means.

**G13. `AddEmployeePage` reads `branches` directly**, so RLS scopes it to the active tenant — an owner with
several tenants sees only one tenant's branches in that picker.

**G14. The frontend never sends `branch_id`.** Zero occurrences of `branch_id` in any query under `src/`
(only `branch_scope` in `auth.ts` types and `branchId` as a route param). Writes therefore rely entirely on
`enforce_branch_scope`'s fallback.

**G15. `activity.view` is decorative.** It is granted to Store Manager, but `audit_events_select` is
`app_is_admin() AND (user_id IS NULL OR EXISTS(users u WHERE u.id = audit_events.user_id AND
u.shop_id = current_shop_id()))`. A Store Manager (`app_is_admin() = false`) reads **zero** audit rows.
Measured: `audit_visible: 0` for all three employees.

---

## 3. Verified Risks

| # | Risk | Status | Proof |
|---|---|---|---|
| **R1** | A branch-scoped member can read **tenant-wide** sales totals through `get_my_branches()` while RLS correctly hides those same rows | **LIVE, PROVEN** | Source verbatim (G1) + REUSED reproduction: a rolled-back transaction showed `RLS_VISIBLE {n:0,total:0}` alongside `get_my_branches` `sales_count:1, sales_total:"5000.00"`. Not re-measured this session. |
| **R2** | `branch_scope IS NULL` = unrestricted across all 8 stamped tables, for reads and writes | **LIVE, PROVEN** | `enforce_branch_scope` source (G6) + measured `current_branch_scope() = null` for 2 real employees + measured RLS predicate `current_branch_scope() IS NULL OR …` |
| **R3** | The cross-branch read/write itself | **UNKNOWN — not provable on current QA data** | All stamped rows in the employees' tenant sit in **one** branch (`Default Shop - Main`: 3 `inventory_movements`; `Default Shop - Warehouse`: **0**). Measured: the NULL-scope employee and the Main-scoped employee both see **exactly 3**, so the contrast proves nothing. **Do not convert this to PASS.** Requires a seeded row in a second branch (T2). |
| **R4** | The accountability chain cannot be reconstructed (no branch, no role-at-time) | **LIVE, PROVEN** | `audit_events` columns measured (G3) |
| **R5** | A sale leaves no audit trace at all | **LIVE, PROVEN** | 37 rows, zero `sale%` actions; `create_sale_unchecked` audits only the over-limit admin override (G4) |
| **R6** | An owner acting in a non-default branch is recorded against the **default** branch | **PROVEN BY CODE** | UI sends no `branch_id` (G14) + `enforce_branch_scope` all-branch path does `NEW.branch_id := default_branch_id(v_tenant)` (G6) |
| **R7** | Enrolling an employee on a multi-branch tenant silently grants **all branches** | **PROVEN BY CODE** | `b.some(x => x.id === activeBranchId)` compares a branch id with a tenant id (G2 + G7) |
| **R8** | `activity.view` grants nothing | **LIVE, PROVEN** | Policy predicate (G15) + measured `audit_visible: 0` |
| **R9** | Per-branch inventory/cost/price is not expressible | **LIVE, PROVEN** | `product_variants` column list (G8) |
| **R10** | Actor override surface: `void_sale` accepts `p_voided_by`, and the client passes the caller's own id | **LATENT** | Precedence is `COALESCE(app_current_user_id(), p_voided_by)` so the session user wins; harmless for JWT callers, a spoofing surface for service contexts and for `exec_rpc_as_user` / `run_sql_as_user`, which also exist. |

---

## 4. Required Changes

Minimal, ordered, no rebuild. Each is additive and reversible.

**C1 — Close the `get_my_branches()` leak (highest priority).** Add the `current_branch_scope()` predicate to its
four count/sum subqueries, or compute per-`branch_id` from the branch table and return real branches rather than
`m.tenant_id`. This is a live financial leak and it is one function.

**C2 — Make `NULL` scope mean "nothing" for non-owners.** In `enforce_branch_scope` and `current_branch_scope()`,
distinguish *owner / `app_is_admin()`* (unrestricted, keep current behaviour) from *employee/admin with
`branch_scope IS NULL`* (refuse, do not treat as all-branch). Backfill the two measured NULL-scope members to an
explicit scope. This closes R2 and R7 together.

**C3 — Fix the enrolment prefill.** Compare against the active **branch** id, not `shopStore.activeShopId`
(G2/G7). Prefer resolving the branch of the tenant the owner is working in, or falling back to the tenant's
`is_default` branch.

**C4 — Give the audit trail its missing dimensions.** Add `branch_id uuid` and `actor_role text` to
`audit_events`; every writer passes the branch it acted on and the actor's role *at that time*.
`actor_role` cannot be backfilled for existing rows — leave historical rows null rather than inventing a role.

**C5 — Audit the sale.** `create_sale_unchecked` should write a `sale_created` row (actor, sale id, branch,
total, customer). This is the one action the business most needs reconstructible and it currently writes nothing.

**C6 — Stamp the branch the action happened in.** Have the write paths pass `branch_id` explicitly, or have
`enforce_branch_scope` carry the actor's *currently selected* branch rather than `default_branch_id`. Needed for
"owner acts inside branch B" (R6).

**C7 — Add Primary Responsible Person to `branches`.** A person→branch relationship column (or join table).
Explicitly **not** on `roles`, and never used as the actor.

**C8 — Decide the product/branch model** (largest item, deferrable). To make a product exist per branch with its
own stock/cost/price, `product_variants` needs a branch dimension. Until then, keep reporting honest about what
it can and cannot separate.

**C9 — Reconcile `memberships.role` (legacy enum) with `role_id`.** Declare one authority, then backfill or drop
the other. Today a `role_id NULL` employee has no template (G11).

**C10 — Align the audit read path with `activity.view`,** or drop `activity.view` from Store Manager (G15).

---

## 5. Test Cases

Ordered by risk. T2 makes R3 provable and does not exist today.

| # | Test | Expected | Currently |
|---|---|---|---|
| **T1** | As a Main-scoped employee, read `get_my_branches().sales_total` | Only Main's sales | **FAIL** — returns the whole tenant (R1) |
| **T2** | Seed one sale in Main **and** one in Warehouse in the *same* tenant; read `sales` as the Main-scoped employee, then as a Warehouse-scoped employee | 1 row and Main's total; then the mirror | **UNKNOWN** — QA has no second-branch row to discriminate (R3) |
| **T3** | As a `branch_scope IS NULL` employee, read all 8 stamped tables | 0 rows | **FAIL** — currently unrestricted (R2) |
| **T4** | As a Main-scoped employee, `adjust_stock` / `create_sale` against Warehouse, **omitting** `branch_id` | `NOT_AUTHORIZED: branch access denied` | **FAIL** — the check is skipped when `p_branch_id IS NULL` (S1 + G6) |
| **T5** | `create_sale` → read `audit_events` | Exactly 1 row: `action='sale_created'`, `user_id` = actor, `branch_id` = the sale's branch | **FAIL** — no row is written (R5) |
| **T6** | Owner switches to Warehouse, records a sale → read `sales.branch_id` | `branch_id` = Warehouse | **FAIL** — stamped to the default branch (R6) |
| **T7** | Enrol an employee on a 2-branch tenant, accept the default scope | `branch_scope = {active branch id}` | **FAIL** — stays `NULL` = all branches (R7) |
| **T8** | Complete OTP onboarding, then read `branch_scope` and `resolve_active_shop()` | Both unchanged | **PASS** (S9) — regression guard |
| **T9** | Store Manager voids a sale | `sales.voided_by` = that user, `void_reason` stored, audit actor = that user; the branch's responsible person is *not* recorded as actor | Partial — void fields **PASS** (S6), audit row actor correct but **no branch** |
| **T10** | Store Manager holding `activity.view` opens the Activity screen | Rows visible | **FAIL** — 0 rows (R8) |
| **T11** | Branch-limited employee attempts a read of another branch through the UI | No rows, no total, no count | Inherits R2/T2/T3 |

**Evidence rule honoured:** R3 is reported as **UNKNOWN**, not PASS. The NULL-scope employee and the scoped
employee returned *identical* results because every stamped row in their tenant lives in one branch — that is a
gap in evidence, and it is listed as the first thing to fix in the test set, not as a passing check.

---

## 6. Reuse note

Re-measured this session: `audit_events` schema + policies + grants + 37-row action census; `roles` /
`role_permissions` / `permissions` + full matrix; `memberships` schema + role duality; `branches` and `shops`
columns; `sales` columns; `authorize_business_action` source; `enforce_branch_scope` source + trigger list;
`get_my_branches` source; `void_sale` / `void_sale_v1` heads; actor-parameter RPC census; branch-stamped table
list; RLS harness as 3 real employees (rolled back, `RESET ROLE` confirmed).

Reused from earlier sessions (not re-measured): the `sales` RLS policy text (`sales_select` + `sales_branch_select`
RESTRICTIVE) and the original `get_my_branches` leak reproduction.
