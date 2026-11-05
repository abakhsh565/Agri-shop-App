-- 0285 — Employees can manage customers and record payments; customer reminders travel with the customer.
--
-- WHY THIS EXISTS. Three rules were only partly true in the app:
--   * Record Payment was hidden from roles that did not hold `customers.payments`, even though
--     the business wants every employee working a branch to be able to take money at the counter.
--   * Customer add/edit was gated by grants that several seeded employee roles never received,
--     while customer deletion was still held by the Store Manager role.
--   * The owner's payment diary was readable only with `payments.view`, so an employee opening a
--     customer's reminders got an empty/failed screen and the owner-only Finance link could end
--     their session.
--
-- WHAT THIS FILE DOES.
--   1. Every role receives `customers.create`, `customers.edit` and `customers.payments`.
--   2. Every role loses `customers.delete`; the owner's implicit authority is unchanged.
--   3. A role created later gets the same customer defaults at insert time.
--   4. `get_payment_reminders` lets an employee with `customers.view` read CUSTOMER reminders for
--      their own branch. Supplier and general notes remain owner-only.
--   5. Customer payments stamp the employee's identity on the row and write one owner notification
--      from the database (the first split row only), so the audit and the notification cannot be
--      skipped by a browser that never calls the client helper.
--
-- WHAT IT DOES NOT DO. It does not let an employee write, close or delete a reminder; that remains
-- the owner's diary. It does not widen supplier/general reminders. It does not change a balance or
-- create a second ledger.

-- ── 1. Customer defaults for every existing role ───────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE p.code IN ('customers.create', 'customers.edit', 'customers.payments')
ON CONFLICT DO NOTHING;

-- Employees do not delete customers. The owner's access is implicit and is not stored here.
DELETE FROM public.role_permissions rp
 USING public.permissions p
 WHERE rp.permission_id = p.id
   AND p.code = 'customers.delete';

-- ── 2. The same defaults for a role created later ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.grant_customer_defaults_to_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT NEW.id, p.id
    FROM public.permissions p
   WHERE p.code IN ('customers.create', 'customers.edit', 'customers.payments')
  ON CONFLICT DO NOTHING;

  DELETE FROM public.role_permissions rp
   USING public.permissions p
   WHERE rp.role_id = NEW.id
     AND rp.permission_id = p.id
     AND p.code = 'customers.delete';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS roles_customer_defaults ON public.roles;
CREATE TRIGGER roles_customer_defaults
AFTER INSERT ON public.roles
FOR EACH ROW
EXECUTE FUNCTION public.grant_customer_defaults_to_role();

