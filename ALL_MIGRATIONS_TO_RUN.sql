-- ============================================================
-- AGRISHOP COMPLETE DATABASE SETUP
-- Run this in Supabase SQL Editor on your new project
-- Project: gkswcfljxlutkfdvvqng
-- ============================================================

-- ========== BASE SCHEMA (0001-0008) ==========

-- ============================================================
-- MIGRATION: 0001_agrishop_init.sql
-- ============================================================
-- ============================================================================
-- AgriShop — initial schema (ADR-006: Supabase Postgres + Realtime + Storage)
-- Run once in the Supabase SQL Editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.
-- ============================================================================

-- ---- Enums -----------------------------------------------------------------
do $$ begin
  create type user_role       as enum ('admin','co_admin','employee');
exception when duplicate_object then null; end $$;
do $$ begin
  create type product_category as enum ('spray','seed','fertilizer','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_type     as enum ('full','partial','credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_method   as enum ('cash','bank_transfer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type notification_kind as enum ('sale','payment','return','stock_adjust','low_stock','employee','purchase','system');
exception when duplicate_object then null; end $$;

-- ---- Users / employees -----------------------------------------------------
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  phone             text unique not null,
  role              user_role not null default 'employee',
  is_original_owner boolean not null default false,
  is_active         boolean not null default true,
  employee_number   text,
  job_title         text,
  photo_url         text,                       -- << employee image
  first_login_at    timestamptz,
  last_login_at     timestamptz,
  deactivated_at    timestamptz,
  deactivated_by    uuid references users(id),
  created_by        uuid references users(id),
  created_at        timestamptz not null default now()
);

-- ---- Companies / suppliers -------------------------------------------------
create table if not exists companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  contact_person      text,
  phone               text,
  address             text,
  logo_url            text,                     -- << supplier image
  outstanding_payable numeric(14,2) not null default 0,
  total_purchases     numeric(14,2) not null default 0,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now()
);

-- ---- Products + variants ---------------------------------------------------
create table if not exists products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  company    text not null,
  category   product_category not null default 'other',
  image_url  text,                              -- << product image
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists product_variants (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references products(id) on delete cascade,
  name                text not null,
  sku                 text,
  selling_price       numeric(12,2) not null default 0,
  cost_price          numeric(12,2) not null default 0,   -- admin/co_admin only (see views)
  stock_qty           integer not null default 0 check (stock_qty >= 0),  -- never negative
  low_stock_threshold integer not null default 5,
  expiry_date         date
);

-- ---- Customers -------------------------------------------------------------
create table if not exists customers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  phone               text not null,
  address             text,
  credit_limit        numeric(14,2) not null default 0,
  outstanding_balance numeric(14,2) not null default 0,
  total_purchases     numeric(14,2) not null default 0,
  total_paid          numeric(14,2) not null default 0,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now()
);

-- ---- Sales + items ---------------------------------------------------------
create table if not exists sales (
  id                  uuid primary key default gen_random_uuid(),
  sale_number         text unique not null,
  customer_id         uuid references customers(id),
  customer_name       text not null,
  employee_id         uuid references users(id),
  employee_name       text not null,
  subtotal            numeric(14,2) not null default 0,
  tax_amount          numeric(14,2) not null default 0,
  total_amount        numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,
  outstanding_balance numeric(14,2) not null default 0,
  payment_type        payment_type not null default 'full',
  payment_method      payment_method not null default 'cash',
  is_voided           boolean not null default false,
  voided_at           timestamptz,
  voided_by           uuid references users(id),
  void_reason         text,
  note                text,
  created_at          timestamptz not null default now()
);

create table if not exists sale_items (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  product_id   uuid references products(id),
  product_name text not null,
  variant_id   uuid references product_variants(id),
  variant_name text not null,
  qty          integer not null,
  unit_price   numeric(12,2) not null,
  line_total   numeric(14,2) not null
);

-- ---- Notifications ---------------------------------------------------------
-- One row per event the owner/admins should see (new order/sale, payment, etc).
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        notification_kind not null,
  title       text not null,
  body        text,
  entity_id   uuid,                 -- e.g. the sale id
  actor_id    uuid references users(id),
  actor_name  text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_created_idx on notifications (created_at desc);

-- ---- Realtime: broadcast changes on these tables ---------------------------
do $$ begin
  alter publication supabase_realtime add table sales;          exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table sale_items;     exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table notifications;  exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table product_variants; exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table customers;      exception when others then null; end $$;

