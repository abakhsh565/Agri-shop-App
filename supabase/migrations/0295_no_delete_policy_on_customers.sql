-- 0295 — No DELETE policy on customers at all.
--
-- WHY THIS EXISTS. Two tests require it from opposite directions. customerDeletionSecurity
-- requires ZERO policies with cmd='DELETE' on customers: a direct PostgREST DELETE must
-- reach zero rows, because deletion goes through the SECURITY DEFINER `archive_customer`
-- RPC (which carries authorize_business_action('customers.delete')) and never through
-- the table. securityAudit requires every DELETE policy on the six critical tables to
-- have qual='false' or not exist. Two policies on customers violate both:
--   * `co_owner_record_delete_customers` (0267, RESTRICTIVE FOR DELETE with
--     USING (co_owner_customer_visible(id))) — a restrictive policy grants nothing on
--     its own, and no permissive DELETE policy exists on customers, so it restricts
--     nothing; it exists in pg_policies as a DELETE policy and trips both tests.
--   * `customers_delete_anon` (0053, FOR DELETE USING (false)) — the demo-era
--     "block anon" shape. With no DELETE policy at all, RLS already denies every
--     DELETE for every role, so the false policy adds no protection; it only trips
--     the zero-DELETE-policies requirement.
-- The other five critical tables keep their `*_delete_anon` (qual='false') policies:
-- securityAudit blesses that shape and nothing else checks them.
--
-- WHAT THIS DOES. Drops both policies from customers. Nothing else changes.
--
-- WHY IT IS SAFE TO APPLY. No permissive DELETE policy exists on customers, so
-- dropping a restrictive DELETE policy and a false DELETE policy cannot grant a
-- delete to anyone: after this migration a direct DELETE matches zero rows for
-- every role, which is exactly what the tests assert and what `archive_customer`
-- already implements. `archive_customer` itself is untouched.

DROP POLICY IF EXISTS co_owner_record_delete_customers ON public.customers;
DROP POLICY IF EXISTS "customers_delete_anon" ON public.customers;

NOTIFY pgrst, 'reload schema';

-- Assertion: customers has no DELETE policy of any kind left.
DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*) INTO v_left
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'customers' AND cmd = 'DELETE';
  IF v_left > 0 THEN
    RAISE EXCEPTION '0295: % DELETE polic(ies) still on customers', v_left;
  END IF;
END $$;
