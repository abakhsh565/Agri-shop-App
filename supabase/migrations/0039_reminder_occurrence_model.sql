-- Migration 0039: Reminder Occurrence Model
-- Adds persistent reminder_occurrences table for reliable alarm-clock behavior.
-- Each occurrence is uniquely identifiable and tracks its lifecycle:
--   scheduled → due → sent/completed/cancelled

CREATE TABLE IF NOT EXISTS reminder_occurrences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id uuid NOT NULL REFERENCES reminder_configs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  occurrence_number integer NOT NULL DEFAULT 1,
  stage text,                    -- 'gentle','firmer','final' for escalate; NULL otherwise
  crop_name text,                -- for before_harvest; NULL otherwise
  occurrence_key text NOT NULL,  -- deterministic: config_id + "_" + occurrence_number [+ "_" + stage/crop]
  scheduled_date date NOT NULL,  -- the date this occurrence should become due
  status text NOT NULL DEFAULT 'scheduled',  -- scheduled | due | sent | completed | cancelled
  tone text,                     -- gentle | firmer | final
  sent_at timestamptz,
  sent_channel text,             -- whatsapp | sms
  message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_occurrence_key UNIQUE (occurrence_key)
);

CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_config ON reminder_occurrences(config_id);
CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_customer ON reminder_occurrences(customer_id);
CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_status ON reminder_occurrences(status);
CREATE INDEX IF NOT EXISTS idx_reminder_occurrences_scheduled ON reminder_occurrences(scheduled_date);

-- RLS
ALTER TABLE reminder_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reminder_occurrences_all" ON reminder_occurrences FOR ALL USING (true);