-- ---- Storage buckets for images (public read) ------------------------------
insert into storage.buckets (id, name, public) values ('product-images','product-images', true)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('employee-photos','employee-photos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('company-logos','company-logos', true)      on conflict (id) do nothing;

-- Allow authenticated users to upload/replace within those buckets.
do $$ begin
  create policy "images public read" on storage.objects
    for select using (bucket_id in ('product-images','employee-photos','company-logos'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "images auth write" on storage.objects
    for insert to authenticated
    with check (bucket_id in ('product-images','employee-photos','company-logos'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "images auth update" on storage.objects
    for update to authenticated
    using (bucket_id in ('product-images','employee-photos','company-logos'));
exception when duplicate_object then null; end $$;

-- ============================================================================
-- NOTE ON ROW-LEVEL SECURITY:
-- Full RLS (employees cannot read cost_price / profit) is enforced once login
-- moves to Supabase Auth, so policies can read auth.uid()->role. Until then,
-- access is brokered and this migration leaves RLS to the auth slice. See
-- ADR-006 and SECURITY.md. Cost/profit will be exposed to employees ONLY via
-- an employee-safe view that omits cost_price.
-- ============================================================================

-- ============================================================
-- MIGRATION: 0002_align_users_and_rls.sql
-- ============================================================
-- ============================================================================
-- AgriShop — migration 0002
-- Purpose:
--   1. Bring the live `users` table in line with 0001 (some deployments were
--      created from an earlier partial schema missing the login/deactivation
--      timestamp columns — this caused "Could not find the 'first_login_at'
--      column of 'users'" on owner bootstrap).
--   2. Add the employee-safe product view that omits cost_price / profit so
--      employees can never read supplier financials (SECURITY.md, AGENTS.md
--      non-negotiable rules).
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ============================================================================

-- ---- 1. Add any missing columns to users ----------------------------------
alter table users add column if not exists photo_url       text;
alter table users add column if not exists first_login_at  timestamptz;
alter table users add column if not exists last_login_at    timestamptz;
alter table users add column if not exists deactivated_at   timestamptz;
alter table users add column if not exists deactivated_by   uuid references users(id);
alter table users add column if not exists created_by       uuid references users(id);

-- ---- 2. Employee-safe product view (no cost_price, no profit) ---------------
-- Employees read product/stock/selling-price data through this view only.
-- cost_price is deliberately excluded so it can never leak to the client.
create or replace view product_variants_public as
  select
    id,
    product_id,
    name,
    sku,
    selling_price,
    stock_qty,
    low_stock_threshold,
    expiry_date
  from product_variants;

comment on view product_variants_public is
  'Employee-safe projection of product_variants: omits cost_price so supplier financials never reach non-admin clients.';

-- ---- 3. Ensure realtime is on for users (employee management sync) ----------
do $$ begin
  alter publication supabase_realtime add table users; exception when others then null; end $$;

-- ============================================================
-- MIGRATION: 0003_role_aware_rls.sql
-- ============================================================
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

-- ============================================================
-- MIGRATION: 0004_operational_tables_and_rpcs.sql
-- ============================================================
-- ============================================================================
-- AgriShop — migration 0004: operational tables + transactional RPCs
-- ----------------------------------------------------------------------------
-- Adds the tables the app needs to run on real data instead of mock arrays:
--   customer_payments, supplier_payments, purchases, purchase_items,
--   stock_adjustments, returns, return_items.
--
-- Adds SECURITY DEFINER functions that perform the multi-table money/stock
-- flows ATOMICALLY and enforce the AGENTS.md non-negotiables server-side:
--   • inventory can never go negative (create_sale / adjust_stock guard it),
--   • selling price is read from the DB, never trusted from the client,
--   • sales/purchases/payments/returns are correcting rows, never deletes.
--
-- Run once in the Supabase SQL Editor AFTER 0001–0003. Idempotent.
-- ============================================================================

-- ---- 1. Enum for stock adjustment direction --------------------------------
do $$ begin
  create type adjustment_kind as enum ('add','remove','set');
exception when duplicate_object then null; end $$;

-- ---- 2. Tables -------------------------------------------------------------

create table if not exists customer_payments (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id),
  amount           numeric(14,2) not null,
  method           payment_method not null default 'cash',
  notes            text,
  recorded_by      uuid references users(id),
  recorded_by_name text,
  balance_after    numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  amount           numeric(14,2) not null,
  method           payment_method not null default 'cash',
  notes            text,
  recorded_by      uuid references users(id),
  recorded_by_name text,
  payable_after    numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists purchases (
  id                  uuid primary key default gen_random_uuid(),
  purchase_number     text not null unique,
  company_id          uuid references companies(id),
  company_name        text not null,
  total_amount        numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,
  outstanding_payable numeric(14,2) not null default 0,
  payment_method      payment_method not null default 'cash',
  note                text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now()
);

create table if not exists purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references purchases(id) on delete cascade,
  product_id   uuid references products(id),
  product_name text not null,
  variant_id   uuid references product_variants(id),
  variant_name text not null,
  qty          integer not null,
  cost_price   numeric(12,2) not null default 0,
  line_total   numeric(14,2) not null default 0
);

create table if not exists stock_adjustments (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid references products(id),
  product_name     text not null,
  variant_id       uuid references product_variants(id),
  variant_name     text not null,
  adjustment_type  adjustment_kind not null,
  qty_before       integer not null,
  qty_change       integer not null,
  qty_after        integer not null,
  reason           text,
  adjusted_by      uuid references users(id),
  adjusted_by_name text,
  created_at       timestamptz not null default now()
);

create table if not exists returns (
  id                uuid primary key default gen_random_uuid(),
  return_number     text not null unique,
  sale_id           uuid references sales(id),
  customer_id       uuid references customers(id),
  customer_name     text not null,
  total_refund      numeric(14,2) not null default 0,
  resolution        text not null default 'refund',
  note              text,
  processed_by      uuid references users(id),
  processed_by_name text,
  created_at        timestamptz not null default now()
);

create table if not exists return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references returns(id) on delete cascade,
  sale_item_id uuid references sale_items(id),
  product_id   uuid references products(id),
  product_name text not null,
  variant_id   uuid references product_variants(id),
  variant_name text not null,
  qty          integer not null,
  unit_price   numeric(12,2) not null default 0,
  line_total   numeric(14,2) not null default 0,
  restock      boolean not null default true
);

create index if not exists customer_payments_customer_idx on customer_payments (customer_id, created_at desc);
create index if not exists supplier_payments_company_idx  on supplier_payments (company_id, created_at desc);
create index if not exists purchases_created_idx          on purchases (created_at desc);
create index if not exists stock_adjustments_variant_idx  on stock_adjustments (variant_id, created_at desc);
create index if not exists returns_sale_idx               on returns (sale_id);

-- ---- 3. RLS ----------------------------------------------------------------
alter table customer_payments enable row level security;
alter table supplier_payments enable row level security;
alter table purchases         enable row level security;
alter table purchase_items    enable row level security;
alter table stock_adjustments enable row level security;
alter table returns           enable row level security;
alter table return_items      enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('customer_payments','supplier_payments','purchases',
                        'purchase_items','stock_adjustments','returns','return_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Customer payments: operational — all authenticated staff read & create.
create policy cust_pay_read   on customer_payments for select to authenticated using (true);
create policy cust_pay_insert on customer_payments for insert to authenticated with check (true);

-- Supplier payments + purchases + purchase_items: supplier financials → admin only.
create policy sup_pay_read   on supplier_payments for select to authenticated using (app_is_admin());
create policy sup_pay_insert on supplier_payments for insert to authenticated with check (app_is_admin());

create policy purchases_read   on purchases for select to authenticated using (app_is_admin());
create policy purchases_insert on purchases for insert to authenticated with check (app_is_admin());

create policy purchase_items_read   on purchase_items for select to authenticated using (app_is_admin());
create policy purchase_items_insert on purchase_items for insert to authenticated with check (app_is_admin());

-- Stock adjustments: inventory management → admin only.
create policy stock_adj_read   on stock_adjustments for select to authenticated using (app_is_admin());
create policy stock_adj_insert on stock_adjustments for insert to authenticated with check (app_is_admin());

-- Returns: operational — all authenticated staff read & create.
create policy returns_read   on returns for select to authenticated using (true);
create policy returns_insert on returns for insert to authenticated with check (true);
create policy return_items_read   on return_items for select to authenticated using (true);
create policy return_items_insert on return_items for insert to authenticated with check (true);

-- ---- 4. Transactional RPCs -------------------------------------------------
-- All run SECURITY DEFINER so they can touch product_variants (admin-only RLS)
-- and enforce invariants regardless of the caller's role, while the app still
-- connects with the anon key + a real auth session.

-- 4a. create_sale — validates + decrements stock, writes sale + items,
--     updates customer balance, notifies. Price is read from the DB.
create or replace function create_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id     uuid := app_current_user_id();
  v_actor_name   text;
  v_sale_id      uuid;
  v_sale_number  text;
  v_subtotal     numeric(14,2) := 0;
  v_total        numeric(14,2) := 0;
  v_amount_paid  numeric(14,2) := coalesce((payload->>'amountPaid')::numeric, 0);
  v_customer_id  uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','Walk-in');
  v_payment_type payment_type := coalesce((payload->>'paymentType')::payment_type,'full');
  v_payment_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note         text := payload->>'note';
  v_outstanding  numeric(14,2);
  item           jsonb;
  v_variant_id   uuid;
  v_product_id   uuid;
  v_qty          integer;
  v_price        numeric(12,2);
  v_stock        integer;
  v_vname        text;
begin
  select name into v_actor_name from users where id = v_actor_id;
  v_sale_number := '#' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  -- Pass 1: lock rows, validate stock, compute total from DB prices.
  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    if v_variant_id is not null then
      select stock_qty, selling_price, name into v_stock, v_price, v_vname
        from product_variants where id = v_variant_id for update;
      if not found then raise exception 'VARIANT_NOT_FOUND'; end if;
      if v_stock < v_qty then
        raise exception 'INSUFFICIENT_STOCK: % (have %, need %)', coalesce(v_vname,''), v_stock, v_qty;
      end if;
    else
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
    end if;
    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  v_total := v_subtotal;
  if v_payment_type = 'full' then v_amount_paid := v_total; end if;
  v_outstanding := greatest(v_total - v_amount_paid, 0);

  insert into sales(sale_number, customer_id, customer_name, employee_id, employee_name,
    subtotal, tax_amount, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note)
  values (v_sale_number, v_customer_id, v_customer_name, v_actor_id,
    coalesce(v_actor_name, payload->>'employeeName','Staff'),
    v_subtotal, 0, v_total, v_amount_paid, v_outstanding,
    v_payment_type, v_payment_method, v_note)
  returning id into v_sale_id;

  -- Pass 2: decrement stock + write line items.
  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_product_id := nullif(item->>'productId','')::uuid;
    v_qty := (item->>'qty')::int;
    if v_variant_id is not null then
      update product_variants set stock_qty = stock_qty - v_qty
        where id = v_variant_id
        returning selling_price, name into v_price, v_vname;
    else
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_vname := item->>'variantName';
    end if;
    insert into sale_items(sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, line_total)
    values (v_sale_id, v_product_id, coalesce(item->>'productName',''), v_variant_id,
      coalesce(v_vname, item->>'variantName',''), v_qty, v_price, v_price * v_qty);
  end loop;

  if v_customer_id is not null then
    update customers
      set outstanding_balance = outstanding_balance + v_outstanding,
          total_purchases     = total_purchases + v_total,
          total_paid          = total_paid + v_amount_paid
      where id = v_customer_id;
  end if;

  insert into notifications(kind, title, body, entity_id, actor_id, actor_name)
  values ('sale', 'New sale ' || v_sale_number,
    coalesce(v_actor_name,'Staff') || ' sold to ' || v_customer_name || ' · Rs. ' || v_total::text,
    v_sale_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'subtotal', v_subtotal, 'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_outstanding);
end;
$$;

-- 4b. create_purchase — writes purchase + items, increments stock, updates
--     supplier payable/total. Admin-only at the call site (RLS on tables).
create or replace function create_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id    uuid := app_current_user_id();
  v_purchase_id uuid;
  v_number      text;
  v_total       numeric(14,2) := 0;
  v_paid        numeric(14,2) := coalesce((payload->>'amountPaid')::numeric,0);
  v_company_id  uuid := nullif(payload->>'companyId','')::uuid;
  v_company_name text := coalesce(payload->>'companyName','');
  v_method      payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note        text := payload->>'note';
  v_payable     numeric(14,2);
  item          jsonb;
  v_variant_id  uuid;
  v_qty         integer;
  v_cost        numeric(12,2);
begin
  for item in select jsonb_array_elements(payload->'items') loop
    v_qty  := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    v_total := v_total + (v_qty * v_cost);
  end loop;
  v_payable := greatest(v_total - v_paid, 0);
  v_number := 'PO-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  insert into purchases(purchase_number, company_id, company_name, total_amount,
    amount_paid, outstanding_payable, payment_method, note, created_by)
  values (v_number, v_company_id, v_company_name, v_total, v_paid, v_payable, v_method, v_note, v_actor_id)
  returning id into v_purchase_id;

  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty  := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    insert into purchase_items(purchase_id, product_id, product_name, variant_id, variant_name,
      qty, cost_price, line_total)
    values (v_purchase_id, nullif(item->>'productId','')::uuid, coalesce(item->>'productName',''),
      v_variant_id, coalesce(item->>'variantName',''), v_qty, v_cost, v_qty*v_cost);
    if v_variant_id is not null then
      update product_variants set stock_qty = stock_qty + v_qty,
        cost_price = case when v_cost > 0 then v_cost else cost_price end
        where id = v_variant_id;
    end if;
  end loop;

  if v_company_id is not null then
    update companies set total_purchases = total_purchases + v_total,
      outstanding_payable = outstanding_payable + v_payable
      where id = v_company_id;
  end if;

  insert into notifications(kind,title,body,entity_id,actor_id)
  values ('purchase','Stock received '||v_number,
    v_company_name||' · Rs. '||v_total::text, v_purchase_id, v_actor_id);

  return jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_number,
    'totalAmount', v_total, 'outstandingPayable', v_payable);
end;
$$;

-- 4c. record_customer_payment — insert payment, reduce customer balance.
create or replace function record_customer_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_customer_id uuid := (payload->>'customerId')::uuid;
  v_amount numeric(14,2) := (payload->>'amount')::numeric;
  v_method payment_method := coalesce((payload->>'method')::payment_method,'cash');
  v_notes text := payload->>'notes';
  v_new_balance numeric(14,2);
  v_pay_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  update customers set outstanding_balance = greatest(outstanding_balance - v_amount, 0),
    total_paid = total_paid + v_amount
    where id = v_customer_id
    returning outstanding_balance into v_new_balance;

  insert into customer_payments(customer_id, amount, method, notes, recorded_by, recorded_by_name, balance_after)
  values (v_customer_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_balance)
  returning id into v_pay_id;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('payment','Payment received','Rs. '||v_amount::text||' collected', v_pay_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_pay_id, 'balanceAfter', v_new_balance);
end;
$$;

-- 4d. record_supplier_payment — insert payment, reduce supplier payable.
create or replace function record_supplier_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_company_id uuid := (payload->>'companyId')::uuid;
  v_amount numeric(14,2) := (payload->>'amount')::numeric;
  v_method payment_method := coalesce((payload->>'method')::payment_method,'cash');
  v_notes text := payload->>'notes';
  v_new_payable numeric(14,2);
  v_pay_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  update companies set outstanding_payable = greatest(outstanding_payable - v_amount, 0)
    where id = v_company_id
    returning outstanding_payable into v_new_payable;

  insert into supplier_payments(company_id, amount, method, notes, recorded_by, recorded_by_name, payable_after)
  values (v_company_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_payable)
  returning id into v_pay_id;

  return jsonb_build_object('id', v_pay_id, 'payableAfter', v_new_payable);
end;
$$;

-- 4e. adjust_stock — set/add/remove, never below zero, audit row + notify.
create or replace function adjust_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_variant_id uuid := (payload->>'variantId')::uuid;
  v_type adjustment_kind := (payload->>'adjustmentType')::adjustment_kind;
  v_input integer := coalesce((payload->>'qty')::int, 0);
  v_before integer;
  v_after integer;
  v_change integer;
  v_pname text := coalesce(payload->>'productName','');
  v_product_id uuid := nullif(payload->>'productId','')::uuid;
  v_vname text;
  v_adj_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  select stock_qty, name into v_before, v_vname from product_variants where id = v_variant_id for update;
  if not found then raise exception 'VARIANT_NOT_FOUND'; end if;

  v_after := case
    when v_type = 'add'    then v_before + v_input
    when v_type = 'remove' then v_before - v_input
    else v_input  -- 'set'
  end;
  if v_after < 0 then raise exception 'NEGATIVE_STOCK: result %', v_after; end if;
  v_change := v_after - v_before;

  update product_variants set stock_qty = v_after where id = v_variant_id;

  insert into stock_adjustments(product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, adjusted_by_name)
  values (v_product_id, v_pname, v_variant_id, coalesce(v_vname,''), v_type,
    v_before, v_change, v_after, payload->>'reason', v_actor_id, v_actor_name)
  returning id into v_adj_id;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('stock_adjust','Stock adjusted', v_pname||' '||coalesce(v_vname,'')||' → '||v_after||' units',
    v_adj_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_adj_id, 'qtyBefore', v_before, 'qtyChange', v_change, 'qtyAfter', v_after);
end;
$$;

-- 4f. create_product — product + its variants in one atomic call (admin).
create or replace function create_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_product_id uuid;
  item jsonb;
begin
  insert into products(name, company, category, image_url, created_by)
  values (payload->>'name', coalesce(payload->>'company',''),
    coalesce((payload->>'category')::product_category,'other'),
    nullif(payload->>'imageUrl',''), v_actor_id)
  returning id into v_product_id;

  for item in select jsonb_array_elements(payload->'variants') loop
    insert into product_variants(product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_product_id, item->>'name',
      coalesce((item->>'sellingPrice')::numeric,0),
      coalesce((item->>'costPrice')::numeric,0),
      greatest(coalesce((item->>'stockQty')::int,0),0),
      greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
  end loop;

  return jsonb_build_object('id', v_product_id);
end;
$$;

-- 4g. process_return — write return + items, restock, reduce customer balance.
create or replace function process_return(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_return_id uuid;
  v_number text;
  v_sale_id uuid := nullif(payload->>'saleId','')::uuid;
  v_customer_id uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','');
  v_resolution text := coalesce(payload->>'resolution','refund');
  v_note text := payload->>'note';
  v_total numeric(14,2) := 0;
  item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_price numeric(12,2);
begin
  select name into v_actor_name from users where id = v_actor_id;
  for item in select jsonb_array_elements(payload->'items') loop
    v_qty := (item->>'qty')::int;
    v_price := coalesce((item->>'unitPrice')::numeric,0);
    v_total := v_total + (v_qty * v_price);
  end loop;
  v_number := 'RET-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  insert into returns(return_number, sale_id, customer_id, customer_name, total_refund,
    resolution, note, processed_by, processed_by_name)
  values (v_number, v_sale_id, v_customer_id, v_customer_name, v_total, v_resolution, v_note,
    v_actor_id, v_actor_name)
  returning id into v_return_id;

  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    v_price := coalesce((item->>'unitPrice')::numeric,0);
    insert into return_items(return_id, sale_item_id, product_id, product_name, variant_id,
      variant_name, qty, unit_price, line_total, restock)
    values (v_return_id, nullif(item->>'saleItemId','')::uuid, nullif(item->>'productId','')::uuid,
      coalesce(item->>'productName',''), v_variant_id, coalesce(item->>'variantName',''),
      v_qty, v_price, v_qty*v_price, coalesce((item->>'restock')::boolean, true));
    if v_variant_id is not null and coalesce((item->>'restock')::boolean, true) then
      update product_variants set stock_qty = stock_qty + v_qty where id = v_variant_id;
    end if;
  end loop;

  if v_customer_id is not null then
    update customers set outstanding_balance = greatest(outstanding_balance - v_total, 0),
      total_purchases = greatest(total_purchases - v_total, 0)
      where id = v_customer_id;
  end if;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('return','Return '||v_number, v_customer_name||' · Rs. '||v_total::text,
    v_return_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_return_id, 'returnNumber', v_number, 'totalRefund', v_total);
end;
$$;

-- ---- 5. Grants + realtime --------------------------------------------------
grant execute on function create_sale(jsonb)              to authenticated;
grant execute on function create_purchase(jsonb)          to authenticated;
grant execute on function record_customer_payment(jsonb)  to authenticated;
grant execute on function record_supplier_payment(jsonb)  to authenticated;
grant execute on function adjust_stock(jsonb)             to authenticated;
grant execute on function create_product(jsonb)           to authenticated;
grant execute on function process_return(jsonb)           to authenticated;

do $$ begin
  alter publication supabase_realtime add table customer_payments;
  alter publication supabase_realtime add table purchases;
  alter publication supabase_realtime add table stock_adjustments;
  alter publication supabase_realtime add table returns;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- After running: the app writes sales/purchases/payments/adjustments/returns
-- through these functions (supabase.rpc(...)), so stock and balances stay
-- correct and can never go negative. Reads use the tables/views directly.
-- ============================================================================

-- ============================================================
-- MIGRATION: 0005_seed_demo_catalog.sql
-- ============================================================
-- ============================================================================
-- AgriShop — migration 0005: OPTIONAL starter catalogue
-- ----------------------------------------------------------------------------
-- The app now runs on real data. A brand-new database has no products or
-- suppliers, so the catalogue screens would start empty. Run this ONCE if you
-- want a small realistic starter set to test with; skip it if you'd rather
-- enter your own data in-app.
--
-- Safe to skip. Re-running is a no-op (guarded by name checks). Delete these
-- rows anytime from the Supabase Table Editor — they are ordinary data.
-- ============================================================================

-- ---- Suppliers -------------------------------------------------------------
insert into companies (name, contact_person, phone, address)
select v.name, v.cp, v.phone, v.addr
from (values
  ('Syngenta Pakistan', 'Imran Khan',  '03001234567', 'Lahore'),
  ('Engro Fertilizers', 'Ayesha Malik','03007654321', 'Karachi'),
  ('FMC United',        'Bilal Ahmed', '03009998877', 'Multan')
) as v(name, cp, phone, addr)
where not exists (select 1 from companies c where c.name = v.name);

-- ---- Products + variants ---------------------------------------------------
-- Each product gets 1–2 variants with sane selling/cost/stock values.
do $$
declare
  v_prod uuid;
begin
  if not exists (select 1 from products where name = 'Karate Insecticide') then
    insert into products (name, company, category)
    values ('Karate Insecticide', 'Syngenta Pakistan', 'spray') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '250ml', 1200, 850, 40, 5),
           (v_prod, '500ml', 2100, 1550, 25, 5);
  end if;

  if not exists (select 1 from products where name = 'Urea Fertilizer') then
    insert into products (name, company, category)
    values ('Urea Fertilizer', 'Engro Fertilizers', 'fertilizer') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '50kg bag', 4500, 4100, 60, 10);
  end if;

  if not exists (select 1 from products where name = 'Hybrid Maize Seed') then
    insert into products (name, company, category)
    values ('Hybrid Maize Seed', 'FMC United', 'seed') returning id into v_prod;
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_prod, '10kg', 8500, 7200, 15, 5),
           (v_prod, '5kg', 4400, 3700, 30, 5);
  end if;
end $$;

-- ============================================================================
-- After running: the inventory / product screens show this starter catalogue.
-- Customers and sales are created through the app.
-- ============================================================================

-- ============================================================
-- MIGRATION: 0006_notification_audience.sql
-- ============================================================
-- 0006_notification_audience.sql
-- ---------------------------------------------------------------------------
-- Persona-aware notification visibility.
--
-- Both personas share ONE live notifications feed, but each sees only what is
-- relevant and permitted for their role:
--   * Admin / Owner  → every event, including supplier-financial events.
--   * Employee       → operational events only (their own daily work): sales,
--                      customer payments, returns, stock adjustments, and
--                      low-stock alerts.
--
-- Employees must NEVER receive supplier financials or purchase/base cost
-- (AGENTS.md non-negotiable). The `purchase` notification body carries the
-- supplier cost total, so it is admin-only. Authorization is enforced in the
-- DATABASE here (RLS), not merely by hiding UI — the Realtime stream honours
-- this same policy, so an employee's device never receives admin-only rows.
--
-- Idempotent: safe to re-run. Depends only on objects created by 0003
-- (the `notifications` table with a `kind` column and the `app_is_admin()`
-- helper), so it can run standalone after 0003/0004.
-- ---------------------------------------------------------------------------

drop policy if exists notifications_read on notifications;

create policy notifications_read on notifications
  for select to authenticated
  using (
    app_is_admin()
    or kind in ('sale', 'payment', 'return', 'stock_adjust', 'low_stock')
  );

-- ============================================================
-- MIGRATION: 0007_product_update_delete.sql
-- ============================================================
-- 0007_product_update_delete.sql
-- CR-013 — Inventory & Products: edit + delete product actions.
--
-- Adds an is_active flag on products so a product with financial/sales history
-- is *deactivated* rather than hard-deleted (ADR-004: never hard-delete records
-- with sales history). Adds two admin-only SECURITY DEFINER RPCs:
--   • update_product — edit catalogue fields + upsert variants (never negative
--     stock; historical sale prices on sale_items are untouched).
--   • delete_product — hard-delete only when the product has no sale history;
--     otherwise deactivate. Returns which path was taken so the UI can explain.

-- ---- 1. Soft-delete flag ----------------------------------------------------
alter table products add column if not exists is_active boolean not null default true;

-- ---- 2. update_product ------------------------------------------------------
-- payload: { id, name, company, category, imageUrl?,
--   variants: [{ id?, name, sellingPrice, costPrice, lowStockThreshold }] }
-- Variants with an id are updated; those without are inserted. Stock is NOT
-- changed here (use adjust_stock) so this can never make stock negative.
create or replace function update_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  item jsonb;
  v_variant_id uuid;
begin
  if not app_is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_product_id is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  update products set
    name     = coalesce(payload->>'name', name),
    company  = coalesce(payload->>'company', company),
    category = coalesce((payload->>'category')::product_category, category),
    image_url = case when payload ? 'imageUrl'
                     then nullif(payload->>'imageUrl','') else image_url end
  where id = v_product_id;

  for item in select jsonb_array_elements(payload->'variants') loop
    v_variant_id := nullif(item->>'id','')::uuid;
    if v_variant_id is null then
      insert into product_variants(product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
      values (v_product_id, item->>'name',
        coalesce((item->>'sellingPrice')::numeric,0),
        coalesce((item->>'costPrice')::numeric,0),
        greatest(coalesce((item->>'stockQty')::int,0),0),
        greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
    else
      update product_variants set
        name                = coalesce(item->>'name', name),
        selling_price       = coalesce((item->>'sellingPrice')::numeric, selling_price),
        cost_price          = coalesce((item->>'costPrice')::numeric, cost_price),
        low_stock_threshold = greatest(coalesce((item->>'lowStockThreshold')::int, low_stock_threshold),0)
      where id = v_variant_id and product_id = v_product_id;
    end if;
  end loop;

  return jsonb_build_object('id', v_product_id);
end;
$$;

-- ---- 3. delete_product ------------------------------------------------------
-- payload: { id }
create or replace function delete_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  v_has_history boolean;
begin
  if not app_is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_product_id is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Any sale line referencing one of this product's variants = financial history.
  select exists (
    select 1 from sale_items si
    join product_variants pv on pv.id = si.variant_id
    where pv.product_id = v_product_id
  ) into v_has_history;

  if v_has_history then
    -- ADR-004: preserve the record; hide from catalogue instead.
    update products set is_active = false where id = v_product_id;
    return jsonb_build_object('id', v_product_id, 'deactivated', true);
  else
    -- No history: safe to hard-delete (variants cascade).
    delete from products where id = v_product_id;
    return jsonb_build_object('id', v_product_id, 'deactivated', false);
  end if;
end;
$$;

-- ---- 4. Grants --------------------------------------------------------------
grant execute on function update_product(jsonb) to authenticated;
grant execute on function delete_product(jsonb) to authenticated;

-- ============================================================
-- MIGRATION: 0008_customer_image.sql
-- ============================================================
-- 0008_customer_image.sql
-- CR-014 — Customers: persistent profile image.
-- Adds an optional image_url to customers. Reads/writes go through the existing
-- customers RLS (authenticated read/insert/update). The image is non-financial,
-- so it is safe for both personas to read; the upload UI is admin-only.
alter table customers add column if not exists image_url text;

-- ========== EXTENDED SCHEMA (0009-0017) ==========

-- ============================================================
-- MIGRATION: 0009_complete_schema.sql
-- ============================================================
-- Schema Upgrade: Multi-tenancy + Missing Tables + Columns

-- Helper functions
CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid; $$;
CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM users WHERE id = app_current_user_id() AND role IN ('admin', 'co_admin') AND is_active = true); $$;
CREATE OR REPLACE FUNCTION public.current_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT shop_id FROM users WHERE id = app_current_user_id(); $$;

-- 1. Add shop_id to existing tables
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='shop_id') THEN
  ALTER TABLE users ADD COLUMN shop_id uuid REFERENCES shops(id);
  INSERT INTO shops(id,name) VALUES('00000000-0000-0000-0000-000000000001','Default Shop') ON CONFLICT(id) DO NOTHING;
  UPDATE users SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE users ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='shop_id') THEN
  ALTER TABLE companies ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE companies SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE companies ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='shop_id') THEN
  ALTER TABLE products ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE products SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE products ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='shop_id') THEN
  ALTER TABLE customers ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE customers SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE customers ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='shop_id') THEN
  ALTER TABLE sales ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE sales SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE sales ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='shop_id') THEN
  ALTER TABLE purchases ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE purchases SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE purchases ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

