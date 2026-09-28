-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0164: a built-in role can be removed once nobody is using it
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS CHANGES
--
-- 1. `delete_role` refused every system role outright (SYSTEM_ROLE_READ_ONLY, from 0108).
--    The intent was to protect the four roles the app ships with — but "built-in" is a fact
--    about where a role CAME FROM, not about whether this shop still wants it. A shop that
--    never uses Inventory Clerk had no way to remove it, and the screen could only say
--    "this one comes with the app".
--
--    The rule that has to hold is the one that was already there and is kept exactly:
--    a role somebody is ASSIGNED to cannot be deleted (ROLE_IN_USE). Everything else about a
--    deleted role is recoverable — it can be created again with the same permissions through
--    `create_role` — so removal is safe once nobody is on it.
--
-- 2. New shops are seeded with the role templates this app defines, copied out of the shop
--    that already carries them (0150, kept current in 0153). That function picked the OLDEST
--    such shop, which means removing one built-in role from the oldest shop would silently
--    shrink what every later shop is created with. It now prefers the shop that still carries
--    the MOST of them, so a removal in one shop does not change what a new shop starts with
--    for as long as any other shop still has the full set.
--
-- NOT CHANGED: who may delete a role (`settings.edit`), the audit trail, the tenant scoping,
-- and the fact that a role in use is refused with the count the screen shows.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Any role may be removed, provided nobody is assigned to it ─────────────────
CREATE OR REPLACE FUNCTION delete_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_id uuid := (payload->>'roleId')::uuid; v_system boolean;
BEGIN
  v_tenant := authorize_business_action('settings.edit');

  SELECT is_system INTO v_system FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF v_system IS NULL THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  -- The one rule: a role someone is working under cannot vanish from under them.
  IF EXISTS(SELECT 1 FROM memberships WHERE role_id = v_id AND status = 'active') THEN
    RAISE EXCEPTION 'ROLE_IN_USE';
  END IF;

  DELETE FROM roles WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'role_deleted', 'role', v_id,
          jsonb_build_object('wasSystemRole', COALESCE(v_system, false)));

  RETURN jsonb_build_object('id', v_id, 'deleted', true);
END; $$;
GRANT EXECUTE ON FUNCTION delete_role(jsonb) TO authenticated;

-- ── 2. A new shop starts from the shop that still carries the full set ─────────────
CREATE OR REPLACE FUNCTION public.create_shop_internal(p_name text, p_owner_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid;
  v_template uuid;
  v_role record;
  v_new_role uuid;
BEGIN
  -- The one lock on this write. The two callers (create_shop_for_me, approve_shop_request) are
  -- already guarded, and this function is EXECUTE-revoked from every client role; this is the
  -- guard that keeps the *writing* function safe on its own, including for any future caller.
  -- A trusted context (service role, migration, direct SQL) is not a person and is allowed.
  IF NOT (is_trusted_context() OR app_is_admin()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: creating a shop requires an owner or admin of an existing shop';
  END IF;

  INSERT INTO shops (id, name, owner_id)
  VALUES (gen_random_uuid(), p_name, p_owner_id)
  RETURNING id INTO v_shop;

  -- Branch first: the branch-stamping trigger (0119) resolves a new record's branch through
  -- default_branch_id(tenant), and a shop with no branch would stamp NULL.
  INSERT INTO branches (tenant_id, name, is_default, is_active)
  VALUES (v_shop, p_name || ' - Main', true, true);

  -- The four system role templates this app defines, taken from the shop that already carries
  -- them (oldest first, so the set is deterministic). Only role metadata and permission codes
  -- are copied — never an employee, a membership or a business row.
  SELECT r.tenant_id INTO v_template
    FROM roles r
   WHERE r.is_system
   GROUP BY r.tenant_id
   -- Prefer the shop that still carries the MOST of them: deleting a role from the oldest
   -- shop must not quietly shrink what the next shop is created with.
   ORDER BY count(*) DESC, min(r.created_at) ASC
   LIMIT 1;

  IF v_template IS NOT NULL THEN
    FOR v_role IN
      SELECT * FROM roles r WHERE r.tenant_id = v_template AND r.is_system ORDER BY r.name
    LOOP
      INSERT INTO roles (tenant_id, name, description, is_system)
      VALUES (v_shop, v_role.name, v_role.description, true)
      RETURNING id INTO v_new_role;

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_new_role, rp.permission_id FROM role_permissions rp WHERE rp.role_id = v_role.id;
    END LOOP;
  END IF;

  -- p_owner_id is NULL only for the registration path, where the users row (and therefore the
  -- membership, via the 0113 trigger) is created immediately afterwards.
  IF p_owner_id IS NOT NULL THEN
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES (p_owner_id, v_shop, 'owner', 'active')
    ON CONFLICT (user_id, tenant_id)
    DO UPDATE SET role = 'owner', status = 'active', updated_at = now();
  END IF;

  RETURN v_shop;
END;
$$;

COMMENT ON FUNCTION public.create_shop_internal(text, uuid) IS
  'Creates a shop with its branch, its owner membership and a copy of the app role templates, taken from the shop that still carries the most of them.';
