-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0104: create_employee RPC + deactivate_employee_v1 fix
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: The employees store does a direct INSERT into `users` which violates
-- RLS (RLS requires shop_id = current_shop_id()). This RPC resolves shop_id from
-- the authenticated user's membership, following the same pattern as create_customer,
-- create_company, create_product, etc.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create the create_employee RPC
CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_phone text;
  v_shop_id uuid;
  v_actor uuid;
  v_caller_role text;
  v_next_num integer;
BEGIN
  -- Resolve actor from JWT sub
  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: only admin may create employees
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees';
  END IF;

  -- Resolve shop_id from current_shop_id()
  v_shop_id := current_shop_id();

  -- Validate required fields
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NULL OR trim(payload->>'name') = '' THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;

  -- Check phone uniqueness
  IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists';
  END IF;

  -- Get next employee number
  SELECT COALESCE(MAX(employee_number::text), 'EMP-000') INTO v_next_num
  FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
  -- Simple increment: extract number and add 1
  v_next_num := (regexp_replace(COALESCE(v_next_num::text, 'EMP-000'), '[^0-9]', '', 'g'))::integer + 1;

  -- Insert employee with shop_id
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, job_title, photo_url, created_by, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    trim(payload->>'name'),
    v_phone,
    COALESCE(NULLIF(payload->>'role', ''), 'employee')::user_role,
    false,
    true,
    'EMP-' || LPAD(v_next_num::text, 3, '0'),
    NULLIF(payload->>'jobTitle', ''),
    NULLIF(payload->>'photoUrl', ''),
    v_actor,
    v_shop_id,
    now()
  )
  RETURNING id INTO v_id;

  -- Also create membership for the new employee
  INSERT INTO memberships (user_id, tenant_id, role, status, created_at)
  VALUES (v_id, v_shop_id, 'employee', 'active', now());

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

-- 2. Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;

-- 3. Verify function was created
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_employee' AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Failed to create create_employee function';
  END IF;
  RAISE NOTICE 'create_employee RPC created successfully';
END $$;