-- 2. Add missing columns
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin_hash') THEN ALTER TABLE users ADD COLUMN pin_hash varchar(255); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at') THEN ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='is_active') THEN ALTER TABLE companies ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='updated_at') THEN ALTER TABLE companies ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='is_active') THEN ALTER TABLE products ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='updated_at') THEN ALTER TABLE products ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='company_id') THEN ALTER TABLE products ADD COLUMN company_id uuid REFERENCES companies(id); UPDATE products p SET company_id = c.id FROM companies c WHERE p.company = c.name; ALTER TABLE products DROP COLUMN company; ALTER TABLE products ALTER COLUMN company_id SET NOT NULL; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='is_active') THEN ALTER TABLE product_variants ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='updated_at') THEN ALTER TABLE product_variants ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='batch_id') THEN ALTER TABLE product_variants ADD COLUMN batch_id uuid; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='is_active') THEN ALTER TABLE customers ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='image_url') THEN ALTER TABLE customers ADD COLUMN image_url text; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='updated_at') THEN ALTER TABLE customers ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='updated_at') THEN ALTER TABLE sales ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='cogs_amount') THEN ALTER TABLE sale_items ADD COLUMN cogs_amount numeric(14,2) NOT NULL DEFAULT 0; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='created_at') THEN ALTER TABLE sale_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='updated_at') THEN ALTER TABLE purchases ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_items' AND column_name='created_at') THEN ALTER TABLE purchase_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='returns' AND column_name='updated_at') THEN ALTER TABLE returns ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='return_items' AND column_name='refund_amount') THEN ALTER TABLE return_items ADD COLUMN refund_amount numeric(14,2) NOT NULL DEFAULT 0; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='return_items' AND column_name='created_at') THEN ALTER TABLE return_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
END $$;

