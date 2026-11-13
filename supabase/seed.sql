-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- LOCAL DEVELOPMENT SEED — never applied to QA or production.
--
-- WHO APPLIES THIS: `node scripts/dev/local-db.mjs seed`, which pipes it into the local stack's
-- own Postgres container:
--     docker exec -i supabase_db_<project_id> psql -U postgres -d postgres < supabase/seed.sql
-- No hosted tooling reads this file: `scripts/migrate.mjs` applies `supabase/migrations` only, and
-- production/staging credentials are never available to this path.
--
-- WHY IT EXISTS: the local database is seeded with a BASELINE SCHEMA (the accepted staging dump's
-- public schema, data statements skipped) and then the forward migrations. That gives every table,
-- function, policy and trigger, and NOT ONE ROW. This file supplies the minimum rows the app needs
-- to be usable: one shop, its default branch, an owner and an employee login, and a small catalogue.
--
-- WHY THESE IDENTIFIERS: they are the same deterministic ids `tests/setup/fixtures.ts` and
-- `scripts/e2e-setup-data.mjs` already use for QA, so the demo shop, users, customers and products
-- have the same identity locally as in QA. The passwords are derived from the phone numbers by the
-- app itself (`src/lib/auth.ts`), and any login that does not exist yet is provisioned in the LOCAL
-- GoTrue by `scripts/dev/local-db.mjs seed` — it never writes to a hosted project.
--
-- NOTE ON WHERE THE LOGINS COME FROM: the baseline artifact is a `public`-schema dump but also
-- carries `auth` rows, so after `init` the QA fixture logins are usually already present in
-- `auth.users` and `seed` reports them as "already valid" (their hashes match the derived
-- passwords). That is measured behaviour, not an assumption; `seed` creates the rest, and the rows
-- never leave this machine because the artifact lives in gitignored `backups/`.
--
-- DISPOSABLE BY DESIGN: local data is expected to be deleted and re-seeded freely. Re-running this
-- file is safe — every insert is an upsert.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

begin;

-- ─── The shop (the app's tenant) ────────────────────────────────────────────────────────────
insert into public.shops (id, name, phone, address, owner_id, join_code)
values (
  '00000000-0000-0000-0000-000000000001',
  'AgriShop Local Development',
  '923000000001',
  'Local development shop — disposable data',
  '10000000-0000-0000-0000-000000000001',
  'AGRI-LOCAL'
)
on conflict (id) do update set
  name = excluded.name, phone = excluded.phone, address = excluded.address,
  owner_id = excluded.owner_id, join_code = excluded.join_code;

-- ─── Its default branch ─────────────────────────────────────────────────────────────────────
-- Required, not decorative: stock movements and sales stamp a branch, and `default_branch_id()`
-- resolves NULL when a tenant has no active branch (see the forward migration 0191 comment).
--
-- A shop holds exactly ONE default (`0211` made a branch its own identity, and nothing at the schema
-- level forbids a second one — there is no partial unique index on `(tenant_id) where is_default`).
-- The `0094` backfill gave every existing shop a branch named '<shop> - Main' with `is_default =
-- true`; this file adds its own branch below. Matching on `id` cannot adopt that older row, so
-- without the demotion the two coexist and the Branches screen lists two "Main"s. Demote first,
-- then insert: the seed is the authority on which branch is the default, and this is idempotent.
--
-- The default branch carries the SHOP'S OWN NAME (owner's correction, 2026-10-30). "Main Branch"
-- was a placeholder: it is the business's branch, the one created with the business, and the
-- Main tag on the screen already says which kind it is. Naming it after the shop keeps the
-- header, the list and the switcher showing the name the owner actually recognises.
update public.branches
   set is_default = false
 where tenant_id = '00000000-0000-0000-0000-000000000001'
   and id <> '00000000-0000-0000-0000-000000000002'
   and is_default;

insert into public.branches (id, tenant_id, name, is_default, is_active, address)
values (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  (select name from public.shops where id = '00000000-0000-0000-0000-000000000001'),
  true,
  true,
  'Local development shop — disposable data'
)
on conflict (id) do update set
  name = excluded.name, tenant_id = excluded.tenant_id, is_default = true, is_active = true;

