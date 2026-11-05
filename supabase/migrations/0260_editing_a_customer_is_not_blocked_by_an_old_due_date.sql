-- 0260 — Editing a customer is not blocked by a due date that has since passed.
--
-- WHY THIS EXISTS. `due_date_not_past` (0034) is a row CHECK:
--   due_date IS NULL OR due_date >= CURRENT_DATE
-- A CHECK is evaluated on EVERY insert and update of the row, not only when the column changes.
-- So the day after a customer's payment due date went by, every write to that customer failed
-- with `new row for relation "customers" violates check constraint "due_date_not_past"` —
-- editing the name or the address, clearing the archive flag, any client update at all. The
-- owner hit it as "I can't edit customer, there is an error", and the message named a column
-- they had not touched.
--
-- WHAT IT BECOMES. The rule is about SETTING a due date, not about holding one. A date typed in
-- the past is still refused; a date that is already stored and has since passed is a fact about
-- the account, not an error. A BEFORE INSERT OR UPDATE OF due_date trigger enforces exactly
-- that: it fires when the column is being written at all, and lets the row through when the date
-- is unchanged — so a normal edit never touches it.
--
-- THE DAY IS THE SHOP'S DAY. CURRENT_DATE is the server's UTC date, while `pkDate.ts` and every
-- screen read Asia/Karachi; at 00:30 in Lahore the old check was still judging "yesterday". The
-- trigger uses the same business day the app does.
--
-- Nothing else changes: the column, its default and every reader of it stay as they were. This
-- is idempotent and forward-only.

-- The constraint can only be dropped by name, and a database that never received 0034 simply has
-- nothing to drop.
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS due_date_not_past;

CREATE OR REPLACE FUNCTION public.customers_due_date_not_past()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  -- `UPDATE OF due_date` already narrows this to writes that mention the column; the DISTINCT
  -- test is for the one case that remains — a client sending the value it already had.
  IF NEW.due_date IS NOT NULL
     AND NEW.due_date < v_today
     AND (TG_OP = 'INSERT' OR NEW.due_date IS DISTINCT FROM OLD.due_date)
  THEN
    RAISE EXCEPTION 'A payment due date cannot be in the past.'
      USING ERRCODE = '23514', CONSTRAINT = 'due_date_not_past';
  END IF;
  RETURN NEW;
END;
$$;

-- A trigger function is not an RPC; closing it keeps it out of the callable surface anyway.
REVOKE ALL ON FUNCTION public.customers_due_date_not_past() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS customers_due_date_not_past ON public.customers;
CREATE TRIGGER customers_due_date_not_past
  BEFORE INSERT OR UPDATE OF due_date ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_due_date_not_past();