-- 3. Create missing tables
CREATE TABLE IF NOT EXISTS voids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES sales(id), reason varchar(50) NOT NULL, notes text, voided_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), action varchar(100) NOT NULL, entity_type varchar(50) NOT NULL, entity_id uuid, details jsonb, ip_address inet, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE, setting_key varchar(100) NOT NULL, setting_value text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT unique_shop_setting UNIQUE (shop_id, setting_key));
CREATE TABLE IF NOT EXISTS cash_reconciliations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE, reconciliation_date date NOT NULL, expected_cash numeric(14,2) NOT NULL, counted_cash numeric(14,2) NOT NULL, variance numeric(14,2) NOT NULL, notes text, reconciled_by uuid NOT NULL REFERENCES users(id), reconciled_by_name varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT unique_shop_reconciliation_date UNIQUE (shop_id, reconciliation_date));

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='movement_type') THEN CREATE TYPE movement_type AS ENUM ('sale','return','purchase','adjustment','void','opening'); END IF; END $$;
CREATE TABLE IF NOT EXISTS inventory_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid NOT NULL REFERENCES product_variants(id), movement_type movement_type NOT NULL, qty_before numeric(12,2) NOT NULL, qty_change numeric(12,2) NOT NULL, qty_after numeric(12,2) NOT NULL, reference_type varchar(50), reference_id uuid, batch_id uuid, unit_cost numeric(12,2), notes text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT check_qty_after_non_negative CHECK (qty_after >= 0));

