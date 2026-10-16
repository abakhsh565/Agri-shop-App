-- Retention for client_error_events.
--
-- WHY A FUNCTION AND NOT A POLICY
--   0203 made the table write-only for clients: there is no select/update/delete policy, so nothing
--   a client can reach removes a row. Retention therefore cannot be a client-side job, and it must
--   not become the excuse to add a delete policy — the two requirements (errors are unreadable by
--   tenants, errors do not accumulate forever) are satisfied by different mechanisms.
--
-- WHAT THIS IS
--   One SECURITY DEFINER function, executable only by service_role. It deletes rows older than a
--   caller-supplied window and returns how many it removed. `anon` and `authenticated` are revoked
--   explicitly rather than left to a default, because this function deletes rows and a default is
--   not a decision.
--
-- WHAT IT IS NOT
--   It is not a schedule. Nothing here runs on a timer: the authorized operator calls it, or a
--   future scheduled job does, and either way the call is attributable. A function that pruned on
--   its own would delete evidence without a decision being recorded anywhere.
CREATE OR REPLACE FUNCTION public.prune_client_error_events(p_keep_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
  v_cutoff timestamptz;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 1 THEN
    RAISE EXCEPTION 'INVALID_RETENTION_WINDOW: keep at least 1 day';
  END IF;
  v_cutoff := now() - make_interval(days => p_keep_days);
  DELETE FROM public.client_error_events WHERE occurred_at < v_cutoff;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_client_error_events(integer) IS
  'Deletes client_error_events older than p_keep_days and returns the number removed. Restricted to '
  'service_role: the table is unreadable and undeletable for clients by design.';

-- Explicit, in both directions. `PUBLIC` first, because a function without an explicit revoke is
-- executable by every role, including the anonymous one.
REVOKE ALL ON FUNCTION public.prune_client_error_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prune_client_error_events(integer) FROM anon;
REVOKE ALL ON FUNCTION public.prune_client_error_events(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_client_error_events(integer) TO service_role;
