-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0126: Tolerate empty-but-set JWT claims in authorization helpers
-- ═══════════════════════════════════════════════════════════════════════════════
-- DEFECT (found while proving 0125's actor capture):
--   Every authorization helper parsed the claims GUC as:
--       current_setting('request.jwt.claims', true)::json
--   Postgres returns '' (not NULL) for a claims GUC that was explicitly set to
--   empty — e.g. set_config('request.jwt.claims', NULL, ...) or a test/simulation
--   helper clearing it — and ''::json raises:
--       ERROR: invalid input syntax for type json  (SQLSTATE 22P02)
--   That is a hard failure rather than "no authenticated user", and it cascades:
--   app_current_user_id() -> current_branch_scope() -> enforce_branch_scope(),
--   so an affected write aborts with a JSON syntax error instead of being denied
--   cleanly or succeeding.
--
-- EVIDENCE:
--   BEGIN; SELECT set_config('request.jwt.claims', NULL, true);
--   SELECT current_setting('request.jwt.claims', true);  --> ''  (not NULL)
--   INSERT INTO purchases (...) --> ERROR 22P02 in app_current_user_id
--                                   called from current_branch_scope called from
--                                   enforce_branch_scope()
--
-- FIX: NULLIF(..., '') before the ::json cast in the six unguarded parsers, so an
--   empty/missing claim yields NULL claims — which is exactly how "not
--   authenticated" is already represented.
--
-- NOT CHANGED (already safe):
--   get_authenticated_user_id, record_incident -> wrap the parse in
--     BEGIN ... EXCEPTION WHEN OTHERS
--   is_trusted_context -> its CASE handles the empty case before parsing
--
-- Authorization decisions themselves are untouched: this only changes how the
-- absence of a claim is represented, never who is allowed to do what.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_membership()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_membership jsonb;
BEGIN
  v_user_id := NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'user_id', m.user_id,
    'tenant_id', m.tenant_id,
    'role', m.role,
    'status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  RETURN v_membership;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_tenant_id uuid;
BEGIN
  -- Step 1: Get user ID from JWT
  v_user_id := NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;

  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 2: Get active membership for this user
  SELECT m.tenant_id INTO v_tenant_id
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.status = 'active'
  ORDER BY m.created_at ASC  -- First membership if multiple
  LIMIT 1;

  RETURN v_tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_authorized_for_tenant(p_tenant_id uuid, p_required_role membership_role DEFAULT NULL::membership_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_membership memberships%ROWTYPE;
BEGIN
  v_user_id := NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;

  IF v_user_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_membership
  FROM memberships m
  WHERE m.user_id = v_user_id
    AND m.tenant_id = p_tenant_id
    AND m.status = 'active';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- If a specific role is required, check hierarchy: owner > admin > employee
  IF p_required_role IS NOT NULL THEN
    RETURN CASE
      WHEN v_membership.role = 'owner' THEN true
      WHEN v_membership.role = 'admin' AND p_required_role IN ('admin', 'employee') THEN true
      WHEN v_membership.role = 'employee' AND p_required_role = 'employee' THEN true
      ELSE false
    END;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_shop_and_actor(p_shop_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_shop_id uuid;
  v_actor_id uuid;
BEGIN
  -- Try JWT first
  v_user_id := NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub', '')::uuid;

  -- If no JWT, use provided user_id
  IF v_user_id IS NULL THEN
    v_user_id := p_user_id;
  END IF;

  -- Resolve tenant
  v_shop_id := COALESCE(
    current_shop_id(),
    resolve_tenant_for_user(v_user_id),
    p_shop_id
  );

  -- Resolve actor
  v_actor_id := COALESCE(
    v_user_id,
    p_created_by,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  RETURN jsonb_build_object(
    'shop_id', v_shop_id,
    'actor_id', v_actor_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._test_check_auth()
RETURNS TABLE(user_id uuid, is_admin boolean, phone text)
LANGUAGE sql
AS $function$
      SELECT
        app_current_user_id(),
        app_is_admin(),
        NULLIF(current_setting('request.jwt.claims', true), '')::json->>'phone';
    $function$;
