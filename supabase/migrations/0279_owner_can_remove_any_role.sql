-- ============================================================
-- 0279 — built-in roles are removable by the owner
-- ============================================================
-- The owner's latest decision: every role in the shop can be deleted, including
-- a role that came with the system. Deleting a role takes away the access it
-- provided; it never deletes an employee or their history.
--
-- This restores the 0183 deletion contract (role removed, memberships cleared)
-- while keeping the Owner identity protected. Branch-specific grants are cleared
-- too, so a deleted role cannot survive as a per-branch assignment.

CREATE OR REPLACE FUNCTION public.delete_role(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid := (payload->>'roleId')::uuid;
  v_name text;
  v_system boolean;
  v_revoked int := 0;
BEGIN
  v_tenant := public.authorize_business_action('settings.edit');

  SELECT name, is_system INTO v_name, v_system
    FROM public.roles
   WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  -- The Owner identity is an account, not an assignable role. It stays protected.
  IF lower(btrim(v_name)) IN ('owner', 'business owner', 'shop owner') THEN
    RAISE EXCEPTION 'OWNER_ROLE_READ_ONLY';
  END IF;

  SELECT count(DISTINCT m.id) INTO v_revoked
    FROM public.memberships m
    LEFT JOIN public.membership_branch_roles mbr ON mbr.membership_id = m.id
   WHERE m.tenant_id = v_tenant
     AND (m.role_id = v_id OR mbr.role_id = v_id);

  -- Revoke first, in the same transaction as the delete. The employee stays; only
  -- the access this role supplied goes away.
  UPDATE public.memberships
     SET role_id = NULL, updated_at = now()
   WHERE role_id = v_id AND tenant_id = v_tenant;

  DELETE FROM public.membership_branch_roles AS mbr
   USING public.memberships AS m
   WHERE mbr.membership_id = m.id
     AND m.tenant_id = v_tenant
     AND mbr.role_id = v_id;

  DELETE FROM public.roles
   WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  INSERT INTO public.audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (
    public.app_current_user_id(),
    'role_deleted',
    'role',
    v_id,
    jsonb_build_object('name', v_name, 'wasSystemRole', COALESCE(v_system, false), 'revokedFrom', v_revoked)
  );

  RETURN jsonb_build_object('id', v_id, 'deleted', true, 'revokedFrom', v_revoked);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_role(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_role(jsonb) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.delete_role(jsonb) IS
  'Deletes any assignable role, including built-ins. Clears membership and branch-role access first; employees and history remain. Owner identity roles stay protected.';