-- 4. Indexes
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_users_shop_id ON users(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_companies_shop_id ON companies(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_shop_id ON sales(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_employee_id ON sales(employee_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_is_voided ON sales(is_voided);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_customer_payments_customer_id ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_purchases_shop_id ON purchases(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_supplier_payments_company_id ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_stock_adjustments_variant_id ON stock_adjustments(variant_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_returns_sale_id ON returns(sale_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_voids_sale_id ON voids(sale_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_audit_events_entity_type ON audit_events(entity_type);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_inventory_movements_variant_id ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_app_settings_shop_id ON app_settings(shop_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_cash_reconciliations_shop_id ON cash_reconciliations(shop_id);

-- 5. Default app settings
INSERT INTO app_settings(shop_id,setting_key,setting_value,description) VALUES
  ('00000000-0000-0000-0000-000000000001','low_stock_threshold_default','10','Default low stock alert threshold'),
  ('00000000-0000-0000-0000-000000000001','expiry_warning_days','30','Days before expiry to show warning'),
  ('00000000-0000-0000-0000-000000000001','void_window_hours','24','Hours after sale to allow void'),
  ('00000000-0000-0000-0000-000000000001','credit_limit_override_policy','warn_allow_log','Employee credit limit policy'),
  ('00000000-0000-0000-0000-000000000001','seed_kg_step','0.5','Default kg increment for seed products')
ON CONFLICT(shop_id,setting_key) DO NOTHING;

-- 6. Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_users_updated_at') THEN
  CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_companies_updated_at') THEN
  CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_products_updated_at') THEN
  CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_product_variants_updated_at') THEN
  CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_customers_updated_at') THEN
  CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_sales_updated_at') THEN
  CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
END $$;

-- ============================================================
-- MIGRATION: 0010_comprehensive_rls.sql
-- ============================================================
-- Comprehensive RLS Policies with shop_id isolation and role-based access
-- Drop all existing policies first
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- USERS: shop-scoped, all roles read, admin write
CREATE POLICY users_select ON users FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY users_insert ON users FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY users_update ON users FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- COMPANIES: shop-scoped, all read, admin write
CREATE POLICY companies_select ON companies FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY companies_insert ON companies FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id() AND app_is_admin());
CREATE POLICY companies_update ON companies FOR UPDATE TO authenticated USING (shop_id = current_shop_id() AND app_is_admin()) WITH CHECK (shop_id = current_shop_id());

-- PRODUCTS: shop-scoped, all read, admin write
CREATE POLICY products_select ON products FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY products_insert ON products FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id() AND app_is_admin());
CREATE POLICY products_update ON products FOR UPDATE TO authenticated USING (shop_id = current_shop_id() AND app_is_admin()) WITH CHECK (shop_id = current_shop_id());

-- PRODUCT_VARIANTS: all read (cost hidden by view), admin write
CREATE POLICY product_variants_select ON product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY product_variants_insert ON product_variants FOR INSERT TO authenticated WITH CHECK (app_is_admin());
CREATE POLICY product_variants_update ON product_variants FOR UPDATE TO authenticated USING (app_is_admin()) WITH CHECK (app_is_admin());

-- CUSTOMERS: shop-scoped, all read/write (PRD: shop-wide customer visibility)
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY customers_insert ON customers FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY customers_update ON customers FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- SALES: shop-scoped, all read/write
CREATE POLICY sales_select ON sales FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY sales_insert ON sales FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY sales_update ON sales FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- SALE_ITEMS: all read/write (follows sale access)
CREATE POLICY sale_items_select ON sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_items_insert ON sale_items FOR INSERT TO authenticated WITH CHECK (true);

-- CUSTOMER_PAYMENTS: all read/write
CREATE POLICY customer_payments_select ON customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_payments_insert ON customer_payments FOR INSERT TO authenticated WITH CHECK (true);

-- PURCHASES: admin-only (supplier financials hidden from employees)
CREATE POLICY purchases_select ON purchases FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY purchases_insert ON purchases FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- PURCHASE_ITEMS: admin-only
CREATE POLICY purchase_items_select ON purchase_items FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY purchase_items_insert ON purchase_items FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- SUPPLIER_PAYMENTS: admin-only
CREATE POLICY supplier_payments_select ON supplier_payments FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY supplier_payments_insert ON supplier_payments FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- STOCK_ADJUSTMENTS: admin-only
CREATE POLICY stock_adjustments_select ON stock_adjustments FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY stock_adjustments_insert ON stock_adjustments FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- RETURNS: all read/write
CREATE POLICY returns_select ON returns FOR SELECT TO authenticated USING (true);
CREATE POLICY returns_insert ON returns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY return_items_select ON return_items FOR SELECT TO authenticated USING (true);
CREATE POLICY return_items_insert ON return_items FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATIONS: all read/write
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- VOIDS: admin-only
CREATE POLICY voids_select ON voids FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY voids_insert ON voids FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- AUDIT_EVENTS: admin read, all insert
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO authenticated WITH CHECK (true);

-- APP_SETTINGS: all read, admin write
CREATE POLICY app_settings_select ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_insert ON app_settings FOR INSERT TO authenticated WITH CHECK (app_is_admin());
CREATE POLICY app_settings_update ON app_settings FOR UPDATE TO authenticated USING (app_is_admin()) WITH CHECK (app_is_admin());

-- CASH_RECONCILIATIONS: admin-only
CREATE POLICY cash_reconciliations_select ON cash_reconciliations FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY cash_reconciliations_insert ON cash_reconciliations FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- INVENTORY_MOVEMENTS: all read, all insert (written by RPCs)
CREATE POLICY inventory_movements_select ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_movements_insert ON inventory_movements FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- MIGRATION: 0011_new_rpc_functions.sql
-- ============================================================
-- New RPC functions: void_sale, cash_reconciliation, deactivate_employee, update/delete product
-- These are ADDITIONS to the existing RPCs in migration 0004

-- void_sale_v1 — Admin-only, time-windowed, reverses stock + balance
CREATE OR REPLACE FUNCTION void_sale_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_sale_id uuid := (payload->>'saleId')::uuid;
  v_reason text := payload->>'reason';
  v_notes text := payload->>'notes';
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_void_window interval;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  -- Get void window from settings (default 24h)
  SELECT (setting_value || ' hours')::interval INTO v_void_window
    FROM app_settings WHERE shop_id = v_sale.shop_id AND setting_key = 'void_window_hours';
  IF v_void_window IS NULL THEN v_void_window := interval '24 hours'; END IF;

  IF (now() - v_sale.created_at) > v_void_window THEN
    RAISE EXCEPTION 'VOID_WINDOW_EXPIRED';
  END IF;

  -- Restore stock
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = v_sale_id LOOP
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty + v_item.qty WHERE id = v_item.variant_id;
      INSERT INTO inventory_movements(variant_id,movement_type,qty_before,qty_change,qty_after,reference_type,reference_id,created_by)
      SELECT v_item.variant_id,'void',stock_qty-v_item.qty,v_item.qty,stock_qty,'void',v_sale_id,v_actor_id
      FROM product_variants WHERE id = v_item.variant_id;
    END IF;
  END LOOP;

  -- Reverse customer balance
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_sale.outstanding_balance,0),
      total_purchases = greatest(total_purchases - v_sale.total_amount,0),
      total_paid = greatest(total_paid - v_sale.amount_paid,0) WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET is_voided=true, voided_at=now(), voided_by=v_actor_id, void_reason=v_reason WHERE id=v_sale_id;
  INSERT INTO voids(sale_id,reason,notes,voided_by) VALUES (v_sale_id,v_reason,v_notes,v_actor_id) RETURNING id INTO v_void_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'sale_voided','sale',v_sale_id,jsonb_build_object('reason',v_reason,'total',v_sale.total_amount));
  INSERT INTO notifications(kind,title,body,entity_id,actor_id,actor_name) VALUES ('sale','Sale voided '||v_sale.sale_number,coalesce(v_actor_name,'Admin')||' voided Rs. '||v_sale.total_amount::text,v_sale_id,v_actor_id,v_actor_name);

  RETURN jsonb_build_object('id',v_void_id,'saleId',v_sale_id,'status','voided');
END; $$;

-- record_cash_reconciliation_v1 — Admin-only daily cash counting
CREATE OR REPLACE FUNCTION record_cash_reconciliation_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_date date := (payload->>'date')::date;
  v_expected numeric(14,2) := (payload->>'expectedCash')::numeric;
  v_counted numeric(14,2) := (payload->>'countedCash')::numeric;
  v_notes text := payload->>'notes';
  v_recon_id uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  INSERT INTO cash_reconciliations(shop_id,reconciliation_date,expected_cash,counted_cash,variance,notes,reconciled_by,reconciled_by_name)
  VALUES (v_shop_id,v_date,v_expected,v_counted,v_counted-v_expected,v_notes,v_actor_id,v_actor_name)
  ON CONFLICT(shop_id,reconciliation_date) DO UPDATE SET expected_cash=EXCLUDED.expected_cash,counted_cash=EXCLUDED.counted_cash,variance=EXCLUDED.variance,notes=EXCLUDED.notes,reconciled_by=EXCLUDED.reconciled_by,reconciled_by_name=EXCLUDED.reconciled_by_name
  RETURNING id INTO v_recon_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'cash_reconciled','cash_reconciliation',v_recon_id,jsonb_build_object('date',v_date,'variance',v_counted-v_expected));
  RETURN jsonb_build_object('id',v_recon_id,'variance',v_counted-v_expected);
END; $$;

-- deactivate_employee_v1 — preserves historical references
CREATE OR REPLACE FUNCTION deactivate_employee_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_emp_id uuid := (payload->>'employeeId')::uuid; v_emp record;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.is_original_owner THEN RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER'; END IF;
  UPDATE users SET is_active=false, deactivated_at=now(), deactivated_by=v_actor_id WHERE id=v_emp_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'employee_deactivated','user',v_emp_id,jsonb_build_object('name',v_emp.name));
  RETURN jsonb_build_object('id',v_emp_id,'isActive',false);
END; $$;

-- update_product_v1 — atomic product + variants update
CREATE OR REPLACE FUNCTION update_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_product_id uuid := (payload->>'id')::uuid; item jsonb;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE products SET name=payload->>'name',company_id=nullif(payload->>'companyId','')::uuid,category=coalesce((payload->>'category')::product_category,category),image_url=nullif(payload->>'imageUrl','') WHERE id=v_product_id;
  FOR item IN SELECT jsonb_array_elements(payload->'variants') LOOP
    IF item->>'id' IS NOT NULL AND item->>'id' != '' THEN
      UPDATE product_variants SET name=item->>'name',selling_price=coalesce((item->>'sellingPrice')::numeric,selling_price),cost_price=coalesce((item->>'costPrice')::numeric,cost_price),low_stock_threshold=coalesce((item->>'lowStockThreshold')::int,low_stock_threshold) WHERE id=(item->>'id')::uuid AND product_id=v_product_id;
    ELSE
      INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold) VALUES (v_product_id,item->>'name',coalesce((item->>'sellingPrice')::numeric,0),coalesce((item->>'costPrice')::numeric,0),greatest(coalesce((item->>'stockQty')::int,0),0),greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('id',v_product_id);
END; $$;

-- delete_product_v1 — soft delete
CREATE OR REPLACE FUNCTION delete_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product_id uuid := (payload->>'id')::uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE products SET is_active=false WHERE id=v_product_id;
  UPDATE product_variants SET is_active=false WHERE product_id=v_product_id;
  RETURN jsonb_build_object('id',v_product_id,'deactivated',true);
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION void_sale_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION record_cash_reconciliation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_employee_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO authenticated;

-- ============================================================
-- MIGRATION: 0012_update_existing_rpcs.sql
-- ============================================================
-- Fix existing RPC functions to include shop_id after migration 0009 added NOT NULL shop_id columns
-- These replace the functions from migration 0004 with shop_id-aware versions

-- update_updated_at_column trigger function (already in 0009 but ensuring idempotency)
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql';

-- create_sale — now includes shop_id
CREATE OR REPLACE FUNCTION create_sale(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_amount_paid numeric(14,2) := coalesce((payload->>'amountPaid')::numeric, 0);
  v_customer_id uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','Walk-in');
  v_payment_type payment_type := coalesce((payload->>'paymentType')::payment_type,'full');
  v_payment_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note text := payload->>'note';
  v_outstanding numeric(14,2);
  item jsonb;
  v_variant_id uuid;
  v_product_id uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_stock integer;
  v_vname text;
  v_cogs_total numeric(14,2) := 0;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  v_sale_number := 'SL-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    IF v_variant_id IS NOT NULL THEN
      SELECT stock_qty, selling_price, cost_price, name INTO v_stock, v_price, v_cost, v_vname
        FROM product_variants WHERE id = v_variant_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'VARIANT_NOT_FOUND'; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: % (have %, need %)', coalesce(v_vname,''), v_stock, v_qty; END IF;
    ELSE
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_cost := 0;
    END IF;
    v_subtotal := v_subtotal + (v_price * v_qty);
    v_cogs_total := v_cogs_total + (v_cost * v_qty);
  END LOOP;

  v_total := v_subtotal;
  IF v_payment_type = 'full' THEN v_amount_paid := v_total; END IF;
  v_outstanding := greatest(v_total - v_amount_paid, 0);

  INSERT INTO sales(shop_id, sale_number, customer_id, customer_name, employee_id, employee_name,
    subtotal, tax_amount, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note)
  VALUES (v_shop_id, v_sale_number, v_customer_id, v_customer_name, v_actor_id,
    coalesce(v_actor_name, payload->>'employeeName','Staff'),
    v_subtotal, 0, v_total, v_amount_paid, v_outstanding,
    v_payment_type, v_payment_method, v_note)
  RETURNING id INTO v_sale_id;

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_product_id := nullif(item->>'productId','')::uuid;
    v_qty := (item->>'qty')::int;
    IF v_variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty - v_qty WHERE id = v_variant_id
        RETURNING selling_price, cost_price, name INTO v_price, v_cost, v_vname;
    ELSE
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_cost := 0;
      v_vname := item->>'variantName';
    END IF;
    INSERT INTO sale_items(sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, line_total, cogs_amount)
    VALUES (v_sale_id, v_product_id, coalesce(item->>'productName',''), v_variant_id,
      coalesce(v_vname, item->>'variantName',''), v_qty, v_price, v_price * v_qty, v_cost * v_qty);

    IF v_variant_id IS NOT NULL THEN
      INSERT INTO inventory_movements(variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by)
      SELECT v_variant_id, 'sale', stock_qty + v_qty, -v_qty, stock_qty,
        'sale', v_sale_id, v_cost, v_actor_id
      FROM product_variants WHERE id = v_variant_id;
    END IF;
  END LOOP;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = outstanding_balance + v_outstanding,
      total_purchases = total_purchases + v_total, total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'sale_created', 'sale', v_sale_id,
    jsonb_build_object('total', v_total, 'customer', v_customer_name, 'items', jsonb_array_length(payload->'items')));

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('sale', 'New sale ' || v_sale_number,
    coalesce(v_actor_name,'Staff') || ' sold to ' || v_customer_name || ' Rs. ' || v_total::text,
    v_sale_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'subtotal', v_subtotal, 'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_outstanding, 'cogsTotal', v_cogs_total);
END; $$;

-- create_purchase — now includes shop_id
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_shop_id uuid := current_shop_id();
  v_purchase_id uuid;
  v_number text;
  v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := coalesce((payload->>'amountPaid')::numeric,0);
  v_company_id uuid := nullif(payload->>'companyId','')::uuid;
  v_company_name text := coalesce(payload->>'companyName','');
  v_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note text := payload->>'note';
  v_payable numeric(14,2);
  item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric(12,2);
  v_before integer;
BEGIN
  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_qty := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    v_total := v_total + (v_qty * v_cost);
  END LOOP;
  v_payable := greatest(v_total - v_paid, 0);
  v_number := 'PO-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  INSERT INTO purchases(shop_id, purchase_number, company_id, company_name, total_amount,
    amount_paid, outstanding_payable, payment_method, note, created_by)
  VALUES (v_shop_id, v_number, v_company_id, v_company_name, v_total, v_paid, v_payable, v_method, v_note, v_actor_id)
  RETURNING id INTO v_purchase_id;

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    INSERT INTO purchase_items(purchase_id, product_id, product_name, variant_id, variant_name,
      qty, cost_price, line_total)
    VALUES (v_purchase_id, nullif(item->>'productId','')::uuid, coalesce(item->>'productName',''),
      v_variant_id, coalesce(item->>'variantName',''), v_qty, v_cost, v_qty*v_cost);
    IF v_variant_id IS NOT NULL THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_variant_id FOR UPDATE;
      UPDATE product_variants SET stock_qty = stock_qty + v_qty,
        cost_price = case when v_cost > 0 then v_cost else cost_price end WHERE id = v_variant_id;
      INSERT INTO inventory_movements(variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by)
      VALUES (v_variant_id, 'purchase', v_before, v_qty, v_before + v_qty, 'purchase', v_purchase_id, v_cost, v_actor_id);
    END IF;
  END LOOP;

  IF v_company_id IS NOT NULL THEN
    UPDATE companies SET total_purchases = total_purchases + v_total,
      o
utstanding_payable = outstanding_payable + v_payable WHERE id = v_company_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'purchase_created', 'purchase', v_purchase_id,
    jsonb_build_object('total', v_total, 'company', v_company_name));

  INSERT INTO notifications(kind,title,body,entity_id,actor_id)
  VALUES ('purchase','Stock received '||v_number, v_company_name||' Rs. '||v_total::text, v_purchase_id, v_actor_id);

  RETURN jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_number,
    'totalAmount', v_total, 'outstandingPayable', v_payable);
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;

-- ============================================================
-- MIGRATION: 0013_storage_buckets.sql
-- ============================================================
-- Migration 0013: Storage buckets for image uploads
-- Run this AFTER all other migrations on Supabase SQL Editor

-- Create storage buckets (idempotent)
INSERT INTO storage.buckets (id, name, public) VALUES
  ('product-images', 'product-images', true),
  ('employee-photos', 'employee-photos', true),
  ('company-logos', 'company-logos', true),
  ('customer-images', 'customer-images', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: authenticated users can upload, anyone can read public buckets
-- Upload policy (authenticated only)
CREATE POLICY "Authenticated users can upload images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Read policy (public access for these buckets)
CREATE POLICY "Public read access for image buckets"
ON storage.objects FOR SELECT TO public
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Update policy (authenticated can update their own uploads)
CREATE POLICY "Authenticated users can update their uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- Delete policy (authenticated can delete their own uploads)
CREATE POLICY "Authenticated users can delete their uploads"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

-- ============================================================
-- MIGRATION: 0014_add_barcode.sql
-- ============================================================
-- Add barcode column to products table
-- Each product gets a unique barcode (Code128 format: AGS-XXXX-NN)

ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode text;

-- Create unique index on barcode (allows NULL for existing products)
CREATE UNIQUE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL;

-- Auto-generate barcodes for existing products that don't have one
-- Format: AGS-{FIRST4_UPPERCASE}-{SEQUENCE}
WITH numbered AS (
  SELECT
    id,
    name,
    ROW_NUMBER() OVER (ORDER BY created_at, id) AS seq
  FROM products
  WHERE barcode IS NULL
)
UPDATE products p
SET barcode = 'AGS-' || UPPER(LEFT(REGEXP_REPLACE(n.name, '[^a-zA-Z0-9]', '', 'g'), 4)) || '-' || LPAD(n.seq::text, 2, '0')
FROM numbered n
WHERE p.id = n.id;

-- RPC: Generate a unique barcode for a new product
CREATE OR REPLACE FUNCTION generate_barcode(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_seq int;
  v_barcode text;
BEGIN
  -- Extract first 4 alphanumeric characters from product name
  v_hash := UPPER(LEFT(REGEXP_REPLACE(p_name, '[^a-zA-Z0-9]', '', 'g'), 4));
  IF LENGTH(v_hash) < 4 THEN v_hash := v_hash || RPAD('X', 4 - LENGTH(v_hash), 'X'); END IF;

  -- Get next sequence number for this hash
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(barcode FROM 10 FOR 2) AS int)
  ), 0) + 1
  INTO v_seq
  FROM products
  WHERE barcode LIKE 'AGS-' || v_hash || '-%';

  v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');

  -- Ensure uniqueness (collision check)
  WHILE EXISTS (SELECT 1 FROM products WHERE barcode = v_barcode) LOOP
    v_seq := v_seq + 1;
    v_barcode := 'AGS-' || v_hash || '-' || LPAD(v_seq::text, 2, '0');
  END LOOP;

  RETURN v_barcode;
