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