-- ─── People ─────────────────────────────────────────────────────────────────────────────────
-- Phones are the login identity. `scripts/dev/local-db.mjs seed` creates the matching GoTrue users
-- with the app's own derivation: email `user-<phone>@agrishop.auth.local`, password
-- `AgriShop-<phone>-2026!`.
insert into public.users (id, name, phone, role, is_original_owner, is_active, shop_id, employee_number, job_title)
values
  ('10000000-0000-0000-0000-000000000001', 'QA Admin',    '923009999999', 'admin',    true,  true, '00000000-0000-0000-0000-000000000001', 'EMP-001', 'Owner'),
  ('10000000-0000-0000-0000-000000000002', 'QA Employee', '923008888888', 'employee', false, true, '00000000-0000-0000-0000-000000000001', 'EMP-002', 'Sales')
on conflict (id) do update set
  name = excluded.name, phone = excluded.phone, role = excluded.role,
  is_original_owner = excluded.is_original_owner, is_active = excluded.is_active,
  shop_id = excluded.shop_id;

-- The shop each login is working in (the app's active-context row).
insert into public.user_active_shops (user_id, shop_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001')
on conflict (user_id) do update set shop_id = excluded.shop_id;

-- ─── Supplier ───────────────────────────────────────────────────────────────────────────────
insert into public.companies (id, name, contact_person, phone, address, outstanding_payable, total_purchases, shop_id)
values ('50000000-0000-0000-0000-000000000001', 'QA Supplier A', 'Ali Khan', '923001234567', 'Local', 0, 0, '00000000-0000-0000-0000-000000000001')
on conflict (id) do update set name = excluded.name, shop_id = excluded.shop_id;

-- ─── Customers ──────────────────────────────────────────────────────────────────────────────
-- customerB is deliberately over its credit limit and customerA has room, so the credit paths can
-- be exercised without editing data first.
insert into public.customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
values
  ('20000000-0000-0000-0000-000000000001', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '00000000-0000-0000-0000-000000000001', 'QA'),
  ('20000000-0000-0000-0000-000000000002', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '00000000-0000-0000-0000-000000000001', 'QA'),
  ('20000000-0000-0000-0000-000000000003', 'QA Customer C', '923003333333', 10000,     0, 15000, 15000, '00000000-0000-0000-0000-000000000001', 'QA')
on conflict (id) do update set
  name = excluded.name, phone = excluded.phone, credit_limit = excluded.credit_limit,
  outstanding_balance = excluded.outstanding_balance, total_purchases = excluded.total_purchases,
  total_paid = excluded.total_paid;

-- ─── Catalogue ──────────────────────────────────────────────────────────────────────────────
-- productB/variantB are at zero stock on purpose: an out-of-stock line must be refused by the
-- database, and that is a behaviour worth being able to exercise locally.
insert into public.products (id, name, company_id, category, stock_qty, shop_id)
values
  ('30000000-0000-0000-0000-000000000001', 'QA Product A', '50000000-0000-0000-0000-000000000001', 'seed',       100, '00000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', 'QA Product B', '50000000-0000-0000-0000-000000000001', 'fertilizer',   0, '00000000-0000-0000-0000-000000000001')
on conflict (id) do update set name = excluded.name, shop_id = excluded.shop_id, stock_qty = excluded.stock_qty;

insert into public.product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '1kg', 500,  300,  1, 10, 100),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '5kg', 2000, 1500, 5,  5,   0)
on conflict (id) do update set
  name = excluded.name, selling_price = excluded.selling_price, cost_price = excluded.cost_price,
  stock_qty = excluded.stock_qty;

-- ─── Storage buckets ──────────────────────────────────────────────────────────────────────
-- NOT business data — configuration the local stack cannot get any other way. The baseline
-- artifact is a `public`-schema dump, so nothing in the `storage` schema travels with it: after
-- `init` the local stack has no buckets at all. `uploadImage("product-images", …)` then fails, and
-- `src/lib/storage.ts` retries by calling `createBucket` as the signed-in user, which RLS refuses,
-- so every image path dead-ends locally (measured: `select * from storage.buckets` returned no
-- rows). These are the same four buckets `0013_storage_buckets.sql` creates, and the same policy
-- list in that migration names exactly these ids.
insert into storage.buckets (id, name, public)
values
  ('product-images',  'product-images',  true),
  ('employee-photos', 'employee-photos', true),
  ('company-logos',   'company-logos',   true),
  ('customer-images', 'customer-images', true)
on conflict (id) do nothing;

commit;
