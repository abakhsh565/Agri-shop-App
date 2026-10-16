CREATE OR REPLACE FUNCTION public.create_employee_core(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id uuid;
  v_phone text;
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid;
  v_scope uuid[];
  v_num int;
  v_code text;
  v_grant boolean;
  v_perm uuid;
  v_overrides int := 0;
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
    status = 'pending', branch_scope = EXCLUDED.branch_scope, role_id = EXCLUDED.role_id, updated_at = now();
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
  VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,
    'branch_scope',v_scope,'invited',true,'overrides',v_overrides));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole','employee',
    'membershipStatus','pending','branchScope',v_scope,'overrides',v_overrides);
END;
$$;
-- The wrapper create_employee remains the normal invitation entry point and
-- still provisions the login. The internal writer is not a public bypass.
REVOKE ALL ON FUNCTION public.create_employee_core(jsonb) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
