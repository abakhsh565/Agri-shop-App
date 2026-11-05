-- 0257 — A payment reminder knows who it is about, and whether it is still owed.
--
-- WHY THIS EXISTS. 0256 gave the owner a diary line per payment: a name, an optional person, a
-- day, a time and a cadence. The owner then asked for the same reminder everywhere money is owed —
-- "collect from Kasim", "pay ABC Seeds", "review the bank charge" — and for it to be closable once
-- the payment happened. Three facts were missing for that: WHAT the reminder is about (customer,
-- supplier, or neither), WHO in the business it points at (a real customer or supplier row, not a
-- typed name that can drift from the record), and WHERE it stands (still owed, done, or dropped).
--
-- WHY A PARTY LINK AND NOT JUST A NAME. `person` stays as the printed label, but the screen that
-- asks "what am I chasing this supplier about" has to find the reminders of one supplier, and a
-- typed name cannot answer that. The links are optional by kind, enforced below, so a general note
-- still needs no party at all.
--
-- WHY STATUS AND NOT MORE is_active ROWS. `is_active` was a boolean because a reminder was either
-- shown or deleted. A closed reminder is neither: it happened, and the owner asked to be able to
-- look back at it. Status is that one column, and `is_active` stays derived from it so the older
-- reads cannot see a done reminder as an open one.
--
-- WHAT IS STILL DELIBERATELY NOT INVENTED:
--   * No push, no scheduler, no message. Closing a reminder records that the owner dealt with it;
--     it never writes a payment, a ledger row or a customer balance.
--   * No occurrences table. A repeat keeps its original day and cadence and the screen derives the
--     next date (`repeatSchedule.ts`), so there is no shadow calendar to drift.

-- ── 1. The three facts ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.payment_reminders
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_id  uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes       text,
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'upcoming';

