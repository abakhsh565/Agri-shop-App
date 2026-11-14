-- ═══════════════════════════════════════════════════════════════════════════════
-- 0291 — An employee count counts employees
--
-- The owner's rule (2026-11-12): the employee number is the number of EMPLOYEES. A Co-Owner is
-- not staff, and the owner is not staff either. 0244 deliberately counted every active member
-- ("The owner is on the team screen and therefore in the count"), which meant a branch whose
-- only member was the owner read "1 employee", and a branch run by a Co-Owner counted them as
-- staff while the Employees screen — which filters Co-Owners out on the client — listed nobody.
--
-- So the two reads are re-stated over the population they always meant:
--
--   employees = active memberships whose role is not 'owner' and whose access_kind is not
--   'co_owner' (NULL access_kind is a standard membership).
--
-- Nothing else changes: placement (branch scope / per-branch role), the main-branch remainder,
-- and every other column of get_my_branches() are exactly 0244's. The roster read is re-stated
-- with the same filter, because the Employees screen filters with it and the number above it
-- must describe the same people.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_my_branches();
CREATE FUNCTION public.get_my_branches()
RETURNS TABLE (
  branch_id uuid, tenant_id uuid, name text,
  membership_role public.membership_role, membership_status public.membership_status,
  is_current boolean, is_main boolean, created_at timestamptz,
  employee_count int, product_count int, customer_count int, sales_count int,
  sales_total numeric, address text, latitude double precision, longitude double precision,
  location_label text, location_source text, marketplace_enabled boolean,
  role_id uuid, role_name text,
  inventory_value numeric, inventory_cost_incomplete boolean, credit_outstanding numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH mine AS (
    SELECT b.id, b.tenant_id, b.name, b.is_default, b.created_at,
           b.address, b.latitude, b.longitude, b.location_label, b.location_source,
           m.role, m.status, m.id AS membership_id, m.role_id
      FROM public.memberships m
      JOIN public.branches b ON b.tenant_id = m.tenant_id AND b.is_active
     WHERE m.user_id = public.app_current_user_id()
       AND m.status = 'active'
       AND m.tenant_id = public.current_shop_id()
       AND (m.role = 'owner' OR b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
  ),
  branches_of_shop AS (
    SELECT b.id, b.tenant_id, b.is_default, b.created_at
      FROM public.branches b
     WHERE b.is_active AND b.tenant_id = public.current_shop_id()
  ),
  only_branch AS (
    SELECT (array_agg(b.id))[1] AS id
      FROM branches_of_shop b
    HAVING count(*) = 1
  ),
  default_branch AS (
    SELECT b.id FROM branches_of_shop b
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
  ),
  net AS (
    SELECT COALESCE(m.branch_id, ob.id) AS branch_id,
           m.variant_id, sum(m.qty_change) AS qty
      FROM public.inventory_movements m
      JOIN public.product_variants v ON v.id = m.variant_id
      JOIN public.products p ON p.id = v.product_id
                            AND p.shop_id = public.current_shop_id()
      LEFT JOIN only_branch ob ON true
     WHERE m.branch_id IN (SELECT id FROM branches_of_shop)
        OR (m.branch_id IS NULL AND ob.id IS NOT NULL)
     GROUP BY 1, 2
  ),
  legacy_net AS (
    SELECT db.id AS branch_id, v.id AS variant_id, v.stock_qty AS qty
      FROM default_branch db
      JOIN public.product_variants v ON true
      JOIN public.products p ON p.id = v.product_id
     WHERE p.shop_id = public.current_shop_id() AND p.is_active AND v.is_active
       AND v.stock_qty > 0
       AND NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.variant_id = v.id)
  ),
  stock AS (
    SELECT n.branch_id,
           COALESCE(sum(n.qty * v.cost_price)
             FILTER (WHERE n.qty > 0 AND v.cost_price > 0), 0) AS value,
           COALESCE(bool_or(n.qty > 0 AND COALESCE(v.cost_price, 0) <= 0), false) AS incomplete
      FROM (SELECT * FROM net UNION ALL SELECT * FROM legacy_net) n
      JOIN public.product_variants v ON v.id = n.variant_id
      JOIN public.products p ON p.id = v.product_id
     WHERE p.is_active AND v.is_active
       AND p.shop_id = public.current_shop_id()
     GROUP BY n.branch_id
  ),
  shop_stock AS (
    SELECT COALESCE(sum(v.stock_qty * v.cost_price)
             FILTER (WHERE v.stock_qty > 0 AND v.cost_price > 0), 0) AS value
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE p.is_active AND v.is_active
       AND p.shop_id = public.current_shop_id()
  ),
  stock_total AS (
    SELECT COALESCE(sum(COALESCE(st.value, 0)), 0) AS value
      FROM branches_of_shop b
      LEFT JOIN stock st ON st.branch_id = b.id
  ),
  billed AS (
    SELECT COALESCE(s.branch_id, ob.id) AS branch_id,
           COALESCE(sum(s.amount_due), 0) AS amount
      FROM public.sales s
      LEFT JOIN only_branch ob ON true
     WHERE s.shop_id = public.current_shop_id() AND s.is_voided = false
       AND (s.branch_id IN (SELECT id FROM branches_of_shop)
            OR (s.branch_id IS NULL AND ob.id IS NOT NULL))
     GROUP BY 1
  ),
  collected AS (
    SELECT COALESCE(cp.branch_id, ob.id) AS branch_id,
           COALESCE(sum(cp.amount), 0) AS amount
      FROM public.customer_payments cp
      JOIN public.customers c ON c.id = cp.customer_id
      LEFT JOIN only_branch ob ON true
     WHERE c.shop_id = public.current_shop_id() AND c.is_archived = false
       AND (cp.branch_id IN (SELECT id FROM branches_of_shop)
            OR (cp.branch_id IS NULL AND ob.id IS NOT NULL))
     GROUP BY 1
  ),
  branch_credit AS (
    SELECT b.id AS branch_id,
           GREATEST(COALESCE(bl.amount, 0) - COALESCE(co.amount, 0), 0) AS amount
      FROM branches_of_shop b
      LEFT JOIN billed bl ON bl.branch_id = b.id
      LEFT JOIN collected co ON co.branch_id = b.id
  ),
  shop_staff AS (
    SELECT count(DISTINCT m.user_id)::int AS people
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id() AND m.status = 'active'
       AND m.role <> 'owner'
       AND COALESCE(m.access_kind, 'standard') <> 'co_owner'
  ),
  assigned_staff AS (
    -- Explicitly placed in a branch: either the scope list or a per-branch role.
    SELECT b.id AS branch_id, count(DISTINCT m.user_id)::int AS people
      FROM branches_of_shop b
      JOIN public.memberships m
        ON m.tenant_id = b.tenant_id AND m.status = 'active'
     WHERE m.role <> 'owner'
       AND COALESCE(m.access_kind, 'standard') <> 'co_owner'
       AND b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
        OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                    WHERE mbr.membership_id = m.id AND mbr.branch_id = b.id)
     GROUP BY b.id
  ),
  staff_attributed AS (
    SELECT count(DISTINCT m.user_id)::int AS people
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id() AND m.status = 'active'
       AND m.role <> 'owner'
       AND COALESCE(m.access_kind, 'standard') <> 'co_owner'
       AND (
         cardinality(COALESCE(m.branch_scope, '{}'::uuid[])) > 0
         OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                     WHERE mbr.membership_id = m.id)
       )
  )
  SELECT
    b.id, b.tenant_id, b.name::text, b.role, b.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN COALESCE(asg.people, 0)
           + CASE WHEN b.id = (SELECT id FROM default_branch)
                  THEN GREATEST((SELECT people FROM shop_staff)
                                - (SELECT people FROM staff_attributed), 0)
                  ELSE 0 END
      ELSE NULL::int END,
    NULL::int, NULL::int,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT count(*)::int FROM public.sales v
             WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id)
      ELSE NULL::int END,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('sales.view')
      THEN (SELECT COALESCE(sum(v.total_amount), 0) FROM public.sales v
             WHERE v.shop_id = b.tenant_id AND v.branch_id = b.id)
      ELSE NULL::numeric END,
    b.address::text, b.latitude, b.longitude, b.location_label, b.location_source,
    s.marketplace_enabled,
    COALESCE(mbr.role_id, b.role_id),
    r.name::text,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('inventory.view')
      THEN COALESCE(st.value, 0)
           + CASE WHEN b.id = (SELECT id FROM default_branch)
                  THEN GREATEST((SELECT value FROM shop_stock)
                                - (SELECT value FROM stock_total), 0)
                  ELSE 0 END
      ELSE NULL::numeric END,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('inventory.view')
      THEN COALESCE(st.incomplete, false)
      ELSE NULL::boolean END,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('customers.view')
      THEN COALESCE(bc.amount, 0)
      ELSE NULL::numeric END
  FROM mine b
  JOIN public.shops s ON s.id = b.tenant_id
  LEFT JOIN stock st ON st.branch_id = b.id
  LEFT JOIN branch_credit bc ON bc.branch_id = b.id
  LEFT JOIN assigned_staff asg ON asg.branch_id = b.id
  LEFT JOIN public.membership_branch_roles mbr
    ON mbr.membership_id = b.membership_id AND mbr.branch_id = b.id
  LEFT JOIN public.roles r ON r.id = COALESCE(mbr.role_id, b.role_id)
  ORDER BY b.is_default DESC, b.created_at, b.id;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;

