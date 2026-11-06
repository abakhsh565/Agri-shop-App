-- 0262 — One read-only statement of money actually moving, across every ledger.
--
-- WHY THIS EXISTS. The shop already knows what it sold (the sales ledger), what came back (the
-- returns ledger), what it paid suppliers (supplier_payments), what customers paid later
-- (customer_payments) and what the owner recorded by hand (finance_entries). Each is correct on
-- its own screen and none of them is the answer to "how much money moved this month, and where".
-- The owner asked for that one page.
--
-- WHAT THIS IS NOT. It is not a merge of the tables and it is not revenue. A sale is money when
-- it is PAID, not when it is billed; a credit purchase moves no money until a payment does; a
-- drawing is money out but not an expense. So the statement counts MOVEMENT — the amounts that
-- actually changed hands in the window — and it says so. Profit keeps its own arithmetic on the
-- Finance screen, and receivables/payables stay balances, not movement.
--
-- WHAT IS COUNTED, AND WHAT IS DELIBERATELY LEFT OUT:
--
--   in   sales.amount_paid                      the part of a sale paid at the counter
--   in   customer_payments.amount               money a customer paid later against credit
--   out  returns.total_refund / refund_amount   money given back
--   out  supplier_payments.amount               money paid to suppliers
--   in   finance_entries (kind = income)        money the owner recorded that is not a sale
--   out  finance_entries (expense, drawing)     money the shop spent, and money the owner took
--
--   NOT purchases.total_amount: a delivery on credit has moved nothing. Its advance is already a
--   supplier_payments row (0258), so counting the bill as well would count the same money twice.
--   NOT voided sales: they never happened.
--   NOT deleted finance rows (0261): the ledger stopped counting them, and so does this.
--
-- SCOPE AND GATE. One branch — the one the session is working in — and one PK calendar window,
-- the same scope and date convention as get_branch_cash (0253). The read asks for
-- `payments.view`, the same gate as the recorded-money ledger; a role without it is refused
-- rather than shown a confident zero.
--
-- THE ROWS AND THE TOTALS READ THE SAME FUNCTION. get_money_totals is an aggregate over
-- get_money_statement, so the three figures at the top of the page cannot disagree with the list
-- under them. That is the whole reason there is one query and not two.

