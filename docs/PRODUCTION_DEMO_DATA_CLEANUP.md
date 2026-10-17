> **EXECUTED 2026-10-18.** The demo identities — and the catalog they created — were removed from
> production by `scripts/clean-production-demo-data.mjs` (rehearsed, backed up, then applied with an
> explicit confirmation token). The tenant shell was kept on purpose: production has no
> `approve_shop_request`, so deleting the shop would leave no route back to a working tenant. See
> [`device-evidence/production-demo-identities-removed-2026-10-18.md`](../device-evidence/production-demo-identities-removed-2026-10-18.md).
> The runbook below describes the older, all-or-nothing tenant decision and is kept for that case.

# Cleanup runbook — the demo rows in production

**Owner-run.** Nothing in this repository connects to production, so this is a runbook, not a
script: every statement is here to be read before it is pasted anywhere. Nothing in it has been
executed. The commands that *measure* are safe and repeatable; the statements that delete are
written to be **dry-run first** and they end in `rollback;` as committed, so the file cannot delete
anything until a human changes one word on purpose.

* Policy it serves: [`PRODUCTION_DATA_POLICY.md`](PRODUCTION_DATA_POLICY.md) §6
* What production is: `gkswcfljxlutkfdvvqng`. Free plan: no PITR, no managed backups.
* Measured from the newest artifact (`2026-10-01`, via `npm run audit:production-data`, **exit 1**).

## Why this exists

The seeding migrations created a demo tenant in every environment they ran in, and production got
it: a shop named `Default Shop` (`00000000-0000-0000-0000-000000000001`), four accounts — two on
demo phone numbers, one literally named `Test QA User` — and 23 rows keyed by demo identities.

Two things make this decision harder than "delete the test rows", and both are measured, not
guessed:

1. **The demo tenant is the *only* tenant, and it holds the operations.** 79 of 268 rows are scoped
   to it, including **all 52 sales and all 20 customer payments**, and 40 of those sales belong to
   the three demo-keyed customers. So there is no small "test island" to pluck out.
2. **Most deletion is blocked by history.** 55 of the 56 foreign keys in production are
   `NO ACTION`, not `CASCADE`. Accounts that recorded sales cannot be deleted without deleting the
   sales; suppliers named `TEST` own products and payments. The database will refuse, which is the
   correct behaviour — and it is why Plan B below reassigns rather than deletes where a human
   decision is involved.

### What production holds (2026-10-01 artifact)

| Table | Rows | Demo-keyed | Note |
|---|---|---|---|
| `shops` | 1 | 1 | `00000000-…0001` named `Default Shop` |
| `users` | 4 | 2 | `…0002` Yaqoob Malik (admin, demo phone), `…0003` Ahmed Khan, `84deb713…` **Test QA User**, `c333f839…` Akram (demo phone) |
| `auth.users` | 2 | — | `84deb713…` (Test QA User) and `e7cbbff3…` — **an orphan login with no `users` row** |
| `customers` | 6 | 3 | `…0050` Muhammad Ali (5 sales), `…0051` Ahmad Raza (27 sales, 8 payments), `…0052` Bilal Ahmed (8 sales, 12 payments) |
| `companies` | 4 | 3 | `…0010` **TEST** (2 products), `…0012` **TEST** (1 product, 2 supplier payments), `…0011` AgriChem Solutions, plus `27efff20…` Hybrid seed |
| `products` / `product_variants` | 6 / 12 | 4 / 10 | |
| `sales` / `sale_items` | 52 / 57 | — | all under `Default Shop` |
| `customer_payments` | 20 | — | |
| `inventory_movements`, `stock_adjustments`, `notifications`, `voids` | 17, 13, 51, 3 | — | |
| `returns` / `return_items` | 1 / 1 | — | the return is `processed_by` the Test QA User |
| `supplier_payments`, `customer_crops`, `app_settings`, `business_settings`, `shop_requests` | 2, 4, 5, 1, 4 | — | |
| `audit_events`, `purchases`, `purchase_items`, `credit_limit_requests`, `cash_reconciliations`, `reminder_*` | **0** | — | the runbook still names them, so it stays correct if that changes. **`audit_events` is deleted by Plan A too** — history that belongs to the tenant being removed goes with it, and its counts are printed before and after rather than assumed to be zero |

