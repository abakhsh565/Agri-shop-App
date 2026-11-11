# Local Development — the Supabase CLI stack on this machine

**What this is.** Web development and testing for AgriShop against a Supabase stack running in
Docker on this machine: Postgres 17, PostgREST, GoTrue, Realtime, Storage and the edge runtime. It
needs **no third hosted project**, and it shares nothing with QA or production.

**What it is not.** It is not a release path. There is no APK from here — `.github/workflows/build-apk.yml`
remains the only authorized APK workflow, with its existing QA configuration (`DEVELOPMENT_ENVIRONMENT.md` §7).
It is also not QA: local data is disposable and never travels anywhere.

Measured state, 2026-10-12: the stack builds, seeds and serves the app; the workflows below were
verified in a real browser with database evidence (§6).

---

## 1. Start, seed, verify

```bash
npm run local:db -- up        # start the local stack (docker); ports below
npm run local:db -- init      # platform defaults → baseline schema+rows → forward files 0188→0197
npm run local:db -- seed      # fixture shop/branch/users/catalogue + local auth logins
npm run local:db -- verify    # counts AND API-role privileges, both asserted
npm run dev                   # the app, reading .env.local
```

`npm run local:db` is `node scripts/dev/local-db.mjs`. The same commands work directly, e.g.
`node scripts/dev/local-db.mjs verify`.

`npm run dev` now refuses to start unless the resolved configuration is the local stack **and the
stack answers**: the Vite environment gate runs for the dev server as well as for builds, prints
`[EnvGuard] serving DEVELOPMENT → localdev`, and stops with `npm run local:db -- up` when
`http://127.0.0.1:54321/auth/v1/health` does not answer — instead of starting a server whose every
read fails. A server for another environment must name that environment: `npx vite --mode qa` for
QA, which the lanes and the Playwright configs already do. The check is
`src/lib/localStackHealth.ts` (loopback only — it can never probe a hosted project), and its unit
test is `tests/unit/localStackHealth.test.ts`.

`init` is idempotent only in the sense that it expects to build the schema; on a database that
already has objects, start over (§3).

### What `init` does, in order — the order is the whole point

1. **Platform default privileges** for `public` are applied **first** (`PLATFORM_DEFAULTS_SQL`).
2. The accepted staging baseline artifact is restored: its `public` schema **and its rows**
   (`--schema-only` skips the rows).
3. Forward files `0188 → 0197` are applied — the same selection
   `npm run verify:baseline -- --baseline staging --since 0188` proves PASS.

Step 1 is not optional and must stay first. The artifact is an **ACL-free** dump (3,316 statements,
not one `GRANT`), because hosted Supabase supplies object privileges itself: a table created in
`public` arrives with `anon`, `authenticated` and `service_role` holding `arwdDxtm`. The migrations
are written against that fact — `0195` REVOKEs `INSERT,UPDATE,DELETE,TRUNCATE` on `sales`,
`sale_items`, `purchases`, … from `authenticated` so money can only move through the atomic RPCs, and
then GRANTs back `UPDATE(notes)`; `0189` closes `audit_events` the same way. A REVOKE of something
nothing granted is a no-op, so:

| If step 1 is missing | If step 1 runs after the objects exist |
|---|---|
| every PostgREST read answers **403** — the dashboard shows nothing, and the build and the object counts still look perfect | the revokes have already run against privileges that did not exist, so `sales`/`audit_events` are **directly writable** from the client |

Both halves are asserted by `verify`, against the live database:

```
· API-role privileges:
  ✓ authenticated SELECT sales         yes   (the platform default)
  ✓ authenticated INSERT customers     yes   (the platform default)
  ✓ authenticated UPDATE sales.notes   yes   (0195)
  ✓ authenticated INSERT sales         no    (0195)
  ✓ authenticated INSERT audit_events  no    (0189)
```

`tests/unit/localDevDatabaseOrdering.test.ts` guards the source half (the order, the grant shape,
and that `0195`/`0189` are still in the applied set), and was proved non-vacuous by moving the call
after the restore and watching it fail.

### Local stack endpoints

| | |
|---|---|
| API / PostgREST | `http://127.0.0.1:54321` |
| Database | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio | `http://127.0.0.1:54323` |
| Inbucket (caught email) | `http://127.0.0.1:54324` |

## 2. Signing in

`.env.local` points at the local stack and declares `VITE_APP_ENV=development`. The app agrees out
loud, at start-up:

```
[EnvGuard] DEVELOPMENT → localdev (otp: demo)
```

Sign in with any seeded phone (for example `923009999999`) and the demo OTP `demo`; the first login
asks for a PIN, which is written to the local `users.pin_hash`. The seed logins are the QA fixture
identities (`QA Admin`, `QA Employee`, `Arc Zari Form`, …), so the same screens, roles and branch
scoping can be exercised locally.

## 3. Stop, restart, reset

