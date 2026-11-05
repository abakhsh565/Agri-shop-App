-- 0293 — Every business write RPC carries the recognized authorization guard.
--
-- WHY THIS EXISTS. rbacInvariants Invariant E requires every business write RPC to
-- carry an authorization guard the codebase recognizes by name
-- (authorize_business_action / authorize_tenant_membership / has_effective_permission
-- / has_permission / app_is_admin). Seven functions had none of those strings in
-- their definition, so the invariant failed on them — but five of the seven were
-- NOT unguarded. Four finance functions (record/delete/update_finance_entry,
-- delete_payment_reminder) refuse everyone whose membership role is not 'owner';
-- update_business_profile refuses everyone outside owner/admin; create_co_owner_invitation
-- and update_co_owner_grant run through co_owner_assert_original_owner(). Those are
-- real guards in shapes the invariant's vocabulary does not contain — its own second
-- test blesses exactly the owner-role shape (OWNER_ROLE_GATED_WRITES), and the
-- co-owner assert is the same idea for the original owner. Widening the test's
-- vocabulary is a test change, which this migration does not make; instead the
-- functions are harmonized onto the recognized helper without changing who may call.
--
-- WHAT THIS DOES. Restates the seven functions byte-for-byte from their defining
-- migrations (0266, 0261, 0257, 0255, 0250) with ONE added statement each, first in
-- the body: PERFORM public.authorize_tenant_membership(). That call resolves the
-- caller's active shop and raises NOT_AUTHORIZED when there is no active membership
-- or the tenant mismatches — the same tenant check the functions already performed
-- by hand with membership_in_active_shop(NULL). Every existing refusal below it is
-- untouched, so the caller set of each function is exactly what it was:
-- finance writes stay owner-only, the business profile stays owner-or-admin, and
-- co-owner writes stay original-owner-only. In particular NO function is re-gated
-- onto authorize_business_action('payments.view'): the Store Manager and Inventory
-- Clerk roles hold payments.view, so that would have let non-owners delete recorded
-- money — a weakening, not a fix.
--
-- WHY IT IS SAFE TO APPLY. CREATE OR REPLACE FUNCTION keeps the existing grants
-- (authenticated-only, PUBLIC/anon revoked). The added call derives from the same
-- active-shop chain the functions already read, so in every session where the
-- function previously succeeded it still succeeds, and where it previously refused
-- for lack of a membership it refuses one line earlier with the same meaning.


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
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  v_owner := public.co_owner_assert_original_owner();
  v_phone := NULLIF(trim(COALESCE(payload->>'phone', '')), '');
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


