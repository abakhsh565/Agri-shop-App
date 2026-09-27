-- ═══════════════════════════════════════════════════════════════════════════════
-- 0153 — the two structural invariants the RBAC suite was failing
--
-- These are not features; they are the two shapes of bug the invariant suite exists to catch, and
-- both were live:
--
--   A. `user_active_shops` had RLS ENABLED with ZERO policies. RLS-on-with-no-policy is not
--      "locked down", it is *silently empty*: every read returns no rows and every write fails,
--      with no error anyone can act on. The table is server-owned (written only by
--      set_active_shop / create_shop_for_me, both SECURITY DEFINER), so the missing half is the
--      read the caller is entitled to: their own row. Writes stay server-only by having no
--      INSERT/UPDATE/DELETE policy at all.
--
--   B. `create_shop_internal` provisioned a shop, a branch, the role templates and an owner
--      membership with no authorization check anywhere inside it. It is EXECUTE-revoked from
--      PUBLIC/anon/authenticated, so no client can reach it directly — but the guard belongs in
--      the function that does the writing, not only in its callers, so that a future caller
--      cannot provision a business by accident.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── A. The caller can see which shop they are working in ──────────────────────
-- ENABLE is idempotent and stated here so the file is complete on its own.
ALTER TABLE public.user_active_shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_active_shops_select_own ON public.user_active_shops;
CREATE POLICY user_active_shops_select_own ON public.user_active_shops FOR SELECT
  USING (user_id = app_current_user_id());

COMMENT ON POLICY user_active_shops_select_own ON public.user_active_shops IS
  'A person may read the shop they are working in. Which shop that is remains the server''s to write.';

-- ── B. Provisioning a shop requires an owner/admin — or a trusted context ──────
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
   ORDER BY min(r.created_at) ASC
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
REVOKE ALL ON FUNCTION public.create_shop_internal(text, uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_shop_internal(text, uuid) IS
  'Provisions a shop with its default branch, the system role templates and (optionally) an owner membership. Internal: owner/admin or trusted context only, and EXECUTE-revoked from every client role.';
