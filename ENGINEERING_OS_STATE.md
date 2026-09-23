# Engineering OS — Project State

**As of:** 2026-09-21 · **Commit:** `dc334cd` (last verified) + uncommitted duplicate-action work (0138–0139) · **Environment:** QA only (`bpybjrjenwccowvtrevu`)

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
