-- 0274 — a Co-Owner invitation stores the phone form the login can actually resolve.
--
-- 0266 accepted the wizard's display value ("03008880001") into users.phone. Every login path
-- normalises to "92300880001", so lookup_user_by_phone found no profile and the invitee could
-- never receive a code. This is an additive replacement of the invitation function; it does not
-- alter a deployed migration and it leaves existing users untouched.

CREATE OR REPLACE FUNCTION public.create_co_owner_invitation(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_user_id uuid;
  v_member_id uuid;
  v_grant_id uuid;
  v_phone text;
  v_name text;
  v_existing public.users;
  v_existing_member public.memberships;
  v_mode text;
  v_ids uuid[];
  v_code text;
  v_perm uuid;
  v_role uuid;
  v_widget text;
  v_authority text;
  v_auth_mode text;
  v_scope jsonb := COALESCE(payload->'scopes', '{}'::jsonb);
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  -- A shop owner types the local 03xx form. Auth and every login RPC use the canonical
  -- 92xxxxxxxxxx form, so accepting the raw display value here made the invited person
  -- unable to sign in at all. Canonicalise at the one boundary that creates the identity.
  v_phone := NULLIF(regexp_replace(trim(COALESCE(payload->>'phone', '')), '[^0-9]', '', 'g'), '');
  IF v_phone LIKE '0%' THEN
    v_phone := '92' || substr(v_phone, 2);
  ELSIF length(v_phone) = 10 THEN
    v_phone := '92' || v_phone;
  END IF;
  v_name := NULLIF(trim(COALESCE(payload->>'name', '')), '');
  IF v_phone IS NULL THEN RAISE EXCEPTION 'VALIDATION: phone is required'; END IF;

  SELECT * INTO v_existing FROM public.users WHERE phone = v_phone LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.shop_id <> v_owner.tenant_id THEN
      RAISE EXCEPTION 'PERSON_BELONGS_TO_ANOTHER_BUSINESS';
    END IF;
    SELECT * INTO v_existing_member FROM public.memberships
      WHERE user_id = v_existing.id AND tenant_id = v_owner.tenant_id FOR UPDATE;
    IF v_existing_member.id IS NULL THEN
      RAISE EXCEPTION 'PERSON_NOT_IN_THIS_BUSINESS';
    END IF;
    IF v_existing_member.role = 'owner' OR v_existing_member.access_kind = 'co_owner' THEN
      RAISE EXCEPTION 'PERSON_ALREADY_HAS_OWNER_ACCESS';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.co_owner_grants g
       WHERE g.tenant_id = v_owner.tenant_id AND g.user_id = v_existing.id
         AND g.status IN ('invited', 'active', 'suspended')
    ) THEN
      RAISE EXCEPTION 'PERSON_ALREADY_INVITED';
    END IF;
    v_user_id := v_existing.id;
    -- Controlled transition: the employee membership becomes the Co-Owner
    -- membership. The previous employee role is recorded in history and is
    -- never silently restored on revocation.
    UPDATE public.memberships
       SET access_kind = 'co_owner', role = 'employee', role_id = NULL,
           status = 'pending', updated_at = now()
     WHERE id = v_existing_member.id;
    v_member_id := v_existing_member.id;
  ELSE
    INSERT INTO public.users
      (id, name, phone, role, is_original_owner, is_active, shop_id, created_by, created_at)
    VALUES
      (gen_random_uuid(), COALESCE(v_name, 'Co-Owner'), v_phone, 'employee', false, true,
       v_owner.tenant_id, v_owner.user_id, now())
    RETURNING id INTO v_user_id;

    -- The users trigger creates the ordinary membership. This invitation turns
    -- that same row into the Co-Owner membership instead of adding a second one.
    SELECT id INTO v_member_id
      FROM public.memberships
     WHERE user_id = v_user_id AND tenant_id = v_owner.tenant_id
     FOR UPDATE;
    IF v_member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBERSHIP_NOT_CREATED';
    END IF;
    UPDATE public.memberships
       SET access_kind = 'co_owner', role = 'employee', role_id = NULL,
           status = 'pending', updated_at = now()
     WHERE id = v_member_id;
  END IF;

  INSERT INTO public.co_owner_grants
    (tenant_id, user_id, membership_id, granted_by, status,
     can_invite_employees, can_deactivate_employees, can_manage_branches,
     notes, expires_at)
  VALUES
    (v_owner.tenant_id, v_user_id, v_member_id, v_owner.user_id, 'invited',
     COALESCE((payload->>'canInviteEmployees')::boolean, false),
     COALESCE((payload->>'canDeactivateEmployees')::boolean, false),
     COALESCE((payload->>'canManageBranches')::boolean, false),
     NULLIF(payload->>'notes', ''),
     NULLIF(payload->>'expiresAt', '')::timestamptz)
  RETURNING id INTO v_grant_id;

  INSERT INTO public.co_owner_scope_settings
    (grant_id, branches_mode, suppliers_mode, departments_mode, records_mode, brands_mode)
  VALUES
    (v_grant_id,
     CASE WHEN v_scope->>'branchesMode' IN ('all','selected','none') THEN v_scope->>'branchesMode' ELSE 'none' END,
     CASE WHEN v_scope->>'suppliersMode' IN ('all','selected','none') THEN v_scope->>'suppliersMode' ELSE 'none' END,
     CASE WHEN v_scope->>'departmentsMode' IN ('all','selected','none') THEN v_scope->>'departmentsMode' ELSE 'none' END,
     CASE WHEN v_scope->>'recordsMode' IN ('all','selected','none') THEN v_scope->>'recordsMode' ELSE 'none' END,
     'none');

  -- Validate + insert branch IDs.
  IF jsonb_typeof(COALESCE(v_scope->'branchIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_branch_scopes(grant_id, branch_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'branchIds')) s
     WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.id = s.x AND b.tenant_id = v_owner.tenant_id AND b.is_active);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'supplierIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_supplier_scopes(grant_id, company_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'supplierIds')) s
     WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id AND c.is_active);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'departmentIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_department_scopes(grant_id, department_id)
    SELECT v_grant_id, x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'departmentIds')) s
     WHERE EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.x AND d.tenant_id = v_owner.tenant_id);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'customerIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
    SELECT v_grant_id, 'customer', x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'customerIds')) s
     WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
  END IF;
  IF jsonb_typeof(COALESCE(v_scope->'recordSupplierIds', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
    SELECT v_grant_id, 'supplier', x
      FROM (SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'recordSupplierIds')) s
     WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
  END IF;

  -- Permissions must exist in the catalogue and be real codes.
  FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
    SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
    IF v_perm IS NOT NULL THEN
      INSERT INTO public.co_owner_permissions(grant_id, permission_id)
      VALUES (v_grant_id, v_perm) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Dashboard visibility. Absence/unticked is hidden, never "show everything".
  FOR v_widget IN SELECT jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM public.dashboard_widgets w WHERE w.key = v_widget) THEN
      INSERT INTO public.co_owner_dashboards(grant_id, widget_key, visible)
      VALUES (v_grant_id, v_widget, true)
      ON CONFLICT (grant_id, widget_key) DO UPDATE SET visible = true;
    END IF;
  END LOOP;

  -- Major authority modes. Missing = restricted.
  FOR v_authority, v_auth_mode IN
    SELECT key, value FROM jsonb_each_text(COALESCE(payload->'authorities', '{}'::jsonb))
  LOOP
    IF EXISTS (SELECT 1 FROM public.co_owner_authority_catalog c WHERE c.code = v_authority)
       AND v_auth_mode IN ('allowed', 'approval_required', 'restricted') THEN
      INSERT INTO public.co_owner_authorities(grant_id, authority_code, mode)
      VALUES (v_grant_id, v_authority, v_auth_mode)
      ON CONFLICT (grant_id, authority_code) DO UPDATE SET mode = EXCLUDED.mode;
    END IF;
  END LOOP;

  -- Employee roles the Co-Owner may assign.
  IF jsonb_typeof(COALESCE(payload->'assignableRoleIds', '[]'::jsonb)) = 'array' THEN
    FOR v_role IN SELECT value::uuid FROM jsonb_array_elements_text(payload->'assignableRoleIds') LOOP
      IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.tenant_id = v_owner.tenant_id) THEN
        INSERT INTO public.co_owner_assignable_roles(grant_id, role_id)
        VALUES (v_grant_id, v_role) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.co_owner_sync_membership(v_grant_id);

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'co_owner_invited', 'co_owner_grant', v_grant_id, v_owner.tenant_id, v_grant_id,
     jsonb_build_object('user_id', v_user_id, 'phone', v_phone,
       'scopes', v_scope, 'permissions', COALESCE(payload->'permissions', '[]'::jsonb),
       'authorities', COALESCE(payload->'authorities', '{}'::jsonb),
       'dashboards', COALESCE(payload->'dashboards', '[]'::jsonb)));

  RETURN jsonb_build_object('grantId', v_grant_id, 'userId', v_user_id,
    'membershipId', v_member_id, 'status', 'invited');
END;
$$;
REVOKE ALL ON FUNCTION public.create_co_owner_invitation(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_co_owner_invitation(jsonb) TO authenticated;
