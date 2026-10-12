-- Branches are operating units, not shops/tenants. Never delegate to a tenant purge.
-- Lifecycle is owner-only; editing a permitted branch still requires settings.edit.
CREATE OR REPLACE FUNCTION public.create_operating_branch(
  p_branch_id uuid, p_name text, p_latitude double precision, p_longitude double precision,
  p_label text DEFAULT NULL, p_address text DEFAULT NULL, p_source text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch public.branches;
  v_name text := trim(COALESCE(p_name, ''));
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can create a branch';
  END IF;
  PERFORM public.authorize_business_action('settings.edit');
  IF p_branch_id IS NULL OR v_name = '' THEN RAISE EXCEPTION 'VALIDATION: a branch name is required'; END IF;
  IF length(v_name) > 120 THEN RAISE EXCEPTION 'VALIDATION: branch names are limited to 120 characters'; END IF;
  IF p_latitude IS NULL OR p_longitude IS NULL OR
    NOT (p_latitude BETWEEN 23.0 AND 37.5 AND p_longitude BETWEEN 60.0 AND 78.0) THEN
    RAISE EXCEPTION 'VALIDATION: choose a branch location in Pakistan';
  END IF;
  -- One lifecycle writer per business. Duplicate taps and concurrent devices
  -- cannot create two active branches with the same normalized name.
  PERFORM 1 FROM public.shops WHERE id = v_member.tenant_id FOR UPDATE;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id;
  IF FOUND THEN
    IF v_branch.tenant_id IS DISTINCT FROM v_member.tenant_id OR
       v_branch.name IS DISTINCT FROM v_name OR NOT v_branch.is_active OR
       v_branch.latitude IS DISTINCT FROM p_latitude OR v_branch.longitude IS DISTINCT FROM p_longitude THEN
      RAISE EXCEPTION 'VALIDATION: branch request does not match';
    END IF;
    RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'tenant_id',v_branch.tenant_id,
      'branch_name',v_branch.name,'idempotent',true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = v_member.tenant_id AND is_active
     AND lower(trim(name)) = lower(v_name)) THEN RAISE EXCEPTION 'BRANCH_NAME_TAKEN'; END IF;
  INSERT INTO public.branches(id,tenant_id,name,latitude,longitude,location_label,address,location_source)
  VALUES(p_branch_id,v_member.tenant_id,v_name,p_latitude,p_longitude,p_label,p_address,p_source)
  RETURNING * INTO v_branch;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_created','branch',v_branch.id,v_branch.id,
    jsonb_build_object('after',jsonb_build_object('name',v_name,'address',p_address,
      'latitude',p_latitude,'longitude',p_longitude)));
  RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'tenant_id',v_branch.tenant_id,
    'branch_name',v_branch.name);
