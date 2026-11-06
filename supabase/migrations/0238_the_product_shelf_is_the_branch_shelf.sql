-- ═══════════════════════════════════════════════════════════════════════════════
-- 0238 — The product shelf is the branch's shelf
--
-- WHY. The Settings card became per-branch in 0234–0237, but the screens that list
-- products still read `product_variants.stock_qty`, which is a SHOP total. An owner
-- working in the main branch therefore saw every catalogue item marked "In Stock"
-- because some branch held stock — even when the selected branch held none of it. The
-- catalogue itself is a shop-level record (a product may be sold in any branch); the
-- QUANTITY is not, and the screen must not present another branch's quantity as this
-- branch's.
--
-- WHAT THIS RETURNS. One row per active variant, for the branch the account is working
-- in (`current_branch_id()`), using exactly the rule 0237 established for the Settings
-- card:
--   • the branch's own net movement (received minus sold, returned, adjusted);
--   • a variant with NO movement anywhere was never branch-stamped, so its whole
--     `stock_qty` belongs to the shop's default branch — and to no other branch;
--   • a row written before branch stamping (`branch_id IS NULL`) belongs to a branch
--     only when the shop has exactly one active branch.
--
-- WHAT IT DOES NOT DO. It does not move stock, change a write path, or hide a product
-- from the catalogue. A product with zero stock in this branch is still listed — the
-- list can then say "Out of stock" truthfully instead of borrowing another branch's
-- quantity. Quantities are only returned for the caller's own shop; an authenticated
-- member of another shop gets no rows.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_branch_variant_stock()
RETURNS TABLE (variant_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH shop AS (
    SELECT public.current_shop_id() AS id
  ),
  this_branch AS (
    SELECT public.current_branch_id() AS id
  ),
  branches_of_shop AS (
    SELECT b.id
      FROM public.branches b
     WHERE b.is_active AND b.tenant_id = (SELECT id FROM shop)
  ),
  only_branch AS (
    SELECT (array_agg(b.id))[1] AS id
      FROM branches_of_shop b
    HAVING count(*) = 1
  ),
  default_branch AS (
    SELECT b.id
      FROM public.branches b
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
  legacy AS (
    -- Never branch-stamped: the default branch owns the whole shelf, no other branch.
    SELECT v.id AS variant_id, v.stock_qty AS qty
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE p.shop_id = (SELECT id FROM shop)
       AND p.is_active AND v.is_active
       AND v.stock_qty > 0
       AND (SELECT id FROM this_branch) = (SELECT id FROM default_branch)
       AND NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.variant_id = v.id)
  )
  SELECT x.variant_id, sum(x.qty) AS qty
    FROM (SELECT * FROM net UNION ALL SELECT * FROM legacy) x
    JOIN public.product_variants v ON v.id = x.variant_id
    JOIN public.products p ON p.id = v.product_id
   WHERE p.shop_id = (SELECT id FROM shop)
     AND p.is_active AND v.is_active
   GROUP BY x.variant_id;
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
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_variant_stock' AND p.pronargs = 0;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION '0238: get_branch_variant_stock() is missing';
  END IF;
  IF NOT (v_cols @> ARRAY['variant_id', 'qty']) THEN
    RAISE EXCEPTION '0238: get_branch_variant_stock() does not return variant_id and qty (found %)', array_to_string(v_cols, ', ');
  END IF;

  RAISE NOTICE '0238: the product shelf is the branch shelf';
END
$assert$;
