-- Correct the existing context, not a second identity or role system.
-- History and existing branch assignments are not moved or guessed.
ALTER TABLE public.user_active_shops
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- Allowed branches are distinct from the branch currently being worked in.
-- Only an owner has implicit global branch authority. A missing employee/admin
-- scope is an empty effective scope, never permission to see every branch.
CREATE OR REPLACE FUNCTION public.allowed_branch_scope()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN m.role = 'owner' THEN NULL::uuid[]
              ELSE COALESCE(m.branch_scope, '{}'::uuid[]) END
    FROM public.membership_in_active_shop(NULL) m
  UNION ALL
  SELECT '{}'::uuid[] WHERE NOT EXISTS (
    SELECT 1 FROM public.membership_in_active_shop(NULL)
  );
$$;
REVOKE ALL ON FUNCTION public.allowed_branch_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allowed_branch_scope() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_branch_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id
    FROM public.branches b
    JOIN public.memberships m ON m.tenant_id = b.tenant_id
     AND m.user_id = public.app_current_user_id() AND m.status = 'active'
    LEFT JOIN public.user_active_shops a ON a.user_id = m.user_id
     AND a.shop_id = b.tenant_id
   WHERE b.tenant_id = public.current_shop_id() AND b.is_active
     AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
   ORDER BY (b.id = a.branch_id) DESC NULLS LAST, b.is_default DESC, b.created_at, b.id
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_branch_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_branch_id() TO authenticated;

-- Operational screens work in ONE selected branch. Authorized branch-list
-- summaries use the membership's allowed scope, not this working selection.
CREATE OR REPLACE FUNCTION public.current_branch_scope()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN public.current_branch_id() IS NULL THEN '{}'::uuid[]
              ELSE ARRAY[public.current_branch_id()] END;
