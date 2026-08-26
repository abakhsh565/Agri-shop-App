-- FIX ALL RPC PARAMETER NAMES
-- Every function uses p_payload but client sends { payload: ... }
-- PostgREST can't match them. Drop and recreate with "payload" parameter.

-- ========== DROP ALL EXISTING ==========
DROP FUNCTION IF EXISTS create_sale(p_payload jsonb);
DROP FUNCTION IF EXISTS create_sale(payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(p_payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(p_payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(payload jsonb);
DROP FUNCTION IF EXISTS process_return(p_payload jsonb);
DROP FUNCTION IF EXISTS process_return(payload jsonb);
DROP FUNCTION IF EXISTS create_product(p_payload jsonb);
DROP FUNCTION IF EXISTS create_product(payload jsonb);
DROP FUNCTION IF EXISTS update_product(p_payload jsonb);
DROP FUNCTION IF EXISTS update_product(payload jsonb);
DROP FUNCTION IF EXISTS delete_product(p_payload jsonb);
DROP FUNCTION IF EXISTS delete_product(payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(p_payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(p_payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(payload jsonb);
DROP FUNCTION IF EXISTS archive_customer(p_uuid, p_uuid);
DROP FUNCTION IF EXISTS restore_customer(p_uuid);
DROP FUNCTION IF EXISTS void_sale(p_uuid, p_text, p_uuid);
DROP FUNCTION IF EXISTS void_sale_v1(p_payload jsonb);
DROP FUNCTION IF EXISTS deactivate_employee_v1(p_payload jsonb);
DROP FUNCTION IF EXISTS record_cash_reconciliation_v1(p_payload jsonb);

-- ========== RECREATE WITH payload PARAMETER ==========

-- 1. CREATE SALE
CREATE OR REPLACE FUNCTION create_sale(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id uuid; v_sale_number text; v_customer_id uuid;
  v_total numeric(14,4) := 0; v_amount_paid numeric(14,4);
  v_item jsonb; v_qty numeric(14,4); v_unit_size numeric(10,4);
  v_line_total numeric(14,4); v_item_id uuid;
  v_new_stock numeric(14,4); v_rows_updated integer;
BEGIN
  v_sale_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_customer_id := NULLIF(payload->>'customerId','')::uuid;
  v_amount_paid := COALESCE((payload->>'amountPaid')::numeric, 0);

  INSERT INTO sales (id, sale_number, customer_id, customer_name, customer_phone, customer_address,
    employee_id, employee_name, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note)
  VALUES (gen_random_uuid(), v_sale_number, v_customer_id,
    payload->>'customerName', payload->>'customerPhone', payload->>'customerAddress',
    NULLIF(payload->>'employeeId','')::uuid, payload->>'employeeName',
    0, v_amount_paid, 0, payload->>'paymentType', payload->>'paymentMethod', payload->>'note')
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_qty := (v_item->>'qty')::numeric;
    v_unit_size := COALESCE((v_item->>'unitSize')::numeric, 1);
    v_line_total := ROUND(v_qty * (v_item->>'unitPrice')::numeric, 2);
    v_total := v_total + v_line_total;

    UPDATE products SET stock_qty = ROUND(stock_qty - ROUND(v_qty * v_unit_size, 4), 4)
    WHERE id = NULLIF(v_item->>'productId','')::uuid
      AND stock_qty >= ROUND(v_qty * v_unit_size, 4);
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'Insufficient stock for %', v_item->>'productName';
    END IF;

    v_item_id := gen_random_uuid();
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, unit_size, base_unit, line_total)
    VALUES (v_item_id, v_sale_id, NULLIF(v_item->>'productId','')::uuid,
      v_item->>'productName', NULLIF(v_item->>'variantId','')::uuid, v_item->>'variantName',
      v_qty, (v_item->>'unitPrice')::numeric, v_unit_size,
      COALESCE(v_item->>'baseUnit','piece'), v_line_total);
  END LOOP;

  UPDATE sales SET total_amount = v_total, outstanding_balance = v_total - v_amount_paid WHERE id = v_sale_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET total_purchases = total_purchases + v_total,
      outstanding_balance = outstanding_balance + (v_total - v_amount_paid), updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number, 'total', v_total);
END;
$$;


-- 2. CREATE PURCHASE
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_purchase_id uuid; v_purchase_number text;
  v_total numeric(14,4) := 0; v_amount_paid numeric(14,4);
  v_item jsonb; v_rows_updated integer;
BEGIN
  v_purchase_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_amount_paid := COALESCE((payload->>'amountPaid')::numeric, 0);

  INSERT INTO purchases (id, purchase_number, company_id, total_amount, amount_paid, payable_balance,
    payment_method, note, created_by, created_at, updated_at)
  VALUES (gen_random_uuid(), v_purchase_number, (payload->>'companyId')::uuid,
    0, v_amount_paid, 0, payload->>'paymentMethod', payload->>'note',
    NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, now(), now())
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    INSERT INTO purchase_items (id, purchase_id, product_id, variant_id, product_name, variant_name,
      qty, cost_price, unit_size, line_total)
    VALUES (gen_random_uuid(), v_purchase_id, NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid, v_item->>'productName', v_item->>'variantName',
      (v_item->>'qty')::numeric, (v_item->>'costPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1), (v_item->>'lineTotal')::numeric);

    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1)
    WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;

  UPDATE purchases SET total_amount = v_total, payable_balance = v_total - v_amount_paid
  WHERE id = v_purchase_id;

  IF (payload->>'companyId') IS NOT NULL THEN
    UPDATE companies SET payable_balance = payable_balance + (v_total - v_amount_paid), updated_at = now()
    WHERE id = (payload->>'companyId')::uuid;
  END IF;

  RETURN jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_purchase_number, 'total', v_total);
END;
$$;


-- 3. ADJUST STOCK
CREATE OR REPLACE FUNCTION adjust_stock(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_adjustment_id uuid; v_variant_id uuid; v_product_id uuid;
  v_qty numeric(12,2); v_qty_before numeric(12,2); v_qty_after numeric(12,2);
BEGIN
  v_variant_id := (payload->>'variantId')::uuid;
  v_product_id := NULLIF(payload->>'productId','')::uuid;
  v_qty := (payload->>'qty')::numeric;

  SELECT stock_qty INTO v_qty_before FROM products WHERE id = v_product_id;
  IF v_qty_before IS NULL THEN v_qty_before := 0; END IF;

  IF (payload->>'adjustmentType') = 'add' THEN
    v_qty_after := v_qty_before + v_qty;
  ELSE
    v_qty_after := GREATEST(0, v_qty_before - v_qty);
  END IF;

  UPDATE products SET stock_qty = v_qty_after, updated_at = now() WHERE id = v_product_id;

  v_adjustment_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, variant_id, adjustment_type, qty_change,
    qty_before, qty_after, reason, created_by, created_at)
  VALUES (v_adjustment_id, v_product_id, v_variant_id, (payload->>'adjustmentType'),
    v_qty, v_qty_before, v_qty_after, payload->>'reason',
    NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, now());

  RETURN jsonb_build_object('id', v_adjustment_id, 'qtyBefore', v_qty_before,
    'qtyChange', v_qty, 'qtyAfter', v_qty_after);
END;
$$;


-- 4. PROCESS RETURN
CREATE OR REPLACE FUNCTION process_return(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_return_id uuid; v_return_number text;
  v_total numeric(14,4) := 0; v_item jsonb;
BEGIN
  v_return_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  INSERT INTO returns (id, return_number, sale_id, customer_id, reason, refund_amount,
    employee_id, employee_name, created_at)
  VALUES (gen_random_uuid(), v_return_number, (payload->>'saleId')::uuid,
    (payload->>'customerId')::uuid, payload->>'reason', 0,
    NULLIF(payload->>'employeeId','')::uuid, payload->>'employeeName', now())
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    INSERT INTO return_items (id, return_id, sale_item_id, product_id, variant_id,
      qty, unit_price, line_total)
    VALUES (gen_random_uuid(), v_return_id, NULLIF(v_item->>'saleItemId','')::uuid,
      NULLIF(v_item->>'productId','')::uuid, NULLIF(v_item->>'variantId','')::uuid,
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric, (v_item->>'lineTotal')::numeric);

    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric
    WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;

  UPDATE returns SET refund_amount = v_total WHERE id = v_return_id;

  RETURN jsonb_build_object('id', v_return_id, 'returnNumber', v_return_number, 'refundAmount', v_total);
END;
$$;


-- 5. CREATE PRODUCT
CREATE OR REPLACE FUNCTION create_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid; v_variant jsonb;
BEGIN
  v_product_id := gen_random_uuid();
  INSERT INTO products (id, name, company, category, base_unit, stock_qty,
    image_url, barcode, shop_id, created_at, updated_at)
  VALUES (v_product_id, payload->>'name', payload->>'company',
    COALESCE(payload->>'category','Other')::product_category,
    COALESCE(payload->>'baseUnit','piece'), COALESCE((payload->>'stockQty')::numeric,0),
    payload->>'image_url', payload->>'barcode',
    NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, now(), now());

  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb))
  LOOP
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price,
      unit_size, qty_step, low_stock_threshold, created_at, updated_at)
    VALUES (gen_random_uuid(), v_product_id, v_variant->>'name',
      (v_variant->>'sellingPrice')::numeric, (v_variant->>'costPrice')::numeric,
      (v_variant->>'unitSize')::numeric, (v_variant->>'qtyStep')::numeric,
      COALESCE((v_variant->>'lowStockThreshold')::numeric, 5), now(), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_product_id);
END;
$$;


-- 6. UPDATE PRODUCT
CREATE OR REPLACE FUNCTION update_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE products SET
    name = COALESCE(payload->>'name', name),
    company = COALESCE(payload->>'company', company),
    category = COALESCE((payload->>'category')::product_category, category),
    base_unit = COALESCE(payload->>'baseUnit', base_unit),
    stock_qty = COALESCE((payload->>'stockQty')::numeric, stock_qty),
    image_url = COALESCE(payload->>'image_url', image_url),
    barcode = COALESCE(payload->>'barcode', barcode),
    updated_at = now()
  WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('id', payload->>'id');
END;
$$;


-- 7. DELETE PRODUCT
CREATE OR REPLACE FUNCTION delete_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM product_variants WHERE product_id = (payload->>'id')::uuid;
  DELETE FROM products WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('success', true);
END;
$$;


-- 8. RECORD CUSTOMER PAYMENT
CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment_id uuid; v_balance_after numeric(12,2);
BEGIN
  v_payment_id := gen_random_uuid();
  INSERT INTO customer_payments (id, payment_number, customer_id, amount, payment_method,
    notes, created_by, created_at)
  VALUES (v_payment_id, 'PAY-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0'),
    (payload->>'customerId')::uuid, (payload->>'amount')::numeric,
    COALESCE(payload->>'method','cash'), payload->>'notes',
    NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, now());
  UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
    total_paid = total_paid + (payload->>'amount')::numeric, updated_at = now()
  WHERE id = (payload->>'customerId')::uuid RETURNING outstanding_balance INTO v_balance_after;
  RETURN jsonb_build_object('id', v_payment_id, 'balanceAfter', COALESCE(v_balance_after,0));
END;
$$;


-- 9. RECORD SUPPLIER PAYMENT
CREATE OR REPLACE FUNCTION record_supplier_payment(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_payment_id uuid; v_payable_after numeric(12,2);
BEGIN
  v_payment_id := gen_random_uuid();
  INSERT INTO supplier_payments (id, payment_number, company_id, amount, payment_method,
    notes, created_by, created_at)
  VALUES (v_payment_id, 'SUP-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0'),
    (payload->>'companyId')::uuid, (payload->>'amount')::numeric,
    COALESCE(payload->>'method','cash'), payload->>'notes',
    NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, now());
  UPDATE companies SET payable_balance = GREATEST(0, payable_balance - (payload->>'amount')::numeric),
    updated_at = now()
  WHERE id = (payload->>'companyId')::uuid RETURNING payable_balance INTO v_payable_after;
  RETURN jsonb_build_object('id', v_payment_id, 'payableAfter', COALESCE(v_payable_after,0));
END;
$$;


-- 10. ARCHIVE CUSTOMER
CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers SET is_archived = true, archived_at = now(),
    archived_by = COALESCE(p_archived_by, NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid)
  WHERE id = p_customer_id;
END;
$$;

-- 11. RESTORE CUSTOMER
CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers SET is_archived = false, archived_at = NULL, archived_by = NULL WHERE id = p_customer_id;
END;
$$;

-- 12. VOID SALE
CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason,
    COALESCE(p_voided_by, NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid), now());
  UPDATE sales SET is_voided = true, voided_at = now() WHERE id = p_sale_id;
END;
$$;
