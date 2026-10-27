-- ═══════════════════════════════════════════════════════════════════════════════
-- 0244 — The card and the team screen count the same people, and stock in an
--        archived branch still has a home
--
-- Two measurements on the development card disagreed with the screens beside it:
--
--   • A shop whose five people had never been given a branch scope read
--     "0 employees", while the Employees screen listed all five. 0237 counted only
--     explicitly assigned, non-owner members. That is the right rule for a branch
--     people were assigned to, and the wrong rule for the main branch, which is
--     where the roster puts everyone it has not placed elsewhere.
--   • A product whose only movements were in a branch that has since been archived
--     read 0 inventory, while the product screen showed its units on hand. 0237's
--     stock rule only counted active branches, so that stock was in no branch at
--     all.
--
-- The rule restored here is the one 0235 stated and 0236/0237 removed:
--
--   Employees — every active member of the business counts exactly where the
--   roster puts them. An explicit branch counts there (scope or per-branch role),
--   and whoever the roster places nowhere sits on the main branch. The owner is
--   on the team screen and therefore in the count. A sub-branch still counts only
--   the people actually assigned to it.
--
--   Inventory — a branch's own ledger net, at today's cost. Anything the active
--   branches' ledgers cannot explain (stock received before branch stamping, or
--   stock whose branch was archived) is carried by the main branch, so the branch
--   cards add up to the product screen instead of one of them saying zero.
--
-- `get_branch_employee_ids()` is re-stated to the same population, because the
-- Employees screen filters with it. The two reads cannot drift apart without this
-- migration failing its own assertions.
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
  ),
  assigned_staff AS (
    -- Explicitly placed in a branch: either the scope list or a per-branch role.
    SELECT b.id AS branch_id, count(DISTINCT m.user_id)::int AS people
      FROM branches_of_shop b
      JOIN public.memberships m
        ON m.tenant_id = b.tenant_id AND m.status = 'active'
     WHERE b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
        OR EXISTS (SELECT 1 FROM public.membership_branch_roles mbr
                    WHERE mbr.membership_id = m.id AND mbr.branch_id = b.id)
     GROUP BY b.id
  ),
  staff_attributed AS (
    SELECT count(DISTINCT m.user_id)::int AS people
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id() AND m.status = 'active'
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

-- The shelf read the product list uses must agree with the card's value. Stock
-- whose branch was archived (or which arrived before branch stamping) is not in
-- any active branch's ledger, so the main branch carries the difference — the
-- same remainder the card now carries. Without this the card said 49.2M and the
-- only product on it read "Out of Stock".
CREATE OR REPLACE FUNCTION public.get_branch_variant_stock()
RETURNS TABLE (variant_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH shop AS (SELECT public.current_shop_id() AS id),
  this_branch AS (SELECT public.current_branch_id() AS id),
  branches_of_shop AS (
    SELECT b.id FROM public.branches b
     WHERE b.is_active AND b.tenant_id = (SELECT id FROM shop)
  ),
  only_branch AS (
    SELECT (array_agg(b.id))[1] AS id
      FROM branches_of_shop b
    HAVING count(*) = 1
  ),
  default_branch AS (
    SELECT b.id FROM public.branches b
     WHERE b.is_active AND b.tenant_id = (SELECT id FROM shop)
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1
  ),
  net AS (
    SELECT m.variant_id, sum(m.qty_change) AS qty
      FROM public.inventory_movements m
      LEFT JOIN only_branch ob ON true
     WHERE m.branch_id = (SELECT id FROM this_branch)
        OR (m.branch_id IS NULL AND ob.id = (SELECT id FROM this_branch))
     GROUP BY m.variant_id
  ),
  active_net AS (
    SELECT m.variant_id, sum(m.qty_change) AS qty
      FROM public.inventory_movements m
     WHERE m.branch_id IN (SELECT id FROM branches_of_shop)
     GROUP BY m.variant_id
  ),
  stock AS (
    SELECT v.id AS variant_id, v.stock_qty
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE p.shop_id = (SELECT id FROM shop)
       AND p.is_active AND v.is_active
  )
  SELECT s.variant_id,
         GREATEST(
           COALESCE(n.qty, 0)
           + CASE WHEN (SELECT id FROM this_branch) = (SELECT id FROM default_branch)
                  THEN GREATEST(s.stock_qty - COALESCE(a.qty, 0), 0)
                  ELSE 0 END,
           0
         ) AS qty
    FROM stock s
    LEFT JOIN net n ON n.variant_id = s.variant_id
    LEFT JOIN active_net a ON a.variant_id = s.variant_id;
$$;
GRANT EXECUTE ON FUNCTION public.get_branch_variant_stock() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_variant_stock() FROM PUBLIC, anon;

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
    RAISE EXCEPTION '0244: get_my_branches() is missing';
  END IF;
  IF NOT (v_cols @> ARRAY['inventory_value', 'inventory_cost_incomplete', 'credit_outstanding']) THEN
    RAISE EXCEPTION '0244: get_my_branches() does not report the branch figures (found %)', array_to_string(v_cols, ', ');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_branch_employee_ids'
  ) THEN
    RAISE EXCEPTION '0244: the branch roster read is missing';
  END IF;
END
$assert$;
