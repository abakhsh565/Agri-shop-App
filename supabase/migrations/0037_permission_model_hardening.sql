-- ============================================================
-- Migration 0037: Permission Model & Business-Integrity Hardening
--
-- enforces the confirmed Employee/Admin permission model at the
-- database level so that prohibited operations and direct
-- business-state manipulation cannot bypass the application's
-- intended workflows.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART A  Role checks in prohibited RPCs
-- ────────────────────────────────────────────────────────────

-- Helper: get caller's role from users table
-- (JWT 'role' is always 'authenticated'; the real role lives in users.role)

-- A1: void_sale — Admin only
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
  -- Authorization: only admin may void sales
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  v_actor := COALESCE(
    p_voided_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

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

GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;

-- A2: adjust_stock — Admin only
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
  v_caller_role text;
BEGIN
  -- Authorization: only admin may adjust stock
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
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

GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;

-- A3: record_supplier_payment — Admin only
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
  v_caller_role text;
BEGIN
  -- Authorization: only admin may make supplier payments
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
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

GRANT EXECUTE ON FUNCTION record_supplier_payment(jsonb) TO authenticated;

-- A4: create_product, update_product, delete_product — Admin only
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
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
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

GRANT EXECUTE ON FUNCTION create_product(jsonb) TO authenticated;

DROP FUNCTION IF EXISTS update_product(jsonb);
DROP FUNCTION IF EXISTS update_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION update_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can update products';
  END IF;

  UPDATE products SET name = COALESCE(payload->>'name', name), company = COALESCE(payload->>'company', company),
    category = COALESCE((payload->>'category')::product_category, category),
    base_unit = COALESCE(payload->>'baseUnit', base_unit), stock_qty = COALESCE((payload->>'stockQty')::numeric, stock_qty),
    image_url = COALESCE(payload->>'image_url', image_url), barcode = COALESCE(payload->>'barcode', barcode), updated_at = now()
  WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('id', payload->>'id');
END;
$$;

GRANT EXECUTE ON FUNCTION update_product(jsonb) TO authenticated;

DROP FUNCTION IF EXISTS delete_product(jsonb);
DROP FUNCTION IF EXISTS delete_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION delete_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete products';
  END IF;

  DELETE FROM product_variants WHERE product_id = (payload->>'id')::uuid;
  DELETE FROM products WHERE id = (payload->>'id')::uuid;
  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- PART B  create_sale input validation
-- ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS create_sale(jsonb);
DROP FUNCTION IF EXISTS create_sale(p_payload jsonb);

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
  v_item jsonb;
  v_rows_updated integer;
BEGIN
  -- Validate: items array required with at least one entry
  IF payload->'items' IS NULL OR jsonb_array_length(payload->'items') = 0 THEN
    RAISE EXCEPTION 'SALE_REQUIRES_ITEMS: At least one item is required to create a sale';
  END IF;

  v_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);

  INSERT INTO sales (id, sale_number, customer_id, customer_name, historical_customer_name,
    historical_customer_phone, historical_customer_address, employee_id, employee_name,
    total_amount, amount_paid, outstanding_balance, payment_type, payment_method, note,
    status, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number,
    NULLIF(payload->>'customerId','')::uuid,
    COALESCE(payload->>'customerName','Walk-in'),
    COALESCE(payload->>'customerName','Walk-in'),
    payload->>'customerPhone', payload->>'customerAddress',
    NULLIF(payload->>'employeeId','')::uuid,
    COALESCE(payload->>'employeeName','Admin'),
    0, v_paid, 0,
    COALESCE(payload->>'paymentType','full')::payment_type,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note', 'completed',
    '00000000-0000-0000-0000-000000000001', now(), now())
  RETURNING id INTO v_id;

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

  UPDATE sales SET total_amount = v_total, outstanding_balance = GREATEST(0, v_total - v_paid) WHERE id = v_id;

  IF NULLIF(payload->>'customerId','') IS NOT NULL THEN
    UPDATE customers SET total_purchases = total_purchases + v_total,
      outstanding_balance = GREATEST(0, outstanding_balance + (v_total - v_paid)),
      updated_at = now()
    WHERE id = (payload->>'customerId')::uuid;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'saleNumber', v_number, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- PART C  Triggers to protect business-critical state
-- ────────────────────────────────────────────────────────────

-- C1: Protect customer financial fields from direct manipulation
CREATE OR REPLACE FUNCTION protect_customer_financials()
RETURNS TRIGGER AS $$
BEGIN
  -- SECURITY DEFINER functions run as the owner (postgres) — allow them
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  -- Block direct updates to financial/derived fields
  IF OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance THEN
    RAISE EXCEPTION 'OUTSTANDING_PROTECTED: Customer outstanding balance can only be modified through sales, payments, or returns workflows';
  END IF;
  IF OLD.total_purchases IS DISTINCT FROM NEW.total_purchases THEN
    RAISE EXCEPTION 'PURCHASES_PROTECTED: Customer total purchases can only be modified through the sales workflow';
  END IF;
  IF OLD.total_paid IS DISTINCT FROM NEW.total_paid THEN
    RAISE EXCEPTION 'PAID_PROTECTED: Customer total paid can only be modified through the payment workflow';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_customer_financials ON customers;
