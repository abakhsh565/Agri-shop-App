-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0131: The employee membership role is derived, never supplied
-- ═══════════════════════════════════════════════════════════════════════════════
-- PROBLEM
--   create_employee (0129) took the membership role from the payload:
--       v_role := COALESCE(NULLIF(payload->>'membershipRole','')::membership_role,
--                          'employee');
--   and the Add Employee screen computed that value from the SELECTED ROLE'S
--   DISPLAY NAME:
--       setRole(r.name.toLowerCase().includes("admin") ? "admin" : "employee")
--
--   Both users.role and memberships.role are AUTHORIZATION inputs, not labels:
--     * app_has_permission() returns true immediately for membership_role
--       'owner' (0106), and
--     * RLS on roles / role_permissions grants INSERT, UPDATE and DELETE to any
--       user whose users.role = 'admin' (0106:114-141, 0107:108-147).
--
--   So the chain "role display name contains 'admin'" → users.role='admin' →
--   write access to the tenant's whole RBAC model existed, reachable entirely
--   from the UI: an owner naming a custom role "Branch Admin" (or "Admin
--   Assistant", "Administrator") handed that employee the ability to rewrite
--   roles and permissions via direct PostgREST, bypassing the permission model.
--
-- WHY IT WAS INVISIBLE
--   The four system roles are "Sales Employee", "Sales Manager", "Store Manager"
--   and "Inventory Clerk" (0107:181-214). Not one contains "admin", so the
--   heuristic always produced 'employee' in practice and every test passed. It
--   only misfired on a name an owner had to invent — which is exactly the case
--   no fixture covered.
--
-- FIX
--   Derive it here, where the tenant and the caller are already established.
--   create_employee adds employees: they are never owners (the owner is
--   is_original_owner), so the membership role is always 'employee'. The payload
--   field is now ignored, and 'owner' is still refused loudly rather than
--   silently downgraded so a caller cannot believe it did something it did not.
--
-- NOT RETROACTIVE
--   Existing rows are untouched. Every employee created through the system roles
--   already holds 'employee', so this changes nothing for current data; it only
--   removes the ability to influence an authorization enum from the client.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_phone text;
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid; v_scope uuid[]; v_num int;
  -- Not from the payload: an employee is never an owner, and this value is read
  -- by RLS policies and app_has_permission().
  v_role membership_role := 'employee'::membership_role;
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
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,'branch_scope',v_scope,'invited',true));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole',v_role,'membershipStatus','pending');
END; $$;
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee(jsonb) FROM PUBLIC, anon;

-- ────────────────────────────────────────────────────────────────
-- 2. update_employee_access can no longer be used to hand out ownership
-- ────────────────────────────────────────────────────────────────
-- Same defect, one step further on. 0108:227 read the membership role from the
-- payload of the access editor:
--     IF payload ? 'membershipRole' THEN v_role := (payload->>'membershipRole')::membership_role; END IF;
--     UPDATE memberships SET role = COALESCE(v_role, role) ...
--     IF v_role IS NOT NULL THEN UPDATE users SET role = CASE WHEN v_role IN ('owner','admin') THEN 'admin'::user_role ...
-- so a single direct RPC call with membershipRole = 'owner' promoted an employee
-- to OWNER — and app_has_permission() returns true for membership_role 'owner'
-- before consulting a single permission (0106:172), while users.role = 'admin'
-- grants RLS write access to roles and role_permissions. The UI never sent the
-- field, which is why no screen ever exposed it; nothing stopped a manual call.
--
-- Employee access is what this function edits: the role template, the employee's
-- overrides and their branch scope. Ownership is not an access setting — it comes
-- from users.is_original_owner — so the field is simply not read any more.

-- Everything below is 0108 byte-for-byte except the two marked lines: the
-- membership role is refused rather than applied, and users.role is no longer
-- rewritten from it.
CREATE OR REPLACE FUNCTION update_employee_access(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_emp uuid := (payload->>'employeeId')::uuid; v_role_id uuid; v_code text; v_grant boolean; v_perm uuid; v_scope uuid[];
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=v_emp AND shop_id=v_tenant AND NOT is_original_owner) THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  -- CHANGED (was: IF payload ? 'membershipRole' THEN v_role := (payload->>'membershipRole')::membership_role; END IF;)
  -- An employee's membership role is not an access setting: owner access comes
  -- from users.is_original_owner and is bypassed by every permission check.
  IF COALESCE(payload->>'membershipRole','') NOT IN ('', 'employee') THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF payload ? 'roleId' AND NULLIF(payload->>'roleId','') IS NOT NULL THEN
    SELECT id INTO v_role_id FROM roles WHERE id=(payload->>'roleId')::uuid AND tenant_id=v_tenant;
    IF v_role_id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  END IF;
  UPDATE memberships SET role_id=COALESCE(v_role_id,role_id), updated_at=now()
    WHERE user_id=v_emp AND tenant_id=v_tenant;
  -- CHANGED (removed: IF v_role IS NOT NULL THEN UPDATE users SET role=... 'admin' ...)
  IF payload ? 'branchScope' THEN
    IF payload->'branchScope' IS NULL OR payload->'branchScope'='null'::jsonb THEN v_scope:=NULL;
    ELSE SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    END IF;
    IF v_scope IS NOT NULL AND EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
    UPDATE memberships SET branch_scope=v_scope,updated_at=now() WHERE user_id=v_emp AND tenant_id=v_tenant;
  END IF;
  IF payload->>'resetOverrides'='true' THEN DELETE FROM user_permissions WHERE user_id=v_emp;
  ELSIF payload ? 'overrides' THEN
    DELETE FROM user_permissions WHERE user_id=v_emp AND is_override=true;
    FOR v_code,v_grant IN SELECT key,(value)::boolean FROM jsonb_each_text(payload->'overrides') LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO user_permissions(user_id,permission_id,granted_by,is_override,is_granted) VALUES(v_emp,v_perm,v_actor,true,v_grant); END IF;
    END LOOP;
  ELSIF payload ? 'permissions' THEN
    -- Legacy callers are treated as explicit grants, never role defaults.
    DELETE FROM user_permissions WHERE user_id=v_emp AND is_override=true;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO user_permissions(user_id,permission_id,granted_by,is_override,is_granted) VALUES(v_emp,v_perm,v_actor,true,true); END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_access_updated','user',v_emp,payload);
  RETURN jsonb_build_object('id',v_emp,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION public.update_employee_access(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_employee_access(jsonb) FROM PUBLIC, anon;
