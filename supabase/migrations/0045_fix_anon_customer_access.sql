-- ============================================================
-- FIX: 0045_fix_anon_customer_access.sql
-- ============================================================
-- Migration 0042b restricted customers INSERT/UPDATE to
-- "authenticated" only. But the app uses the anon key for all
-- operations (custom phone+OTP login, no Supabase Auth session).
-- This broke customer creation, image upload, due-date editing,
-- archive/restore fallback, and customer profile editing.
--
-- FIX: Allow anon INSERT/UPDATE on customers.
-- Financial protection is enforced by triggers/RPCs, not RLS.
-- ============================================================

-- Fix customers INSERT policy
DROP POLICY IF EXISTS "customers_insert" ON customers;
CREATE POLICY customers_insert ON customers
  FOR INSERT TO anon WITH CHECK (true);

-- Fix customers UPDATE policy
DROP POLICY IF EXISTS "customers_update" ON customers;
CREATE POLICY customers_update ON customers
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Fix sales INSERT policy (create_sale RPC bypasses RLS, but
-- direct inserts via the app's fetch-based flow need this)
DROP POLICY IF EXISTS "sales_insert" ON sales;
CREATE POLICY sales_insert ON sales
  FOR INSERT TO anon WITH CHECK (true);

-- Fix sales UPDATE policy (needed for void_sale RPC frontend calls,
-- process_return, etc.)
DROP POLICY IF EXISTS "sales_update" ON sales;
CREATE POLICY sales_update ON sales
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- NOTE: We keep authenticated policies too for future Supabase Auth migration.
-- If both anon and authenticated policies exist, both roles are covered.

-- Ensure authenticated also has access (additive, not destructive)
DROP POLICY IF EXISTS "customers_insert_auth" ON customers;
CREATE POLICY customers_insert_auth ON customers
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "customers_update_auth" ON customers;
CREATE POLICY customers_update_auth ON customers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sales_insert_auth" ON sales;
CREATE POLICY sales_insert_auth ON sales
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "sales_update_auth" ON sales;
CREATE POLICY sales_update_auth ON sales
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
