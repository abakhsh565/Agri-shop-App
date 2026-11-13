-- 0299 — The effective role follows the caller's working branch again.
--
-- WHY THIS EXISTS. 0233 granted a role per branch (membership_branch_roles) and
-- resolved the effective role from the caller's current branch inside
-- get_effective_permissions: the branch role wins, the membership's role_id is the
-- fallback, and only the caller's OWN resolution follows their branch. The 0266
-- rewrite of the same function (for co-owners) dropped that resolution without
-- comment, so a per-branch role stopped affecting authorization — while 0276's
-- get_my_dashboards still reads the branch role, and the seed/sync triggers (0233)
-- still maintain the rows. The database now disagrees with itself: the dashboard
-- shows the branch role's widgets while the authorization boundary answers from the
-- membership default. rbacLifecycleAndSessions exercises exactly this boundary (a
-- role change must take effect at the next call); the membership-level change is
-- already correct (proven by a local pglite replay of the 0266 logic), and this
-- restores the branch half that 0266 lost.
--
-- WHAT THIS DOES. Restates the 0266 get_effective_permissions body verbatim with
-- the 0233 branch resolution restored in the non-owner, non-co-owner path: resolve
-- the membership's role_id, then, when the caller inspects themselves, replace it
-- with the membership_branch_roles row for the current branch when one exists.
-- The owner, co-owner and user-permission-override paths are untouched.
--
-- WHY IT IS SAFE TO APPLY. The branch row is maintained by the 0233 triggers: the
-- seed trigger writes the membership's role_id into the row at insert, and the sync
-- trigger moves the row when the membership's role_id changes, so a row that was
-- never deliberately given a different per-branch role always tracks the membership
-- default. A caller with no branch-role row resolves exactly as before. CREATE OR
-- REPLACE FUNCTION keeps the existing grants.

CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_grant public.co_owner_grants;
  v_permissions text[];
  v_role_id uuid;
  v_branch_role uuid;
  v_branch uuid;
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Owner and legacy admin may inspect anybody. A Co-Owner may inspect an
  -- employee only when they hold employees.view; this is the one read the
  -- employee detail screen needs.
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    IF NOT (public.is_co_owner(v_actor)
            AND EXISTS (
              SELECT 1
                FROM public.co_owner_permissions cp
                JOIN public.permissions p ON p.id = cp.permission_id
               WHERE cp.grant_id = (public.co_owner_current_grant()).id
                 AND p.code = 'employees.view'
            )) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM public.permissions;
  ELSIF v_member.access_kind = 'co_owner' THEN
    SELECT g.* INTO v_grant
      FROM public.co_owner_grants g
     WHERE g.membership_id = v_member.id
       AND g.status = 'active'
       AND (g.expires_at IS NULL OR g.expires_at > now());
    IF v_grant.id IS NULL THEN RETURN '[]'::jsonb; END IF;
    SELECT array_agg(p.code ORDER BY p.code) INTO v_permissions
      FROM public.co_owner_permissions cp
      JOIN public.permissions p ON p.id = cp.permission_id
     WHERE cp.grant_id = v_grant.id;
  ELSE
    -- 0299: the effective role follows the caller's working branch. 0233 granted a
    -- role per branch and resolved it here; the 0266 rewrite dropped that resolution,
    -- so a per-branch role stopped affecting authorization even though 0276's
    -- dashboards still read it. Only the caller's OWN resolution follows their
    -- branch: an owner inspecting an employee gets that membership's default role.
    v_role_id := v_member.role_id;
    IF v_user = v_actor THEN
      v_branch := public.current_branch_id();
      IF v_branch IS NOT NULL THEN
        SELECT mbr.role_id INTO v_branch_role
          FROM public.membership_branch_roles mbr
         WHERE mbr.membership_id = v_member.id AND mbr.branch_id = v_branch;
        v_role_id := COALESCE(v_branch_role, v_role_id);
      END IF;
    END IF;
    SELECT array_agg(code ORDER BY code) INTO v_permissions FROM (
      SELECT p.code FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = v_member.tenant_id
       WHERE rp.role_id = v_role_id
      UNION
      SELECT p.code FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND up.is_granted
      EXCEPT
      SELECT p.code FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;

  RETURN to_jsonb(COALESCE(v_permissions, '{}'::text[]));
END;
$$;

-- The grants are unchanged (authenticated-only, PUBLIC/anon revoked); CREATE OR
-- REPLACE keeps them, so no GRANT statements are needed here.
NOTIFY pgrst, 'reload schema';

-- Assertion: the branch resolution is present and the membership fallback survives.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_effective_permissions';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '0299: get_effective_permissions is missing';
  END IF;
  IF v_def NOT LIKE '%membership_branch_roles%' THEN
    RAISE EXCEPTION '0299: the branch-role resolution is missing from get_effective_permissions';
  END IF;
  IF v_def NOT LIKE '%COALESCE(v_branch_role, v_role_id)%' THEN
    RAISE EXCEPTION '0299: the membership-role fallback was lost';
  END IF;
END $$;
