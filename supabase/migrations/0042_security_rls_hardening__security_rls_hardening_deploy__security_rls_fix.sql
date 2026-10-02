-- MERGED: three consecutive files share migration version 0042, which makes a
-- fresh `supabase db push` fail with a duplicate key on
-- supabase_migrations.schema_migrations. All bodies follow, in the order the
-- runner would have applied them:
--   1. 0042_security_rls_hardening.sql
--   2. 0042_security_rls_hardening_deploy.sql
--   3. 0042b_security_rls_fix.sql
--
-- Body 3 arrived under the suffixed name `0042b_security_rls_fix.sql`. A version
-- with a letter suffix is not canonical: it cannot be produced by
-- `supabase migration new`, it is not a valid timestamp version, and it sorts
-- between 0042 and 0043 only by accident. Its content is the direct follow-up to
-- 0042 — it undoes the anon-SELECT block that body 2 introduced — so it is
-- merged here rather than renumbered, and the suffixed filename is retired.
-- No database ever recorded version `0042b` (the manual deploys went through
-- run_sql, and both live ledgers stop long before 0042), so this rename is
-- invisible to every environment.

-- ============================================================
-- MIGRATION: 0042_security_rls_hardening.sql
-- ============================================================
-- Security hardening: drop permissive demo/dev RLS policies
-- and create proper restrictive policies.
--
-- Fixes found vulnerabilities:
-- 1. Anon can INSERT/UPDATE customers (via public_all_customers)
-- 2. Anon can DELETE sales (via public_all_sales)
-- 3. Anon can read users.pin_hash (via public_all_users / users_dev_all)
-- ============================================================

-- ─── 1. Drop permissive demo/dev policies ──────────────────────

-- Customers: drop the permissive FOR ALL policies
DROP POLICY IF EXISTS "public_all_customers" ON customers;
DROP POLICY IF EXISTS "customers_dev_all" ON customers;

-- Sales: drop the permissive FOR ALL policies
DROP POLICY IF EXISTS "public_all_sales" ON sales;
DROP POLICY IF EXISTS "sales_dev_all" ON sales;

-- Users: drop the permissive FOR ALL policies
DROP POLICY IF EXISTS "public_all_users" ON users;
DROP POLICY IF EXISTS "users_dev_all" ON users;
DROP POLICY IF EXISTS "users_select_all" ON users;

-- Also drop any duplicate policies from earlier migrations
-- that conflict with the new ones
DROP POLICY IF EXISTS "customers_read" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "sales_read" ON sales;
DROP POLICY IF EXISTS "sales_insert" ON sales;
DROP POLICY IF EXISTS "sales_update" ON sales;
DROP POLICY IF EXISTS "sales_select" ON sales;

-- ─── 2. Create proper restrictive policies ─────────────────────

-- ── CUSTOMERS ──
-- SELECT: any authenticated user can read
CREATE POLICY customers_select ON customers
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only authenticated users (blocks anon)
CREATE POLICY customers_insert ON customers
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- UPDATE: only authenticated users (blocks anon)
CREATE POLICY customers_update ON customers
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- No DELETE policy for customers — deletes are blocked by default.
-- Use archive_customer RPC for soft-delete.

-- ── SALES ──
-- SELECT: any authenticated user can read
CREATE POLICY sales_select ON sales
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only authenticated users (blocks anon)
CREATE POLICY sales_insert ON sales
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- UPDATE: only authenticated users (blocks anon)
CREATE POLICY sales_update ON sales
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- No DELETE policy for sales — sales cannot be deleted.
-- Use void_sale RPC to void sales.

-- ── USERS ──
-- SELECT: authenticated users can read (pin_hash excluded via view)
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: only authenticated (for registration)
CREATE POLICY users_insert ON users
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- UPDATE: only authenticated users (for own profile)
CREATE POLICY users_update ON users
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- ─── 3. Create a safe public view that excludes pin_hash ───────

-- Drop the view if it exists
DROP VIEW IF EXISTS users_public;

-- Create a view that excludes sensitive columns
CREATE VIEW users_public AS
  SELECT id, name, role, phone, shop_id, is_active, created_at, updated_at
  FROM users;

-- Grant access to the view for anon (so app can check user existence)
GRANT SELECT ON users_public TO anon;
GRANT SELECT ON users_public TO authenticated;

-- Revoke direct table access from anon for users
REVOKE SELECT ON users FROM anon;

-- ─── 4. Verify no orphaned permissive policies remain ──────────
-- (This is a comment — the DROP POLICY statements above handle this)

-- ─── Done ──────────────────────────────────────────────────────

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

-- ============================================================
-- BODY 3: 0042b_security_rls_fix.sql (formerly version 0042b)
-- ============================================================
-- The previous migration blocked anon SELECT which the app needs.
-- This fix allows anon SELECT (for initial data load) but blocks
-- anon INSERT/UPDATE/DELETE on customers and sales.
-- ============================================================

-- ─── 1. Drop the too-aggressive policies ───────────────────────

DROP POLICY IF EXISTS "customers_select" ON customers;
DROP POLICY IF EXISTS "customers_insert" ON customers;
DROP POLICY IF EXISTS "customers_update" ON customers;
DROP POLICY IF EXISTS "sales_select" ON sales;
DROP POLICY IF EXISTS "sales_insert" ON sales;
DROP POLICY IF EXISTS "sales_update" ON sales;
DROP POLICY IF EXISTS "users_select" ON users;
DROP POLICY IF EXISTS "users_insert" ON users;
DROP POLICY IF EXISTS "users_update" ON users;

-- ─── 2. Create corrected policies ──────────────────────────────

-- ── CUSTOMERS ──
-- SELECT: allow anon AND authenticated (app needs anon for initial load)
CREATE POLICY customers_select ON customers
  FOR SELECT USING (true);

-- INSERT: authenticated only (blocks anon)
CREATE POLICY customers_insert ON customers
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: authenticated only (blocks anon)
CREATE POLICY customers_update ON customers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- No DELETE policy — blocked by default. Use archive_customer RPC.

-- ── SALES ──
-- SELECT: allow anon AND authenticated
CREATE POLICY sales_select ON sales
  FOR SELECT USING (true);

-- INSERT: authenticated only (blocks anon)
CREATE POLICY sales_insert ON sales
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: authenticated only (blocks anon)
CREATE POLICY sales_update ON sales
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- No DELETE policy — blocked by default. Use void_sale RPC.

-- ── USERS ──
-- SELECT: authenticated only (pin_hash protection)
CREATE POLICY users_select ON users
  FOR SELECT TO authenticated USING (true);

-- INSERT: authenticated only
CREATE POLICY users_insert ON users
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPDATE: authenticated only
CREATE POLICY users_update ON users
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── 3. Verify users_public view still works ──────────────────
-- (Created in 0042 — should still exist)

-- ─── Done ──────────────────────────────────────────────────────
