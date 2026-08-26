-- FIX: Recreate all 3 RPC functions with parameter name "payload" (not "p_payload")
-- PostgREST matches parameter names, client sends { payload: ... }

-- 1. DROP old functions
DROP FUNCTION IF EXISTS create_product(p_payload jsonb);
DROP FUNCTION IF EXISTS record_customer_payment(p_payload jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(p_payload jsonb);

-- 2. CREATE PRODUCT
CREATE OR REPLACE FUNCTION create_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_variant jsonb;
BEGIN
  v_product_id := gen_random_uuid();

  INSERT INTO products (
    id, name, company, category, base_unit, stock_qty,
    image_url, barcode, shop_id, created_at, updated_at
  ) VALUES (
    v_product_id,
    payload->>'name',
    payload->>'company',
    COALESCE(payload->>'category', 'Other')::product_category,
    COALESCE(payload->>'baseUnit', 'piece'),
    COALESCE((payload->>'stockQty')::numeric, 0),
    payload->>'image_url',
    payload->>'barcode',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now(),
    now()
  );

  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants', '[]'::jsonb))
  LOOP
    INSERT INTO product_variants (
      id, product_id, name, selling_price, cost_price,
      unit_size, qty_step, low_stock_threshold, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_product_id,
      v_variant->>'name',
      (v_variant->>'sellingPrice')::numeric,
      (v_variant->>'costPrice')::numeric,
      (v_variant->>'unitSize')::numeric,
      (v_variant->>'qtyStep')::numeric,
      COALESCE((v_variant->>'lowStockThreshold')::numeric, 5),
      now(),
      now()
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_product_id);
END;
$$;


-- 3. RECORD CUSTOMER PAYMENT
CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_balance_after numeric(12,2);
BEGIN
  v_payment_id := gen_random_uuid();

  INSERT INTO customer_payments (
    id, payment_number, customer_id, amount, payment_method,
    notes, created_by, created_at
  ) VALUES (
    v_payment_id,
    'PAY-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0'),
    (payload->>'customerId')::uuid,
    (payload->>'amount')::numeric,
    COALESCE(payload->>'method', 'cash'),
    payload->>'notes',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now()
  );

  UPDATE customers
  SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
      total_paid = total_paid + (payload->>'amount')::numeric,
      updated_at = now()
  WHERE id = (payload->>'customerId')::uuid
  RETURNING outstanding_balance INTO v_balance_after;

  RETURN jsonb_build_object(
    'id', v_payment_id,
    'balanceAfter', COALESCE(v_balance_after, 0)
  );
END;
$$;


-- 4. RECORD SUPPLIER PAYMENT
CREATE OR REPLACE FUNCTION record_supplier_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_payable_after numeric(12,2);
BEGIN
  v_payment_id := gen_random_uuid();

  INSERT INTO supplier_payments (
    id, payment_number, company_id, amount, payment_method,
    notes, created_by, created_at
  ) VALUES (
    v_payment_id,
    'SUP-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0'),
    (payload->>'companyId')::uuid,
    (payload->>'amount')::numeric,
    COALESCE(payload->>'method', 'cash'),
    payload->>'notes',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now()
  );

  UPDATE companies
  SET payable_balance = GREATEST(0, payable_balance - (payload->>'amount')::numeric),
      updated_at = now()
  WHERE id = (payload->>'companyId')::uuid
  RETURNING payable_balance INTO v_payable_after;

  RETURN jsonb_build_object(
    'id', v_payment_id,
    'payableAfter', COALESCE(v_payable_after, 0)
  );
END;
$$;
