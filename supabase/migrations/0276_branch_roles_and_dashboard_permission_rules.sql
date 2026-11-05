-- 0276: branch roles at invitation time, and dashboard rules that cannot be bypassed
--
-- WHY
--   The Add Employee flow now lets the owner give a different saved role to each branch.
--   `membership_branch_roles` has existed since 0233, but the invitation writer only knew
--   the single `roleId`, so the owner would have had to invite first and edit later. This
--   extends the existing writer with an optional `branchRoles` object and keeps the same
--   authorization, tenant checks, OTP provisioning and pending-membership lifecycle.
--
--   The same migration closes a dashboard gap: `get_my_dashboards()` returned every widget
--   selected on the role, even when the employee no longer held the permission the widget
--   requires. A widget is now returned only when it is selected AND its required permission
--   is effective. It still does not grant anything; RLS and page guards remain the authority.

-- ── 1. create_employee_core accepts per-branch roles ────────────────────────────
CREATE OR REPLACE FUNCTION public.create_employee_core(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id uuid;
  v_membership uuid;
  v_phone text;
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid;
  v_scope uuid[];
  v_num int;
  v_code text;
  v_grant boolean;
  v_perm uuid;
  v_overrides int := 0;
  v_branch_roles jsonb := payload->'branchRoles';
  v_branch_id uuid;
  v_branch_role uuid;
  v_branch_assignments int := 0;
BEGIN
  v_tenant := public.authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name','')) = '' OR NULLIF(payload->>'phone','') IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM public.users WHERE phone = v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF COALESCE(payload->>'membershipRole','') = 'owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.roles WHERE id = v_role_id AND tenant_id = v_tenant
  ) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  IF NOT (payload ? 'branchScope') THEN
    v_scope := ARRAY[public.current_branch_id()];
  ELSIF jsonb_typeof(payload->'branchScope') = 'array' THEN
    SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO v_scope
      FROM jsonb_array_elements_text(payload->'branchScope') x;
  ELSE RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  IF v_scope IS NULL OR cardinality(v_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(v_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = v_tenant AND b.is_active
    ) OR (public.allowed_branch_scope() IS NOT NULL AND NOT (x = ANY(public.allowed_branch_scope())))
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;

  IF v_branch_roles IS NOT NULL AND jsonb_typeof(v_branch_roles) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_BRANCH_ROLES';
  END IF;
  IF v_branch_roles IS NOT NULL THEN
    FOR v_branch_id, v_branch_role IN
      SELECT key::uuid, value::uuid FROM jsonb_each_text(v_branch_roles)
    LOOP
      IF NOT (v_branch_id = ANY(v_scope)) THEN
        RAISE EXCEPTION 'INVALID_BRANCH_ROLES: branch is outside the selected scope';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.roles WHERE id = v_branch_role AND tenant_id = v_tenant
      ) THEN
        RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
      END IF;
      v_branch_assignments := v_branch_assignments + 1;
    END LOOP;
  END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1
    INTO v_num FROM public.users WHERE shop_id = v_tenant;
  INSERT INTO public.users(id,name,phone,role,is_original_owner,is_active,employee_number,
    job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,'employee',false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),
    v_actor,v_tenant,now()) RETURNING id INTO v_id;

  INSERT INTO public.memberships(user_id,tenant_id,role,status,branch_scope,role_id)
  VALUES(v_id,v_tenant,'employee','pending',v_scope,v_role_id)
  ON CONFLICT(user_id,tenant_id) DO UPDATE SET role = EXCLUDED.role,
    status = 'pending', branch_scope = EXCLUDED.branch_scope, role_id = EXCLUDED.role_id, updated_at = now()
  RETURNING id INTO v_membership;

  -- The membership trigger seeds one row per branch with the default role. Replace only the
  -- branches the owner explicitly named; every other branch keeps that default.
  IF v_branch_roles IS NOT NULL THEN
    FOR v_branch_id, v_branch_role IN
      SELECT key::uuid, value::uuid FROM jsonb_each_text(v_branch_roles)
    LOOP
      INSERT INTO public.membership_branch_roles(membership_id, branch_id, role_id)
      VALUES (v_membership, v_branch_id, v_branch_role)
      ON CONFLICT (membership_id, branch_id)
      DO UPDATE SET role_id = EXCLUDED.role_id, updated_at = now();
    END LOOP;
  END IF;

  IF payload->'overrides' IS NOT NULL AND jsonb_typeof(payload->'overrides') = 'object' THEN
    FOR v_code,v_grant IN SELECT key,(value)::boolean FROM jsonb_each_text(payload->'overrides') LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO public.user_permissions(user_id,permission_id,granted_by,is_override,is_granted)
        VALUES(v_id,v_perm,v_actor,true,v_grant);
        v_overrides := v_overrides + 1;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object(
    'role_id',v_role_id,
    'branch_scope',v_scope,
    'branch_roles',v_branch_roles,
    'branch_assignments',v_branch_assignments,
    'invited',true,
    'overrides',v_overrides
  ));

  RETURN jsonb_build_object(
    'id',v_id,
    'roleId',v_role_id,
    'membershipRole','employee',
    'membershipStatus','pending',
    'branchScope',v_scope,
    'branchRoles',v_branch_roles,
    'overrides',v_overrides
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee_core(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2. Dashboard visibility also requires the widget's permission ───────────────
CREATE OR REPLACE FUNCTION public.get_my_dashboards()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user    uuid := public.app_current_user_id();
  v_member  public.memberships;
  v_grant   public.co_owner_grants;
  v_role    uuid;
  v_branch  uuid;
  v_keys    text[];
BEGIN
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    SELECT array_agg(key ORDER BY sort_order, key) INTO v_keys FROM public.dashboard_widgets;
    RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
  END IF;

  IF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN RETURN '[]'::jsonb; END IF;
    SELECT COALESCE(array_agg(d.widget_key ORDER BY w.sort_order, w.key), '{}'::text[])
      INTO v_keys
      FROM public.co_owner_dashboards d
      JOIN public.dashboard_widgets w ON w.key = d.widget_key
     WHERE d.grant_id = v_grant.id
       AND d.visible
       AND (w.default_permission IS NULL OR public.has_effective_permission(w.default_permission));
    RETURN to_jsonb(v_keys);
  END IF;

  v_role := v_member.role_id;
  v_branch := public.current_branch_id();
  IF v_branch IS NOT NULL THEN
    SELECT COALESCE(mbr.role_id, v_role) INTO v_role
      FROM public.membership_branch_roles mbr
     WHERE mbr.membership_id = v_member.id AND mbr.branch_id = v_branch;
    v_role := COALESCE(v_role, v_member.role_id);
  END IF;

  SELECT array_agg(rd.widget_key ORDER BY w.sort_order, w.key)
    INTO v_keys
    FROM public.role_dashboards rd
    JOIN public.dashboard_widgets w ON w.key = rd.widget_key
   WHERE rd.role_id = v_role
     AND (w.default_permission IS NULL OR public.has_effective_permission(w.default_permission));

  RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_dashboards() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_dashboards() FROM PUBLIC, anon;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_employee_core') THEN
    RAISE EXCEPTION 'create_employee_core missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_dashboards') THEN
    RAISE EXCEPTION 'get_my_dashboards missing';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