CREATE TRIGGER trg_protect_customer_financials
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION protect_customer_financials();

-- C2: Protect product stock from direct manipulation
CREATE OR REPLACE FUNCTION protect_product_stock()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.stock_qty IS DISTINCT FROM NEW.stock_qty THEN
    RAISE EXCEPTION 'STOCK_PROTECTED: Product stock can only be modified through sales, returns, or stock adjustment workflows';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_product_stock ON products;
CREATE TRIGGER trg_protect_product_stock
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION protect_product_stock();

-- C3: Protect sale financial fields from direct manipulation
CREATE OR REPLACE FUNCTION protect_sale_financials()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  IF OLD.total_amount IS DISTINCT FROM NEW.total_amount THEN
    RAISE EXCEPTION 'SALE_TOTAL_PROTECTED: Sale total can only be set during sale creation';
  END IF;
  IF OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance THEN
    RAISE EXCEPTION 'SALE_OUTSTANDING_PROTECTED: Sale outstanding can only be modified through the payment workflow';
  END IF;
  IF OLD.amount_paid IS DISTINCT FROM NEW.amount_paid THEN
    RAISE EXCEPTION 'SALE_PAID_PROTECTED: Sale amount paid can only be modified through the payment workflow';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_sale_financials ON sales;
CREATE TRIGGER trg_protect_sale_financials
  BEFORE UPDATE ON sales
  FOR EACH ROW
  EXECUTE FUNCTION protect_sale_financials();

-- C4: Prevent role escalation and protect other users' records
CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- SECURITY DEFINER functions (admin employee management) allowed
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  -- Look up caller's role
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  -- Only admin may change roles
  IF OLD.role IS DISTINCT FROM NEW.role AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'ROLE_PROTECTED: Only administrators can change user roles';
  END IF;
  -- Only admin may deactivate accounts
  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'ACCOUNT_PROTECTED: Only administrators can change account status';
  END IF;
  -- Employee may only modify their own record
  IF NEW.id != auth.uid() AND v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'USER_ISOLATION: Cannot modify another user''s account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_role_escalation ON users;
CREATE TRIGGER trg_prevent_role_escalation
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_role_escalation();

-- ────────────────────────────────────────────────────────────
-- PART D  RLS on write-only tables (SELECT only for authenticated)
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions bypass RLS, so RPCs still work.
-- Direct frontend writes are blocked.

-- D1: customer_payments — SELECT only
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_customer_payments" ON customer_payments;
DROP POLICY IF EXISTS "authenticated_select" ON customer_payments;
CREATE POLICY "authenticated_select" ON customer_payments
  FOR SELECT USING (true);

-- D2: stock_adjustments — SELECT only
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_stock_adjustments" ON stock_adjustments;
DROP POLICY IF EXISTS "authenticated_select" ON stock_adjustments;
CREATE POLICY "authenticated_select" ON stock_adjustments
  FOR SELECT USING (true);

-- D3: voids — SELECT only
ALTER TABLE voids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_voids" ON voids;
DROP POLICY IF EXISTS "authenticated_select" ON voids;
CREATE POLICY "authenticated_select" ON voids
  FOR SELECT USING (true);

-- D4: returns — SELECT only
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_returns" ON returns;
DROP POLICY IF EXISTS "authenticated_select" ON returns;
CREATE POLICY "authenticated_select" ON returns
  FOR SELECT USING (true);

-- D5: return_items — SELECT only
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_return_items" ON return_items;
DROP POLICY IF EXISTS "authenticated_select" ON return_items;
CREATE POLICY "authenticated_select" ON return_items
  FOR SELECT USING (true);

-- D6: sale_items — SELECT only (writes via create_sale RPC)
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_sale_items" ON sale_items;
DROP POLICY IF EXISTS "authenticated_select" ON sale_items;
CREATE POLICY "authenticated_select" ON sale_items
  FOR SELECT USING (true);

-- D7: purchase_items — SELECT only (writes via create_purchase RPC)
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_purchase_items" ON purchase_items;
DROP POLICY IF EXISTS "authenticated_select" ON purchase_items;
CREATE POLICY "authenticated_select" ON purchase_items
  FOR SELECT USING (true);

-- D8: supplier_payments — SELECT only (writes via record_supplier_payment RPC)
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_all_supplier_payments" ON supplier_payments;
DROP POLICY IF EXISTS "authenticated_select" ON supplier_payments;
CREATE POLICY "authenticated_select" ON supplier_payments
  FOR SELECT USING (true);

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
