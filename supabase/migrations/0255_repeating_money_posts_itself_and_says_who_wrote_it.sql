-- 0255 — Money that repeats posts itself, and every row says who wrote it.
--
-- WHY THIS EXISTS. 0254 gave the owner one ledger for income, expense and drawings, but every row
-- had to be typed in again for every rent month. The owner asked for recurring income and expense
-- "and he can customise that recurring too" — a rule, not a reminder. So a rule is stored once and
-- its rows are written when they fall due.
--
-- WHY THE ROWS ARE POSTED INSTEAD OF THE RULE BEING READ AS IF IT WERE MONEY. A future month's
-- rent has not moved yet. Counting it now would make the period's expense figure describe money
-- that is still in the bank, which is the one thing this ledger must never do. The rule only
-- decides WHEN a real row appears; until then it is a plan, and the plan is not in the totals.
--
-- WHY A SEPARATE TABLE. A rule has a cadence, a next date and an end; a row has an amount and a
-- day. Putting the cadence on the row would make every posted copy carry a rule it does not own
-- and let two different cadences describe one row. The rule names the row it produced through
-- `finance_entries.recurrence_id`, and the partial unique index on (recurrence_id, occurred_on)
-- is what makes posting idempotent — a double tap, a retry or two open screens cannot write the
-- same month twice.
--
-- WHO. Every rule and every row belongs to the shop of the session, the branch it was written in,
-- and the person who wrote it. The ledger read now carries that person's name, because a row that
-- says "rent" without saying who recorded it is a row the owner cannot ask about.
--
-- WHAT IS DELIBERATELY NOT INVENTED:
--   * No cron. The app has no scheduler and the database has no job that runs while everyone is
--     away. Posting happens when an owner opens the ledger (or records money), which is stated on
--     the screen; the rows are still back-dated to the day they fell due, not the day they posted.
--   * No compounding, no catch-up beyond `p_repeat_unit`: the cadence is day, week or month.
--   * No silent edit. Changing a rule does not rewrite rows it already produced.

CREATE TABLE IF NOT EXISTS public.finance_recurrences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  kind         text NOT NULL CHECK (kind IN ('income', 'expense', 'drawing')),
  amount       numeric(14, 2) NOT NULL CHECK (amount > 0),
  category     text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 64),
  method       text NOT NULL CHECK (method IN ('cash', 'bank', 'easypaisa', 'jazzcash')),
  counterparty text CHECK (counterparty IS NULL OR length(counterparty) <= 120),
  note         text CHECK (note IS NULL OR length(note) <= 500),
  repeat_every integer NOT NULL DEFAULT 1 CHECK (repeat_every BETWEEN 1 AND 60),
  repeat_unit  text NOT NULL CHECK (repeat_unit IN ('day', 'week', 'month')),
  starts_on    date NOT NULL,
  next_on      date NOT NULL,
  ends_on      date,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_recurrences_ends_after_start CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS finance_recurrences_due
  ON public.finance_recurrences (shop_id, next_on)
  WHERE is_active;

ALTER TABLE public.finance_entries
  ADD COLUMN IF NOT EXISTS recurrence_id uuid
  REFERENCES public.finance_recurrences(id) ON DELETE SET NULL;

-- One posting per rule per day, enforced where the posting happens.
CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_recurrence_day
  ON public.finance_entries (recurrence_id, occurred_on)
  WHERE recurrence_id IS NOT NULL;

ALTER TABLE public.finance_recurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_recurrences FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.finance_recurrences IS
  'A cadence for recorded money — rent every month, a delivery every two weeks. Server-owned; read by get_finance_recurrences, written by record_finance_entry, stopped by stop_finance_recurrence, and posted by post_due_finance_entries. A rule is not money: only the rows it produces reach the totals.';

-- ── 1. The one way in, now able to start a cadence ───────────────────────────────────────────
-- The old eight-argument shape is dropped first: adding defaulted arguments beside it would leave
-- two candidates for the same named-argument call, and Postgres refuses an ambiguous function.
DROP FUNCTION IF EXISTS public.record_finance_entry(text, numeric, text, text, date, text, text, uuid);

