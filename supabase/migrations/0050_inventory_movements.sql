-- ============================================================
-- Migration 0050: Inventory Movements — Source of Truth
--
-- Problem: inventory_movements table is EMPTY. No stock-changing
-- operation creates movement records.
--
-- Also: inventory_movements has variant_id NOT NULL, but the
-- real inventory model is product-level stock. Operations like
-- adjust_stock don't have a meaningful variant.
--
-- Fix:
-- 1. Add product_id column to inventory_movements
-- 2. Make variant_id nullable
-- 3. Add INSERT INTO inventory_movements to every stock-changing RPC
-- ============================================================

-- ── 1. Schema changes ──────────────────────────────────────
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id);
ALTER TABLE inventory_movements ALTER COLUMN variant_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product_id ON inventory_movements(product_id);

-- ── 2. recreate create_sale with inventory movements ──────
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
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_actor uuid;
BEGIN
  IF payload->'items' IS NULL OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'SALE_REQUIRES_ITEMS: At least one item is required to create a sale';
  END IF;

  v_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_payment_type := COALESCE((payload->>'paymentType'), 'full');
  v_customer_id := NULLIF(payload->>'customerId','')::uuid;
  v_due_date := payload->>'dueDate';
  v_actor := COALESCE(
    NULLIF(payload->>'employeeId','')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  IF v_payment_type = 'partial' AND v_customer_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
      v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);
    END LOOP;
    v_credit := GREATEST(0, v_total - v_paid);
    IF v_credit > 0 THEN
      SELECT outstanding_balance, credit_limit INTO v_outstanding_before, v_credit_limit
      FROM customers WHERE id = v_customer_id;
      IF v_credit_limit IS NULL OR v_credit_limit <= 0 THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_REQUIRED: Credit sale requires a credit limit to be set for this customer.';
      END IF;
      IF (COALESCE(v_outstanding_before, 0) + v_credit) > v_credit_limit THEN
        RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED';
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

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);
    v_change := ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4);

    SELECT stock_qty INTO v_before FROM products WHERE id = NULLIF(v_item->>'productId','')::uuid;
    v_before := COALESCE(v_before, 0);

    UPDATE products SET stock_qty = ROUND(stock_qty - v_change, 4)
    WHERE id = NULLIF(v_item->>'productId','')::uuid
      AND stock_qty >= v_change;
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN RAISE EXCEPTION 'Insufficient stock for %', v_item->>'productName'; END IF;

    v_after := v_before - v_change;

    INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
      reference_type, reference_id, created_by, created_at)
    VALUES (
      NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid,
      'sale', v_before, -v_change, v_after,
      'sale', v_id, v_actor, now()
    );

    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, unit_size, base_unit, line_total)
    VALUES (gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId','')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId','')::uuid, COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1), COALESCE(v_item->>'baseUnit','piece'),
      ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2));
  END LOOP;

  UPDATE sales SET total_amount = v_total,
    outstanding_balance = GREATEST(0, v_total - v_paid)
  WHERE id = v_id;

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

-- ── 3. recreate create_purchase with inventory movements ──
DROP FUNCTION IF EXISTS create_purchase(jsonb);

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
  v_change numeric(14,4);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_actor uuid;
BEGIN
  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_actor := '00000000-0000-0000-0000-000000000002'::uuid;
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
    v_change := ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4);

    SELECT stock_qty INTO v_before FROM products WHERE id = NULLIF(v_item->>'productId','')::uuid;
    v_before := COALESCE(v_before, 0);

    UPDATE products SET stock_qty = ROUND(stock_qty + v_change, 4)
    WHERE id = NULLIF(v_item->>'productId','')::uuid;

    v_after := v_before + v_change;

    INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
      reference_type, reference_id, unit_cost, created_by, created_at)
    VALUES (
      NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid,
      'purchase', v_before, v_change, v_after,
      'purchase', v_id,
      (v_item->>'costPrice')::numeric,
      v_actor, now()
    );

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

-- ── 4. recreate process_return with inventory movements ───
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

  SELECT created_at INTO v_sale_created FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
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

-- ── 5. recreate void_sale with inventory movements ────────
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
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
BEGIN
  v_actor := COALESCE(
    p_voided_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_change := ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4);
    v_restored_stock := v_restored_stock + v_change;

    SELECT stock_qty INTO v_before FROM products WHERE id = v_item.product_id;
    v_before := COALESCE(v_before, 0);

    UPDATE products SET stock_qty = ROUND(stock_qty + v_change, 4) WHERE id = v_item.product_id;
    v_after := v_before + v_change;

    INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
      reference_type, reference_id, created_by, created_at)
    VALUES (
      v_item.product_id, v_item.variant_id,
      'void', v_before, v_change, v_after,
      'void', p_sale_id, v_actor, now()
    );
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

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, void_reason = p_reason WHERE id = p_sale_id;

  RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$$;

GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;

-- ── 6. recreate adjust_stock with inventory movements ─────
DROP FUNCTION IF EXISTS adjust_stock(jsonb);

CREATE OR REPLACE FUNCTION adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_caller_role text;
BEGIN
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can adjust stock';
  END IF;

  v_product_id := (payload->>'productId')::uuid;
  v_qty := (payload->>'qty')::numeric;
  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

  IF (payload->>'adjustmentType') = 'add' THEN
    v_after := v_before + v_qty;
  ELSE
    v_after := GREATEST(0, v_before - v_qty);
  END IF;

  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, created_at)
  VALUES (v_id, v_product_id, payload->>'productName',
    NULLIF((payload->>'variantId'),'')::uuid, COALESCE(payload->>'variantName',''),
    (payload->>'adjustmentType')::adjustment_kind, v_before, v_qty, v_after,
    payload->>'reason', now());

  -- Create inventory movement
  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    NULLIF((payload->>'variantId'),'')::uuid,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  RETURN jsonb_build_object('id', v_id, 'qtyBefore', v_before, 'qtyChange', v_qty, 'qtyAfter', v_after);
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
