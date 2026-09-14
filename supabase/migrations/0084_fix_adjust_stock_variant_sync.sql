-- Migration 0084: Fix adjust_stock — update BOTH products AND product_variants
--
-- Root cause discovered via real browser E2E:
--   adjust_stock updated products.stock_qty but NOT product_variants.stock_qty.
--   The product list view reads products.stock_qty (correct after adjustment).
--   The product detail/adjust pages read product_variants.stock_qty (stale).
--   Result: stock shows correct value in list but wrong value on detail/adjust pages.
--
-- Fix: after updating products.stock_qty, also update the matching variant's stock_qty.
-- This ensures all UI surfaces read consistent stock values.

DROP FUNCTION IF EXISTS adjust_stock(jsonb);

CREATE OR REPLACE FUNCTION adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
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
  v_variant_id := NULLIF(payload->>'variantId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;

  -- Get current stock from the product-level summary
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

  -- Update product-level stock (used by product list, dashboard, reports)
  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  -- Also update variant-level stock (used by product detail, adjust stock, sale pages)
  IF v_variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;
  END IF;

  -- Record adjustment
  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (v_id, v_product_id, payload->>'productName',
    v_variant_id, COALESCE(payload->>'variantName', ''),
    v_adjustment_type, v_before, v_after - v_before, v_after,
    payload->>'reason', v_actor::text, now());

  -- Create inventory movement
  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    v_variant_id,
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
