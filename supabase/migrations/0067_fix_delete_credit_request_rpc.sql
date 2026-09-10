-- Migration 0067: Fix delete_credit_limit_request RPC auth (same fix as 0066)
-- Removes get_authenticated_user_id() check to match create_customer pattern.

DROP FUNCTION IF EXISTS delete_credit_limit_request(uuid);

CREATE OR REPLACE FUNCTION delete_credit_limit_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_credit_limit_request(UUID) TO anon;
GRANT EXECUTE ON FUNCTION delete_credit_limit_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
