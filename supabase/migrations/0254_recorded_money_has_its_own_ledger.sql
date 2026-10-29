-- 0254 — Recorded income, expense and drawings are one ledger, and only the owner writes it.
--
-- WHY THIS EXISTS. The Finance screen could show what the shop SOLD and what it still OWES, but
-- there was nowhere to record money that is neither: rent paid, a delivery paid in cash, stock
-- bought without a purchase bill, the owner taking cash out. The reference screen asks for those
-- three, so the app needs a place to keep them that is not a carbon copy of the sales ledger.
--
-- ONE TABLE, THREE KINDS, DELIBERATELY. Income, expense and drawings answer different questions
-- (what came in, what the business spent, what the owner withdrew) but they are the same shape —
-- an amount, a day, a category, a method, an optional counterparty and note — and they are always
-- read together to explain a period. Three tables would mean three policies, three read shapes and
-- three chances for one of them to disagree about a branch. A `kind` column keeps one rule.
--
-- WHAT IS DELIBERATELY NOT INVENTED:
--   * A drawing is NOT an expense. It is the owner's money leaving the till, and folding it into
--     expenses would understate profit while pretending the owner was a supplier.
--   * An income row is NOT a sale. Sales are their own ledger with stock behind them; this table
--     records money that did not move stock, and the two are never summed into one "revenue".
--   * No opening balance, no till balance: the screen adds up rows that exist, and says so.
--   * A future date is refused. Money recorded before it happens is a plan, not a record.
--
-- ACCESS. The table is server-owned: RLS is on with NO policy and every client grant is revoked,
-- so the only door is `record_finance_entry` (owner of the active shop only) and the only read is
-- `get_finance_totals` (gated on `payments.view`). Both resolve the shop and branch from the
-- session, never from a client-supplied id used unchecked.