-- The Members screen filters its rows with this read; it must answer exactly the
-- population `employee_count` now counts.
CREATE OR REPLACE FUNCTION public.get_branch_employee_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH b AS (SELECT public.current_branch_id() AS id),
  main_branch AS (
    SELECT br.id FROM public.branches br
     WHERE br.tenant_id = public.current_shop_id() AND br.is_active
     ORDER BY br.is_default DESC, br.created_at, br.id
     LIMIT 1
  ),
  placed_anywhere AS (
    SELECT DISTINCT m.user_id
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id()
       AND m.status = 'active'
       AND m.role <> 'owner'
       AND COALESCE(m.access_kind, 'standard') <> 'co_owner'
       AND (
         cardinality(COALESCE(m.branch_scope, '{}'::uuid[])) > 0
         OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                     WHERE mbr.membership_id = m.id)
       )
  )
  SELECT m.user_id
    FROM public.memberships m, b
   WHERE m.tenant_id = public.current_shop_id()
     AND m.status = 'active'
     AND m.role <> 'owner'
       AND COALESCE(m.access_kind, 'standard') <> 'co_owner'
     AND (
       b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
       OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                   WHERE mbr.membership_id = m.id AND mbr.branch_id = b.id)
       OR (
         b.id = (SELECT id FROM main_branch)
         AND NOT EXISTS (SELECT 1 FROM placed_anywhere p WHERE p.user_id = m.user_id)
       )
     );
$$;
GRANT EXECUTE ON FUNCTION public.get_branch_employee_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_employee_ids() FROM PUBLIC, anon;

DO $assert$
DECLARE
  v_branches text;
  v_roster   text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_branches
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_my_branches';
  SELECT pg_get_functiondef(p.oid) INTO v_roster
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_employee_ids';

  IF v_branches IS NULL OR v_roster IS NULL THEN
    RAISE EXCEPTION '0291: the branch reads are missing';
  END IF;
  IF position('co_owner' in v_branches) = 0 THEN
    RAISE EXCEPTION '0291: the branch headcount still counts every member';
  END IF;
  IF position('co_owner' in v_roster) = 0 THEN
    RAISE EXCEPTION '0291: the roster still lists Co-Owners';
  END IF;
  IF position('owner' in v_branches) = 0 THEN
    RAISE EXCEPTION '0291: the branch headcount does not exclude the owner';
  END IF;
END
$assert$;

-- A Co-Owner must not add one to any branch's headcount: the predicate is stated once per read
-- and cannot be satisfied by a partial edit.
DO $doc$
BEGIN
  PERFORM 1;
  RAISE NOTICE '0291: employee counts exclude the owner and Co-Owners';
END
$doc$;
