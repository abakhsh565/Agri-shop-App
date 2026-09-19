-- 0108: authoritative access resolution and business-area administration
-- Additive and backward-compatible. The role graph is the source of defaults;
-- user_permissions stores only employee-specific decisions.

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS is_granted boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_user_permissions_override
  ON user_permissions(user_id, is_override, is_granted);

-- Backfill legacy memberships onto the seeded templates where unambiguous.
UPDATE memberships m
SET role_id = r.id
FROM roles r
WHERE m.role_id IS NULL
  AND r.tenant_id = m.tenant_id
  AND r.is_system = true
  AND r.name = CASE
    WHEN m.role = 'employee' THEN 'Sales Employee'
    WHEN m.role = 'admin' THEN 'Store Manager'
    ELSE r.name
  END;

-- One source of truth for effective access. A caller may resolve only itself,
-- or an owner/admin may inspect an employee in the same active tenant.
CREATE OR REPLACE FUNCTION get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, app_current_user_id());
  v_caller uuid := app_current_user_id();
  v_tenant uuid;
  v_role membership_role;
  v_role_id uuid;
  v_result text[];
BEGIN
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_caller IS DISTINCT FROM v_user_id AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;

  SELECT m.tenant_id, m.role, m.role_id
    INTO v_tenant, v_role, v_role_id
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_role = 'owner' THEN
    SELECT array_agg(p.code ORDER BY p.code) INTO v_result FROM permissions p;
    RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
  END IF;

  SELECT array_agg(code ORDER BY code) INTO v_result
  FROM (
    SELECT p.code
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id
    UNION
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = true
    EXCEPT
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = false
  ) effective;

  RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
