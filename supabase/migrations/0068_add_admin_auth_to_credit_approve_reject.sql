-- Migration: Add admin authorization to credit request approve/reject
-- Security fix: prevent employees from approving their own credit requests
-- Applied to QA database: 2026-09-12

-- Fix approve_credit_limit_request: add admin authorization check
CREATE OR REPLACE FUNCTION public.approve_credit_limit_request(
  p_request_id uuid,
  p_reviewed_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Get authenticated user
  v_actor := get_authenticated_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  -- Authorization: only admin/co_admin may approve credit requests
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can approve credit requests';
  END IF;

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  -- Update request status
  UPDATE credit_limit_requests
  SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now()
  WHERE id = p_request_id;

  -- Update customer credit limit
  UPDATE customers
  SET credit_limit = req.requested_limit
  WHERE id = req.customer_id;

  RETURN jsonb_build_object('status', 'approved');
END;
$$;

-- Fix reject_credit_limit_request: add admin authorization check
CREATE OR REPLACE FUNCTION public.reject_credit_limit_request(
  p_request_id uuid,
  p_reviewed_by text,
  p_rejection_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req RECORD;
  v_actor uuid;
  v_caller_role text;
BEGIN
  -- Get authenticated user
  v_actor := get_authenticated_user_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

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
  SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), rejection_reason = p_rejection_reason
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', 'rejected');
END;
$$;
