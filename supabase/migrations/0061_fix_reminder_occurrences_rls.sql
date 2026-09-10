-- ============================================================
-- Migration 0061: Fix reminder_occurrences RLS
--
-- PROBLEM: Migration 0053 blocks all anon INSERT/UPDATE on
--   reminder_occurrences. The client-side reminder engine
--   needs to write occurrences, so it silently fails.
--
-- SOLUTION: Create SECURITY DEFINER RPCs — same pattern as
--   every other write in the app (create_sale, process_return,
--   record_customer_payment, etc.). The RPCs bypass RLS but
--   still require authenticated user identity.
-- ============================================================

-- 1. Upsert occurrence (insert if not exists by occurrence_key)
CREATE OR REPLACE FUNCTION upsert_reminder_occurrence(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_auth_user_id uuid;
  v_existing jsonb;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  -- Check if occurrence already exists
  SELECT row_to_json(occ) INTO v_existing
  FROM reminder_occurrences occ
  WHERE occ.occurrence_key = (payload->>'occurrence_key');

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Insert new
  INSERT INTO reminder_occurrences (
    config_id, customer_id, occurrence_number, stage, crop_name,
    occurrence_key, scheduled_date, status, tone
  ) VALUES (
    (payload->>'config_id')::uuid,
    (payload->>'customer_id')::uuid,
    (payload->>'occurrence_number')::int,
    payload->>'stage',
    payload->>'crop_name',
    payload->>'occurrence_key',
    (payload->>'scheduled_date')::date,
    payload->>'status',
    payload->>'tone'
  )
  RETURNING row_to_json(reminder_occurrences.*) INTO v_existing;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_reminder_occurrence(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION upsert_reminder_occurrence(jsonb) TO authenticated;


-- 2. Update occurrence status (scheduled → due → sent, etc.)
CREATE OR REPLACE FUNCTION update_reminder_occurrence_status(payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_auth_user_id uuid;
BEGIN
  v_auth_user_id := get_authenticated_user_id();
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required';
  END IF;

  UPDATE reminder_occurrences
  SET status = (payload->>'status')::text,
      sent_at = CASE WHEN payload ? 'sent_at' THEN (payload->>'sent_at')::timestamptz ELSE sent_at END,
      sent_channel = CASE WHEN payload ? 'sent_channel' THEN payload->>'sent_channel' ELSE sent_channel END,
      message = CASE WHEN payload ? 'message' THEN payload->>'message' ELSE message END,
      updated_at = now()
  WHERE id = (payload->>'occurrence_id')::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION update_reminder_occurrence_status(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION update_reminder_occurrence_status(jsonb) TO authenticated;


NOTIFY pgrst, 'reload schema';
