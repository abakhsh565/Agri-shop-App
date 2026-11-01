-- 0267 — Co-Owner hardening from the first implementation review.
--
-- Additive only. It closes four gaps left by 0266:
--   1. a brand-new Co-Owner got a users row but no auth login;
--   2. the employee trigger checked branch/role but not the invite/deactivate flags,
--      the assignable-role ceiling or department scope;
--   3. a Co-Owner could write a user_permissions override through the employee RPC;
--   4. supplier/customer gates covered reads but not every write path.

-- ── 1. Provision the login for a newly invited Co-Owner ─────────────────────
CREATE OR REPLACE FUNCTION public.co_owner_provision_login()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.provision_member_login(NEW.user_id);
  EXCEPTION WHEN OTHERS THEN
    -- The invitation and its record are preserved exactly as create_employee does;
    -- the owner can repair the login, and the failure is auditable rather than silent.
    INSERT INTO public.audit_events
      (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
    VALUES
      (public.app_current_user_id(), 'co_owner_login_provision_failed', 'user', NEW.user_id,
       NEW.tenant_id, NEW.id, jsonb_build_object('reason', SQLERRM));
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS co_owner_provision_login_trg ON public.co_owner_grants;
CREATE TRIGGER co_owner_provision_login_trg
  AFTER INSERT ON public.co_owner_grants
  FOR EACH ROW EXECUTE FUNCTION public.co_owner_provision_login();

-- ── 2. Membership guard: flags, role ceiling, department, owner protection ───
CREATE OR REPLACE FUNCTION public.guard_co_owner_membership_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_actor_member public.memberships;
  v_grant public.co_owner_grants;
  v_target public.memberships;
  v_role_ok boolean;
  v_invited boolean;
  v_dept uuid;
  v_dept_ok boolean;
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_actor_member FROM public.membership_in_active_shop(v_actor);

  -- A new Co-Owner can only be created by the original owner. An invited
  -- person may activate their own membership; nobody else may.
  IF NEW.access_kind = 'co_owner' AND NEW.role = 'employee' THEN
    IF v_actor_member.id IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.co_owner_grants g
         WHERE g.membership_id = NEW.id AND g.user_id = NEW.user_id
           AND g.status IN ('invited', 'active')
      ) INTO v_invited;
      IF NOT v_invited THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: no invitation to activate';
      END IF;
    ELSIF v_actor_member.role <> 'owner' AND v_actor_member.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: only the original owner can appoint a Co-Owner';
    ELSIF v_actor_member.user_id = NEW.user_id AND v_actor_member.role <> 'owner' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.co_owner_grants g
         WHERE g.membership_id = NEW.id AND g.user_id = NEW.user_id
           AND g.status IN ('invited', 'active')
      ) INTO v_invited;
      IF NOT v_invited THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: no invitation to activate';
      END IF;
    END IF;
  END IF;

  -- The original owner's own membership is never a Co-Owner target.
  IF NEW.role = 'owner' AND (v_actor_member.id IS NULL OR v_actor_member.role <> 'owner') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot change the original owner membership';
  END IF;

  -- A Co-Owner editing employee access must stay inside every delegated ceiling.
  IF v_actor_member.access_kind = 'co_owner' AND v_actor_member.id IS NOT NULL THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_actor_member.id AND g.status = 'active';
    IF v_grant.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active grant'; END IF;
    IF NEW.tenant_id <> v_grant.tenant_id THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: employee is outside this business';
    END IF;
    IF NEW.user_id = v_actor THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: a Co-Owner cannot edit their own membership';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      SELECT * INTO v_target FROM public.memberships WHERE id = OLD.id FOR UPDATE;
      IF v_target.role = 'owner' OR v_target.access_kind = 'co_owner' THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot edit the owner or another Co-Owner';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'suspended'
         AND NOT v_grant.can_deactivate_employees THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: employee deactivation is not delegated';
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status = 'suspended' AND NEW.status = 'active'
         AND NOT v_grant.can_deactivate_employees THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: employee reactivation is not delegated';
      END IF;
    ELSE
      IF NOT v_grant.can_invite_employees THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: employee invitations are not delegated';
      END IF;
    END IF;

    IF NEW.access_kind <> 'standard' OR NEW.role <> 'employee' THEN
      RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE';
    END IF;
    -- ensure_user_membership() creates the bootstrap membership immediately
    -- after the user row. create_employee_core() follows with the real branch
    -- scope and role in the same transaction; that UPDATE is still validated
    -- below. A bootstrap row left un-updated has no branch and therefore no
    -- data access at all.
    IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL AND NEW.status = 'active' THEN
      RETURN NEW;
    END IF;
    IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
      SELECT 1 FROM unnest(NEW.branch_scope) x
       WHERE NOT public.co_owner_branch_allowed(v_grant.id, x)
    ) THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: outside the Co-Owner grant';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.co_owner_assignable_roles ar
       WHERE ar.grant_id = v_grant.id AND ar.role_id = NEW.role_id
    ) INTO v_role_ok;
    IF NEW.role_id IS NULL OR NOT v_role_ok THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: role is not in the Co-Owner assignment ceiling';
    END IF;

    SELECT r.department_id INTO v_dept
      FROM public.roles r WHERE r.id = NEW.role_id AND r.tenant_id = v_grant.tenant_id;
    SELECT COALESCE((
      SELECT CASE
        WHEN s.departments_mode = 'all' THEN true
        WHEN s.departments_mode = 'selected' AND v_dept IS NOT NULL THEN EXISTS (
          SELECT 1 FROM public.co_owner_department_scopes ds
           WHERE ds.grant_id = v_grant.id AND ds.department_id = v_dept)
        ELSE false END
      FROM public.co_owner_scope_settings s WHERE s.grant_id = v_grant.id
    ), false) INTO v_dept_ok;
    IF NOT v_dept_ok THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: employee department is outside the Co-Owner grant';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Access editor: enforce the assignable-role ceiling and its permissions ─
