-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0143: one reminder rule per customer — structurally
-- ═══════════════════════════════════════════════════════════════════════════════
-- REPORTED: "the Follow-ups section shows multiple follow-ups over time" for a
-- customer whose configuration was a single rule ("after due date: 3 days").
--
-- FOUND in the live QA database: customer "Mudasir" carried TWO byte-identical
-- reminder_configs —
--     aad24591…  and  d8e69aab…   start_days=3, anchor=before_due,
--     repeat_type=interval, interval_n=2, ends=paid, same escalation —
-- each having generated its own 30 occurrences. Two identical schedules meant the
-- customer received every reminder twice, every two days, forever.
--
-- WHY: the rule is customer-scoped, and nothing enforced that. `saveReminderConfig`
-- inserts unconditionally whenever the caller passes no id, and `saveReminderGroup`
-- mints a fresh group id per creation and inserts one row per selected customer, so
-- applying the same rule to a customer who already had it simply added a second
-- schedule. `isDuplicateReminder` existed but only guarded ONE screen.
--
-- FIX: identity is a property of the data, so it is enforced by the database.
--   1. `dedupe_key` = md5 of the rule's identity (customer + every field that
--      changes WHEN it fires), computed by trigger on insert and update.
--   2. UNIQUE (shop_id, customer_id, dedupe_key) — a second identical schedule is
--      now impossible, whatever the caller is.
--   3. Existing duplicates are repaired: the earliest config of each identical set
--      survives and the later copies and their occurrences are removed.
--
-- Editing a rule does not collide: the update keeps its own row, and the client
-- stops a change that would make two rules identical before it is sent.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reminder_configs
  ADD COLUMN IF NOT EXISTS dedupe_key text;

COMMENT ON COLUMN public.reminder_configs.dedupe_key IS
  'md5 fingerprint of this rule''s identity for one customer. Same fingerprint = same reminder schedule.';

CREATE OR REPLACE FUNCTION public.reminder_config_dedupe_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Every field that decides WHEN this reminder fires, and nothing else: two rules
  -- that fire at the same times are the same rule.
  NEW.dedupe_key := md5(concat_ws('|',
    COALESCE(NEW.customer_id::text, ''),
    NEW.anchor,
    COALESCE(NEW.start_days::text, ''),
    COALESCE(NEW.repeat_type, ''),
    COALESCE(NEW.interval_n::text, ''),
    COALESCE(NEW.interval_unit, ''),
    COALESCE(NEW.ends, ''),
    COALESCE(NEW.ends_date::text, ''),
    COALESCE(NEW.ends_count::text, ''),
    COALESCE(NEW.escalation, '')
  ));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reminder_configs_dedupe_trg ON public.reminder_configs;
CREATE TRIGGER reminder_configs_dedupe_trg
  BEFORE INSERT OR UPDATE ON public.reminder_configs
  FOR EACH ROW EXECUTE FUNCTION public.reminder_config_dedupe_key();

-- Repair first: the unique index below cannot be created while duplicates exist.
-- The longest-standing copy of each identical rule is the one kept.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY shop_id, customer_id, anchor, COALESCE(start_days, -1),
                        COALESCE(repeat_type, ''), COALESCE(interval_n, -1),
                        COALESCE(interval_unit, ''), COALESCE(ends, ''),
                        COALESCE(ends_date::text, ''), COALESCE(ends_count, -1),
                        COALESCE(escalation, '')
           ORDER BY created_at, id
         ) AS rn
    FROM public.reminder_configs
)
DELETE FROM public.reminder_occurrences
 WHERE config_id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY shop_id, customer_id, anchor, COALESCE(start_days, -1),
                        COALESCE(repeat_type, ''), COALESCE(interval_n, -1),
                        COALESCE(interval_unit, ''), COALESCE(ends, ''),
                        COALESCE(ends_date::text, ''), COALESCE(ends_count, -1),
                        COALESCE(escalation, '')
           ORDER BY created_at, id
         ) AS rn
    FROM public.reminder_configs
)
DELETE FROM public.reminder_configs
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Backfill the fingerprint for rows that predate the trigger. The WHERE is
-- evaluated before the trigger runs, so every legacy row (key still NULL) is
-- written once and gets its fingerprint from the trigger above.
UPDATE public.reminder_configs SET updated_at = updated_at WHERE dedupe_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_configs_dedupe
  ON public.reminder_configs (shop_id, customer_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
