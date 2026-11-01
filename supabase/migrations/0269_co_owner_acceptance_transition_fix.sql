-- 0269 — acceptance moves the grant to active before syncing the membership.
--
-- The membership guard already requires that the caller is activating their own
-- invitation. It must therefore accept a grant in the `active` state during that
-- same transition, otherwise accept_co_owner_invitation() can never complete.
DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.guard_co_owner_membership_write()'::regprocedure)
    INTO v_definition;
  IF position('AND g.status = ''invited''' IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      'AND g.status = ''invited''',
      'AND g.status IN (''invited'', ''active'')'
    );
    EXECUTE v_definition;
  ELSIF position('AND g.status IN (''invited'', ''active'')' IN v_definition) = 0 THEN
    RAISE EXCEPTION '0269: unexpected membership guard body';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
