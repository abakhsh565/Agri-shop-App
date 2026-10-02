# AgriShop — Production Readiness Audit

**Date:** 30 September 2026
**Scope:** read-only audit of the repository, GitHub workflow configuration, and the live
Supabase database that this repo has credentials for.
**Changes made to your data or schema: none.** Everything below was observed with `SELECT`
only, through `scripts/audit-production-readiness.mjs` (new, read-only, re-runnable).

Re-run any time with:

```bash
node scripts/audit-production-readiness.mjs          # summary
node scripts/audit-production-readiness.mjs --full   # + every RLS policy body
```

---

## A. Current architecture (what you actually have today)

```
GitHub:  main  ──────────────────────────────►  Vercel  ──►  Supabase project
                 (only branch that matters)        (one          bpybjrjenwccwvtrevu
                 + origin/design/admin-dashboard-polish         ("QA")

Android: push to main ──► build-apk.yml ──► release APK ──► same QA project
                                          (demo OTP mode)

Backups: nightly cron ──► scripts/backup-database.mjs ──► artifact (30 days)
                          reads QA_DB_*  → backs up QA
```

**The stack.** React 19 + Vite 8 + TypeScript SPA, Tailwind v4, Zustand, React Router 7,
Supabase JS, applied to Android through Capacitor 7. Data access is deliberately centralised:
money and stock moves go through `SECURITY DEFINER` RPCs (`create_sale`, `create_purchase`,
`record_customer_payment`, `adjust_stock`, `process_return`, …), not direct table writes. Reads
go through stores. This is a good architecture to scale — the problems below are configuration
and discipline, not the shape of the code.

**What is already right, and should be left alone:**

| Good thing | Evidence |
|---|---|
| RLS is enabled on **every** one of the 54 public tables | 0 tables without RLS |
| 64 of 83 policies are tenant-scoped through `current_shop_id()` | policy inventory |
| Atomic writes already go through SECURITY DEFINER RPCs | `src/lib/db.ts` |
| No service-role key anywhere in client code | grep of `src/`, `utils/`, `index.html`, vite/capacitor config |
| No `.env` file was ever committed | full git history scan |
| Release keystore, APKs, `/android/`, `/ios/` are gitignored | `.gitignore` |
| A password/idempotency layer already exists on sales | migration 0134, `reentrancyGuard` |
| Real browser E2E + node-vs-PGlite guards | 38 unit, 33 integration, 32 e2e specs |

**The three environments you asked for do not exist yet.** What exists is one database used by
everything:

- `.env.local` (dev) and `.env.qa` (tests) point at the **same** project — `bpybjrjenwccwvtrevu`.
  Dev and "testing" are the same database today.
- A **production** Supabase project *does* exist, and the repo already knows its name:
  `utils/supabase/info.tsx` hardcodes it as the fallback.

```ts
// utils/supabase/info.tsx  —  COMMITTED FILE
export const projectId   = import.meta.env.VITE_SUPABASE_PROJECT_ID || "gkswcfljxlutkfdvvqng"
export const publicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY   || "sb_publishable_…"
```

`src/lib/envGuard.ts` names the same ref as `PRODUCTION_PROJECT_ID`. So the isolation is
**inverted**: the safe environment is the one you must remember to specify, and the production
one is what you get when you forget.

---

## B. Problems and risks found

Severity: 🔴 blocks real users · 🟠 fix before launch · 🟡 fix during the first month.

### 🔴 B1. Anyone who knows a phone number can sign in as that person

The app accepts a **fixed code `123456`** for any registered phone number, and every build
currently ships that way.

- `src/lib/authMode.ts`: `OTP_DELIVERY_MODE = import.meta.env.VITE_OTP_DELIVERY === "sms" ? "sms" : "demo"` — the *default is demo*.
- `DEMO_OTP_CODE = "123456"`, accepted in `verifyOTPAndResolveUser()` for any phone.
- `VITE_OTP_DELIVERY` is set **nowhere** — not in `build-apk.yml`, not in `vercel.json`, not in any script.
- Consequence: every APK and every Vercel deploy is a demo-OTP build. Sign-in = phone number + `123456`, and the demo path then bridges into a real Supabase Auth session derived from the phone (`user-<e164>@agrishop.auth.local`).