```bash
npm run local:db -- down          # stop the stack; the local database volume is KEPT
npm run local:db -- reset --yes   # discard the local volume, then `up` + `init` + `seed`
npm run local:db -- status        # where the stack listens (no writes)
```

`reset --yes` is the supported recovery when `verify` reports missing API-role privileges: it
discards the volume, and the next `init` creates every object *after* the platform defaults instead
of before them. Nothing hosted is reachable from any of these commands.

## 4. What the local database contains, and what it does not

* The baseline artifact's rows are restored on purpose: `authorize_business_action()` and
  `has_effective_permission()` resolve from `memberships`, `permissions` and `role_permissions`, which
  are tenant-scoped reference rows that cannot be re-derived for a new tenant. Without them every
  business RPC answers `NOT_AUTHORIZED`.
* The artifact is a **`public`-schema** dump, but measurement shows it also carries `auth` rows
  (13 `insert into auth.…` statements), including the fixture logins and their password hashes. That is
  why `seed` reports logins as "already valid" even on a database created from nothing. Those rows stay
  on this machine: the artifact lives in gitignored `backups/`.
* Local data is disposable. Re-run `seed` freely (every insert is an upsert).

## 5. Tests and gates

```bash
npx tsc --noEmit                     # types
npx vitest run                       # unit tests + the executable guards
npm run build                        # production build, with the environment gate
npm run verify                       # the tiered gate (see AGENTS.md §7)
npm run verify:targeting             # environment targeting refusals
npm run test:e2e:lanes               # Playwright lanes — QA-targeted, unchanged by local dev
```

Local Development does **not** change the E2E lanes: they still run against QA with `.env.qa`. The
workflows in §6 were verified through the running app in a browser (Preview), with the database read
back as evidence, which is what a local stack can prove; QA-only suites were not repointed at it.

## 6. What was verified against the local stack

| Workflow | Evidence |
|---|---|
| Sign-in, session, PIN set | OTP accepted, PIN written to `users.pin_hash`, session survives reload |
| Dashboard reads | every `/rest/v1/*` request **200** (was **403** before the platform defaults); real rows rendered (totals, employee performance, recent sales, 7 notifications, 3 out of stock) |
| Customer → products → sale | `QA Customer C`, Potash `20 KG`, split payment Rs. 4,000 paid / Rs. 6,000 credit |
| Sale written through the RPC | `sales` 5→6, `sale_items` 7→8, newest row `SALE-53464` total `10000.00`, `amount_paid 4000.00`, `amount_due 6000.00`, `payment_type partial` |
| Stock | variant `20.00` `stock_qty` 75→74 |
| Customer balance / credit limit | `outstanding_balance` 0→`6000.00`, limit `10000.00`; the cart computed "Good → Over Limit → Good" live |
| Realtime | a `notifications` row inserted out of band (psql) appeared in the app's badge 8→9 within 3s, with no reload |
| Environment safety | the build gate accepted the development configuration; the app logged `[EnvGuard] DEVELOPMENT → localdev`; no QA or production credential is read by any local command |

Not exercised in this pass: purchases/supplier payments, returns and voids, image upload through
Storage, and the AI assistant function (it needs provider secrets). They run on the same stack and
are not blocked by anything above.

## 7. Two pre-existing behaviours observed while verifying (not caused by local setup)

Both were confirmed against **QA's own rows** inside the baseline artifact, so they are the product's
behaviour, identical in QA and locally — recorded here so the next session does not hunt them again:

1. **A sale does not write an `inventory_movements` row.** Stock moves (75→74 above), but the ledger
   gets no `sale` movement: `create_sale` contains no `inventory_movements` insert, nothing in `src/`
   inserts into that table, and QA's own 10 movements are all `adjustment`. `due_date` on the sale has
   the same shape of gap: the UI requires it for credit sales, `create_sale` never writes the column,
   and QA's own partial sale (`SALE-14273`) has `due_date NULL` too.
2. **`customers.due_date` stays NULL** for credit sales, consistent with (1).

Neither is a release blocker for local development, and neither was changed here: both are business
rules in the RPC, which is outside this task's scope and would need the normal migration path.

Measured again on 2026-10-12 with a partial return (1 of 1) and a void of the same sale, both
through the running app:

| Action | `inventory_movements` | `stock_qty` |
|---|---|---|
| a sale | **no row** | 74 → 73… (moves) |
| a return (`process_return`) | **no row** | restored (+1 per unit) |
| a void (`void_sale`) | **one row, `movement_type = void`** | restored (498/498 units) |

So the ledger is not unused — `void_sale` writes to it and QA's own 10 rows are `adjustment` — the two
paths that *do* move stock for money (`create_sale`, `process_return`) simply do not record one. That
is the precise shape of the gap: not "the ledger is ignored", but "two of the three writers are
missing", which is why the void's row is the evidence that settles what the intended behaviour is.

---

## 8. Verification record — 2026-10-12 (this pass, after the environment contract closed development)

Everything below was measured, not read: a real browser against `http://127.0.0.1:5273` speaking to
the local stack, with `psql` on the stack's own container as the independent witness.

