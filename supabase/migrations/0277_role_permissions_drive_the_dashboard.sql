-- 0277 — A role's permissions decide its widgets, and an employee can only reduce that role.
--
-- Owner's decision, 2026-11-01:
--   * no manual dashboard tick-list while creating a role;
--   * a widget may need more than one permission;
--   * an individual employee setting may take access away but can never add any;
--   * a role that people hold cannot be deleted;
--   * Owner and system roles are protected;
--   * Staff and Manager are ordinary, editable roles that every shop starts with.
--
-- The database is the authority for each rule. The screens repeat it, but a direct RPC call
-- reaches the same refusal.

-- ── 1. A widget can require several permissions ────────────────────────────────────────────────
ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS required_permissions text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.dashboard_widgets
   SET required_permissions = CASE key
     WHEN 'sales_overview'       THEN ARRAY['sales.view']
     WHEN 'revenue_analysis'     THEN ARRAY['sales.view', 'reports.view']
     WHEN 'expense_analysis'     THEN ARRAY['purchases.view', 'reports.view']
     WHEN 'profit_loss'          THEN ARRAY['sales.view', 'purchases.view', 'reports.view']
     WHEN 'customer_outstanding' THEN ARRAY['customers.view']
     WHEN 'inventory_position'   THEN ARRAY['inventory.view', 'products.view']
     WHEN 'supplier_payables'    THEN ARRAY['companies.view', 'purchases.view']
     WHEN 'team_performance'     THEN ARRAY['employees.view', 'reports.view']
     WHEN 'money_movements'      THEN ARRAY['payments.view', 'reports.view']
     WHEN 'quick_alerts'         THEN ARRAY['alerts.view']
     ELSE CASE WHEN default_permission IS NULL THEN ARRAY[]::text[] ELSE ARRAY[default_permission] END
   END
 WHERE cardinality(required_permissions) = 0;

COMMENT ON COLUMN public.dashboard_widgets.required_permissions IS
  'Every permission a member needs before this block is shown. Empty falls back to default_permission. The role screen never writes role_dashboards for an employee; it previews this computation.';

-- ── 2. Only the role supplies access; an employee override can only deny ─────────────────────
CREATE OR REPLACE FUNCTION public.employee_overrides_restrict_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_override AND NEW.is_granted THEN
    RAISE EXCEPTION 'ACCESS_GRANT_NOT_ALLOWED: an individual employee setting can only remove permissions from the assigned role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employee_overrides_restrict_only ON public.user_permissions;
CREATE TRIGGER employee_overrides_restrict_only
  BEFORE INSERT OR UPDATE OF is_override, is_granted ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.employee_overrides_restrict_only();

COMMENT ON FUNCTION public.employee_overrides_restrict_only() IS
  'An employee-level row may deny a role permission, never grant a new one. This closes the direct-RPC path as well as the screen (0277).';

