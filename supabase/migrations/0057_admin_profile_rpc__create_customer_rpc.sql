-- MERGED: two files shared migration version 0057, which makes a
-- fresh `supabase db push` fail with a duplicate key on
-- supabase_migrations.schema_migrations. Both bodies follow, in the order the
-- runner would have applied them:
--   1. 0057_admin_profile_rpc.sql
--   2. 0057_create_customer_rpc.sql

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

-- ============================================================
-- Migration 0057: Create Customer RPC — Secure Customer Creation
-- ============================================================

CREATE OR REPLACE FUNCTION create_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  -- Validate phone uniqueness
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  -- Insert customer
  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    NULLIF(payload->>'created_by', '')::uuid,
    now(),
    now()
  ) RETURNING id INTO v_id;

  -- Insert crops if provided
  IF payload ? 'crops' THEN
    INSERT INTO customer_crops (customer_id, crop_name)
    SELECT v_id, crop.value
    FROM jsonb_array_elements_text(payload->'crops') AS crop;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_customer(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_customer(jsonb) TO authenticated;

-- Also create RPCs for other customer mutations that use direct table access

-- Update customer image
CREATE OR REPLACE FUNCTION update_customer_image(p_customer_id uuid, p_image_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers SET image_url = p_image_url, updated_at = now() WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_image(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION update_customer_image(uuid, text) TO authenticated;

-- Update customer due date
CREATE OR REPLACE FUNCTION update_customer_due_date(p_customer_id uuid, p_due_date text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers SET due_date = NULLIF(p_due_date, '')::date, updated_at = now() WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_due_date(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION update_customer_due_date(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
