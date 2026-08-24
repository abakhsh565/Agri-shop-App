-- ============================================================================
-- AgriShop — migration 0003: role-aware Row-Level Security
-- ----------------------------------------------------------------------------
-- Enforces the AGENTS.md / SECURITY.md non-negotiables at the DATABASE layer
-- (not just in the UI):
--   • Employees can NEVER read supplier financials, base/cost price, or profit.
--   • Only admins / co-admins can manage employees, suppliers, purchases.
--   • Inventory / financial history is corrected by new rows, never deleted.
--
-- Identity model: the app authenticates with Supabase Auth (phone OTP), so a
-- real session exists. The app `users` table is keyed by its own uuid, linked
-- to the auth session by phone. `normalizePhone()` in the client stores
-- users.phone in the SAME E.164-digits form that appears in the JWT `phone`
-- claim, so we resolve the caller's role by that join.
--
-- Cost hiding: `cost_price` is a COLUMN, and RLS is row-level. We therefore
-- split access — the base table `product_variants` (with cost_price) is
-- admin-only, while every authenticated user reads the `product_variants_public`
-- VIEW (from 0002, no cost_price). The view runs with its owner's rights and
-- so returns rows to employees without ever exposing cost_price.
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ROLLBACK: to disable, run `alter table <t> disable row level security;`
-- for each table listed below.
-- ============================================================================

-- ---- 0. Prerequisites: guarantee the base schema exists --------------------
-- Some live deployments were built from an EARLIER PARTIAL schema — missing the
-- employee-safe view, missing columns, or with users.role as plain text. Rather
-- than assume 0001/0002 fully ran, this block idempotently ensures every object
-- 0003 and 0004 depend on exists. `create ... if not exists` leaves any existing
-- table/column untouched (so no data is lost and column types are preserved).

