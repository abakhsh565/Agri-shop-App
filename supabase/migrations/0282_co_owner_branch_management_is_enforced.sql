-- 0282 — the branch-management flag is a real check, not stored decoration.
--
-- The branch assignment review says "Branch management stays with you" and writes
-- co_owner_grants.can_manage_branches = false. Until now no server path read that flag, so a
-- Co-Owner with settings.edit could still rename/relocate/archive a branch through the Owner
-- screens. This trigger is the missing enforcement for every branch write path at once.

CREATE OR REPLACE FUNCTION public.guard_co_owner_branch_management()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grant public.co_owner_grants;
BEGIN
  IF NOT public.is_co_owner() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT g.* INTO v_grant
    FROM public.co_owner_grants g
    JOIN public.memberships m ON m.id = g.membership_id
   WHERE m.user_id = public.app_current_user_id()
     AND g.status = 'active'
     AND (g.expires_at IS NULL OR g.expires_at > now());

  IF v_grant.id IS NULL OR NOT v_grant.can_manage_branches THEN
    RAISE EXCEPTION 'CO_OWNER_CANNOT_MANAGE_BRANCHES: branch management belongs to the main Owner';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_co_owner_branch_management() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_co_owner_branch_management_trg ON public.branches;
CREATE TRIGGER guard_co_owner_branch_management_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_co_owner_branch_management();

COMMENT ON FUNCTION public.guard_co_owner_branch_management() IS
  'A Co-Owner may read their assigned branch but may not create, edit, archive or delete one unless the Owner delegated branch management.';

-- 0282: name the retired function(s) in the server-only set the ACL guard
-- unions across migrations, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['guard_co_owner_branch_management'];
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
    RAISE EXCEPTION '0282: % server-only function(s) are still executable by an API role', v_open;
  END IF;
  RAISE NOTICE '0282: the server-only functions are closed';
END
$server_only$;