CREATE OR REPLACE FUNCTION public.guard_employee_access_edit(payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.authorize_business_action('employees.manage');
  v_target public.memberships;
  v_actor public.memberships;
  v_grant public.co_owner_grants;
  v_scope uuid[];
  v_role uuid;
  v_code text;
  v_granted boolean;
  v_dept uuid;
BEGIN
  SELECT * INTO v_actor FROM public.membership_in_active_shop(NULL);
  SELECT * INTO v_target FROM public.memberships WHERE user_id = (payload->>'employeeId')::uuid
    AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_target.role = 'owner' OR v_target.access_kind = 'co_owner' THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_actor.role <> 'owner' AND (v_target.user_id = v_actor.user_id OR v_target.role <> 'employee' OR
    v_target.branch_scope IS NULL OR NOT (v_target.branch_scope <@ COALESCE(v_actor.branch_scope, '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: employee access exceeds your branch scope';
  END IF;
  IF payload ? 'branchScope' THEN
    IF jsonb_typeof(payload->'branchScope') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required';
    END IF;
    SELECT array_agg(DISTINCT value::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope');
    IF v_scope IS NULL OR cardinality(v_scope) = 0 OR EXISTS (
      SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM public.branches b
        WHERE b.id = x AND b.tenant_id = v_tenant AND b.is_active)
    ) OR (v_actor.role <> 'owner' AND NOT (v_scope <@ COALESCE(v_actor.branch_scope, '{}'::uuid[]))) THEN
      RAISE EXCEPTION 'INVALID_BRANCH_SCOPE';
    END IF;
  END IF;
  v_role := COALESCE(NULLIF(payload->>'roleId', '')::uuid, v_target.role_id);
  IF v_role IS NULL OR NOT EXISTS(SELECT 1 FROM public.roles WHERE id = v_role AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  SELECT * INTO v_grant FROM public.co_owner_grants
   WHERE membership_id = v_actor.id AND status = 'active';
  IF v_grant.id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.co_owner_assignable_roles ar
      WHERE ar.grant_id = v_grant.id AND ar.role_id = v_role) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: role is not in the Co-Owner assignment ceiling';
    END IF;
    SELECT r.department_id INTO v_dept FROM public.roles r WHERE r.id = v_role;
    IF NOT COALESCE((
      SELECT CASE
        WHEN s.departments_mode = 'all' THEN true
        WHEN s.departments_mode = 'selected' AND v_dept IS NOT NULL THEN EXISTS (
          SELECT 1 FROM public.co_owner_department_scopes ds
           WHERE ds.grant_id = v_grant.id AND ds.department_id = v_dept)
        ELSE false END
      FROM public.co_owner_scope_settings s WHERE s.grant_id = v_grant.id
    ), false) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: role department is outside the Co-Owner grant';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = v_role
         AND NOT EXISTS (SELECT 1 FROM public.co_owner_permissions cp
           WHERE cp.grant_id = v_grant.id AND cp.permission_id = p.id)
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: assignable role exceeds the Co-Owner permission ceiling';
    END IF;
  END IF;

  IF v_actor.role <> 'owner' THEN
    IF EXISTS(SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = v_role AND NOT public.has_effective_permission(p.code)) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
    END IF;
    FOR v_code, v_granted IN SELECT key, value::boolean FROM jsonb_each_text(COALESCE(payload->'overrides', '{}'::jsonb)) LOOP
      IF v_granted AND NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
      IF v_granted AND v_grant.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = v_role AND p.code = v_code
      ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: override exceeds the assignable role';
      END IF;
    END LOOP;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
      IF NOT public.has_effective_permission(v_code::varchar) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: cannot grant permissions you do not hold';
      END IF;
      IF v_grant.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = v_role AND p.code = v_code
      ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED: permission exceeds the assignable role';
      END IF;
    END LOOP;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_employee_access_edit(jsonb) FROM PUBLIC, anon, authenticated;

-- ── 4. A direct override write by a Co-Owner must obey the same ceiling ──────
CREATE OR REPLACE FUNCTION public.guard_co_owner_permission_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_actor_member public.memberships;
  v_grant public.co_owner_grants;
  v_target public.memberships;
  v_role uuid;
BEGIN
  IF v_actor IS NULL OR NOT COALESCE(NEW.is_override, false) THEN RETURN NEW; END IF;
  SELECT * INTO v_actor_member FROM public.membership_in_active_shop(v_actor);
  IF v_actor_member.id IS NULL OR v_actor_member.access_kind <> 'co_owner' THEN RETURN NEW; END IF;
  SELECT * INTO v_grant FROM public.co_owner_grants
   WHERE membership_id = v_actor_member.id AND status = 'active';
  IF v_grant.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active grant'; END IF;
  SELECT * INTO v_target FROM public.memberships
   WHERE user_id = NEW.user_id AND tenant_id = v_grant.tenant_id;
  IF v_target.id IS NULL OR v_target.access_kind <> 'standard' OR v_target.role <> 'employee'
     OR v_target.user_id = v_actor THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot write this employee permission';
  END IF;
  v_role := v_target.role_id;
  IF v_role IS NULL OR NOT EXISTS (SELECT 1 FROM public.co_owner_assignable_roles ar
    WHERE ar.grant_id = v_grant.id AND ar.role_id = v_role) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: role is not in the Co-Owner assignment ceiling';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
     WHERE rp.role_id = v_role AND rp.permission_id = NEW.permission_id
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: permission exceeds the assignable role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_co_owner_permission_write_trg ON public.user_permissions;
CREATE TRIGGER guard_co_owner_permission_write_trg
  BEFORE INSERT OR UPDATE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_co_owner_permission_write();

-- ── 5. Employee visibility follows branch + department scope ─────────────────
CREATE OR REPLACE FUNCTION public.co_owner_employee_visible(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
  v_target public.memberships;
  v_dept uuid;
BEGIN
  IF NOT public.is_co_owner() THEN RETURN true; END IF;
  IF p_user_id = public.app_current_user_id() THEN RETURN true; END IF;
  SELECT * INTO v_grant FROM public.co_owner_current_grant();
  IF v_grant.id IS NULL THEN RETURN false; END IF;
  SELECT m.* INTO v_target FROM public.memberships m
   WHERE m.user_id = p_user_id AND m.tenant_id = v_grant.tenant_id;
  IF v_target.id IS NULL OR v_target.role = 'owner' OR v_target.access_kind = 'co_owner' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM unnest(COALESCE(v_target.branch_scope, '{}'::uuid[])) x
     WHERE public.co_owner_branch_allowed(v_grant.id, x)
  ) THEN RETURN false; END IF;
  SELECT r.department_id INTO v_dept FROM public.roles r WHERE r.id = v_target.role_id;
  RETURN COALESCE((
    SELECT CASE
      WHEN s.departments_mode = 'all' THEN true
      WHEN s.departments_mode = 'selected' AND v_dept IS NOT NULL THEN EXISTS (
        SELECT 1 FROM public.co_owner_department_scopes ds
         WHERE ds.grant_id = v_grant.id AND ds.department_id = v_dept)
      ELSE false END
    FROM public.co_owner_scope_settings s WHERE s.grant_id = v_grant.id
  ), false);
END;
$$;
REVOKE ALL ON FUNCTION public.co_owner_employee_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.co_owner_employee_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS co_owner_employee_gate_users ON public.users;
CREATE POLICY co_owner_employee_gate_users ON public.users AS RESTRICTIVE
  FOR SELECT TO authenticated USING (public.co_owner_employee_visible(id));

-- ── 6. Write gates for supplier and assigned-record boundaries ───────────────
DROP POLICY IF EXISTS co_owner_supplier_write_purchases ON public.purchases;
CREATE POLICY co_owner_supplier_write_purchases ON public.purchases AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (public.co_owner_supplier_visible(company_id));
DROP POLICY IF EXISTS co_owner_supplier_update_purchases ON public.purchases;
CREATE POLICY co_owner_supplier_update_purchases ON public.purchases AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (public.co_owner_supplier_visible(company_id))
  WITH CHECK (public.co_owner_supplier_visible(company_id));

DROP POLICY IF EXISTS co_owner_supplier_write_supplier_payments ON public.supplier_payments;
CREATE POLICY co_owner_supplier_write_supplier_payments ON public.supplier_payments AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (public.co_owner_supplier_visible(company_id));
DROP POLICY IF EXISTS co_owner_supplier_update_supplier_payments ON public.supplier_payments;
CREATE POLICY co_owner_supplier_update_supplier_payments ON public.supplier_payments AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (public.co_owner_supplier_visible(company_id))
  WITH CHECK (public.co_owner_supplier_visible(company_id));

DROP POLICY IF EXISTS co_owner_record_update_customers ON public.customers;
CREATE POLICY co_owner_record_update_customers ON public.customers AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (public.co_owner_customer_visible(id))
  WITH CHECK (public.co_owner_customer_visible(id));
DROP POLICY IF EXISTS co_owner_record_delete_customers ON public.customers;
CREATE POLICY co_owner_record_delete_customers ON public.customers AS RESTRICTIVE
  FOR DELETE TO authenticated USING (public.co_owner_customer_visible(id));

DROP POLICY IF EXISTS co_owner_record_write_sales ON public.sales;
CREATE POLICY co_owner_record_write_sales ON public.sales AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (customer_id IS NULL OR public.co_owner_customer_visible(customer_id));

DROP POLICY IF EXISTS co_owner_record_write_customer_payments ON public.customer_payments;
CREATE POLICY co_owner_record_write_customer_payments ON public.customer_payments AS RESTRICTIVE
  FOR INSERT TO authenticated WITH CHECK (public.co_owner_customer_visible(customer_id));

-- ── 7. Pending invitation is readable by the invitee only ─────────────────────
CREATE OR REPLACE FUNCTION public.get_my_pending_co_owner_invitation()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'grantId', g.id, 'businessName', s.name, 'status', g.status,
    'invitedAt', g.invited_at, 'expiresAt', g.expires_at,
    'invitedBy', u.name, 'tenantId', g.tenant_id)
  FROM public.co_owner_grants g
  JOIN public.shops s ON s.id = g.tenant_id
  LEFT JOIN public.users u ON u.id = g.granted_by
  WHERE g.user_id = public.app_current_user_id()
    AND g.status = 'invited'
    AND (g.expires_at IS NULL OR g.expires_at > now())
  ORDER BY g.created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_pending_co_owner_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_co_owner_invitation() TO authenticated;

-- ── 8. Repair: ensure every live Co-Owner has a login identity ───────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT g.id, g.user_id
      FROM public.co_owner_grants g
     WHERE g.status IN ('invited', 'active', 'suspended')
       AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = g.user_id)
  LOOP
    BEGIN
      PERFORM public.provision_member_login(r.user_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.audit_events
        (user_id, action, entity_type, entity_id, tenant_id, co_owner_grant_id, details)
      SELECT public.app_current_user_id(), 'co_owner_login_repair_failed', 'user', r.user_id,
             g.tenant_id, g.id, jsonb_build_object('reason', SQLERRM)
        FROM public.co_owner_grants g WHERE g.id = r.id;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
