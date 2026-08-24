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
