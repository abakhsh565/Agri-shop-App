-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0117: tenant-admin membership visibility + tenant-scoped user insert
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE:
--   * memberships had a single policy — `user_id = jwt.sub` — so the Roles &
--     Access screen rendered "0 employees" for every role, including
--     "Sales Employee" which has 5 memberships in the database. The Owner could
--     not answer "which employees will be affected if I change this role?".
--   * users.users_insert carried no WITH CHECK, so an authenticated user could
--     insert a user row belonging to ANOTHER tenant.
--
-- Both are corrected by the same rule already used everywhere else:
-- shop_id / tenant_id = current_shop_id(). No cross-tenant row becomes visible.
-- ═══════════════════════════════════════════════════════════════════════════════

-- An owner/admin may read the memberships of its OWN tenant (not other tenants).
DROP POLICY IF EXISTS memberships_select_tenant_admin ON public.memberships;
CREATE POLICY memberships_select_tenant_admin ON public.memberships
  FOR SELECT TO authenticated
  USING (tenant_id = current_shop_id() AND app_is_admin());

-- A user row can only be created inside the caller's own tenant.
DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (shop_id = current_shop_id());
