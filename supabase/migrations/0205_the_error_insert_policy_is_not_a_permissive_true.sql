-- Repair 0203's INSERT policy.
--
-- WHAT WAS WRONG
--   0203 wrote `WITH CHECK (true)` on `client_error_events`. That passes the functional requirement —
--   a client may insert — but it is the exact shape `tests/integration/shopScopedPolicyGuard.test.ts`
--   exists to forbid: a policy that accepts whatever the caller sends, the same shape as the
--   audit_events defect fixed by 0181. The guard reads the policy's own expression out of
--   `pg_policy`, so the fix has to be a real predicate, not a comment explaining that the table
--   constraints make the rows safe anyway.
--
-- WHAT IT IS NOW
--   An insert is accepted only for a row that is well formed where the policy can see it: one of the
--   three environment names, and a message inside the same bound the column constraint enforces.
--   The table's CHECK constraints still hold; this makes the policy itself state a condition, which
--   means a future widening of the table (a dropped constraint, a new nullable column) cannot turn
--   this policy into an open door.
--
-- WHY A NEW FILE AND NOT AN EDIT
--   `migrate.mjs verify` compares every applied file against its recorded sha256. 0203 is applied and
--   recorded in staging, so editing it in place would break the ledger check for everyone. A new
--   migration keeps the history honest: what was applied, and what changed it.
DROP POLICY IF EXISTS client_error_events_insert_only ON public.client_error_events;

CREATE POLICY client_error_events_insert_only ON public.client_error_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    environment IN ('development', 'staging', 'production')
    AND message IS NOT NULL
    AND char_length(message) BETWEEN 1 AND 500
  );

COMMENT ON POLICY client_error_events_insert_only ON public.client_error_events IS
  'Accepts a well-formed error row from a client, including before sign-in. Not `true`: a policy '
  'that accepts whatever the caller sends is the shape 0181 removed elsewhere. There is still no '
  'SELECT/UPDATE/DELETE policy, so the rows remain unreadable to clients.';
