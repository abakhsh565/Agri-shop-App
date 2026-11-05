-- 0278 — Salary is a recurring expense owned by the employee it pays.
--
-- WHY IT REUSES finance_recurrences. Rent, a daily wage and a monthly salary are the same
-- fact: a plan that writes a real expense row on each due date. A second payroll ledger would
-- let the Finance screen count a salary that the Money statement did not show, which is exactly
-- the drift the one-ledger rule prevents.
--
-- WHAT IS NEW.
--   * finance_recurrences can carry the employee a rule pays and say that it is a salary;
--   * a yearly cadence is allowed (an annual service contract is a real expense);
--   * employee_compensations holds the agreed amount, pay day and end, including a salary that
--     is NOT posted to expenses (the owner may want the record without the ledger write);
--   * upsert_employee_salary validates and replaces one employee's schedule in one transaction;
--   * get_employee_salary returns the schedule and the rows already paid, for the employee screen;
--   * get_salary_overview feeds the Finance widget without inventing payroll that has not posted.
--
-- A salary rule starts on its first pay date, not on the day it was entered, and nothing is
-- posted by creating it. post_due_finance_entries writes the rows when each date arrives.

ALTER TABLE public.finance_recurrences
  DROP CONSTRAINT IF EXISTS finance_recurrences_repeat_unit_check;
ALTER TABLE public.finance_recurrences
  ADD CONSTRAINT finance_recurrences_repeat_unit_check
  CHECK (repeat_unit IN ('day', 'week', 'month', 'year'));

