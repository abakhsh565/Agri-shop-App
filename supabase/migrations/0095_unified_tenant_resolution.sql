-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0095: Unified Tenant Resolution for All Business RPCs
-- ═══════════════════════════════════════════════════════════════════════════════
-- SAFETY: All changes are CREATE OR REPLACE — no data destroyed.
-- Purpose: Every RPC that sets shop_id now uses current_shop_id() (membership-based)
-- instead of ad-hoc JWT claims, hardcoded defaults, or wrong values.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. create_customer: was reading JWT->>'shop_id' (not in JWT)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_customer(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_phone text;
  v_shop_id uuid;
  v_actor uuid;
BEGIN
  -- Resolve tenant via membership (single source of truth)
  v_shop_id := current_shop_id();

  -- Resolve actor from JWT sub → system default
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Validate phone uniqueness
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  -- Insert customer WITH tenant-scoped shop_id
  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    COALESCE(v_actor, NULLIF(payload->>'created_by', '')::uuid),
    v_shop_id,
    now(),
    now()
  ) RETURNING id INTO v_id;

  -- Insert crops if provided
  IF payload ? 'crops' THEN
    INSERT INTO customer_crops (customer_id, crop_name)
    SELECT v_id, crop.value
    FROM jsonb_array_elements_text(payload->'crops') AS crop;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- 2. create_product: was using JWT sub (user UUID!) as shop_id — WRONG
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_product(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_variant jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve tenant via membership (single source of truth)
  v_shop_id := current_shop_id();

  -- Resolve actor from JWT sub → system default
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may create products
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create products';
  END IF;

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
      (v_variant->>'sellingPrice')::numeric, COALESCE((v_variant->>'costPrice')::numeric,0),
      COALESCE((v_variant->>'unitSize')::numeric,1), COALESCE((v_variant->>'qtyStep')::numeric,1),
      COALESCE((v_variant->>'lowStockThreshold')::numeric,5), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_product_id);
END;
$function$;

-- 3. create_sale: was hardcoded '00000000-...' and used JWT sub as actor
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_sale(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_shop_id uuid;
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
  v_actor uuid;
  v_change numeric(14,4);
  v_before numeric(12,2);
  v_after numeric(12,2);
BEGIN
  IF payload->'items' IS NULL OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'SALE_REQUIRES_ITEMS: At least one item is required to create a sale';
  END IF;

  -- Resolve tenant via membership (single source of truth)
  v_shop_id := current_shop_id();

  v_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_payment_type := COALESCE((payload->>'paymentType'), 'full');
  v_customer_id := NULLIF(payload->>'customerId','')::uuid;
  v_due_date := payload->>'dueDate';
  v_actor := COALESCE(
    NULLIF(payload->>'employeeId','')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
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
    v_shop_id, now(), now())
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
$function$;

-- 4. create_purchase: was hardcoded '00000000-...'
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_purchase(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_shop_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_line_total numeric(14,4);
  v_before numeric(12,2);
  v_change numeric(14,4);
  v_after numeric(12,2);
  v_actor uuid;
BEGIN
  -- Resolve tenant via membership (single source of truth)
  v_shop_id := current_shop_id();

  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_actor := COALESCE(
    NULLIF(payload->>'actorId','')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );
  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;

  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount, amount_paid,
    outstanding_payable, payment_method, note, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number,
    NULLIF(payload->>'companyId','')::uuid,
    COALESCE(v_company_name, 'Unknown'),
    0, v_paid, 0,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note',
    v_shop_id,
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
$function$;

-- 5. approve_shop_request: also create membership for the new owner
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_shop_request(request_id uuid, admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  req_record RECORD;
  new_shop_id uuid;
  new_user_id uuid;
  result jsonb;
BEGIN
  SELECT * INTO req_record FROM shop_requests WHERE id = request_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  -- Create the new tenant (shop)
  new_shop_id := gen_random_uuid();
  INSERT INTO shops (id, name) VALUES (new_shop_id, req_record.shop_name);

  -- Create the owner user
  new_user_id := gen_random_uuid();
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, shop_id, created_by
  ) VALUES (
    new_user_id, req_record.owner_name, req_record.owner_phone,
    'admin', true, true, 'EMP-001', new_shop_id, admin_id
  );

  -- Create membership for the new owner (tenant foundation)
  INSERT INTO memberships (user_id, tenant_id, role, status)
  VALUES (new_user_id, new_shop_id, 'owner', 'active');

  -- Create default branch for the new tenant
  INSERT INTO branches (tenant_id, name, is_default)
  VALUES (new_shop_id, req_record.shop_name || ' - Main', true);

  UPDATE shop_requests
  SET status = 'approved', reviewed_by = admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = request_id;

  result := jsonb_build_object(
    'success', true, 'shop_id', new_shop_id, 'user_id', new_user_id,
    'shop_name', req_record.shop_name, 'owner_name', req_record.owner_name
  );
  RETURN result;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- GRANTS: ensure service_role can access new tables (needed for tests)
-- ═══════════════════════════════════════════════════════════════════════════════
GRANT ALL ON memberships TO service_role;
GRANT ALL ON branches TO service_role;
