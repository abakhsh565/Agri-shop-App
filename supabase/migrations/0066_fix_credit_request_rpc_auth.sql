-- Migration 0066: Fix credit request RPCs to work with PIN-based auth
-- DROP old functions first to allow re-creation with new body.

-- ── Fix create_credit_limit_request ──────────────────────────
DROP FUNCTION IF EXISTS create_credit_limit_request(jsonb);

CREATE OR REPLACE FUNCTION create_credit_limit_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO credit_limit_requests (
    customer_id, customer_name, requested_by, current_limit, requested_limit, status, reason
  ) VALUES (
    (payload->>'customer_id')::uuid,
    payload->>'customer_name',
    payload->>'requested_by',
    (payload->>'current_limit')::numeric,
    (payload->>'requested_limit')::numeric,
    'pending',
    COALESCE(payload->>'reason', '')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$$;

GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_credit_limit_request(jsonb) TO authenticated;

-- ── Fix approve_credit_limit_request ─────────────────────────
DROP FUNCTION IF EXISTS approve_credit_limit_request(uuid, text);

CREATE OR REPLACE FUNCTION approve_credit_limit_request(p_request_id UUID, p_reviewed_by TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';

  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now()
  WHERE id = p_request_id;

  -- Update customer credit limit
  UPDATE customers
  SET credit_limit = req.requested_limit, updated_at = now()
  WHERE id = req.customer_id;

  RETURN jsonb_build_object('status', 'approved', 'customer_id', req.customer_id);
END;
$$;

GRANT EXECUTE ON FUNCTION approve_credit_limit_request(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION approve_credit_limit_request(UUID, TEXT) TO authenticated;

-- ── Fix reject_credit_limit_request ──────────────────────────
DROP FUNCTION IF EXISTS reject_credit_limit_request(uuid, text, text);

CREATE OR REPLACE FUNCTION reject_credit_limit_request(p_request_id UUID, p_reviewed_by TEXT, p_rejection_reason TEXT DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';

  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), rejection_reason = p_rejection_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', 'rejected');
END;
$$;

GRANT EXECUTE ON FUNCTION reject_credit_limit_request(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION reject_credit_limit_request(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
