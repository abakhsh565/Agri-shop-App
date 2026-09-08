-- ============================================================
-- Migration 0048: Phase 1 — Financial Integrity
--
-- FIXES:
-- 1. GRANT create_sale, create_purchase, process_return to anon
--    (app uses anon key but these were only granted to authenticated)
-- 2. void_sale: decrement customer.total_purchases
-- 3. process_return: decrement customer.total_purchases
-- 4. create_purchase: increment companies.total_purchases
-- 5. record_customer_payment: add authorization + GRANT to anon
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- F1: create_sale — add anon GRANT
-- Current: migration 0041, GRANT to authenticated only
-- ────────────────────────────────────────────────────────────
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
  IF v_payment_type = 'partial' AND v_customer_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
      v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);
    END LOOP;
    v_credit := GREATEST(0, v_total - v_paid);

    IF v_credit > 0 THEN
      SELECT outstanding_balance, credit_limit
        INTO v_outstanding_before, v_credit_limit
      FROM customers WHERE id = v_customer_id;

      IF v_credit_limit IS NULL OR v_credit_limit <= 0 THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_REQUIRED: Credit sale requires a credit limit to be set for this customer.';
      END IF;

      IF (COALESCE(v_outstanding_before, 0) + v_credit) > v_credit_limit THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Credit of Rs. % would bring outstanding to Rs. %, exceeding the Rs. % credit limit.',
          v_credit, COALESCE(v_outstanding_before, 0) + v_credit, v_credit_limit;
      END IF;

      IF v_due_date IS NULL OR v_due_date = '' THEN
        RAISE EXCEPTION 'DUE_DATE_REQUIRED: Credit sales require a due date.';
      END IF;

      IF v_due_date::date < CURRENT_DATE THEN
        RAISE EXCEPTION 'DUE_DATE_PAST: Due date cannot be in the past.';
      END IF;
    END IF;

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

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- F2: create_purchase — add anon GRANT + companies.total_purchases
-- Current: migration 0047, no anon GRANT, no total_purchases update
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);

CREATE OR REPLACE FUNCTION create_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_line_total numeric(14,4);
BEGIN
  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;

  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount, amount_paid,
    outstanding_payable, payment_method, note, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number,
    NULLIF(payload->>'companyId','')::uuid,
    COALESCE(v_company_name, 'Unknown'),
    0, v_paid, 0,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note',
    '00000000-0000-0000-0000-000000000001',
    now(), now())
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_line_total := ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2);
    v_total := v_total + v_line_total;

    INSERT INTO purchase_items (id, purchase_id, product_id, variant_id, product_name, variant_name,
      qty, cost_price, unit_size, line_total)
    VALUES (gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid,
      v_item->>'productName',
      COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric,
      (v_item->>'costPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1),
      v_line_total);

    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1)
    WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;

  UPDATE purchases SET total_amount = v_total, outstanding_payable = v_total - v_paid WHERE id = v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET
      outstanding_payable = outstanding_payable + (v_total - v_paid),
      total_purchases = total_purchases + v_total,
      updated_at = now()
    WHERE id = (payload->>'companyId')::uuid;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'purchaseNumber', v_number, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- F3: process_return — add anon GRANT + decrement total_purchases
-- Current: migration 0035, no anon GRANT, no total_purchases update
-- ────────────────────────────────────────────────────────────
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
  v_sale_total numeric;
  v_sale_paid numeric;
  v_credit_ratio numeric := 1;
