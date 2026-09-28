-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0167: the shop has two account roles, not three
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS CHANGES
--
-- `user_role` shipped with three labels: admin, co_admin, employee. `co_admin` was never a
-- distinct job. It is a second name for the authority `admin` already carries, so every check
-- in the app read `role === 'admin' || role === 'co_admin'` and every RPC authorization read
-- `v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin'`.
-- A third label that never appears on its own is a second place for one rule to be written,
-- and the rule it duplicates is the authorization rule.
--
-- The account roles are now exactly two: `admin` — the owner, who sees and controls everything
-- — and `employee`, whose reach is set by the permissions their owner grants. Anything a shop
-- wants beyond those two is a ROLE: the per-shop permission bundles in `roles` + `memberships`,
-- which the owner can already create, edit, remove and assign. That is the layer built for it,
-- and it is the one that can flex without a schema change.
--
-- HOW THE VALUE IS REMOVED. Postgres has no `ALTER TYPE ... DROP VALUE`, so the label cannot
-- be deleted in place — the type is rebuilt, and every object that hangs off `users.role` has
-- to be moved out of the way and put back. What actually depends on that column was measured,
-- not assumed, because the obvious search for the string `co_admin` finds NONE of it: these
-- objects constrain the column, not the label.
--
--   `users.role` is depended on by TEN objects:
--
--     pg_policy   user_permissions.user_permissions_select   (SELECT, USING)
--     pg_policy   user_permissions.user_permissions_insert   (INSERT, WITH CHECK)
--     pg_policy   user_permissions.user_permissions_delete   (DELETE, USING)
--     pg_policy   roles.roles_insert                         (INSERT, WITH CHECK)
--     pg_policy   roles.roles_update                         (UPDATE, USING)
--     pg_policy   roles.roles_delete                         (DELETE, USING, NOT is_system)
--     pg_policy   role_permissions.role_permissions_insert   (INSERT, WITH CHECK)
--     pg_policy   role_permissions.role_permissions_delete   (DELETE, USING)
--     pg_attrdef  users.role DEFAULT 'employee'::user_role
--     pg_rewrite  the users_public view
--
--   The first attempt at this file dropped only the view and the default and was refused with
--   `0A000: policy user_permissions_select on table user_permissions depends on column "role"`.
--   The eight policies are therefore dropped and recreated verbatim — same permissive mode,
--   same PUBLIC grantee, same expressions, including the redundant `'admin'::user_role` cast —
--   because this migration is about the set of accepted labels, and must not quietly change
--   who may manage roles in the process.
--
-- NO POLICY IS DROPPED WITH `IF EXISTS`, and no policy is created without being expected.
-- A missing policy would be silently added back, and these policies decide who may grant
-- permissions; a state that does not match this list is a fact worth stopping for.
--
-- The order is the whole of the risk:
--   1. every `co_admin` row is demoted to `employee` FIRST, so no row is left holding a label
--      the new type cannot represent;
--   2. the nine dependents that carry the column are dropped — the view and the eight policies;
--   3. `users.role` is detached to `text`, the type is dropped and recreated with two labels,
--      and the column is re-attached with its original `'employee'` default;
--   4. the eight policies and the view are restored, then the three functions whose body names
--      `co_admin` are redefined. The functions are not cosmetic: `u.role IN ('admin',
--      'co_admin')` against a `user_role` column stops PLANNING once `co_admin` is not a label
--      of that type — `invalid input value for enum user_role`;
--   5. the file proves itself and rolls the whole thing back if any trace survives.
--
-- WHY DEMOTE AND NOT PROMOTE. A `co_admin` already held the admin authority, so promoting would
-- have preserved their reach exactly. It would also have made a real person's account type the
-- silent product of a migration, and granted `admin` to whoever happened to hold a label that
-- no longer exists. Demotion is the conservative direction: nobody gains access from this file.
-- A shop that wants that person back at full authority gives them a role carrying the
-- permissions, which is auditable and reversible.
--
-- WHAT IS NOT CHANGED: `membership_role` (owner / admin / employee), `membership_status`, the
-- `roles` permission bundles and who may assign them, the eight policies' expressions and
-- grantees, the `users_public` view's definition and who may read it, `app_is_admin()`'s
-- meaning — still "owner or admin of the shop you are standing in", now with one fewer way to
-- spell it — and `users.role`'s default.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. No row may be left holding the label that is going away ────────────────────
DO $$
DECLARE v_demoted int;
BEGIN
  UPDATE users SET role = 'employee' WHERE role::text = 'co_admin';
  GET DIAGNOSTICS v_demoted = ROW_COUNT;
  IF v_demoted > 0 THEN
    RAISE NOTICE '0167: demoted % co_admin account(s) to employee', v_demoted;
  ELSE
    RAISE NOTICE '0167: no co_admin rows found — nothing to demote';
  END IF;
