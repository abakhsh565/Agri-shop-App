-- Migration 0041: Credit Lifecycle Enforcement
-- Adds to create_sale RPC:
--   1. Credit limit validation (rejects if no limit set or would exceed)
--   2. Due date requirement for credit sales (rejects if missing)
--   3. Atomic due date persistence within the sale transaction

DROP FUNCTION IF EXISTS create_sale(jsonb);

CREATE OR REPLACE FUNCTION create_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_credit numeric(14,4);
  v_item jsonb;
  v_rows_updated integer;
  v_customer_id uuid;
  v_payment_type text;
  v_outstanding_before numeric(14,4);
  v_credit_limit numeric(14,4);
  v_due_date text;
BEGIN
  -- Validate: items array required with at least one entry
  IF payload->'items' IS NULL OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'SALE_REQUIRES_ITEMS: At least one item is required to create a sale';
  END IF;

  v_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_payment_type := COALESCE((payload->>'paymentType'), 'full');
  v_customer_id := NULLIF(payload->>'customerId','')::uuid;
  v_due_date := payload->>'dueDate';

  -- ── Credit lifecycle enforcement ──────────────────────────────────────
  -- Only applies when: payment type is partial AND there IS a customer
  -- AND the credit portion (total - paid) is > 0
  IF v_payment_type = 'partial' AND v_customer_id IS NOT NULL THEN
    -- Compute the credit portion from items (we don't know total yet, so
    -- we need to calculate it first.  Use a preliminary total.)
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
      v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);
    END LOOP;
    v_credit := GREATEST(0, v_total - v_paid);

    IF v_credit > 0 THEN
      -- Fetch customer's current outstanding and credit limit
      SELECT outstanding_balance, credit_limit
        INTO v_outstanding_before, v_credit_limit
      FROM customers WHERE id = v_customer_id;

      -- Rule 1: Credit limit must be configured (> 0)
      IF v_credit_limit IS NULL OR v_credit_limit <= 0 THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_REQUIRED: Credit sale requires a credit limit to be set for this customer. Please set a credit limit before processing a credit sale.';
      END IF;

      -- Rule 2: New outstanding must not exceed credit limit
      -- available = credit_limit - current_outstanding
      -- credit portion must be <= available
      IF (COALESCE(v_outstanding_before, 0) + v_credit) > v_credit_limit THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Credit of Rs. % would bring outstanding to Rs. %, exceeding the Rs. % credit limit.',
          v_credit, COALESCE(v_outstanding_before, 0) + v_credit, v_credit_limit;
      END IF;

      -- Rule 3: Due date is mandatory for credit sales
      IF v_due_date IS NULL OR v_due_date = '' THEN
        RAISE EXCEPTION 'DUE_DATE_REQUIRED: Credit sales require a due date. Please select a due date before processing.';
      END IF;

      -- Rule 4: Due date must not be in the past
      IF v_due_date::date < CURRENT_DATE THEN
        RAISE EXCEPTION 'DUE_DATE_PAST: Due date cannot be in the past.';
      END IF;
    END IF;

    -- Reset v_total for the main loop (it was pre-computed above for validation)
    v_total := 0;
  END IF;

  -- ── Insert sale row ──────────────────────────────────────────────────
  INSERT INTO sales (id, sale_number, customer_id, customer_name, historical_customer_name,
    historical_customer_phone, historical_customer_address, employee_id, employee_name,
    total_amount, amount_paid, outstanding_balance, payment_type, payment_method, note,
    status, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number,
    v_customer_id,
    COALESCE(payload->>'customerName','Walk-in'),
    COALESCE(payload->>'customerName','Walk-in'),
    payload->>'customerPhone', payload->>'customerAddress',
    NULLIF(payload->>'employeeId','')::uuid,
    COALESCE(payload->>'employeeName','Admin'),
    0, v_paid, 0,
    v_payment_type::payment_type,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note', 'completed',
    '00000000-0000-0000-0000-000000000001', now(), now())
  RETURNING id INTO v_id;

  -- ── Insert sale items + deduct stock ─────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);

    UPDATE products SET stock_qty = ROUND(stock_qty - ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4), 4)
    WHERE id = NULLIF(v_item->>'productId','')::uuid
      AND stock_qty >= ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4);

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN RAISE EXCEPTION 'Insufficient stock for %', v_item->>'productName'; END IF;

    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, unit_size, base_unit, line_total)
    VALUES (gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId','')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId','')::uuid, COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1), COALESCE(v_item->>'baseUnit','piece'),
      ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2));
  END LOOP;

  -- ── Finalize sale totals ────────────────────────────────────────────
  UPDATE sales SET total_amount = v_total,
    outstanding_balance = GREATEST(0, v_total - v_paid)
  WHERE id = v_id;

  -- ── Update customer financials + due date (atomic) ──────────────────
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_purchases = total_purchases + v_total,
      outstanding_balance = GREATEST(0, outstanding_balance + (v_total - v_paid)),
      -- Persist due date atomically when provided for credit sales
      due_date = CASE
        WHEN v_payment_type = 'partial' AND v_due_date IS NOT NULL AND v_due_date != ''
          THEN v_due_date::date
        ELSE due_date
      END,
      updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'saleNumber', v_number, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