### 8.1 Development is a recorded, enforced target — not an absence of configuration

`environments.json` now describes development as what it is (`kind: "local"`, `status:
"local-stack"`, `localProjectId: "localdev"`, `localStack` coordinates) instead of "not-created".
The hosted tooling still refuses it — a target with no project ref cannot be verified
(`npm run verify:targeting`: **8/8 refusals PASS**, including `development_has_no_project`) — and
`scripts/lib/environments.mjs` gained the one reader that *can* reach it:`localStackConnection()`,
which takes the address from `supabase status -o env` and **refuses any host that is not loopback**.
A `.env.local` pointed at a hosted project is therefore refused before a socket exists, rather than
detected afterwards.

The app enforces the same rule from the other side (`src/lib/environmentContract.ts`):

* `DEVELOPMENT_ENV_HOSTED_URL` — a development build whose `VITE_SUPABASE_URL` is a hosted
  `*.supabase.co` URL is refused. This is the configuration `.env.local` held before the local stack,
  and it was **accepted** for as long as development had no target of its own.
* `DEVELOPMENT_ENV_WRONG_TARGET` — a development build resolving to any project id other than the
  recorded local one is refused.

Both are covered by `tests/unit/environmentSafety.test.ts` (37 tests, valid *and* invalid cases, with
the previously-passing "development + staging project is allowed" assertion replaced by its
refutation), and by the build gate: `npm run build` with `.env.local` succeeds, a hosted URL does not.

### 8.2 Isolation, proved with a canary rather than asserted from config

`npm run verify:isolation` plants a per-run random token in development and then scans **every
text-like column of every table** in each environment for it (catalogue-driven, so a table added
later is searched without editing the tool):

```
development  REACHED  LOCAL STACK 127.0.0.1:54322/postgres [supabase_db_…, PostgreSQL 17.6, project "localdev"]
                      canary planted, 466 column(s) scanned, FOUND
development  staging  REACHED  bpybjrjenwccowvtrevu cluster 7678069749886157684 — 465 columns, not found
production   BLOCKED  missing PROD_DB_HOST, PROD_DB_USER, PROD_DB_PASS
ISOLATION: BLOCKED - NOT PASS
```

Production is reported **BLOCKED**, not passed: its credentials live outside this repository by
design (`~/.agrishop/production.env`, never read in this pass), so the honest answer is that its
isolation is *unverifiable from here*, and the tool exits 1 rather than turning that into a pass.
What could be proved without them is structural, and the tool now does it: it scans every
local-development writer (`scripts/dev/local-db.mjs`, `supabase/seed.sql`, `supabase/config.toml`,
`.env.local`) for a hosted URL, a `QA_`/`PROD_` process-environment read, or a retargeting CLI
command (`supabase link`/`db push`/`--linked`). All four are **clean**. Two lessons from making that
scan non-vacuous: a docblock that *documents* the rule is not a call (it was a false positive until
the scanner tracked block comments), and `//` inside a URL string is not a comment (it was a false
negative until the scanner tracked string literals). `--self-test` now asserts all 13 checks in
process, including both of those.

QA is additionally checked for development residue directly: no QA row in any text column contains
dev-only text, and QA's `returns` holds no local-dev reason. QA's own counts did move during this
pass (570 → 669 business rows) because the **QA-targeted integration suite** ran against it — the
suite writes fixtures and only deletes them when `QA_CLEAN_AFTER_RUN=1` is set. That is the suite's
documented behaviour on QA, not local development reaching QA; per this task's instruction, no
destructive QA cleanup was run.

### 8.3 Workflows verified in the browser, with database evidence

| Workflow | What the browser showed | What the stack then held |
|---|---|---|
| Sign-in + session | demo code accepted, PIN set and confirmed, `/admin/dashboard` reached; `[EnvGuard] DEVELOPMENT → localdev (otp: demo)` in the console | `auth.users` 5, `users.pin_hash` written for the admin, session survives reload |
| Dashboard reads | real totals, 3 out-of-stock, action tiles | matches the local DB, and **not** QA's: unread badge 10 vs QA's 0 unread of 11 |
| Return (correct price) | “Rs. 10,000 refunded in cash”, `RET-56472` | `returns.total_refund = 10000`, `return_items.refund_amount = 10000`, customer balance 164,000 → **154,000**, stock +1, branch stamped |
| Return (zero price) | “Rs. 0 refunded in cash”, `RET-01967` | `total_refund = 0`, balance untouched — see 8.4 |
| Void | `status: voided`, 498 units restored, outstanding reversed | `sales.is_voided = true`, `voided_by_name = QA Admin`, a `voids` row, stock 2 → **500**, and the one `inventory_movements` row of type `void` |
| Realtime | with the dashboard open, 12 notifications were marked read and one new row inserted out of band | badge went **10 → 1 with no reload** |
| Purchase (partial) | “2 × 28 KG added to stock — Rs. 196,000”, `PUR-47350`, “Rs. 96,000 to pay” | `purchases` 196,000 paid 100,000; `purchase_items` 1 × qty 2; supplier payable **96,000**; stock 500 → **502**; a `purchase` movement |
| Supplier payment | “Rs. 96,000 paid to Suncrop” | a `supplier_payments` row (amount 96,000, cash, `recorded_by` QA Admin, branch + idempotency key stamped); supplier payable 96,000 → **0** |
| Create product | “Local Dev Product added to stock”, shown as Low Stock | `products` row (pesticide, stock 7), one `1 KG` variant (cost 300 / sell 500 / stock 7), barcode auto-made (`AGS-LOCA-26`), a stock movement written |
| Create customer | “Local Dev Customer added successfully” | `customers` row with the entered phone, credit limit 10,000, crop `Cotton`, stamped with the local shop and the signed-in user; customers 7 → 8 |
| Split-payment sale | `SALE-05403`, receipt “Paid Rs. 1,000 / Outstanding Rs. 500” | `amount_paid` 1,000, `amount_due` 500, `payment_type = partial`, customer balance 0 → **500**, stock 7 → **4** — **and `due_date` NULL, and no stock movement**: see 8.7 |
| Storage | bucket list on the stack | upload path exercised: see 8.5 |

