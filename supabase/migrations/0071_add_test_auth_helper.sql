-- 0071: Test helper function for authorization testing
-- This function is SECURITY INVOKER so it runs in the caller's permission context
-- When called via PostgREST with a JWT, it sees the JWT claims set by PostgREST
-- This allows testing app_is_admin() and app_current_user_id() without direct DB access

CREATE OR REPLACE FUNCTION public._test_check_auth()
RETURNS TABLE(user_id uuid, is_admin boolean, phone text)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT 
    app_current_user_id(),
    app_is_admin(),
    current_setting('request.jwt.claims', true)::json->>'phone';
$$;

-- Grant execute to anon and authenticated so PostgREST can call it
GRANT EXECUTE ON FUNCTION public._test_check_auth() TO anon;
GRANT EXECUTE ON FUNCTION public._test_check_auth() TO authenticated;
