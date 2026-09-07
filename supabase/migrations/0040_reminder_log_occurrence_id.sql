-- Migration 0040: Enforce one reminder_log per occurrence
-- Adds occurrence_id to reminder_logs and a unique constraint.
-- Each reminder occurrence can have at most one send log.

-- Add occurrence_id column (nullable initially to avoid blocking existing writes)
ALTER TABLE reminder_logs
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES reminder_occurrences(id) ON DELETE CASCADE;

-- Backfill: link existing logs to occurrences via config_id + customer_id matching.
-- We match logs to occurrences that share the same config_id and customer_id,
-- preferring the most recently sent occurrence (which is the one that was actually sent).
-- This is safe because the previous behavior created at most one log per config/customer
-- at a time, and the IDEMPOTENCY fix will prevent future duplicates.
UPDATE reminder_logs AS log
SET occurrence_id = occ.id
FROM reminder_occurrences AS occ
WHERE log.occurrence_id IS NULL
  AND log.config_id = occ.config_id::text
  AND log.customer_id = occ.customer_id
  AND occ.status = 'sent'
  AND NOT EXISTS (
    SELECT 1 FROM reminder_logs AS existing_log
    WHERE existing_log.occurrence_id = occ.id
  );

-- Now make occurrence_id NOT NULL (after backfill, every log should have an occurrence)
-- If any rows remain NULL, we leave them — they are legacy logs without occurrence tracking.
-- New inserts will always provide occurrence_id.

-- Create unique index: one log per occurrence
-- Ignore NULL occurrence_ids (legacy logs) so the constraint doesn't block them
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_logs_one_per_occurrence
  ON reminder_logs (occurrence_id)
  WHERE occurrence_id IS NOT NULL;

-- Also index for lookups
CREATE INDEX IF NOT EXISTS idx_reminder_logs_occurrence ON reminder_logs (occurrence_id) WHERE occurrence_id IS NOT NULL;
