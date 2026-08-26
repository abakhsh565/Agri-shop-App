-- CREATE MISSING RPC FUNCTIONS
-- These functions are called by the app but were never created in migrations.

-- 1. CREATE PRODUCT (with variants)
CREATE OR REPLACE FUNCTION create_product(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_variant jsonb;
  v_total_stock numeric(12,2) := 0;
BEGIN
  -- Create the product
  v_product_id := gen_random_uuid();

  INSERT INTO products (
    id, name, company, category, base_unit, stock_qty,
    image_url, barcode, shop_id, created_at, updated_at
  ) VALUES (
    v_product_id,
    p_payload->>'name',
    p_payload->>'company',
    COALESCE(p_payload->>'category', 'Other')::text,
    COALESCE(p_payload->>'baseUnit', 'piece'),
    (p_payload->>'stockQty')::numeric,
    p_payload->>'image_url',
    p_payload->>'barcode',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now(),
    now()
  );

  -- Create variants
  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'variants', '[]'::jsonb))
  LOOP
    v_total_stock := v_total_stock + (v_variant->>'qtyStep')::numeric;

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


-- 2. RECORD CUSTOMER PAYMENT
CREATE OR REPLACE FUNCTION record_customer_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_customer_id uuid;
  v_amount numeric(12,2);
  v_balance_after numeric(12,2);
  v_payment_number text;
BEGIN
  v_customer_id := (p_payload->>'customerId')::uuid;
  v_amount := (p_payload->>'amount')::numeric;
  v_payment_number := 'PAY-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');

  -- Create payment record
  v_payment_id := gen_random_uuid();
  INSERT INTO customer_payments (
    id, payment_number, customer_id, amount, payment_method,
    notes, created_by, created_at
  ) VALUES (
    v_payment_id, v_payment_number, v_customer_id, v_amount,
    COALESCE(p_payload->>'method', 'cash'),
    p_payload->>'notes',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now()
  );

  -- Update customer outstanding balance
  UPDATE customers
  SET outstanding_balance = GREATEST(0, outstanding_balance - v_amount),
      total_paid = total_paid + v_amount,
      updated_at = now()
  WHERE id = v_customer_id
  RETURNING outstanding_balance INTO v_balance_after;

  RETURN jsonb_build_object(
    'id', v_payment_id,
    'balanceAfter', COALESCE(v_balance_after, 0)
  );
END;
$$;


-- 3. RECORD SUPPLIER PAYMENT
CREATE OR REPLACE FUNCTION record_supplier_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_company_id uuid;
  v_amount numeric(12,2);
  v_payable_after numeric(12,2);
  v_payment_number text;
BEGIN
  v_company_id := (p_payload->>'companyId')::uuid;
  v_amount := (p_payload->>'amount')::numeric;
  v_payment_number := 'SUP-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');

  -- Create payment record
  v_payment_id := gen_random_uuid();
  INSERT INTO supplier_payments (
    id, payment_number, company_id, amount, payment_method,
    notes, created_by, created_at
  ) VALUES (
    v_payment_id, v_payment_number, v_company_id, v_amount,
    COALESCE(p_payload->>'method', 'cash'),
    p_payload->>'notes',
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    now()
  );

  -- Update company payable balance
  UPDATE companies
  SET payable_balance = GREATEST(0, payable_balance - v_amount),
      updated_at = now()
  WHERE id = v_company_id
  RETURNING payable_balance INTO v_payable_after;

  RETURN jsonb_build_object(
    'id', v_payment_id,
    'payableAfter', COALESCE(v_payable_after, 0)
  );
END;
$$;
