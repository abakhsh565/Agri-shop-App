-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0105: Employee lifecycle auth fix
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE: deactivate_employee_v1() only sets users.is_active=false but
-- never updates memberships.status. This means:
--   - A deactivated employee's membership remains 'active'
--   - The authorization chain (User → Membership → Tenant) still grants access
--   - Deactivated employees can potentially still perform authorized actions
--
-- FIX: 
-- 1. deactivate_employee_v1: update users.is_active + memberships.status='suspended'
-- 2. activate_employee_v1: update users.is_active + memberships.status='active'
-- 3. Both check tenant isolation (target must belong to caller's tenant)
-- 4. create_employee: already correct (migration 0104), kept as-is
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Fix deactivate_employee_v1 — suspend membership + tenant isolation
CREATE OR REPLACE FUNCTION deactivate_employee_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_emp_id uuid;
  v_emp record;
  v_caller_role text;
  v_shop_id uuid;
BEGIN
  -- Resolve actor from JWT
  v_actor_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
  END IF;

  -- Authorization: only admin/owner may deactivate employees
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can deactivate employees';
  END IF;

  -- Tenant isolation: resolve caller's tenant
  v_shop_id := current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context';
  END IF;

  -- Accept both camelCase and snake_case
  v_emp_id := COALESCE(
    NULLIF((payload->>'employeeId')::text, '')::uuid,
    NULLIF((payload->>'employee_id')::text, '')::uuid
  );
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Employee ID is required';
  END IF;

  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;

  -- Tenant isolation: target employee must belong to caller's tenant
  IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization';
  END IF;

  -- Cannot deactivate the owner
  IF v_emp.is_original_owner THEN
    RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER: Cannot deactivate the shop owner';
  END IF;

  -- Already deactivated?
  IF v_emp.is_active = false THEN
    RAISE EXCEPTION 'ALREADY_DEACTIVATED: Employee is already deactivated';
  END IF;

  -- Atomic deactivation: user + membership
  UPDATE users
  SET is_active = false,
      deactivated_at = now(),
      deactivated_by = v_actor_id
  WHERE id = v_emp_id;

  -- Suspend the membership (critical: without this, authorization path remains active)
  UPDATE memberships
  SET status = 'suspended',
      updated_at = now()
  WHERE user_id = v_emp_id
    AND tenant_id = v_shop_id;

  -- Audit log
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'employee_deactivated', 'user', v_emp_id,
    jsonb_build_object('name', v_emp.name, 'shop_id', v_shop_id));

  RETURN jsonb_build_object('id', v_emp_id, 'isActive', false, 'membershipStatus', 'suspended');
END;
$$;

GRANT EXECUTE ON FUNCTION deactivate_employee_v1(jsonb) TO authenticated;


-- 2. Create activate_employee_v1 — restore membership + tenant isolation
CREATE OR REPLACE FUNCTION activate_employee_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_emp_id uuid;
  v_emp record;
  v_caller_role text;
  v_shop_id uuid;
BEGIN
  -- Resolve actor from JWT
  v_actor_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
  END IF;

  -- Authorization: only admin/owner may activate employees
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor_id;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can activate employees';
  END IF;

  -- Tenant isolation
  v_shop_id := current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context';
  END IF;

  -- Accept both camelCase and snake_case
  v_emp_id := COALESCE(
    NULLIF((payload->>'employeeId')::text, '')::uuid,
    NULLIF((payload->>'employee_id')::text, '')::uuid
  );
  IF v_emp_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Employee ID is required';
  END IF;

  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;

  -- Tenant isolation
  IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization';
  END IF;

  -- Already active?
  IF v_emp.is_active = true THEN
    RAISE EXCEPTION 'ALREADY_ACTIVE: Employee is already active';
  END IF;

  -- Atomic reactivation: user + membership
  UPDATE users
  SET is_active = true,
      deactivated_at = NULL,
      deactivated_by = NULL
  WHERE id = v_emp_id;

  -- Restore membership to active
  UPDATE memberships
  SET status = 'active',
      updated_at = now()
  WHERE user_id = v_emp_id
    AND tenant_id = v_shop_id;

  -- If no membership exists (edge case), create one
  IF NOT EXISTS (
    SELECT 1 FROM memberships WHERE user_id = v_emp_id AND tenant_id = v_shop_id
  ) THEN
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES (v_emp_id, v_shop_id, 'employee', 'active');
  END IF;

  -- Audit log
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'employee_activated', 'user', v_emp_id,
    jsonb_build_object('name', v_emp.name, 'shop_id', v_shop_id));

  RETURN jsonb_build_object('id', v_emp_id, 'isActive', true, 'membershipStatus', 'active');
END;
$$;

GRANT EXECUTE ON FUNCTION activate_employee_v1(jsonb) TO authenticated;


-- 3. Fix create_employee — add tenant isolation check
-- (Migration 0104's create_employee uses current_shop_id() which is correct,
--  but let's also verify the caller's shop_id matches)
CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$  DECLARE
    v_id uuid;
    v_phone text;
    v_shop_id uuid;
    v_actor uuid;
    v_caller_role text;
    v_max_num_text text;
    v_next_num integer;
BEGIN
  -- Resolve actor from JWT sub
  v_actor := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session';
  END IF;

  -- Authorization: only admin may create employees
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees';
  END IF;

  -- Resolve shop_id from membership (tenant isolation built-in)
  v_shop_id := current_shop_id();
  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context — are you logged in?';
  END IF;

  -- Validate required fields
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NULL OR trim(payload->>'name') = '' THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;

  -- Check phone uniqueness
  IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists';
  END IF;

  -- Get next employee number (safe: store as text, extract digits separately)
  SELECT MAX(employee_number) INTO v_max_num_text
  FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
  IF v_max_num_text IS NULL THEN
    v_next_num := 1;
  ELSE
    v_next_num := COALESCE((regexp_replace(v_max_num_text, '[^0-9]', '', 'g'))::integer, 0) + 1;
  END IF;

  -- Insert employee with shop_id from membership
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

  -- Create membership for the new employee
  INSERT INTO memberships (user_id, tenant_id, role, status)
  VALUES (v_id, v_shop_id, 'employee', 'active');

  RETURN jsonb_build_object('id', v_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;


-- 4. Verify all three functions exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'deactivate_employee_v1') THEN
    RAISE EXCEPTION 'deactivate_employee_v1 not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'activate_employee_v1') THEN
    RAISE EXCEPTION 'activate_employee_v1 not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_employee') THEN
    RAISE EXCEPTION 'create_employee not created';
  END IF;
  RAISE NOTICE 'Employee lifecycle RPCs verified: create, deactivate, activate';
END $$;
