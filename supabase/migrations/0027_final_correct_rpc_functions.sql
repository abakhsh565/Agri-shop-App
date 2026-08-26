-- FINAL FIX: All RPC functions with ACTUAL column names from the database
-- Discovered by probing every table via Supabase REST API

-- ========== DROP ALL OLD VERSIONS ==========
DROP FUNCTION IF EXISTS create_product(p_payload jsonb);
DROP FUNCTION IF EXISTS create_product(payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(p_payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(p_payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(payload jsonb);
DROP FUNCTION IF EXISTS create_sale(p_payload jsonb);
DROP FUNCTION IF EXISTS create_sale(payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(p_payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(p_payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(payload jsonb);
DROP FUNCTION IF EXISTS process_return(p_payload jsonb);
DROP FUNCTION IF EXISTS process_return(payload jsonb);
DROP FUNCTION IF EXISTS update_product(p_payload jsonb);
DROP FUNCTION IF EXISTS update_product(payload jsonb);
DROP FUNCTION IF EXISTS delete_product(p_payload jsonb);
DROP FUNCTION IF EXISTS delete_product(payload jsonb);
DROP FUNCTION IF EXISTS void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid);
DROP FUNCTION IF EXISTS archive_customer(p_uuid, p_uuid);
DROP FUNCTION IF EXISTS restore_customer(p_uuid);

-- ========== 1. CREATE PRODUCT ==========
-- products: id,name,company,category,image_url,barcode,base_unit,stock_qty,is_active,shop_id,created_by,created_at,updated_at
-- product_variants: id,product_id,name,sku,selling_price,cost_price,stock_qty,unit_size,qty_step,low_stock_threshold,expiry_date,is_active,batch_id,updated_at (NO created_at)
CREATE OR REPLACE FUNCTION create_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product_id uuid; v_variant jsonb; v_shop_id uuid;
BEGIN
  v_shop_id := COALESCE(NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid, '00000000-0000-0000-0000-000000000001');
  v_product_id := gen_random_uuid();
  INSERT INTO products (id, name, company, category, base_unit, stock_qty, image_url, barcode, shop_id, created_at, updated_at)
  VALUES (v_product_id, payload->>'name', payload->>'company',
    COALESCE(payload->>'category','spray')::product_category,
    COALESCE(payload->>'baseUnit','piece'), COALESCE((payload->>'stockQty')::numeric,0),
    payload->>'image_url', payload->>'barcode', v_shop_id, now(), now());
  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb))
  LOOP
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, updated_at)
    VALUES (gen_random_uuid(), v_product_id, v_variant->>'name',
      (v_variant->>'sellingPrice')::numeric, (v_variant->>'costPrice')::numeric,
      (v_variant->>'unitSize')::numeric, (v_variant->>'qtyStep')::numeric,
      COALESCE((v_variant->>'lowStockThreshold')::numeric, 5), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_product_id);
END;
$$;

-- ========== 2. RECORD CUSTOMER PAYMENT ==========
-- customer_payments: id,customer_id,amount,method,notes,recorded_by,recorded_by_name,balance_after,created_at (NO payment_number)
CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_balance numeric(12,2);
BEGIN
  v_id := gen_random_uuid();
  INSERT INTO customer_payments (id, customer_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'customerId')::uuid, (payload->>'amount')::numeric,
    COALESCE(payload->>'method','cash'), payload->>'notes', now());
  UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
    total_paid = total_paid + (payload->>'amount')::numeric, updated_at = now()
  WHERE id = (payload->>'customerId')::uuid RETURNING outstanding_balance INTO v_balance;
  RETURN jsonb_build_object('id', v_id, 'balanceAfter', COALESCE(v_balance,0));
END;
$$;

-- ========== 3. RECORD SUPPLIER PAYMENT ==========
-- supplier_payments: id,company_id,amount,method,notes,recorded_by,recorded_by_name,payable_after,created_at (NO payment_number)
CREATE OR REPLACE FUNCTION record_supplier_payment(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_payable numeric(12,2);
BEGIN
  v_id := gen_random_uuid();
  INSERT INTO supplier_payments (id, company_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'companyId')::uuid, (payload->>'amount')::numeric,
    COALESCE(payload->>'method','cash'), payload->>'notes', now());
  UPDATE companies SET outstanding_payable = GREATEST(0, outstanding_payable - (payload->>'amount')::numeric), updated_at = now()
  WHERE id = (payload->>'companyId')::uuid RETURNING outstanding_payable INTO v_payable;
  RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable,0));