END;
$$;
GRANT EXECUTE ON FUNCTION get_effective_permissions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION has_effective_permission(p_code varchar, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN get_effective_permissions(p_user_id) ? p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION has_effective_permission(varchar, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION has_permission(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT has_effective_permission(p_code, NULL) $$;
GRANT EXECUTE ON FUNCTION has_permission(varchar) TO authenticated;

CREATE OR REPLACE FUNCTION get_my_permissions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT get_effective_permissions(NULL) $$;
GRANT EXECUTE ON FUNCTION get_my_permissions() TO authenticated;

-- Shared authorization guard for SECURITY DEFINER business RPCs. A NULL branch
-- means the operation is tenant-scoped; when a branch is supplied it must be in
-- the active membership scope (NULL scope means all branches).
CREATE OR REPLACE FUNCTION authorize_business_action(
  p_permission varchar,
  p_tenant_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_tenant uuid;
  v_scope uuid[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT m.tenant_id, m.branch_scope INTO v_tenant, v_scope
  FROM memberships m WHERE m.user_id = v_actor AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;
  IF v_tenant IS NULL OR (p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT has_effective_permission(p_permission, v_actor) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission %', p_permission;
  END IF;
  IF p_branch_id IS NOT NULL AND v_scope IS NOT NULL AND NOT (p_branch_id = ANY(v_scope)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  RETURN v_tenant;
END;
$$;
GRANT EXECUTE ON FUNCTION authorize_business_action(varchar, uuid, uuid) TO authenticated;

-- Business-area administration. Areas are tenant-owned labels; technical
-- permission codes remain internal and are grouped by permissions.module.
CREATE OR REPLACE FUNCTION create_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  INSERT INTO business_areas(tenant_id, code, name_en, name_ur, sort_order)
  VALUES(v_tenant, lower(regexp_replace(trim(payload->>'code'), '[^a-z0-9_]+', '_', 'g')),
    trim(payload->>'nameEn'), COALESCE(NULLIF(trim(payload->>'nameUr'), ''), trim(payload->>'nameEn')),
    COALESCE((payload->>'sortOrder')::int, 0)) RETURNING id INTO v_id;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor, 'business_area_created', 'business_area', v_id, payload);
  RETURN jsonb_build_object('id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION create_business_area(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION update_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'id')::uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  UPDATE business_areas SET name_en=COALESCE(NULLIF(payload->>'nameEn',''),name_en),
    name_ur=COALESCE(NULLIF(payload->>'nameUr',''),name_ur),
    sort_order=COALESCE((payload->>'sortOrder')::int,sort_order),
    is_active=COALESCE((payload->>'isActive')::boolean,is_active)
  WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor,'business_area_updated','business_area',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION update_business_area(jsonb) TO authenticated;

-- Role management is tenant-scoped and uses the same authorization guard.
CREATE OR REPLACE FUNCTION create_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_code text; v_perm uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  INSERT INTO roles(tenant_id,name,description) VALUES(v_tenant,trim(payload->>'name'),NULLIF(payload->>'description','')) RETURNING id INTO v_id;
  FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
    SELECT id INTO v_perm FROM permissions WHERE code=v_code;
    IF v_perm IS NOT NULL THEN INSERT INTO role_permissions(role_id,permission_id) VALUES(v_id,v_perm) ON CONFLICT DO NOTHING; END IF;
  END LOOP;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'role_created','role',v_id,payload);
  RETURN jsonb_build_object('id',v_id);
END; $$;
GRANT EXECUTE ON FUNCTION create_role(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION update_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'roleId')::uuid; v_code text; v_perm uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  IF EXISTS(SELECT 1 FROM roles WHERE id=v_id AND is_system) THEN RAISE EXCEPTION 'SYSTEM_ROLE_READ_ONLY'; END IF;
  UPDATE roles SET name=COALESCE(NULLIF(payload->>'name',''),name), description=COALESCE(payload->>'description',description), updated_at=now()
    WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload ? 'permissions' THEN
    DELETE FROM role_permissions WHERE role_id=v_id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO role_permissions(role_id,permission_id) VALUES(v_id,v_perm) ON CONFLICT DO NOTHING; END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'role_updated','role',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION update_role(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION delete_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_id uuid := (payload->>'roleId')::uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  IF EXISTS(SELECT 1 FROM roles WHERE id=v_id AND is_system) THEN RAISE EXCEPTION 'SYSTEM_ROLE_READ_ONLY'; END IF;
  IF EXISTS(SELECT 1 FROM memberships WHERE role_id=v_id AND status='active') THEN RAISE EXCEPTION 'ROLE_IN_USE'; END IF;
  DELETE FROM roles WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  RETURN jsonb_build_object('id',v_id,'deleted',true);
END; $$;
GRANT EXECUTE ON FUNCTION delete_role(jsonb) TO authenticated;

-- Replace employee access update: role_id is retained and overrides are explicit.
CREATE OR REPLACE FUNCTION update_employee_access(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_emp uuid := (payload->>'employeeId')::uuid; v_role membership_role; v_role_id uuid; v_code text; v_grant boolean; v_perm uuid; v_scope uuid[];
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=v_emp AND shop_id=v_tenant AND NOT is_original_owner) THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload ? 'membershipRole' THEN v_role := (payload->>'membershipRole')::membership_role; END IF;
  IF payload ? 'roleId' AND NULLIF(payload->>'roleId','') IS NOT NULL THEN
    SELECT id INTO v_role_id FROM roles WHERE id=(payload->>'roleId')::uuid AND tenant_id=v_tenant;
    IF v_role_id IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  END IF;
  UPDATE memberships SET role=COALESCE(v_role,role), role_id=COALESCE(v_role_id,role_id), updated_at=now()
    WHERE user_id=v_emp AND tenant_id=v_tenant;
  IF v_role IS NOT NULL THEN UPDATE users SET role=CASE WHEN v_role IN('owner','admin') THEN 'admin'::user_role ELSE 'employee'::user_role END WHERE id=v_emp; END IF;
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
GRANT EXECUTE ON FUNCTION update_employee_access(jsonb) TO authenticated;

-- Employee creation links to a reusable role. It never copies role defaults into
-- user_permissions, so later role edits propagate automatically.
CREATE OR REPLACE FUNCTION create_employee(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_phone text;
  v_role membership_role := COALESCE(NULLIF(payload->>'membershipRole','')::membership_role,'employee');
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid; v_scope uuid[]; v_num int;
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name',''))='' OR NULLIF(payload->>'phone','') IS NULL THEN RAISE EXCEPTION 'VALIDATION: Name and phone are required'; END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM users WHERE phone=v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM roles WHERE id=v_role_id AND tenant_id=v_tenant) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload->'branchScope' IS NOT NULL AND jsonb_typeof(payload->'branchScope')='array' THEN
    SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    IF EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
  END IF;
  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1 INTO v_num FROM users WHERE shop_id=v_tenant;
  INSERT INTO users(id,name,phone,role,is_original_owner,is_active,employee_number,job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,CASE WHEN v_role='admin' THEN 'admin'::user_role ELSE 'employee'::user_role END,false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),v_actor,v_tenant,now()) RETURNING id INTO v_id;
  INSERT INTO memberships(user_id,tenant_id,role,status,branch_scope,role_id) VALUES(v_id,v_tenant,v_role,'active',v_scope,v_role_id);
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,'branch_scope',v_scope));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole',v_role);
END; $$;
GRANT EXECUTE ON FUNCTION create_employee(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION get_employee_access(p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_role_id uuid; v_role text; v_scope uuid[]; v_effective jsonb; v_defaults jsonb; v_overrides jsonb;
BEGIN
  v_tenant := authorize_business_action('employees.view');
  SELECT m.role_id, m.role::text, m.branch_scope INTO v_role_id, v_role, v_scope
  FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.user_id=p_employee_id AND m.tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code),'[]'::jsonb) INTO v_defaults
  FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=v_role_id;
  SELECT COALESCE(jsonb_object_agg(p.code, up.is_granted),'{}'::jsonb) INTO v_overrides
  FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
  WHERE up.user_id=p_employee_id AND up.is_override=true;
  v_effective := get_effective_permissions(p_employee_id);
  RETURN jsonb_build_object('roleId',v_role_id,'membershipRole',v_role,'branchScope',v_scope,'defaults',v_defaults,'overrides',v_overrides,'effective',v_effective);
END; $$;
GRANT EXECUTE ON FUNCTION get_employee_access(uuid) TO authenticated;

-- Ensure role defaults cannot be edited through direct table writes.
REVOKE INSERT,UPDATE,DELETE ON roles,role_permissions,business_areas FROM authenticated;
GRANT SELECT ON roles,role_permissions,business_areas TO authenticated;

COMMENT ON TABLE role_permissions IS 'Reusable role defaults. Employee exceptions belong in user_permissions with is_override/is_granted.';
COMMENT ON COLUMN user_permissions.is_granted IS 'Explicit employee override: true adds access, false denies role-derived access.';
