-- 0253 — The reports read their period per branch, at the database.
--
-- WHY THIS EXISTS. Two screens were honest about a gap they could not close on the client:
--
--   * Sales → Branch performance drew each branch's LIFETIME sales from `get_my_branches()`,
--     so a report whose strip said "this month" compared two branches by two totals that
--     included every month before it.
--   * Profit had no branch split at all, because no read carried a period cost per branch.
--
-- Both answers already exist in rows the database holds: a sale is branch-stamped and its lines
-- carry the cost recorded when the sale happened (`sale_items.cogs_amount`), and a refund is
-- branch-stamped (or reachable through its sale). The only missing piece was a read that groups
-- them by branch over the window the report is showing. Doing that on the client would mean
-- fetching every branch's ledger, which the session is not allowed to do; inferring it from the
-- active branch's rows would silently make one branch stand for the business. So the window is
-- resolved here, once, with the same permission and scope rules as every other read.
--
-- WHAT IS DELIBERATELY NOT INVENTED:
--   * A line with no recorded cost stays an UNKNOWN line, not a zero-cost one. `profit` is
--     therefore a floor while `unknown_lines > 0`, exactly as `lib/profit.ts` says on screen.
--   * Returns are reported as their own column, never folded into profit. The app's profit is
--     measured on recorded sales; net sales is the sales-minus-returns reading the Sales report
--     already uses.
--   * A branch the account may not read is absent from the answer, not returned as zeros.
--   * `null` in a cash column means "not readable", never "no money moved".
--
-- Both functions are read-only, stable and idempotent; neither writes a row or changes history.

-- ── 1. Sales and profit for one window, per branch ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_period_report(p_from date, p_to date)
RETURNS TABLE (
  branch_id      uuid,
  branch_name    text,
  is_current     boolean,
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
         COALESCE(sw.gross, 0),
         COALESCE(rw.refunded, 0),
         COALESCE(sw.gross, 0) - COALESCE(rw.refunded, 0),
         COALESCE(cw.cogs, 0),
         COALESCE(cw.unknown_lines, 0),
         COALESCE(sw.gross, 0) - COALESCE(cw.cogs, 0)
    FROM readable_branches rb
    LEFT JOIN sales_window sw   ON sw.branch_id = rb.id
    LEFT JOIN cogs_window cw    ON cw.branch_id = rb.id
    LEFT JOIN returns_window rw ON rw.branch_id = rb.id
   ORDER BY rb.is_default DESC, rb.created_at, rb.id;
END;
$$;

COMMENT ON FUNCTION public.get_branch_period_report(date, date) IS
  'Per-branch gross sales, refunds, net sales, known COGS and profit for one PK calendar window. '
  'A line with no recorded cost counts in unknown_lines, so profit is a floor while that is above zero.';

REVOKE ALL ON FUNCTION public.get_branch_period_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_period_report(date, date) TO authenticated;

-- ── 2. The same window's cash, per branch ──────────────────────────────────────────────────────
--
-- "Recorded cash" is money the counter took on its own sales (`sales.amount_paid`), not a till
-- balance: the app records no opening balance, so a balance printed here would be invented. The
-- two directions are the actual payments ledgers, kept apart exactly as the screen keeps them.
--
-- Each column carries its own permission gate. A caller who may read sales but not supplier
-- payments gets `paid = NULL` for every branch — the screen prints "—" — rather than a confident
-- zero. That is the same distinction `lib/paymentLedger.ts` already makes for the ledger list.
CREATE OR REPLACE FUNCTION public.get_branch_cash(p_from date, p_to date)
RETURNS TABLE (
  branch_id    uuid,
  branch_name  text,
  is_current   boolean,
  cash_taken   numeric,
  received     numeric,
  paid         numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_can_sales boolean;
  v_can_received boolean;
  v_can_paid boolean;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD';
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

  v_can_sales    := public.has_effective_permission('sales.view', v_member.user_id);
  v_can_received := public.has_effective_permission('customers.view', v_member.user_id);
  v_can_paid     := public.has_effective_permission('payments.view', v_member.user_id);

  IF NOT (v_can_sales OR v_can_received OR v_can_paid) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission to read cash';
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
  taken AS (
    SELECT s.branch_id, COALESCE(sum(GREATEST(s.amount_paid, 0)), 0) AS cash_taken
      FROM public.sales s
     WHERE s.shop_id = v_member.tenant_id
       AND NOT s.is_voided
       AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
       AND s.branch_id IS NOT NULL
     GROUP BY s.branch_id
  ),
  received AS (
    SELECT cp.branch_id, COALESCE(sum(GREATEST(cp.amount, 0)), 0) AS received
      FROM public.customer_payments cp
     WHERE cp.branch_id IS NOT NULL
       AND (cp.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
     GROUP BY cp.branch_id
  ),
  paid AS (
    SELECT sp.branch_id, COALESCE(sum(GREATEST(sp.amount, 0)), 0) AS paid
      FROM public.supplier_payments sp
     WHERE sp.branch_id IS NOT NULL
       AND (sp.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
     GROUP BY sp.branch_id
  )
  SELECT rb.id,
         rb.name::text,
         (rb.id = public.current_branch_id()),
         CASE WHEN v_can_sales THEN COALESCE(tk.cash_taken, 0) ELSE NULL END,
         CASE WHEN v_can_received THEN COALESCE(rc.received, 0) ELSE NULL END,
         CASE WHEN v_can_paid THEN COALESCE(pd.paid, 0) ELSE NULL END
    FROM readable_branches rb
    LEFT JOIN taken tk    ON tk.branch_id = rb.id
    LEFT JOIN received rc ON rc.branch_id = rb.id
    LEFT JOIN paid pd     ON pd.branch_id = rb.id
   ORDER BY rb.is_default DESC, rb.created_at, rb.id;
END;
$$;

COMMENT ON FUNCTION public.get_branch_cash(date, date) IS
  'Per-branch cash taken on the window''s sales, customer money received and supplier money paid. '
  'A column the caller may not read is NULL, never zero; no opening balance exists, so this is not a till balance.';

REVOKE ALL ON FUNCTION public.get_branch_cash(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_cash(date, date) TO authenticated;

-- ── 3. The answer has to keep the shape the screens read ──────────────────────────────────────
DO $$
DECLARE
  v_report text[];
  v_cash text[];
BEGIN
  SELECT p.proargnames INTO v_report
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_period_report';
  IF v_report IS NULL OR NOT (v_report @> ARRAY['gross_sales','returns','net_sales','cogs','unknown_lines','profit'])
  THEN RAISE EXCEPTION '0253: get_branch_period_report() does not report the period figures (found %)', v_report; END IF;

  SELECT p.proargnames INTO v_cash
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_cash';
  IF v_cash IS NULL OR NOT (v_cash @> ARRAY['cash_taken','received','paid'])
  THEN RAISE EXCEPTION '0253: get_branch_cash() does not report the cash figures (found %)', v_cash; END IF;

  IF has_function_privilege('anon', 'public.get_branch_period_report(date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_branch_cash(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0253: anon can execute a report read';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
