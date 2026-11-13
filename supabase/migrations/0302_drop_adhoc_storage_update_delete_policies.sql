-- 0302 — Drop the two ad-hoc storage UPDATE/DELETE policies (QA-only cleanup).
--
-- WHY THIS EXISTS. On 2026-11-07 an ad-hoc repair script
-- (scripts/dev/qa-fix-storage-policies.mjs, branch fix/policy-repair) created
-- "images auth update" and "images auth delete" on storage.objects so the
-- imageSync E2E test's CRUD check (INSERT/SELECT/UPDATE/DELETE all present)
-- would pass. The script created them with NO TO role, so they apply to
-- PUBLIC: any anonymous caller could update or delete any image in the four
-- image buckets. That is exactly what migration 0230 removed on purpose —
-- the publishable key the browser bundle ships could delete or overwrite any
-- image — and 0230's own verification plus the securityAudit integration
-- test forbid ANY UPDATE/DELETE policy on storage.objects and assert the
-- exact six-policy matrix. The repair broke the QA job (securityAudit failed
-- on the round-4 CI run) and would have left anonymous write access open.
-- The app never updates or deletes storage objects from the client
-- (src/lib/storage.ts only uploads and reads public URLs), so dropping these
-- two policies removes no capability.
--
-- WHAT THIS DOES. DROP POLICY IF EXISTS for "images auth update" and
-- "images auth delete" on storage.objects, then verifies no UPDATE/DELETE
-- policy remains on the table.
--
-- WHY IT IS SAFE TO APPLY. The two policies exist only on QA — they were
-- created there by the ad-hoc script, never by any migration, so production
-- does not have them and the drops are no-ops there. The six-policy matrix
-- (0230/0250/0261/0263) is untouched. The imageSync test's CRUD check is
-- fixed in the same change to assert the real security model (INSERT +
-- SELECT only, no client UPDATE/DELETE) instead of demanding the policies
-- this migration removes.

DROP POLICY IF EXISTS "images auth update" ON storage.objects;
DROP POLICY IF EXISTS "images auth delete" ON storage.objects;

-- Verify: no client UPDATE/DELETE policy may remain on storage.objects.
DO $verify$
DECLARE
  v_bad text[];
BEGIN
  SELECT array_agg(policyname || '/' || cmd) INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND cmd IN ('UPDATE', 'DELETE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0302: a client UPDATE/DELETE policy still exists on storage.objects: %', array_to_string(v_bad, ', ');
  END IF;
  RAISE NOTICE '0302: no UPDATE/DELETE policy remains on storage.objects';
END
$verify$;
