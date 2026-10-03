-- ============================================================
-- 0183 — deleting a role revokes its access, instead of refusing
-- ============================================================
-- THE DECISION THIS CHANGES
--
-- 0164 established one rule: a role somebody is ASSIGNED to cannot be deleted
-- (`ROLE_IN_USE`), because "the role can be created again with the same permissions".
-- The staging acceptance gate requires the opposite behaviour, and it is the more
-- defensible one: the owner's intent when they delete a role is to take that access
-- away from the people working under it. Refusing sends them to a second screen to
-- reassign every employee first, and — worse — it leaves the access in place while the
-- owner believes they have removed it.
--
-- SO THE RULE IS NOW: deleting a role REMOVES THE ACCESS IT PROVIDED.
--
--   1. The role row is deleted (as before).
--   2. Every membership still pointing at it has `role_id` cleared to NULL. Nothing is
--      copied into `user_permissions`, deliberately: those rows are the owner's explicit
--      per-employee overrides, and a role's defaults are never stored as overrides
--      anywhere else in this schema (0108/0132, asserted by the RBAC suites). Writing
--      them here would leave stale grants behind that no screen could explain.
--   3. `role_permissions` rows go with the role through the existing ON DELETE CASCADE
--      (0107), so no orphaned grant rows can remain.
--   4. The membership itself, the employee and every business row they touched are
--      untouched. History is attributed by id, so past sales stay attributed to them.
--
-- WHY NULLING `role_id` IS ALREADY A COMPLETE REVOCATION — and why nothing has to be
-- rewritten for it to work:
--
--   * `get_effective_permissions` (0149, kept current by 0175) resolves an employee's
--     access by joining `role_permissions` on `memberships.role_id`. With no role there
--     is no row to join, so the employee's effective set becomes exactly their own
--     overrides — normally empty. The next `authorize_business_action` call refuses.
--   * `membership_in_active_shop` (0149) is `status = 'active'`, which a nulled role
--     does not change, so the employee keeps their identity, their branch scope and
--     their history: they lose the role's permissions, not their account.
--   * there is no permission cache to invalidate. Every RPC resolves permissions from
--     the database per call, which is why an existing session cannot outlive a
--     revocation — the same mechanism `rbacLifecycleAndSessions` already proves for a
--     role change mid-session.
--
-- WHAT IS DELIBERATELY NOT CHANGED: who may delete a role (`settings.edit`), the tenant
-- scoping, the audit trail, and the fact that an employee is never deleted with the role.
--
-- THE SCREEN IS CHANGED IN THE SAME COMMIT (src/pages/admin/settings/RolesAccessPage.tsx):
-- the delete row is no longer disabled for an in-use role, and the confirmation now names
-- how many employees will lose the access, so the destructive action is described before
-- it is confirmed rather than refused after it.
--
-- SCOPE: applied to QA/staging first (this file, in the ledger). Production is migrated
-- forward only by the schema-strategy decision, never by replaying history.

CREATE OR REPLACE FUNCTION public.delete_role(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_id uuid := (payload->>'roleId')::uuid;
  v_system boolean;
  v_affected int := 0;
BEGIN
  v_tenant := authorize_business_action('settings.edit');

  SELECT is_system INTO v_system FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF v_system IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  -- Revoke first, in the same transaction as the delete: a role cannot be gone while
  -- an employee still resolves permissions through it, and it cannot be revoked while
  -- the role still exists. Either both happen or neither does.
  --
  -- Scoped to this tenant, because a membership pointing at a role of another shop is
  -- not this owner's to change. If one ever existed, the DELETE below fails on the
  -- foreign key and the whole transaction rolls back rather than half-applying.
  UPDATE memberships
     SET role_id = NULL, updated_at = now()
   WHERE role_id = v_id AND tenant_id = v_tenant;
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  DELETE FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'role_deleted', 'role', v_id,
          jsonb_build_object('wasSystemRole', COALESCE(v_system, false),
                             'revokedFrom', v_affected));

  -- The screen reads this to say what happened. `deleted` is kept so any older caller
  -- still sees the shape it knows.
  RETURN jsonb_build_object('id', v_id, 'deleted', true, 'revokedFrom', v_affected);
END; $$;

GRANT EXECUTE ON FUNCTION public.delete_role(jsonb) TO authenticated;

COMMENT ON FUNCTION public.delete_role(jsonb) IS
  'Deletes a role and revokes the access it provided: every membership pointing at it is cleared to role_id = NULL in the same transaction. The employees, their memberships and their history are untouched. Returns revokedFrom = the number of employees whose access was removed.';

-- ── proof, in the migration itself ────────────────────────────────────────────────
-- A deleted role must not be able to leave an orphaned reference behind. That is not
-- left to the UPDATE above: `memberships.role_id` must carry a foreign key to `roles`,
-- so the database itself refuses a delete that would strand a reference. If a future
-- migration drops that constraint, the revocation above stops being airtight and this
-- file's premise is gone — so the premise is asserted rather than assumed.
DO $$
DECLARE
  v_fk int;
BEGIN
  SELECT count(*) INTO v_fk
    FROM pg_constraint c
   WHERE c.conrelid = 'public.memberships'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'public.roles'::regclass;

  IF v_fk = 0 THEN
    RAISE EXCEPTION '0183: memberships.role_id has no foreign key to roles — deleting a role could strand an orphaned reference';
  END IF;
END $$;