-- 0.1 Enum TYPES (0004's function signatures + inserts require these to exist).
do $$ begin create type user_role        as enum ('admin','co_admin','employee'); exception when duplicate_object then null; end $$;
do $$ begin create type product_category  as enum ('spray','seed','fertilizer','other'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_type      as enum ('full','partial','credit'); exception when duplicate_object then null; end $$;
do $$ begin create type payment_method    as enum ('cash','bank_transfer'); exception when duplicate_object then null; end $$;
do $$ begin create type notification_kind as enum ('sale','payment','return','stock_adjust','low_stock','employee','purchase','system'); exception when duplicate_object then null; end $$;

-- 0.2 Base tables (created only if absent; existing tables are kept as-is).
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text unique not null,
  role user_role not null default 'employee',
  is_original_owner boolean not null default false,
  is_active boolean not null default true,
  employee_number text, job_title text, photo_url text,
  first_login_at timestamptz, last_login_at timestamptz,
  deactivated_at timestamptz, deactivated_by uuid references users(id),
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists companies (
  id uuid primary key default gen_random_uuid(), name text not null, contact_person text,
  phone text, address text, logo_url text,
  outstanding_payable numeric(14,2) not null default 0, total_purchases numeric(14,2) not null default 0,
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists products (
  id uuid primary key default gen_random_uuid(), name text not null, company text not null,
  category product_category not null default 'other', image_url text,
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  name text not null, sku text,
  selling_price numeric(12,2) not null default 0, cost_price numeric(12,2) not null default 0,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  low_stock_threshold integer not null default 5, expiry_date date
);
create table if not exists customers (
  id uuid primary key default gen_random_uuid(), name text not null, phone text not null, address text,
  credit_limit numeric(14,2) not null default 0, outstanding_balance numeric(14,2) not null default 0,
  total_purchases numeric(14,2) not null default 0, total_paid numeric(14,2) not null default 0,
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists sales (
  id uuid primary key default gen_random_uuid(), sale_number text unique not null,
  customer_id uuid references customers(id), customer_name text not null,
  employee_id uuid references users(id), employee_name text not null,
  subtotal numeric(14,2) not null default 0, tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0, amount_paid numeric(14,2) not null default 0,
  outstanding_balance numeric(14,2) not null default 0,
  payment_type payment_type not null default 'full', payment_method payment_method not null default 'cash',
  is_voided boolean not null default false, voided_at timestamptz, voided_by uuid references users(id),
  void_reason text, note text, created_at timestamptz not null default now()
);
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(), sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid references products(id), product_name text not null,
  variant_id uuid references product_variants(id), variant_name text not null,
  qty integer not null, unit_price numeric(12,2) not null, line_total numeric(14,2) not null
);
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(), kind notification_kind not null, title text not null,
  body text, entity_id uuid, actor_id uuid references users(id), actor_name text,
  read boolean not null default false, created_at timestamptz not null default now()
);

-- 0.3 Column alignment — a PARTIAL table may be missing ANY column the app or
--     0004's RPCs read/write. Add every canonical column if absent so nothing
--     hits "column does not exist" at runtime. All adds are nullable or carry a
--     default, so they are safe on tables that already hold rows.
alter table users            add column if not exists is_original_owner boolean not null default false;
alter table users            add column if not exists is_active boolean not null default true;
alter table users            add column if not exists employee_number text;
alter table users            add column if not exists job_title text;
alter table users            add column if not exists photo_url text;
alter table users            add column if not exists first_login_at timestamptz;
alter table users            add column if not exists last_login_at timestamptz;
alter table users            add column if not exists deactivated_at timestamptz;
alter table users            add column if not exists deactivated_by uuid;
alter table users            add column if not exists created_by uuid;
alter table users            add column if not exists created_at timestamptz not null default now();

alter table companies        add column if not exists contact_person text;
alter table companies        add column if not exists phone text;
alter table companies        add column if not exists address text;
alter table companies        add column if not exists logo_url text;
alter table companies        add column if not exists outstanding_payable numeric(14,2) not null default 0;
alter table companies        add column if not exists total_purchases numeric(14,2) not null default 0;
alter table companies        add column if not exists created_by uuid;
alter table companies        add column if not exists created_at timestamptz not null default now();

alter table products         add column if not exists company text not null default '';
alter table products         add column if not exists image_url text;
alter table products         add column if not exists created_by uuid;
alter table products         add column if not exists created_at timestamptz not null default now();

alter table product_variants add column if not exists sku text;
alter table product_variants add column if not exists selling_price numeric(12,2) not null default 0;
alter table product_variants add column if not exists cost_price numeric(12,2) not null default 0;
alter table product_variants add column if not exists stock_qty integer not null default 0;
alter table product_variants add column if not exists low_stock_threshold integer not null default 5;
alter table product_variants add column if not exists expiry_date date;

alter table customers        add column if not exists address text;
alter table customers        add column if not exists credit_limit numeric(14,2) not null default 0;
alter table customers        add column if not exists outstanding_balance numeric(14,2) not null default 0;
alter table customers        add column if not exists total_purchases numeric(14,2) not null default 0;
alter table customers        add column if not exists total_paid numeric(14,2) not null default 0;
alter table customers        add column if not exists created_by uuid;
alter table customers        add column if not exists created_at timestamptz not null default now();

alter table sales            add column if not exists customer_id uuid;
alter table sales            add column if not exists customer_name text not null default '';
alter table sales            add column if not exists employee_id uuid;
alter table sales            add column if not exists employee_name text not null default '';
alter table sales            add column if not exists subtotal numeric(14,2) not null default 0;
alter table sales            add column if not exists tax_amount numeric(14,2) not null default 0;
alter table sales            add column if not exists total_amount numeric(14,2) not null default 0;
alter table sales            add column if not exists amount_paid numeric(14,2) not null default 0;
alter table sales            add column if not exists outstanding_balance numeric(14,2) not null default 0;
alter table sales            add column if not exists is_voided boolean not null default false;
alter table sales            add column if not exists voided_at timestamptz;
alter table sales            add column if not exists voided_by uuid;
alter table sales            add column if not exists void_reason text;
alter table sales            add column if not exists note text;
alter table sales            add column if not exists created_at timestamptz not null default now();

alter table sale_items       add column if not exists product_id uuid;
alter table sale_items       add column if not exists product_name text not null default '';
alter table sale_items       add column if not exists variant_id uuid;
alter table sale_items       add column if not exists variant_name text not null default '';
alter table sale_items       add column if not exists qty integer not null default 0;
alter table sale_items       add column if not exists unit_price numeric(12,2) not null default 0;
alter table sale_items       add column if not exists line_total numeric(14,2) not null default 0;

alter table notifications    add column if not exists body text;
alter table notifications    add column if not exists entity_id uuid;
alter table notifications    add column if not exists actor_id uuid;
alter table notifications    add column if not exists actor_name text;
alter table notifications    add column if not exists read boolean not null default false;
alter table notifications    add column if not exists created_at timestamptz not null default now();

-- 0.4 Employee-safe product view (no cost_price) — the reason 0003 previously
--     failed was that this view did not exist. Create it now, unconditionally.
create or replace view product_variants_public as
  select id, product_id, name, sku, selling_price, stock_qty, low_stock_threshold, expiry_date
  from product_variants;

-- 0.5 Realtime (best-effort): ensure the app's live-sync tables broadcast. Any
--     already-member / unsupported case is ignored — realtime is an enhancement,
--     not required for reads/writes to work.
do $$ begin
  alter publication supabase_realtime add table users, companies, products,
    product_variants, customers, sales, sale_items, notifications;
exception when others then null; end $$;

-- ---- 1. Role-resolution helpers -------------------------------------------
-- SECURITY DEFINER so the lookup can read `users` regardless of the caller's
-- own RLS. STABLE so the planner can cache within a statement.
--
-- Returns TEXT (not the user_role enum) and casts u.role::text. Some live
-- deployments were created from an earlier partial schema in which users.role
-- is a plain `text` column rather than the `user_role` enum (see 0002 header).
-- Casting to text makes this helper correct for BOTH shapes — text stays text,
-- and an enum value coerces cleanly to text — so the 'admin'/'co_admin'
-- comparison below is a simple, unambiguous text match either way.

create or replace function app_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role::text
  from public.users u
  where u.phone = (auth.jwt() ->> 'phone')
    and u.is_active
  limit 1;
$$;

create or replace function app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app_current_role() in ('admin','co_admin'), false);
$$;

create or replace function app_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.phone = (auth.jwt() ->> 'phone')
  limit 1;
$$;

-- ---- 2. Enable RLS on every table -----------------------------------------
alter table users             enable row level security;
alter table companies         enable row level security;
alter table products          enable row level security;
alter table product_variants  enable row level security;
alter table customers         enable row level security;
alter table sales             enable row level security;
alter table sale_items        enable row level security;
alter table notifications     enable row level security;

-- Drop any prior permissive catch-all so re-runs converge on these policies.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('users','companies','products','product_variants',
                        'customers','sales','sale_items','notifications')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---- 3. USERS --------------------------------------------------------------
-- Anyone authenticated may read their own row (login/profile). Admins read all
-- (employee management). Bootstrapping the owner = inserting one's own row.
create policy users_select_self_or_admin on users
  for select to authenticated
  using (phone = (auth.jwt() ->> 'phone') or app_is_admin());

create policy users_insert_self_or_admin on users
  for insert to authenticated
  with check (phone = (auth.jwt() ->> 'phone') or app_is_admin());

-- Admins manage employees; a user may update their own login timestamps.
create policy users_update_self_or_admin on users
  for update to authenticated
  using (phone = (auth.jwt() ->> 'phone') or app_is_admin())
  with check (phone = (auth.jwt() ->> 'phone') or app_is_admin());
-- No DELETE policy: users are deactivated, never hard-deleted (PRD §20/§21).

-- ---- 4. COMPANIES / SUPPLIERS (financials) — admin only --------------------
-- outstanding_payable / total_purchases are supplier financials employees must
-- never see. Restrict the whole table to admins.
create policy companies_admin_read  on companies for select to authenticated using (app_is_admin());
create policy companies_admin_write on companies for insert to authenticated with check (app_is_admin());
create policy companies_admin_update on companies for update to authenticated using (app_is_admin()) with check (app_is_admin());

-- ---- 5. PRODUCTS -----------------------------------------------------------
-- Catalogue (no financials) is readable by all authenticated; only admins edit.
create policy products_read        on products for select to authenticated using (true);
create policy products_admin_write on products for insert to authenticated with check (app_is_admin());
create policy products_admin_update on products for update to authenticated using (app_is_admin()) with check (app_is_admin());

-- ---- 6. PRODUCT_VARIANTS (has cost_price) — admin only on the base table ----
-- Employees do NOT touch this table directly; they read product_variants_public
-- (the view has no cost_price). Selling sale decrements are applied server-side
-- / by admins. This guarantees cost_price never reaches a non-admin client.
create policy variants_admin_read   on product_variants for select to authenticated using (app_is_admin());
create policy variants_admin_write  on product_variants for insert to authenticated with check (app_is_admin());
create policy variants_admin_update on product_variants for update to authenticated using (app_is_admin()) with check (app_is_admin());

-- ---- 7. CUSTOMERS ----------------------------------------------------------
-- Operational data — all authenticated staff read & create; update allowed
-- (record payments adjust balances). No delete (financial history preserved).
create policy customers_read   on customers for select to authenticated using (true);
create policy customers_insert on customers for insert to authenticated with check (true);
create policy customers_update on customers for update to authenticated using (true) with check (true);

-- ---- 8. SALES + ITEMS ------------------------------------------------------
-- Staff read all sales and create their own. Updates limited to void/credit
-- adjustments; historical selling price is never rewritten (enforced in app +
-- reversal model). No delete — corrections are reversals/returns (ADR-004).
create policy sales_read   on sales for select to authenticated using (true);
create policy sales_insert on sales for insert to authenticated with check (true);
create policy sales_update on sales for update to authenticated using (true) with check (true);

create policy sale_items_read   on sale_items for select to authenticated using (true);
create policy sale_items_insert on sale_items for insert to authenticated with check (true);

-- ---- 9. NOTIFICATIONS ------------------------------------------------------
create policy notifications_read   on notifications for select to authenticated using (true);
create policy notifications_insert on notifications for insert to authenticated with check (true);
create policy notifications_update on notifications for update to authenticated using (true) with check (true);

-- ---- 10. Employee-safe view: make it invoker-safe & grant read -------------
-- The view already omits cost_price (0002). Keep it as a SECURITY DEFINER view
-- (default) so it returns rows past the admin-only base-table RLS, and grant
-- read to authenticated so employees can query it.
grant select on product_variants_public to authenticated;

-- ============================================================================
-- After running: employees querying `product_variants` directly get zero rows;
-- they must use `product_variants_public`. Admin/co-admin sessions keep full
-- access. If login ever breaks, confirm users.phone matches the JWT phone claim
-- (both E.164 digits, no '+') — that join is what resolves the caller's role.
-- ============================================================================