DO $$
BEGIN
  ALTER TABLE public.payment_reminders
    ADD CONSTRAINT payment_reminders_kind_check
    CHECK (kind IN ('customer', 'supplier', 'general'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.payment_reminders
    ADD CONSTRAINT payment_reminders_status_check
    CHECK (status IN ('upcoming', 'completed', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.payment_reminders
    ADD CONSTRAINT payment_reminders_notes_check
    CHECK (notes IS NULL OR length(btrim(notes)) <= 280);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A reminder about a customer points at a customer, never at a supplier and vice versa. Stated in
-- the table so a future writer cannot leave a row whose kind and link disagree.
DO $$
BEGIN
  ALTER TABLE public.payment_reminders
    ADD CONSTRAINT payment_reminders_party_check
    CHECK (
      (kind = 'customer' AND customer_id IS NOT NULL AND company_id IS NULL) OR
      (kind = 'supplier' AND company_id IS NOT NULL AND customer_id IS NULL) OR
      (kind = 'general'  AND customer_id IS NULL AND company_id IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A closed reminder is not active: the older reads filtered on `is_active`, so the two must agree.
UPDATE public.payment_reminders SET is_active = (status = 'upcoming');

CREATE INDEX IF NOT EXISTS payment_reminders_customer
  ON public.payment_reminders (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_reminders_company
  ON public.payment_reminders (company_id)
  WHERE company_id IS NOT NULL;

COMMENT ON COLUMN public.payment_reminders.kind IS
  'What the reminder is about: a customer paying the business, the business paying a supplier, or a payment with no record behind it.';
COMMENT ON COLUMN public.payment_reminders.status IS
  'upcoming = still to be dealt with; completed = the owner dealt with it; cancelled = dropped without happening. `is_active` mirrors `status = upcoming`.';
COMMENT ON COLUMN public.payment_reminders.notes IS
  'The owner''s own line about the payment. Not a message to anyone.';

-- ── 2. Write one, or change one ──────────────────────────────────────────────────────────────
-- The old signature is dropped first: an overload would leave two callable shapes and PostgREST
-- would have to guess which one a named call meant.
DROP FUNCTION IF EXISTS public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.save_payment_reminder(
  p_title        text,
  p_person       text,
  p_amount       numeric,
  p_due_on       date,
  p_due_time     time,
  p_repeat_every integer DEFAULT 1,
  p_repeat_unit  text    DEFAULT 'none',
  p_id           uuid    DEFAULT NULL,
  p_kind         text    DEFAULT 'general',
  p_customer_id  uuid    DEFAULT NULL,
  p_company_id   uuid    DEFAULT NULL,
  p_notes        text    DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   public.memberships;
  v_branch   uuid;
  v_every    integer := COALESCE(p_repeat_every, 1);
  v_unit     text := COALESCE(p_repeat_unit, 'none');
  v_kind     text := COALESCE(NULLIF(btrim(COALESCE(p_kind, '')), ''), 'general');
  v_customer uuid;
  v_company  uuid;
  v_person   text;
  v_notes    text;
  v_id       uuid;
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
  IF v_kind NOT IN ('customer', 'supplier', 'general') THEN
    RAISE EXCEPTION 'INVALID_KIND: expected customer, supplier or general';
  END IF;
  IF p_notes IS NOT NULL AND length(btrim(p_notes)) > 280 THEN
    RAISE EXCEPTION 'INVALID_NOTES: keep the note under 280 characters';
  END IF;

  v_branch := public.current_branch_id();
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  -- The link is checked against this business, not merely against the table: a reminder cannot
  -- point at another shop's customer.
  IF v_kind = 'customer' THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_PARTY: a customer reminder names a customer';
    END IF;
    SELECT c.id, c.name INTO v_customer, v_person
      FROM public.customers c
     WHERE c.id = p_customer_id AND c.shop_id = v_member.tenant_id AND c.is_active;
    IF v_customer IS NULL THEN
      RAISE EXCEPTION 'INVALID_PARTY: that customer is not part of this business';
    END IF;
  ELSIF v_kind = 'supplier' THEN
    IF p_company_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_PARTY: a supplier reminder names a supplier';
    END IF;
    SELECT c.id, c.name INTO v_company, v_person
      FROM public.companies c
     WHERE c.id = p_company_id AND c.shop_id = v_member.tenant_id AND c.is_active;
    IF v_company IS NULL THEN
      RAISE EXCEPTION 'INVALID_PARTY: that supplier is not part of this business';
    END IF;
  ELSE
    -- A general reminder has no record behind it; the typed name is the whole label.
    v_person := NULLIF(btrim(COALESCE(p_person, '')), '');
    IF v_person IS NOT NULL AND length(v_person) > 120 THEN
      RAISE EXCEPTION 'INVALID_PERSON';
    END IF;
  END IF;

  -- The stored label is the record's own name when there is a record, so a reminder card cannot
  -- disagree with the customer or supplier it was written about.
  IF v_person IS NOT NULL AND length(v_person) > 120 THEN
    v_person := left(v_person, 120);
  END IF;
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  IF p_id IS NULL THEN
    INSERT INTO public.payment_reminders (
      shop_id, branch_id, title, person, amount, due_on, due_time,
      repeat_every, repeat_unit, created_by,
      kind, customer_id, company_id, notes, status, is_active
    ) VALUES (
      v_member.tenant_id, v_branch, btrim(p_title), v_person, p_amount,
      p_due_on, COALESCE(p_due_time, TIME '09:00'),
      v_every, v_unit, v_member.user_id,
      v_kind, v_customer, v_company, v_notes, 'upcoming', true
    )
    RETURNING id INTO v_id;
  ELSE
    -- Editing reopens the reminder: the facts just changed, so it is owed again.
    UPDATE public.payment_reminders r
       SET title = btrim(p_title),
           person = v_person,
           amount = p_amount,
           due_on = p_due_on,
           due_time = COALESCE(p_due_time, TIME '09:00'),
           repeat_every = v_every,
           repeat_unit = v_unit,
           kind = v_kind,
           customer_id = v_customer,
           company_id = v_company,
           notes = v_notes,
           status = 'upcoming',
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

COMMENT ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid, text, uuid, uuid, text) IS
  'Creates or edits one payment reminder for the session branch. Owner only; checks the name, the amount, the cadence, and that the linked customer or supplier belongs to this business.';

REVOKE ALL ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payment_reminder(text, text, numeric, date, time, integer, text, uuid, text, uuid, uuid, text) TO authenticated;

-- ── 3. Close one: done, or dropped ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_payment_reminder_status(p_id uuid, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_status text := COALESCE(p_status, '');
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner closes payment reminders';
  END IF;
  IF v_status NOT IN ('upcoming', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS: expected upcoming, completed or cancelled';
  END IF;

  UPDATE public.payment_reminders r
     SET status = v_status,
         is_active = (v_status = 'upcoming'),
         updated_at = now()
   WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.set_payment_reminder_status(uuid, text) IS
  'Marks one reminder done, dropped, or owed again. Owner only. Records the owner''s decision; it writes no payment and moves no balance.';

REVOKE ALL ON FUNCTION public.set_payment_reminder_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_payment_reminder_status(uuid, text) TO authenticated;

-- ── 4. Remove one ────────────────────────────────────────────────────────────────────────────
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

-- ── 5. Read them, for the screen that holds them ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_payment_reminders();

CREATE OR REPLACE FUNCTION public.get_payment_reminders(p_include_closed boolean DEFAULT false)
RETURNS TABLE (
  id              uuid,
  title           text,
  person          text,
  amount          numeric,
  due_on          date,
  due_time        time,
  repeat_every    integer,
  repeat_unit     text,
  kind            text,
  status          text,
  notes           text,
  customer_id     uuid,
  company_id      uuid,
  customer_name   text,
  company_name    text,
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
         r.repeat_every, r.repeat_unit, r.kind, r.status, r.notes,
         r.customer_id, r.company_id,
         c.name::text, co.name::text, u.name::text
    FROM public.payment_reminders r
    LEFT JOIN public.customers c ON c.id = r.customer_id
    LEFT JOIN public.companies co ON co.id = r.company_id
    LEFT JOIN public.users u ON u.id = r.created_by
   WHERE r.shop_id = v_member.tenant_id
     AND r.branch_id = v_branch
     AND (COALESCE(p_include_closed, false) OR r.status = 'upcoming')
   ORDER BY r.due_on, r.due_time;
END;
$$;

COMMENT ON FUNCTION public.get_payment_reminders(boolean) IS
  'The session branch''s payment reminders, earliest first, behind payments.view. Open reminders only unless the caller asks for the closed ones, which the book screen does. A reminder the caller may not read is not drawn as an empty diary.';

REVOKE ALL ON FUNCTION public.get_payment_reminders(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_reminders(boolean) TO authenticated;
