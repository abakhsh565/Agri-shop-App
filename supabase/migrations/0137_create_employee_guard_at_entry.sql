-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0137: the entry point carries the guard, not just its callee
-- ═══════════════════════════════════════════════════════════════════════════════
-- FOUND BY: tests/integration/rbacInvariants.test.ts → Invariant E
--   "every business write RPC carries an authorization guard"
--   → expected [ 'create_employee' ] to deeply equal []
--
--   Not a security hole (0135's wrapper only calls create_employee_core, which
--   authorizes internally), but the invariant exists precisely so that authority
--   is legible at the entry point rather than something you have to follow
--   through a call graph to confirm — and it caught the wrapper being the only
--   create_* function whose guard was invisible. Weakening the test with an
--   allowlist entry would have deleted that protection for every future wrapper,
--   so the function is fixed instead (the same shape 0134 gave create_sale, which
--   calls authorize_business_action itself).
--
--   It also does something the delegation did not: it resolves the tenant and then
--   ASSERTS the employee landed in it, so a change inside create_employee_core
--   cannot silently write a user into another tenant behind the guard.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_created jsonb;
  v_id uuid;
BEGIN
  -- Authorization at the entry point (employees.manage in the caller's tenant).
  v_tenant := authorize_business_action('employees.manage');

  v_created := public.create_employee_core(payload);
  v_id := (v_created->>'id')::uuid;

  -- Tenant context is resolved, not assumed: the row that was written must be in
  -- the tenant the guard just authorized.
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v_id AND u.shop_id = v_tenant) THEN
    RAISE EXCEPTION 'TENANT_CONTEXT_MISMATCH';
  END IF;

  -- Provisioning (0135) is tolerant by design: if it fails the employee is still
  -- invited and the owner can retry from the invitation card, rather than losing
  -- the record. The failure is recorded, never swallowed.
  BEGIN
    PERFORM public.provision_member_login(v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (app_current_user_id(), 'member_login_provision_failed', 'user', v_id,
            jsonb_build_object('reason', SQLERRM));
  END;

  RETURN v_created;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee(jsonb) FROM PUBLIC, anon;