Today this only reaches test data. The moment any build points at production, it is a complete
authentication bypass. **This is the single most important item in this report.**

### 🔴 B2. Development, staging and production are one database, and the *unsafe* default is production

- Dev and QA share `bpybjrjenwccwvtrevu`.
- If `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing at build time, `supabase.ts` and
  `info.tsx` fall back to the hardcoded production project. `envGuard.ts` throws only when
  `import.meta.env.DEV` is true — i.e. only on the Vite dev server. **A staging or preview
  deploy built without env vars silently becomes production**, and nothing in the UI says so.
- No test covers `envGuard` (grep of `tests/`: zero hits).

### 🔴 B3. Any signed-in user can read every other shop's cost prices

```sql
-- policy on public.product_variants
product_variants_select : SELECT, role {authenticated}, USING (true)
```

`product_variants` holds `selling_price`, `cost_price`, `stock_qty`. Three roles can read it
through the anon key, unaffected by which shop they belong to. `product_variants_update` and
`_insert` are guarded by `app_is_admin()`; the SELECT is wide open.

### 🔴 B4. Employees cannot load the product catalogue at all (live bug)

`src/stores/productsStore.ts`:

```ts
isAdmin ? supabase.from("product_variants").select("*").eq("is_active", true)
        : supabase.from("product_variants_public").select("*"),