END $$;

-- ── 2. Move the nine dependents of users.role out of the way ─────────────────────

-- The view exposes users.role directly.
DROP VIEW public.users_public;

-- Eight RLS policies decide who may manage roles and permissions by looking up
-- `users.role`. They are dropped only to be recreated byte-for-byte in step 4.
DROP POLICY user_permissions_select ON public.user_permissions;
DROP POLICY user_permissions_insert ON public.user_permissions;
DROP POLICY user_permissions_delete ON public.user_permissions;
DROP POLICY roles_insert   ON public.roles;
DROP POLICY roles_update   ON public.roles;
DROP POLICY roles_delete   ON public.roles;
DROP POLICY role_permissions_insert ON public.role_permissions;
DROP POLICY role_permissions_delete ON public.role_permissions;

-- ── 3. Rebuild the type with the two labels the product actually has ─────────────
ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN role TYPE text USING role::text;

DROP TYPE public.user_role;
CREATE TYPE public.user_role AS ENUM ('admin', 'employee');

ALTER TABLE public.users ALTER COLUMN role TYPE public.user_role USING role::public.user_role;
ALTER TABLE public.users ALTER COLUMN role SET DEFAULT 'employee'::public.user_role;

-- ── 4a. Restore the eight policies, exactly as they were ─────────────────────────
-- Same shape as before: permissive, granted to PUBLIC, and gated on the caller being
-- `admin` in the shop they are standing in. `is_trusted_context()` / the service role
-- continue to bypass RLS as they did.

CREATE POLICY user_permissions_select ON public.user_permissions
  FOR SELECT TO PUBLIC
  USING (
    user_id = (NULLIF((current_setting('request.jwt.claims', true))::json ->> 'sub', ''))::uuid
    OR EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = (NULLIF((current_setting('request.jwt.claims', true))::json ->> 'sub', ''))::uuid
         AND u.role = 'admin'::user_role
         AND u.shop_id = (SELECT users.shop_id FROM users WHERE users.id = user_permissions.user_id)
    )
  );

CREATE POLICY user_permissions_insert ON public.user_permissions
  FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = (NULLIF((current_setting('request.jwt.claims', true))::json ->> 'sub', ''))::uuid
         AND u.role = 'admin'::user_role
    )
  );

CREATE POLICY user_permissions_delete ON public.user_permissions
  FOR DELETE TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = (NULLIF((current_setting('request.jwt.claims', true))::json ->> 'sub', ''))::uuid
         AND u.role = 'admin'::user_role
    )
  );

CREATE POLICY roles_insert ON public.roles
  FOR INSERT TO PUBLIC
  WITH CHECK (
    tenant_id = current_shop_id()
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin'::user_role
    )
  );

CREATE POLICY roles_update ON public.roles
  FOR UPDATE TO PUBLIC
  USING (
    tenant_id = current_shop_id()
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin'::user_role
    )
  );

-- The `NOT is_system` term is part of the policy, not decoration: the four roles the app
-- ships with are removed through `delete_role` (0164), which answers `settings.edit`,
-- not through a raw DELETE.
CREATE POLICY roles_delete ON public.roles
  FOR DELETE TO PUBLIC
  USING (
    tenant_id = current_shop_id()
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin'::user_role
    )
    AND NOT is_system
  );

CREATE POLICY role_permissions_insert ON public.role_permissions
  FOR INSERT TO PUBLIC
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = current_shop_id()
    )
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin'::user_role
    )
  );

CREATE POLICY role_permissions_delete ON public.role_permissions
  FOR DELETE TO PUBLIC
  USING (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.tenant_id = current_shop_id()
    )
    AND EXISTS (
      SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'admin'::user_role
    )
  );

