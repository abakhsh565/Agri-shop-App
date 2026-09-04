-- ============================================================
-- Migration 0035: Fix process_return — correct stock + outstanding
--
-- Changes from 0033:
-- 1. Restocks products.stock_qty (the source of truth) instead of
--    product_variants.stock_qty
-- 2. Uses qty * unit_size to match the sale deduction formula
-- 3. Reduces outstanding for ALL credit-sale returns (not just
--    credit_note), because returning goods reduces the customer's debt
-- 4. Never lets outstanding go negative
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
BEGIN
  v_customer_name := COALESCE(payload->>'customer_name', payload->>'customerName', 'Customer');
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := trim(COALESCE(payload->>'reason', ''));
  v_idempotency_key := COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey');
  v_items := COALESCE(payload->'items', '[]'::jsonb);

  BEGIN v_customer_id := (payload->>'customer_id')::uuid; EXCEPTION WHEN OTHERS THEN v_customer_id := NULL; END;

  -- Resolve processed_by
  v_processed_by := auth.uid();
  IF v_processed_by IS NULL THEN
    BEGIN v_processed_by := (payload->>'processedBy')::uuid; EXCEPTION WHEN OTHERS THEN v_processed_by := NULL; END;
  END IF;
  v_processed_by_name := COALESCE(payload->>'processedByName', '');
  IF v_processed_by_name = '' AND v_processed_by IS NOT NULL THEN
    SELECT name INTO v_processed_by_name FROM users WHERE id = v_processed_by;
  END IF;
  v_processed_by_name := COALESCE(v_processed_by_name, 'Staff');

  -- IDEMPOTENCY
  IF v_idempotency_key IS NOT NULL AND v_idempotency_key != '' THEN
    SELECT r.id, r.return_number, r.total_refund INTO v_return_id, v_return_number, v_total_refund
    FROM returns r WHERE r.idempotency_key = v_idempotency_key;
    IF v_return_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', v_return_id, 'return_number', v_return_number, 'total_refund', v_total_refund);
    END IF;
  END IF;

  IF v_reason = '' OR v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT created_at INTO v_sale_created FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF (now() - v_sale_created) > interval '30 days' THEN RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED'; END IF;

  -- Get the sale's payment type to determine if credit-sale return
  SELECT payment_type INTO v_sale_payment_type FROM sales WHERE id = v_sale_id;

  -- VALIDATE each return item
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    SELECT si.sale_id, COALESCE(si.unit_size, 1) INTO v_sale_item_sale_id, v_sale_item_unit_size
    FROM sale_items si
    WHERE si.id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);
    IF v_sale_item_sale_id IS NULL THEN RAISE EXCEPTION 'SALE_ITEM_NOT_FOUND'; END IF;
    IF v_sale_item_sale_id IS DISTINCT FROM v_sale_id THEN RAISE EXCEPTION 'ITEM_NOT_OWNED'; END IF;

    SELECT qty INTO v_original_qty FROM sale_items
    WHERE id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);

    SELECT COALESCE(SUM(qi.qty), 0) INTO v_already_returned
    FROM return_items qi JOIN returns r ON r.id = qi.return_id
    WHERE qi.sale_item_id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid)
      AND r.sale_id = v_sale_id;

    v_request_qty := (v_item->>'qty')::int;
    IF v_request_qty <= 0 THEN RAISE EXCEPTION 'INVALID_QTY'; END IF;
    IF v_already_returned + v_request_qty > v_original_qty THEN RAISE EXCEPTION 'EXCESS_RETURN'; END IF;
  END LOOP;

  -- Create return record
  v_return_number := 'RET-' || upper(substr(md5(random()::text), 1, 6));
  INSERT INTO returns (
    return_number, sale_id, customer_id, customer_name,
    total_refund, resolution, reason, idempotency_key,
    processed_by, processed_by_name,
    shop_id, created_at, updated_at
  ) VALUES (
    v_return_number, v_sale_id, v_customer_id, v_customer_name,
    (0)::numeric(14,4), v_resolution, v_reason, v_idempotency_key,
    v_processed_by, v_processed_by_name,
    COALESCE((SELECT shop_id FROM sales WHERE id = v_sale_id), '00000000-0000-0000-0000-000000000001'),
    now(), now()
  ) RETURNING id INTO v_return_id;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    -- Get the unit_size from the original sale_item for correct stock calculation
    SELECT COALESCE(si.unit_size, 1) INTO v_sale_item_unit_size
    FROM sale_items si
    WHERE si.id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);

    v_total_refund := v_total_refund
      + (v_item->>'qty')::int * COALESCE(
          (v_item->>'unit_price')::numeric,
          (v_item->>'unitPrice')::numeric,
          0
        );

    INSERT INTO return_items (
      return_id, sale_item_id, product_id, product_name,
      variant_id, variant_name, qty, unit_price, restock
    ) VALUES (
      v_return_id,
      COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid),
      COALESCE((v_item->>'product_id')::uuid, (v_item->>'productId')::uuid),
      COALESCE(v_item->>'product_name', v_item->>'productName'),
      COALESCE((v_item->>'variant_id')::uuid, (v_item->>'variantId')::uuid),
      COALESCE(v_item->>'variant_name', v_item->>'variantName'),
      (v_item->>'qty')::int,
      COALESCE((v_item->>'unit_price')::numeric, (v_item->>'unitPrice')::numeric, 0),
      COALESCE((v_item->>'restock')::boolean, true)
    );

    -- FIX #1: Restock products.stock_qty (the source of truth) using qty * unit_size
    -- This matches the sale deduction formula: qty * unit_size
    IF COALESCE((v_item->>'restock')::boolean, true) THEN
      UPDATE products SET stock_qty = stock_qty + ROUND((v_item->>'qty')::numeric * v_sale_item_unit_size, 4)
      WHERE id = COALESCE((v_item->>'product_id')::uuid, (v_item->>'productId')::uuid);
    END IF;

    -- Track credit-sale return total for outstanding adjustment
    IF v_sale_payment_type IS NOT NULL AND v_sale_payment_type != 'full' AND v_customer_id IS NOT NULL THEN
      v_credit_return_total := v_credit_return_total
        + (v_item->>'qty')::int * COALESCE(
            (v_item->>'unit_price')::numeric,
            (v_item->>'unitPrice')::numeric,
            0
          );
    END IF;
  END LOOP;

  UPDATE returns SET total_refund = v_total_refund, updated_at = now() WHERE id = v_return_id;

  -- FIX #2: Reduce outstanding for ALL credit-sale returns
  -- The customer returned goods they bought on credit, so their debt decreases.
  -- This applies regardless of resolution (refund_cash or credit_note).
  -- Outstanding must never go negative.
  IF v_credit_return_total > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_credit_return_total)
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_return_id, 'return_number', v_return_number, 'total_refund', v_total_refund);
END;
$$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';

GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;
