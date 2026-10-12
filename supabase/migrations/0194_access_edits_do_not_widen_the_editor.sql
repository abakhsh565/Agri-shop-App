-- Reuse the existing employee access writer and its role/override semantics.
-- The editor's own branch scope is a ceiling, not merely a checkbox default.
CREATE OR REPLACE FUNCTION public.guard_employee_access_edit(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_target public.memberships;
  v_actor public.memberships;
  v_scope uuid[];
  v_role uuid;
  v_code text;
  v_grant boolean;
BEGIN
  SELECT * INTO v_actor FROM public.membership_in_active_shop(NULL);
  SELECT * INTO v_target FROM public.memberships WHERE user_id=(payload->>'employeeId')::uuid
    AND tenant_id=v_tenant FOR UPDATE;
  IF NOT FOUND OR v_target.role='owner' THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF v_actor.role<>'owner' AND (v_target.user_id=v_actor.user_id OR v_target.role<>'employee' OR
    v_target.branch_scope IS NULL OR NOT (v_target.branch_scope <@ COALESCE(v_actor.branch_scope,'{}'::uuid[]))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: employee access exceeds your branch scope';
  END IF;
  IF payload ? 'branchScope' THEN
    IF jsonb_typeof(payload->'branchScope') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required';
    END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope');
    IF v_scope IS NULL OR cardinality(v_scope)=0 OR EXISTS (
      SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM public.branches b
        WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)
    ) OR (v_actor.role<>'owner' AND NOT (v_scope <@ COALESCE(v_actor.branch_scope,'{}'::uuid[]))) THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE';
    END IF;
  END IF;
  v_role := COALESCE(NULLIF(payload->>'roleId','')::uuid,v_target.role_id);
  IF v_role IS NULL OR NOT EXISTS(SELECT 1 FROM public.roles WHERE id=v_role AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_actor.role<>'owner' THEN
    IF EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id=rp.permission_id
      WHERE rp.role_id=v_role AND NOT public.has_effective_permission(p.code)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
    END IF;
    FOR v_code,v_grant IN SELECT key,value::boolean FROM jsonb_each_text(COALESCE(payload->'overrides','{}'::jsonb)) LOOP
      IF v_grant AND NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
    END LOOP;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      IF NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_employee_access_edit(jsonb) FROM PUBLIC,anon,authenticated;
DO $$ DECLARE v_definition text; v_begin int; BEGIN
  SELECT pg_get_functiondef('public.update_employee_access(jsonb)'::regprocedure) INTO v_definition;
  IF position('guard_employee_access_edit' IN v_definition)=0 THEN
    v_begin := position(E'BEGIN\n' IN v_definition);
    IF v_begin=0 THEN RAISE EXCEPTION '0194: unexpected employee access body'; END IF;
    v_definition := overlay(v_definition PLACING E'BEGIN\n  PERFORM public.guard_employee_access_edit(payload);\n' FROM v_begin FOR 6);
    EXECUTE v_definition;
  END IF;
END $$;
-- Add/Move cannot erase someone else's out-of-scope access either.
DO $$ DECLARE v_definition text; v_anchor text := 'IF NOT FOUND THEN RAISE EXCEPTION ''EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED''; END IF;'; BEGIN
  SELECT pg_get_functiondef('public.assign_employee_branch(uuid,uuid,text)'::regprocedure) INTO v_definition;
  IF position('assignment exceeds editor scope' IN v_definition)=0 THEN
    IF position(v_anchor IN v_definition)=0 THEN RAISE EXCEPTION '0194: unexpected assignment body'; END IF;
    v_definition := replace(v_definition,v_anchor,v_anchor||E'\n IF public.allowed_branch_scope() IS NOT NULL AND (v_member.branch_scope IS NULL OR\n NOT (v_member.branch_scope <@ public.allowed_branch_scope())) THEN\n RAISE EXCEPTION ''NOT_AUTHORIZED: assignment exceeds editor scope''; END IF;');
    EXECUTE v_definition;
  END IF;
END $$;

-- Do not attach this to onboarding: the pending member has no active context.
-- Restrict the audit trigger to management actions with active memberships.
CREATE OR REPLACE FUNCTION public.audit_membership_access_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF public.app_current_user_id() IS NULL OR NOT EXISTS(SELECT 1 FROM public.membership_in_active_shop(NULL)) OR
    (NEW.role_id IS NOT DISTINCT FROM OLD.role_id AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope AND
      NEW.status IS NOT DISTINCT FROM OLD.status) THEN RETURN NEW; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES(public.app_current_user_id(),'membership_access_changed','user',NEW.user_id,
    jsonb_build_object('before',jsonb_build_object('roleId',OLD.role_id,'branchScope',OLD.branch_scope,'status',OLD.status),
      'after',jsonb_build_object('roleId',NEW.role_id,'branchScope',NEW.branch_scope,'status',NEW.status)));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS audit_membership_access_change_trg ON public.memberships;
CREATE TRIGGER audit_membership_access_change_trg AFTER UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.audit_membership_access_change();
COMMENT ON COLUMN public.memberships.branch_scope IS
  'Explicit branch IDs for ordinary memberships; NULL is denied. Only owner membership has implicit all-branch authority. Historical NULL assignments are not guessed.';
NOTIFY pgrst,'reload schema';
