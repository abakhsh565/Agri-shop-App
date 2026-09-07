-- Migration 0043: Login Lookup Function
-- Creates a SECURITY DEFINER function that looks up a user by phone number
-- for the login flow. Bypasses RLS on the users table safely.
-- Returns all user fields except pin_hash.

CREATE OR REPLACE FUNCTION lookup_user_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'phone', u.phone,
    'role', u.role,
    'is_original_owner', u.is_original_owner,
    'is_active', u.is_active,
    'employee_number', u.employee_number,
    'job_title', u.job_title,
    'first_login_at', u.first_login_at,
    'last_login_at', u.last_login_at,
    'deactivated_at', u.deactivated_at,
    'deactivated_by', u.deactivated_by,
    'created_by', u.created_by,
    'created_at', u.created_at
  ) INTO v_user
  FROM users u
  WHERE u.phone = p_phone OR u.phone = '+' || p_phone
  LIMIT 1;

  RETURN v_user;
END;
$$;

-- Allow anyone (anon + authenticated) to call this function
GRANT EXECUTE ON FUNCTION lookup_user_by_phone(text) TO anon;
GRANT EXECUTE ON FUNCTION lookup_user_by_phone(text) TO authenticated;