CREATE TABLE IF NOT EXISTS public.finance_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN ('income', 'expense', 'drawing')),
  amount        numeric(14, 2) NOT NULL CHECK (amount > 0),
  occurred_on   date NOT NULL,
  category      text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 64),
  method        text NOT NULL CHECK (method IN ('cash', 'bank', 'easypaisa', 'jazzcash')),
  counterparty  text CHECK (counterparty IS NULL OR length(counterparty) <= 120),
  note          text CHECK (note IS NULL OR length(note) <= 500),
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The screen reads one branch's month, newest first, and the totals read the same window.
CREATE INDEX IF NOT EXISTS finance_entries_branch_day
  ON public.finance_entries (branch_id, occurred_on DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS finance_entries_shop_day
  ON public.finance_entries (shop_id, occurred_on DESC);

ALTER TABLE public.finance_entries ENABLE ROW LEVEL SECURITY;

-- No client role reads or writes this table directly. A direct insert could name another
-- branch; the RPC below cannot, because it derives both ids from the session.
REVOKE ALL ON TABLE public.finance_entries FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.finance_entries IS
  'Money the owner records that is not a sale: income, expense and drawings. Server-owned; written only by record_finance_entry and read only by get_finance_totals. A drawing is not an expense, and neither is a sale.';

-- ── 1. The one way in ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_finance_entry(
  p_kind         text,
  p_amount       numeric,
  p_category     text,
  p_method       text,
  p_occurred_on  date    DEFAULT NULL,
  p_counterparty text    DEFAULT NULL,
  p_note         text    DEFAULT NULL,
  p_branch_id    uuid    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_branch  uuid;
  v_day     date;
  v_today   date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_id      uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

  -- Recording money is the owner's act. An employee reads the period through the totals read
  -- (when their role carries payments.view) but cannot create a row here, which is the same
  -- split the settings screens already make for destructive money actions.
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner records income, expense or drawings';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('income', 'expense', 'drawing') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected income, expense or drawing';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a recorded amount is above zero';
  END IF;
  IF p_category IS NULL OR btrim(p_category) = '' OR length(btrim(p_category)) > 64 THEN
    RAISE EXCEPTION 'INVALID_CATEGORY';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'bank', 'easypaisa', 'jazzcash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;

  v_day := COALESCE(p_occurred_on, v_today);
  IF v_day > v_today THEN
    RAISE EXCEPTION 'INVALID_DATE: money cannot be recorded before it happens';
  END IF;
  IF v_day < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'INVALID_DATE: that day is outside this ledger';
  END IF;

  IF p_counterparty IS NOT NULL AND length(btrim(p_counterparty)) > 120 THEN
    RAISE EXCEPTION 'INVALID_COUNTERPARTY';
  END IF;
  IF p_note IS NOT NULL AND length(btrim(p_note)) > 500 THEN
    RAISE EXCEPTION 'INVALID_NOTE';
  END IF;

  -- The branch is the one the session is working in unless an explicit branch is given; either
  -- way it must be an active branch of THIS tenant, so a guessed id cannot file money elsewhere.
  v_branch := COALESCE(p_branch_id, public.current_branch_id());
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  INSERT INTO public.finance_entries (
    shop_id, branch_id, kind, amount, occurred_on, category, method,
    counterparty, note, created_by
  ) VALUES (
    v_member.tenant_id, v_branch, p_kind, p_amount, v_day, btrim(p_category), p_method,
    NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_member.user_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid) IS
  'Records one income, expense or drawing for the session''s branch. Owner only; refuses a future day, a non-positive amount and a branch that is not this tenant''s.';

REVOKE ALL ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid) TO authenticated;

-- ── 2. The period's three totals, for the branch on screen ────────────────────────────────────
-- The Finance screen states one figure per kind beside the sales it already reads. They are kept
-- apart (never netted) because "the owner took 20,000" and "the shop spent 20,000" are different
-- facts. A caller without `payments.view` is refused rather than shown zeros.
CREATE OR REPLACE FUNCTION public.get_finance_totals(p_from date, p_to date)
RETURNS TABLE (
  income   numeric,
  expense  numeric,
  drawing  numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_branch  uuid;
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

  RETURN QUERY
  SELECT
    COALESCE(sum(fe.amount) FILTER (WHERE fe.kind = 'income'), 0)::numeric,
    COALESCE(sum(fe.amount) FILTER (WHERE fe.kind = 'expense'), 0)::numeric,
    COALESCE(sum(fe.amount) FILTER (WHERE fe.kind = 'drawing'), 0)::numeric
    FROM public.finance_entries fe
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch
     AND fe.occurred_on BETWEEN p_from AND p_to;
END;
$$;

COMMENT ON FUNCTION public.get_finance_totals(date, date) IS
  'The session branch''s recorded income, expense and drawings for one PK window. Null-safe: a period with no rows is zeros, which is a fact about the ledger, not a missing read.';

REVOKE ALL ON FUNCTION public.get_finance_totals(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_totals(date, date) TO authenticated;

-- ── 3. The ledger itself, for the screen that lists and exports it ──────────────────────────
-- The overview states three totals; the ledger screen has to show the rows those totals are made
-- of. Same gate, same branch, same window — a row this read returns is a row the totals counted.
CREATE OR REPLACE FUNCTION public.get_finance_entries(p_from date, p_to date)
RETURNS TABLE (
  id           uuid,
  kind         text,
  amount       numeric,
  occurred_on  date,
  category     text,
  method       text,
  counterparty text,
  note         text,
  created_at   timestamptz
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

  RETURN QUERY
  SELECT fe.id, fe.kind, fe.amount, fe.occurred_on, fe.category, fe.method,
         fe.counterparty, fe.note, fe.created_at
    FROM public.finance_entries fe
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch
     AND fe.occurred_on BETWEEN p_from AND p_to
   ORDER BY fe.occurred_on DESC, fe.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_finance_entries(date, date) IS
  'The session branch''s recorded income, expense and drawing rows for one PK window, newest first. The same gate and scope as get_finance_totals, so the ledger and its totals cannot disagree.';

REVOKE ALL ON FUNCTION public.get_finance_entries(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_entries(date, date) TO authenticated;

-- ── 4. The migration proves its own shape before it commits ──────────────────────────────────
DO $$
DECLARE
  v_kinds text[];
  v_columns text[];
BEGIN
  SELECT array_agg(DISTINCT con.conname) INTO v_kinds
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'finance_entries' AND con.contype = 'c';
  IF v_kinds IS NULL OR NOT ('finance_entries_kind_check' = ANY (v_kinds)) THEN
    RAISE EXCEPTION '0254: finance_entries has no kind check (found %)', v_kinds;
  END IF;

  SELECT array_agg(column_name) INTO v_columns
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'finance_entries';
  IF NOT (v_columns @> ARRAY['shop_id', 'branch_id', 'kind', 'amount', 'occurred_on', 'category', 'method']) THEN
    RAISE EXCEPTION '0254: finance_entries is missing a recorded-money column (found %)', v_columns;
  END IF;

  IF has_table_privilege('authenticated', 'public.finance_entries', 'INSERT')
     OR has_table_privilege('anon', 'public.finance_entries', 'SELECT') THEN
    RAISE EXCEPTION '0254: a client role can reach finance_entries directly';
  END IF;

  IF has_function_privilege('anon', 'public.record_finance_entry(text,numeric,text,text,date,text,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_finance_totals(date,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.get_finance_entries(date,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '0254: anon can execute a finance function';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_finance_entries'
       AND p.proargnames @> ARRAY['kind', 'amount', 'occurred_on', 'category', 'method']
  ) THEN
    RAISE EXCEPTION '0254: get_finance_entries() does not report the ledger columns';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