-- ── 3. Customer reminders are readable by the people serving the customer ──────────────────────
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
  v_owner boolean;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;

  v_owner := v_member.role = 'owner';
  IF NOT v_owner
     AND NOT public.has_effective_permission('customers.view', v_member.user_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission customers.view';
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
     AND (v_owner OR r.kind = 'customer')
     AND (COALESCE(p_include_closed, false) OR r.status = 'upcoming')
   ORDER BY r.due_on, r.due_time;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_reminders(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payment_reminders(boolean) TO authenticated;

-- ── 4. Every customer payment carries its author, and tells the owner ─────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_customer_payment_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_name  text;
BEGIN
  SELECT u.name INTO v_name FROM public.users u WHERE u.id = v_actor;
  IF NEW.recorded_by IS NULL AND v_actor IS NOT NULL THEN
    NEW.recorded_by := v_actor::text;
  END IF;
  IF NEW.recorded_by_name IS NULL THEN
    NEW.recorded_by_name := COALESCE(v_name, 'Staff');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_payments_stamp_actor ON public.customer_payments;
CREATE TRIGGER customer_payments_stamp_actor
BEFORE INSERT ON public.customer_payments
FOR EACH ROW
EXECUTE FUNCTION public.stamp_customer_payment_actor();

CREATE OR REPLACE FUNCTION public.notify_owner_of_customer_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer text;
  v_shop     uuid;
  v_actor    uuid := public.app_current_user_id();
  v_actor_nm text;
BEGIN
  -- A split payment writes one row per method. The first row is the payment; the rest are
  -- its allocation, so they must not produce three identical owner notifications.
  IF COALESCE(NEW.split_index, 0) <> 0 THEN
    RETURN NEW;
  END IF;

  SELECT c.name, c.shop_id INTO v_customer, v_shop
    FROM public.customers c WHERE c.id = NEW.customer_id;
  IF v_shop IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.name INTO v_actor_nm FROM public.users u WHERE u.id = v_actor;

  INSERT INTO public.notifications (
    kind, title, message, body, entity_type, entity_id,
    shop_id, branch_id, actor_id, actor_name
  ) VALUES (
    'payment',
    'Payment received: Rs. ' || to_char(NEW.amount, 'FM999G999G999G990D00'),
    'Payment recorded',
    COALESCE(v_customer, 'Customer') || ' paid Rs. '
      || to_char(NEW.amount, 'FM999G999G999G990D00')
      || COALESCE(' — recorded by ' || NULLIF(v_actor_nm, ''), ''),
    'customer',
    NEW.customer_id,
    v_shop,
    COALESCE(NEW.branch_id, public.current_branch_id()),
    v_actor,
    COALESCE(v_actor_nm, NEW.recorded_by_name, 'Staff')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_payments_notify_owner ON public.customer_payments;
CREATE TRIGGER customer_payments_notify_owner
AFTER INSERT ON public.customer_payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_owner_of_customer_payment();

REVOKE ALL ON FUNCTION public.stamp_customer_payment_actor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_owner_of_customer_payment() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_customer_defaults_to_role() FROM PUBLIC, anon;

-- ── 5. A due recurring entry tells the owner it was written ────────────────────────────────────
-- `post_due_finance_entries()` is called when the money screens open. It writes the row with the
-- day it fell due, but nothing told the owner it had happened. The alert is written by the same
-- insert, so it exists even if the screen is closed immediately after the RPC returns.
CREATE OR REPLACE FUNCTION public.notify_owner_of_scheduled_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_nm text;
BEGIN
  SELECT u.name INTO v_actor_nm FROM public.users u WHERE u.id = NEW.created_by;

  INSERT INTO public.notifications (
    kind, title, message, body, entity_type, entity_id,
    shop_id, branch_id, actor_id, actor_name
  ) VALUES (
    'scheduled_money',
    'Scheduled ' || CASE NEW.kind
      WHEN 'income' THEN 'income'
      WHEN 'drawing' THEN 'drawing'
      ELSE 'expense'
    END || ' recorded: Rs. ' || to_char(NEW.amount, 'FM999G999G999G990D00'),
    'A repeating entry fell due',
    COALESCE(NULLIF(NEW.category, ''), 'Scheduled money')
      || COALESCE(' · ' || NULLIF(NEW.counterparty, ''), '')
      || ' · ' || to_char(NEW.occurred_on, 'DD Mon YYYY'),
    'finance_entry',
    NEW.id,
    NEW.shop_id,
    NEW.branch_id,
    NEW.created_by,
    COALESCE(v_actor_nm, 'Owner')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finance_entries_notify_scheduled ON public.finance_entries;
CREATE TRIGGER finance_entries_notify_scheduled
AFTER INSERT ON public.finance_entries
FOR EACH ROW
WHEN (NEW.recurrence_id IS NOT NULL)
EXECUTE FUNCTION public.notify_owner_of_scheduled_money();

REVOKE ALL ON FUNCTION public.notify_owner_of_scheduled_money() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.get_payment_reminders(boolean) IS
  'The session branch''s payment reminders. Owner reads all; an employee with customers.view reads customer reminders only. Supplier/general notes stay private to the owner.';
COMMENT ON TRIGGER customer_payments_stamp_actor ON public.customer_payments IS
  'Stores the signed-in employee on the payment row, so the customer history names who took the money.';
COMMENT ON TRIGGER customer_payments_notify_owner ON public.customer_payments IS
  'Writes one owner notification for a payment, including the employee name, from the database rather than the browser.';
COMMENT ON TRIGGER finance_entries_notify_scheduled ON public.finance_entries IS
  'When a due cadence posts its row, tells the owner the amount, category and date that were written.';
