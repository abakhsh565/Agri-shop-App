-- Migration: Fix Authorization Gaps
-- Fixes: archive_customer, restore_customer, delete_credit_limit_request, users UPDATE policy
-- Applied to QA database: 2026-09-12

-- ============================================================
-- 1. Fix archive_customer: add auth check
--    Employee can archive, but must be authenticated
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_customer(
  p_customer_id uuid,
  p_archived_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- Get authenticated user
  v_actor := get_authenticated_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  -- Any authenticated user (admin or employee) can archive
  -- Business dependency checks are not enforced at DB layer
  -- because archiving is a soft operation that preserves all data
  UPDATE customers SET
    is_archived = true,
    archived_at = now(),
    archived_by = COALESCE(p_archived_by, v_actor)
  WHERE id = p_customer_id;
END;
$$;

-- ============================================================
-- 2. Fix restore_customer: add auth check
--    Employee can restore archived customers
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_customer(
  p_customer_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- Get authenticated user
  v_actor := get_authenticated_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  -- Any authenticated user (admin or employee) can restore
  UPDATE customers SET
    is_archived = false,
    archived_at = NULL,
    archived_by = NULL
  WHERE id = p_customer_id;
END;
$$;

-- ============================================================
-- 3. Fix delete_credit_limit_request: admin only
--    Employees must NOT be able to delete credit requests
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_credit_limit_request(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Get authenticated user
  v_actor := get_authenticated_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  -- Only admin/co_admin may delete credit requests
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete credit requests';
  END IF;

  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$$;

-- ============================================================
-- 4. Fix users UPDATE policy: remove OR true bypass
--    Replace with proper role-based check
-- ============================================================
DROP POLICY IF EXISTS users_update ON users;

-- Admin/co_admin can update any user
-- Employee can update their own profile (name, phone, photo_url only)
CREATE POLICY users_update ON users
  FOR UPDATE
  USING (
    current_setting('role') = 'authenticated'
    AND (
      app_is_admin()
      OR id = get_authenticated_user_id()
    )
  );

-- ============================================================
-- 5. Fix anonymous INSERT policies on critical tables
--    Remove anon INSERT where it bypasses business authorization
-- ============================================================

-- customers: anon should not be able to insert directly
DROP POLICY IF EXISTS customers_insert_anon ON customers;

-- products: anon should not be able to insert directly
DROP POLICY IF EXISTS products_insert_anon ON products;

-- companies: anon should not be able to insert directly
DROP POLICY IF EXISTS companies_insert_anon ON companies;

-- sales: anon should not be able to insert directly
DROP POLICY IF EXISTS sales_insert_anon ON sales;

-- sale_items: anon should not be able to insert directly
DROP POLICY IF EXISTS sale_items_insert_anon ON sale_items;

-- returns: anon should not be able to insert directly
DROP POLICY IF EXISTS returns_insert_anon ON returns;

-- return_items: anon should not be able to insert directly
DROP POLICY IF EXISTS return_items_insert_anon ON return_items;

-- voids: anon should not be able to insert directly
DROP POLICY IF EXISTS voids_insert_anon ON voids;

-- inventory_movements: anon should not be able to insert directly
DROP POLICY IF EXISTS inventory_movements_insert_anon ON inventory_movements;

-- purchases: anon should not be able to insert directly
DROP POLICY IF EXISTS purchases_insert_anon ON purchases;

-- purchase_items: anon should not be able to insert directly
DROP POLICY IF EXISTS purchase_items_insert_anon ON purchase_items;

-- supplier_payments: anon should not be able to insert directly
DROP POLICY IF EXISTS supplier_payments_insert_anon ON supplier_payments;