## Preconditions — all three, before any statement below

**1. A fresh, verified backup exists.** This is the actual blocker today: the daily backup has
**failed on every scheduled run from 2026-10-03 to 2026-10-13** because `PROD_DB_PASS` is not
configured (the workflow refuses loudly rather than backing up nothing). The newest artifact is
**2026-10-01**.

```bash
gh secret set PROD_DB_PASS          # then add PROD_DB_HOST / PROD_DB_USER if missing
gh workflow run backup-database.yml -f environment=production
gh run watch                        # the run must end green: backup AND its isolated restore
```

A run that ends green has taken the backup *and* replayed it into a throwaway database with
`restore-verify.mjs`. If it is not green, stop — do not run any delete. Recovery path:
[`DOCS/RECOVERY.md`](RECOVERY.md).

**2. The baseline is recorded.** `npm run audit:production-data` (read-only) — on the 12-day-old
artifact it exits `1`. Capture the output; it is the "before" the "after" is compared against.

**3. The counts match this document** — or the differences are understood. Step 1 measures them.

## How this runbook was checked (offline, before you run it)

The delete *order* is the part that fails in practice — 55 of the 56 foreign keys are `NO ACTION`,
so a delete that runs one table too early aborts mid-transaction. The order here was not reasoned
about, it was executed:

```bash
npm run verify:cleanup-runbook          # newest production artifact, loaded into an in-process Postgres
```

`scripts/verify-cleanup-runbook.mjs` loads the artifact into PGlite (a throwaway database inside the
process — no network, no credentials, nothing to do with the live project), runs each plan's own
statements minus the final `rollback;`, and then rolls back:

| Checked | Result on the 2026-10-01 artifact |
|---|---|
| The artifact loads cleanly | **788 statements, 0 failures**, 56 foreign keys in place |
| Plan A against a database given a second, real shop | **refuses** — "STOP: production holds 2 shop(s)…" — and deletes nothing (sales stay 52) |
| Plan A against the demo tenant alone | **all 30 tables → 0** — the 28 public tables production has, plus `auth.users` and `auth.identities` — then `rollback` restores sales to 52 |
| Plan A's **coverage of the schema** | **names all 20 tables that hold rows, of 30 present.** The table list is read from the loaded schema rather than written by hand, so a table added by a later migration is either named by a `delete from` or the check fails |
| Plan A's **postcondition** | its own AFTER step raises if any public table is non-zero or a login remains, so a table this file forgot fails the transaction instead of surviving it |
| Non-vacuity — the FK order | with `delete from public.customers;` removed, the run **fails**: `customers_created_by_fkey` blocks the `users` delete (exit 1) |
| Non-vacuity — the coverage rule | with `delete from public.app_settings;` removed, the run **fails and names the table**: *"Plan A never deletes from table(s) that hold rows: app_settings(5)"* (exit 1) |
| Plan B | users 4 → 3, logins 2 → 0, and **every business row unchanged** (sales 52, customers 6, products 6, returns 1, notifications 51); the return now reads "processed by Yaqoob Malik" |
| **Not covered** | the storage files in Step 2b — the offline verifier has no storage schema, so that step is documented as *not verified offline* rather than implied |

Re-run it against whatever artifact is newest before you run the SQL for real: if production's
schema has moved on, the order is the thing that breaks first, and this is where that shows up.

Two flags make that an experiment rather than a claim: `--runbook <path>` points the verifier at
another copy, which is how the two non-vacuity rows above were produced, and `--from <artifact.sql>`
picks the artifact when the newest one is not the one you mean.

## Step 1 — measure first (read-only)

