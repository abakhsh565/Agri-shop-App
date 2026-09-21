-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0139: one intention, one adjustment
-- ═══════════════════════════════════════════════════════════════════════════════
-- Found by submitting every consequential action twice at the same instant, the
-- way a double tap submits it (real JWT, real database).
--
-- DEFECT — adjust_stock had no idempotency of any kind
--   Two taps applied the adjustment twice: stock 50 → 60 and TWO inventory
--   movements for one decision. Inventory is the quantity the shop counts its
--   money against, so a duplicated adjustment is a wrong stock figure that no
--   later screen can detect.
--
-- FIX — the same claim-then-apply shape as create_sale (0134) and
--   record_supplier_payment (0138):
--     1. the adjustment row is inserted FIRST, carrying a client key, so the
--        partial unique index rejects a duplicate before any stock moves —
--        `BEGIN ... EXCEPTION WHEN unique_violation` also catches the concurrent
--        case, because the second insert blocks until the first commits;
--     2. a retry of an already-recorded adjustment returns THAT adjustment
--        rather than applying a second one. The key stays valid after a genuine
--        failure, because the failed attempt rolled back with it.
--
-- Stock maths, validation messages, the product/variant writes, the movement log
-- and the audit event are all byte-for-byte the behaviour verified in 0112 — only
-- the claim and a row returned on duplicate are new.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_adjustments_idempotency_key
  ON public.stock_adjustments (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

COMMENT ON COLUMN public.stock_adjustments.idempotency_key IS
  'Client-generated key for one logical stock adjustment. Same key = same adjustment: a double tap applies stock once.';

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
  v_key text;
  v_existing record;
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

  -- A retry of an adjustment that already went through returns THAT adjustment.
  v_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');
  IF v_key IS NOT NULL THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'qtyBefore', v_existing.qty_before,
        'qtyChange', v_existing.qty_change,
        'qtyAfter', v_existing.qty_after,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

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

  -- Claim the key BEFORE any stock moves. A duplicate loses the claim here and
  -- never reaches the writes below.
  v_id := gen_random_uuid();

  BEGIN
    INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
      adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, idempotency_key, created_at)
    VALUES (v_id, v_product_id, payload->>'productName',
      v_variant_id, COALESCE(payload->>'variantName', ''),
      v_adjustment_type, v_before, v_after - v_before, v_after,
      payload->>'reason', v_actor::text, v_key, now());

  EXCEPTION WHEN unique_violation THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    RETURN jsonb_build_object(
      'id', v_existing.id,
      'qtyBefore', v_existing.qty_before,
      'qtyChange', v_existing.qty_change,
      'qtyAfter', v_existing.qty_after,
      'idempotent', true
    );
  END;

  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  IF v_variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;
  END IF;

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
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after));

  RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.adjust_stock(jsonb) TO authenticated;

-- (Verified in .freebuff/tmp/prove-more-taps.mjs against QA: two simultaneous
--  adjustments sharing a key move stock once and log one movement; without a key
--  the call behaves exactly as before.)
