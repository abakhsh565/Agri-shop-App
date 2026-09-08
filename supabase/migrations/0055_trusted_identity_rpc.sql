-- ============================================================
-- Migration 0055: Trusted Identity — RPC Actor Verification
--
-- PROBLEM: RPCs trust client-provided actorId, allowing spoofing.
--
-- SOLUTION: Update RPCs to derive actor from auth.uid() (JWT)
-- and reject operations if auth.uid() is NULL or doesn't match
-- the provided actorId.
--
-- REQUIRES: Supabase Auth session must be established after login.
-- ============================================================

-- ── Helper function to get authenticated user ID ─────────────
CREATE OR REPLACE FUNCTION get_authenticated_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Try auth.uid() first (from JWT/session)
  v_user_id := auth.uid();
  
  -- If NULL, try JWT claims (for SECURITY DEFINER context)
  IF v_user_id IS NULL THEN
    BEGIN
      v_user_id := NULLIF(
        current_setting('request.jwt.claims', true)::json->>'sub',
        ''
      )::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;
  
  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_authenticated_user_id() TO anon;
GRANT EXECUTE ON FUNCTION get_authenticated_user_id() TO authenticated;

-- ── Update void_sale to verify actor ─────────────────────────
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
  v_already_returned numeric(14,4);
  v_auth_user_id uuid;
BEGIN
  -- Get authenticated user from JWT/session
  v_auth_user_id := get_authenticated_user_id();
  
  -- Verify actor identity: must be authenticated
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  
  -- Use authenticated user as actor, ignore client-provided actor
  v_actor := v_auth_user_id;
  
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
    SELECT COALESCE(SUM(ri.qty), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    v_change := ROUND((v_item.qty - v_already_returned) * COALESCE(v_item.unit_size, 1), 4);
    IF v_change <= 0 THEN CONTINUE; END IF;

    v_restored_stock := v_restored_stock + v_change;
    SELECT stock_qty INTO v_before FROM products WHERE id = v_item.product_id;
    v_before := COALESCE(v_before, 0);
    UPDATE products SET stock_qty = ROUND(stock_qty + v_change, 4) WHERE id = v_item.product_id;
    v_after := v_before + v_change;

    INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
      reference_type, reference_id, created_by, created_at)
    VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
      'void', p_sale_id, v_actor, now());
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

-- ── Update adjust_stock to verify actor ──────────────────────
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
  v_auth_user_id uuid;
BEGIN
  -- Get authenticated user from JWT/session
  v_auth_user_id := get_authenticated_user_id();
  
  -- Verify actor identity: must be authenticated
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  
  -- Use authenticated user as actor, ignore client-provided actorId
  v_actor := v_auth_user_id;

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

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (v_product_id, NULLIF((payload->>'variantId'),'')::uuid,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now());

  RETURN jsonb_build_object('id', v_id, 'qtyBefore', v_before, 'qtyChange', v_qty, 'qtyAfter', v_after);
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;

-- ── Update record_customer_payment to verify actor ───────────
DROP FUNCTION IF EXISTS record_customer_payment(jsonb);

CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_balance numeric(14,4);
  v_actor uuid;
  v_auth_user_id uuid;
BEGIN
  -- Get authenticated user from JWT/session
  v_auth_user_id := get_authenticated_user_id();
  
  -- Verify actor identity: must be authenticated
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;
  
  -- Use authenticated user as actor
  v_actor := v_auth_user_id;

  v_id := gen_random_uuid();
  INSERT INTO payments (id, customer_id, amount, method, notes, created_at)
  VALUES (v_id, (payload->>'customerId')::uuid, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', now());
  UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - (payload->>'amount')::numeric),
    total_paid = total_paid + (payload->>'amount')::numeric, updated_at = now()
  WHERE id = (payload->>'customerId')::uuid RETURNING outstanding_balance INTO v_balance;
  RETURN jsonb_build_object('id', v_id, 'balanceAfter', COALESCE(v_balance,0));
END;
$$;

GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
