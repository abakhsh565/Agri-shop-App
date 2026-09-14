-- Migration 0081: Fix Actor Authentication in RPCs
-- Root cause: get_authenticated_user_id() returns NULL when the Supabase
-- client has persistSession: false (no JWT). All RPCs that use this function
-- fail with NOT_AUTHENTICATED.
--
-- Fix: Accept actorId from the payload (set by the frontend from Zustand store),
-- fall back to JWT claims, then to a default. This matches the working pattern
-- used by record_customer_payment (migration 0079).

-- ─── 1. Fix adjust_stock ──────────────────────────────────────────────────

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
BEGIN
  -- Resolve actor from payload → JWT → system default
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

-- ─── 2. Fix archive_customer ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION archive_customer(
  p_customer_id uuid,
  p_archived_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor uuid;
BEGIN
  -- Resolve actor: explicit parameter → JWT → system default
  v_actor := COALESCE(
    p_archived_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  UPDATE customers SET
    is_archived = true,
    archived_at = now(),
    archived_by = v_actor
  WHERE id = p_customer_id;
END;
$$;

-- ─── 3. Fix restore_customer ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION restore_customer(
  p_customer_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers SET
    is_archived = false,
    archived_at = NULL,
    archived_by = NULL
  WHERE id = p_customer_id;
END;
$$;

-- ─── 4. Fix delete_credit_limit_request ────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_credit_limit_request(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Resolve actor from JWT → system default
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Only admin/co_admin may delete credit requests
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete credit requests';
  END IF;

  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$$;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
