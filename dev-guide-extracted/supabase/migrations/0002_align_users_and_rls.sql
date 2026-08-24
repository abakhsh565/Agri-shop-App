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
