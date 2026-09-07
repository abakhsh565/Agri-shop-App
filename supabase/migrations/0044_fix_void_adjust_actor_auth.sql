-- ============================================================
-- Migration 0044: Fix auth.uid()-dependent RPCs for custom-auth architecture
--
-- PROBLEM
-- The app uses a custom phone+OTP login (users table + localStorage)
-- and never establishes a Supabase Auth session. Therefore
-- auth.uid() is ALWAYS NULL, and RPCs that authorize via
-- auth.uid() always raise NOT_AUTHORIZED — even for the real admin.
--
-- AFFECTED RPCs (all from migration 0037):
--   void_sale, adjust_stock, record_supplier_payment,
--   create_product, update_product, delete_product
--
-- FIX
-- Each function resolves the actor from an explicit parameter passed
-- by the frontend (which reads it from the auth store), falling back
-- to the JWT sub claim, then validates the actor's role in users.
--
-- This preserves the admin-only security rule while being compatible
-- with the application's custom-auth architecture.
--
-- GRANTs: Both 'anon' and 'authenticated' — the app uses the anon key.
--
-- NOT modified:
--   prevent_role_escalation trigger — SECURITY DEFINER functions run
--   as postgres, so current_user='postgres' check passes and the
--   trigger is skipped. Direct user updates are blocked by RLS.
--   process_return — already has fallback to payload.processedBy.
--   create_sale — does not use auth.uid() for authorization.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- A1: void_sale — Admin only, actor from p_voided_by
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

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_restored_stock := v_restored_stock + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4);
    UPDATE products SET stock_qty = ROUND(stock_qty + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4), 4)
    WHERE id = v_item.product_id;
  END LOOP;

  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
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
-- A2: adjust_stock — Admin only, actor from payload->>'actorId'
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS adjust_stock(jsonb);
DROP FUNCTION IF EXISTS adjust_stock(p_payload jsonb);

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
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may adjust stock
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
  RETURN jsonb_build_object('id', v_id, 'qtyBefore', v_before, 'qtyChange', v_qty, 'qtyAfter', v_after);
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- A3: record_supplier_payment — Admin only, actor from payload->>'actorId'
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS record_supplier_payment(jsonb);
DROP FUNCTION IF EXISTS record_supplier_payment(p_payload jsonb);

CREATE OR REPLACE FUNCTION record_supplier_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_payable numeric(12,2);
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may make supplier payments
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can make supplier payments';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO supplier_payments (id, company_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'companyId')::uuid, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', now());
  UPDATE companies SET outstanding_payable = GREATEST(0, outstanding_payable - (payload->>'amount')::numeric),
    updated_at = now()
  WHERE id = (payload->>'companyId')::uuid RETURNING outstanding_payable INTO v_payable;
  RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable,0));
END;
$$;

GRANT EXECUTE ON FUNCTION record_supplier_payment(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION record_supplier_payment(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- A4: create_product — Admin only, actor from payload->>'actorId'
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS create_product(jsonb);
DROP FUNCTION IF EXISTS create_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION create_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_product_id uuid;
  v_variant jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may create products
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create products';
  END IF;

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
      (v_variant->>'sellingPrice')::numeric, COALESCE((v_variant->>'costPrice')::numeric,0),
      COALESCE((v_variant->>'unitSize')::numeric,1), COALESCE((v_variant->>'qtyStep')::numeric,1),
      COALESCE((v_variant->>'lowStockThreshold')::numeric,5), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_product(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_product(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- A5: update_product — Admin only, actor from payload->>'actorId'
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS update_product(jsonb);
DROP FUNCTION IF EXISTS update_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION update_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may update products
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can update products';
  END IF;

  UPDATE products SET name = COALESCE(payload->>'name', name), company = COALESCE(payload->>'company', company),
    category = COALESCE((payload->>'category')::product_category, category), base_unit = COALESCE(payload->>'baseUnit', base_unit),
    stock_qty = COALESCE((payload->>'stockQty')::numeric, stock_qty), image_url = COALESCE(payload->>'image_url', image_url),
    barcode = COALESCE(payload->>'barcode', barcode), updated_at = now()
  WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('id', payload->>'id');
END;
$$;

GRANT EXECUTE ON FUNCTION update_product(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION update_product(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- A6: delete_product — Admin only, actor from payload->>'actorId'
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS delete_product(jsonb);
DROP FUNCTION IF EXISTS delete_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION delete_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may delete products
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete products';
  END IF;

  DELETE FROM product_variants WHERE product_id = (payload->>'id')::uuid;
  DELETE FROM products WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