END;
$$;

-- ========== 4. ADJUST STOCK ==========
-- stock_adjustments: id,product_id,product_name,variant_id,variant_name,adjustment_type,qty_before,qty_change,qty_after,reason,adjusted_by,adjusted_by_name,created_at
CREATE OR REPLACE FUNCTION adjust_stock(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_product_id uuid; v_before numeric(12,2); v_after numeric(12,2); v_qty numeric(12,2);
BEGIN
  v_product_id := (payload->>'productId')::uuid;
  v_qty := (payload->>'qty')::numeric;
  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;
  IF (payload->>'adjustmentType') = 'add' THEN v_after := v_before + v_qty; ELSE v_after := GREATEST(0, v_before - v_qty); END IF;
  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;
  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name, adjustment_type, qty_before, qty_change, qty_after, reason, created_at)
  VALUES (v_id, v_product_id, payload->>'productName', NULLIF((payload->>'variantId'),'')::uuid,
    payload->>'variantName', payload->>'adjustmentType', v_before, v_qty, v_after, payload->>'reason', now());
  RETURN jsonb_build_object('id', v_id, 'qtyBefore', v_before, 'qtyChange', v_qty, 'qtyAfter', v_after);
END;
$$;

-- ========== 5. CREATE SALE ==========
-- sales: id,sale_number,customer_id,customer_name,historical_customer_name,historical_customer_phone,historical_customer_address,employee_id,employee_name,subtotal,tax_amount,total_amount,amount_paid,outstanding_balance,payment_type,payment_method,status,is_voided,note,shop_id,created_at,updated_at
-- sale_items: id,sale_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total
CREATE OR REPLACE FUNCTION create_sale(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_number text; v_total numeric(14,4) := 0; v_paid numeric(14,4);
  v_item jsonb; v_rows_updated integer;
BEGIN
  v_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  INSERT INTO sales (id, sale_number, customer_id, customer_name, historical_customer_name, historical_customer_phone,
    historical_customer_address, employee_id, employee_name, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note, status, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number, NULLIF(payload->>'customerId','')::uuid,
    payload->>'customerName', payload->>'customerName', payload->>'customerPhone',
    payload->>'customerAddress', NULLIF(payload->>'employeeId','')::uuid, payload->>'employeeName',
    0, v_paid, 0, payload->>'paymentType', payload->>'paymentMethod', payload->>'note',
    'completed', '00000000-0000-0000-0000-000000000001', now(), now()) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);
    UPDATE products SET stock_qty = ROUND(stock_qty - ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4), 4)
    WHERE id = NULLIF(v_item->>'productId','')::uuid AND stock_qty >= ROUND((v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1), 4);
    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    IF v_rows_updated = 0 THEN RAISE EXCEPTION 'Insufficient stock for %', v_item->>'productName'; END IF;
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, unit_size, base_unit, line_total)
    VALUES (gen_random_uuid(), v_id, NULLIF(v_item->>'productId','')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId','')::uuid, v_item->>'variantName', (v_item->>'qty')::numeric,
      (v_item->>'unitPrice')::numeric, COALESCE((v_item->>'unitSize')::numeric, 1),
      COALESCE(v_item->>'baseUnit','piece'), ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2));
  END LOOP;
  UPDATE sales SET total_amount = v_total, outstanding_balance = v_total - v_paid WHERE id = v_id;
  IF NULLIF(payload->>'customerId','') IS NOT NULL THEN
    UPDATE customers SET total_purchases = total_purchases + v_total,
      outstanding_balance = outstanding_balance + (v_total - v_paid), updated_at = now()
    WHERE id = (payload->>'customerId')::uuid;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'saleNumber', v_number, 'total', v_total);
END;
$$;

-- ========== 6. CREATE PURCHASE ==========
-- purchases: id,purchase_number,company_id,company_name,total_amount,amount_paid,outstanding_payable,payment_method,note,shop_id,created_by,created_at,updated_at
-- purchase_items: id,purchase_id,product_id,variant_id,product_name,variant_name,qty,cost_price,unit_size,line_total
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_number text; v_total numeric(14,4) := 0; v_paid numeric(14,4);
  v_item jsonb; v_company_name text;
