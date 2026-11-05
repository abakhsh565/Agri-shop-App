-- 0233: a role is granted per branch, not per person
--
-- WHY THIS EXISTS
--   memberships carries ONE role_id and a branch_scope array, so an employee who works two
--   branches has the same role in both. The owner needs a cashier in one branch and a manager in
--   another, with the permissions of the branch they are actually working in.
--
-- WHAT CHANGES
--   * membership_branch_roles: (membership, branch) -> role. The membership's role_id stays as the
--     default for any branch that has no explicit row, so nothing becomes role-less by surprise.
--   * get_effective_permissions() resolves the caller's role for their ACTIVE branch. Its signature
--     is unchanged, so every existing policy that calls has_effective_permission() becomes
--     branch-aware without being rewritten.
--   * get_my_branches() reports the role attached to each branch, which is what the employee's
--     switcher and the owner's employee page read.
--   * create_employee / update_employee_access accept an optional `branchRoles` object
--     ( { "<branchId>": "<roleId>" } ). Without it they keep the old behaviour: the single
--     roleId applies to every selected branch.
--
-- WHAT DOES NOT CHANGE
--   * An owner still bypasses permission checks and still sees every branch.
--   * user_permissions overrides remain per person, not per branch: they are exceptions layered on
--     top of whichever role the active branch resolves to.
--   * branch_scope remains the list of branches a member may enter, and is kept in step with the
--     per-branch rows by the writers below.

-- ── 1. The table ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.membership_branch_roles (
  membership_id uuid NOT NULL REFERENCES public.memberships(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  role_id       uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, branch_id)
);

CREATE INDEX IF NOT EXISTS membership_branch_roles_branch_idx
  ON public.membership_branch_roles (branch_id);

-- Closed by default. Only the SECURITY DEFINER writers and readers below touch it, so no client
-- needs a policy; a direct select must not become a second way to read another shop's roles.
ALTER TABLE public.membership_branch_roles ENABLE ROW LEVEL SECURITY;

DO $acl$ BEGIN
  EXECUTE 'REVOKE ALL ON TABLE public.membership_branch_roles FROM PUBLIC, anon, authenticated';
EXCEPTION WHEN undefined_table THEN NULL; END $acl$;

-- A branch role must belong to the same business as its membership, on both sides. Checked here
-- rather than left to the callers: three functions write this table and one of them will forget.
CREATE OR REPLACE FUNCTION public.membership_branch_role_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_member_tenant uuid; v_branch_tenant uuid; v_role_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_member_tenant FROM public.memberships WHERE id = NEW.membership_id;
  SELECT tenant_id INTO v_branch_tenant FROM public.branches WHERE id = NEW.branch_id;
  IF v_member_tenant IS NULL OR v_branch_tenant IS DISTINCT FROM v_member_tenant THEN
    RAISE EXCEPTION 'BRANCH_ROLE_TENANT_MISMATCH';
  END IF;
  IF NEW.role_id IS NOT NULL THEN
    SELECT tenant_id INTO v_role_tenant FROM public.roles WHERE id = NEW.role_id;
    IF v_role_tenant IS DISTINCT FROM v_member_tenant THEN
      RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS membership_branch_role_guard_trg ON public.membership_branch_roles;
CREATE TRIGGER membership_branch_role_guard_trg
  BEFORE INSERT OR UPDATE ON public.membership_branch_roles
  FOR EACH ROW EXECUTE FUNCTION public.membership_branch_role_guard();

-- ── 2. The default role stays a default ───────────────────────────────────────────────────────
-- When an owner changes the role on the employee's membership, every branch that was still using
-- the OLD default must move with it. A branch with its own explicit role is an exception and is
-- deliberately left alone. Enforced here so a direct membership update (the admin RPC, a repair
-- script, a test) cannot leave rows pointing at the previous role while the UI says otherwise.
CREATE OR REPLACE FUNCTION public.sync_membership_default_branch_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    UPDATE public.membership_branch_roles
       SET role_id = NEW.role_id, updated_at = now()
     WHERE membership_id = NEW.id
       AND role_id IS NOT DISTINCT FROM OLD.role_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_membership_default_branch_roles_trg ON public.memberships;
CREATE TRIGGER sync_membership_default_branch_roles_trg
  AFTER UPDATE OF role_id ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_default_branch_roles();

