-- 0288: self-request access is retired; history stays
--
-- WHY
--   Employees are onboarded only when an owner adds them. The anonymous request RPC was
--   the one public write left in that story, and the screens that called it are removed.
--   Revoking execution closes the endpoint itself, not just the link to it.
--
--   The table and every historical row stay exactly where they are: this is a retirement,
--   not a migration of history. Owner/manager read RPCs remain server-side and are not used
--   by the app; no new request can be created.

REVOKE EXECUTE ON FUNCTION public.request_employee_access(text, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.employee_access_requests IS
  'Historical access requests (retired by 0288). The table is not client-readable and request_employee_access is no longer executable by anon or authenticated.';

-- 0288: name the retired function(s) in the server-only set the ACL guard
-- unions across migrations, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['request_employee_access'];
  v_name text;
  v_sig text;
  v_open int;
BEGIN
  FOREACH v_name IN ARRAY v_server_only LOOP
    FOR v_sig IN
      SELECT p.oid::regprocedure::text
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    END LOOP;
  END LOOP;
  SELECT count(*) INTO v_open
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (v_server_only)
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_open > 0 THEN
    RAISE EXCEPTION '0288: % server-only function(s) are still executable by an API role', v_open;
  END IF;
  RAISE NOTICE '0288: the server-only functions are closed';
END
$server_only$;