-- The resolver keeps the active-branch role, but no longer unions granted overrides.
CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_role_id uuid;
  v_branch_role uuid;
  v_branch uuid;
  v_permissions text[];
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' THEN
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM public.permissions;
  ELSE
    v_role_id := v_member.role_id;
    -- Only the caller's own access follows the branch they are working in. An owner looking
    -- at somebody else gets that membership's default role.
    IF v_user = v_actor THEN
      v_branch := public.current_branch_id();
      IF v_branch IS NOT NULL THEN
        SELECT mbr.role_id INTO v_branch_role
          FROM public.membership_branch_roles mbr
         WHERE mbr.membership_id = v_member.id AND mbr.branch_id = v_branch;
        v_role_id := COALESCE(v_branch_role, v_role_id);
      END IF;
    END IF;

    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM (
      SELECT p.code
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = v_member.tenant_id
       WHERE rp.role_id = v_role_id
      EXCEPT
      SELECT p.code
        FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;

  RETURN to_jsonb(COALESCE(v_permissions, '{}'::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_effective_permissions(uuid) FROM PUBLIC, anon;

-- ── 3. The dashboard is the eligible catalogue, not a stored tick-list ───────────────────────
CREATE OR REPLACE FUNCTION public.get_my_dashboards()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user    uuid := public.app_current_user_id();
  v_member  public.memberships;
  v_grant   public.co_owner_grants;
  v_keys    text[];
BEGIN
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- The owner sees the whole catalogue.
  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    SELECT array_agg(key ORDER BY sort_order, key) INTO v_keys FROM public.dashboard_widgets;
    RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
  END IF;

  -- A Co-Owner keeps the explicit delegation the owner gave them, now also bounded by
  -- every permission the block requires.
  IF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN RETURN '[]'::jsonb; END IF;

    SELECT COALESCE(array_agg(w.key ORDER BY w.sort_order, w.key), '{}'::text[])
      INTO v_keys
      FROM public.co_owner_dashboards d
      JOIN public.dashboard_widgets w ON w.key = d.widget_key
     WHERE d.grant_id = v_grant.id
       AND d.visible
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(
             CASE WHEN cardinality(w.required_permissions) > 0
                  THEN w.required_permissions
                  ELSE ARRAY[w.default_permission]
             END
           ) AS required(code)
          WHERE required.code IS NOT NULL
            AND NOT public.has_effective_permission(required.code)
       );
    RETURN to_jsonb(v_keys);
  END IF;

  -- An employee sees EVERY eligible block. role_dashboards is no longer consulted here;
  -- it survives only as historical data from older roles.
  SELECT COALESCE(array_agg(w.key ORDER BY w.sort_order, w.key), '{}'::text[])
    INTO v_keys
    FROM public.dashboard_widgets w
   WHERE NOT EXISTS (
     SELECT 1
       FROM unnest(
         CASE WHEN cardinality(w.required_permissions) > 0
              THEN w.required_permissions
              ELSE ARRAY[w.default_permission]
         END
       ) AS required(code)
      WHERE required.code IS NOT NULL
        AND NOT public.has_effective_permission(required.code)
   );

  RETURN to_jsonb(v_keys);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_dashboards() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_dashboards() FROM PUBLIC, anon;

-- ── 4. A role in use cannot disappear, and system/Owner roles are protected ──────────────────
CREATE OR REPLACE FUNCTION public.delete_role(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid := (payload->>'roleId')::uuid;
  v_system boolean;
  v_name text;
  v_assigned int := 0;
BEGIN
  v_tenant := public.authorize_business_action('settings.edit');

  SELECT is_system, name INTO v_system, v_name
    FROM public.roles
   WHERE id = v_id AND tenant_id = v_tenant;
  IF v_system IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  IF v_system OR lower(btrim(v_name)) IN ('owner', 'business owner', 'shop owner') THEN
    RAISE EXCEPTION 'SYSTEM_ROLE_READ_ONLY: built-in and Owner roles cannot be deleted';
  END IF;

  SELECT count(DISTINCT m.id) INTO v_assigned
    FROM public.memberships m
    LEFT JOIN public.membership_branch_roles mbr ON mbr.membership_id = m.id
   WHERE m.tenant_id = v_tenant
     AND (m.role_id = v_id OR mbr.role_id = v_id);

  IF v_assigned > 0 THEN
    RAISE EXCEPTION 'ROLE_IN_USE: % employee(s) still hold this role; reassign them first', v_assigned;
  END IF;

  DELETE FROM public.roles WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (public.app_current_user_id(), 'role_deleted', 'role', v_id,
          jsonb_build_object('name', v_name));

  RETURN jsonb_build_object('id', v_id, 'deleted', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_role(jsonb) TO authenticated;

COMMENT ON FUNCTION public.delete_role(jsonb) IS
  'Deletes an unused, non-system role. Refuses a built-in/Owner role and any role still assigned to an employee or a branch.';

-- ── 5. Every shop starts with editable Staff and Manager roles ────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_shop_default_roles(p_shop uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_staff uuid;
  v_manager uuid;
  v_dept uuid;
BEGIN
  IF p_shop IS NULL THEN RETURN; END IF;

  SELECT id INTO v_dept
    FROM public.departments
   WHERE tenant_id = p_shop AND code = 'sales'
   LIMIT 1;

  SELECT id INTO v_staff FROM public.roles
   WHERE tenant_id = p_shop AND lower(name) = 'staff' LIMIT 1;
  IF v_staff IS NULL THEN
    INSERT INTO public.roles
      (tenant_id, name, description, is_system, department_id, role_category, responsibility_level, data_scope)
    VALUES
      (p_shop, 'Staff', 'Shop-floor work: sales, customers and stock visibility.',
       false, v_dept, 'sales', 'individual_contributor', 'branches')
    RETURNING id INTO v_staff;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_staff, p.id
      FROM public.permissions p
     WHERE p.code = ANY (ARRAY[
       'sales.view','sales.create','customers.view','customers.create',
       'products.view','inventory.view'
     ])
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO v_dept
    FROM public.departments
   WHERE tenant_id = p_shop AND code = 'management'
   LIMIT 1;

  SELECT id INTO v_manager FROM public.roles
   WHERE tenant_id = p_shop AND lower(name) = 'manager' LIMIT 1;
  IF v_manager IS NULL THEN
    INSERT INTO public.roles
      (tenant_id, name, description, is_system, department_id, role_category, responsibility_level, data_scope)
    VALUES
      (p_shop, 'Manager', 'Runs the branch day to day, including people and reports.',
       false, v_dept, 'business_management', 'manager', 'branches')
    RETURNING id INTO v_manager;

    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT v_manager, p.id
      FROM public.permissions p
     WHERE p.code = ANY (ARRAY[
       'sales.view','sales.create','sales.void',
       'customers.view','customers.create','customers.edit','customers.payments','customers.credit_limit',
       'products.view','inventory.view','inventory.adjust',
       'purchases.view','purchases.create','companies.view',
       'payments.view','payments.supplier',
       'returns.view','returns.create','reports.view','employees.view','alerts.view'
     ])
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_shop_default_roles(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_default_roles_after_shop()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_shop_default_roles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_default_roles_after_shop ON public.shops;
CREATE TRIGGER seed_default_roles_after_shop
  AFTER INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_roles_after_shop();

-- Existing shops get the same two starting roles exactly once.
DO $$
DECLARE v_shop uuid;
BEGIN
  FOR v_shop IN SELECT id FROM public.shops LOOP
    PERFORM public.ensure_shop_default_roles(v_shop);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- 0277: name the retired function(s) in the server-only set the ACL guard
-- unions across migrations, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['ensure_shop_default_roles'];
  v_name text;
  v_sig text;
  v_open int;
BEGIN
  FOREACH v_name IN ARRAY v_server_only LOOP
    FOR v_sig IN
      SELECT p.oid::regprocedure::text
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    END LOOP;
  END LOOP;
  SELECT count(*) INTO v_open
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (v_server_only)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_open > 0 THEN
    RAISE EXCEPTION '0277: % server-only function(s) are still executable by an API role', v_open;
  END IF;
  RAISE NOTICE '0277: the server-only functions are closed';
END
$server_only$;
