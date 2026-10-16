-- 0175: a denial still denies.
--
-- WHAT BROKE
--   Migration 0165 ("actions happen in the active shop", 2026-09-29) replaced
--   `get_effective_permissions` with a body whose override query has no `is_granted` filter:
--
--     SELECT ... FROM user_permissions up
--      WHERE up.user_id = v_user_id AND up.is_override = true
--
--   `user_permissions.is_granted` was introduced by 0108 precisely to separate an explicit
--   grant (true) from an explicit denial (false) — the column carries that comment — and
--   0108/0147/0149 all honoured it with
--
--       ... AND up.is_granted = true      (additions)
--       EXCEPT ... AND up.is_granted = false   (removals)
--
--   The 0165 body drops both predicates, so every override row — including a denial — is
--   treated as an addition. Consequences, all reachable:
--     * an explicit denial no longer removes the permission from the role defaults, and
--     * a denial on a permission the role never had now *grants* it;
--     * `has_effective_permission` is `get_effective_permissions(p_user_id) ? p_code`, so this
--       is the enforcement path used by `authorize_business_action`, not just a display list;
--     * the "no active membership" gate is gone, so a pending invitation resolves overrides
--       and sees access before it is accepted;
--     * 'admin' lost the full-permission branch 0149 gave it ("the admin shell is built for
--       both"), so an admin membership is answered as if it were a narrowed employee role.
--
-- WHY THIS BODY AND NOT A NEW DESIGN
--   This restores the function exactly as 0149 (the active-shop source of truth) defined it —
--   it is already active-shop aware through `membership_in_active_shop`, which 0165 kept. No
--   new semantics are invented: the tests for the employee-override contract
--   (`employeeAccessOverrides`, `rbacFoundation`, `rbacEnforcement`) were written against this
--   behaviour and are red without it.
--
-- SCOPE
--   Applied to QA/staging first (this file). Production does not carry the membership/role
--   model yet, so this is not a production migration until the schema strategy decision says
--   how production is migrated forward.

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