ALTER TABLE public.finance_recurrences
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'finance_recurrences_source_check'
       AND conrelid = 'public.finance_recurrences'::regclass
  ) THEN
    ALTER TABLE public.finance_recurrences
      ADD CONSTRAINT finance_recurrences_source_check
      CHECK (source IN ('manual', 'salary'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS finance_recurrences_employee
  ON public.finance_recurrences (employee_id, is_active)
  WHERE employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.employee_compensations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id       uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  user_id         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  pay_every       integer NOT NULL DEFAULT 1 CHECK (pay_every BETWEEN 1 AND 60),
  pay_unit        text NOT NULL CHECK (pay_unit IN ('day', 'week', 'month', 'year')),
  pay_day         integer CHECK (pay_day IS NULL OR pay_day BETWEEN 1 AND 31),
  starts_on       date NOT NULL,
  ends_on         date,
  total_payments  integer CHECK (total_payments IS NULL OR total_payments > 0),
  method          text NOT NULL CHECK (method IN ('cash', 'bank', 'easypaisa', 'jazzcash')),
  add_to_expenses boolean NOT NULL DEFAULT true,
  recurrence_id   uuid REFERENCES public.finance_recurrences(id) ON DELETE SET NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_compensations_ends_after_start CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_compensations_one_per_person
  ON public.employee_compensations (shop_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS employee_compensations_next
  ON public.employee_compensations (shop_id, branch_id, is_active);

ALTER TABLE public.employee_compensations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.employee_compensations FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.employee_compensations IS
  'The agreed salary or wage for one employee, and the recurring expense rule that pays it. Server-owned; owner-only through get_employee_salary / upsert_employee_salary. Deleting or deactivating an employee does not erase the payments already recorded.';

-- ── 1. Save or replace one employee's salary schedule ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_employee_salary(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member     public.memberships;
  v_employee   uuid := NULLIF(payload->>'employeeId', '')::uuid;
  v_name       text;
  v_branch     uuid;
  v_amount     numeric := NULLIF(payload->>'amount', '')::numeric;
  v_every      integer := COALESCE(NULLIF(payload->>'payEvery', '')::integer, 1);
  v_unit       text := COALESCE(NULLIF(payload->>'payUnit', ''), 'month');
  v_pay_day    integer := NULLIF(payload->>'payDay', '')::integer;
  v_start      date := COALESCE(NULLIF(payload->>'startsOn', '')::date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_end        date := NULLIF(payload->>'endsOn', '')::date;
  v_total      integer := NULLIF(payload->>'totalPayments', '')::integer;
  v_method     text := COALESCE(NULLIF(payload->>'method', ''), 'cash');
  v_add        boolean := COALESCE((payload->>'addToExpenses')::boolean, true);
  v_note       text := NULLIF(btrim(COALESCE(payload->>'note', '')), '');
  v_next       date;
  v_month      date;
  v_last_day   integer;
  v_rule       uuid;
  v_comp       uuid;
  v_old_rule   uuid;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner manages salary schedules';
  END IF;

  IF v_employee IS NULL THEN RAISE EXCEPTION 'INVALID_EMPLOYEE'; END IF;
  SELECT u.name INTO v_name
    FROM public.users u
    JOIN public.memberships m ON m.user_id = u.id AND m.tenant_id = v_member.tenant_id
   WHERE u.id = v_employee
   LIMIT 1;
  IF v_name IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  IF v_amount IS NULL OR v_amount <= 0 OR v_amount > 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: a salary is above zero';
  END IF;
  IF v_unit NOT IN ('day', 'week', 'month', 'year') THEN
    RAISE EXCEPTION 'INVALID_PAY_UNIT';
  END IF;
  IF v_every < 1 OR v_every > 60 THEN
    RAISE EXCEPTION 'INVALID_PAY_EVERY';
  END IF;
  IF v_method NOT IN ('cash', 'bank', 'easypaisa', 'jazzcash') THEN
    RAISE EXCEPTION 'INVALID_METHOD';
  END IF;
  IF v_unit = 'month' AND (v_pay_day IS NULL OR v_pay_day < 1 OR v_pay_day > 31) THEN
    RAISE EXCEPTION 'INVALID_PAY_DAY: a monthly salary needs a day between 1 and 31';
  END IF;
  IF v_total IS NOT NULL AND v_total < 1 THEN
    RAISE EXCEPTION 'INVALID_TOTAL_PAYMENTS';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'INVALID_NOTE';
  END IF;

  v_branch := COALESCE(NULLIF(payload->>'branchId', '')::uuid, public.current_branch_id());
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = v_branch AND b.tenant_id = v_member.tenant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that branch is not part of this business';
  END IF;

  -- A monthly salary pays on its chosen day. If that day has already passed in the start
  -- month, the first payment is the next month; a shorter month clamps 31 to its last day.
  IF v_unit = 'month' THEN
    v_month := date_trunc('month', v_start)::date;
    v_last_day := EXTRACT(DAY FROM (date_trunc('month', v_start) + interval '1 month - 1 day'))::integer;
    v_next := v_month + (LEAST(v_pay_day, v_last_day) - 1);
    IF v_next < v_start THEN
      v_month := (date_trunc('month', v_start) + interval '1 month')::date;
      v_last_day := EXTRACT(DAY FROM (date_trunc('month', v_start) + interval '2 month - 1 day'))::integer;
      v_next := v_month + (LEAST(v_pay_day, v_last_day) - 1);
    END IF;
  ELSE
    v_next := v_start;
    v_pay_day := NULL;
  END IF;

  IF v_end IS NULL AND v_total IS NOT NULL THEN
    v_end := CASE v_unit
      WHEN 'day'   THEN v_next + ((v_total - 1) * v_every)
      WHEN 'week'  THEN v_next + ((v_total - 1) * v_every * 7)
      WHEN 'month' THEN (v_next + make_interval(months => ((v_total - 1) * v_every)))::date
      WHEN 'year'  THEN (v_next + make_interval(years => ((v_total - 1) * v_every)))::date
    END;
  END IF;
  IF v_end IS NOT NULL AND v_end < v_start THEN
    RAISE EXCEPTION 'INVALID_END: the salary cannot end before it starts';
  END IF;

  SELECT recurrence_id INTO v_old_rule
    FROM public.employee_compensations
   WHERE shop_id = v_member.tenant_id AND user_id = v_employee;

  IF v_old_rule IS NOT NULL THEN
    UPDATE public.finance_recurrences
       SET is_active = false, updated_at = now()
     WHERE id = v_old_rule AND shop_id = v_member.tenant_id;
  END IF;

  IF v_add THEN
    INSERT INTO public.finance_recurrences (
      shop_id, branch_id, kind, amount, category, method, counterparty, note,
      repeat_every, repeat_unit, starts_on, next_on, ends_on, is_active,
      created_by, employee_id, source
    ) VALUES (
      v_member.tenant_id, v_branch, 'expense', v_amount, 'salaries', v_method,
      v_name, COALESCE(v_note, 'Salary · ' || v_name),
      v_every, v_unit, v_start, v_next, v_end, true,
      v_member.user_id, v_employee, 'salary'
    )
    RETURNING id INTO v_rule;
  END IF;

  INSERT INTO public.employee_compensations (
    shop_id, branch_id, user_id, amount, pay_every, pay_unit, pay_day,
    starts_on, ends_on, total_payments, method, add_to_expenses,
    recurrence_id, is_active, created_by
  ) VALUES (
    v_member.tenant_id, v_branch, v_employee, v_amount, v_every, v_unit, v_pay_day,
    v_start, v_end, v_total, v_method, v_add,
    v_rule, true, v_member.user_id
  )
  ON CONFLICT (shop_id, user_id) WHERE user_id IS NOT NULL DO UPDATE
    SET branch_id = EXCLUDED.branch_id,
        amount = EXCLUDED.amount,
        pay_every = EXCLUDED.pay_every,
        pay_unit = EXCLUDED.pay_unit,
        pay_day = EXCLUDED.pay_day,
        starts_on = EXCLUDED.starts_on,
        ends_on = EXCLUDED.ends_on,
        total_payments = EXCLUDED.total_payments,
        method = EXCLUDED.method,
        add_to_expenses = EXCLUDED.add_to_expenses,
        recurrence_id = EXCLUDED.recurrence_id,
        is_active = true,
        updated_at = now()
  RETURNING id INTO v_comp;

  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_member.user_id, 'employee_salary_saved', 'employee', v_employee,
          jsonb_build_object('amount', v_amount, 'payUnit', v_unit, 'payEvery', v_every,
                             'startsOn', v_start, 'endsOn', v_end, 'addToExpenses', v_add));

  RETURN jsonb_build_object(
    'compensationId', v_comp,
    'employeeId', v_employee,
    'recurrenceId', v_rule,
    'nextOn', CASE WHEN v_add THEN v_next ELSE NULL END,
    'addToExpenses', v_add
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_employee_salary(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_employee_salary(jsonb) TO authenticated;

-- ── 2. One employee's schedule and the rows already paid ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_employee_salary(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_comp   public.employee_compensations;
  v_rule   public.finance_recurrences;
  v_name   text;
  v_history jsonb;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  IF v_member.role <> 'owner' AND v_member.user_id <> p_employee_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: salary is private to the owner and the employee';
  END IF;

  SELECT * INTO v_comp
    FROM public.employee_compensations c
   WHERE c.shop_id = v_member.tenant_id AND c.user_id = p_employee_id;
  IF v_comp.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_rule FROM public.finance_recurrences r WHERE r.id = v_comp.recurrence_id;
  SELECT name INTO v_name FROM public.users WHERE id = p_employee_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', fe.id,
           'amount', fe.amount,
           'occurredOn', fe.occurred_on,
           'method', fe.method,
           'note', fe.note,
           'createdAt', fe.created_at
         ) ORDER BY fe.occurred_on DESC), '[]'::jsonb)
    INTO v_history
    FROM public.finance_entries fe
   WHERE fe.shop_id = v_member.tenant_id
     AND fe.recurrence_id = v_comp.recurrence_id
     AND fe.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'employeeId', p_employee_id,
    'employeeName', v_name,
    'compensationId', v_comp.id,
    'amount', v_comp.amount,
    'payEvery', v_comp.pay_every,
    'payUnit', v_comp.pay_unit,
    'payDay', v_comp.pay_day,
    'startsOn', v_comp.starts_on,
    'endsOn', v_comp.ends_on,
    'totalPayments', v_comp.total_payments,
    'method', v_comp.method,
    'addToExpenses', v_comp.add_to_expenses,
    'isActive', v_comp.is_active AND COALESCE(v_rule.is_active, false),
    'nextOn', v_rule.next_on,
    'recurrenceId', v_comp.recurrence_id,
    'history', v_history
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_employee_salary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_salary(uuid) TO authenticated;

-- ── 3. The Finance widget's read ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_salary_overview()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
  v_rows   jsonb;
  v_count  integer;
  v_next   date;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  IF v_member.role <> 'owner' AND NOT public.has_effective_permission('payments.view') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'employeeId', c.user_id,
           'employeeName', u.name,
           'amount', c.amount,
           'payEvery', c.pay_every,
           'payUnit', c.pay_unit,
           'payDay', c.pay_day,
           'startsOn', c.starts_on,
           'endsOn', c.ends_on,
           'addToExpenses', c.add_to_expenses,
           'nextOn', r.next_on,
           'recurrenceId', c.recurrence_id
         ) ORDER BY r.next_on NULLS LAST, u.name), '[]'::jsonb),
         count(*) FILTER (WHERE r.is_active),
         min(r.next_on) FILTER (WHERE r.is_active)
    INTO v_rows, v_count, v_next
    FROM public.employee_compensations c
    JOIN public.users u ON u.id = c.user_id
    LEFT JOIN public.finance_recurrences r ON r.id = c.recurrence_id
   WHERE c.shop_id = v_member.tenant_id
     AND c.branch_id = v_branch
     AND c.is_active;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'activeCount', COALESCE(v_count, 0),
    'nextOn', v_next
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_salary_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_salary_overview() TO authenticated;

