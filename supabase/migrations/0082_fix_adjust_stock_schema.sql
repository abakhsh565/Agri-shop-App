-- Migration 0082: Fix adjust_stock — schema alignment
--
-- Root cause: stock_adjustments table was created with a simpler schema
-- (id, variant_id, adjustment_type, qty_change, reason, adjusted_by, created_at, shop_id)
-- but adjust_stock function from migration 0050 assumed columns that don't exist:
-- product_id, product_name, variant_name, qty_before, qty_after.
--
-- Fix:
-- 1. Add the missing columns (IF NOT EXISTS for idempotency)
-- 2. Backfill product_id from product_variants
-- 3. Redeploy adjust_stock with correct column references
-- 4. Also fix archive_customer, restore_customer, delete_credit_limit_request
--    to not use get_authenticated_user_id() (migration 0081 may not have deployed)

-- ── 1. Add missing columns to stock_adjustments ──────────────
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS product_name text;
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS variant_name text;
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS qty_before numeric(12,2);
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS qty_after numeric(12,2);

-- Backfill product_id from variant's parent product
UPDATE stock_adjustments sa
SET product_id = pv.product_id
FROM product_variants pv
WHERE sa.variant_id = pv.id AND sa.product_id IS NULL;

-- Index for product-level queries
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id ON stock_adjustments(product_id);

-- ── 2. Fix adjust_stock ──────────────────────────────────────
DROP FUNCTION IF EXISTS adjust_stock(jsonb);

CREATE OR REPLACE FUNCTION adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_caller_role text;
  v_adjustment_type text;
BEGIN
  -- Resolve actor: payload → JWT → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may adjust stock
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can adjust stock';
  END IF;

  v_product_id := NULLIF(payload->>'productId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;

  -- Get current stock
  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

  -- Calculate new stock level
  IF v_adjustment_type = 'add' THEN
    v_after := v_before + v_qty;
  ELSIF v_adjustment_type = 'remove' THEN
    v_after := GREATEST(0, v_before - v_qty);
  ELSIF v_adjustment_type = 'set' THEN
    v_after := v_qty;
  ELSE
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE: Unknown adjustment type: %', v_adjustment_type;
  END IF;

  IF v_after = v_before THEN
    RAISE EXCEPTION 'NO_CHANGE: Adjustment does not change stock level';
  END IF;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: Adjustment would make stock negative';
  END IF;

  -- Update product stock
  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  -- Record adjustment
  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (v_id, v_product_id, payload->>'productName',
    NULLIF((payload->>'variantId'), '')::uuid, COALESCE(payload->>'variantName', ''),
    v_adjustment_type, v_before, v_after - v_before, v_after,
    payload->>'reason', v_actor::text, now());

  -- Create inventory movement
  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    NULLIF((payload->>'variantId'), '')::uuid,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;

-- ── 3. Fix archive_customer ───────────────────────────────────
DROP FUNCTION IF EXISTS archive_customer(uuid, uuid);
CREATE OR REPLACE FUNCTION archive_customer(
  p_customer_id uuid,
  p_archived_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_actor uuid;
BEGIN
  v_actor := COALESCE(
    p_archived_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  UPDATE customers SET
    is_archived = true,
    archived_at = now(),
    archived_by = v_actor
  WHERE id = p_customer_id;
END;
$fn$;

-- ── 4. Fix restore_customer ──────────────────────────────────
DROP FUNCTION IF EXISTS restore_customer(uuid);
CREATE OR REPLACE FUNCTION restore_customer(
  p_customer_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
BEGIN
  UPDATE customers SET
    is_archived = false,
    archived_at = NULL,
    archived_by = NULL
  WHERE id = p_customer_id;
END;
$fn$;

-- ── 5. Fix delete_credit_limit_request ───────────────────────
DROP FUNCTION IF EXISTS delete_credit_limit_request(uuid);
CREATE OR REPLACE FUNCTION delete_credit_limit_request(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete credit requests';
  END IF;

  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$fn$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