CREATE OR REPLACE FUNCTION public.record_finance_entry(
  p_kind         text,
  p_amount       numeric,
  p_category     text,
  p_method       text,
  p_occurred_on  date    DEFAULT NULL,
  p_counterparty text    DEFAULT NULL,
  p_note         text    DEFAULT NULL,
  p_branch_id    uuid    DEFAULT NULL,
  p_repeat_every integer DEFAULT 1,
  p_repeat_unit  text    DEFAULT 'none'
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
  v_every   integer := COALESCE(p_repeat_every, 1);
  v_unit    text := COALESCE(p_repeat_unit, 'none');
  v_rule    uuid;
  v_next    date;
  v_id      uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

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
  IF v_unit NOT IN ('none', 'day', 'week', 'month') THEN
    RAISE EXCEPTION 'INVALID_REPEAT: expected none, day, week or month';
  END IF;
  IF v_every < 1 OR v_every > 60 THEN
    RAISE EXCEPTION 'INVALID_REPEAT: a cadence repeats between 1 and 60 times';
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

  v_branch := COALESCE(p_branch_id, public.current_branch_id());
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  IF v_unit <> 'none' THEN
    -- The first row is today's (or the chosen day's); the rule then carries the next date.
    v_next := CASE v_unit
      WHEN 'day'   THEN v_day + v_every
      WHEN 'week'  THEN v_day + (v_every * 7)
      ELSE (v_day + make_interval(months => v_every))::date
    END;

    INSERT INTO public.finance_recurrences (
      shop_id, branch_id, kind, amount, category, method, counterparty, note,
      repeat_every, repeat_unit, starts_on, next_on, created_by
    ) VALUES (
      v_member.tenant_id, v_branch, p_kind, p_amount, btrim(p_category), p_method,
      NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
      NULLIF(btrim(COALESCE(p_note, '')), ''),
      v_every, v_unit, v_day, v_next, v_member.user_id
    )
    RETURNING id INTO v_rule;
  END IF;

  INSERT INTO public.finance_entries (
    shop_id, branch_id, kind, amount, occurred_on, category, method,
    counterparty, note, created_by, recurrence_id
  ) VALUES (
    v_member.tenant_id, v_branch, p_kind, p_amount, v_day, btrim(p_category), p_method,
    NULLIF(btrim(COALESCE(p_counterparty, '')), ''),
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_member.user_id, v_rule
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid, integer, text) IS
  'Records one income, expense or drawing for the session''s branch, and optionally a cadence that posts the rest. Owner only; refuses a future day, a non-positive amount and a branch that is not this tenant''s.';

REVOKE ALL ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_finance_entry(text, numeric, text, text, date, text, text, uuid, integer, text) TO authenticated;

-- ── 2. The poster ────────────────────────────────────────────────────────────────────────────
-- Called by the ledger screen before it reads, so the month it is about to draw already holds the
-- rows that fell due. Returns how many rows this call wrote, which is zero on every ordinary day.
CREATE OR REPLACE FUNCTION public.post_due_finance_entries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_today  date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_rule   public.finance_recurrences;
  v_next   date;
  v_guard  integer;
  v_posted integer := 0;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  -- Posting writes rows, so it carries the same owner gate as writing them by hand.
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner posts scheduled money';
  END IF;

  FOR v_rule IN
    SELECT * FROM public.finance_recurrences r
     WHERE r.shop_id = v_member.tenant_id AND r.is_active
     ORDER BY r.next_on
  LOOP
    v_next := v_rule.next_on;
    v_guard := 0;

    WHILE v_next <= v_today AND v_guard < 400 LOOP
      IF v_rule.ends_on IS NOT NULL AND v_next > v_rule.ends_on THEN
        EXIT;
      END IF;

      INSERT INTO public.finance_entries (
        shop_id, branch_id, kind, amount, occurred_on, category, method,
        counterparty, note, created_by, recurrence_id
      ) VALUES (
        v_rule.shop_id, v_rule.branch_id, v_rule.kind, v_rule.amount, v_next,
        v_rule.category, v_rule.method, v_rule.counterparty, v_rule.note,
        v_rule.created_by, v_rule.id
      )
      ON CONFLICT DO NOTHING;

      IF FOUND THEN
        v_posted := v_posted + 1;
      END IF;

      v_next := CASE v_rule.repeat_unit
        WHEN 'day'  THEN v_next + v_rule.repeat_every
        WHEN 'week' THEN v_next + (v_rule.repeat_every * 7)
        ELSE (v_next + make_interval(months => v_rule.repeat_every))::date
      END;
      v_guard := v_guard + 1;
    END LOOP;

    -- A rule whose next date is past its end is finished; it stays for the history it wrote.
    UPDATE public.finance_recurrences
       SET next_on = v_next,
           is_active = NOT (ends_on IS NOT NULL AND v_next > ends_on),
           updated_at = now()
     WHERE id = v_rule.id;
  END LOOP;

  RETURN v_posted;