```

**`product_variants_public` does not exist** in the database (the only views are `tenants` and
`users_public`). Non-admin users therefore take a query that always errors, and the error path
`if (pErr || vErr) { … return; }` silently keeps cached data. Every employee account loses the
catalogue. This looks like the *intended* fix for B3 — a masked view that never got created, on
top of a policy that was widened to `true` instead.

### 🟠 B5. No record of which migrations have run — **RESOLVED 2026-10-01, staging only**

**What it was.** `supabase/migrations/` held 167 files; `supabase_migrations.schema_migrations` held
**3 rows** (`0009`, `0010`, `0011`). Deployments bypassed the CLI via the `run_sql` RPC, so the
database could not tell you what had been applied. Two files broke the numbering convention
(`0042b_security_rls_fix.sql`, `20260903_credit_limit_requests__reminder_groups.sql` — the latter
sorted *after* `0174`, so a naive replay applied it last).

**What was done.** `0042b` was merged into `0042`; `20260903` was renumbered to the free canonical
slot `0060` (before `0062`, the migration that deploys the same table). The directory now uses one
canonical `<4 digits>_<name>.sql` per version, enforced by `tests/unit/migrationReplayability.test.ts`.
`scripts/migrate.mjs` replaces the unrecorded deploy script (`scripts/deploy-migrations.mjs`, now a
refusal): it records every applied file, with its sha256, in the same transaction as the file, and
`verify` fails on a pending file, a recorded version with no file, a file edited after it was
applied, a recorded row with no hash, or a file numbered before the newest recorded version. The CI
test job runs it read-only against staging, and the ledger was adopted on staging for the existing
167 files (`0009` → `0175`) with per-file object evidence.

**Decided and closed (2026-10-01).** The schema strategy (§D) is recorded in `SCHEMA_STRATEGY.md`:
frozen environment baselines + forward-only files, each verified against the target's baseline
before it is applied. Production is never replayed, never adopted into this ledger, and the runner
refuses it by policy; its baseline (`supabase/baseline/production-baseline.json`, 8 ledger rows,
latest `0016`) is what new files are checked against in PGlite. On staging, two adopted files have declared objects that are absent
(`0015`'s `product_variants_public` — the B3 finding, never created; `0019`'s `reject_shop_request`
and two `shops` onboarding columns), so their adoption is recorded with that caveat rather than
silently. Evidence: `PHASE_2_MIGRATION_LEDGER.md`.

**Superseded text, kept for context:** the original finding read that the live database disagrees
with git and that `tests/unit/migrationReplayability.test.ts` guards part of this.

Also relevant to your safety requirement: **migrations 0170–0174 exist only in the QA database
and are not committed.** The database is ahead of git.

### 🟠 B6. The "Production" backup job backs up QA, and no restore has ever been tested

`.github/workflows/backup-database.yml` is named *Backup Production Database*, runs daily at
02:00 UTC, and reads `QA_DB_HOST / QA_DB_USER / QA_DB_PASS`. Retention is 30 days as a GitHub
artifact. There is **no restore script** (`scripts/` has none) and no evidence a restore was ever
performed. A backup that has never been restored is a hope, not a backup.

### 🟠 B7. Local database dumps are not gitignored

`scripts/backup-database.mjs` writes `backups/backup-<timestamp>.sql` containing every row of
every table. `.gitignore` does not mention `backups/`. Running it locally and then committing
would publish real customer data, orders and phone numbers.

### 🟠 B8. `anon` holds write grants on 34 tables

The anonymous role has INSERT/UPDATE/DELETE/TRUNCATE privileges on 34 public tables (`customers`,
`sales`, `payments`, `users`, `products`, …). RLS currently blocks these — none of those tables
has a policy for `anon` — so this is not an open door *today*. It is a loaded gun: a single
future `CREATE POLICY ... FOR ALL` without a role clause turns into anonymous writes to real
business data.

Related, three policies are permissive rather than scoped:

| Policy | Allows |
|---|---|
| `product_variants_select` | every authenticated user reads every shop's variants (B3) |
| `app_settings_select` | every authenticated user reads all app settings — never put a secret in this table |
| `permissions_select` | role `public` reads the permission catalogue — harmless, but should be `authenticated` |

And one that damages audit integrity: **`audit_events_insert` has `CHECK (true)`** — any
authenticated user can insert arbitrary audit rows, including for other shops. The audit log
cannot be trusted as evidence while that is true.

### 🟠 B9. Nothing is monitored

No error tracking, no performance monitoring, no alerting: grep for
`sentry|posthog|datadog|logrocket|bugsnag|newrelic` across `src/` and `package.json` returns
nothing. `src/components/ui/ErrorBoundary.tsx` logs to the console only — which on a phone in a
village is nowhere. You will not learn that logins are failing.

### 🟠 B10. Deployment flow is not reversible and has no approval step

`build-apk.yml` triggers on **push to `main`**. There is no `staging` or `develop` branch
(`git branch -vv` shows only `main`; the single other remote branch is
`design/admin-dashboard-polish`). Every push to `main` is a production release, with no gate and
no documented rollback. The README-level flow you described does not exist yet.

### 🟡 B11. Lists are capped, not paginated

`.limit(n)` appears in only **6 files**; the rest of the list screens load everything.

- `customersStore.load()` — `select("*")` of all non-archived customers, no limit, ordered by name, cached, and **re-fetched in full on every realtime change to `customers`**.
- `productsStore.load()` — all active products + all variants, same pattern.
- History lists (`salesStore`, `notificationStore`, `db.ts`) use `.limit(200)` — a hard ceiling, not pagination. After 200 sales a shop silently cannot see older records.

At 100 customers this is fine. At 5,000 it is a full-table download on every edit, on every
device in the shop.

### 🟡 B12. 32 foreign keys have no supporting index

`SELECT` joins and cascade checks on these columns do sequential scans. The full list is in the
audit output; the heaviest are `sale_items`, `purchase_items`, `return_items`, `payments`,
`product_variants`, `reminder_*`, `inventory_movements`.

### 🟡 B13. The production database is the development tooling's scratchpad

15 tables are RLS-on with **zero policies** (deny-all). Eleven of them are not product tables at
all — they belong to the engineering/agent tooling: `agent_attempts`, `agent_tasks`,
`engineering_memory`, `frontend_dependency_graph`, `impact_analyses`, `impact_mappings`,
`incident_rate_limits`, `incident_signatures`, `incidents`, `known_resolutions`,
`resolution_regression_tests`.

The remaining four are deliberate deny-all and confirm the RPC-only pattern:
`payments`, `shop_requests` (both reachable only through SECURITY DEFINER RPCs — verified in
`shopRequestsStore.ts` and `db.ts`), plus two tables nothing in `src/` references at all:
`activity_log` and `daily_cash_reconciliations` (superseded by `audit_events` and
`cash_reconciliations`). Those two are dead weight to retire, not to protect.

**Do not create a production project by copying this schema.**

### 🟡 B14. Three SECURITY DEFINER functions without a pinned `search_path`

139 functions are `SECURITY DEFINER`; 3 do not pin `search_path`:
`get_authenticated_user_id`, `get_my_shop_request`, `process_reminders`. A `SECURITY DEFINER`
function that resolves unqualified names can be tricked into executing a caller-supplied object.

### 🟡 B15. `user_permissions` writes are not scoped to the target's shop

`user_permissions_insert` checks that the *actor* is a global admin, but never checks that the
`user_id` being granted belongs to the actor's shop. An admin of one shop can grant permissions
to a member of another.

### 🟡 B16. All four storage buckets are public

`company-logos`, `customer-images`, `employee-photos`, `product-images` are all
`public=true` — anyone with the URL reads them forever, including employee photographs, with no
signed-URL expiry. Product images being public is a reasonable choice; employee photos are not.

---

## C. What needs to change

Ordered so that each step is safe on its own.

1. **Close the demo-OTP hole.** Decide the launch mode, make the unsafe mode impossible to ship
   by accident, and add a guard so a future build cannot silently reintroduce it.
2. **Make environment identity explicit and loud.** Remove the production fallback from
   `supabase.ts` and `info.tsx`; require env vars; show which environment the app is connected to.
3. **Create the third database.** One project per environment. Dev gets its own, QA becomes
   staging, production is fresh and schema-built from migrations only.
4. **Fix the three RLS defects:** `product_variants_select` scoped to the shop,
   `audit_events_insert` no longer `true`, `user_permissions` insert scoped to the target's shop.
   Create `product_variants_public` (or delete the reference) so employees get a catalogue.
   *Still open on staging as of 2026-10-01 — these three are policy changes with product behaviour
   behind them (the employee catalogue, the audit trail, admin permission editing), so they are a
   change set of their own rather than a rider on the migrations that are already applied.*
5. **Revoke the `anon` write grants.** ✅ staging, 2026-10-01 (`0176_no_anonymous_writes.sql`):
   34 of 54 tables granted `anon` INSERT/UPDATE/DELETE — now 0 — and `anon` lost CREATE on the
   schema. Verified through PostgREST with the anon key: writes refused at the privilege layer,
   reads and the pre-login `insert_shop_request` RPC unaffected. Defence in depth, so RLS is not the
   only thing between the internet and your data. Evidence: `PHASE_2_MIGRATION_LEDGER.md` §13.
6. **Pin `search_path`** on the three remaining functions. ✅ staging, 2026-10-01
   (`0177_a_definer_knows_where_it_looks.sql`): `get_authenticated_user_id`, `get_my_shop_request`
   and `process_reminders` now carry `search_path = public`; 0 SECURITY DEFINER functions remain
   unpinned, and all three still execute. Evidence:   `PHASE_2_MIGRATION_LEDGER.md` §13. **Not applicable to production as written** — measured
   2026-10-01: neither `get_my_shop_request(text)` nor `process_reminders()` exists there, and the
   baseline check says so (`SCHEMA_STRATEGY.md` §3). Production's equivalent must be catalog-driven
   (pin whatever is present and unpinned), verified against the production baseline like
   `backups/migration-proof/corpus-d/0178_pin_search_path_where_present.sql` is.
7. **Make migrations real:** ✅ staging (2026-10-01) — `scripts/migrate.mjs` records every applied
   file with its sha256 in the same transaction, `verify` is the CI check, and both odd filenames are
   normalised (`0042b` merged into `0042`, `20260903` renumbered to `0060`). See
   `PHASE_2_MIGRATION_LEDGER.md`. §D is decided (2026-10-01, `SCHEMA_STRATEGY.md`): production is
   deliberately excluded from any replay or adoption, and the runner refuses it by policy.

**2026-10-01 — duplicate-sale protection pinned, browser lane unblocked.** The owner's double-click
report now has evidence at both layers: `tests/integration/saleIdempotency.test.ts` (two concurrent
confirms with one key → one sale, stock once, purchase total once; a retry returns the same sale;
`create_sale_unchecked` refused to authenticated clients) and a browser test in
`tests/e2e/doubleTapSafety.spec.ts` (real Chrome: two clicks in one task → one sale, one line, stock
once, reload shows one row). The live confirm screen (`CartPage`) is now in the re-entry guard — it
previously asserted only the unrouted `SaleReviewPage`, a real guard gap. The browser lane was
blocked by a native-ESM JSON import that Node 24 refuses without an import attribute; fixed.

**OPEN — committed e2e specs vs in-flight UI/copy work (not protection regressions).** `accessUx`
(the Add Employee screen no longer renders the "Access from this role" panel it asserts;
`AddEmployeePage.tsx` is modified in the working tree), `voidSaleSafety` (button copy moved
"Cancel Sale" → "Delete this sale"; `i18n.ts` modified), and both `adminFullAccess` tests (the
account-deletion gate became a 4-step wizard while the test expects the typed-name dialog;
`AdminSettingsPage.tsx`/`i18n.ts` modified). The underlying destructive-action protections are
proven separately (`duplicateActionSafety` 7/7, including double-void → one void and stock once).
Evidence, snapshots and triage: `PHASE_2_BROWSER_SAFETY.md`.
8. **Backups that have been restored.** Fix the target, add a restore drill, ignore `backups/`,
   and set the retention policy you actually want.
9. **Branches and gates.** `develop` → `staging` → `main` with protection, PRs, and tests that
   block a merge into `main`. Add a rollback procedure (Vercel instant rollback + APK
   version pinning).
10. **Monitoring.** Error tracking that survives a phone restart, with alerts. Never log phone
    numbers, names or tokens.
11. **Pagination and indexes** before the data grows, not after.
12. **Retire the dead tables** (`activity_log`, `daily_cash_reconciliations`) and keep the
    engineering-OS tables out of production entirely.

---

## D. Exact implementation plan

### Phase 0 — Decisions only you can make (no code)

1. **SMS provider for real OTP.** Supabase Auth → Phone → enable an SMS provider (Twilio,
   MessageBird, etc.). Until this is live, *do not give the app to real users.* If you must delay
   it, the fallback is to keep production sign-in disabled rather than keep `123456` working.
2. **Which Supabase project is production?** `gkswcfljxlutkfdvvqng` is referenced as production
   in the code. Confirm in the dashboard whether it holds real data or is empty. If it holds real
   data it is already in use and must be treated as live.
3. **How many projects?** Recommended: `agrishop-dev`, `agrishop-staging`, and keep the existing
   one as production *only if step 2 says it is clean*; otherwise create a fresh production.
4. **Vercel project layout.** One project with three environments (Production = `main`,
   Preview = `staging`, Development = `develop`) is simplest and is what your prompt describes.

### Phase 1 — Stop the bleeding (safe, no data touched)

| Step | Change | Risk |
|---|---|---|
| 1.1 | Delete the production fallback in `utils/supabase/info.tsx`; throw if `VITE_SUPABASE_URL` is absent | none — build-time only |
| 1.2 | Make `envGuard` fail at *runtime and build time* when the environment is unknown, not only under `import.meta.env.DEV` | none |
| 1.3 | Show the connected environment in the app for non-production builds | none |
| 1.4 | Add a guard test: a build with `VITE_OTP_DELIVERY` unset and `VITE_APP_ENV=production` must fail | none |
| 1.5 | Add `backups/` to `.gitignore` | none |
| 1.6 | Set `VITE_OTP_DELIVERY=sms` in the build config and require it for production builds | needs Phase 0.1 |

### Phase 2 — Database security fixes (each a migration; none delete data)

```sql
-- 0175: the same fix B3/B4 describe from both sides
CREATE OR REPLACE VIEW public.product_variants_public AS
  SELECT v.id, v.product_id, v.name, v.sku, v.selling_price, v.unit_size,
         v.qty_step, v.low_stock_threshold, v.expiry_date, v.stock_qty,
         v.is_active, v.created_at, v.updated_at, v.batch_id
  FROM public.product_variants v
  WHERE v.is_active;
