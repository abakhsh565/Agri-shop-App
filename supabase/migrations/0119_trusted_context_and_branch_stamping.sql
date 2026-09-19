-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0119: trusted-context rule + branch stamping for trusted callers
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE (measured):
--   direct PG connection    → session_user='postgres',      no jwt claims
--   PostgREST + service_role→ session_user='authenticator', claims.role=service_role
--   PostgREST + anon (no JWT)→ session_user='authenticator', no jwt claims
--
-- Migrations 0112/0115 routed every business write through an authoritative
-- guard that required a JWT `sub`. That correctly locked out the browser paths
-- but ALSO locked out legitimate trusted callers (migrations, maintenance
-- scripts, server-side jobs) which have no JWT — 18 existing suite tests that
-- exercise server-side back-office calls started failing with NOT_AUTHENTICATED.
--
-- This migration makes the trust boundary explicit:
--   * trusted  = no JWT and the connecting role is not PostgREST's
--                `authenticator` (i.e. a direct/owner connection), or a
--                service_role JWT (server-side only, never in the browser);
--   * blocked  = anon / unauthenticated PostgREST traffic.
-- It also lets a trusted caller stamp branch ownership, so back-office inserts
-- cannot leave records without a branch.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.is_trusted_context()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('request.jwt.claims', true), '') = '' THEN
      session_user IS DISTINCT FROM 'authenticator'
    ELSE
      (current_setting('request.jwt.claims', true)::json ->> 'role') = 'service_role'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.is_trusted_context() TO authenticated, anon;

-- ── Authoritative guard: unchanged for members, explicit for trusted callers ──
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

  SELECT m.tenant_id, m.branch_scope INTO v_tenant, v_scope
  FROM memberships m WHERE m.user_id = v_actor AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

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

  SELECT m.tenant_id INTO v_tenant
  FROM memberships m
  WHERE m.user_id = v_actor AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active membership'; END IF;
  IF p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  RETURN v_tenant;
END;
$$;

-- ── Branch ownership: stamped for members AND trusted callers ────────────────
CREATE OR REPLACE FUNCTION public.enforce_branch_scope()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_scope uuid[];
  v_tenant uuid;
BEGIN
  v_scope := current_branch_scope();
  -- Not every operational table carries a tenant column, so read it through
  -- the row image instead of assuming the attribute exists (NEW.shop_id raises
  -- "record new has no field shop_id" on inventory_movements / *_payments).
  v_tenant := COALESCE(current_shop_id(), (to_jsonb(NEW) ->> 'shop_id')::uuid);

  -- All-branch member, service-role job, or direct owner connection: the
  -- record belongs to the tenant's default branch unless one was stated.
  IF v_scope IS NULL THEN
    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := default_branch_id(v_tenant);
    END IF;
    RETURN NEW;
  END IF;

  -- Branch-limited member: operate in its own branch, never outside its scope.
  IF NEW.branch_id IS NULL THEN
    NEW.branch_id := v_scope[1];
  ELSIF NOT (NEW.branch_id = ANY(v_scope)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: branch access denied';
  END IF;

  RETURN NEW;
END;
$$;
