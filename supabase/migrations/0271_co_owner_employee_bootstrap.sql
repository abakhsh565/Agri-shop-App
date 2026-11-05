-- 0271 — allow the bootstrap membership while creating an employee for a Co-Owner.
--
-- ensure_user_membership() runs after the users INSERT and creates a membership
-- with a NULL scope. create_employee_core() then sets the requested branch and
-- role in the same transaction. The guard must not reject that transient row;
-- the follow-up UPDATE is still fully checked. If it never happens, the NULL
-- scope grants no branch access.
DO $$
DECLARE
  v_definition text;
  v_anchor text := 'IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (';
  v_replacement text := 'IF TG_OP = ''INSERT'' AND NEW.branch_scope IS NULL AND NEW.status = ''active'' THEN
      RETURN NEW;
    END IF;
    IF NEW.branch_scope IS NULL OR cardinality(NEW.branch_scope) = 0 OR EXISTS (';
BEGIN
  SELECT pg_get_functiondef('public.guard_co_owner_membership_write()'::regprocedure)
    INTO v_definition;
  IF position('TG_OP = ''INSERT'' AND NEW.branch_scope IS NULL' IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION '0271: unexpected membership guard body';
  END IF;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_definition;
END $$;

NOTIFY pgrst, 'reload schema';