-- cost_price deliberately absent.
ALTER VIEW public.product_variants_public SET (security_invoker = true);

DROP POLICY product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT TO authenticated
  USING (app_is_admin());            -- employees read the view instead.
```

> Note: tightening this policy changes what employees can read. It is written as a migration and
> nothing is dropped, but it must be tested with an employee account before it goes to a real
> database. **This is one of the changes I will not make without your approval.**

Also: `audit_events_insert` → scope to the actor's shop; `user_permissions_insert` → add the
target-shop check; `permissions_select` → `authenticated`; revoke `anon` grants;

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
```

plus `ALTER FUNCTION … SET search_path = public` on the three functions.

### Phase 3 — Environments

1. Create `agrishop-dev` and `agrishop-staging` Supabase projects.
2. Build each schema by **replaying `supabase/migrations/` in order** — never by copying.
3For the production project: replay migrations, then verify with the audit script.
4. Local files: `.env.development` → dev, `.env.staging` → staging, `.env.production` → production.
   All remain gitignored. Add `.env.example` with the *names* only.
5. Vercel → Settings → Environment Variables: set each scope's `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID`, `VITE_APP_ENV`, `VITE_OTP_DELIVERY`.
6. GitHub → Settings → Secrets: add `STAGING_*` alongside the existing `QA_*`; add production
   secrets only when you are ready to release, and never the service-role key to anything that
   ships to a browser or a phone.

