-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0128: Stock of record is the variant — make the product rollup derived
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM (evidenced, not assumed):
--
--   Inventory has two columns. `create_sale`, `create_purchase`, `process_return`,
--   `void_sale_v1` and `adjust_stock` all mutate `product_variants.stock_qty`, and
--   `adjust_stock` documents the intent in its own comment: "the variant is the
--   authoritative stock level", recomputing `products.stock_qty` as the SUM of the
--   product's active variants.
--
--   But that recomputation happens ONLY inside `adjust_stock`. Every sale, purchase,
--   return and void moves the variant and leaves `products.stock_qty` behind, so any
--   screen that reads the product column (reports low-stock, inventory alerts,
--   reorder suggestions, sale browse, product detail) shows stale inventory.
--
--   `void_sale` — the function the app actually calls (src/lib/db.ts, offlineQueue)
--   — is worse than stale: it restores `products.stock_qty += qty * unit_size` and
--   never touches the variant. Stock of record therefore stays permanently reduced
--   after a void, and the product column is inflated by a base-unit quantity that no
--   other path uses (create_sale deducts the variant by `qty`, and process_return
--   restores the variant by `qty` — unit_size is multiplied nowhere else).
--
-- FIX (at the layer that owns the data, so no RPC has to remember):
--   1. `products.stock_qty` becomes a derived value, maintained by trigger with the
--      exact semantic `adjust_stock` already defines (SUM of active variants).
--   2. `void_sale` restores the VARIANT, honouring quantities already returned, and
--      returns the number of units restored.
--
-- Historical data is repaired by the backfill; nothing is deleted or rewritten
-- beyond the derived column.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Derived product rollup
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER on purpose: `products` is guarded by `protect_product_stock`,
-- which refuses stock changes from anyone but the owner. This function IS the
-- owner's sanctioned writer for the derived column, and pinning search_path keeps
-- it safe.
CREATE OR REPLACE FUNCTION public.sync_product_stock_rollup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_rollup numeric;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Same definition as adjust_stock: the product total is its ACTIVE variants.
  SELECT COALESCE(SUM(stock_qty), 0)
    INTO v_rollup
  FROM product_variants
  WHERE product_id = v_product_id AND is_active = true;

  UPDATE products
     SET stock_qty = v_rollup, updated_at = now()
   WHERE id = v_product_id
     AND stock_qty IS DISTINCT FROM v_rollup;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS sync_product_stock_rollup_trg ON public.product_variants;
CREATE TRIGGER sync_product_stock_rollup_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.sync_product_stock_rollup();

-- Repair any product whose derived total had drifted.
UPDATE products p
   SET stock_qty = COALESCE((
         SELECT SUM(v.stock_qty) FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active = true
       ), 0)
 WHERE p.stock_qty IS DISTINCT FROM COALESCE((
         SELECT SUM(v.stock_qty) FROM product_variants v
          WHERE v.product_id = p.id AND v.is_active = true
       ), 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. void_sale restores the variant (the stock of record)
-- ─────────────────────────────────────────────────────────────────────────────
-- Only the stock block changes. Void semantics (reason required, already-voided
-- rejected, outstanding/history reversal, audit event) are preserved exactly.
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_already_returned numeric(14,4);
  v_sale_shop uuid;
BEGIN
  v_actor := COALESCE(app_current_user_id(), p_voided_by);

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = p_sale_id;
  PERFORM authorize_business_action('sales.void', COALESCE(v_sale_shop, current_shop_id()));

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    -- Restore only what the sale removed and no return already put back. The
    -- variant is the stock of record (create_sale deducts there by `qty`), and the
    -- product-level column follows from the rollup trigger.
    v_change := ROUND(v_item.qty - v_already_returned, 4);

    IF v_item.variant_id IS NOT NULL AND v_change > 0 THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_item.variant_id;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_change;
      UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_item.variant_id;
      v_restored_stock := v_restored_stock + v_change;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, created_by, created_at)
      VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
        'void', p_sale_id, v_actor, now());
    END IF;
  END LOOP;

  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.total_amount > 0 THEN
    UPDATE customers SET total_purchases = GREATEST(0, total_purchases - v_sale.total_amount), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason, v_actor, now())
  RETURNING id INTO v_void_id;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, voided_by_name = (SELECT name FROM users WHERE id = v_actor), void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'sale_voided', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'reversedOutstanding', v_unpaid));

  RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$function$;
