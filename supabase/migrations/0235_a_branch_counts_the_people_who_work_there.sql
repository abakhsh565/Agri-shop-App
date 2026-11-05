-- ═══════════════════════════════════════════════════════════════════════════════
-- 0235 — A branch counts the people who work there
--
-- WHY. The Settings card answered "1 employee" in a shop whose Employees screen listed
-- five people, and an owner read that as the card being broken. It was not broken; it
-- was answering a narrower question. `employee_count` counted only members whose branch
-- SCOPE named that branch — and an account that was never given a branch, or a shop
-- whose people were all invited before scopes existed, therefore counted at no branch
-- at all. The one person who did have a scope was the only one the card could see.
--
-- WHAT CHANGED. The count now comes from the same population the Employees screen draws
-- from — active memberships of this shop, owners included — and it is split the way
-- stock and receivables already are: whoever the roster assigns to a branch counts at
-- that branch, and whoever it assigns nowhere sits on the MAIN branch. So a shop of
-- five people reads five on the branch they work in, instead of one, and a second
-- branch reads only the people actually assigned to it.
--
-- WHAT DID NOT CHANGE. Every other column of this function, including the `inventory.view`
-- / `customers.view` gated figures from 0234 and the `employees.view` gate on this one:
-- a caller without the permission still gets NULL, never a number. No table, trigger,
-- write path or index is touched — this is one replacement of the same read function.
--
-- WHY OWNERS COUNT. The Employees screen lists the owner, and the card is read next to
-- it. Excluding owners made a one-owner shop with staff read one short of its own roster
-- for a reason the screen never states. A deactivated account is NOT counted: the card
-- answers who works here now, and the screen marks those rows "Deactivated" beside them.
--
-- WHY THE REMAINDER IS ON MAIN. Same rule as 0234, for the same reason: the split must
-- account for everyone on the roster, and an unassigned person belongs to the shop's
-- home branch until somebody assigns them. A person scoped to two branches counts at
-- both — the card answers "how many people work here", not "how many does the business
-- employ", so branch counts are not summed to a total.
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
    -- Every active branch of the shop, not only the visible ones: the remainder is only
    -- correct if it is measured against all the places stock could sit.
    SELECT b.id, b.tenant_id, b.is_default, b.created_at
      FROM public.branches b
     WHERE b.is_active AND b.tenant_id = public.current_shop_id()
  ),
  net AS (
    -- What this branch received minus what it sold, per variant. Summed from the ledger
    -- so a sale, a return, an adjustment and a purchase all count the same way.
    SELECT m.branch_id, m.variant_id, sum(m.qty_change) AS qty
      FROM public.inventory_movements m
      JOIN branches_of_shop bs ON bs.id = m.branch_id
     GROUP BY m.branch_id, m.variant_id
  ),
  stock AS (
    -- Valued at today's cost, and only where the branch is holding something: a variant
    -- that left more than it arrived contributes zero, never a negative shelf.
    SELECT n.branch_id,
           COALESCE(sum(n.qty * pv.cost_price) FILTER (WHERE n.qty > 0 AND pv.cost_price > 0), 0) AS value,
           COALESCE(bool_or(n.qty > 0 AND COALESCE(pv.cost_price, 0) <= 0), false) AS incomplete
      FROM net n
      JOIN public.product_variants pv ON pv.id = n.variant_id
      JOIN public.products p ON p.id = pv.product_id
     WHERE p.is_active AND pv.is_active
       AND p.shop_id = public.current_shop_id()
     GROUP BY n.branch_id
  ),
  shop_stock AS (
    -- The business total, computed the way the overview always computed it.
    SELECT COALESCE(sum(pv.stock_qty * pv.cost_price)
             FILTER (WHERE pv.stock_qty > 0 AND pv.cost_price > 0), 0) AS value
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
     WHERE p.is_active AND pv.is_active
       AND p.shop_id = public.current_shop_id()
  ),
  stock_total AS (
    SELECT COALESCE(sum(COALESCE(st.value, 0)), 0) AS value
      FROM branches_of_shop b
      LEFT JOIN stock st ON st.branch_id = b.id
  ),
  billed AS (
    -- What this branch put on credit and has not been paid for at the till.
    SELECT s.branch_id, COALESCE(sum(s.amount_due), 0) AS amount
      FROM public.sales s
     WHERE s.shop_id = public.current_shop_id() AND s.is_voided = false
     GROUP BY s.branch_id
  ),
  collected AS (
    -- Money taken in against old bills, at the branch it was taken.
    SELECT cp.branch_id, COALESCE(sum(cp.amount), 0) AS amount
      FROM public.customer_payments cp
      JOIN public.customers c ON c.id = cp.customer_id
     WHERE c.shop_id = public.current_shop_id() AND c.is_archived = false
     GROUP BY cp.branch_id
  ),
  branch_credit AS (
    SELECT b.id AS branch_id,
           GREATEST(COALESCE(bl.amount, 0) - COALESCE(co.amount, 0), 0) AS amount
      FROM branches_of_shop b
      LEFT JOIN billed bl ON bl.branch_id = b.id
      LEFT JOIN collected co ON co.branch_id = b.id
  ),
  shop_credit AS (
    SELECT COALESCE(sum(GREATEST(c.outstanding_balance, 0)), 0) AS amount
      FROM public.customers c
     WHERE c.shop_id = public.current_shop_id() AND c.is_archived = false
  ),
  credit_total AS (
    SELECT COALESCE(sum(COALESCE(bc.amount, 0)), 0) AS amount
      FROM branches_of_shop b
      LEFT JOIN branch_credit bc ON bc.branch_id = b.id
  ),
  main_branch AS (
    -- The branch the account registered with: the one that carries what cannot be attributed.
    SELECT b.id FROM branches_of_shop b ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
  ),
  shop_staff AS (
    -- Everyone still on the team, counted once: the same active members the Employees
    -- screen lists, owners included.
    SELECT count(DISTINCT m.user_id)::int AS people
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id() AND m.status = 'active'
  ),
  assigned_staff AS (
    -- The part of the roster the branch scope can attribute, one row per branch. A person
    -- scoped to two branches counts at both.
    SELECT b.id AS branch_id, count(DISTINCT m.user_id)::int AS people
      FROM branches_of_shop b
      JOIN public.memberships m
        ON m.tenant_id = b.tenant_id AND m.status = 'active'
       AND b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
     GROUP BY b.id
  ),
  staff_attributed AS (
    -- How many people the roster places somewhere in this shop. Whatever is left over
    -- sits on main, exactly like unattributed stock and receivables.
    SELECT count(DISTINCT m.user_id)::int AS people
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id() AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM branches_of_shop bs
                    WHERE bs.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[])))
  )
  SELECT
    b.id, b.tenant_id, b.name::text, b.role, b.status,
    (b.id = public.current_branch_id()), b.is_default, b.created_at,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('employees.view')
      THEN COALESCE(asg.people, 0)
           + CASE WHEN b.id = (SELECT id FROM main_branch)
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
           + CASE WHEN b.id = (SELECT id FROM main_branch)
                  THEN (SELECT value FROM shop_stock) - (SELECT value FROM stock_total)
                  ELSE 0 END
      ELSE NULL::numeric END,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('inventory.view')
      THEN COALESCE(st.incomplete, false)
      ELSE NULL::boolean END,
    CASE WHEN b.role = 'owner' OR public.has_effective_permission('customers.view')
      THEN COALESCE(bc.amount, 0)
           + CASE WHEN b.id = (SELECT id FROM main_branch)
                  THEN (SELECT amount FROM shop_credit) - (SELECT amount FROM credit_total)
                  ELSE 0 END
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

-- The ledger is read a group at a time, per branch and variant, on every branch list.
-- Without this the aggregate walks the whole movement table for every branch read.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_variant
  ON public.inventory_movements (branch_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_branch
  ON public.customer_payments (branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_branch_due
  ON public.sales (branch_id) WHERE is_voided = false;

-- Assert the shape rather than trusting the write: a replayed or half-applied file must
-- not leave the app reading a function that is missing one of the three new columns.
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
    RAISE EXCEPTION '0235: get_my_branches() is missing';
  END IF;
  IF NOT (v_cols @> ARRAY['inventory_value', 'inventory_cost_incomplete', 'credit_outstanding']) THEN
    RAISE EXCEPTION '0235: get_my_branches() does not report the branch figures (found %)', array_to_string(v_cols, ', ');
  END IF;

  RAISE NOTICE '0235: a branch counts the people who work there';
END
$assert$;
