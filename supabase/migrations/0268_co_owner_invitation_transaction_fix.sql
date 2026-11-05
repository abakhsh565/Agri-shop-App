-- 0268 — repair the invitation/revocation membership transition.
--
-- 0266 wrote branch_scope = '{}' into the membership before the grant's branch
-- scope rows existed. validate_member_branch_scope correctly rejects an empty
-- employee scope, so a brand-new Co-Owner invitation (and a revocation) could
-- fail. The selected branches are written by co_owner_sync_membership after the
-- grant and scope rows exist; the invitation must not pre-empt it.

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.create_co_owner_invitation(jsonb)'::regprocedure)
    INTO v_definition;
  IF position('branch_scope = ''{}''::uuid[], status = ''pending''' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'branch_scope = ''{}''::uuid[], status = ''pending''',
      'status = ''pending'''
    );
    EXECUTE v_definition;
  ELSIF position('branch_scope = ''{}''::uuid[]' IN v_definition) > 0 THEN
    RAISE EXCEPTION '0268: unexpected create_co_owner_invitation body';
  END IF;
END $$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.revoke_co_owner(uuid,text)'::regprocedure)
    INTO v_definition;
  IF position('branch_scope = ''{}''::uuid[], status = ''suspended''' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'branch_scope = ''{}''::uuid[], status = ''suspended''',
      'status = ''suspended'''
    );
    EXECUTE v_definition;
  ELSIF position('branch_scope = ''{}''::uuid[]' IN v_definition) > 0 THEN
    RAISE EXCEPTION '0268: unexpected revoke_co_owner body';
  END IF;
END $$;

-- A closed Co-Owner grant is a real state. The empty scope is not an employee
-- assignment error: every branch predicate still denies it, and the grant's
-- explicit scope settings remain the authority.
CREATE OR REPLACE FUNCTION public.validate_member_branch_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.branch_scope IS NOT DISTINCT FROM OLD.branch_scope
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'owner' THEN RETURN NEW; END IF;
  IF NEW.access_kind = 'co_owner'
     AND (NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.branches WHERE tenant_id = NEW.tenant_id
    AND id = ANY(COALESCE(NEW.branch_scope, '{}'::uuid[])) ORDER BY id FOR SHARE;
  IF TG_OP = 'INSERT' AND NEW.branch_scope IS NULL THEN RETURN NEW; END IF;
  IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (
    SELECT 1 FROM unnest(NEW.branch_scope) x WHERE x IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.branches b WHERE b.id = x AND b.tenant_id = NEW.tenant_id AND b.is_active
    )
  ) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: explicit branches are required'; END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
