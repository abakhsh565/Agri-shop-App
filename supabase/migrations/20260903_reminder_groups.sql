-- Add group columns to reminder_configs for global/group-based reminders
-- A group_name groups multiple customers under one reminder configuration
-- group_id is a UUID that links customers to the same reminder group
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS group_name TEXT;

-- Index for quick group lookups
CREATE INDEX IF NOT EXISTS idx_reminder_configs_group ON reminder_configs(group_id) WHERE group_id IS NOT NULL;
