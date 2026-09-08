-- ============================================================
-- Migration 0052: Block process_return on voided sales
--
-- BUG: process_return allows returns on voided sales, which would
-- double-restore inventory (void already restored the stock).
--
-- FIX: Add a check at the start of process_return that rejects
-- returns on voided sales with a clear error message.
-- ============================================================

DROP FUNCTION IF EXISTS process_return(jsonb);

CREATE OR REPLACE FUNCTION process_return(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_sale_id uuid := COALESCE((payload->>'sale_id')::uuid, (payload->>'saleId')::uuid);
  v_customer_id uuid;
  v_customer_name text;
  v_resolution text;
  v_reason text;
  v_idempotency_key text;
  v_items jsonb;
  v_item jsonb;
  v_return_id uuid;
  v_return_number text;
  v_total_refund numeric(14,4) := 0;
  v_sale_created timestamptz;
  v_original_qty int;
  v_already_returned int;
  v_request_qty int;
  v_sale_item_sale_id uuid;
  v_sale_item_unit_size numeric;
  v_processed_by uuid;
  v_processed_by_name text;
  v_sale_payment_type text;
  v_credit_return_total numeric(14,4) := 0;
  v_item_value numeric;
  v_unit_price numeric;
  v_sale_total numeric;
  v_sale_paid numeric;
  v_credit_ratio numeric := 1;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_product_id uuid;
  v_sale_is_voided boolean;
BEGIN
  v_customer_name := COALESCE(payload->>'customer_name', payload->>'customerName', 'Customer');
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := trim(COALESCE(payload->>'reason', ''));
  v_idempotency_key := COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey');
  v_items := COALESCE(payload->'items', '[]'::jsonb);

  v_customer_id := COALESCE(
    NULLIF(payload->>'customer_id','')::uuid,
    NULLIF(payload->>'customerId','')::uuid
  );

  v_processed_by := auth.uid();
  IF v_processed_by IS NULL THEN
    v_processed_by := COALESCE(
      NULLIF(payload->>'processed_by','')::uuid,
      NULLIF(payload->>'processedBy','')::uuid
    );
  END IF;
  v_processed_by_name := COALESCE(payload->>'processed_by_name', payload->>'processedByName', '');
  IF v_processed_by_name = '' AND v_processed_by IS NOT NULL THEN
    SELECT name INTO v_processed_by_name FROM users WHERE id = v_processed_by;
  END IF;
  v_processed_by_name := COALESCE(v_processed_by_name, 'Staff');

  IF v_idempotency_key IS NOT NULL AND v_idempotency_key != '' THEN
    SELECT r.id, r.return_number, r.total_refund INTO v_return_id, v_return_number, v_total_refund
    FROM returns r WHERE r.idempotency_key = v_idempotency_key;
    IF v_return_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_return_id, 'return_number', v_return_number, 'total_refund', v_total_refund);
    END IF;
  END IF;

  v_total_refund := 0; v_return_id := NULL; v_return_number := NULL;

  IF v_reason = '' OR v_reason IS NULL THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;

  SELECT created_at, is_voided INTO v_sale_created, v_sale_is_voided FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale_is_voided THEN RAISE EXCEPTION 'SALE_VOIDED: Cannot return items from a voided sale'; END IF;
  IF (now() - v_sale_created) > interval '30 days' THEN RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED'; END IF;

  SELECT payment_type INTO v_sale_payment_type FROM sales WHERE id = v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    SELECT si.sale_id, COALESCE(si.unit_size, 1) INTO v_sale_item_sale_id, v_sale_item_unit_size
    FROM sale_items si WHERE si.id = COALESCE(NULLIF(v_item->>'sale_item_id','')::uuid, NULLIF(v_item->>'saleItemId','')::uuid);
    IF v_sale_item_sale_id IS NULL THEN RAISE EXCEPTION 'SALE_ITEM_NOT_FOUND'; END IF;
    IF v_sale_item_sale_id IS DISTINCT FROM v_sale_id THEN RAISE EXCEPTION 'ITEM_NOT_OWNED'; END IF;
    SELECT qty INTO v_original_qty FROM sale_items WHERE id = COALESCE(NULLIF(v_item->>'sale_item_id','')::uuid, NULLIF(v_item->>'saleItemId','')::uuid);
    SELECT COALESCE(SUM(qi.qty), 0) INTO v_already_returned
    FROM return_items qi JOIN returns r ON r.id = qi.return_id
    WHERE qi.sale_item_id = COALESCE(NULLIF(v_item->>'sale_item_id','')::uuid, NULLIF(v_item->>'saleItemId','')::uuid) AND r.sale_id = v_sale_id;
    v_request_qty := (v_item->>'qty')::int;
    IF v_request_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    IF v_already_returned + v_request_qty > v_original_qty THEN RAISE EXCEPTION 'EXCESS_RETURN'; END IF;
  END LOOP;

  v_return_number := 'RET-' || upper(substr(md5(random()::text), 1, 6));
  INSERT INTO returns (return_number, sale_id, customer_id, customer_name, total_refund, resolution, reason, idempotency_key, processed_by, processed_by_name, shop_id, created_at, updated_at)
  VALUES (v_return_number, v_sale_id, v_customer_id, v_customer_name, (0)::numeric(14,4), v_resolution, v_reason, v_idempotency_key, v_processed_by, v_processed_by_name, COALESCE((SELECT shop_id FROM sales WHERE id = v_sale_id), '00000000-0000-0000-0000-000000000001'), now(), now())
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    SELECT COALESCE(si.unit_size, 1) INTO v_sale_item_unit_size FROM sale_items si WHERE si.id = COALESCE(NULLIF(v_item->>'sale_item_id','')::uuid, NULLIF(v_item->>'saleItemId','')::uuid);
    v_product_id := COALESCE(NULLIF(v_item->>'product_id','')::uuid, NULLIF(v_item->>'productId','')::uuid);

    v_unit_price := COALESCE(NULLIF((v_item->>'unit_price'), '')::numeric, NULLIF((v_item->>'unitPrice'), '')::numeric, 0);
    v_item_value := (v_item->>'qty')::int * v_unit_price;
    v_total_refund := v_total_refund + v_item_value;

    INSERT INTO return_items (return_id, sale_item_id, product_id, product_name, variant_id, variant_name, qty, unit_price, refund_amount, restock)
    VALUES (v_return_id, COALESCE(NULLIF(v_item->>'sale_item_id','')::uuid, NULLIF(v_item->>'saleItemId','')::uuid),
      v_product_id, COALESCE(v_item->>'product_name', v_item->>'productName'),
      COALESCE(NULLIF(v_item->>'variant_id','')::uuid, NULLIF(v_item->>'variantId','')::uuid),
      COALESCE(v_item->>'variant_name', v_item->>'variantName'),
      (v_item->>'qty')::int, v_unit_price, v_item_value, COALESCE((v_item->>'restock')::boolean, true));

    IF COALESCE((v_item->>'restock')::boolean, true) THEN
      SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
      v_before := COALESCE(v_before, 0);
      v_change := ROUND((v_item->>'qty')::numeric * v_sale_item_unit_size, 4);

      UPDATE products SET stock_qty = stock_qty + v_change WHERE id = v_product_id;
      v_after := v_before + v_change;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, created_by, created_at)
      VALUES (
        v_product_id,
        COALESCE(NULLIF(v_item->>'variant_id','')::uuid, NULLIF(v_item->>'variantId','')::uuid),
        'return', v_before, v_change, v_after,
        'return', v_return_id, v_processed_by, now()
      );
    END IF;

    IF v_sale_payment_type IS NOT NULL AND v_sale_payment_type != 'full' AND v_customer_id IS NOT NULL THEN
      SELECT total_amount, amount_paid INTO v_sale_total, v_sale_paid FROM sales WHERE id = v_sale_id;
      v_credit_ratio := 1;
      IF v_sale_total > 0 AND v_sale_paid > 0 THEN v_credit_ratio := GREATEST(0, (v_sale_total - v_sale_paid) / v_sale_total); END IF;
      v_credit_return_total := v_credit_return_total + ROUND(v_item_value * v_credit_ratio, 4);
    END IF;
  END LOOP;

  UPDATE returns SET total_refund = v_total_refund, updated_at = now() WHERE id = v_return_id;

  IF v_credit_return_total > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_credit_return_total), updated_at = now() WHERE id = v_customer_id;
  END IF;

  IF v_total_refund > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers SET total_purchases = GREATEST(0, total_purchases - v_total_refund), updated_at = now() WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_return_id, 'return_number', v_return_number, 'total_refund', v_total_refund);
END;
$$;

GRANT EXECUTE ON FUNCTION process_return(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
