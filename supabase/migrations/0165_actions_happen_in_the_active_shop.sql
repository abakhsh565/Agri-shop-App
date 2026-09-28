-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0165: every action happens in the shop the account is WORKING IN
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG — measured against the database, not guessed
--
--   `authorize_business_action` is the guard every business RPC runs before it writes. It
--   resolved the caller's shop as "their OLDEST active membership"
--   (`ORDER BY m.created_at ASC LIMIT 1`). The app reads and writes the shop the account is
--   WORKING IN — `current_shop_id()`, which honours the shop the account selected
--   (`user_active_shops`, 0149). For an account with one shop those two agree, which is
--   exactly why this survived; for an owner with two shops they do not.
--
--   The symptom the owner saw: Roles & Access lists shop B's roles (the client scopes the
--   list to the active shop) and deleting one of them is refused, because the guard checked
--   the delete against shop A. The same mismatch sat under every role, employee and settings
--   write for an account that belongs to more than one shop.
--
-- WHAT THIS CHANGES
--
--   1. `authorize_business_action`: the tenant is the ACTIVE shop when the caller holds an
--      active membership there; otherwise the previous rule (oldest active membership), then
--      `users.shop_id` — so a caller whose selection cannot be resolved behaves exactly as
--      before. An explicitly passed shop must still BE that tenant: unchanged.
--   2. `get_effective_permissions`: the membership whose role answers for the caller is the
--      one in the active shop, with the same fallback. An employee who belongs to two shops
--      has to be judged by the role they hold in the shop they are working in.
--   3. RLS on `roles`, `role_permissions` and `business_areas`: their read policies resolved
--      the tenant the same "any one membership, LIMIT 1" way, so a shop's role list could
--      come back carrying another shop's rows — and an edit then failed on a row the guard
--      considered foreign. They now answer with `current_shop_id()`, the single shop decision
--      the rest of the database already scopes to. The write policies keep the admin check
--      they had, plus the tenant they are writing into.
--   4. `update_role`: a built-in role can be adjusted like any other, matching `delete_role`
--      (0164) and what the screen already offers. "Built-in" says where a role CAME from, not
--      that its access is frozen — the screen shows its checkboxes as editable, and refusing
--      the save contradicted the screen. Tenant scoping and the audit row are unchanged.
--
-- NOT CHANGED: who may do any of this (`settings.edit`), the branch-scope check, the audit
-- trail, `has_effective_permission`'s meaning, or anything about RLS beyond which shop it
-- resolves.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The business-action guard authorizes the shop being worked in ─────────────
CREATE OR REPLACE FUNCTION authorize_business_action(
  p_permission varchar,
  p_tenant_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_tenant uuid;
  v_scope uuid[];
  v_active uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- The shop this account is working in. NULL when nothing resolves, in which case the
  -- fallback below is exactly the rule that was here before.
  v_active := public.current_shop_id();

  SELECT m.tenant_id, m.branch_scope INTO v_tenant, v_scope
  FROM memberships m
  WHERE m.user_id = v_actor AND m.status = 'active'
    AND (v_active IS NULL OR m.tenant_id = v_active)
  ORDER BY m.created_at ASC LIMIT 1;

  IF v_tenant IS NULL THEN
    SELECT m.tenant_id, m.branch_scope INTO v_tenant, v_scope
    FROM memberships m WHERE m.user_id = v_actor AND m.status = 'active'
    ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  IF v_tenant IS NULL OR (p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  IF NOT has_effective_permission(p_permission, v_actor) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: missing permission %', p_permission;
  END IF;
  IF p_branch_id IS NOT NULL AND v_scope IS NOT NULL AND NOT (p_branch_id = ANY(v_scope)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;
  RETURN v_tenant;
END;
$$;
GRANT EXECUTE ON FUNCTION authorize_business_action(varchar, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION authorize_business_action(varchar, uuid, uuid) IS
  'Mandatory tenant, membership, permission, and optional branch authorization for business RPCs. The tenant is the shop the account is working in (current_shop_id), falling back to its oldest active membership.';

-- ── 2. Effective access is read from the membership in the shop being worked in ──
CREATE OR REPLACE FUNCTION get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership_role membership_role;
  v_role_id uuid;
  v_permissions jsonb;
  v_role_perms text[];
  v_override_add text[];
  v_override_remove text[];
  v_final text[];
  v_active uuid;
BEGIN
  v_user_id := COALESCE(
    p_user_id,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- The role that answers for this user: their membership in the shop being worked in, and
  -- only if there is none (nothing selected, or a legacy account) the oldest membership, which
  -- is the rule that was here before.
  v_active := public.current_shop_id();

  SELECT m.role, m.role_id INTO v_membership_role, v_role_id
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
    AND (v_active IS NULL OR m.tenant_id = v_active)
  ORDER BY m.created_at ASC LIMIT 1;

  IF v_membership_role IS NULL THEN
    SELECT m.role, m.role_id INTO v_membership_role, v_role_id
    FROM memberships m
    WHERE m.user_id = v_user_id AND m.status = 'active'
    ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  -- Owner gets ALL permissions
  IF v_membership_role = 'owner' THEN
    SELECT jsonb_agg(p.code) INTO v_permissions FROM permissions p;
    RETURN COALESCE(v_permissions, '[]'::jsonb);
  END IF;

  -- Start with role defaults
  v_role_perms := ARRAY[]::text[];
  IF v_role_id IS NOT NULL THEN
    SELECT array_agg(p.code) INTO v_role_perms
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id;
  END IF;
  v_role_perms := COALESCE(v_role_perms, ARRAY[]::text[]);

  -- Get employee overrides (additions)
  SELECT array_agg(p.code) INTO v_override_add
  FROM user_permissions up
  JOIN permissions p ON p.id = up.permission_id
  WHERE up.user_id = v_user_id AND up.is_override = true;

  v_override_add := COALESCE(v_override_add, ARRAY[]::text[]);

  -- Get employee override removals (stored as negative codes like 'sales.edit:-')
  SELECT array_agg(replace(up.permission_id::text, '', '')) INTO v_override_remove
  FROM user_permissions up
  WHERE up.user_id = v_user_id AND up.is_override = true;

  -- Build final: role defaults + additions - removals
  -- For now, simple: role perms + explicit adds
  -- Override removes are handled by explicit denial entries
  v_final := (
    SELECT array_agg(DISTINCT code)
    FROM (
      SELECT unnest(v_role_perms) AS code
      UNION
      SELECT unnest(v_override_add) AS code
    ) combined
  );

  RETURN to_jsonb(COALESCE(v_final, ARRAY[]::text[]));
END;
$$;

-- ── 3. Roles, their permissions and the business areas belong to the active shop ──
DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT USING (tenant_id = public.current_shop_id());

DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles
  FOR INSERT WITH CHECK (
    tenant_id = public.current_shop_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles
  FOR UPDATE USING (
    tenant_id = public.current_shop_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles
  FOR DELETE USING (
    tenant_id = public.current_shop_id()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin')
    AND NOT is_system
  );

DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
              AND r.tenant_id = public.current_shop_id())
  );

DROP POLICY IF EXISTS role_permissions_insert ON role_permissions;
CREATE POLICY role_permissions_insert ON role_permissions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
              AND r.tenant_id = public.current_shop_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS role_permissions_delete ON role_permissions;
CREATE POLICY role_permissions_delete ON role_permissions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
              AND r.tenant_id = public.current_shop_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin')
  );

DROP POLICY IF EXISTS business_areas_select ON business_areas;
CREATE POLICY business_areas_select ON business_areas
  FOR SELECT USING (
    tenant_id IS NULL OR tenant_id = public.current_shop_id()
  );

-- ── 4. A built-in role's access can be adjusted, like any other role ────────────
CREATE OR REPLACE FUNCTION update_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'roleId')::uuid; v_code text; v_perm uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  -- The tenant check is the authorization: a role of ANOTHER shop is not found here, and the
  -- answer names that rather than the built-in flag the version before this refused on.
  IF NOT EXISTS(SELECT 1 FROM roles WHERE id=v_id AND tenant_id=v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  UPDATE roles SET name=COALESCE(NULLIF(payload->>'name',''),name), description=COALESCE(payload->>'description',description), updated_at=now()
    WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload ? 'permissions' THEN
    DELETE FROM role_permissions WHERE role_id=v_id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions','[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM permissions WHERE code=v_code;
      IF v_perm IS NOT NULL THEN INSERT INTO role_permissions(role_id,permission_id) VALUES(v_id,v_perm) ON CONFLICT DO NOTHING; END IF;
    END LOOP;
  END IF;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'role_updated','role',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION update_role(jsonb) TO authenticated;
