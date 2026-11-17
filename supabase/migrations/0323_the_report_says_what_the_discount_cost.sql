-- 0323 — The period report says what the discount cost, instead of quietly charging less.
--
-- WHY THIS EXISTS. 0322 let a sale carry a discount, and `sales.total_amount` became what the
-- customer was actually charged. That is the right number for cash, credit and profit — but it
-- meant the report's "Gross sales" silently became "sales after discount", so an owner reading
-- Rs. 12,000 could not see the Rs. 500 that was given away to get there (owner, 2026-11-17).
--
-- So the window now answers three figures where it used to answer one:
--
--   list_sales  — what the goods were ticketed at, before anything was taken off
--   discounts   — everything taken off, bill-level and line-level, in one number
--   gross_sales — what was charged (unchanged; this is the figure cash and profit are built on)
--
-- `net_sales` and `profit` keep their meaning exactly: charged less returns, and charged less the
-- recorded cost of goods. Nothing about the arithmetic moved; a subtraction that was invisible
-- is now named. A bill discount is `sales.discount`; a line discount is `sale_items.discount`,
-- which is the money already missing from that line's `line_total`.
--
-- The return type grows, so the function is replaced rather than redefined in place; the grant
-- that 0253 gave authenticated is restored on the new signature.

DROP FUNCTION IF EXISTS public.get_branch_period_report(date, date);

CREATE OR REPLACE FUNCTION public.get_branch_period_report(p_from date, p_to date)
RETURNS TABLE (
  branch_id      uuid,
  branch_name    text,
  is_current     boolean,
  list_sales     numeric,
  discounts      numeric,
  gross_sales    numeric,
  "returns"      numeric,
  net_sales      numeric,
  cogs           numeric,
  unknown_lines  int,
  profit         numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD';
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  -- The report is a sales read: a role that may not read the ledger is not shown its arithmetic.
  IF NOT public.has_effective_permission('sales.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission sales.view';
  END IF;

  RETURN QUERY
  WITH readable_branches AS (
    SELECT b.id, b.name, b.is_default, b.created_at
      FROM public.branches b
     WHERE b.tenant_id = v_member.tenant_id
       AND b.is_active
       AND (v_member.role = 'owner'
            OR b.id = ANY (COALESCE(v_member.branch_scope, '{}'::uuid[])))
  ),
  sales_window AS (
    SELECT s.branch_id, COALESCE(sum(s.total_amount), 0) AS gross
      FROM public.sales s
     WHERE s.shop_id = v_member.tenant_id
       AND NOT s.is_voided
       AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
       AND s.branch_id IS NOT NULL
     GROUP BY s.branch_id
  ),
  -- Both levels of discount, summed where they are stored: the bill's own column and the lines
  -- that were reduced. A row written before 0322 has zeros in both, so it reads as no discount.
  discount_window AS (
    SELECT s.branch_id,
           COALESCE(sum(s.discount), 0)
             + COALESCE(sum((
                 SELECT COALESCE(sum(si.discount), 0)
                   FROM public.sale_items si
                  WHERE si.sale_id = s.id
               )), 0) AS taken_off
      FROM public.sales s
     WHERE s.shop_id = v_member.tenant_id
       AND NOT s.is_voided
       AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
       AND s.branch_id IS NOT NULL
     GROUP BY s.branch_id
  ),
  cogs_window AS (
    SELECT s.branch_id,
           COALESCE(sum(si.cogs_amount) FILTER (WHERE si.cogs_amount IS NOT NULL), 0) AS cogs,
           count(*) FILTER (WHERE si.cogs_amount IS NULL)::int AS unknown_lines
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
     WHERE s.shop_id = v_member.tenant_id
       AND NOT s.is_voided
       AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
       AND s.branch_id IS NOT NULL
     GROUP BY s.branch_id
  ),
  returns_window AS (
    SELECT COALESCE(r.branch_id, s.branch_id) AS branch_id,
           COALESCE(sum(
             CASE WHEN COALESCE(r.total_refund, 0) <> 0 THEN r.total_refund
                  ELSE COALESCE(r.refund_amount, 0) END
           ), 0) AS refunded
      FROM public.returns r
      LEFT JOIN public.sales s ON s.id = r.sale_id
     WHERE r.shop_id = v_member.tenant_id
       AND (r.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
       AND COALESCE(r.branch_id, s.branch_id) IS NOT NULL
     GROUP BY COALESCE(r.branch_id, s.branch_id)
  )
  SELECT rb.id,
         rb.name::text,
         (rb.id = public.current_branch_id()),
         COALESCE(sw.gross, 0) + COALESCE(dw.taken_off, 0),
         COALESCE(dw.taken_off, 0),
         COALESCE(sw.gross, 0),
         COALESCE(rw.refunded, 0),
         COALESCE(sw.gross, 0) - COALESCE(rw.refunded, 0),
         COALESCE(cw.cogs, 0),
         COALESCE(cw.unknown_lines, 0),
         COALESCE(sw.gross, 0) - COALESCE(cw.cogs, 0)
    FROM readable_branches rb
    LEFT JOIN sales_window sw    ON sw.branch_id = rb.id
    LEFT JOIN discount_window dw ON dw.branch_id = rb.id
    LEFT JOIN cogs_window cw     ON cw.branch_id = rb.id
    LEFT JOIN returns_window rw  ON rw.branch_id = rb.id
   ORDER BY rb.is_default DESC, rb.created_at, rb.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_period_report(date, date) TO authenticated;
