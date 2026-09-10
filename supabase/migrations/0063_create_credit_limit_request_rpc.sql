-- ============================================================
-- Migration 0063: Add SECURITY DEFINER insert RPC for
--   credit_limit_requests (same pattern as all other writes)
-- ============================================================

CREATE OR REPLACE FUNCTION create_credit_limit_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_auth_user_id uuid;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  INSERT INTO credit_limit_requests (
    customer_id, customer_name, requested_by, current_limit, requested_limit, status
  ) VALUES (
    (payload->>'customer_id')::uuid,
    payload->>'customer_name',
    payload->>'requested_by',
    (payload->>'current_limit')::numeric,
    (payload->>'requested_limit')::numeric,
    'pending'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$$;

GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
