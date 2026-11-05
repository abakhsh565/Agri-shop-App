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