-- 0135: make the reminder_configs write contract satisfiable
--
-- Saved reminders were failing with 23502 on every write:
--
--   null value in column "name" of relation "reminder_configs" violates not-null constraint
--
-- `name` and `type` are the table's ORIGINAL columns. Migration 0122 moved the
-- contract to customer_id, enabled, start_days, anchor, repeat_type, interval_n,
-- interval_unit, escalation, ends, ends_date, ends_count — and every current
-- writer (reminderEngine.saveReminderConfig, localGroupRegistry.saveLocalGroup)
-- writes exactly that contract. Neither `name` nor `type` is written by any code
-- path and neither is read: the loader maps `*` and takes only the contract
-- columns. Because they stayed NOT NULL, EVERY reminder config insert failed —
-- which is why reminder creation silently did nothing.
--
-- Dropping NOT NULL keeps the columns (and any historical rows) exactly as they
-- are; it only stops requiring a value the current contract does not have.
-- `escalation` stays `text`, holding a JSON string — which is what the loader
-- parses and what the writers now send.

ALTER TABLE reminder_configs ALTER COLUMN name DROP NOT NULL;
ALTER TABLE reminder_configs ALTER COLUMN type DROP NOT NULL;

COMMENT ON COLUMN reminder_configs.name IS
  'Legacy pre-0122 column; not part of the current write contract (nullable since 0135).';
COMMENT ON COLUMN reminder_configs.type IS
  'Legacy pre-0122 column; not part of the current write contract (nullable since 0135).';
COMMENT ON COLUMN reminder_configs.escalation IS
  'JSON string of the escalating sequence: [{"label","tone","day"}]. Parsed client-side by loadReminderConfigs.';