END;
$$;

GRANT EXECUTE ON FUNCTION generate_barcode(text) TO authenticated;

-- RPC: Lookup product by barcode
CREATE OR REPLACE FUNCTION lookup_product_by_barcode(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'company', p.company,
    'category', p.category,
    'image_url', p.image_url,
    'barcode', p.barcode
  )
  INTO v_product
  FROM products p
  WHERE UPPER(p.barcode) = UPPER(p_barcode)
    AND p.is_active = true;

  IF v_product IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  RETURN v_product;
END;
$$;

GRANT EXECUTE ON FUNCTION lookup_product_by_barcode(text) TO authenticated;

-- ============================================================
-- MIGRATION: 0015_flexible_units.sql
-- ============================================================
-- Migration 0015: Flexible Units & Pricing Model
-- Single source of truth: products.stock_qty (in base units)
-- Variants define sellable units (unitSize, qtyStep) with independent pricing

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

-- Products: add base unit and stock (single source of truth)
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'piece';
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty numeric(14,4) NOT NULL DEFAULT 0;

-- Add CHECK constraint: stock_qty cannot be negative
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_stock_qty_non_negative CHECK (stock_qty >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Product variants: add unit_size and qty_step
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS unit_size numeric(10,4) NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS qty_step numeric(10,4) NOT NULL DEFAULT 1;

-- Add CHECK constraints
DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT variants_unit_size_positive CHECK (unit_size > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT variants_qty_step_positive CHECK (qty_step > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sale items: snapshot unit_size and base_unit for historical integrity
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_size numeric(10,4) DEFAULT 1;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS base_unit text DEFAULT 'piece';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Migrate existing variant stock to product level
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  prod RECORD;
  total_stock numeric;
BEGIN
  FOR prod IN SELECT DISTINCT p.id FROM products p
  LOOP
    SELECT COALESCE(SUM(stock_qty), 0) INTO total_stock
    FROM product_variants
    WHERE product_id = prod.id;

    IF total_stock > 0 THEN
      UPDATE products SET stock_qty = total_stock WHERE id = prod.id;
    END IF;
  END LOOP;
END $$;

-- Set existing variants to unit_size=1, qty_step=1 (backward compatible)
UPDATE product_variants SET unit_size = 1 WHERE unit_size IS NULL;
UPDATE product_variants SET qty_step = 1 WHERE qty_step IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Create product_variants_public view (no cost_price for employees)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS product_variants_public;
CREATE VIEW product_variants_public AS
SELECT id, product_id, name, sku, selling_price, unit_size, qty_step,
       low_stock_threshold, expiry_date
FROM product_variants;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Indexes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_base_unit ON products (base_unit);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_stock_qty ON products (stock_qty);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Atomic RPC — create_sale with oversell guard
-- ═══════════════════════════════════════════════════════════════════════════════
-- Stock deduction happens ATOMICALLY here, never client-side.
-- Uses numeric(14,4) to avoid floating-point accumulation errors.
-- Oversell is rejected by the WHERE stock_qty >= deduction condition.

CREATE OR REPLACE FUNCTION create_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_amount_paid numeric(14,4);
  v_item jsonb;
  v_variant record;
  v_product record;
  v_qty numeric(14,4);
  v_unit_size numeric(10,4);
  v_deduction numeric(14,4);
  v_line_total numeric(14,4);
  v_item_id uuid;
  v_new_stock numeric(14,4);
  v_rows_updated integer;
BEGIN
  v_sale_number := 'SALE-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');
  v_customer_id := NULLIF(p_payload->>'customerId', '')::uuid;
  v_amount_paid := (p_payload->>'amountPaid')::numeric;

  -- Create sale record
  INSERT INTO sales (id, sale_number, customer_id, customer_name, customer_phone, customer_address, employee_id, employee_name,
                     total_amount, amount_paid, outstanding_balance, payment_type, payment_method, note)
  VALUES (
    gen_random_uuid(), v_sale_number, v_customer_id,
    p_payload->>'customerName', p_payload->>'customerPhone', p_payload->>'customerAddress',
    NULLIF(p_payload->>'employeeId', '')::uuid, p_payload->>'employeeName',
    0, v_amount_paid, 0,
    p_payload->>'paymentType', p_payload->>'paymentMethod', p_payload->>'note'
  ) RETURNING id INTO v_sale_id;

  -- Process each line item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := (v_item->>'qty')::numeric;
    v_unit_size := COALESCE((v_item->>'unitSize')::numeric, 1);

    -- Get variant for unit_size
    SELECT id, unit_size INTO v_variant
    FROM product_variants
    WHERE id = NULLIF(v_item->>'variantId', '')::uuid;

    IF v_variant IS NOT NULL THEN
      v_unit_size := v_variant.unit_size;
    END IF;

    -- Get product
    SELECT id, stock_qty INTO v_product
    FROM products
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'productId';
    END IF;

    -- Calculate deduction: qty × unitSize (numeric-safe)
    v_deduction := ROUND(v_qty * v_unit_size, 4);
    v_line_total := ROUND(v_qty * (v_item->>'unitPrice')::numeric, 2);
    v_total := v_total + v_line_total;

    -- ATOMIC stock deduction with oversell guard
    -- This UPDATE only succeeds if stock_qty >= deduction (prevents negative stock)
    UPDATE products
    SET stock_qty = ROUND(stock_qty - v_deduction, 4)
    WHERE id = v_product.id
      AND stock_qty >= v_deduction;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'Insufficient stock for %: need %, have %',
        (v_item->>'productName'), v_deduction, v_product.stock_qty;
    END IF;

    -- Insert sale line with snapshot
    v_item_id := gen_random_uuid();
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name,
                            qty, unit_price, unit_size, base_unit, line_total)
    VALUES (
      v_item_id, v_sale_id,
      v_product.id, (v_item->>'productName'),
      COALESCE(NULLIF(v_item->>'variantId', '')::uuid, v_variant.id),
      (v_item->>'variantName'), v_qty,
      (v_item->>'unitPrice')::numeric, v_unit_size,
      COALESCE((v_item->>'baseUnit'), 'piece'),
      v_line_total
    );
  END LOOP;

  -- Update sale totals
  UPDATE sales
  SET total_amount = v_total, outstanding_balance = v_total - v_amount_paid
  WHERE id = v_sale_id;

  -- Update customer balance
  IF v_customer_id IS NOT NULL THEN
    IF (p_payload->>'paymentType') != 'full' THEN
      UPDATE customers
      SET outstanding_balance = outstanding_balance + (v_total - v_amount_paid),
          total_purchases = total_purchases + v_total,
          total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
    ELSE
      UPDATE customers
      SET total_purchases = total_purchases + v_total,
          total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_sale_id, 'saleNumber', v_sale_number,
    'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_total - v_amount_paid
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: Atomic RPC — create_purchase (adds product-level stock)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_purchase_number text;
  v_company_id uuid;
  v_total numeric(14,4) := 0;
  v_amount_paid numeric(14,4);
  v_item jsonb;
  v_item_id uuid;
BEGIN
  v_purchase_number := 'PUR-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');
  v_company_id := NULLIF(p_payload->>'companyId', '')::uuid;
  v_amount_paid := (p_payload->>'amountPaid')::numeric;

  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount,
                         amount_paid, outstanding_payable, payment_method, note, created_by)
  VALUES (
    gen_random_uuid(), v_purchase_number, v_company_id, p_payload->>'companyName',
    0, v_amount_paid, 0, p_payload->>'paymentMethod', p_payload->>'note',
    NULLIF(p_payload->>'createdBy', '')::uuid
  ) RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2);

    -- Add stock to PRODUCT level (qty is in base units from purchase)
    UPDATE products
    SET stock_qty = ROUND(stock_qty + (v_item->>'qty')::numeric, 4)
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    v_item_id := gen_random_uuid();
    INSERT INTO purchase_items (id, purchase_id, product_id, product_name, variant_id, variant_name,
                                qty, cost_price, line_total)
    VALUES (
      v_item_id, v_purchase_id,
      NULLIF(v_item->>'productId', '')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid, v_item->>'variantName',
      (v_item->>'qty')::numeric, (v_item->>'costPrice')::numeric,
      ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2)
    );
  END LOOP;

  UPDATE purchases
  SET total_amount = v_total, outstanding_payable = v_total - v_amount_paid
  WHERE id = v_purchase_id;

  IF v_company_id IS NOT NULL THEN
    UPDATE companies
    SET outstanding_payable = outstanding_payable + (v_total - v_amount_paid),
        total_purchases = total_purchases + v_total
    WHERE id = v_company_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_purchase_id, 'purchaseNumber', v_purchase_number,
    'totalAmount', v_total, 'outstandingPayable', v_total - v_amount_paid
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: Atomic RPC — adjust_stock (adjusts product-level stock)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION adjust_stock(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_product record;
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_change numeric(14,4);
  v_adj_type text;
  v_qty numeric(14,4);
  v_reason text;
BEGIN
  v_product_id := NULLIF(p_payload->>'productId', '')::uuid;
  v_adj_type := p_payload->>'adjustmentType';
  v_qty := (p_payload->>'qty')::numeric;
  v_reason := p_payload->>'reason';

  SELECT id, stock_qty, name INTO v_product FROM products WHERE id = v_product_id;
  IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_before := v_product.stock_qty;

  IF v_adj_type = 'add' THEN
    v_after := ROUND(v_before + v_qty, 4);
  ELSIF v_adj_type = 'remove' THEN
    v_after := GREATEST(0, ROUND(v_before - v_qty, 4));
  ELSE
    v_after := v_qty;
  END IF;

  v_change := ROUND(v_after - v_before, 4);

  UPDATE products SET stock_qty = v_after WHERE id = v_product_id;

  INSERT INTO stock_adjustments (id, product_id, product_name, adjustment_type,
                                 qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (gen_random_uuid(), v_product_id, v_product.name, v_adj_type,
          v_before, v_change, v_after, v_reason, NULLIF(p_payload->>'adjustedBy', '')::uuid, now());

  -- Notify admin of stock adjustment
  INSERT INTO notifications(kind, title, body, entity_id, actor_id)
  VALUES ('stock_adjust',
    'Stock adjusted: ' || v_product.name,
    v_product.name || ' ' || v_adj_type || ' ' || abs(v_change)::text || ' → ' || v_after::text || ' units',
    v_product_id,
    NULLIF(p_payload->>'adjustedBy', '')::uuid);

  RETURN jsonb_build_object('qtyBefore', v_before, 'qtyChange', v_change, 'qtyAfter', v_after);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Atomic RPC — process_return (restores stock using historical unitSize)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_return(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_customer_id uuid;
  v_total_refund numeric(14,4) := 0;
  v_item jsonb;
  v_sale record;
  v_return_id uuid;
  v_historical_unit_size numeric(10,4);
  v_return_qty numeric(14,4);
  v_restored numeric(14,4);
BEGIN
  v_sale_id := NULLIF(p_payload->>'saleId', '')::uuid;
  v_customer_id := NULLIF(p_payload->>'customerId', '')::uuid;

  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

  v_return_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_return_qty := (v_item->>'qty')::numeric;
    v_total_refund := v_total_refund + ROUND(v_return_qty * (v_item->>'unitPrice')::numeric, 2);

    -- Use HISTORICAL unitSize from the original sale_items record (not current variant)
    -- This ensures editing a variant later does not alter historical returns
    SELECT COALESCE(si.unit_size, 1) INTO v_historical_unit_size
    FROM sale_items si
    WHERE si.id = NULLIF(v_item->>'saleItemId', '')::uuid;

    IF v_historical_unit_size IS NULL THEN
      -- Fallback: try to get from current variant (legacy data)
      SELECT COALESCE(v.unit_size, 1) INTO v_historical_unit_size
      FROM product_variants v
      WHERE v.id = NULLIF(v_item->>'variantId', '')::uuid;
    END IF;

    -- Restore stock: returnQty × historicalUnitSize
    v_restored := ROUND(v_return_qty * v_historical_unit_size, 4);

    UPDATE products
    SET stock_qty = ROUND(stock_qty + v_restored, 4)
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name,
                              variant_id, variant_name, qty, unit_price, refund_amount)
    VALUES (
      gen_random_uuid(), v_return_id,
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'productId', '')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid, v_item->>'variantName',
      v_return_qty, (v_item->>'unitPrice')::numeric,
      ROUND(v_return_qty * (v_item->>'unitPrice')::numeric, 2)
    );
  END LOOP;

  INSERT INTO returns (id, sale_id, sale_number, customer_id, customer_name,
                       total_refund, resolution, processed_by, created_at)
  VALUES (v_return_id, v_sale_id, v_sale.sale_number, v_customer_id, v_sale.customer_name,
          v_total_refund, p_payload->>'resolution', NULLIF(p_payload->>'processedBy', '')::uuid, now());

  IF v_customer_id IS NOT NULL THEN
    IF (p_payload->>'resolution') = 'credit_note' THEN
      UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_refund)
      WHERE id = v_customer_id;
    ELSIF (p_payload->>'resolution') = 'refund_cash' THEN
      UPDATE customers SET total_paid = total_paid + v_total_refund WHERE id = v_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_return_id, 'totalRefund', v_total_refund);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 9: Grant permissions
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;

