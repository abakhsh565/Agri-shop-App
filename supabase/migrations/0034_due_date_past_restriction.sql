-- 0034: Due Date past-date restriction + automatic reminder delivery

-- 1. Prevent past due dates at database level
ALTER TABLE customers
  ADD CONSTRAINT due_date_not_past
  CHECK (due_date IS NULL OR due_date >= CURRENT_DATE);

-- 2. Enable pg_cron extension (Supabase managed)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 3. Edge Function: process_reminders
-- This function is called by pg_cron daily at 08:00 UTC
-- It evaluates all active reminder configs and logs eligible reminders
CREATE OR REPLACE FUNCTION process_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  rec RECORD;
  config_rec RECORD;
  now_date date := CURRENT_DATE;
  days_overdue integer;
  trigger_date date;
  sent_count integer;
  msg text;
BEGIN
  -- For each customer with outstanding balance
  FOR rec IN
    SELECT c.id, c.name, c.phone, c.due_date, c.outstanding_balance
    FROM customers c
    WHERE c.outstanding_balance > 0
  LOOP
    -- Skip customers without a due date
    IF rec.due_date IS NULL THEN
      CONTINUE;
    END IF;

    -- Check if due date has passed
    days_overdue := now_date - rec.due_date;

    -- Only process customers whose due date has arrived or passed
    IF days_overdue < 0 THEN
      CONTINUE;
    END IF;

    -- For each reminder config for this customer
    FOR config_rec IN
      SELECT rc.*
      FROM reminder_configs rc
      WHERE rc.customer_id = rec.id
        AND rc.enabled = true
    LOOP
      -- Check if reminder should fire based on anchor + days
      trigger_date := NULL;

      IF config_rec.anchor = 'before_due' THEN
        trigger_date := rec.due_date - config_rec.start_days;
      ELSIF config_rec.anchor = 'after_due' THEN
        trigger_date := rec.due_date + config_rec.start_days;
      ELSIF config_rec.anchor = 'after_credit' THEN
        -- Use the most recent credit sale date
        SELECT MAX(s.created_at)::date INTO trigger_date
        FROM sales s
        WHERE s.customer_id = rec.id
          AND s.payment_type != 'full'
          AND s.is_voided = false;
        IF trigger_date IS NOT NULL THEN
          trigger_date := trigger_date + config_rec.start_days;
        END IF;
      END IF;

      -- Skip if trigger date hasn't been reached yet
      IF trigger_date IS NULL OR trigger_date > now_date THEN
        CONTINUE;
      END IF;

      -- Check stop conditions
      IF config_rec.ends = 'count' THEN
        SELECT COUNT(*) INTO sent_count
        FROM reminder_logs
        WHERE customer_id = rec.id AND config_id = config_rec.id::text;
        IF sent_count >= config_rec.ends_count THEN
          CONTINUE;
        END IF;
      ELSIF config_rec.ends = 'date' AND config_rec.ends_date IS NOT NULL THEN
        IF config_rec.ends_date < now_date THEN
          CONTINUE;
        END IF;
      END IF;

      -- Determine tone
      msg := 'Hello ' || split_part(rec.name, ' ', 1) ||
             ', Rs. ' || rec.outstanding_balance::integer ||
             ' remains outstanding on your account. Please arrange payment.';

      -- Insert reminder log (will be picked up by app as Ready to Send)
      INSERT INTO reminder_logs (customer_id, customer_name, config_id, tone, message, channel, sent_at)
      VALUES (
        rec.id,
        rec.name,
        config_rec.id::text,
        'gentle',
        msg,
        'auto_generated',
        now()
      );

      RAISE NOTICE 'Reminder created for % (config %)', rec.name, config_rec.id;
    END LOOP;
  END LOOP;
END;
$$;

-- 4. Schedule pg_cron to run daily at 08:00 UTC
-- This creates "ready to send" reminders that the owner can review and send
SELECT cron.schedule(
  'daily-reminder-check',
  '0 8 * * *',
  $$SELECT process_reminders()$$
);
