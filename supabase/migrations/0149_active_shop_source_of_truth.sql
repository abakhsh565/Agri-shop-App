-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0149: ONE source of truth for the active shop
-- ═══════════════════════════════════════════════════════════════════════════════
-- FINDING (audit, measured against the live QA database):
--   "Which shop am I in?" had eight independent answers, and they did not agree:
--
--     current_shop_id            live body: memberships (created_at ASC LIMIT 1) → users.shop_id
--     resolve_tenant_for_user    memberships (created_at ASC LIMIT 1) → users.shop_id
--     get_current_tenant_id      memberships (created_at ASC LIMIT 1)
--     get_current_membership     memberships (created_at ASC LIMIT 1)
--     authorize_business_action  memberships (created_at ASC LIMIT 1)
--     authorize_tenant_membership memberships (created_at ASC LIMIT 1)
--     get_effective_permissions  memberships (created_at ASC LIMIT 1)
--     current_branch_scope       memberships (created_at ASC LIMIT 1)
--
--   Every one of them ordered by `created_at` and took the first row, so "the active shop"
--   was an accident of row age. A second membership could never be selected, and RBAC
--   answered for a shop the person was not working in. The client then agreed with
--   whichever row its own lookup happened to land on (lookup_user_by_phone, also LIMIT 1).
--
--   The live `current_shop_id()` body was also absent from the repository: 0009, and both
--   bundled schema files (ALL_MIGRATIONS_TO_RUN.sql, COMPLETE_DATABASE_SETUP.sql) still
--   carry a `users.shop_id`-only definition, so replaying the repo could not reproduce the
--   database the app runs on. This file is where the whole chain now lives.
--
-- WHAT THIS MIGRATION ADDS
--   user_active_shops           the per-user selection. Server-owned: RLS is on and there is
--                               deliberately NO policy, so PostgREST cannot read or write it
--                               — the only way in is through a SECURITY DEFINER RPC.
--   resolve_active_shop(user)   THE chain. selection, but only while the membership behind it
--                               is still active → oldest active membership → legacy
--                               users.shop_id (pre-membership accounts).
--   membership_in_active_shop   a user's membership in the shop that is active for the CALLER,
--                               so guards, permissions and branch scope all answer inside the
--                               currently selected shop.
--
--   All eight resolvers above are rewritten to read those two, so there is exactly one chain.
--   Nothing else changes: RLS policies keep calling current_shop_id(), and therefore keep
--   scoping every tenant table to whatever shop is active, with no policy edited.
--
-- HISTORICAL INTEGRITY: this migration writes no business row. It adds a pointer per user and
-- redefines functions; existing rows keep the shop they already carry. A user who never
-- selects a shop resolves exactly as before (their oldest active membership).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The selection ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_active_shops (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_active_shops IS
  'Which shop a user is currently working in. Server-owned: written only by set_active_shop / create_shop_for_me. A row is honoured only while the membership behind it is active.';

ALTER TABLE user_active_shops ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. Default-deny for anon/authenticated through PostgREST; the RPCs
-- below are the only writers and resolve_active_shop() is the only reader.
REVOKE ALL ON user_active_shops FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_active_shops TO service_role;

-- A removed membership must not leave a pointer behind that looks meaningful.
CREATE OR REPLACE FUNCTION public.clear_active_shop_on_membership_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM user_active_shops
   WHERE user_id = OLD.user_id AND shop_id = OLD.tenant_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS clear_active_shop_on_membership_delete_trg ON memberships;
CREATE TRIGGER clear_active_shop_on_membership_delete_trg
  AFTER DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION public.clear_active_shop_on_membership_delete();

-- ── 2. The chain ──────────────────────────────────────────────────────────────
-- Internal by design: it takes a user id, so exposing it would let any caller resolve any
-- account's shop. SECURITY DEFINER callers reach it as the owner.
CREATE OR REPLACE FUNCTION public.resolve_active_shop(p_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    -- The user's own selection — honoured only if the membership is still active.
    (SELECT uas.shop_id
       FROM user_active_shops uas
       JOIN memberships m
         ON m.user_id = uas.user_id
        AND m.tenant_id = uas.shop_id
        AND m.status = 'active'
      WHERE uas.user_id = p_user_id),
    -- No usable selection: the behaviour every caller had before multi-shop existed.
    (SELECT m.tenant_id
       FROM memberships m
      WHERE m.user_id = p_user_id AND m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 1),
    -- Legacy: accounts that predate memberships.
    (SELECT u.shop_id FROM users u WHERE u.id = p_user_id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.resolve_active_shop(uuid) FROM PUBLIC, anon, authenticated;

-- The tenant everything in the database scopes to: RLS, business RPCs, branch stamping.
-- Callable by anon/authenticated because RLS policy expressions are evaluated as the
-- invoker, and a caller with no JWT resolves to NULL exactly as before.
CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.resolve_active_shop(app_current_user_id()); $$;

-- A user's membership in the shop that is active FOR THE CALLER. This is what makes RBAC
-- answer inside the currently selected shop — including when an owner looks at an employee,
-- where the membership must be the employee's in the caller's shop, not the employee's own
-- choice of shop.
CREATE OR REPLACE FUNCTION public.membership_in_active_shop(p_user_id uuid DEFAULT NULL)
RETURNS memberships
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.*
    FROM memberships m
   WHERE m.user_id = COALESCE(p_user_id, app_current_user_id())
     AND m.tenant_id = public.current_shop_id()
     AND m.status = 'active'
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.membership_in_active_shop(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Every resolver reads the chain ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.current_shop_id(); $$;

-- Same five keys this returned before (scripts and tests read them), now for the active shop.
CREATE OR REPLACE FUNCTION public.get_current_membership()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_membership jsonb;
BEGIN
  SELECT jsonb_build_object(
           'user_id', m.user_id,
           'tenant_id', m.tenant_id,
           'role', m.role,
           'status', m.status,
           'branch_scope', m.branch_scope)
    INTO v_membership
    FROM public.membership_in_active_shop(NULL) m;

  RETURN v_membership;
END;
$$;

-- A branch-limited employee of shop A who runs shop B must get B's scope while B is active.
CREATE OR REPLACE FUNCTION public.current_branch_scope()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.branch_scope FROM public.membership_in_active_shop(NULL) m;
$$;

CREATE OR REPLACE FUNCTION public.resolve_tenant_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.resolve_active_shop(p_user_id); $$;

-- ── 4. Authority answers for the active shop ──────────────────────────────────
-- Global `users.role` decided everything before this: a person who owns shop B and merely
-- works in shop A satisfied app_is_admin() while standing in A, so the policies that add
-- "AND app_is_admin()" (products, purchases, voids, stock adjustments, reconciliations, …)
-- would have let B's ownership write into A. Authority is now the active shop's membership.
-- The global role is kept only for callers with no membership at all (platform operators on
-- legacy rows); every policy that uses this also requires `shop_id = current_shop_id()`, so
-- that fallback cannot reach another tenant's rows.
CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT m.role IN ('owner', 'admin') FROM public.membership_in_active_shop(NULL) m),
    (SELECT EXISTS (
       SELECT 1 FROM users u
        WHERE u.id = app_current_user_id() AND u.role IN ('admin', 'co_admin') AND u.is_active))
  );
$$;

CREATE OR REPLACE FUNCTION get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, app_current_user_id());
  v_caller uuid := app_current_user_id();
  v_tenant uuid;
  v_role membership_role;
  v_role_id uuid;
  v_result text[];
BEGIN
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF v_caller IS DISTINCT FROM v_user_id AND NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: cannot inspect another user access';
  END IF;

  -- The user's membership in the shop the CALLER is working in: one shop's role model is
  -- never used to answer for another shop.
  SELECT m.tenant_id, m.role, m.role_id
    INTO v_tenant, v_role, v_role_id
  FROM public.membership_in_active_shop(v_user_id) m;

  IF v_tenant IS NULL THEN RETURN '[]'::jsonb; END IF;
  -- 'admin' joins 'owner' here: the admin shell is built for both, and a shop's admin is
  -- not a narrowed role. Narrowing belongs to employees, who are given explicit grants.
  IF v_role IN ('owner', 'admin') THEN
    SELECT array_agg(p.code ORDER BY p.code) INTO v_result FROM permissions p;
    RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
  END IF;

  SELECT array_agg(code ORDER BY code) INTO v_result
  FROM (
    SELECT p.code
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id
    UNION
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = true
    EXCEPT
    SELECT p.code
    FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id
      AND up.is_override = true
      AND up.is_granted = false
  ) effective;

  RETURN to_jsonb(COALESCE(v_result, ARRAY[]::text[]));
END;
$$;

-- The guard every business RPC goes through. p_tenant_id is the row's own shop when a
-- function has already read it (archive_customer, void_sale, …), so a call aimed at another
-- shop's row is refused here rather than by a screen.
CREATE OR REPLACE FUNCTION public.authorize_business_action(
  p_permission character varying,
  p_tenant_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_tenant uuid;
  v_scope uuid[];
BEGIN
  IF v_actor IS NULL THEN
    IF is_trusted_context() THEN
      -- Server-side / owner connection: there is no member to authorize, and
      -- this caller already outranks every role check in the database.
      RETURN COALESCE(p_tenant_id, current_shop_id());
    END IF;
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_tenant := current_shop_id();
  SELECT m.branch_scope INTO v_scope FROM public.membership_in_active_shop(v_actor) m;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: no active membership';
  END IF;
  IF p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.authorize_tenant_membership(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_tenant uuid;
BEGIN
  IF v_actor IS NULL THEN
    IF is_trusted_context() THEN
      RETURN COALESCE(p_tenant_id, current_shop_id());
    END IF;
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  v_tenant := current_shop_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active membership'; END IF;
  IF p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  RETURN v_tenant;
END;
$$;

-- ── 5. Sign-in resolves the same shop the database does ───────────────────────
-- Pre-session lookup (anon is deliberate: it is the sign-in step). Unchanged except that the
-- membership it reports is the one for the account's ACTIVE shop, so the shell the client
-- builds agrees with every RLS read that follows.
CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user jsonb;
  v_membership jsonb;
  v_canonical text := public.canonical_phone(p_phone);
  v_user_id uuid;
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'phone', u.phone,
    'role', u.role,
    'is_original_owner', u.is_original_owner,
    'is_active', u.is_active,
    'employee_number', u.employee_number,
    'job_title', u.job_title,
    'first_login_at', u.first_login_at,
    'last_login_at', u.last_login_at,
    'deactivated_at', u.deactivated_at,
    'deactivated_by', u.deactivated_by,
    'created_by', u.created_by,
    'created_at', u.created_at,
    'photo_url', u.photo_url,
    'shop_id', u.shop_id
  ) INTO v_user
  FROM users u
  WHERE v_canonical IS NOT NULL
    AND public.canonical_phone(u.phone) = v_canonical
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := (v_user->>'id')::uuid;

  SELECT jsonb_build_object(
    'tenant_id', m.tenant_id,
    'membership_id', m.id,
    'membership_role', m.role,
    'membership_status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
  -- The active shop first, then an active membership, then the oldest row: an invited
  -- employee still sees 'pending' and can activate it (0133).
  ORDER BY (m.tenant_id = public.resolve_active_shop(v_user_id)) DESC,
           (m.status = 'active') DESC,
           m.created_at ASC
  LIMIT 1;

  IF v_membership IS NOT NULL THEN
    v_user := v_user || v_membership;
  END IF;

  RETURN v_user;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.lookup_user_by_phone(text) FROM PUBLIC;
-- Still callable before a session exists: that is the whole point of this
-- function, and 0133 already relies on the anon grant.
GRANT EXECUTE ON FUNCTION public.lookup_user_by_phone(text) TO anon, authenticated;