The **void** flow was driven through the governed path (GoTrue sign-in with the app's own derived
credential → `POST /rest/v1/rpc/void_sale` → 200) rather than the UI button: clicking the confirm in
the “Delete this sale” sheet produced **no request at all** in the network log, so the sheet's
confirm is unverified, and calling it a product defect would be a guess. This is recorded as an
UNKNOWN, not a pass.

> **Resolved in §9.2** — the confirm fires `rpc/void_sale` (200) and the database holds the void. The
> earlier "no request" was the Preview webview's frozen animation clock leaving the sheet offscreen,
> not the button.

### 8.7 Confirmed defects: a credit sale's due date is required by the UI and dropped by the write path, and the stock ledger misses two writers

One controlled experiment settles both, and neither needs an inference:

1. **`due_date`.** The cart's Partial/Credit mode renders *“Payment Due Date — Required for credit sales. Select when the customer will pay.”*, and the confirm button reads `Select due date first` until one is chosen. A due date of `2026-11-12` was set, the button enabled, the sale completed… and `sales.due_date` is **NULL** (`payment_type = partial`, `amount_due = 500`). The earlier pass saw this on QA's own rows (`SALE-14273`); this is the same result reached by taking the UI at its word, so the field is required in the interface and never written by `create_sale`. Reminders and overdue credit then have nothing to work from — which is why `overdueCredit` reports **Rs. 0 overdue** on a screen whose tiles exist to report it.
2. **The ledger.** Every writer that moves stock was measured in one session:

| Writer | `inventory_movements` |
|---|---|
| create product with initial stock | **row written** |
| purchase (stock-in) | **row written (`purchase`)** |
| void sale | **row written (`void`)** |
| **sale (`create_sale`)** | **no row** — stock moved 7 → 4 |
| **return (`process_return`)** | **no row** — stock restored |

The documented answer for both gaps is a forward migration (a new file after `0197`) that writes `due_date` from the payload and inserts the two missing movement kinds,plus a guard in `tests/unit/` so the rule cannot be silently dropped again. It was **not** made here,
deliberately: this pass's mandate is the Development/Staging/Production separation, these are money and inventory rules, and `0192`–`0197` are uncommitted work by another session in the same files — a second, conflicting migration in that area is a coordination decision, not a local-development one.

> **Made since, in `0198`** — see §9.4: the due date is written from the payload, the two missing
> movement kinds are inserted, and `tests/unit/stockLedgerAndDueDateGuard.test.ts` fails if either gap
> returns.

### 8.8 A screen that needs a refresh after a purchase

> **Resolved in §9.3** — both screens now reload the suppliers store after their RPC; measured
> in-session, with no page reload, Rs. 0 → 50,000 → 0.

Recording the purchase above made the Payments screen report **“We owe suppliers Rs. 0”** and “No suppliers to pay — All suppliers are settled” while `companies.outstanding_payable` held **96,000** and the Purchases screen itself showed “Rs. 96,000 to pay”. Switching tabs did not refresh it; a fresh page load showed **Suncrop · Rs. 96,000 · Record payment** correctly. So the number is right and the in-session state is stale: the payables summary needs invalidation when a purchase is recorded, or the supplier payment screen silently offers nothing to pay for a debt that exists.

### 8.4 A 0 refund is reachable by an empty unit price — observed, then explained

The first return recorded `total_refund = 0` while the confirm screen had estimated Rs. 10,000. The
cause was traced, and it was **this pass's own probe**: a fallback selector typed into the
confirm screen's editable *unit price* field, `updatePrice()` coerced the unparseable text to `0`,
and the RPC — which trusts the submitted price — recorded a 0 refund. The console says so:
`The specified value "Local dev verification return" cannot be parsed`. The correct-price return
above is the control that proves the money path works. The real finding is narrower and worth
fixing deliberately: `AdminReturnConfirmPage.updatePrice` silently turns an empty or NaN price into
**0**, and the RPC accepts it, so an accidental edit can hand back nothing without complaint.

