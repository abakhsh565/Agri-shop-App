-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0114: adjust_stock must adjust the level it was asked to adjust
-- ═══════════════════════════════════════════════════════════════════════════════
-- BUG (reproduced): the admin UI always sends a variantId, and the variant is
-- the authoritative stock level (sales decrement product_variants). adjust_stock
-- nevertheless computed qtyBefore/qtyAfter from products.stock_qty and then
-- *overwrote* the variant with that product-level number.
--
--   variant stock 10, products.stock_qty 0, adjustment "add 5"
--     before: qtyBefore=0 → qtyAfter=5 → BOTH levels set to 5
--     expected: variant 15 (and product rollup 15)
--
-- So a normal stock adjustment silently destroyed real inventory. This fixes the
-- level resolution and keeps products.stock_qty as a rollup of variant stock.
--
-- Authorization and tenant scoping from 0112 are preserved unchanged.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_adjustment_type text;
  v_shop uuid;
  v_variant_count int;
  v_rollup numeric(12,2);
BEGIN
  v_actor := app_current_user_id();
  v_product_id := NULLIF(payload->>'productId', '')::uuid;
  v_variant_id := NULLIF(payload->>'variantId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('inventory.adjust', COALESCE(v_shop, current_shop_id()));

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product does not belong to your organization';
  END IF;

  IF v_variant_id IS NOT NULL THEN
    -- Variant-level adjustment: the variant is the authoritative stock level.
    SELECT stock_qty INTO v_before
    FROM product_variants
    WHERE id = v_variant_id AND product_id = v_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'VARIANT_NOT_FOUND: Variant does not belong to this product';
    END IF;
    v_before := COALESCE(v_before, 0);

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

    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;

    -- Product-level stock is a rollup of its active variants so the product
    -- list, dashboard and reports stay consistent with real inventory.
    SELECT COALESCE(SUM(stock_qty), 0), count(*)
      INTO v_rollup, v_variant_count
    FROM product_variants
    WHERE product_id = v_product_id AND is_active = true;

    UPDATE products SET stock_qty = v_rollup, updated_at = now() WHERE id = v_product_id;
  ELSE
    -- Product-level adjustment with no variant target (legacy path).
    SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
    v_before := COALESCE(v_before, 0);

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

    UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

    -- Only mirror onto a variant when the product has exactly one, otherwise the
    -- single product total cannot be attributed to a variant.
    SELECT count(*) INTO v_variant_count FROM product_variants WHERE product_id = v_product_id;
    IF v_variant_count = 1 THEN
      UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE product_id = v_product_id;
    END IF;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (v_id, v_product_id, payload->>'productName',
    v_variant_id, COALESCE(payload->>'variantName', ''),
    v_adjustment_type, v_before, v_after - v_before, v_after,
    payload->>'reason', v_actor::text, now());

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    v_variant_id,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_adjusted', 'product', v_product_id,
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after,
      'variantId', v_variant_id));

  RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.adjust_stock(jsonb) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'adjust_stock'
      AND pg_get_functiondef(p.oid) LIKE '%authorize_business_action%'
      AND pg_get_functiondef(p.oid) LIKE '%VARIANT_NOT_FOUND%'
  ) THEN
    RAISE EXCEPTION 'adjust_stock was not replaced with the variant-authoritative version';
  END IF;
  RAISE NOTICE '0114: adjust_stock now adjusts the requested stock level and rolls product stock up';
END $$;