$$;
REVOKE ALL ON FUNCTION public.current_branch_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_branch_scope() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_active_branch(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_branch public.branches;
  v_member public.memberships;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_branch FROM public.branches WHERE id = p_branch_id AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  SELECT * INTO v_member FROM public.memberships
   WHERE user_id = v_actor AND tenant_id = v_branch.tenant_id AND status = 'active';
  IF NOT FOUND OR (v_member.role <> 'owner' AND
     NOT (p_branch_id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  INSERT INTO public.user_active_shops(user_id, shop_id, branch_id, updated_at)
  VALUES (v_actor, v_branch.tenant_id, p_branch_id, now())
  ON CONFLICT(user_id) DO UPDATE
    SET shop_id = EXCLUDED.shop_id, branch_id = EXCLUDED.branch_id, updated_at = now();
  RETURN jsonb_build_object('success', true, 'tenant_id', v_branch.tenant_id,
    'branch_id', v_branch.id, 'branch_name', v_branch.name,
    'membership_role', v_member.role, 'membership_id', v_member.id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_active_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_branch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.authorize_business_action(
  p_permission varchar, p_tenant_id uuid DEFAULT NULL, p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_branch uuid := COALESCE(p_branch_id, public.current_branch_id());
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL OR
     (p_tenant_id IS NOT NULL AND v_member.tenant_id IS DISTINCT FROM p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission(p_permission, v_actor) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission %', p_permission;
  END IF;
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = v_branch
     AND b.tenant_id = v_member.tenant_id AND b.is_active
     AND (v_member.role = 'owner' OR b.id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied'; END IF;
  RETURN v_member.tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_business_action(varchar, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_business_action(varchar, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_branch_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_branch public.branches;
BEGIN
  -- Trusted background work must still state valid ownership. It is never
  -- authenticated merely because a caller supplied an actor field.
  IF v_actor IS NULL THEN
    IF current_setting('role', true) = 'authenticated' THEN
      RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := public.default_branch_id((to_jsonb(NEW)->>'shop_id')::uuid);
    END IF;
    IF NEW.branch_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches WHERE id = NEW.branch_id
    ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  -- A definer UPDATE must not be allowed to move an inaccessible OLD record
  -- into the actor's branch. Check OLD before considering NEW.
  IF TG_OP = 'UPDATE' AND (
    OLD.branch_id IS DISTINCT FROM public.current_branch_id() OR
    NEW.branch_id IS DISTINCT FROM OLD.branch_id
  ) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied'; END IF;

  NEW.branch_id := COALESCE(NEW.branch_id, public.current_branch_id());
  SELECT * INTO v_branch FROM public.branches WHERE id = NEW.branch_id AND is_active;
  IF v_branch.id IS NULL OR v_branch.tenant_id IS DISTINCT FROM v_member.tenant_id OR
     NEW.branch_id IS DISTINCT FROM public.current_branch_id() OR
     ((to_jsonb(NEW)->>'shop_id') IS NOT NULL AND
      (to_jsonb(NEW)->>'shop_id')::uuid IS DISTINCT FROM v_member.tenant_id) OR
     (v_member.role <> 'owner' AND
      NOT (NEW.branch_id = ANY(COALESCE(v_member.branch_scope, '{}'::uuid[])))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  RETURN NEW;
END;
$$;

-- State RLS activation explicitly: policies on a table with RLS disabled
-- provide no boundary (including when restoring a schema snapshot).
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales','purchases','returns','inventory_movements',
    'customer_payments','supplier_payments','stock_adjustments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_branch_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
      USING (branch_id = ANY(public.current_branch_scope()))', t || '_branch_select', t);
  END LOOP;
END $$;

-- The existing branch directory policy lacked the branch half of its boundary.
DROP POLICY IF EXISTS branches_select_tenant ON public.branches;
CREATE POLICY branches_select_tenant ON public.branches FOR SELECT TO authenticated
  USING (tenant_id = public.current_shop_id() AND
    (public.allowed_branch_scope() IS NULL OR id = ANY(public.allowed_branch_scope())));

-- Changing a TABLE result requires replacing the old signature, not silently
-- retaining shop_id as a branch id. All consumers must use the explicit fields.
DROP FUNCTION IF EXISTS public.get_my_branches();
CREATE FUNCTION public.get_my_branches()
RETURNS TABLE (
  branch_id uuid, tenant_id uuid, name text,
  membership_role public.membership_role, membership_status public.membership_status,
  is_current boolean, is_main boolean, created_at timestamptz,
  employee_count int, product_count int, customer_count int, sales_count int,
  sales_total numeric, address text, latitude double precision, longitude double precision,
  location_label text, location_source text, marketplace_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT b.id, b.tenant_id, b.name::text, m.role, m.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN (SELECT count(*)::int FROM public.memberships x
        WHERE x.tenant_id = b.tenant_id AND x.status = 'active' AND x.role <> 'owner'
         AND b.id = ANY(COALESCE(x.branch_scope, '{}'::uuid[]))) ELSE NULL::int END,
    -- Products/customers are tenant-owned today. Do not invent a branch count
    -- or expose tenant-wide counts to a branch-limited reader.
    NULL::int, NULL::int,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT count(*)::int FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::int END,
    CASE WHEN m.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT COALESCE(sum(v.total_amount), 0) FROM public.sales v
        WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id) ELSE NULL::numeric END,
    b.address::text, b.latitude, b.longitude, b.location_label, b.location_source,
    s.marketplace_enabled
  FROM public.memberships m
  JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
  JOIN public.shops s ON s.id = b.tenant_id
  WHERE m.user_id = public.app_current_user_id() AND m.status = 'active'
    AND m.tenant_id = public.current_shop_id()
    AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
  ORDER BY b.is_default DESC, b.created_at, b.id;
$$;
REVOKE ALL ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;

-- Do not retroactively invent assignments for malformed historical members.
-- Validate future changes; old NULL scopes are effectively denied above.
CREATE OR REPLACE FUNCTION public.validate_member_branch_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  -- The existing users INSERT trigger provisions a membership before the
  -- invitation writer supplies its scope. Keep that intermediate NULL denied;
  -- normal enrollment sets an explicit scope in the same transaction.
  IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(NEW.branch_scope) x
      WHERE x IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.branches b WHERE b.id = x
          AND b.tenant_id = NEW.tenant_id AND b.is_active
      )
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_member_branch_scope_trg ON public.memberships;
CREATE TRIGGER validate_member_branch_scope_trg BEFORE INSERT OR UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.validate_member_branch_scope();

NOTIFY pgrst, 'reload schema';
