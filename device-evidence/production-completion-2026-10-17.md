# Production completion — 2026-10-17, 17:00–18:00Z

**Target:** `gkswcfljxlutkfdvvqng` (production), named by the credential guard on every run.
**Authorization:** the owner's instruction to finish the remaining verification, fix any genuine
failure, and leave production functional, secure and ready for real users.
**Starting point:** `device-evidence/production-closed-out-2026-10-17.md` — three blockers fixed,
ledger at `0226`, four RPCs smoke-tested only.

**Verdict:** every remaining item was exercised against production itself, one real defect was found
and fixed forward (`0228`), and the two items that cannot be completed from here are named in §6 with
the exact action required. Nothing is claimed as a pass without a command and its result.

## 1. The four RPC happy paths — PASS

`scripts/rehearse-production-flows.mjs --env production` (new file; the throwaway version that found
the defects is gone). One transaction, always rolled back, signed in as the owner through a real JWT
claim set, with each step in its own savepoint so one refusal cannot hide the others.

| Step | Measured |
|---|---|
| `create_sale` (credit, 2 × 100) | balance 200.00 |
| `record_customer_payment` (50) | `balanceAfter` 150, `total_paid` 50.00 |
| `process_return` (1 unit, restock) | return row written, stock +1, `return_items.qty` reads **1.0000** — the column the sale-detail and return-select screens read |
| `void_sale` | stock restored, `voids` row written, `is_voided` + `voided_at`, reason recorded |
| `create_purchase` (credit, 3 × 50) | payable 150.00 |
| `record_supplier_payment` (50) | `payableAfter` 100, payable 100.00 |
| leftovers | 0 rows in sales, returns, customer/supplier payments, purchases, voids |

**8/8 PASS** (`backups/flows-2026-10-17-final.json`). Two production defects had to be fixed before
this could pass — the legacy NOT NULL `return_items.qty` and a `void_sale` that wrote a table
production never received — both in `0227`, applied and rehearsed the same way.

## 2. The production UI — PASS where a session exists, one gap named

The deployed site (`https://hisaabkitaab.dpdns.org`) was opened in the browser panel:

```
PASS  the build names its environment:  [EnvGuard] PRODUCTION → gkswcfljxlutkfdvvqng (otp: sms, key verified)
PASS  the login entry renders (Set PIN / Confirm PIN steps, EN with the UR toggle)
PASS  /admin/dashboard renders for the signed-in identity: Yaqoob Malik · Default Shop - Main,
      Total Sales Rs. 0 · Gross profit Rs. 0 · Credit collect Rs. 0 · 0 overdue · 6 out of stock
PASS  the Action Center agrees with the dashboard: the same 6 out-of-stock products
PASS  customers, reminders, notifications, memberships, users, companies, products, variants and
      sales all answer 200 — no 401/403/500 anywhere in the walk
PASS  the crops read the app makes returned 200 with the shop's crops (it returned 400 before §3)
PASS  no console errors on the customers or reminders screens (the two that were noisy before)
```

**What the UI walk does not cover, and why.** The browser arrived with a live production session
(`agri_auth` + `sb-gkswcfljxlutkfdvvqng-auth-token`), so the authenticated screens could be read
without writing anything — and were read only: no sale, payment, PIN, toggle or save was submitted
anywhere in the walk. What remains unverified is a *fresh* sign-in: production resolves to
`otp: sms`, so the demo bridge (`src/lib/auth.ts`, phone-derived password) is refused by design and a
new session needs an SMS to a real phone. See §6.

## 3. A real defect the UI walk found — fixed forward in `0228` — PASS

The Home/Customers/Reminders screens logged **`GET /rest/v1/business_settings?select=setting_value&
setting_key=eq.crops&limit=1 → 400`**, once per customer row. Production's `business_settings` was
still the pre-0093 shape (`id, owner_id, crops jsonb, updated_at`): the columns the client names do
not exist, so the crop-based market reminders were silently empty and the Action Center showed a
400 per row.

Asked generally instead of one column at a time — `scripts/audit-app-surface.mjs --env production`
reads every simple `.from(x).select(a,b)` and every `supabase.rpc(name)` in `src/` and asks the live
database for them:

| Before `0228` | After `0228` |
|---|---|
| missing columns: `business_settings.setting_value` (and the `setting_key` its filter uses), `customer_crops.acreage/.planting_date/.expected_harvest`, `reminder_configs.group_id/.group_name` | **PASS — 0 missing columns, 0 missing RPCs** (63 RPCs asked) |
| permissive policies live on `business_settings`, `customer_crops` and `reminder_configs` (`… _all` = `true`; `customer_crops_insert_anon` with no check) | every policy on the three tables is shop-scoped; the file raises if an always-true one survives |

`0228` adds the columns (additive; `shop_id` defaults to `current_shop_id()` so the app's own insert —
which sends no shop — is still scoped), backfills the one existing crops row, and replaces the
policies. Verified PASS on production's frozen baseline (6 statements, 0 failures), rehearsed on
production inside a rolled-back transaction **9/9** (`loadBusinessSettings` reads the row back,
`saveBusinessSettings` updates it, a first-time setting inserts and is stamped, `customer_crops`
accepts and returns the three columns, `reminder_configs` accepts a group and stamps its shop), then
applied through the gate after a backup that was restored and compared first.

`0229` names `return_items_mirror_qty()` for `tests/unit/writeRpcAnonGuard.test.ts`, the same way
`0226` named `stamp_operational_branch()` — the third retirement that had to be declared after the
file that created it was applied.

