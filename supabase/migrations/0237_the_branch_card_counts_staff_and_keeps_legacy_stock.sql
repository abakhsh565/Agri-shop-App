-- ═══════════════════════════════════════════════════════════════════════════════
-- 0237 — The branch card counts staff, not owners, and keeps legacy stock visible
--
-- WHY. 0236 removed the remainder-to-main rule, which was right, and in doing so made
-- two mistakes of its own, both found by reading the development card against the data:
--
--   1. OWNERS COUNTED AT EVERY BRANCH. "An owner runs every branch" is true of access,
--      not of a headcount. A shop with two owners and two staff read "4 employees" on a
--      branch where two people actually work, and a QA shop with six owner memberships
--      read "8 employees" on a branch holding one worker. The card says Employees; an
--      owner is labelled Owner on the team screen and is not counted here.
--
--   2. STOCK WITH NO MOVEMENTS VANISHED. A variant seeded before branch stamping (or
--      imported with a quantity and no receipt) has `stock_qty` but no ledger rows, so
--      every branch reported 0 while the product screen listed units on hand. That is
--      not a per-branch answer, it is a missing one.
--
-- THE RULE NOW.
--   • Inventory — this branch's own ledger net at today's cost. A variant with NO
--     movement anywhere is stock the ledger never saw: its whole `stock_qty` sits on the
--     shop's DEFAULT branch, the branch the business was registered with. It is not
--     copied to other branches and it is never a remainder of other branches' stock —
--     once a variant has any branch-stamped movement, only those movements count.
--   • Employees — active, non-owner members the roster ties to this branch: an explicit
--     `branch_scope` entry or an explicit `membership_branch_roles` row (the per-branch
--     map 0233 introduced). A member scoped to two branches counts at both; a member
--     scoped nowhere counts nowhere. Suspended and invited accounts do not count.
--   • Outstanding credit — unchanged from 0236 and still strictly the branch's own:
--     `sales.amount_due` billed there less `customer_payments` collected there, floored
--     at zero. Customer balances that no sale or payment explains are bookkeeping drift,
--     not another branch's receivable, and are not placed on any branch.
--
-- Everything else — the other columns, the three permission gates, the NULL contract —
-- is exactly 0236. No table, trigger, write path or index is touched.
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
    -- Legacy rows may name a branch only when there is exactly one it could be.
    SELECT (array_agg(b.id))[1] AS id
      FROM branches_of_shop b
    HAVING count(*) = 1
  ),
  default_branch AS (
    -- The branch the business was registered with: where stock the ledger never saw sits.
    SELECT b.id FROM branches_of_shop b
     ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
  ),
  net AS (
    -- This branch's own ledger, per variant.
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
    -- A variant with no movement at all has never been branch-stamped. Its shelf belongs
    -- to the default branch; it is not spread across branches and not a remainder.
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
  branch_staff AS (
    -- Working people, not owners. COUNT DISTINCT keeps a person on one row per branch
    -- even when both the scope and the per-branch role name it.
    SELECT b.id AS branch_id, count(DISTINCT m.user_id)::int AS people
      FROM branches_of_shop b
      JOIN public.memberships m
        ON m.tenant_id = b.tenant_id AND m.status = 'active' AND m.role <> 'owner'
     WHERE b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
        OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                    WHERE mbr.membership_id = m.id AND mbr.branch_id = b.id)
     GROUP BY b.id
  )
  SELECT
    b.id, b.tenant_id, b.name::text, b.role, b.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN COALESCE(staff.people, 0)
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
  LEFT JOIN branch_staff staff ON staff.branch_id = b.id
  LEFT JOIN public.membership_branch_roles mbr
    ON mbr.membership_id = b.membership_id AND mbr.branch_id = b.id
  LEFT JOIN public.roles r ON r.id = COALESCE(mbr.role_id, b.role_id)
  ORDER BY b.is_default DESC, b.created_at, b.id;
$$;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;

DO $assert$
DECLARE
  v_cols text[];
BEGIN
  SELECT array_agg(a.attname ORDER BY a.attname) INTO v_cols
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(p.proargnames) WITH ORDINALITY AS a(attname, ord)
   WHERE n.nspname = 'public' AND p.proname = 'get_my_branches' AND p.pronargs = 0;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION '0237: get_my_branches() is missing';
  END IF;
  IF NOT (v_cols @> ARRAY['inventory_value', 'inventory_cost_incomplete', 'credit_outstanding']) THEN
    RAISE EXCEPTION '0237: get_my_branches() does not report the branch figures (found %)', array_to_string(v_cols, ', ');
  END IF;

  RAISE NOTICE '0237: the branch card counts staff and keeps legacy stock';
END
$assert$;
