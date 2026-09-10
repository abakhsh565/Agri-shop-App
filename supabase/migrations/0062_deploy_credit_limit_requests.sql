-- ============================================================
-- Migration 0062: Deploy credit_limit_requests table + RPCs
--
-- PROBLEM: Migration 20260903 was never deployed. The table
--   and approve/reject RPCs do not exist in the database.
--   Credit requests are localStorage-only — no DB persistence.
--
-- SOLUTION: Deploy table + RPCs with proper RLS following
--   the existing SECURITY DEFINER pattern.
-- ============================================================

-- 1. Create the table
CREATE TABLE IF NOT EXISTS credit_limit_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  current_limit NUMERIC NOT NULL,
  requested_limit NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_limit_requests_status ON credit_limit_requests(status);
CREATE INDEX IF NOT EXISTS idx_credit_limit_requests_customer ON credit_limit_requests(customer_id);

-- 2. Approve RPC
CREATE OR REPLACE FUNCTION approve_credit_limit_request(
  p_request_id UUID,
  p_reviewed_by TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN
    RAISE EXCEPTION 'Request not found or already processed';
  END IF;

  UPDATE customers SET credit_limit = req.requested_limit, updated_at = now()
  WHERE id = req.customer_id;

  UPDATE credit_limit_requests
  SET status = 'approved',
      reviewed_by = p_reviewed_by,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;
END;
$$;

-- 3. Reject RPC
CREATE OR REPLACE FUNCTION reject_credit_limit_request(
  p_request_id UUID,
  p_reviewed_by TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
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
$$;

-- 4. RLS — following 0053 pattern: anon can SELECT, RPCs handle writes
ALTER TABLE credit_limit_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "credit_limit_requests_select" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_select" ON credit_limit_requests
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "credit_limit_requests_insert_anon" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_insert_anon" ON credit_limit_requests
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "credit_limit_requests_update_anon" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_update_anon" ON credit_limit_requests
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "credit_limit_requests_delete_anon" ON credit_limit_requests;
CREATE POLICY "credit_limit_requests_delete_anon" ON credit_limit_requests
  FOR DELETE USING (false);

-- 5. Grants
GRANT EXECUTE ON FUNCTION approve_credit_limit_request(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION approve_credit_limit_request(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_credit_limit_request(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION reject_credit_limit_request(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