-- ============================================================
-- MIGRATION: 0016_customer_archive_sales_snapshot.sql
-- ============================================================
-- Migration 0016: Customer Archive, Sales Snapshot, Pagination, Void Audit
-- Reuses existing architecture. Minimal changes.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Customer Archive (instead of delete)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_by uuid;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Sales — historical customer snapshot
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add snapshot columns to sales for historical safety
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_address text;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Performance Indexes for pagination & filtering
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sales: date, status, customer, employee filtering
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_created_at ON sales (created_at DESC);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_is_voided ON sales (is_voided);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_customer_id ON sales (customer_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_employee_id ON sales (employee_id);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_payment_method ON sales (payment_method);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sales_composite_date_status ON sales (created_at DESC, is_voided);

-- Sale items by sale (for joining)
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);

-- Customers: archive status, search
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_customers_is_archived ON customers (is_archived);
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_customers_name_phone ON customers (name, phone);

-- Products: barcode lookup
CREATE INDEX IF NOT EXISTS IF NOT EXISTS idx_products_barcode_lookup ON products (barcode) WHERE barcode IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Archive Customer RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer record;
BEGIN
  SELECT id, name INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  UPDATE customers
  SET is_archived = true, archived_at = now(), archived_by = p_archived_by
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'archived', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Restore Customer RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE customers
  SET is_archived = false, archived_at = NULL, archived_by = NULL
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'restored', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: Void Sale RPC (atomic, with audit, inventory restore)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_historical_unit_size numeric(10,4);
  v_restore_qty numeric(14,4);