### Phase 4 — Git flow

```bash
git checkout -b develop        # from main
git push -u origin develop
git checkout -b staging
git push -u origin staging
```

Then on GitHub: protect `main` (require PR, require the test job, no force-push, no direct
push), protect `staging` similarly, and switch `build-apk.yml` to run on `main` only after the
test job passes. Feature work: `feature/*` → PR into `develop` → PR `develop`→`staging` →
PR `staging`→`main`.

**Before any of this: commit the working tree.** There are ~24 modified files and 5 uncommitted
migrations that exist only in the QA database. Right now a `git checkout` would lose the
database's own migration files.

### Phase 5 — Backups and restore

1. Rename the workflow to *Backup Staging Database*, point it at staging.
2. Add production backups using `PROD_DB_*`, or enable Supabase's managed daily backups
   (see Phase 0 / dashboard).
3. Write `scripts/restore-database.mjs` — the missing half of the backup story.
4. **Do a restore drill into a scratch project** and record the result. Schedule it quarterly.
5. Decide retention: 30 days of artifacts is not a retention policy.

### Phase 6 — Monitoring, then scaling

Error tracking wired into `ErrorBoundary` and the RPC call sites, with alerts on auth failures
and RPC error rates; then pagination for customers, products, sales; then the 32 indexes.