CREATE OR REPLACE FUNCTION public.get_money_statement(p_from date, p_to date)
RETURNS TABLE (
  source      text,
  ref_id      uuid,
  occurred_on date,
  direction   text,
  amount      numeric,
  method      text,
  party       text,
  reference   text,
  note        text,
  created_at  timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'INVALID_PERIOD';
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: no branch is selected';
  END IF;

  RETURN QUERY
  -- Money in: what was paid at the counter.
  SELECT 'sale'::text,
         s.id,
         (s.created_at AT TIME ZONE 'Asia/Karachi')::date,
         'in'::text,
         GREATEST(s.amount_paid, 0),
         s.payment_method::text,
         s.customer_name_snapshot::text,
         s.sale_number::text,
         NULL::text,
         s.created_at
    FROM public.sales s
   WHERE s.shop_id = v_member.tenant_id
     AND s.branch_id = v_branch
     AND NOT s.is_voided
     AND GREATEST(s.amount_paid, 0) > 0
     AND (s.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to

  UNION ALL

  -- Money in: a customer settling credit later. The customer is the party, not the sale.
  SELECT 'customer_payment'::text,
         cp.id,
         (cp.created_at AT TIME ZONE 'Asia/Karachi')::date,
         'in'::text,
         GREATEST(cp.amount, 0),
         cp.method::text,
         c.name::text,
         NULL::text,
         cp.notes,
         cp.created_at
    FROM public.customer_payments cp
    LEFT JOIN public.customers c ON c.id = cp.customer_id
   WHERE cp.branch_id = v_branch
     AND GREATEST(cp.amount, 0) > 0
     AND (cp.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to

  UNION ALL

  -- Money out: goods came back and the money followed.
  SELECT 'refund'::text,
         r.id,
         (r.created_at AT TIME ZONE 'Asia/Karachi')::date,
         'out'::text,
         CASE WHEN COALESCE(r.total_refund, 0) <> 0 THEN r.total_refund
              ELSE COALESCE(r.refund_amount, 0) END,
         NULL::text,
         r.customer_name::text,
         r.return_number::text,
         NULL::text,
         r.created_at
    FROM public.returns r
    LEFT JOIN public.sales s ON s.id = r.sale_id
   WHERE r.shop_id = v_member.tenant_id
     AND COALESCE(r.branch_id, s.branch_id) = v_branch
     AND CASE WHEN COALESCE(r.total_refund, 0) <> 0 THEN r.total_refund
              ELSE COALESCE(r.refund_amount, 0) END > 0
     AND (r.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to

  UNION ALL

  -- Money out: supplier payments, including the advance on a delivery (0258).
  SELECT 'supplier_payment'::text,
         sp.id,
         (sp.created_at AT TIME ZONE 'Asia/Karachi')::date,
         'out'::text,
         GREATEST(sp.amount, 0),
         sp.method::text,
         co.name::text,
         NULL::text,
         sp.notes,
         sp.created_at
    FROM public.supplier_payments sp
    LEFT JOIN public.companies co ON co.id = sp.company_id
   WHERE sp.branch_id = v_branch
     AND GREATEST(sp.amount, 0) > 0
     AND (sp.created_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to

  UNION ALL

  -- Money the owner recorded by hand. Income is in; an expense and a drawing are both out, and
  -- they stay different sources because they are different facts.
  SELECT ('finance_' || fe.kind)::text,
         fe.id,
         fe.occurred_on,
         CASE WHEN fe.kind = 'income' THEN 'in' ELSE 'out' END::text,
         fe.amount,
         fe.method::text,
         fe.counterparty,
         fe.category::text,
         fe.note,
         fe.created_at
    FROM public.finance_entries fe
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch
     AND fe.deleted_at IS NULL
     AND fe.occurred_on BETWEEN p_from AND p_to

   ORDER BY 3 DESC, 10 DESC;
END;
$$;

COMMENT ON FUNCTION public.get_money_statement(date, date) IS
  'Every money movement in the session branch for one PK window: sales paid at the counter, later customer payments, refunds, supplier payments and recorded income/expense/drawings. Read-only; excludes credit balances, voided sales and deleted rows.';

REVOKE ALL ON FUNCTION public.get_money_statement(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_money_statement(date, date) TO authenticated;

-- The three figures at the top of the statement. An aggregate over the same rows, so a page cannot
-- claim a net that its own list contradicts.
CREATE OR REPLACE FUNCTION public.get_money_totals(p_from date, p_to date)
RETURNS TABLE (
  money_in  numeric,
  money_out numeric,
  net       numeric,
  entries   integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  RETURN QUERY
  SELECT COALESCE(sum(ms.amount) FILTER (WHERE ms.direction = 'in'), 0)::numeric,
         COALESCE(sum(ms.amount) FILTER (WHERE ms.direction = 'out'), 0)::numeric,
         (COALESCE(sum(ms.amount) FILTER (WHERE ms.direction = 'in'), 0)
          - COALESCE(sum(ms.amount) FILTER (WHERE ms.direction = 'out'), 0))::numeric,
         count(*)::integer
    FROM public.get_money_statement(p_from, p_to) ms;
END;
$$;

COMMENT ON FUNCTION public.get_money_totals(date, date) IS
  'Money in, money out and their net for the session branch and one PK window, aggregated from get_money_statement so the dashboard and the statement cannot disagree.';

REVOKE ALL ON FUNCTION public.get_money_totals(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_money_totals(date, date) TO authenticated;

-- ── The migration proves its own shape before it commits ───────────────────────────────────────
DO $$
DECLARE
  v_cols text[];
BEGIN
  SELECT p.proargnames INTO v_cols
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_money_statement';
  IF v_cols IS NULL OR NOT (v_cols @> ARRAY['source', 'direction', 'amount', 'party', 'occurred_on']) THEN
    RAISE EXCEPTION '0262: get_money_statement() does not report the movement columns (found %)', v_cols;
  END IF;

  IF has_function_privilege('anon', 'public.get_money_statement(date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_money_totals(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0262: anon can execute a money statement function';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
