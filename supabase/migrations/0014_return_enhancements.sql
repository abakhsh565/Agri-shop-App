-- ============================================================
-- Migration 0014: Return Enhancements
-- Run in Supabase SQL Editor before deploying frontend changes.
-- ============================================================

-- 1. Add reason column to returns table
ALTER TABLE returns ADD COLUMN IF NOT EXISTS reason text;

-- 2. Add idempotency_key column + UNIQUE constraint for offline dedup
ALTER TABLE returns ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_idempotency_key
  ON returns(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 3. Replace process_return with enhanced version
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
  v_total_refund numeric := 0;
  v_sale_created timestamptz;
  v_sale_employee_id uuid;
  v_original_qty int;
  v_already_returned int;
  v_request_qty int;
  v_sale_item_sale_id uuid;
BEGIN
  -- Input extraction
  v_customer_name := COALESCE(payload->>'customer_name', payload->>'customerName', 'Customer');
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := trim(COALESCE(payload->>'reason', ''));
  v_idempotency_key := COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey');
  v_items := COALESCE(payload->'items', '[]'::jsonb);

  BEGIN
    v_customer_id := (payload->>'customer_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_customer_id := NULL;
  END;

  -- IDEMPOTENCY: if key exists, return existing record
  IF v_idempotency_key IS NOT NULL AND v_idempotency_key != '' THEN
    SELECT r.id, r.return_number, r.total_refund
    INTO v_return_id, v_return_number, v_total_refund
    FROM returns r
    WHERE r.idempotency_key = v_idempotency_key;
    IF v_return_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_return_id,
        'return_number', v_return_number,
        'total_refund', v_total_refund
      );
    END IF;
  END IF;

  -- MANDATORY reason
  IF v_reason = '' OR v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: A return reason is mandatory.';
  END IF;

  -- Fetch sale info
  SELECT created_at, employee_id INTO v_sale_created, v_sale_employee_id
  FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND';
  END IF;

  -- 30-day return window
  IF (now() - v_sale_created) > interval '30 days' THEN
    RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED';
  END IF;

  -- Authorization: employee only own sales
  IF NOT app_is_admin() THEN
    IF v_sale_employee_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;
  END IF;

  -- VALIDATE each return item
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    -- 1. Verify sale_item exists AND belongs to this sale
    SELECT si.sale_id INTO v_sale_item_sale_id
    FROM sale_items si
    WHERE si.id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);

    IF v_sale_item_sale_id IS NULL THEN
      RAISE EXCEPTION 'SALE_ITEM_NOT_FOUND: Item does not exist.';
    END IF;
    IF v_sale_item_sale_id IS DISTINCT FROM v_sale_id THEN
      RAISE EXCEPTION 'ITEM_NOT_OWNED: Return item does not belong to this sale.';
    END IF;

    -- 2. Get original qty
    SELECT qty INTO v_original_qty
    FROM sale_items
    WHERE id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);

    -- 3. Sum previously returned qty (atomic within TX)
    SELECT COALESCE(SUM(qi.qty), 0) INTO v_already_returned
    FROM return_items qi
    JOIN returns r ON r.id = qi.return_id
    WHERE qi.sale_item_id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid)
      AND r.sale_id = v_sale_id;

    v_request_qty := (v_item->>'qty')::int;

    IF v_request_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: Return quantity must be at least 1.';
    END IF;

    -- 4. Atomic remaining-qty check
    IF v_already_returned + v_request_qty > v_original_qty THEN
      RAISE EXCEPTION 'EXCESS_RETURN: Cannot return % units. Only % of % remaining.',
        v_request_qty, (v_original_qty - v_already_returned), v_original_qty;
    END IF;
  END LOOP;

  -- Create return record
  v_return_number := 'RET-' || upper(substr(md5(random()::text), 1, 6));
  INSERT INTO returns (
    return_number, sale_id, customer_id, customer_name,
    total_refund, resolution, reason, idempotency_key,
    processed_by, processed_by_name
  ) VALUES (
    v_return_number, v_sale_id, v_customer_id, v_customer_name,
    0, v_resolution, v_reason, v_idempotency_key,
    auth.uid(),
    (SELECT name FROM users WHERE id = auth.uid())
  )
  RETURNING id INTO v_return_id;

  -- Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_total_refund := v_total_refund
      + (v_item->>'qty')::int * (v_item->>'unit_price')::numeric;

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
      (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'restock')::boolean, true)
    );

    -- Restock
    IF COALESCE((v_item->>'restock')::boolean, true) THEN
      UPDATE product_variants
      SET stock_qty = stock_qty + (v_item->>'qty')::int
      WHERE id = (v_item->>'variant_id')::uuid;
    END IF;
  END LOOP;

  -- Update return total
  UPDATE returns SET total_refund = v_total_refund WHERE id = v_return_id;

  -- Customer balance adjustment
  IF v_resolution = 'credit_note' AND v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = outstanding_balance + v_total_refund
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_return_id,
    'return_number', v_return_number,
    'total_refund', v_total_refund
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;
