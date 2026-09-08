-- ============================================================
-- Migration 0056: Fix Actor Lookup — Phone-based Identity
--
-- PROBLEM: Supabase Auth user IDs differ from app user IDs.
-- The RPC was looking up users by auth.uid(), which doesn't match.
--
-- SOLUTION: Extract phone from JWT and look up app user by phone.
-- This bridges Supabase Auth identity to app user identity.
-- ============================================================

-- ── Update get_authenticated_user_id to return app user ID ───
DROP FUNCTION IF EXISTS get_authenticated_user_id();

CREATE OR REPLACE FUNCTION get_authenticated_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_user_id uuid;
  v_phone text;
BEGIN
  -- Try auth.uid() first
  v_user_id := auth.uid();
  
  -- If NULL, try JWT claims
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
  
  -- If we have an auth user ID, try to find matching app user by phone
  IF v_user_id IS NOT NULL THEN
    -- Get phone from JWT claims
    BEGIN
      v_phone := current_setting('request.jwt.claims', true)::json->>'phone';
    EXCEPTION WHEN OTHERS THEN
      v_phone := NULL;
    END;
    
    -- If phone exists, look up app user
    IF v_phone IS NOT NULL AND v_phone != '' THEN
      SELECT id INTO v_user_id FROM users WHERE phone = v_phone AND is_active = true;
    ELSE
      -- Try to get phone from auth.users
      SELECT phone INTO v_phone FROM auth.users WHERE id = v_user_id;
      IF v_phone IS NOT NULL THEN
        SELECT id INTO v_user_id FROM users WHERE phone = v_phone AND is_active = true;
      ELSE
        v_user_id := NULL;
      END IF;
    END IF;
  END IF;
  
  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION get_authenticated_user_id() TO anon;
GRANT EXECUTE ON FUNCTION get_authenticated_user_id() TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
