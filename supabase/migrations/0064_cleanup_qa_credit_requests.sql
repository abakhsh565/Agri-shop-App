-- ============================================================
-- Migration 0064: Cleanup QA credit_limit_requests
--
-- Adds a SECURITY DEFINER RPC to delete credit_limit_requests.
-- Follows the same pattern as all other write RPCs in the app.
-- Used for QA cleanup and admin record management.
-- ============================================================

CREATE OR REPLACE FUNCTION delete_credit_limit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_credit_limit_request(UUID) TO anon;
GRANT EXECUTE ON FUNCTION delete_credit_limit_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