END;
$$;

COMMENT ON FUNCTION public.post_due_finance_entries() IS
  'Writes one row per due occurrence of every active cadence in the session shop, then advances each rule. Idempotent through finance_entries_recurrence_day; owner only.';

REVOKE ALL ON FUNCTION public.post_due_finance_entries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_due_finance_entries() TO authenticated;

-- ── 3. The cadences the ledger draws, and the way one is stopped ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_finance_recurrences()
RETURNS TABLE (
  id           uuid,
  kind         text,
  amount       numeric,
  category     text,
  method       text,
  counterparty text,
  note         text,
  repeat_every integer,
  repeat_unit  text,
  next_on      date,
  ends_on      date
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
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();

  RETURN QUERY
  SELECT r.id, r.kind, r.amount, r.category, r.method, r.counterparty, r.note,
         r.repeat_every, r.repeat_unit, r.next_on, r.ends_on
    FROM public.finance_recurrences r
   WHERE r.shop_id = v_member.tenant_id
     AND r.branch_id = v_branch
     AND r.is_active
   ORDER BY r.next_on, r.created_at;
END;
$$;

COMMENT ON FUNCTION public.get_finance_recurrences() IS
  'The session branch''s active cadences. Read beside the ledger they post into, behind the same permission.';

REVOKE ALL ON FUNCTION public.get_finance_recurrences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_recurrences() TO authenticated;

CREATE OR REPLACE FUNCTION public.stop_finance_recurrence(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_count  integer;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner stops scheduled money';
  END IF;

  UPDATE public.finance_recurrences r
     SET is_active = false, updated_at = now()
   WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.stop_finance_recurrence(uuid) IS
  'Stops a cadence. Rows it already wrote stay: stopping a schedule does not un-spend money.';

REVOKE ALL ON FUNCTION public.stop_finance_recurrence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_finance_recurrence(uuid) TO authenticated;

-- ── 4. The ledger read, now carrying the two facts the screen shows ──────────────────────────
-- The return shape changes, so the old function is dropped rather than replaced.
DROP FUNCTION IF EXISTS public.get_finance_entries(date, date);

CREATE OR REPLACE FUNCTION public.get_finance_entries(p_from date, p_to date)
RETURNS TABLE (
  id              uuid,
  kind            text,
  amount          numeric,
  occurred_on     date,
  category        text,
  method          text,
  counterparty    text,
  note            text,
  created_at      timestamptz,
  created_by_name text,
  recurrence_id   uuid,
  repeat_every    integer,
  repeat_unit     text
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
         fe.counterparty, fe.note, fe.created_at,
         u.name::text AS created_by_name,
         fe.recurrence_id,
         fr.repeat_every,
         fr.repeat_unit
    FROM public.finance_entries fe
    LEFT JOIN public.users u ON u.id = fe.created_by
    LEFT JOIN public.finance_recurrences fr ON fr.id = fe.recurrence_id
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.branch_id = v_branch
     AND fe.occurred_on BETWEEN p_from AND p_to
   ORDER BY fe.occurred_on DESC, fe.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_finance_entries(date, date) IS
  'The session branch''s recorded rows for one PK window, newest first, each with who wrote it and the cadence it came from. The same gate and scope as get_finance_totals, so the ledger and its totals cannot disagree.';

REVOKE ALL ON FUNCTION public.get_finance_entries(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_entries(date, date) TO authenticated;