BEGIN
  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;
  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount, amount_paid, outstanding_payable,
    payment_method, note, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number, NULLIF(payload->>'companyId','')::uuid, COALESCE(v_company_name, 'Unknown'),
    0, v_paid, 0, payload->>'paymentMethod', payload->>'note',
    '00000000-0000-0000-0000-000000000001', now(), now()) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    INSERT INTO purchase_items (id, purchase_id, product_id, variant_id, product_name, variant_name, qty, cost_price, unit_size, line_total)
    VALUES (gen_random_uuid(), v_id, NULLIF(v_item->>'productId','')::uuid, NULLIF(v_item->>'variantId','')::uuid,
      v_item->>'productName', v_item->>'variantName', (v_item->>'qty')::numeric,
      (v_item->>'costPrice')::numeric, COALESCE((v_item->>'unitSize')::numeric, 1), (v_item->>'lineTotal')::numeric);
    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1)
    WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;
  UPDATE purchases SET total_amount = v_total, outstanding_payable = v_total - v_paid WHERE id = v_id;
  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable = outstanding_payable + (v_total - v_paid), updated_at = now()
    WHERE id = (payload->>'companyId')::uuid;
  END IF;
  RETURN jsonb_build_object('id', v_id, 'purchaseNumber', v_number, 'total', v_total);
END;
$$;

-- ========== 7. PROCESS RETURN ==========
-- returns: id,return_number,sale_id,customer_id,customer_name,total_refund,resolution,note,processed_by,processed_by_name,shop_id,created_at,updated_at
-- return_items: id,return_id,sale_item_id,product_id,variant_id,product_name,variant_name,qty,unit_price,line_total
CREATE OR REPLACE FUNCTION process_return(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_number text; v_total numeric(14,4) := 0; v_item jsonb;
BEGIN
  v_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  INSERT INTO returns (id, return_number, sale_id, customer_id, customer_name, total_refund, resolution, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number, NULLIF(payload->>'saleId','')::uuid, NULLIF(payload->>'customerId','')::uuid,
    COALESCE(payload->>'customerName','Customer'), 0, 'refund',
    '00000000-0000-0000-0000-000000000001', now(), now()) RETURNING id INTO v_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    INSERT INTO return_items (id, return_id, sale_item_id, product_id, variant_id, product_name, variant_name, qty, unit_price, line_total)
    VALUES (gen_random_uuid(), v_id, NULLIF(v_item->>'saleItemId','')::uuid, NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid, v_item->>'productName', COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric, (v_item->>'lineTotal')::numeric);
    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;
  UPDATE returns SET total_refund = v_total WHERE id = v_id;
  RETURN jsonb_build_object('id', v_id, 'returnNumber', v_number, 'refundAmount', v_total);
END;
$$;

-- ========== 8. UPDATE PRODUCT ==========
CREATE OR REPLACE FUNCTION update_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE products SET name = COALESCE(payload->>'name', name), company = COALESCE(payload->>'company', company),
    category = COALESCE((payload->>'category')::product_category, category),
    base_unit = COALESCE(payload->>'baseUnit', base_unit), stock_qty = COALESCE((payload->>'stockQty')::numeric, stock_qty),
    image_url = COALESCE(payload->>'image_url', image_url), barcode = COALESCE(payload->>'barcode', barcode), updated_at = now()
  WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('id', payload->>'id');
END;
$$;

-- ========== 9. DELETE PRODUCT ==========
CREATE OR REPLACE FUNCTION delete_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM product_variants WHERE product_id = (payload->>'id')::uuid;
  DELETE FROM products WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ========== 10. ARCHIVE CUSTOMER ==========
CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers SET is_archived = true, archived_at = now(),
    archived_by = COALESCE(p_archived_by, NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid)
  WHERE id = p_customer_id;
END;
$$;

-- ========== 11. RESTORE CUSTOMER ==========
CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN UPDATE customers SET is_archived = false, archived_at = NULL, archived_by = NULL WHERE id = p_customer_id; END; $$;

-- ========== 12. VOID SALE ==========
-- sales has: is_voided, voided_at, voided_by, voided_by_name, void_reason
CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE sales SET is_voided = true, voided_at = now(),
    voided_by = COALESCE(p_voided_by, NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid),
    void_reason = p_reason WHERE id = p_sale_id;
END;
$$;