---

## E. Potentially destructive changes — for your approval

Nothing here has been done. Each is reversible or additive unless noted.

| # | Change | Blast radius | Why it is safe |
|---|---|---|---|
| E1 | `REVOKE` anon write grants | anon loses write *privileges*; RLS already blocks it | privileges only, no data, reversible with `GRANT` |
| E2 | Replace `product_variants_select` with an admin-scoped policy + create the masked view | employees lose direct access to `product_variants`; must go through the view | additive view first, policy second; verified with an employee login |
| E3 | Scope `audit_events_insert` to the actor's shop | audit rows can no longer be written cross-shop | no existing rows affected |
| E4 | Normalise the two odd migration filenames | changes replay order | no database effect; git rename only |
| E5 | Drop `activity_log`, `daily_cash_reconciliations` | **permanent loss of those two tables** | not referenced anywhere in `src/`; requires a targeted backup first. Recommend: approve only after the two backups exist |
| E6 | Add the 32 indexes | brief write slowdown while building | `CREATE INDEX CONCURRENTLY` avoids locking |
| E7 | Fresh production project | none — new, empty | existing project untouched |

**Explicitly not proposed:** deleting or renaming any column, dropping `payments` or
`shop_requests`, or touching the existing `bpybjrjenwccwvtrevu` project.

---

## F. Backup requirements

| What | How | Where | Retention | Restore tested? |
|---|---|---|---|---|
| Staging DB | nightly workflow (exists, retarget) | GitHub artifact | 30 days | **no — must add a drill** |
| Production DB | Supabase managed daily backups + PITR if the plan allows | Supabase | per plan | **no** |
| Pre-migration snapshot | `node scripts/backup-database.mjs` before any approved destructive step | local, gitignored | until the change is verified | yes, spot-check |
| Auth users | Supabase Auth is separate from the SQL dump — `auth.users` must be backed up by Supabase's own backup, not by hand | Supabase | per plan | n/a |
| Android keystore | already in GitHub secrets | GitHub | permanent | validated by the signing job |

Your requirement — *"a backup that cannot be restored is not a backup"* — is currently unmet.
The restore drill is the deliverable that closes it.

---

