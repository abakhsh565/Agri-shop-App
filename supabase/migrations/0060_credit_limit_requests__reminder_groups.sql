-- MERGED + RENUMBERED. Provenance: this file was authored as
-- `20260903_credit_limit_requests.sql`, with a twin `20260903_reminder_groups.sql`.
-- The timestamp-style name was never a valid position in this sequence:
--   1. it sorted AFTER every 0NNN file (so a naive replay applied it last, long
--      after 0062_deploy_credit_limit_requests.sql re-created the same table);
--   2. it collided with its twin under `supabase db push`, which keys
--      supabase_migrations.schema_migrations by version alone.
-- The twins were merged in 914d0c93; here the merged body moves to version 0060,
-- the slot it was always meant to occupy. Numbers 0035-0059 were already taken by
-- later work, 0060 was free, and the first file that needs this table is 0062
-- (`deploy_credit_limit_requests`) — so 0060 puts the body exactly where a fresh
-- replay needs it. Nothing between 0035 and 0059 references `credit_limit_requests`
-- or `reminder_configs.group_id`, which is what makes the move order-neutral.
-- No database records version 20260903: 0062's own header says the original
-- migration was never deployed, and both live ledgers stop long before it.
--
-- Both original bodies follow, in the order the runner would have applied them:
--   1. 20260903_credit_limit_requests.sql
--   2. 20260903_reminder_groups.sql

-- Create credit_limit_requests table
-- Tracks employee requests to increase customer credit limits that need admin approval
CREATE TABLE IF NOT EXISTS credit_limit_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  requested_by TEXT NOT NULL,           -- employee name/user_id who made the request
  current_limit NUMERIC NOT NULL,       -- customer's current approved credit limit
  requested_limit NUMERIC NOT NULL,     -- new limit the employee is requesting
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,                     -- admin who approved/rejected
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_credit_limit_requests_status ON credit_limit_requests(status);
CREATE INDEX IF NOT EXISTS idx_credit_limit_requests_customer ON credit_limit_requests(customer_id);

-- RPC: approve a credit limit request
CREATE OR REPLACE FUNCTION approve_credit_limit_request(
  p_request_id UUID,
  p_reviewed_by TEXT
)
RETURNS VOID AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  -- Update the customer's credit limit
  UPDATE customers SET credit_limit = req.requested_limit WHERE id = req.customer_id;

  -- Mark request as approved
  UPDATE credit_limit_requests
  SET status = 'approved',
      reviewed_by = p_reviewed_by,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC: reject a credit limit request
CREATE OR REPLACE FUNCTION reject_credit_limit_request(
  p_request_id UUID,
  p_reviewed_by TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE credit_limit_requests
  SET status = 'rejected',
      reviewed_by = p_reviewed_by,
      reviewed_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable RLS
ALTER TABLE credit_limit_requests ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow read for authenticated" ON credit_limit_requests
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert (employees requesting)
CREATE POLICY "Allow insert for authenticated" ON credit_limit_requests
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update (admins approving/rejecting)
CREATE POLICY "Allow update for authenticated" ON credit_limit_requests
  FOR UPDATE USING (auth.role() = 'authenticated');

-- Add group columns to reminder_configs for global/group-based reminders
-- A group_name groups multiple customers under one reminder configuration
-- group_id is a UUID that links customers to the same reminder group
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS group_id UUID;
ALTER TABLE reminder_configs ADD COLUMN IF NOT EXISTS group_name TEXT;

-- Index for quick group lookups
CREATE INDEX IF NOT EXISTS idx_reminder_configs_group ON reminder_configs(group_id) WHERE group_id IS NOT NULL;
