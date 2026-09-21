-- MERGED: two files shared migration version 0028, which makes a
-- fresh `supabase db push` fail with a duplicate key on
-- supabase_migrations.schema_migrations. Both bodies follow, in the order the
-- runner would have applied them:
--   1. 0028_allow_employee_product_edit.sql
--   2. 0028_fix_only_broken_functions.sql

-- Allow all authenticated/anon users to update products (name, image only)
-- This enables employees to edit product details from the Product Detail page
-- The full create/delete is still admin-only via separate policies

-- Drop the restrictive admin-only update policy if it exists
DROP POLICY IF EXISTS products_admin_update ON products;
DROP POLICY IF EXISTS "products_admin_update" ON products;

-- Create permissive update policy for all users
CREATE POLICY "products_update_all" ON products
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- FIX ONLY THE BROKEN FUNCTIONS
-- archive_customer, restore_customer, void_sale already work — don't touch them

-- 1. record_customer_payment (customer_payments: method, no payment_number)
DROP FUNCTION IF EXISTS record_customer_payment(payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(p_payload jsonb);

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

-- 2. record_supplier_payment (supplier_payments: method, no payment_number, outstanding_payable)
DROP FUNCTION IF EXISTS record_supplier_payment(payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(p_payload jsonb);

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

-- 3. adjust_stock (stock_adjustments: adjusted_by, variant_name NOT NULL)
DROP FUNCTION IF EXISTS adjust_stock(payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(p_payload jsonb);

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
    COALESCE(payload->>'variantName',''), payload->>'adjustmentType', v_before, v_qty, v_after, payload->>'reason', now());
  RETURN jsonb_build_object('id', v_id, 'qtyBefore', v_before, 'qtyChange', v_qty, 'qtyAfter', v_after);
END;
$$;

-- 4. create_sale (sales: historical_customer_phone, historical_customer_address, status, employee_name NOT NULL)
DROP FUNCTION IF EXISTS create_sale(payload jsonb);
DROP FUNCTION IF EXISTS create_sale(p_payload jsonb);

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
    COALESCE(payload->>'customerName','Walk-in'), COALESCE(payload->>'customerName','Walk-in'), payload->>'customerPhone',
    payload->>'customerAddress', NULLIF(payload->>'employeeId','')::uuid, COALESCE(payload->>'employeeName','Admin'),
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
      NULLIF(v_item->>'variantId','')::uuid, COALESCE(v_item->>'variantName',''), (v_item->>'qty')::numeric,
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

-- 5. create_purchase (purchases: company_name NOT NULL, outstanding_payable)
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(p_payload jsonb);

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
      v_item->>'productName', COALESCE(v_item->>'variantName',''), (v_item->>'qty')::numeric,
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

-- 6. process_return (returns: customer_name NOT NULL, total_refund not refund_amount, resolution not reason)
DROP FUNCTION IF EXISTS process_return(payload jsonb);
DROP FUNCTION IF EXISTS process_return(p_payload jsonb);

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
