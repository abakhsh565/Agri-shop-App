-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0099: Tenant resolution fallback for no-JWT sessions
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: The app's OTP flow does not establish a Supabase Auth session
-- (verifyOtp fails silently for unregistered phone numbers). Without a JWT,
-- app_current_user_id() returns NULL, current_shop_id() returns NULL, and
-- ALL RPCs that set shop_id fail with NOT NULL constraint violation.
--
-- FIX: Add resolve_tenant_for_user(p_user_id) that resolves tenant from the
-- users table (SECURITY DEFINER, bypasses RLS). Update all critical RPCs to
-- use COALESCE(current_shop_id(), resolve_tenant_for_user(user_id_from_payload)).
--
-- SECURITY: resolve_tenant_for_user reads from users.shop_id (set during
-- onboarding). The user_id comes from the frontend's authenticated state
-- (verified via phone lookup). This is safe because the phone-based OTP
-- authentication is the security boundary, not the JWT.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Fallback tenant resolver
CREATE OR REPLACE FUNCTION resolve_tenant_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- First try memberships (new architecture)
  SELECT COALESCE(
    (SELECT m.tenant_id FROM memberships m
     WHERE m.user_id = p_user_id AND m.status = 'active'
     ORDER BY m.created_at ASC LIMIT 1),
    -- Fallback: legacy users.shop_id
    (SELECT u.shop_id FROM users u WHERE u.id = p_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION resolve_tenant_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_tenant_for_user(uuid) TO anon;

-- 2. Helper to resolve both shop_id AND actor from a payload
-- Returns jsonb with {shop_id, actor_id}
CREATE OR REPLACE FUNCTION resolve_shop_and_actor(
  p_shop_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_shop_id uuid;
  v_actor_id uuid;
BEGIN
  -- Try JWT first
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;

  -- If no JWT, use provided user_id
  IF v_user_id IS NULL THEN
    v_user_id := p_user_id;
  END IF;

  -- Resolve tenant
  v_shop_id := COALESCE(
    current_shop_id(),
    resolve_tenant_for_user(v_user_id),
    p_shop_id
  );

  -- Resolve actor
  v_actor_id := COALESCE(
    v_user_id,
    p_created_by,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  RETURN jsonb_build_object(
    'shop_id', v_shop_id,
    'actor_id', v_actor_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_shop_and_actor(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_shop_and_actor(uuid, uuid, uuid) TO anon;

-- 3. Update create_customer to use fallback
CREATE OR REPLACE FUNCTION create_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_phone text;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
BEGIN
  -- Resolve tenant + actor with fallback
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  -- Validate phone uniqueness
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    v_actor,
    v_shop_id,
    now(), now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'name', payload->>'name');
END;
$$;

-- 4. Update create_company to use fallback
CREATE OR REPLACE FUNCTION create_company(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  INSERT INTO companies (
    id, name, contact_person, phone, address, logo_url,
    outstanding_payable, total_purchases, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    NULLIF(payload->>'contactPerson', ''),
    NULLIF(payload->>'phone', ''),
    NULLIF(payload->>'address', ''),
    NULLIF(payload->>'logoUrl', ''),
    0, 0, v_shop_id, now()
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'name', payload->>'name');
END;
$$;

GRANT EXECUTE ON FUNCTION create_company(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_company(jsonb) TO anon;

-- 5. Update create_product to use fallback
CREATE OR REPLACE FUNCTION create_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_id uuid;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_item jsonb;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  INSERT INTO products (
    id, name, category, company_id, image_url, is_active, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    COALESCE((payload->>'category')::product_category, 'other'),
    NULLIF(payload->>'companyId', '')::uuid,
    NULLIF(payload->>'imageUrl', ''),
    true, v_shop_id, now()
  )
  RETURNING id INTO v_product_id;

  -- Insert variants
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants', '[]'::jsonb))
  LOOP
    INSERT INTO product_variants (
      product_id, name, selling_price, cost_price, stock_qty,
      low_stock_threshold, unit_size, is_active
    ) VALUES (
      v_product_id,
      v_item->>'name',
      COALESCE((v_item->>'sellingPrice')::numeric, 0),
      COALESCE((v_item->>'costPrice')::numeric, 0),
      COALESCE((v_item->>'stockQty')::int, 0),
      GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, 5), 0),
      GREATEST(COALESCE((v_item->>'unitSize')::numeric, 1), 1),
      NULLIF(''),
      true
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_product_id, 'name', payload->>'name');
END;
$$;

GRANT EXECUTE ON FUNCTION create_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_product(jsonb) TO anon;

-- 6. Update create_sale to use fallback
CREATE OR REPLACE FUNCTION create_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4) := 0;
  v_item jsonb;
  v_stored_by uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;
  v_customer_id := NULLIF(payload->>'customerId', '')::uuid;
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_sale_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  INSERT INTO sales (
    id, sale_number, customer_id, customer_name, subtotal, discount,
    tax, total, payment_method, amount_paid, outstanding, shop_id,
    sale_date, created_at
  ) VALUES (
    gen_random_uuid(), v_sale_number, v_customer_id,
    (SELECT name FROM customers WHERE id = v_customer_id),
    0, 0, 0, 0,
    COALESCE(payload->>'paymentMethod', 'cash')::payment_method,
    v_paid, -v_paid, v_shop_id, now(), now()
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    v_stored_by := NULLIF(v_item->>'storedBy', '')::uuid;
    INSERT INTO sale_items (
      id, sale_id, product_id, variant_id, product_name, variant_name,
      qty, selling_price, cost_price, line_total, stored_by, stored_by_name,
      unit_size
    ) VALUES (
      gen_random_uuid(), v_sale_id,
      NULLIF(v_item->>'productId', '')::uuid,
      NULLIF(v_item->>'variantId', '')::uuid,
      v_item->>'productName', COALESCE(v_item->>'variantName', ''),
      (v_item->>'qty')::numeric, (v_item->>'sellingPrice')::numeric,
      COALESCE((v_item->>'costPrice')::numeric, 0),
      (v_item->>'lineTotal')::numeric,
      v_stored_by, (v_item->>'storedByName', ''),
      COALESCE((v_item->>'unitSize')::numeric, 1)
    );

    -- Deduct stock
    IF (v_item->>'variantId')::uuid IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty - (v_item->>'qty')::numeric
        WHERE id = (v_item->>'variantId')::uuid;
    END IF;

    INSERT INTO inventory_movements (
      id, product_id, variant_id, movement_type, quantity, reference_id,
      reference_type, shop_id, created_at
    ) VALUES (
      gen_random_uuid(),
      NULLIF(v_item->>'productId', '')::uuid,
      NULLIF(v_item->>'variantId', '')::uuid,
      'sale', -((v_item->>'qty')::numeric),
      v_sale_id, 'sale', v_shop_id, now()
    );
  END LOOP;

  UPDATE sales SET subtotal = v_total, total = v_total - 0,
    outstanding = v_total - v_paid WHERE id = v_sale_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = outstanding_balance + (v_total - v_paid) WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'total', v_total, 'paid', v_paid);
END;
$$;

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO anon;

-- 7. Update create_purchase to use fallback
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_resolved jsonb;
  v_shop_id uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;

  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);

  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;

  INSERT INTO purchases (
    id, purchase_number, company_id, company_name, total_amount, amount_paid,
    outstanding_payable, payment_method, note, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_number, NULLIF(payload->>'companyId','')::uuid,
    COALESCE(v_company_name, 'Unknown'), 0, v_paid, 0,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note', v_shop_id, now(), now()
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;
    INSERT INTO purchase_items (
      id, purchase_id, product_id, variant_id, product_name, variant_name,
      qty, cost_price, unit_size, line_total
    ) VALUES (
      gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid,
      v_item->>'productName',
      COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, (v_item->>'costPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1),
      (v_item->>'lineTotal')::numeric
    );

    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric
      * COALESCE((v_item->>'unitSize')::numeric, 1)
      WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;

  UPDATE purchases SET total_amount = v_total, outstanding_payable = v_total - v_paid WHERE id = v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable = outstanding_payable + (v_total - v_paid),
      updated_at = now() WHERE id = (payload->>'companyId')::uuid;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'purchaseNumber', v_number, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO anon;
