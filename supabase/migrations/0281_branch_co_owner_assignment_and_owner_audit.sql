-- 0281 — Branch-scoped Co-Owner assignment and the Owner's cross-branch audit
--
-- A Co-Owner is not an employee and does not become the legal Owner. This migration adds
-- the missing branch-management entry point: the Owner selects a sub-branch, enters the
-- person's name and mobile number, and the existing Co-Owner delegation is created with
-- exactly that branch in scope. It also gives the Owner the all-branch read the two-sided
-- audit rule needs; the Co-Owner keeps the single-branch read.

-- ── 1. Read the Co-Owner assigned to one branch ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_co_owners(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_branch public.branches;
  v_rows jsonb;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_branch FROM public.branches
   WHERE id = p_branch_id AND tenant_id = v_owner.tenant_id AND is_active;
  IF v_branch.id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'grantId', g.id, 'name', u.name, 'phone', u.phone,
    'status', g.status, 'invitedAt', g.invited_at,
    'activatedAt', g.activated_at, 'suspendedAt', g.suspended_at,
    'lastLoginAt', u.last_login_at,
    'isOnlyBranch', (
      SELECT count(*) = 1 FROM public.co_owner_branch_scopes x WHERE x.grant_id = g.id
    )
  ) ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, g.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.co_owner_grants g
  JOIN public.users u ON u.id = g.user_id
  WHERE g.tenant_id = v_owner.tenant_id
    AND g.status IN ('active', 'invited', 'suspended')
    AND EXISTS (
      SELECT 1 FROM public.co_owner_scope_settings s
       WHERE s.grant_id = g.id
         AND (
           s.branches_mode = 'all'
           OR (s.branches_mode = 'selected' AND EXISTS (
             SELECT 1 FROM public.co_owner_branch_scopes bs
              WHERE bs.grant_id = g.id AND bs.branch_id = p_branch_id
           ))
         )
    );

  RETURN jsonb_build_object(
    'branchId', v_branch.id, 'branchName', v_branch.name,
    'isMain', v_branch.is_default, 'coOwners', v_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_branch_co_owners(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_co_owners(uuid) TO authenticated;

-- ── 2. Assign one Co-Owner from Branch Management ────────────────────────────
DROP FUNCTION IF EXISTS public.assign_branch_co_owner(uuid, text, text);
CREATE OR REPLACE FUNCTION public.assign_branch_co_owner(
  p_branch_id uuid, p_name text, p_phone text, p_config jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner public.memberships;
  v_branch public.branches;
  v_name text := NULLIF(trim(COALESCE(p_name, '')), '');
  v_phone text := NULLIF(trim(COALESCE(p_phone, '')), '');
  v_permissions jsonb;
  v_dashboards jsonb;
  v_authorities jsonb;
  v_roles jsonb;
  v_result jsonb;
  v_grant_id uuid;
BEGIN
  v_owner := public.co_owner_assert_original_owner();
  SELECT * INTO v_branch FROM public.branches
   WHERE id = p_branch_id AND tenant_id = v_owner.tenant_id AND is_active
   FOR UPDATE;
  IF v_branch.id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  IF v_branch.is_default THEN RAISE EXCEPTION 'MAIN_BRANCH_OWNER_ONLY'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'VALIDATION: name is required'; END IF;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'VALIDATION: phone is required'; END IF;

  IF jsonb_typeof(COALESCE(p_config->'permissions', 'null'::jsonb)) = 'array' THEN
    SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]'::jsonb) INTO v_permissions
      FROM public.permissions p
     WHERE p.code IN (SELECT jsonb_array_elements_text(p_config->'permissions'));
  ELSE
    SELECT COALESCE(jsonb_agg(code ORDER BY code), '[]'::jsonb) INTO v_permissions
      FROM public.permissions;
  END IF;

  IF jsonb_typeof(COALESCE(p_config->'dashboards', 'null'::jsonb)) = 'array' THEN
    SELECT COALESCE(jsonb_agg(w.key ORDER BY w.sort_order, w.key), '[]'::jsonb) INTO v_dashboards
      FROM public.dashboard_widgets w
     WHERE w.key IN (SELECT jsonb_array_elements_text(p_config->'dashboards'));
  ELSE
    SELECT COALESCE(jsonb_agg(key ORDER BY sort_order, key), '[]'::jsonb) INTO v_dashboards
      FROM public.dashboard_widgets;
  END IF;

  IF jsonb_typeof(COALESCE(p_config->'authorities', 'null'::jsonb)) = 'object' THEN
    v_authorities := p_config->'authorities';
  ELSE
    SELECT COALESCE(jsonb_object_agg(code,
      CASE WHEN code IN ('ownership.transfer', 'co_owners.manage', 'business.delete', 'owner.security')
        THEN 'restricted' ELSE 'allowed' END), '{}'::jsonb)
      INTO v_authorities
      FROM public.co_owner_authority_catalog;
  END IF;
  -- Branch Management never delegates the four decisions that define ownership, whatever the
  -- client sends. The generic wizard remains the Owner's broader tool, but this entry point is
  -- deliberately narrower.
  v_authorities := COALESCE(v_authorities, '{}'::jsonb) || jsonb_build_object(
    'ownership.transfer', 'restricted', 'co_owners.manage', 'restricted',
    'business.delete', 'restricted', 'owner.security', 'restricted'
  );

  IF jsonb_typeof(COALESCE(p_config->'assignableRoleIds', 'null'::jsonb)) = 'array' THEN
    SELECT COALESCE(jsonb_agg(r.id ORDER BY r.name), '[]'::jsonb) INTO v_roles
      FROM public.roles r
     WHERE r.tenant_id = v_owner.tenant_id
       AND r.id IN (SELECT (jsonb_array_elements_text(p_config->'assignableRoleIds'))::uuid);
  ELSE
    SELECT COALESCE(jsonb_agg(id ORDER BY name), '[]'::jsonb) INTO v_roles
      FROM public.roles WHERE tenant_id = v_owner.tenant_id;
  END IF;

  v_result := public.create_co_owner_invitation(jsonb_build_object(
    'phone', v_phone,
    'name', v_name,
    'scopes', jsonb_build_object(
      'branchesMode', 'selected',
      'branchIds', jsonb_build_array(v_branch.id),
      'suppliersMode', 'all',
      'departmentsMode', 'all',
      'recordsMode', 'all'
    ),
    'permissions', v_permissions,
    'dashboards', v_dashboards,
    'authorities', v_authorities,
    'assignableRoleIds', v_roles,
    'canInviteEmployees', COALESCE((p_config->>'canInviteEmployees')::boolean, true),
    'canDeactivateEmployees', COALESCE((p_config->>'canDeactivateEmployees')::boolean, true),
    'canManageBranches', COALESCE((p_config->>'canManageBranches')::boolean, false),
    'notes', 'Branch Co-Owner: ' || v_branch.name
  ));
  v_grant_id := (v_result->>'grantId')::uuid;

  INSERT INTO public.audit_events
    (user_id, action, entity_type, entity_id, tenant_id, branch_id, co_owner_grant_id, details)
  VALUES
    (v_owner.user_id, 'branch_co_owner_assigned', 'co_owner_grant', v_grant_id,
     v_owner.tenant_id, v_branch.id, v_grant_id,
     jsonb_build_object(
       'branch_id', v_branch.id, 'branch_name', v_branch.name,
       'phone', v_phone, 'name', v_name,
       'ownership_unchanged', true, 'history_preserved', true,
       'scope', 'one_branch'
     ));

  RETURN jsonb_build_object(
    'grantId', v_grant_id, 'status', 'invited',
    'branchId', v_branch.id, 'branchName', v_branch.name,
    'name', v_name, 'phone', v_phone,
    'requiresAcceptance', true, 'ownershipUnchanged', true
  );
END;
$$;
REVOKE ALL ON FUNCTION public.assign_branch_co_owner(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_branch_co_owner(uuid, text, text, jsonb) TO authenticated;

-- ── 3. Owner reads every branch; everyone else reads the branch they work in ──
CREATE OR REPLACE FUNCTION public.get_activity_feed(
  p_branch_id uuid DEFAULT NULL,
  p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  id uuid, action text, entity_type text, entity_id uuid, actor_id uuid,
  actor_name text, actor_role text, branch_id uuid, branch_name text,
  details jsonb, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_branch uuid;
  v_all boolean := false;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_effective_permission('activity.view') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission activity.view';
  END IF;

  IF v_member.role = 'owner' AND v_member.access_kind = 'standard' THEN
    IF p_branch_id IS NULL THEN
      v_all := true;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM public.branches b
         WHERE b.id = p_branch_id AND b.tenant_id = v_member.tenant_id AND b.is_active
      ) THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
      v_branch := p_branch_id;
    END IF;
  ELSE
    v_branch := public.current_branch_id();
    IF p_branch_id IS NOT NULL AND p_branch_id IS DISTINCT FROM v_branch THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
    END IF;
  END IF;

  RETURN QUERY
  SELECT a.id, a.action::text, a.entity_type::text, a.entity_id,
         a.user_id, a.actor_name, a.actor_role, a.branch_id, a.branch_name,
         a.details, a.created_at
    FROM public.audit_events a
   WHERE a.tenant_id = v_member.tenant_id
     AND (v_all OR a.branch_id = v_branch)
     AND (p_before IS NULL OR (a.created_at, a.id) < (
       p_before, COALESCE(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
     ))
   ORDER BY a.created_at DESC, a.id DESC
   LIMIT greatest(1, least(COALESCE(p_limit, 50), 100));
END;
$$;
REVOKE ALL ON FUNCTION public.get_activity_feed(uuid, timestamptz, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_activity_feed(uuid, timestamptz, uuid, int) TO authenticated;

-- ── 4. A Co-Owner can never close a branch ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_co_owner_branch_lifecycle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active AND public.is_co_owner() THEN
    RAISE EXCEPTION 'CO_OWNER_CANNOT_DELETE_BRANCH: branch lifecycle belongs to the main Owner';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_co_owner_branch_lifecycle() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS guard_co_owner_branch_lifecycle_trg ON public.branches;
CREATE TRIGGER guard_co_owner_branch_lifecycle_trg
  BEFORE UPDATE OF is_active ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.guard_co_owner_branch_lifecycle();

COMMENT ON FUNCTION public.get_activity_feed(uuid, timestamptz, uuid, int) IS
  'One audit source for both dashboards: the Owner may read all branches or one; a Co-Owner reads only the branch they work in.';

-- ── 5. The Co-Owner signs in through the Owner door ─────────────────────────
-- The table keeps users.role = 'employee' for a Co-Owner on purpose: making it 'admin' would
-- open legacy admin policies. The door is an identity question, not a database role, so this
-- anon-callable predicate answers it from the live grant. It returns a boolean and nothing
-- about the grant, branch or business.
CREATE OR REPLACE FUNCTION public.co_owner_login_is_owner(p_phone text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.co_owner_grants g
      JOIN public.users u ON u.id = g.user_id
      JOIN public.memberships m ON m.id = g.membership_id
     WHERE right(regexp_replace(u.phone, '[^0-9]', '', 'g'), 10)
           = right(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), 10)
       AND g.status IN ('invited', 'active')
       AND (g.expires_at IS NULL OR g.expires_at > now())
       AND m.access_kind = 'co_owner'
       AND m.status IN ('pending', 'active')
  );
$$;
REVOKE ALL ON FUNCTION public.co_owner_login_is_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.co_owner_login_is_owner(text) TO anon, authenticated;

-- ── 6. Restore Co-Owner permissions in the current resolver ───────────────────
-- Migration 0277 replaced 0266's resolver and kept only the owner / employee branches. The
-- UI read `get_my_co_owner_access` directly, so the screens looked right while every backend
-- permission check (`authorize_business_action`, the activity feed, policy predicates) saw an
-- empty set. Re-state the current 0277 body with the missing Co-Owner branch restored.
CREATE OR REPLACE FUNCTION public.get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := COALESCE(p_user_id, public.app_current_user_id());
  v_actor uuid := public.app_current_user_id();
  v_member public.memberships;
  v_grant public.co_owner_grants;
  v_role_id uuid;
  v_branch_role uuid;
  v_branch uuid;
  v_permissions text[];
BEGIN
  IF v_actor IS NULL OR v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_actor IS DISTINCT FROM v_user AND NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
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
      SELECT p.code
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        JOIN public.roles r ON r.id = rp.role_id AND r.tenant_id = v_member.tenant_id
       WHERE rp.role_id = v_role_id
      EXCEPT
      SELECT p.code
        FROM public.user_permissions up
        JOIN public.permissions p ON p.id = up.permission_id
       WHERE up.user_id = v_user AND up.is_override AND NOT up.is_granted
    ) effective;
  END IF;

  RETURN to_jsonb(COALESCE(v_permissions, '{}'::text[]));
END;
$$;
REVOKE ALL ON FUNCTION public.get_effective_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_permissions(uuid) TO authenticated;

-- 0281: name the retired function(s) in the server-only set the ACL guard
-- unions across migrations, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['guard_co_owner_branch_lifecycle'];
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
    RAISE EXCEPTION '0281: % server-only function(s) are still executable by an API role', v_open;
  END IF;
  RAISE NOTICE '0281: the server-only functions are closed';
END
$server_only$;
