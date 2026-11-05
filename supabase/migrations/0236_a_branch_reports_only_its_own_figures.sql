-- ═══════════════════════════════════════════════════════════════════════════════
-- 0236 — A branch reports only its own figures
--
-- WHY. 0234 split stock and receivables across branches, but kept the business totals
-- intact by dumping everything the ledgers could not attribute onto the main branch.
-- 0235 did the same for people. The result was arithmetically tidy and practically
-- misleading: a main branch with no stock, no sale and no assigned person still read
-- "40,000 credit" and "3 employees", and an owner who switched into it could not tell
-- whose money or whose people those were. The requirement is the opposite of a tidy
-- total: the selected branch's card must show only what belongs to that branch, even
-- when that leaves something out.
--
-- THE RULE, per figure, with no remainder anywhere:
--   • Inventory value — the branch's own net movements (received minus sold, returned,
--     adjusted) valued at each variant's current cost; a variant that left more than it
--     arrived is worth zero there, never a negative shelf.
--   • Employees — active people the roster associates with this branch: an explicit
--     `branch_scope` entry, an explicit `membership_branch_roles` row (the per-branch
--     map 0233 introduced), or a NULL scope, which 0233 defines as "all branches".
--     Owners hold a NULL scope and therefore count at every branch they run. Suspended
--     and deactivated accounts do not count. The count is never pushed onto one branch
--     to make the shop's roster add up.
--   • Outstanding credit — what this branch billed (`sales.amount_due`, not voided) less
--     what was collected at this branch (`customer_payments.branch_id`), floored at
--     zero. A payment taken at one branch does not reduce another branch's receivables,
--     and a customer balance the ledgers cannot place is not invented on main.
--
-- LEGACY ROWS. A row written before branch stamping has `branch_id IS NULL`. It is
-- attributed to a branch only when the shop has exactly ONE active branch — there is
-- nowhere else it could have happened. In a shop with several branches such a row
-- belongs to no branch and appears in none of them; guessing a branch would be exactly
-- the mixing this migration removes.
--
-- WHAT DOES NOT CHANGE. Every other column of `get_my_branches()`, the three permission
-- gates (`employees.view`, `inventory.view`, `customers.view`), and the NULL contract
-- that makes the card print "—" instead of a figure the caller may not see. No table,
-- trigger, write path or index is touched.
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
    -- The branches this caller may see, exactly the set the previous version returned.
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
  net AS (
    -- This branch's own ledger: received minus sold, returned and adjusted, per variant.
    -- `branch_id IS NULL` rows join only when `only_branch` has an answer.
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
  stock AS (
    -- Valued at today's cost, only where the branch is holding something.
    SELECT n.branch_id,
           COALESCE(sum(n.qty * v.cost_price)
             FILTER (WHERE n.qty > 0 AND v.cost_price > 0), 0) AS value,
           COALESCE(bool_or(n.qty > 0 AND COALESCE(v.cost_price, 0) <= 0), false) AS incomplete
      FROM net n
      JOIN public.product_variants v ON v.id = n.variant_id
      JOIN public.products p ON p.id = v.product_id
     WHERE p.is_active AND v.is_active
       AND p.shop_id = public.current_shop_id()
     GROUP BY n.branch_id
  ),
  billed AS (
    -- What this branch put on credit.
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
    -- Money taken at this branch against old bills.
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
    -- Active people associated with this branch, and only them. COUNT DISTINCT keeps a
    -- person on one row per branch even when scope and per-branch role both name it.
    SELECT b.id AS branch_id, count(DISTINCT m.user_id)::int AS people
      FROM branches_of_shop b
      JOIN public.memberships m
        ON m.tenant_id = b.tenant_id AND m.status = 'active'
     WHERE m.role = 'owner'                    -- an owner runs every branch
        OR m.branch_scope IS NULL              -- 0233: NULL scope means all branches
        OR b.id = ANY(m.branch_scope)          -- explicitly scoped here
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

-- Assert the shape rather than trusting the write: a replayed or half-applied file must
-- not leave the app reading a function that is missing one of the three branch columns.
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
    RAISE EXCEPTION '0236: get_my_branches() is missing';
  END IF;
  IF NOT (v_cols @> ARRAY['inventory_value', 'inventory_cost_incomplete', 'credit_outstanding']) THEN
    RAISE EXCEPTION '0236: get_my_branches() does not report the branch figures (found %)', array_to_string(v_cols, ', ');
  END IF;

  RAISE NOTICE '0236: a branch reports only its own figures';
END
$assert$;