-- ── 4b. Restore the view (definition from 0042, access exactly as measured) ──────
-- 0042 granted SELECT here to `anon` and `authenticated`; no later migration revoked it, and
-- the live database does not have it. The grant is deliberately NOT restored: widening access
-- is not this migration's business, and `users_public` exists to expose a row that excludes
-- `pin_hash`. Recorded rather than silently "fixed" — if those grants were dropped on purpose,
-- restoring them would undo a decision; if by accident, that is a separate, deliberate change.
CREATE VIEW public.users_public AS
  SELECT id, name, role, phone, shop_id, is_active, created_at, updated_at
  FROM users;

-- THE VIEW COMES BACK WIDER THAN IT WENT IN, AND THAT IS REVOKED HERE.
--
-- `supabase_admin` holds ALTER DEFAULT PRIVILEGES for relations granting `arwdDxtm` to `anon`,
-- `authenticated` and `service_role`, so every relation `postgres` creates inherits full rights
-- for all three. The view that was dropped in step 2 had NO grant to `anon` or `authenticated`
-- at all — measured, not assumed — and recreating it therefore handed both roles SELECT, INSERT,
-- UPDATE and DELETE on it. `users_public` is a trivially-updatable simple view over `users`, so
-- that widening appeared on a security boundary without anyone deciding it: it was a side
-- effect of recreating an object, which is precisely the kind of change that is invisible in
-- review because the DDL that caused it looks like a restore.
--
-- Revoking is the conservative direction and matches the state this file found. Nothing in
-- `src/` reads `users_public`, so no screen depends on `authenticated` reaching it. If a
-- future feature does need it, grant it deliberately and in a migration that says why.
REVOKE ALL ON public.users_public FROM anon;
REVOKE ALL ON public.users_public FROM authenticated;

GRANT ALL ON public.users_public TO service_role;

-- ── 4c. The three functions whose body named the removed label ───────────────────

-- "owner or admin of the shop you are standing in". Identical to 0149 apart from the last
-- term: one role to test instead of two names for it.
CREATE OR REPLACE FUNCTION public.app_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT m.role IN ('owner', 'admin') FROM public.membership_in_active_shop(NULL) m),
    (SELECT EXISTS (
       SELECT 1 FROM users u
        WHERE u.id = app_current_user_id() AND u.role = 'admin' AND u.is_active))
  );
$function$;

-- Platform-level authority for approving a shop request: the account must be an active admin.
CREATE OR REPLACE FUNCTION public.approve_shop_request(request_id uuid, admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  req_record RECORD;
  v_shop uuid;
  v_user_id uuid;
  v_existing uuid;
BEGIN
  -- Platform-level authority: an authenticated founder/admin of an existing
  -- shop. A service-role / direct owner connection is trusted too.
  IF v_actor IS NULL THEN
    IF NOT is_trusted_context() THEN
      RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = v_actor
       AND u.is_active
       AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: shop approval requires the platform owner';
  END IF;

  SELECT * INTO req_record FROM shop_requests WHERE id = request_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;

  -- A phone that already answers for an account is ATTACHED to the new shop. The old path
  -- inserted a second `users` row for the same phone and died on users_phone_key, so the
  -- owner who wanted another shop was the one person who could never get one.
  SELECT u.id INTO v_existing
    FROM users u
   WHERE public.canonical_phone(u.phone) = public.canonical_phone(req_record.phone)
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_shop := public.create_shop_internal(req_record.shop_name, v_existing);
    v_user_id := v_existing;

    UPDATE shop_requests SET status = 'approved', reviewed_at = now(), reviewed_by = COALESCE(v_actor, admin_id) WHERE id = request_id;

    RETURN jsonb_build_object(
      'success', true,
      'shop_id', v_shop,
      'user_id', v_user_id,
      'attached_existing_account', true
    );
  END IF;

  -- A new phone: the shop first, then the account whose home shop it is. The 0113 trigger
  -- creates the owner membership from the users row.
  v_shop := public.create_shop_internal(req_record.shop_name, NULL);

  v_user_id := gen_random_uuid();
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, shop_id, created_by
  ) VALUES (
    v_user_id, req_record.owner_name, req_record.phone, 'admin', true, true,
    'EMP-001', v_shop, COALESCE(v_actor, admin_id)
  );
  UPDATE shops SET owner_id = v_user_id WHERE id = v_shop;

  UPDATE shop_requests SET status = 'approved', reviewed_at = now(), reviewed_by = COALESCE(v_actor, admin_id) WHERE id = request_id;

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', v_shop,
    'user_id', v_user_id
  );
