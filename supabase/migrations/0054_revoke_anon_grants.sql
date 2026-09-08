-- ============================================================
-- Migration 0054: Revoke Anon Grants — Enforce RLS
--
-- PROBLEM: The `anon` role has direct GRANT permissions on
-- business tables, which bypass RLS policies.
--
-- SOLUTION: Revoke INSERT/UPDATE/DELETE grants from anon on
-- all business tables. Keep SELECT grants (app needs to read).
-- SECURITY DEFINER RPCs bypass RLS and still work.
-- ============================================================

-- ── Revoke write permissions from anon ───────────────────────

-- customers
REVOKE INSERT, UPDATE, DELETE ON customers FROM anon;

-- companies
REVOKE INSERT, UPDATE, DELETE ON companies FROM anon;

-- products
REVOKE INSERT, UPDATE, DELETE ON products FROM anon;

-- product_variants
REVOKE INSERT, UPDATE, DELETE ON product_variants FROM anon;

-- sales
REVOKE INSERT, UPDATE, DELETE ON sales FROM anon;

-- sale_items
REVOKE INSERT, UPDATE, DELETE ON sale_items FROM anon;

-- returns
REVOKE INSERT, UPDATE, DELETE ON returns FROM anon;

-- return_items
REVOKE INSERT, UPDATE, DELETE ON return_items FROM anon;

-- voids
REVOKE INSERT, UPDATE, DELETE ON voids FROM anon;

-- purchases
REVOKE INSERT, UPDATE, DELETE ON purchases FROM anon;

-- purchase_items
REVOKE INSERT, UPDATE, DELETE ON purchase_items FROM anon;

-- supplier_payments
REVOKE INSERT, UPDATE, DELETE ON supplier_payments FROM anon;

-- inventory_movements
REVOKE INSERT, UPDATE, DELETE ON inventory_movements FROM anon;

-- customer_crops
REVOKE INSERT, UPDATE, DELETE ON customer_crops FROM anon;

-- reminder_occurrences
REVOKE INSERT, UPDATE, DELETE ON reminder_occurrences FROM anon;

-- shop_requests
REVOKE INSERT, UPDATE, DELETE ON shop_requests FROM anon;

-- ── Ensure authenticated role also has restrictions ──────────
-- The app uses anon key, but let's be consistent
REVOKE INSERT, UPDATE, DELETE ON customers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON companies FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON products FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON sales FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON voids FROM authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