CREATE OR REPLACE FUNCTION public.update_co_owner_grant(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_grant public.co_owner_grants;
  v_scope jsonb := COALESCE(payload->'scopes', '{}'::jsonb);
  v_mode text;
  v_code text;
  v_perm uuid;
  v_role uuid;
  v_widget text;
  v_authority text;
  v_auth_mode text;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_grant FROM public.co_owner_grants
    WHERE id = (payload->>'grantId')::uuid AND tenant_id = v_owner.tenant_id
    FOR UPDATE;
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF v_grant.status = 'revoked' THEN RAISE EXCEPTION 'GRANT_REVOKED'; END IF;

  IF payload ? 'canInviteEmployees' THEN
    UPDATE public.co_owner_grants SET can_invite_employees = (payload->>'canInviteEmployees')::boolean WHERE id = v_grant.id;
  END IF;
  IF payload ? 'canDeactivateEmployees' THEN
    UPDATE public.co_owner_grants SET can_deactivate_employees = (payload->>'canDeactivateEmployees')::boolean WHERE id = v_grant.id;
  END IF;
  IF payload ? 'canManageBranches' THEN
    UPDATE public.co_owner_grants SET can_manage_branches = (payload->>'canManageBranches')::boolean WHERE id = v_grant.id;
  END IF;

  IF v_scope ? 'branchesMode' THEN
    UPDATE public.co_owner_scope_settings SET branches_mode = v_scope->>'branchesMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'suppliersMode' THEN
    UPDATE public.co_owner_scope_settings SET suppliers_mode = v_scope->>'suppliersMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'departmentsMode' THEN
    UPDATE public.co_owner_scope_settings SET departments_mode = v_scope->>'departmentsMode' WHERE grant_id = v_grant.id;
  END IF;
  IF v_scope ? 'recordsMode' THEN
    UPDATE public.co_owner_scope_settings SET records_mode = v_scope->>'recordsMode' WHERE grant_id = v_grant.id;
  END IF;

  IF v_scope ? 'branchIds' THEN
    DELETE FROM public.co_owner_branch_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_branch_scopes(grant_id, branch_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'branchIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.branches b WHERE b.id = s.x AND b.tenant_id = v_owner.tenant_id AND b.is_active);
  END IF;
  IF v_scope ? 'supplierIds' THEN
    DELETE FROM public.co_owner_supplier_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_supplier_scopes(grant_id, company_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'supplierIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id AND c.is_active);
  END IF;
  IF v_scope ? 'departmentIds' THEN
    DELETE FROM public.co_owner_department_scopes WHERE grant_id = v_grant.id;
    INSERT INTO public.co_owner_department_scopes(grant_id, department_id)
    SELECT v_grant.id, x FROM (
      SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'departmentIds')
    ) s WHERE EXISTS (SELECT 1 FROM public.departments d WHERE d.id = s.x AND d.tenant_id = v_owner.tenant_id);
  END IF;
  IF v_scope ? 'customerIds' OR v_scope ? 'recordSupplierIds' THEN
    IF v_scope ? 'customerIds' THEN
      DELETE FROM public.co_owner_record_scopes WHERE grant_id = v_grant.id AND entity_type = 'customer';
      INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
      SELECT v_grant.id, 'customer', x FROM (
        SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'customerIds')
      ) s WHERE EXISTS (SELECT 1 FROM public.customers c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
    END IF;
    IF v_scope ? 'recordSupplierIds' THEN
      DELETE FROM public.co_owner_record_scopes WHERE grant_id = v_grant.id AND entity_type = 'supplier';
      INSERT INTO public.co_owner_record_scopes(grant_id, entity_type, entity_id)
      SELECT v_grant.id, 'supplier', x FROM (
        SELECT DISTINCT value::uuid AS x FROM jsonb_array_elements_text(v_scope->'recordSupplierIds')
      ) s WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = s.x AND c.shop_id = v_owner.tenant_id);
    END IF;
  END IF;

  IF payload ? 'permissions' THEN
    DELETE FROM public.co_owner_permissions WHERE grant_id = v_grant.id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO public.co_owner_permissions(grant_id, permission_id) VALUES (v_grant.id, v_perm);
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'dashboards' THEN
    DELETE FROM public.co_owner_dashboards WHERE grant_id = v_grant.id;
    FOR v_widget IN SELECT jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) LOOP
      IF EXISTS (SELECT 1 FROM public.dashboard_widgets w WHERE w.key = v_widget) THEN
        INSERT INTO public.co_owner_dashboards(grant_id, widget_key, visible)
        VALUES (v_grant.id, v_widget, true);
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'authorities' THEN
    FOR v_authority, v_auth_mode IN SELECT key, value FROM jsonb_each_text(payload->'authorities') LOOP
      IF EXISTS (SELECT 1 FROM public.co_owner_authority_catalog c WHERE c.code = v_authority)
         AND v_auth_mode IN ('allowed', 'approval_required', 'restricted') THEN
        INSERT INTO public.co_owner_authorities(grant_id, authority_code, mode)
        VALUES (v_grant.id, v_authority, v_auth_mode)
        ON CONFLICT (grant_id, authority_code) DO UPDATE SET mode = EXCLUDED.mode;
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'assignableRoleIds' THEN
    DELETE FROM public.co_owner_assignable_roles WHERE grant_id = v_grant.id;
    FOR v_role IN SELECT value::uuid FROM jsonb_array_elements_text(payload->'assignableRoleIds') LOOP
      IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = v_role AND r.tenant_id = v_owner.tenant_id) THEN
        INSERT INTO public.co_owner_assignable_roles(grant_id, role_id) VALUES (v_grant.id, v_role);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.co_owner_grants
     SET access_version = access_version + 1, updated_at = now()
   WHERE id = v_grant.id;
  PERFORM public.co_owner_sync_membership(v_grant.id);

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'co_owner_grant_updated', 'co_owner_grant', v_grant.id, v_owner.tenant_id, v_grant.id,
     jsonb_build_object('access_version', v_grant.access_version + 1, 'payload', payload));

  RETURN jsonb_build_object('grantId', v_grant.id, 'updated', true,
    'accessVersion', v_grant.access_version + 1);
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_finance_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_row    public.finance_entries;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner removes recorded money';
  END IF;

  SELECT * INTO v_row FROM public.finance_entries
   WHERE id = p_id AND shop_id = v_member.tenant_id
     AND branch_id = public.current_branch_id()
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry is not in this branch';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RETURN; -- already gone; a second tap is not an error
  END IF;

  UPDATE public.finance_entries
     SET deleted_at = now(),
         deleted_by = v_member.user_id,
         updated_at = now(),
         updated_by = v_member.user_id
   WHERE id = v_row.id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_finance_entry(
  p_id           uuid,
  p_kind         text,
  p_amount       numeric,
  p_category     text,
  p_method       text,
  p_occurred_on  date DEFAULT NULL,
  p_counterparty text DEFAULT NULL,
  p_note         text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_row    public.finance_entries;
  v_day    date;
  v_today  date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner corrects recorded money';
  END IF;

  SELECT * INTO v_row FROM public.finance_entries
   WHERE id = p_id AND shop_id = v_member.tenant_id
     AND branch_id = public.current_branch_id()
   FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry is not in this branch';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that entry was removed';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense', 'drawing') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected income, expense or drawing';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a recorded amount is above zero';
  END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR length(btrim(p_category)) > 64 THEN
    RAISE EXCEPTION 'INVALID_CATEGORY';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'bank', 'easypaisa', 'jazzcash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF p_counterparty IS NOT NULL AND length(btrim(p_counterparty)) > 120 THEN
    RAISE EXCEPTION 'INVALID_COUNTERPARTY';
  END IF;
  IF p_note IS NOT NULL AND length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'INVALID_NOTE';
  END IF;

  v_day := COALESCE(p_occurred_on, v_row.occurred_on);
  IF v_day > v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: money cannot be recorded before it happens';
  END IF;
  IF v_day < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'INVALID_DATE: that day is outside this ledger';
  END IF;

  UPDATE public.finance_entries
     SET kind         = p_kind,
         amount       = p_amount,
         category     = btrim(p_category),
         method       = p_method,
         occurred_on  = v_day,
         counterparty = NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
         note         = NULLIF(btrim(COALESCE(p_note, '')), ''),
         updated_at   = now(),
         updated_by   = v_member.user_id
   WHERE id = v_row.id;
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_payment_reminder(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_count  integer;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner removes payment reminders';
  END IF;

  DELETE FROM public.payment_reminders r
   WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;


CREATE OR REPLACE FUNCTION public.record_finance_entry(
  p_kind         text,
  p_amount       numeric,
  p_category     text,
  p_method       text,
  p_occurred_on  date    DEFAULT NULL,
  p_counterparty text    DEFAULT NULL,
  p_note         text    DEFAULT NULL,
  p_branch_id    uuid    DEFAULT NULL,
  p_repeat_every integer DEFAULT 1,
  p_repeat_unit  text    DEFAULT 'none'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_branch  uuid;
  v_day     date;
  v_today   date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_every   integer := COALESCE(p_repeat_every, 1);
  v_unit    text := COALESCE(p_repeat_unit, 'none');
  v_rule    uuid;
  v_next    date;
  v_id      uuid;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner records income, expense or drawings';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense', 'drawing') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected income, expense or drawing';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a recorded amount is above zero';
  END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR length(btrim(p_category)) > 64 THEN
    RAISE EXCEPTION 'INVALID_CATEGORY';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'bank', 'easypaisa', 'jazzcash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF v_unit NOT IN ('none', 'day', 'week', 'month') THEN
    RAISE EXCEPTION 'INVALID_REPEAT: expected none, day, week or month';
  END IF;
  IF v_every < 1 OR v_every > 60 THEN
    RAISE EXCEPTION 'INVALID_REPEAT: a cadence repeats between 1 and 60 times';
  END IF;

  v_day := COALESCE(p_occurred_on, v_today);
  IF v_day > v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: money cannot be recorded before it happens';
  END IF;
  IF v_day < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'INVALID_DATE: that day is outside this ledger';
  END IF;

  IF p_counterparty IS NOT NULL AND length(btrim(p_counterparty)) > 120 THEN
    RAISE EXCEPTION 'INVALID_COUNTERPARTY';
  END IF;
  IF p_note IS NOT NULL AND length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'INVALID_NOTE';
  END IF;

  v_branch := COALESCE(p_branch_id, public.current_branch_id());
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  IF v_unit <> 'none' THEN
    -- The first row is today's (or the chosen day's); the rule then carries the next date.
    v_next := CASE v_unit
      WHEN 'day'   THEN v_day + v_every
      WHEN 'week'  THEN v_day + (v_every * 7)
      ELSE (v_day + make_interval(months => v_every))::date
    END;

    INSERT INTO public.finance_recurrences (
      shop_id, branch_id, kind, amount, category, method, counterparty, note,
      repeat_every, repeat_unit, starts_on, next_on, created_by
    ) VALUES (
      v_member.tenant_id, v_branch, p_kind, p_amount, btrim(p_category), p_method,
      NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
      NULLIF(btrim(COALESCE(p_note, '')), ''),
      v_every, v_unit, v_day, v_next, v_member.user_id
    )
    RETURNING id INTO v_rule;
  END IF;

  INSERT INTO public.finance_entries (
    shop_id, branch_id, kind, amount, occurred_on, category, method,
    counterparty, note, created_by, recurrence_id
  ) VALUES (
    v_member.tenant_id, v_branch, p_kind, p_amount, v_day, btrim(p_category), p_method,
    NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_member.user_id, v_rule
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.update_business_profile(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop uuid := current_shop_id();
  v_name text;
  v_phone text;
  v_whatsapp text;
  v_email text;
  v_address text;
  v_city text;
  v_type text;
  v_registration text;
  v_logo text;
  v_licence text;
  v_cnic_front text;
  v_cnic_back text;
  v_row jsonb;
BEGIN
  -- 0293: the recognized authorization guard. This authorizes the caller's tenant
  -- membership; the owner / owner-or-admin / original-owner refusal below it is
  -- unchanged and still decides who may call.
  PERFORM public.authorize_tenant_membership();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_BUSINESS';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.memberships m
     WHERE m.user_id = v_actor
       AND m.tenant_id = v_shop
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin may change the business record';
  END IF;

  -- ── Values ────────────────────────────────────────────────────────────────
  -- A key that is absent stays as it is. A key present with a blank string clears the
  -- optional field it names. The two required fields refuse a blank instead of clearing.
  IF p_patch ? 'name' THEN
    v_name := nullif(btrim(COALESCE(p_patch ->> 'name', '')), '');
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'INVALID_NAME';
    END IF;
  END IF;

  IF p_patch ? 'phone' THEN
    v_phone := public.canonical_phone(p_patch ->> 'phone');
    IF v_phone !~ '^92[0-9]{10}$' THEN
      RAISE EXCEPTION 'INVALID_PHONE';
    END IF;
  END IF;

  IF p_patch ? 'whatsapp' THEN
    IF nullif(btrim(COALESCE(p_patch ->> 'whatsapp', '')), '') IS NULL THEN
      v_whatsapp := NULL;
    ELSE
      v_whatsapp := public.canonical_phone(p_patch ->> 'whatsapp');
      IF v_whatsapp !~ '^92[0-9]{10}$' THEN
        RAISE EXCEPTION 'INVALID_WHATSAPP';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'email' THEN
    v_email := nullif(btrim(COALESCE(p_patch ->> 'email', '')), '');
    IF v_email IS NOT NULL AND (
         char_length(v_email) > 254
         OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
       ) THEN
      RAISE EXCEPTION 'INVALID_EMAIL';
    END IF;
  END IF;

  IF p_patch ? 'address' THEN
    v_address := nullif(btrim(COALESCE(p_patch ->> 'address', '')), '');
    IF v_address IS NOT NULL AND char_length(v_address) > 500 THEN
      RAISE EXCEPTION 'INVALID_ADDRESS';
    END IF;
  END IF;

  IF p_patch ? 'city' THEN
    v_city := nullif(btrim(COALESCE(p_patch ->> 'city', '')), '');
    IF v_city IS NOT NULL AND char_length(v_city) > 100 THEN
      RAISE EXCEPTION 'INVALID_CITY';
    END IF;
  END IF;

  IF p_patch ? 'type' THEN
    v_type := nullif(btrim(COALESCE(p_patch ->> 'type', '')), '');
    IF v_type IS NOT NULL AND v_type NOT IN ('retail', 'wholesale', 'both') THEN
      RAISE EXCEPTION 'INVALID_TYPE';
    END IF;
  END IF;

  IF p_patch ? 'registration' THEN
    v_registration := nullif(btrim(COALESCE(p_patch ->> 'registration', '')), '');
    IF v_registration IS NOT NULL AND char_length(v_registration) > 100 THEN
      RAISE EXCEPTION 'INVALID_REGISTRATION';
    END IF;
  END IF;

  IF p_patch ? 'logo' THEN
    v_logo := nullif(btrim(COALESCE(p_patch ->> 'logo', '')), '');
    IF v_logo IS NOT NULL AND char_length(v_logo) > 1000 THEN
      RAISE EXCEPTION 'INVALID_LOGO';
    END IF;
  END IF;

  -- A document is either a path inside THIS shop's folder of the private bucket, or an https
  -- URL the signup form produced. Anything else is refused: it is the one place where a caller
  -- could otherwise write a path belonging to another business.
  IF p_patch ? 'licence' THEN
    v_licence := nullif(btrim(COALESCE(p_patch ->> 'licence', '')), '');
    IF v_licence IS NOT NULL AND (
         char_length(v_licence) > 1000
         OR NOT (v_licence LIKE v_shop::text || '/%' OR v_licence ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_LICENCE';
    END IF;
  END IF;

  IF p_patch ? 'cnic_front' THEN
    v_cnic_front := nullif(btrim(COALESCE(p_patch ->> 'cnic_front', '')), '');
    IF v_cnic_front IS NOT NULL AND (
         char_length(v_cnic_front) > 1000
         OR NOT (v_cnic_front LIKE v_shop::text || '/%' OR v_cnic_front ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_CNIC_FRONT';
    END IF;
  END IF;

  IF p_patch ? 'cnic_back' THEN
    v_cnic_back := nullif(btrim(COALESCE(p_patch ->> 'cnic_back', '')), '');
    IF v_cnic_back IS NOT NULL AND (
         char_length(v_cnic_back) > 1000
         OR NOT (v_cnic_back LIKE v_shop::text || '/%' OR v_cnic_back ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_CNIC_BACK';
    END IF;
  END IF;

  UPDATE public.shops s
     SET name                = COALESCE(v_name, s.name),
         phone               = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE s.phone END,
         whatsapp_phone      = CASE WHEN p_patch ? 'whatsapp' THEN v_whatsapp ELSE s.whatsapp_phone END,
         email               = CASE WHEN p_patch ? 'email' THEN v_email ELSE s.email END,
         address             = CASE WHEN p_patch ? 'address' THEN v_address ELSE s.address END,
         city                = CASE WHEN p_patch ? 'city' THEN v_city ELSE s.city END,
         shop_type           = CASE WHEN p_patch ? 'type' THEN v_type ELSE s.shop_type END,
         registration_number = CASE WHEN p_patch ? 'registration' THEN v_registration ELSE s.registration_number END,
         logo_url            = CASE WHEN p_patch ? 'logo' THEN v_logo ELSE s.logo_url END,
         licence_url         = CASE WHEN p_patch ? 'licence' THEN v_licence ELSE s.licence_url END,
         cnic_front_url      = CASE WHEN p_patch ? 'cnic_front' THEN v_cnic_front ELSE s.cnic_front_url END,
         cnic_back_url       = CASE WHEN p_patch ? 'cnic_back' THEN v_cnic_back ELSE s.cnic_back_url END
   WHERE s.id = v_shop
  RETURNING to_jsonb(s) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'NO_BUSINESS';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'shop', jsonb_build_object(
      'id',                  v_row -> 'id',
      'name',                v_row -> 'name',
      'phone',               v_row -> 'phone',
      'whatsapp_phone',      v_row -> 'whatsapp_phone',
      'email',               v_row -> 'email',
      'address',             v_row -> 'address',
      'city',                v_row -> 'city',
      'shop_type',           v_row -> 'shop_type',
      'registration_number', v_row -> 'registration_number',
      'logo_url',            v_row -> 'logo_url',
      'licence_url',         v_row -> 'licence_url',
      'cnic_front_url',      v_row -> 'cnic_front_url',
      'cnic_back_url',       v_row -> 'cnic_back_url'
    )
  );
END;
$function$;


NOTIFY pgrst, 'reload schema';

-- Assertion: each of the seven functions now carries the recognized guard string.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(f.fn ORDER BY f.fn) INTO v_missing
    FROM (
      VALUES ('create_co_owner_invitation'), ('update_co_owner_grant'),
             ('delete_finance_entry'), ('update_finance_entry'),
             ('delete_payment_reminder'), ('record_finance_entry'),
             ('update_business_profile')
    ) AS f(fn)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = f.fn
        AND pg_get_functiondef(p.oid) LIKE '%authorize_tenant_membership%'
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0293: functions still without the recognized guard: %', array_to_string(v_missing, ', ');
  END IF;
END $$;
