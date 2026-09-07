-- ============================================================
-- DEPLOYMENT SCRIPT: Security RLS Hardening
-- Run this ENTIRE script in Supabase Dashboard SQL Editor
-- ============================================================

-- ─── 1. Drop permissive demo/dev policies ──────────────────────

-- Customers
DROP POLICY IF EXISTS "public_all_customers" ON customers;
DROP POLICY IF EXISTS "customers_dev_all" ON customers;

-- Sales
DROP POLICY IF EXISTS "public_all_sales" ON sales;
DROP POLICY IF EXISTS "sales_dev_all" ON sales;

-- Users
DROP POLICY IF EXISTS "public_all_users" ON users;
DROP POLICY IF EXISTS "users_dev_all" ON users;
DROP POLICY IF EXISTS "users_select_all" ON users;

-- Drop duplicate policies from earlier migrations
DROP POLICY IF EXISTS "customers_read" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "sales_read" ON sales;
DROP POLICY IF EXISTS "sales_insert" ON sales;
DROP POLICY IF EXISTS "sales_update" ON sales;
DROP POLICY IF EXISTS "sales_select" ON sales;

-- ─── 2. Create proper restrictive policies ─────────────────────

-- CUSTOMERS: SELECT/INSERT/UPDATE for authenticated only
CREATE POLICY customers_select ON customers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY customers_insert ON customers
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY customers_update ON customers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- No DELETE policy — use archive_customer RPC

-- SALES: SELECT/INSERT/UPDATE for authenticated only
CREATE POLICY sales_select ON sales
  FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_insert ON sales
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sales_update ON sales
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- No DELETE policy — use void_sale RPC

-- USERS: SELECT/INSERT/UPDATE for authenticated only
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated USING (true);
CREATE POLICY users_insert ON users
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY users_update ON users
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── 3. Create safe public view (excludes pin_hash) ───────────

DROP VIEW IF EXISTS users_public;
CREATE VIEW users_public AS
  SELECT id, name, role, phone, shop_id, is_active, created_at, updated_at
  FROM users;
GRANT SELECT ON users_public TO anon;
GRANT SELECT ON users_public TO authenticated;
REVOKE SELECT ON users FROM anon;

-- ─── 4. Restore Bilal's financial baseline ─────────────────────

UPDATE customers
SET outstanding_balance = 3880, total_purchases = 9010
WHERE id = '00000000-0000-0000-0000-000000000052';

-- ============================================================
-- DONE. After running, verify with:
--   SELECT * FROM pg_policies WHERE tablename IN ('customers','sales','users');
--   SELECT pin_hash FROM users LIMIT 1;  -- should fail for anon
-- ============================================================