-- ── 4. A stopped schedule does not keep claiming it will pay ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.stop_finance_recurrence(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_count  integer;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner stops scheduled money';
  END IF;

  UPDATE public.finance_recurrences r
     SET is_active = false, updated_at = now()
   WHERE r.id = p_id AND r.shop_id = v_member.tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.employee_compensations
     SET is_active = false, updated_at = now()
   WHERE recurrence_id = p_id AND shop_id = v_member.tenant_id;

  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.stop_finance_recurrence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stop_finance_recurrence(uuid) TO authenticated;

-- ── 5. Posting learns the yearly cadence and settles a salary that has ended ──────────────────
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
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
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
      IF v_rule.ends_on IS NOT NULL AND v_next > v_rule.ends_on THEN EXIT; END IF;

      INSERT INTO public.finance_entries (
        shop_id, branch_id, kind, amount, occurred_on, category, method,
        counterparty, note, created_by, recurrence_id
      ) VALUES (
        v_rule.shop_id, v_rule.branch_id, v_rule.kind, v_rule.amount, v_next,
        v_rule.category, v_rule.method, v_rule.counterparty, v_rule.note,
        v_rule.created_by, v_rule.id
      )
      ON CONFLICT DO NOTHING;
      IF FOUND THEN v_posted := v_posted + 1; END IF;

      v_next := CASE v_rule.repeat_unit
        WHEN 'day'  THEN v_next + v_rule.repeat_every
        WHEN 'week' THEN v_next + (v_rule.repeat_every * 7)
        WHEN 'month' THEN (v_next + make_interval(months => v_rule.repeat_every))::date
        WHEN 'year' THEN (v_next + make_interval(years => v_rule.repeat_every))::date
      END;
      v_guard := v_guard + 1;
    END LOOP;

    UPDATE public.finance_recurrences
       SET next_on = v_next,
           is_active = NOT (ends_on IS NOT NULL AND v_next > ends_on),
           updated_at = now()
     WHERE id = v_rule.id;

    IF v_rule.ends_on IS NOT NULL AND v_next > v_rule.ends_on THEN
      UPDATE public.employee_compensations
         SET is_active = false, updated_at = now()
       WHERE recurrence_id = v_rule.id AND shop_id = v_member.tenant_id;
    END IF;
  END LOOP;

  RETURN v_posted;
END;
$$;

REVOKE ALL ON FUNCTION public.post_due_finance_entries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_due_finance_entries() TO authenticated;

-- ── 6. The cadence read names the employee it pays ────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_finance_recurrences();

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
  ends_on      date,
  starts_on    date,
  source       text,
  employee_id  uuid,
  employee_name text
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
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied'; END IF;
  IF NOT public.has_effective_permission('payments.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission payments.view';
  END IF;

  v_branch := public.current_branch_id();

  RETURN QUERY
  SELECT r.id, r.kind, r.amount, r.category, r.method, r.counterparty, r.note,
         r.repeat_every, r.repeat_unit, r.next_on, r.ends_on, r.starts_on,
         r.source, r.employee_id, u.name::text
    FROM public.finance_recurrences r
    LEFT JOIN public.users u ON u.id = r.employee_id
   WHERE r.shop_id = v_member.tenant_id
     AND r.branch_id = v_branch
     AND r.is_active
   ORDER BY r.next_on, r.created_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_finance_recurrences() TO authenticated;
REVOKE ALL ON FUNCTION public.get_finance_recurrences() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