## G. Testing plan

**Before production.** Every line is a real check on a real environment, not a claim.

*Sign-in / accounts*
- [ ] New phone sign-up end to end
- [ ] Login with a real SMS code (not `123456`) — and prove `123456` is **rejected** in production
- [ ] Wrong code, expired code, code for another user's phone
- [ ] Invited employee signs in through an invitation link
- [ ] Logout, then login again; session survives an app restart
- [ ] Account deletion: the account is gone, other users' data is untouched
- [ ] Employee with no permissions sees no admin screens

*Data and tenancy (the ones that matter most)*
- [ ] User A cannot read, update or delete User B's customers/sales/products — attempted with the anon key directly, not through the UI
- [ ] An employee of shop A cannot read shop B's `product_variants`
- [ ] An employee *can* read their own catalogue (this is B4 — it fails today)
- [ ] Amounts, stock and credit are correct after: sale, purchase, payment, return, void, stock adjustment
- [ ] Repeat-submit a sale with the same idempotency key → exactly one sale

*Safety*
- [ ] Migration replay against a fresh empty project produces the expected schema
- [ ] Restore the latest backup into a scratch project and compare row counts
- [ ] Roll back a Vercel deployment and confirm the previous build serves correctly

*Poor connectivity (this is an agriculture app; the network is the normal case)*
- [ ] Airplane mode during save → a message that says the data was **not** saved, with Retry
- [ ] Airplane mode on load → cached data with a visible offline marker
- [ ] Reconnect → the queued action completes exactly once
- [ ] App killed mid-save → no partial row, no duplicate row

*Mobile*
- [ ] Every screen at 360 px width, EN and UR (including RTL on numbers and phone fields)
- [ ] Release APK installs and signs in on a real device

---

## Manual steps only you can do

1. **Supabase dashboard** → confirm whether `gkswcfljxlutkfdvvqng` holds real data; create the dev/staging projects; enable an SMS provider; turn on managed backups/PITR; check Auth → Rate Limits; check Storage bucket policies.
2. **Vercel dashboard** → three environments with separate variables; confirm the Production scope does *not* inherit QA variables; note the instant-rollback procedure.
3. **GitHub** → create `develop` and `staging`; enable branch protection on `main` (PRs required, test job required, no force-push); add staging secrets.
4. **Decide the OTP launch mode** (Phase 0.1). This gates everything else.
5. **Approve or reject E1–E7.**

---

## Answering your checklist directly

| Your item | Status |
|---|---|
| Separate DEV/STAGING/PROD Supabase projects | ❌ one project for everything |
| RLS enabled + policies tested | 🟠 enabled everywhere, 3 policies need work, tenancy tests not run against real cross-user attempts |
| Migrations version-controlled | 🟠 167 files, database ledger disagrees, 5 files uncommitted |
| Backups + restore procedure | 🟠 backup targets the wrong DB; no restore exists |
| No secrets in GitHub | ✅ no `.env` ever committed, no service-role in client code |
| Branch protection / PRs | ❌ only `main`, releases on every push |
| Vercel env separation | ❌ none in repo; dashboard unverified |
| Rollback plan | ❌ none |
| Error handling / offline / retry | 🟠 `offlineQueue`, `ErrorBoundary`, `friendly()` exist; not verified against real disconnect |
| Duplicate submission protection | ✅ idempotency key on sales, `reentrancyGuard` |
| Signup / login / reset / session / deletion | 🟠 implemented, but gated by the demo-OTP hole |
| Pagination | ❌ absent; 200-row caps |
| Indexes / constraints | 🟠 32 unindexed FKs |
| Monitoring | ❌ absent |
| App versioning | ❌ `package.json` is `1.0.0` and never bumped per release |

---

## The honest summary

The **code** is in better shape than the **configuration**. Tenant scoping is real, atomic
writes go through RPCs, secrets are clean, and the test suite is unusually serious for a project
at this stage.

What is missing is everything around the code: three environments do not exist, every build
ships the `123456` login code, the production credentials are the *default* rather than the
exception, employees cannot load the catalogue, one policy leaks every shop's cost prices, and
the backup job has never been restored by anyone.

None of that needs a rewrite. It needs Phase 1 and Phase 2 — roughly a day of focused work —
before the first real phone number is registered.