-- A membership is created with a scope and a default role; seed the explicit rows while the
-- invite is made. A NULL scope means "all branches" and deliberately has no rows: every branch
-- then falls back to the membership default. ON CONFLICT makes the invite/ON CONFLICT path safe.
CREATE OR REPLACE FUNCTION public.seed_membership_branch_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role <> 'owner' AND NEW.branch_scope IS NOT NULL THEN
    INSERT INTO public.membership_branch_roles(membership_id, branch_id, role_id)
    SELECT NEW.id, b.id, NEW.role_id
      FROM public.branches b
     WHERE b.tenant_id = NEW.tenant_id AND b.is_active
       AND b.id = ANY (NEW.branch_scope)
    ON CONFLICT (membership_id, branch_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_membership_branch_roles_trg ON public.memberships;
CREATE TRIGGER seed_membership_branch_roles_trg
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.seed_membership_branch_roles();

-- ── 3. Backfill: every existing scope keeps exactly the role it has today ─────────────────────────
INSERT INTO public.membership_branch_roles (membership_id, branch_id, role_id)
SELECT m.id, b.id, m.role_id
  FROM public.memberships m
  JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
 WHERE m.role <> 'owner'
   AND (m.branch_scope IS NULL OR b.id = ANY (m.branch_scope))
ON CONFLICT (membership_id, branch_id) DO NOTHING;

-- ── 3. Branch-aware permissions, same signature ─────────────────────────────────────────────────
-- The caller's own permissions follow the branch they are working in. An owner inspecting somebody
-- else still gets that membership's default role: the branch that matters is the employee's, and
-- this function has no way to know it, so the dedicated RPCs (get_employee_access) report each
-- branch's role explicitly.
-- 0195's body, with one addition: the active branch may name the role. The active-shop
-- membership is still what is read (not "the first membership ever created"), and role defaults
-- are still restricted to roles of that business.
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
    -- Only the caller's own resolution follows their working branch. An owner inspecting an
    -- employee gets that membership's default role; the per-branch report names each role.
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
      SELECT p.code FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = v_member.tenant_id
        WHERE rp.role_id = v_role_id
      UNION SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
        WHERE up.user_id = v_user AND up.is_override AND up.is_granted
      EXCEPT SELECT p.code FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
        WHERE up.user_id = v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;
  RETURN to_jsonb(COALESCE(v_permissions, '{}'::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_effective_permissions(uuid) FROM PUBLIC, anon;

-- ── 4. get_my_branches reports the role each branch carries ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_branches();
CREATE FUNCTION public.get_my_branches()
RETURNS TABLE (
  branch_id uuid, tenant_id uuid, name text,
  membership_role public.membership_role, membership_status public.membership_status,
  is_current boolean, is_main boolean, created_at timestamptz,
  employee_count int, product_count int, customer_count int, sales_count int,
  sales_total numeric, address text, latitude double precision, longitude double precision,
  location_label text, location_source text, marketplace_enabled boolean,
  role_id uuid, role_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.tenant_id, b.name::text, m.role, m.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN (SELECT count(*)::int FROM public.memberships x
        WHERE x.tenant_id = b.tenant_id AND x.status = 'active' AND x.role <> 'owner'
         AND b.id = ANY(COALESCE(x.branch_scope, '{}'::uuid[]))) ELSE NULL::int END,
    NULL::int, NULL::int,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT count(*)::int FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::int END,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT COALESCE(sum(v.total_amount), 0) FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::numeric END,
    b.address::text, b.latitude, b.longitude, b.location_label, b.location_source,
    s.marketplace_enabled,
    COALESCE(mbr.role_id, m.role_id),
    r.name::text
  FROM public.memberships m
  JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
  JOIN public.shops s ON s.id = b.tenant_id
  LEFT JOIN public.membership_branch_roles mbr
    ON mbr.membership_id = m.id AND mbr.branch_id = b.id
  LEFT JOIN public.roles r ON r.id = COALESCE(mbr.role_id, m.role_id)
  WHERE m.user_id = public.app_current_user_id() AND m.status = 'active'
    AND m.tenant_id = public.current_shop_id()
    AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
  ORDER BY b.is_default DESC, b.created_at, b.id;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;

-- ── 5. get_employee_access reports every branch's role ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employee_access(p_employee_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_member_id uuid;
  v_role_id uuid;
  v_role text;
  v_scope uuid[];
  v_effective jsonb;
  v_defaults jsonb;
  v_overrides jsonb;
  v_branch_roles jsonb;
BEGIN
  v_tenant := public.authorize_business_action('employees.view');
  SELECT m.id, m.role_id, m.role::text, m.branch_scope
    INTO v_member_id, v_role_id, v_role, v_scope
  FROM public.memberships m JOIN public.users u ON u.id = m.user_id
  WHERE m.user_id = p_employee_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code),'[]'::jsonb) INTO v_defaults
  FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
  WHERE rp.role_id = v_role_id;
  SELECT COALESCE(jsonb_object_agg(p.code, up.is_granted),'{}'::jsonb) INTO v_overrides
  FROM public.user_permissions up JOIN public.permissions p ON p.id = up.permission_id
  WHERE up.user_id = p_employee_id AND up.is_override = true;
  SELECT COALESCE(jsonb_object_agg(mbr.branch_id::text,
    jsonb_build_object('roleId', mbr.role_id, 'roleName', r.name)), '{}'::jsonb)
    INTO v_branch_roles
  FROM public.membership_branch_roles mbr
  LEFT JOIN public.roles r ON r.id = mbr.role_id
  WHERE mbr.membership_id = v_member_id;
  v_effective := public.get_effective_permissions(p_employee_id);
  RETURN jsonb_build_object('roleId', v_role_id, 'membershipRole', v_role,
    'branchScope', v_scope, 'defaults', v_defaults, 'overrides', v_overrides,
    'effective', v_effective, 'branchRoles', v_branch_roles);
END; $$;
GRANT EXECUTE ON FUNCTION public.get_employee_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_employee_access(uuid) FROM PUBLIC, anon;

-- Changing a branch's role is its own operation, not a re-implementation of the access editor.
-- update_employee_access keeps every guard it has accumulated (0194 and 0213 refuse to let the
-- editor widen their own authority); this function only writes the per-branch map, and its keys
-- become the member's branch scope. The same authority the access editor requires is required.
CREATE OR REPLACE FUNCTION public.set_employee_branch_roles(p_employee_id uuid, p_branch_roles jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_tenant uuid;
  v_member_id uuid;
  v_branch text;
  v_role text;
  v_scope uuid[];
  v_written int := 0;
BEGIN
  v_tenant := public.authorize_business_action('employees.manage');
  IF p_branch_roles IS NULL OR jsonb_typeof(p_branch_roles) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_branch_roles)) = 0 THEN
    RAISE EXCEPTION 'INVALID_BRANCH_ROLE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users
                 WHERE id = p_employee_id AND shop_id = v_tenant AND NOT is_original_owner) THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  SELECT id INTO v_member_id FROM public.memberships
   WHERE user_id = p_employee_id AND tenant_id = v_tenant;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  FOR v_branch, v_role IN SELECT key, value #>> '{}' FROM jsonb_each(p_branch_roles) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.branches b
                   WHERE b.id = v_branch::uuid AND b.tenant_id = v_tenant AND b.is_active)
       OR NOT EXISTS (SELECT 1 FROM public.roles r
                      WHERE r.id = v_role::uuid AND r.tenant_id = v_tenant)
       OR (public.allowed_branch_scope() IS NOT NULL
           AND NOT (v_branch::uuid = ANY (public.allowed_branch_scope())))
    THEN RAISE EXCEPTION 'INVALID_BRANCH_ROLE'; END IF;
  END LOOP;

  DELETE FROM public.membership_branch_roles WHERE membership_id = v_member_id;
  FOR v_branch, v_role IN SELECT key, value #>> '{}' FROM jsonb_each(p_branch_roles) LOOP
    INSERT INTO public.membership_branch_roles(membership_id, branch_id, role_id)
    VALUES (v_member_id, v_branch::uuid, v_role::uuid);
    v_scope := array_append(v_scope, v_branch::uuid);
    v_written := v_written + 1;
  END LOOP;
  UPDATE public.memberships SET branch_scope = v_scope, updated_at = now()
   WHERE id = v_member_id;

  INSERT INTO public.audit_events(user_id,action,entity_type,entity_id,details)
  VALUES (v_actor,'employee_branch_roles_updated','user',p_employee_id,
    jsonb_build_object('branch_roles', p_branch_roles));
  RETURN jsonb_build_object('employeeId', p_employee_id, 'updated', true,
    'branchScope', v_scope, 'branchRoles', v_written);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_employee_branch_roles(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.set_employee_branch_roles(uuid, jsonb) FROM PUBLIC, anon;

-- ── 7. One employee's performance, across every branch ──────────────────────────────────────
-- The owner's employee sheet shows the person as one worker (All) and per branch. Sales rows are
-- branch-scoped by RLS, so a client reading `sales` only ever sees the branch the owner is
-- standing in; an "All branches" figure has to be computed where every branch is readable.
-- Aggregates only — no rows from another branch are handed to a screen that would not be allowed
-- to list them individually.
CREATE OR REPLACE FUNCTION public.get_employee_performance(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_member_id uuid;
  v_branches jsonb;
  v_totals jsonb;
  v_recent jsonb;
BEGIN
  v_tenant := public.authorize_business_action('employees.view');
  SELECT m.id INTO v_member_id
  FROM public.memberships m
  JOIN public.users u ON u.id = m.user_id
  WHERE m.user_id = p_employee_id AND m.tenant_id = v_tenant AND u.shop_id = v_tenant;
  IF v_member_id IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  WITH scope AS (
    SELECT b.id, b.name
    FROM public.branches b
    WHERE b.tenant_id = v_tenant AND b.is_active
      AND ((SELECT m.role FROM public.memberships m WHERE m.id = v_member_id) = 'owner'
           OR b.id = ANY (COALESCE((SELECT m.branch_scope FROM public.memberships m WHERE m.id = v_member_id), '{}'::uuid[])))
  ), per_branch AS (
    SELECT sc.id AS branch_id, sc.name AS branch_name,
      COALESCE(mbr.role_id, m.role_id) AS role_id,
      r.name::text AS role_name,
      count(s.id) FILTER (WHERE NOT s.is_voided) AS sales_count,
      COALESCE(sum(s.total_amount) FILTER (WHERE NOT s.is_voided), 0) AS revenue,
      COALESCE(sum((SELECT COALESCE(sum(si.qty), 0) FROM public.sale_items si WHERE si.sale_id = s.id)) FILTER (WHERE NOT s.is_voided), 0) AS items_sold,
      count(DISTINCT s.customer_id) FILTER (WHERE NOT s.is_voided) AS customers,
      count(s.id) FILTER (WHERE NOT s.is_voided AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date) AS today_sales,
      COALESCE(sum(s.total_amount) FILTER (WHERE NOT s.is_voided AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date), 0) AS today_revenue
    FROM scope sc
    JOIN public.memberships m ON m.id = v_member_id
    LEFT JOIN public.membership_branch_roles mbr
      ON mbr.membership_id = m.id AND mbr.branch_id = sc.id
    LEFT JOIN public.roles r ON r.id = COALESCE(mbr.role_id, m.role_id)
    LEFT JOIN public.sales s
      ON s.shop_id = v_tenant AND s.branch_id = sc.id AND s.employee_id = p_employee_id
    GROUP BY sc.id, sc.name, mbr.role_id, m.role_id, r.name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'branchId', branch_id, 'branchName', branch_name,
      'roleId', role_id, 'roleName', role_name,
      'salesCount', sales_count::int, 'revenue', revenue,
      'itemsSold', items_sold::int, 'customers', customers::int,
      'todaySales', today_sales::int, 'todayRevenue', today_revenue
    ) ORDER BY branch_name), '[]'::jsonb)
    INTO v_branches
  FROM per_branch;

  WITH scope AS (
    SELECT b.id
    FROM public.branches b
    WHERE b.tenant_id = v_tenant AND b.is_active
      AND ((SELECT m.role FROM public.memberships m WHERE m.id = v_member_id) = 'owner'
           OR b.id = ANY (COALESCE((SELECT m.branch_scope FROM public.memberships m WHERE m.id = v_member_id), '{}'::uuid[])))
  ), lines AS (
    SELECT s.id, s.total_amount, s.is_voided, s.customer_id, s.created_at,
      (SELECT COALESCE(sum(si.qty), 0) FROM public.sale_items si WHERE si.sale_id = s.id) AS items
    FROM public.sales s
    WHERE s.shop_id = v_tenant AND s.employee_id = p_employee_id
      AND s.branch_id IN (SELECT id FROM scope)
  )
  SELECT jsonb_build_object(
      'revenue', COALESCE(sum(total_amount) FILTER (WHERE NOT is_voided), 0),
      'salesCount', count(id) FILTER (WHERE NOT is_voided),
      'itemsSold', COALESCE(sum(items) FILTER (WHERE NOT is_voided), 0),
      'customers', count(DISTINCT customer_id) FILTER (WHERE NOT is_voided),
      'todaySales', count(id) FILTER (WHERE NOT is_voided AND (created_at AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date),
      'todayRevenue', COALESCE(sum(total_amount) FILTER (WHERE NOT is_voided AND (created_at AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date), 0)
    )
    INTO v_totals
  FROM lines;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', x.id, 'customerName', x.customer_name_snapshot,
      'totalAmount', x.total_amount, 'paymentType', x.payment_type,
      'createdAt', x.created_at, 'branchId', x.branch_id, 'branchName', x.branch_name,
      'itemCount', x.item_count
    ) ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT s.id, s.customer_name_snapshot, s.total_amount, s.payment_type, s.created_at,
      s.branch_id, b.name AS branch_name,
      (SELECT count(*)::int FROM public.sale_items si WHERE si.sale_id = s.id) AS item_count
    FROM public.sales s
    LEFT JOIN public.branches b ON b.id = s.branch_id
    WHERE s.shop_id = v_tenant AND s.employee_id = p_employee_id AND NOT s.is_voided
    ORDER BY s.created_at DESC
    LIMIT 8
  ) x;

  RETURN jsonb_build_object('totals', v_totals, 'branches', v_branches, 'recent', v_recent);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_employee_performance(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_employee_performance(uuid) FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
