-- ============================================================
-- FIX: 0042b_security_rls_fix.sql
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