END;
$function$;

-- The trigger that keeps a role change and an account deactivation an admin-only act.
-- Every branch asked "is the caller NOT this role AND NOT that role"; with one role able to
-- do this, each pair becomes the single test it was always spelling out.
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_caller_role text;
BEGIN
  -- SECURITY DEFINER functions (admin employee management) allowed
  IF current_user = 'postgres' THEN
    RETURN NEW;
  END IF;
  -- Look up caller's role
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  -- Only admin may change roles
  IF OLD.role IS DISTINCT FROM NEW.role AND v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'ROLE_PROTECTED: Only administrators can change user roles';
  END IF;
  -- Only admin may deactivate accounts
  IF OLD.is_active IS DISTINCT FROM NEW.is_active AND v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'ACCOUNT_PROTECTED: Only administrators can change account status';
  END IF;
  -- Employee may only modify their own record
  IF NEW.id != auth.uid() AND v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'USER_ISOLATION: Cannot modify another user''s account';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 5. Prove the removal, in the database, before this file can be recorded ──────
-- A migration that says it removed a value should not be trusted to have done it. This
-- raises, and therefore rolls the whole file back, if any trace survives — including the
-- nine dependents, since restoring the label is not the only way to break this.
DO $$
DECLARE v_labels text; v_policies int;
BEGIN
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) INTO v_labels
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'user_role';

  IF v_labels IS DISTINCT FROM 'admin,employee' THEN
    RAISE EXCEPTION '0167 FAILED: user_role is "%" — expected "admin,employee"', v_labels;
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE role::text = 'co_admin') THEN
    RAISE EXCEPTION '0167 FAILED: a users row still holds co_admin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc LIKE '%co_admin%'
  ) THEN
    RAISE EXCEPTION '0167 FAILED: a function still names co_admin';
  END IF;

  IF to_regclass('public.users_public') IS NULL THEN
    RAISE EXCEPTION '0167 FAILED: users_public was not restored';
  END IF;

  -- The view must come back with the access it had, not the access default privileges give it.
  IF has_table_privilege('anon', 'public.users_public', 'SELECT')
     OR has_table_privilege('authenticated', 'public.users_public', 'SELECT') THEN
    RAISE EXCEPTION '0167 FAILED: users_public came back readable by anon/authenticated — default privileges were not revoked';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.users_public', 'SELECT') THEN
    RAISE EXCEPTION '0167 FAILED: service_role lost access to users_public';
  END IF;

  -- All eight policies back, and each still gated on the admin role.
  SELECT count(*) INTO v_policies FROM pg_policy
   WHERE polrelid IN ('public.user_permissions'::regclass, 'public.roles'::regclass, 'public.role_permissions'::regclass)
     AND polname IN (
       'user_permissions_select', 'user_permissions_insert', 'user_permissions_delete',
       'roles_insert', 'roles_update', 'roles_delete',
       'role_permissions_insert', 'role_permissions_delete'
     );
  IF v_policies <> 8 THEN
    RAISE EXCEPTION '0167 FAILED: expected 8 restored role-management policies, found %', v_policies;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid IN ('public.user_permissions'::regclass, 'public.roles'::regclass, 'public.role_permissions'::regclass)
       AND polname IN (
         'user_permissions_select', 'user_permissions_insert', 'user_permissions_delete',
         'roles_insert', 'roles_update', 'roles_delete',
         'role_permissions_insert', 'role_permissions_delete'
       )
       AND coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') NOT LIKE '%admin%'
  ) THEN
    RAISE EXCEPTION '0167 FAILED: a restored policy no longer tests for the admin role';
  END IF;

  RAISE NOTICE '0167 OK: user_role = %, no co_admin row, no co_admin function, view + 8 policies restored', v_labels;
END $$;
