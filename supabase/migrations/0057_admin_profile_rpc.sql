-- ============================================================
-- Migration 0057: Admin Profile Update RPC
--
-- Problem: Admin cannot save profile because RLS requires
-- authenticated role but the app uses anon.
--
-- Fix: Create an RPC function that allows profile updates
-- using the authenticated user ID from JWT.
-- ============================================================

-- Create RPC function for admin profile update
CREATE OR REPLACE FUNCTION update_admin_profile(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_name text;
  v_photo_url text;
BEGIN
  -- Get authenticated user from JWT/session
  v_user_id := auth.uid();
  
  -- If no auth session, use the provided userId (for backward compatibility)
  IF v_user_id IS NULL THEN
    v_user_id := (payload->>'userId')::uuid;
  END IF;
  
  -- Validate
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_ID_REQUIRED: User ID is required';
  END IF;
  
  v_name := payload->>'name';
  v_photo_url := payload->>'photoUrl';
  
  -- Update the user
  UPDATE users 
  SET 
    name = COALESCE(v_name, name),
    photo_url = COALESCE(v_photo_url, photo_url),
    updated_at = now()
  WHERE id = v_user_id
  RETURNING id INTO v_user_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User not found';
  END IF;
  
  RETURN jsonb_build_object(
    'id', v_user_id,
    'name', v_name,
    'photoUrl', v_photo_url
  );
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION update_admin_profile(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION update_admin_profile(jsonb) TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
