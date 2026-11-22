-- 0326 — The helpers the product writer calls actually exist.
--
-- THE DEFECT, MEASURED. On production, saving a product fails with
--
--     function public.authorize_tenant_membership() does not exist   (SQLSTATE 42883)
--
-- and, once that name exists, with `function public.is_trusted_context() does not exist` — the
-- next helper down the same chain. This fails EVERY product save, whether or not the
-- farmer-marketplace switch is ticked. The app maps any "does not exist" error to
-- "This item is no longer in your list", which is why the symptom read as a listing problem.
--
-- THE CHAIN. `create_product_with_classification` → `authorize_tenant_membership()` →
-- `create_product()` → `resolve_shop_and_actor()` + `authorize_business_action()` →
-- `is_trusted_context()`. `0293` and `0300` put the guard calls into re-issued RPC bodies, and
-- production received those bodies; the helpers themselves (`0112`/`0119`/`0149`) never reached
-- production's lineage. The writer is therefore stricter than the database it runs on.
--
-- WHAT THIS FILE DOES. It restates the two helpers that are *leaf* definitions — no newer body of
-- either exists anywhere in the chain, so replacing them cannot downgrade an environment —
-- exactly as `0119` and `0149` define them. It changes no table, column, policy or grant other
-- than the grants `0119` already gives `is_trusted_context`. It deliberately does NOT restate
-- `authorize_business_action`, `resolve_shop_and_actor` or `current_branch_id`: those have been
-- re-issued with newer bodies, and blindly replacing them on an environment that already has the
-- newer one would be a downgrade. The closing block reports every one of them that is still
-- missing, in one sentence, instead of failing on the first — a promotion that would only move
-- the failure one frame deeper is refused, and it says exactly what to fix.
--
-- WHY A FORWARD FILE AND NOT AN EDIT. `0119` and `0149` are recorded in every environment that
-- has them; a recorded migration is history and is never rewritten. Idempotent: on an
-- environment that already has both helpers this is a no-op that leaves the recorded bodies in
-- place.

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

COMMENT ON FUNCTION public.is_trusted_context() IS
  'True for a server-side/owner connection with no end-user JWT (migrations, psql) or a service_role caller. Re-issued here at its 0119 definition so an environment that never received it can run the business write RPCs.';

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

COMMENT ON FUNCTION public.authorize_tenant_membership(uuid) IS
  'The caller''s active tenant, or a refusal. Called first by the business write RPCs (0293, 0300) including the product writers; re-issued here at its 0149 definition so an environment that never received it can run those writers.';

-- One report, not one function per round trip. Every helper the product save resolves is named
-- here; anything absent is listed together so the next fix is a single file rather than a guess.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(n, ', ' ORDER BY n)
    INTO v_missing
    FROM unnest(ARRAY[
      'public.current_shop_id()',
      'public.app_current_user_id()',
      'public.is_trusted_context()',
      'public.authorize_tenant_membership(uuid)',
      'public.resolve_shop_and_actor(uuid,uuid,uuid)',
      'public.authorize_business_action(character varying,uuid,uuid)',
      'public.current_branch_id()',
      'public.resolve_product_classification(uuid,uuid)',
      'public.unit_group_for_base(text)'
    ]) AS n
   WHERE to_regprocedure(n) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0326: the product write path still needs: %', v_missing;
  END IF;

  IF to_regprocedure('public.authorize_tenant_membership(uuid)') IS NULL THEN
    RAISE EXCEPTION '0326: authorize_tenant_membership(uuid) did not resolve after creation';
  END IF;
  IF to_regprocedure('public.is_trusted_context()') IS NULL THEN
    RAISE EXCEPTION '0326: is_trusted_context() did not resolve after creation';
  END IF;
END;
$$;