END;
$$;
REVOKE ALL ON FUNCTION public.create_operating_branch(uuid,text,double precision,double precision,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_operating_branch(uuid,text,double precision,double precision,text,text,text) TO authenticated;

-- Preserve the parameter name for PostgREST callers; it now MUST be a branch id.
CREATE OR REPLACE FUNCTION public.rename_branch(p_shop_id uuid, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_branch public.branches;
  v_name text := trim(COALESCE(p_name,''));
BEGIN
  SELECT * INTO v_branch FROM public.branches WHERE id = p_shop_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.shops WHERE id = v_branch.tenant_id FOR UPDATE;
  PERFORM public.authorize_business_action('settings.edit',v_branch.tenant_id,v_branch.id);
  IF v_name = '' THEN RAISE EXCEPTION 'VALIDATION: a branch name is required'; END IF;
  IF length(v_name) > 120 THEN RAISE EXCEPTION 'VALIDATION: branch names are limited to 120 characters'; END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_shop_id AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = v_branch.tenant_id AND is_active
     AND id <> v_branch.id AND lower(trim(name)) = lower(v_name)) THEN RAISE EXCEPTION 'BRANCH_NAME_TAKEN'; END IF;
  IF v_branch.name = v_name THEN RETURN jsonb_build_object('success',true,'name',v_name,'idempotent',true); END IF;
  UPDATE public.branches SET name = v_name WHERE id = v_branch.id;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_renamed','branch',v_branch.id,v_branch.id,
    jsonb_build_object('before',jsonb_build_object('name',v_branch.name),'after',jsonb_build_object('name',v_name)));
  RETURN jsonb_build_object('success',true,'branch_id',v_branch.id,'name',v_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_operating_branch(p_branch_id uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch public.branches;
  v_fallback uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the business owner can archive a branch';
  END IF;
  PERFORM 1 FROM public.shops WHERE id = v_member.tenant_id FOR UPDATE;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND tenant_id = v_member.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF v_branch.is_default THEN RAISE EXCEPTION 'MAIN_BRANCH'; END IF;
  IF NOT v_branch.is_active THEN RETURN jsonb_build_object('success',true,'idempotent',true); END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'VALIDATION: a reason is required'; END IF;
  SELECT id INTO v_fallback FROM public.branches WHERE tenant_id = v_member.tenant_id
    AND is_active AND id <> p_branch_id ORDER BY is_default DESC,created_at,id LIMIT 1;
  IF v_fallback IS NULL THEN RAISE EXCEPTION 'LAST_BRANCH'; END IF;
  -- No silent lost login or scope rewrite. Reassign people explicitly first,
  -- including pending invitations and suspended accounts that may be restored.
  IF EXISTS (SELECT 1 FROM public.memberships WHERE tenant_id = v_member.tenant_id AND role <> 'owner'
    AND p_branch_id = ANY(COALESCE(branch_scope,'{}'::uuid[]))) THEN RAISE EXCEPTION 'BRANCH_HAS_STAFF'; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'branch_archived','branch',p_branch_id,p_branch_id,
    jsonb_build_object('reason',trim(p_reason),'before',jsonb_build_object('active',true),
      'after',jsonb_build_object('active',false),'historyPreserved',true));
  UPDATE public.branches SET is_active = false WHERE id = p_branch_id;
  UPDATE public.user_active_shops SET branch_id = v_fallback,updated_at = now()
    WHERE shop_id = v_member.tenant_id AND branch_id = p_branch_id;
  RETURN jsonb_build_object('success',true,'branch_id',p_branch_id,'fallback_branch_id',v_fallback,'history_preserved',true);
END;
$$;
REVOKE ALL ON FUNCTION public.archive_operating_branch(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.archive_operating_branch(uuid,text) TO authenticated;
-- The legacy endpoint erases a TENANT and accounts. It is not a branch API.
REVOKE ALL ON FUNCTION public.delete_branch(uuid,text,text) FROM PUBLIC,anon,authenticated;

-- Membership writers serialize with archive so an invitation/Add cannot race
-- lifecycle and grant an already archived branch.
CREATE OR REPLACE FUNCTION public.validate_member_branch_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  -- Lock the target branches rather than serializing all business operations.
  -- Archive holds FOR UPDATE on its branch; a racing assignment waits and then
  -- re-checks is_active. No reverse membership lock is taken by archive.
  PERFORM 1 FROM public.branches WHERE tenant_id=NEW.tenant_id
    AND id=ANY(COALESCE(NEW.branch_scope,'{}'::uuid[])) ORDER BY id FOR SHARE;
  IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(NEW.branch_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = NEW.tenant_id AND b.is_active
    )
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  RETURN NEW;
END;
$$;

-- Replace the existing location writer, retaining its contract and whitelist.
CREATE OR REPLACE FUNCTION public.set_place(
  p_table text,p_id uuid,p_latitude double precision,p_longitude double precision,
  p_label text DEFAULT NULL,p_address text DEFAULT NULL,p_source text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_table text := lower(trim(COALESCE(p_table,'')));
  v_tenant uuid;
  v_before jsonb;
  v_updated int;
  v_clearing boolean := p_latitude IS NULL AND p_longitude IS NULL;
BEGIN
  IF v_table NOT IN ('customers','branches','shops') THEN RAISE EXCEPTION 'VALIDATION: invalid location target'; END IF;
  IF NOT v_clearing AND (p_latitude IS NULL OR p_longitude IS NULL OR
    NOT (p_latitude BETWEEN 23.0 AND 37.5 AND p_longitude BETWEEN 60.0 AND 78.0)) THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;
  IF v_table = 'branches' THEN
    SELECT tenant_id INTO v_tenant FROM public.branches WHERE id = p_id AND is_active;
    PERFORM 1 FROM public.shops WHERE id = v_tenant FOR UPDATE;
    PERFORM public.authorize_business_action('settings.edit',v_tenant,p_id);
  ELSIF v_table = 'shops' THEN
    v_tenant := public.authorize_business_action('settings.edit',p_id);
  ELSE
    v_tenant := public.authorize_business_action('customers.edit');
  END IF;
  EXECUTE format('SELECT jsonb_build_object(''latitude'',latitude,''longitude'',longitude,''address'',address) FROM public.%I WHERE id=$1 AND %I=$2 FOR UPDATE',
    v_table,CASE WHEN v_table='branches' THEN 'tenant_id' WHEN v_table='shops' THEN 'id' ELSE 'shop_id' END)
    INTO v_before USING p_id,v_tenant;
  IF v_before IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;
  EXECUTE format('UPDATE public.%I SET latitude=$1,longitude=$2,location_label=NULLIF($3,''''),
    address=COALESCE(NULLIF($4,''''),address),location_source=NULLIF($5,'''') WHERE id=$6',v_table)
    USING p_latitude,p_longitude,p_label,p_address,p_source,p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;
  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,branch_id,details)
  VALUES(public.app_current_user_id(),'location_updated',CASE WHEN v_table='branches' THEN 'branch' WHEN v_table='shops' THEN 'shop' ELSE 'customer' END,p_id,
    CASE WHEN v_table='branches' THEN p_id ELSE public.current_branch_id() END,
    jsonb_build_object('before',v_before,'after',jsonb_build_object('latitude',p_latitude,'longitude',p_longitude,'address',p_address),'cleared',v_clearing));
  RETURN jsonb_build_object('ok',true,'table',v_table,'id',p_id,'cleared',v_clearing);
END;
$$;
NOTIFY pgrst, 'reload schema';
