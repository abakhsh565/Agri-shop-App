-- 0256 — A payment reminder is the owner's own diary, one payment at a time.
--
-- WHY THIS EXISTS. The credit book already schedules chasing a CUSTOMER'S balance: `reminder_configs`
-- holds a cadence and the reminder engine turns it into messages. The owner asked for the other
-- shape on the Cash position screen — "remind me this payment", with a name, a date and an
-- optional repeat, shown on the screen and editable there. That is not a message to a customer;
-- it is a note to the owner. Sharing `reminder_configs` would have forced a customer id onto a
-- note that may have none, and would have let the chasing engine pick it up and message somebody.
--
-- WHY THE CADENCE IS FREQUENCY ONLY. An alarm has a time and a repeat; this is the same three
-- facts — a day, a time, and how often. There is no escalation here and deliberately no tone: a
-- reminder about money the owner has to collect is not a message with a voice.
--
-- WHO. Owner writes, anyone who may read payments reads. Rows are scoped to the shop, the branch
-- the session is working in, and the person who wrote them. The screen states that scope.
--
-- WHAT IS DELIBERATELY NOT INVENTED:
--   * No push. The app has no notification scheduler that runs while it is closed; the reminder is
--     shown, and marked when it is due, on the screen it was written for. Nothing is claimed to
--     have been sent.
--   * No recurrence rows. A repeating reminder keeps its own `due_on` and its cadence; the screen
--     works out the next occurrence from those two facts and says so, so there is no table of
--     shadow occurrences to drift.

CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  person       text CHECK (person IS NULL OR length(btrim(person)) <= 120),
  amount       numeric(14, 2) CHECK (amount IS NULL OR amount > 0),
  due_on       date NOT NULL,
  due_time     time NOT NULL DEFAULT TIME '09:00',
  repeat_every integer NOT NULL DEFAULT 1 CHECK (repeat_every BETWEEN 1 AND 60),
  repeat_unit  text NOT NULL DEFAULT 'none' CHECK (repeat_unit IN ('none', 'day', 'week', 'month')),
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_reminders_branch_due
  ON public.payment_reminders (branch_id, due_on, due_time)
  WHERE is_active;

ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_reminders FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.payment_reminders IS
  'One payment the owner wants to be reminded about: a name, who pays, an optional amount, a date and time, and an optional cadence. Server-owned; read by get_payment_reminders, written by save_payment_reminder and removed by delete_payment_reminder. Not a customer message — the chasing engine does not read it.';

-- ── 1. Write one, or change one ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_payment_reminder(
  p_title        text,
  p_person       text,
  p_amount       numeric,
  p_due_on       date,
  p_due_time     time,
  p_repeat_every integer DEFAULT 1,
  p_repeat_unit  text    DEFAULT 'none',
  p_id           uuid    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
  v_every  integer := COALESCE(p_repeat_every, 1);
  v_unit   text := COALESCE(p_repeat_unit, 'none');
  v_id     uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  -- A reminder is a note to the owner, so only the owner writes one.
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner sets payment reminders';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' OR length(btrim(p_title)) > 80 THEN
    RAISE EXCEPTION 'INVALID_TITLE: a reminder needs a name';
  END IF;
  IF p_person IS NOT NULL AND length(btrim(p_person)) > 120 THEN
    RAISE EXCEPTION 'INVALID_PERSON';
  END IF;
  IF p_amount IS NOT NULL AND (p_amount <= 0 OR p_amount > 1000000000000) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: an amount is above zero';
  END IF;
  IF p_due_on IS NULL OR p_due_on < DATE '2000-01-01' OR p_due_on > DATE '2100-01-01' THEN
    RAISE EXCEPTION 'INVALID_DATE: that day is outside the diary';
  END IF;
  IF v_unit NOT IN ('none', 'day', 'week', 'month') THEN
    RAISE EXCEPTION 'INVALID_REPEAT: expected none, day, week or month';
  END IF;
  IF v_every < 1 OR v_every > 60 THEN
    RAISE EXCEPTION 'INVALID_REPEAT: a cadence repeats between 1 and 60 times';
  END IF;

  v_branch := public.current_branch_id();
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.payment_reminders (
      shop_id, branch_id, title, person, amount, due_on, due_time,
      repeat_every, repeat_unit, created_by
    ) VALUES (
      v_member.tenant_id, v_branch, btrim(p_title),
      NULLIF(btrim(COALESCE(p_person, '')), ''),
      p_amount,
      p_due_on, COALESCE(p_due_time, TIME '09:00'),
      v_every, v_unit, v_member.user_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.payment_reminders r
       SET title = btrim(p_title),
           person = NULLIF(btrim(COALESCE(p_person, '')), ''),
           amount = p_amount,
           due_on = p_due_on,
           due_time = COALESCE(p_due_time, TIME '09:00'),
           repeat_every = v_every,
           repeat_unit = v_unit,
           is_active = true,
           updated_at = now()
     WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_FOUND: that reminder is not part of this business';
    END IF;
    v_id := p_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid) IS
  'Creates or edits one payment reminder for the session branch. Owner only; validates the name, the amount and the cadence before anything is written.';

REVOKE ALL ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid) TO authenticated;

-- ── 2. Remove one ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_payment_reminder(p_id uuid)
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
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner removes payment reminders';
  END IF;

  DELETE FROM public.payment_reminders r
   WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

COMMENT ON FUNCTION public.delete_payment_reminder(uuid) IS
  'Removes one payment reminder of the session shop. Owner only.';

REVOKE ALL ON FUNCTION public.delete_payment_reminder(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payment_reminder(uuid) TO authenticated;

-- ── 3. Read them, for the screen that holds them ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_payment_reminders()
RETURNS TABLE (
  id              uuid,
  title           text,
  person          text,
  amount          numeric,
  due_on          date,
  due_time        time,
  repeat_every    integer,
  repeat_unit     text,
  created_by_name text
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
  SELECT r.id, r.title, r.person, r.amount, r.due_on, r.due_time,
         r.repeat_every, r.repeat_unit, u.name::text
    FROM public.payment_reminders r
    LEFT JOIN public.users u ON u.id = r.created_by
   WHERE r.shop_id = v_member.tenant_id
     AND r.branch_id = v_branch
     AND r.is_active
   ORDER BY r.due_on, r.due_time;
END;
$$;

COMMENT ON FUNCTION public.get_payment_reminders() IS
  'The session branch''s payment reminders, earliest first, behind payments.view. A reminder the caller may not read is not drawn as an empty diary.';

REVOKE ALL ON FUNCTION public.get_payment_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_reminders() TO authenticated;