BEGIN
  v_customer_name := COALESCE(payload->>'customer_name', payload->>'customerName', 'Customer');
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := trim(COALESCE(payload->>'reason', ''));
  v_idempotency_key := COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey');
  v_items := COALESCE(payload->'items', '[]'::jsonb);

  BEGIN v_customer_id := COALESCE(NULLIF((payload->>'customer_id'),'')::uuid, NULLIF((payload->>'customerId'),'')::uuid); EXCEPTION WHEN OTHERS THEN v_customer_id := NULL; END;

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

  v_total_refund := 0;
  v_return_id := NULL;
  v_return_number := NULL;

  IF v_reason = '' OR v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT created_at INTO v_sale_created FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF (now() - v_sale_created) > interval '30 days' THEN RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED'; END IF;

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
    SELECT COALESCE(si.unit_size, 1) INTO v_sale_item_unit_size
    FROM sale_items si
    WHERE si.id = COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid);

    v_item_value := COALESCE(
          (v_item->>'unit_price')::numeric,
          (v_item->>'unitPrice')::numeric,
          0
        );
    v_total_refund := v_total_refund + (v_item->>'qty')::int * v_item_value;

    INSERT INTO return_items (
      return_id, sale_item_id, product_id, product_name,
      variant_id, variant_name, qty, unit_price, refund_amount, restock
    ) VALUES (
      v_return_id,
      COALESCE((v_item->>'sale_item_id')::uuid, (v_item->>'saleItemId')::uuid),
      COALESCE((v_item->>'product_id')::uuid, (v_item->>'productId')::uuid),
      COALESCE(v_item->>'product_name', v_item->>'productName'),
      COALESCE((v_item->>'variant_id')::uuid, (v_item->>'variantId')::uuid),
      COALESCE(v_item->>'variant_name', v_item->>'variantName'),
      (v_item->>'qty')::int,
      v_item_value,
      (v_item->>'qty')::int * v_item_value,
      COALESCE((v_item->>'restock')::boolean, true)
    );

    -- Restock products.stock_qty using qty * unit_size
    IF COALESCE((v_item->>'restock')::boolean, true) THEN
      UPDATE products SET stock_qty = stock_qty + ROUND((v_item->>'qty')::numeric * v_sale_item_unit_size, 4)
      WHERE id = COALESCE((v_item->>'product_id')::uuid, (v_item->>'productId')::uuid);
    END IF;

    -- Track credit portion of return for outstanding adjustment
    IF v_sale_payment_type IS NOT NULL AND v_sale_payment_type != 'full' AND v_customer_id IS NOT NULL THEN
      v_item_value := (v_item->>'qty')::int * COALESCE((v_item->>'unit_price')::numeric, (v_item->>'unitPrice')::numeric, 0);
      SELECT total_amount, amount_paid INTO v_sale_total, v_sale_paid FROM sales WHERE id = v_sale_id;
      v_credit_ratio := 1;
      IF v_sale_total > 0 AND v_sale_paid > 0 THEN
        v_credit_ratio := GREATEST(0, (v_sale_total - v_sale_paid) / v_sale_total);
      END IF;
      v_credit_return_total := v_credit_return_total + ROUND(v_item_value * v_credit_ratio, 4);
    END IF;
  END LOOP;

  UPDATE returns SET total_refund = v_total_refund, updated_at = now() WHERE id = v_return_id;

  -- Reduce outstanding for credit-sale returns
  IF v_credit_return_total > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_credit_return_total)
    WHERE id = v_customer_id;
  END IF;

  -- NEW: Decrement total_purchases by refund amount
  -- Rule: total_purchases = completed sales − returned value
  IF v_total_refund > 0 AND v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_purchases = GREATEST(0, total_purchases - v_total_refund),
        updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_return_id, 'return_number', v_return_number, 'total_refund', v_total_refund);
END;
$$;

GRANT EXECUTE ON FUNCTION process_return(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- F4: void_sale — decrement customer.total_purchases
-- Current: migration 0044, only adjusts outstanding_balance
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS void_sale(uuid, text, uuid);

CREATE OR REPLACE FUNCTION void_sale(
  p_sale_id uuid,
  p_reason text,
  p_voided_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    p_voided_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may void sales
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  -- Restore stock for all sale items
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_restored_stock := v_restored_stock + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4);
    UPDATE products SET stock_qty = ROUND(stock_qty + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4), 4)
    WHERE id = v_item.product_id;
  END LOOP;

  -- Reverse customer outstanding (unpaid portion)
  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  -- NEW: Decrement total_purchases by the voided sale's total
  -- Rule: total_purchases = completed sales − voided sales value
  IF v_sale.customer_id IS NOT NULL AND v_sale.total_amount > 0 THEN
    UPDATE customers SET
      total_purchases = GREATEST(0, total_purchases - v_sale.total_amount),
      updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason, v_actor, now())
  RETURNING id INTO v_void_id;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, void_reason = p_reason
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$$;

GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- F5: record_customer_payment — add authorization + GRANT to anon
-- Current: migration 0028, no auth check, no GRANT
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS record_customer_payment(jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(p_payload jsonb);

CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_balance numeric(12,2);
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may record customer payments
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can record customer payments';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO customer_payments (id, customer_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'customerId')::uuid, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash'), payload->>'notes', now());
  UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
    total_paid = total_paid + (payload->>'amount')::numeric, updated_at = now()
  WHERE id = (payload->>'customerId')::uuid RETURNING outstanding_balance INTO v_balance;
  RETURN jsonb_build_object('id', v_id, 'balanceAfter', COALESCE(v_balance,0));
END;
$$;

GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