### 8.5 Storage: buckets created locally, object policies still missing

> **Resolved in §9.1** — `0199` restores the four `storage.objects` policies and the publication, and
> uploads were re-measured through the UI on both `customer-images` and `product-images` (200, with
> the `storage.objects` rows as evidence). The paragraph below is the state as found on 2026-10-12.

`storage.buckets` was **empty** on the local stack: the baseline artifact is a `public`-schema dump,
so nothing in the `storage` schema travels with it, while `0013_storage_buckets.sql` is not part of
`init`'s forward set. `supabase/seed.sql` now creates the four buckets that migration creates
(`product-images`, `employee-photos`, `company-logos`, `customer-images`), and `seed` reports them.

An **upload is still refused**: `POST /storage/v1/object/product-images/…` returns `403
new row violates row-level security policy`, because `storage.objects`' policies live in the same
absent `storage` schema, so RLS denies by default. Image paths are therefore **not exercisable on the
local stack yet** — QA remains the environment where uploads are verified. The fix is to apply
`0013`'s `storage.objects` policies during `init` (from the authored migration, not a copy); it was
left undone rather than half-done.

### 8.6 The QA-live integration suite: 48 failures, investigated by cause, none from local dev

`npx vitest run tests/integration` → **48 failed | 393 passed | 25 skipped** (20 files). Every failing
test imports `tests/setup/qa-client` and nothing this pass changed, and the suite resolved to QA
(`[EnvGuard] Environment verified: bpybjrjenwccovtrevu`). Grouped by what the failure actually says:

| Cause | Evidence | Files |
|---|---|---|
| A write path the schema forbids **by design** | `expected 'permission denied for table sales'`; `0054` and `0195` both `REVOKE INSERT,UPDATE,DELETE ON sales FROM authenticated` | `branchScopeEnforcement` (8), `financialIntegrity` (3) |
| RBAC expectations the branch's in-flight migrations change | `expected [] to include 'sales.view'`; `NOT_AUTHORIZED: missing permission products.view`; `ROLE_NOT_FOUND_OR_NOT_AUTHORIZED` | `employeeInviteLifecycle` (9), `employeeAccessOverrides` (4), `rbacLifecycleAndSessions` (4), `rbacPlaceRead`/`rbacEnforcement`/`rbacInvariants`, `assistantPermission`, `appSettingsIsolation` |
| QA fixture residue (setup never ran) | `duplicate key value violates unique constraint "shops_pkey"`; `memberships_role_id_fkey` | `placeLocation`, `tenantIsolationOps`, `variantIsolation` |
| Test-side identifiers, not environment | `@supabase/auth-js: Expected parameter to be UUID but is not` thrown by the test's own helper | `employeeAccessOverrides`, `employeeInviteLifecycle` |
| In-flight feature contracts | `expected 'permission denied for function void_sale' to contain …`; branch pin/`get_my_branches` shape | `securityAudit`, `branchPlaceRead`, `marketplaceContract`, `auditIntegrity` |

None of these is caused by local development, and none was "fixed" here: they are the working tree's
uncommitted RBAC/branch/marketplace work meeting QA's current data, which is another session's change
in flight. The count is also stable across this pass's edits (46–49 failures both before and after
the environment-contract work, varying run to run because they are live-database assertions).

---

## 9. Second pass, 2026-10-12 — the open items in §8, closed and re-measured

Everything below was driven through the running app (Preview at `http://127.0.0.1:5273`, speaking to
the local stack) with `psql` on the stack's own container as the independent witness. **No hosted
target was written**: every row, object and publication below is on this machine.

### 9.1 Storage uploads (was: `403` on every upload — §8.5)