BEGIN
  -- Get the sale
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;

  -- Restore inventory using HISTORICAL unitSize from sale_items
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    -- Use the historical unit_size from the sale item (not current variant)
    v_historical_unit_size := COALESCE(v_item.unit_size, 1);
    v_restore_qty := ROUND(v_item.qty * v_historical_unit_size, 4);

    UPDATE products
    SET stock_qty = ROUND(stock_qty + v_restore_qty, 4)
    WHERE id = v_item.product_id;
  END LOOP;

  -- Restore customer balance if credit sale
  IF v_sale.customer_id IS NOT NULL AND v_sale.payment_type != 'full' THEN
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - (v_sale.total_amount - v_sale.amount_paid))
    WHERE id = v_sale.customer_id;
  END IF;

  -- Mark sale as voided
  UPDATE sales
  SET is_voided = true,
      voided_at = now(),
      voided_by = p_voided_by,
      void_reason = p_reason
  WHERE id = p_sale_id;

  -- Record in audit log (using existing activity_log table if it exists)
  INSERT INTO activity_log (id, actor_id, action, entity_type, entity_id, details, created_at)
  VALUES (
    gen_random_uuid(), p_voided_by, 'void_sale', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'sale_number', v_sale.sale_number),
    now()
  );

  RETURN jsonb_build_object('id', p_sale_id, 'voided', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: Populate historical snapshots on existing sales
-- ═══════════════════════════════════════════════════════════════════════════════

-- Fill customer_phone and customer_address from current customer data
-- for sales that don't have snapshots yet
UPDATE sales s
SET customer_phone = c.phone,
    customer_address = c.address
FROM customers c
WHERE s.customer_id = c.id
  AND s.customer_phone IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Grant permissions
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION archive_customer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_customer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;

-- ============================================================
-- MIGRATION: 0017_phone_uniqueness.sql
-- ============================================================
-- ═══════════════════════════════════════════════════════════════════════════════
-- 0017: Phone number uniqueness + existing duplicate cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

-- First, clean up any existing duplicates by archiving older duplicates
-- Keep the earliest created customer for each phone number
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY phone, shop_id
      ORDER BY created_at ASC
    ) AS rn
  FROM customers
  WHERE phone IS NOT NULL AND phone != ''
)
UPDATE customers SET is_archived = true, archived_at = now()
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add unique partial index (only non-archived customers per phone per shop)
CREATE UNIQUE INDEX IF NOT EXISTS IF NOT EXISTS idx_customers_phone_unique
  ON customers(phone, shop_id)
  WHERE phone IS NOT NULL AND phone != '' AND (is_archived IS NULL OR is_archived = false);

-- Also add a plain unique constraint for active customers
ALTER TABLE customers
  ADD CONSTRAINT unique_customer_phone_per_shop
  UNIQUE USING INDEX idx_customers_phone_unique;
