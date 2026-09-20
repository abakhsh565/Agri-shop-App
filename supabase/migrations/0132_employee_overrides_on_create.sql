-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0132: an employee's exceptions are written with the employee
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM
--   create_employee accepted `permissions` (a legacy field) and ignored it, so an
--   owner who wanted an employee to differ from their role had to create the
--   employee first and then open their page to change one thing — two calls for
--   one decision, and a half-configured employee if the second call failed.
--
-- MODEL (0108, unchanged)
--   role_permissions = a role's reusable defaults.
--   user_permissions(is_override) = this employee's exceptions: is_granted true
--   adds access, false denies role-derived access.
--   effective = (role defaults ∪ granted) ∖ denied.
--
-- WHAT THIS DOES
--   Accepts the same `overrides` object update_employee_access already takes
--   ({"<permission code>": true|false}) and writes those rows in the same
--   transaction as the employee. The vocabulary is deliberately identical in both
--   functions so the owner-facing screens can hand the same object to either.
--
-- AUTHORIZATION IS UNCHANGED
--   The function still begins with authorize_business_action('employees.manage'),
--   the membership is still created 'pending' (0129), and an unknown permission
--   code is skipped rather than inserted — user_permissions.permission_id is a
--   foreign key, so a bad code must never be able to fail the whole creation.
--   Nothing here can grant access the role + exceptions do not express, and a
--   pending employee is still denied by every authorization path.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_phone text;
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid; v_scope uuid[]; v_num int;
  -- Not from the payload: an employee is never an owner, and this value is read
  -- by RLS policies and app_has_permission().
  v_role membership_role := 'employee'::membership_role;
  v_code text; v_grant boolean; v_perm uuid; v_overrides int := 0;
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name',''))='' OR NULLIF(payload->>'phone','') IS NULL THEN RAISE EXCEPTION 'VALIDATION: Name and phone are required'; END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM users WHERE phone=v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF COALESCE(payload->>'membershipRole','') = 'owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM roles WHERE id=v_role_id AND tenant_id=v_tenant) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload->'branchScope' IS NOT NULL AND jsonb_typeof(payload->'branchScope')='array' THEN
    SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    IF EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
  END IF;
  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1 INTO v_num FROM users WHERE shop_id=v_tenant;
  INSERT INTO users(id,name,phone,role,is_original_owner,is_active,employee_number,job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,'employee'::user_role,false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),v_actor,v_tenant,now()) RETURNING id INTO v_id;
  -- INVITE, not access. 'pending' is denied by every authorization path (they all
  -- require m.status = 'active'), so an un-onboarded invitee can hold a session
  -- but cannot read or mutate any tenant-owned row.
  INSERT INTO memberships(user_id,tenant_id,role,status,branch_scope,role_id)
  VALUES(v_id,v_tenant,v_role,'pending',v_scope,v_role_id)
  ON CONFLICT (user_id,tenant_id) DO UPDATE
    SET role=EXCLUDED.role, status='pending', branch_scope=EXCLUDED.branch_scope,
        role_id=EXCLUDED.role_id, updated_at=now();
  -- The employee's exceptions, if the owner set any while inviting them.
  IF payload->'overrides' IS NOT NULL AND jsonb_typeof(payload->'overrides')='object' THEN
    FOR v_code,v_grant IN SELECT key,(value)::boolean FROM jsonb_each_text(payload->'overrides') LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO user_permissions(user_id,permission_id,granted_by,is_override,is_granted)
        VALUES(v_id,v_perm,v_actor,true,v_grant);
        v_overrides := v_overrides + 1;
      END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,'branch_scope',v_scope,'invited',true,'overrides',v_overrides));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole',v_role,'membershipStatus','pending','overrides',v_overrides);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee(jsonb) FROM PUBLIC, anon;