`0199_uploads_and_live_updates_survive_a_restore.sql` re-asserts the four `public_all_storage_*`
policies on `storage.objects` (0022's own definitions, bucket-restricted) and the seven tables 0144
published — the two facts a `public`-schema artifact cannot carry. Measured on the stack:

```
storage.objects policies            0  → 4   (public_all_storage_insert / select / update / delete)
supabase_realtime published tables  0  → 7   (products, product_variants, customers, sales,
                                              companies, notifications, users)
```

`scripts/dev/local-db.mjs` gained `applyStorageOwnership()`, because the local `postgres` is neither a
superuser nor the owner of `storage.objects` (`supabase_storage_admin` is), so `CREATE POLICY … ON
storage.objects` there fails with `must be owner of table objects`. The tool grants that role first —
the local equivalent of the authority hosted's `postgres` has, and the reason 0199 needs no local
branch. `verify` now asserts both facts and fails loudly:

```
· objects outside `public` (what the artifact cannot carry):
  ✓ storage.objects policies  4  (0022 / 0199 define 4)
  ✓ supabase_realtime tables 7  (0144 / 0199 publish 7)
```

Then, through the UI, with `storage.objects` holding 0 rows beforehand:

| Action | Request / control | Storage and DB after |
|---|---|---|
| upload (customer) | `POST /storage/v1/object/customer-images/1791825235125-vez4od.png` → **200** | `storage.objects` 0 → 1, `customers.image_url` set |
| replace | `POST …/customer-images/1791825300345-y19qhz.png` → **200** | the row points at the new object; **both** objects are kept |
| remove | tile `X` → “Remove this photo?” → save | `image_url` → **NULL**; the objects stay in the bucket |
| reload | full page load | the stored image rendered, `naturalWidth` 80 — the real pixels, not a broken icon |
| upload (product) | `POST /storage/v1/object/product-images/1791825472956-dn5o8i.png` → **200** | `products.image_url` set — the exact request §8.5 recorded as `403 new row violates row-level security policy` |

Found while removing, and left alone: nothing deletes the replaced or removed object, so the bucket
accumulates orphans. A delete is a product decision (and would need its own policy), not a
local-stack one, so it is recorded rather than changed here.

### 9.2 The void sheet's confirm (was: UNKNOWN — §8.3)

Now **PASS**. With a reason typed into the sheet, the confirm fires
`POST /rest/v1/rpc/void_sale → 200`, and the database holds `sales.is_voided = true`,
`void_reason = "Void verified from the UI"`, `voided_by_name = QA Admin`, `voided_at`, a second
`voids` row, and the dashboard drops the sale from the day's totals (QA Admin 3 → 2 sales).

Why the earlier pass saw *“no request at all in the network log”*: in a Preview webview that is not
being composited, CSS animation time stands still — `document.getAnimations()` returns every
animation `running` at `currentTime: 0` — so `ds-anim-sheet-in` never runs and the sheet card stays
at `translateY(100%)`. Its buttons are then drawn below the viewport and a click lands on the scrim.
Finishing the animations (what 280 ms of real rendering does) puts the card at its settle position
and the button works. This is recorded as a **test-environment trap**, not a product defect.

One property of the void worth knowing before reading the next failure as a bug: `void_sale` writes
the `void` movement and restores stock only for the quantity that has not already been returned
(`v_item.qty - SUM(return_items.qty_to_return)`). Voiding `SALE-50603`, whose single item had already
been returned, therefore restored nothing and wrote no movement — correctly.

### 9.3 Stale supplier payables (was §8.8)

`RecordPurchasePage` and `RecordSupplierPaymentPage` now `await useCompaniesStore.getState().load()`
after their RPC — the same explicit refresh `RecordCustomerPaymentPage` already did. Measured with
in-app navigation only, no reload in between:

```
Payments “We owe suppliers”   Rs. 0      → Rs. 50,000   (after PUR-25898: 98,000 − 48,000 paid)
Payments “We owe suppliers”   Rs. 50,000 → Rs. 0        (after the 50,000 supplier payment)
```

The network log shows `GET /rest/v1/companies?select=*&is_active=eq.true&order=name.asc` immediately
after each `rpc/create_purchase` / `rpc/record_supplier_payment`, which is the explicit refresh — not
Realtime arriving late. Database: `companies.outstanding_payable` 0 → 50,000 → 0, `total_purchases`
196,000 → 294,000, a `supplier_payments` row of 50,000 (cash, QA Admin), and a `purchase` movement
502 → 503.

Unchanged, observed: the Purchases screen's own “Outstanding Supplier Payable” sums
`purchases.amount_due`, so it still shows 96,000 for a delivery whose supplier balance was settled
by a later payment. That is a second, different number with a different definition, not this bug.

### 9.4 The due-date and ledger gaps (was §8.7) — made in 0198

`0198_a_sale_keeps_its_due_date_and_leaves_a_movement.sql` writes `sales.due_date` from the payload
and inserts the two missing movement kinds; `tests/unit/stockLedgerAndDueDateGuard.test.ts` (16 tests,
including a non-vacuity block) fails if either gap returns — including if the sale's movement is
moved above the stock `UPDATE`, or if the return's movement leaves the `IF restock` branch. Measured
on the stack: a sale leaves a `sale` movement (4 → 3) and a restocking return a `return` movement
(3 → 4).

### 9.5 What this pass ran, and what it did not

`npm run verify:plan` computes **tier 2** over this worktree (447 changed paths — other sessions'
in-flight branch/RBAC/marketplace work), which would run the full vitest suite, 34 Playwright lanes
and an independent QA row count. Only the affected gates were run:

```
npx tsc --noEmit                      PASS (exit 0)
npx vitest run tests/unit/            594 passed (52 files), incl. the three guards below
npm run build                         PASS (exit 0)
node scripts/dev/local-db.mjs verify  PASS (counts, API privileges, storage policies, publication)
```

The guards this pass added or extended, each with a non-vacuity block that proves it can fail:
`tests/unit/stockLedgerAndDueDateGuard.test.ts` (16), `tests/unit/supplierPayableFreshness.test.ts`
(12: the refresh after a write and before the navigation, a walk of `src/` that fails if a screen
starts calling a payable-changing RPC without re-reading the suppliers, and §9.7's rule that both
screens take “what we owe suppliers” from the suppliers' balances rather than from the delivery rows),
and `tests/unit/localDevDatabaseOrdering.test.ts` (17, extended with the storage-ownership step and the
rule that `0199` restores the *same* four policy names and seven tables `0022`/`0144` established).

The QA-targeted integration suite and the 34 lanes were **not** run: they write QA fixtures, they are
not affected by this pass's changes, and §8.6 records their in-flight failures as another session's
work. No QA and no production row, policy or object was touched.

### 9.6 Environment isolation — what is proven from here, and what is still BLOCKED

| Claim | Status | Evidence |
|---|---|---|
| Development speaks to the local stack | **PASS** | `.env.local` resolves to `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_PROJECT_ID=localdev`; `local-db.mjs verify` PASS; every write in §9 is `127.0.0.1:54321` or the local container |
| Development cannot reach a hosted project | **PASS** | the local writer set (`.env.local`, `supabase/seed.sql`, `supabase/config.toml`, `scripts/dev/local-db.mjs`) holds no hosted URL, no `QA_`/`PROD_` credential read and no `supabase link`/`db push`; the only two grep hits are prose that *documents* the rule, which is the shape the scanner's self-test covers. The tool also refuses any target that is not a `supabase_db_*` container |
| A run declared as one environment cannot run as another | **PASS** | `npm run verify:targeting` → **8/8**, every refusal an exit code that arrives *before a connection*: production rejects staging credentials (and staging rejects production's), a credential carrying no project ref is refused, and the control case — correct identity — proceeds past the check and fails only on DNS, so the check discriminates rather than blocking everything |
| The app refuses a mis-targeted build | **PASS** | `tests/unit/environmentSafety.test.ts` (inside the 589): a development build pointed at a hosted URL is refused, and a production build without real OTP delivery is refused |
| The isolation scanner itself is not vacuous | **PASS** | `node scripts/verify-environment-isolation.mjs --self-test` → **13/13**, exit 0: it finds a present token, reports none for an absent one, reads every column it claims to, and flags a hosted URL/credential read/retargeting command while leaving a comment that merely *mentions* one alone |
| QA holds no development residue | **REUSED (§8.2)** | a per-run canary planted in development was found in development and **not** found in staging's 465 columns |
| **Production holds no development residue** | **BLOCKED** | production credentials live outside the repository by design (`~/.agrishop/production.env`) and were not read. Without them the live-row canary cannot be planted or searched, and the tool reports **BLOCKED** rather than converting an unverifiable environment into a pass — which is the correct answer, not a failure of this pass. Nothing in this section read, wrote or deleted a production row. |

The missing half is therefore explicit: production's *live data* is unverifiable from this checkout
until someone authorizes a credential, while every check that does not need one — targeting
refusals, the writer scan, the app-side contract and the scanner's own non-vacuity — passes.

### 9.7 Two gaps investigated and deliberately left unchanged

**The Purchases screen's “Outstanding Supplier Payable” was a second number wearing the same label**
(not the stale store, which was §9.3). `fetchPurchases()` maps each delivery's own residue
(`purchases.amount_due` = `total - paid` at the moment it was recorded) onto the row, and the header
summed those, while the supplier's balance lives in `companies.outstanding_payable` — the figure
`record_supplier_payment` reduces, and the one the signals engine, the Payments screen and the archive
guard all read. Nothing allocates a payment to a delivery (`supplier_payments` has no `purchase_id`),
so the two agreed only until the first payment.

**FIXED + VERIFIED.** The header now totals the suppliers' balances — the same computation
`AdminPaymentsPage` makes, so the two screens cannot describe one debt differently again — and a
delivery row says which number it is showing (`purchases.unpaidOnDelivery`, EN + UR). Measured, on one
screen and the other, after recording a delivery of 80,000 with 60,000 paid:

| Where | Before (summed rows) | Now |
|---|---|---|
| Purchases header | Rs. 166,000 | **Rs. 20,000** |
| Payments “We owe suppliers” | Rs. 20,000 | **Rs. 20,000** |
| Database `sum(companies.outstanding_payable)` | 20,000 | **20,000** |
| Database `sum(purchases.amount_due)` | 166,000 | 166,000 (still per-delivery, still correct as such) |

No financial calculation changed: no RPC was touched, payment history is untouched, and the per-delivery
residue is still shown — it now carries a label that says whose number it is. `supplierPayableFreshness`
gained the rule: both screens must read the suppliers, restrict the total to suppliers actually owed
money, and the Purchases screen must not sum its own rows; both failure modes are injected and caught.

What is *not* decided, and is the reason the per-delivery figure can still differ from the balance: a
**payment-allocation rule** (does a supplier payment settle particular deliveries, oldest first, and
does a delivery then stop being “unpaid”?). That is a new money rule and is not invented here; until
someone decides it, deliveries carry their record-time residue and the shop-level figure is the
supplier balance.

**Orphaned Storage objects are not required to be deleted by any recorded rule.** Replacing or
removing an image clears the database reference and leaves the object (measured: two objects kept
after a remove and a replace). The rule search found no image-lifecycle or deletion rule in `docs/` or
the root documents — the only hits about orphans are AGENTS.md's *record* lens and CLAUDE.md's rule
about code that *your own change* made unused, neither of which is a storage lifecycle. Decision: not
required today; when it is wanted it belongs with the DB/Security lens, because deleting an object is
a destructive action, and the delete is governed by the same `public_all_storage_*` policy 0199
restores. Recorded and measured, unchanged.

## 10. The local integration job in CI (2026-11-11)

**Why.** The cloud QA project goes slow for minutes at a time while otherwise idle — proven
2026-11-10 20:12Z, a table-free `select 1` taking >10s on both the direct and the pooler path, then
recovering — and the 60-minute QA job keeps being cancelled mid-run (free-tier throttling is the
prime suspect; the Supabase dashboard check that would confirm it is still with the owner). The
permanent free fix is to run the same integration suite against a Supabase stack started on the
runner itself: Docker, `$0`, no hosted database in the path at all.

**What runs.** The `integration-local` job in `.github/workflows/ci.yml` (needs `gates`, no
`qa-database` concurrency group — the stack lives on the runner and is discarded with it):

```bash
node scripts/dev/local-db.mjs up                                  # supabase start --yes
node scripts/dev/local-db.mjs env >> "$GITHUB_ENV"                 # the stack's own URL + keys
node scripts/check-qa-connectivity.mjs                            # reachability, plain Postgres
node scripts/dev/local-db.mjs init --baseline local-ci --skip-verify
node scripts/dev/local-db.mjs apply tests/setup/create_run_sql.sql  # the working run_sql
node scripts/dev/local-db.mjs seed
node scripts/dev/local-db.mjs verify --baseline local-ci
npx vitest run tests/integration --fileParallelism=false --reporter=verbose
```

`--skip-verify` is not a skipped check: verify needs an active membership, which only `seed`
creates, so it runs after seed instead. The cloud-QA job is untouched, and this job is a parallel
signal — not a gate — until it has three consecutive green runs.

**What the artifact is.** `supabase/baseline/local-ci-baseline.sql` (+ `.json` record) is the
production dump at ledger 48/0304, sanitized by `scripts/dev/build-local-ci-baseline.mjs`:
structure only (45 tables / 129 functions / 3 views / 64 indexes / 32 triggers / 162 policies)
plus reference rows only — permissions 32, roles 4, role_permissions 59, app_settings 5, shops 1,
branches 1, storage buckets 4. No auth rows, no shop requests, no storage objects, no password
hashes; the demo shop is renamed to "AgriShop Local Development". The build refuses to write if any
reference count moved or a fixture identity survived. Appended to it is
`supabase/baseline/local-ci-supplement.sql`: the 0107/0108 RBAC surface production never received
(`business_areas` + `has_permission` / `create_business_area` / `update_business_area`). Forward
files then apply in the order the record carries: 0071, 0075–0078, 0305, then 0233–0302 in
version order (0305 must precede 0259, which needs the new enum labels). 0070 is deliberately
NOT in the order: its `run_sql` body is invalid PL/pgSQL (`RETURN (EXECUTE ...)` — `EXECUTE` is a
statement, not an expression) and has never applied anywhere, yet it is recorded in the QA ledger
with its current hash, so editing it would break `migrate verify`. The suite calls `run_sql` for
setup/teardown, so the local job deploys the working definition from `tests/setup/create_run_sql.sql`
via `local-db apply` — the same file QA got by hand. Fixture memberships —
the owner and employee logins — live in `supabase/seed.sql`, not the artifact: fixture ids are
banned on shipped surfaces.

**Refresh rule.** When production receives migrations beyond 0305, re-run the build against a fresh
production dump and commit the new artifact + record together:

```bash
npm run local:baseline -- --dump backups/<fresh-production-dump>.sql
```

The dump must be under gitignored `backups/` and must carry its server-version line; the build
fails rather than writing a wrong artifact. The record's `forwardOrder` is updated at the same time
when the forward set changes.

**Target safety.** `QA_TARGET=local` is the only way the suite names the local stack, and it is
named explicitly — never guessed from the URL. `tests/setup/env-guard.ts::assertLocalTarget`
accepts only plain `http:` on a loopback host at port 54321 with a bare path, and refuses a hosted
key used against a local URL; `assertQaProject` still refuses the local URL, so the two guards
disagree by design. Direct Postgres is 54322 with no TLS (`tests/setup/qa-client.ts` reads
`QA_DB_PORT` at call time; the hosted default is unchanged at 5432 with TLS). `provision-auth-sessions`
is hard-pinned to QA and is skipped in the local job; `migrate verify` has no local target and is
not run there.
