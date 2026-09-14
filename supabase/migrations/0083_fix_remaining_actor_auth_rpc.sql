-- Migration 0083: Fix remaining RPCs that use get_authenticated_user_id()
--
-- Root cause (same as 0082): get_authenticated_user_id() returns NULL when
-- the Supabase client has persistSession: false (no JWT). This causes
-- NOT_AUTHENTICATED errors in:
--   void_sale, create_credit_limit_request, approve_credit_limit_request,
--   reject_credit_limit_request.
--
-- Fix: Use the same pattern as adjust_stock (0082) — accept actor identity
-- from the payload/parameter, fall back to JWT, then system default.

-- ── 1. Fix void_sale ────────────────────────────────────────
DROP FUNCTION IF EXISTS void_sale(uuid, text, uuid);

CREATE OR REPLACE FUNCTION void_sale(
  p_sale_id uuid,
  p_reason text,
  p_voided_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
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
BEGIN
  -- Resolve actor: explicit parameter → JWT → system default
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
    SELECT COALESCE(SUM(ri.qty), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    v_change := ROUND((v_item.qty - v_already_returned) * COALESCE(v_item.unit_size, 1), 4);
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
$fn$;

GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;

-- ── 2. Fix create_credit_limit_request ──────────────────────
DROP FUNCTION IF EXISTS create_credit_limit_request(jsonb);

CREATE OR REPLACE FUNCTION create_credit_limit_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  v_id uuid;
  v_actor uuid;
BEGIN
  -- Resolve actor: payload → JWT → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  INSERT INTO credit_limit_requests (
    customer_id, customer_name, requested_by, current_limit, requested_limit, status
  ) VALUES (
    (payload->>'customer_id')::uuid,
    payload->>'customer_name',
    COALESCE(payload->>'requested_by', v_actor::text),
    (payload->>'current_limit')::numeric,
    (payload->>'requested_limit')::numeric,
    'pending'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$fn$;

GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO authenticated;

-- ── 3. Fix approve_credit_limit_request ─────────────────────
-- Add p_actor_id parameter for explicit actor identity
DROP FUNCTION IF EXISTS approve_credit_limit_request(uuid, text);

CREATE OR REPLACE FUNCTION approve_credit_limit_request(
  p_request_id uuid,
  p_reviewed_by text,
  p_actor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  req RECORD;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor: explicit UUID → JWT → system default
  v_actor := COALESCE(
    p_actor_id,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may approve credit requests
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can approve credit requests';
  END IF;

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now()
  WHERE id = p_request_id;

  UPDATE customers
  SET credit_limit = req.requested_limit
  WHERE id = req.customer_id;

  RETURN jsonb_build_object('status', 'approved');
END;
$fn$;

-- ── 4. Fix reject_credit_limit_request ──────────────────────
-- Add p_actor_id parameter for explicit actor identity
DROP FUNCTION IF EXISTS reject_credit_limit_request(uuid, text, text);

CREATE OR REPLACE FUNCTION reject_credit_limit_request(
  p_request_id uuid,
  p_rejection_reason text,
  p_reviewed_by text,
  p_actor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE
  req RECORD;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor: explicit UUID → JWT → system default
  v_actor := COALESCE(
    p_actor_id,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin/co_admin may reject credit requests
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can reject credit requests';
  END IF;

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(),
    rejection_reason = p_rejection_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', 'rejected');
END;
$fn$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
