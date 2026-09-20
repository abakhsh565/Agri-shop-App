# Engineering OS — Project State

**As of:** 2026-09-20 · **Commit:** `972b3b9` (foundation) + uncommitted dashboard-correctness work (0124–0127) · **Environment:** QA only (`bpybjrjenwccowvtrevu`)

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
| Backend authorization | Verified | 36 of 43 write RPCs carry an authorization guard; the remainder are internal/trigger helpers or admin-gated and are explicitly allowlisted. |
| RLS correctness | Verified | 0 app-facing tables with RLS enabled and zero policies (the failure mode that silently broke `shops`, settings and reminders). |
| Anonymous-write protection | Verified | anon-executable writes: 23 → 1 (`insert_shop_request`, the registration form). |
| Tenant isolation | Verified | Real JWT tests: cannot read or mutate another tenant's rows, roles, business areas, employees, or run its RPCs. Cross-tenant writes refused. |
| Audit | Verified | `audit_events` records role/access changes with the acting user; employee override save + reset both attributed. |
| Live session behaviour | Verified | Role change / membership deactivation revoke access at the next authorization boundary; no stale client cache can grant it. |
| Role lifecycle safety | Verified | `ROLE_IN_USE` (employees still on it), `SYSTEM_ROLE_READ_ONLY`. |
| QA verification | Verified | 337/337 Vitest across 23 files (5 consecutive full runs, 0 failures); **58/58 Playwright E2E, 0 failures**; TypeScript clean; production build passes. |
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
`formatCurrency`, `src/imports/**` (unreferenced Figma mock-ups), the Observation Bot's
generated diagnostic report body (an engineer-facing dump, not product copy), role names
and descriptions (tenant data in the DB), and crop names (data).

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