Run the count query in [Appendix A](#appendix-a--the-count-query). Compare against the table above.
If it differs, that is information, not an error: a newer artifact may exist (`npm run
audit:production-data -- --from backups/<newest>.sql`). **If any count grew in `sales`, `customers`
or `products`, stop and reconcile — production may now hold a real shop's work.**

Also run the shop check, which is the one that decides whether Plan A is even permitted:

```sql
select id, name, owner_id, created_at from public.shops order by created_at;
```

Plan A requires exactly one row, with id `00000000-0000-0000-0000-000000000001`.

## Step 2 — pick a plan

| Plan | Deletes | Keeps | Choose it when |
|---|---|---|---|
| **A. Empty production, keep the schema** | every row in every business table, then `shops`, `users`, `auth.*` | the schema, the migrations, the functions, the policies | the shop never actually traded here — you want a clean start |
| **B. Remove only what is not a customer's** | the orphan login, the `Test QA User` account and login | every business record, the owner account, the demo-keyed customers and products | some of this data is real work you want to keep |
| **C. Nothing yet** | — | everything | you are not ready to decide; rules 7–9 already stop new test data arriving |

Plan A and Plan B are both below. Each is one transaction that ends in `rollback;` — read the
counts it prints, then change that last word to `commit;` and run it again **only** when they read
as expected.

## Plan A — empty production, keep the schema

This deletes every row in the 22 tables production has, in foreign-key order, then the tenant
itself. It is written to be impossible to run against a database that holds a real shop.

```sql
begin;

-- ── Precondition: production must hold ONLY the demo tenant. If a second shop exists, or the
--    one shop is not the demo one, this raises and the transaction dies. Deletion cannot proceed
--    on a database where a real shop has appeared.
do $$
declare
  v_total int;
  v_demo  int;
begin
  select count(*), count(*) filter (where id = '00000000-0000-0000-0000-000000000001')
    into v_total, v_demo
  from public.shops;
  if v_total <> 1 or v_demo <> 1 then
    raise exception 'STOP: production holds % shop(s) and not exactly the demo tenant — this cleanup is not for this database', v_total;
  end if;

  -- Audit history belongs to the tenant being deleted, so it goes with it — but never silently:
  -- the count is printed here and again by the AFTER block below. Nothing in production is
  -- discarded without a number attached to it.
  raise notice 'audit_events rows this run will remove: %', (select count(*) from public.audit_events);
end $$;

-- ── BEFORE: print the counts (Appendix A's query is the same shape) ─────────────────────
select 'before' as phase, 'sales' as table_name, count(*) from public.sales;

-- ── Children first. 55 of 56 foreign keys are NO ACTION, so the order is the whole point.
delete from public.voids;
delete from public.return_items;
delete from public.returns;
delete from public.sale_items;
delete from public.sales;
delete from public.customer_payments;
delete from public.customer_crops;
delete from public.stock_adjustments;
delete from public.inventory_movements;
delete from public.supplier_payments;
delete from public.purchase_items;
delete from public.purchases;
delete from public.notifications;
delete from public.audit_events;
delete from public.shop_requests;
delete from public.credit_limit_requests;
delete from public.cash_reconciliations;
delete from public.reminder_occurrences;
delete from public.reminder_logs;
delete from public.reminder_configs;
-- variants before products (product_variants.product_id is CASCADE, so this is belt and braces)
delete from public.product_variants;
delete from public.products;
delete from public.customers;
delete from public.companies;
delete from public.app_settings;
delete from public.business_settings;
-- users reference each other (users.created_by), so one statement clears them together
delete from public.users;
delete from public.shops;
-- the logins last: identities first, then the accounts
delete from auth.identities where user_id in (select id from auth.users);
delete from auth.users;

-- ── AFTER: every one of these must be 0 ─────────────────────────────────────────────────
--    AFTER: EVERY public table must be 0, and no login may remain. This measures that rather than
--    listing the tables it hopes are empty — a table added by a later migration is covered the day
--    it exists, and a table this file forgot to delete from fails the transaction instead of
--    leaving a row behind for a new owner to find.
do $$
declare
  r      record;
  v_rows bigint;
  v_left text := '';
begin
  for r in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('select count(*) from public.%I', r.tablename) into v_rows;
    if v_rows > 0 then
      v_left := v_left || r.tablename || '=' || v_rows || ' ';
    end if;
    raise notice '%: %', r.tablename, v_rows;
  end loop;

  if v_left <> '' then
    raise exception 'STOP: NOT EMPTY after the wipe — % (a table above is not covered by the deletes)', v_left;
  end if;

  if exists (select 1 from auth.users) then
    raise exception 'STOP: auth.users still holds % row(s) — a login would survive the wipe', (select count(*) from auth.users);
  end if;

  raise notice 'OK: every public table is 0 and no login remains';
end $$;

-- ── DRY RUN BY DEFAULT. Read the counts printed above: if they read as expected, change this
--    single word to `commit;` and run the block again. If anything looks wrong, `rollback;`
--    (or closing the editor) leaves production exactly as it was.
rollback;
```

**What Plan A does not do:** it does not touch the schema, the migrations, the functions or the
policies (production keeps working, empty) — and **the schema it keeps is production's own, which is
`0016`. See Plan R if that is the problem.** It also does not delete the uploaded files themselves:
SQL removes their metadata rows (`storage.objects`), but the files live in the storage backend, which
is why Step 2b exists and is separate.

**Plan A alone does not make production "a new app".** It removes every row; it does not move the
schema forward. The app at HEAD expects tables introduced long after `0016` (`roles`,
`user_permissions`, `branches`, `user_active_shops`, `audit_events`' newer columns …), so a wiped
`0016` database is empty *and* unreadable to the current build. If your goal is a fresh install that
behaves like a new user's first day, read Plan R before choosing.

## Step 2b — the uploaded files (storage)

Plan A deletes the `storage.objects` metadata rows that point at product images, employee photos,
company logos and customer images. **Deleting the metadata does not delete the file** — the object
stays in the bucket's backend and would be an orphan. Do this part with the Storage API or the
dashboard, after the wipe, so nothing can be re-linked in between:

```bash
# after the Plan A commit — the four buckets 0013 creates
SUPABASE_URL=https://gkswcfljxlutkfdvvqng.supabase.co
for bucket in product-images employee-photos company-logos customer-images; do
  curl -sS -X POST "$SUPABASE_URL/storage/v1/object/list/$bucket" \
    -H "Authorization: Bearer $PROD_SERVICE_ROLE" -H 'Content-Type: application/json' \
    -d '{"prefix":"","limit":1000}' | head -c 400; echo
done
```

The listing is read-only and safe to run first. Removal is not: use the dashboard's Storage browser
("empty bucket") or `storage/v1/object/<bucket>` DELETE calls, and keep the listing output as the
record of what was there. **This step is not covered by `verify:cleanup-runbook`** (the offline
verifier has no storage schema), so it is marked here as *not verified offline* rather than implied.

## Plan B — remove only what is not a customer's

Three things in production are test artifacts by any reading, and nothing more can be removed
without a human decision:

* **`e7cbbff3…`** — an `auth.users` login with **no matching `users` row**. An orphan: it can sign
  in and land nowhere. Safe to remove, and worth removing.
* **`84deb713…` — `Test QA User`** — a QA account. It is referenced by exactly one row
  (`returns.processed_by`), so that return is **reassigned to the owner rather than deleted** —
  the return is a business record; the account is not.
* The accounts with history — `Yaqoob Malik`, `Akram`, `Ahmed Khan` — and the `TEST` suppliers are
  **not deleted here**. `Akram` recorded 6 sales, `Ahmed Khan` 5, `Yaqoob Malik` 20 plus 6 voids;
  the suppliers named `TEST` own 3 products and 2 payments. The correct action for an account with
  history is **deactivate it in the app** (Settings → Employees), which keeps the sales attributed
  and the history intact. Renaming the two `TEST` suppliers to their real names is a one-minute job
  in Purchases → Suppliers.

```sql
begin;

-- ── Precondition: work on the IDs this runbook names, and refuse if the QA account has acquired
--    history beyond the single return we are about to reassign.
do $$
declare
  v_qa_returns int;
  v_owner       uuid;
begin
  select id into v_owner from public.users
   where is_original_owner is true and shop_id = '00000000-0000-0000-0000-000000000001' limit 1;
  if v_owner is null then
    raise exception 'STOP: no original owner found in the demo tenant — do not proceed by assumption';
  end if;

  select count(*) into v_qa_returns from public.returns
   where processed_by = '84deb713-a5d2-4f2b-9faf-ca27c921b93c';
  if v_qa_returns > 1 then
    raise exception 'STOP: the Test QA User now processed % returns — review them before removing the account', v_qa_returns;
  end if;
end $$;

-- ── Reassign, do not delete: the return is a business record.
update public.returns
   set processed_by = (select id from public.users
                        where is_original_owner is true
                          and shop_id = '00000000-0000-0000-0000-000000000001' limit 1),
       -- the display name travels with the id, or the screen keeps showing a removed account
       processed_by_name = (select name from public.users
                             where is_original_owner is true
                               and shop_id = '00000000-0000-0000-0000-000000000001' limit 1),
       -- keep an honest trail: say who actually processed it
       note = coalesce(note, '') || ' [processed by Test QA User; account removed 2026-10]'
 where processed_by = '84deb713-a5d2-4f2b-9faf-ca27c921b93c';

-- ── The orphan login has no account and no references: remove it.
delete from auth.identities where user_id = 'e7cbbff3-ba73-4e5f-972a-dcdc9d3c978f';
delete from auth.users      where id       = 'e7cbbff3-ba73-4e5f-972a-dcdc9d3c978f';

-- ── The QA account: identities, then the login, then the public row.
delete from auth.identities where user_id = '84deb713-a5d2-4f2b-9faf-ca27c921b93c';
delete from auth.users      where id       = '84deb713-a5d2-4f2b-9faf-ca27c921b93c';
delete from public.users    where id       = '84deb713-a5d2-4f2b-9faf-ca27c921b93c'
                               and not exists (select 1 from public.sales            where employee_id = '84deb713-a5d2-4f2b-9faf-ca27c921b93c')
                               and not exists (select 1 from public.notifications     where actor_id   = '84deb713-a5d2-4f2b-9faf-ca27c921b93c')
                               and not exists (select 1 from public.stock_adjustments  where adjusted_by = '84deb713-a5d2-4f2b-9faf-ca27c921b93c');

-- ── The accounts with history stay, and are deactivated in the app instead.
--    Ahmed Khan 00000000-0000-0000-0000-000000000003   5 sales, 8 notifications
--    Akram      c333f839-35fb-4723-a07d-7aa960b4c4f3   6 sales, 7 notifications, 1 customer
--    Yaqoob Malik 00000000-0000-0000-0000-000000000002 (owner) — the shop's own account

-- ── AFTER: the QA account and the orphan login must be gone, everything else unchanged
select 'qa account remains' as check, count(*) from public.users where id = '84deb713-a5d2-4f2b-9faf-ca27c921b93c';
select 'orphan login remains' as check, count(*) from auth.users  where id = 'e7cbbff3-ba73-4e5f-972a-dcdc9d3c978f';
select 'sales' as untouched, count(*) from public.sales;
select 'customers' as untouched, count(*) from public.customers;

-- ── DRY RUN BY DEFAULT — see Plan A.
rollback;
```

## Plan R — rebuild production empty **at the current schema**

This is the plan for "the app a new user installs sees nothing dummy **and works**". Plan A empties
the data but keeps a schema from migration `0016`; the app at HEAD cannot run on that. Measured, not
assumed: the frozen production baseline records `ledgerOnServer {count: 8, latest: "0016"}` against
**198** migration files in `supabase/migrations/`, and the app's own shop-creation path
(`create_shop_internal`, `0150_shop_creation_and_switching.sql`) writes to `shops`, `branches`,
`roles` and `user_active_shops` — three of which do not exist in production at all today. So there
are two things to fix, and only one of them is data.

Three ways to get to a current-schema, zero-row production. All are owner-run; none is done by this
repository, and `scripts/migrate.mjs` **refuses production as a target by policy** — that refusal is
the first thing to decide about, not a bug to work around.

| Route | What it means | Keeps | Cost / risk |
|---|---|---|---|
| **R1 — bring the existing schema forward** | Apply the 182 pending migrations through the reviewed path, then run Plan A to empty it | the project ref, the buckets, the domain | needs the §D schema-strategy decision **and** `migrate` to accept production as a target; a forward-only replay onto a schema whose ledger disagrees is exactly what the policy forbids doing blind |
| **R2 — a new project, built from the migration set** | Provision a fresh Supabase project, apply all 198 migrations from zero, point the app at it, retire the old one | nothing — cleanest possible "new app" | the Free plan allows 2 active projects and both are spent (`supabase projects create` was refused 2026-10-12), so this needs a plan decision or pausing one project |
| **R3 — reset the existing project's database in place** | Drop the `public` schema and re-run the migration set, keeping the ref, the domain and the four buckets | ref, domain, buckets | destructive by definition; needs a verified backup first, and it is the route where "did every migration really reappear?" must be proven, not assumed |

Whichever is chosen, the acceptance test is the same, and it is a **first-run test, not a count**:

```bash
npm run migrate -- verify --env <target>     # the ledger matches the directory
npm run audit:production-data                # exit 0 — no row is keyed by a demo identity
# then, in the app, as if you were the first user:  register → create the shop → add a product → make one sale
```

What that first-run must produce, and where it is defined (so "no gap" is checked against the schema
rather than against a feeling): a `shops` row, its default `branches` row, its **four system role
templates** in `roles`, and the owner's membership — all in ONE transaction, in
`0150_shop_creation_and_switching.sql` (`create_shop_internal`, the `INSERT`s at lines 59, 65, 82 and
129). If a fresh account ends up without one of those, the gap is in the creation path, not in the
data that was removed.

## Step 3 — verify, then close the loop

1. **Counts.** Re-run [Appendix A](#appendix-a--the-count-query). Plan A: every table `0`. Plan B:
   only `users` and `auth.*` changed (4 → 3 public users, 2 → 1 login), everything else identical.
2. **A fresh backup, and the tool's own verdict.** Take a new production backup, then:
   ```bash
   npm run audit:production-data -- --from backups/<newest-production>.sql
   ```
   Plan A: **exit 0** — "no row is keyed by, or named as, a demo or QA identity". Plan B: **exit 1**
   is still correct and expected, because the demo-keyed customers, products and orders remain; the
   audit will name `demo-tenant` on those rows, which is the honest description of Plan B.
3. **Say what happened** in `ENGINEERING_OS_STATE.md`, with the run URL and the two audit outputs.
   A cleanup that deletes rows and changes no record is how a wrong deletion stays invisible.

## Rollback

There is no undo inside the database: `rollback;` is the undo, which is why both plans ship that
way. Once committed, the only recovery is the backup taken in the preconditions, restored with
`scripts/restore-verify.mjs` into a throwaway database first and then, if it is what you want, into
production — see [`RECOVERY.md`](RECOVERY.md). **This is the reason precondition 1 is not optional:
today there is no backup from the last eleven days.**

## What this runbook deliberately does not do

* It does not delete a customer's records ahead of their owner — Plan B keeps every one of them.
* It does not delete accounts that hold history; it names them and points at deactivate-in-app.
* Plan A removes the deleted tenant's own `audit_events` — with the count printed before and after, never silently. Plan B does not touch audit history at all.
* It does not touch the schema, the migrations, or the storage buckets.
* It does not run itself. `tests/unit/productionDataPolicy.test.ts` (rule 10) checks that this file
  keeps its shape: dry-run by default, a precondition before any unscoped delete, no `truncate`,
  no `drop`, and both plans present.

## Appendix A — the count query

Read-only. Paste into the SQL editor and compare with the table above.

```sql
select 'app_settings' t, count(*) n from public.app_settings
union all select 'business_settings', count(*) from public.business_settings
union all select 'companies', count(*) from public.companies
union all select 'customer_crops', count(*) from public.customer_crops
union all select 'customer_payments', count(*) from public.customer_payments
union all select 'customers', count(*) from public.customers
union all select 'inventory_movements', count(*) from public.inventory_movements
union all select 'notifications', count(*) from public.notifications
union all select 'product_variants', count(*) from public.product_variants
union all select 'products', count(*) from public.products
union all select 'return_items', count(*) from public.return_items
union all select 'returns', count(*) from public.returns
union all select 'sale_items', count(*) from public.sale_items
union all select 'sales', count(*) from public.sales
union all select 'shop_requests', count(*) from public.shop_requests
union all select 'shops', count(*) from public.shops
union all select 'stock_adjustments', count(*) from public.stock_adjustments
union all select 'supplier_payments', count(*) from public.supplier_payments
union all select 'users', count(*) from public.users
union all select 'voids', count(*) from public.voids
union all select 'audit_events', count(*) from public.audit_events
union all select 'purchases', count(*) from public.purchases
union all select 'purchase_items', count(*) from public.purchase_items
union all select 'credit_limit_requests', count(*) from public.credit_limit_requests
union all select 'cash_reconciliations', count(*) from public.cash_reconciliations
union all select 'reminder_configs', count(*) from public.reminder_configs
union all select 'reminder_logs', count(*) from public.reminder_logs
union all select 'reminder_occurrences', count(*) from public.reminder_occurrences
order by t;
```