**Production's ledger is now 42 rows, latest `0229`.**

## 4. Cross-shop isolation, demonstrated with two real shops — PASS

Production has one shop, so the question ("can one shop's owner read or write another shop's rows?")
cannot be answered there. It was answered in QA, which has three shops with their own owners:
`npm run probe:isolation` (`scripts/dev/probe-two-shop-isolation.mjs`, new; one transaction, always
rolled back, every absence paired with a control).

**26/26 checks** (`backups/two-shop-isolation-2026-10-17.json`), including:

```
PASS  A: current_shop_id() is A;  branch scope contains A's own branch
PASS  A: create_sale completes, stamped with A's shop AND A's branch
PASS  B: cannot read A's sale / product / table-wide count
PASS  B: updating A's product changes no row; inserting into A is refused by RLS
PASS  B: create_sale against A's product refused (NOT_AUTHORIZED: product access denied)
PASS  B: create_sale for its own shop completes, stamped with B's shop and branch
PASS  A: cannot change B's sale (refused by grant, which is stronger than the policy that would also filter it)
PASS  A: a permission override for B's employee is refused by RLS (0218)
PASS  dual member (a person with an active membership in BOTH shops): the session resolves to exactly
      one shop, and the other shop's rows are invisible — 3 of A's rows, 0 of B's
PASS  A's sale decremented only A's variant; B's variant untouched
PASS  the probe left nothing behind (0 products, rolled back, QA unchanged)
```

## 5. The final production state — PASS

`scripts/measure-production-final-state.mjs --env production --json backups/final-production-verification-0229.json`
(READ ONLY transaction; 14/14).

| Question | Measured |
|---|---|
| Ledger | 42 rows, latest `0229`, nothing newer in the repository |
| Test transactions | **0** in sales, sale_items, returns, return_items, voids, purchases, purchase_items, customer/supplier payments, inventory_movements, stock_adjustments, notifications, audit_events, sale_submissions |
| Derived figures | 0 rows with a non-zero `customers.outstanding_balance/.total_purchases/.total_paid`, `products.stock_qty`, `product_variants.stock_qty`, `companies.outstanding_payable/.total_purchases` |
| Branch attachment | 0 rows missing `branch_id` across sales, purchases, returns, payments, movements, adjustments, notifications; the stamp trigger is attached to **9** operational tables |
| The repairs are objects, not just clean data | 9 stamp triggers · `return_items_mirror_qty_trg` present · `void_sale`'s body contains no `activity_log` · all 7 write RPCs present |
| Configuration | shops 1 · branches 1 · users 4 · memberships 4 · permissions 32 · roles 4 |
| The unauthenticated caller | `anon` holds **0** table privileges and **0** policies name anon/public; `set role anon; select from sales` → `permission denied` |
| The authenticated caller | 158 policies carry the `authenticated` role |

Reversibility for each apply: `backup …-17-02-56` (before `0227`) and `…-17-42-34` (before `0228`)
and `…-17-52-00` (before `0229`) were each restored into PGlite and compared with production —
integrity, replay, counts, structure, digests and auth all PASS.

## 5b. The ledger's file identity was corrected for four files — PASS

Found by the same measurement, after the applies: `schema_migration_files` held CRLF-derived hashes for
`0222`, `0224`, `0225` and `0227` (the working copies were written on Windows), while `.gitattributes`
declares `*.sql` as `text eol=lf` — so a fresh checkout could never reproduce those hashes, and "the
recorded hash matches the file on disk" would have been a Windows-only truth.

For each file: rewritten with LF, then the file's statements and `schema_migrations.statements` were
split with the project's splitter, normalised and compared — **identical, in order** (2 / 27 / 1 / 5
statements) — and only then were `sha256`/`bytes` re-recorded in one transaction with `reconciled_at`
and a note; `applied_at` untouched, no statement changed. `backups/final-production-verification-0229.json`
now carries the assertion for every file: **221 checked, 0 drifted**, 42 statement rows · 34 file rows
(the 8 below `0017` predate the tooling).

## 6. What is still not verified, and the exact action needed

1. **A fresh production sign-in.** The only authenticated session that exists is a leftover in the
   browser profile. Production resolves to `otp: sms`, so a new sign-in requires an SMS to a phone
   that can receive it. *Action needed: sign in yourself on a real number and tell me the screens you
   want walked, or confirm an SMS provider is configured and give me a number to use.* Nothing in the
   sign-in path was changed or bypassed.
2. **RESOLVED 2026-10-18** — the identities below were removed, with their logins and the catalog
   they created, by `scripts/clean-production-demo-data.mjs` after a rehearsal and a verified
   backup. Evidence: `production-demo-identities-removed-2026-10-18.md`. The original finding is
   kept verbatim: **Two leftover identities that will look like a real user's.** `public.users` still holds
   `Test QA User` (`923001999999`, admin) and the demo pairs `Yaqoob Malik`/`923001234567` and
   `Akram`/`923001122334`, and `auth.users` holds two identities whose phones are those demo numbers.
   They are configuration, not transactions, so the earlier cleanup left them. They cannot breach
   anything (RLS scopes them, and they hold no PIN), but they are the rows a real person's phone could
   collide with. *Action needed: say whether to remove them, and I will do it as a migration with the
   same backup/restore/verify cycle.*
3. **The production build was not rebuilt or redeployed.** The database was the thing that differed
   (`0228`), and the deployed bundle already asks for the right columns; no deployment was made, so
   nothing here should be read as a deployment.
