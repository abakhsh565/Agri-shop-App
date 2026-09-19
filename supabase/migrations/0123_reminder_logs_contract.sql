-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0123: reminder_logs contract
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE (live browser network log):
--   GET /rest/v1/reminder_logs?select=*&order=sent_at.desc&limit=50 → 400
--   Reminder History orders by sent_at, but the table only had created_at, so
--   the history screen could never load. Same contract-drift class as 0116
--   (occurrences) and 0122 (configs).
--
-- Additive: sent_at is created as a real timestamp column backfilled from
-- created_at, so ordering is stable for existing rows too.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS sent_at timestamptz DEFAULT now();

UPDATE public.reminder_logs SET sent_at = created_at WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS reminder_logs_sent_at_idx ON public.reminder_logs (sent_at DESC);
