-- 0294 — The open shop policies carry the shop predicate.
--
-- WHY THIS EXISTS. shopScopedPolicyGuard requires that no permissive policy on a
-- table with shop_id has a literal-`true` predicate. 0241 deliberately created four
-- permissive SELECT policies with `USING (true)` — sales_read, purchases_read,
-- returns_read, stock_adjustments_read — because RLS denies by default when a command
-- has no permissive policy at all, and the restrictive permission gates and branch
-- policies were meant to do the filtering. That reasoning is sound about the need for
-- a permissive policy, but a `true` predicate is wider than the intent: the policy
-- says "every row in the table" and leaves the whole decision to the restrictive
-- side. The test is right to flag it.
--
-- WHAT THIS DOES. Replaces the four policies with the same names and the same
-- command, but with `USING (shop_id = public.current_shop_id())` instead of
-- `USING (true)`. The restrictive permission gates and branch policies are untouched
-- and still AND with this predicate. The other three `USING (true)` policies 0241
-- created (inventory_movements_read, customer_payments_read, supplier_payments_read)
-- are NOT touched: those tables have no shop_id column, so the guard does not flag
-- them, and changing them is out of scope.
--
-- WHY IT IS SAFE TO APPLY. The new predicate is exactly the tenant scope every
-- other policy on these tables already assumes: a session with no active shop reads
-- nothing (the restrictive gates already require a branch, which implies a shop),
-- and a session in a shop reads that shop's rows subject to the unchanged gates.
-- No app flow changes: the app reads these tables through the same sessions, and
-- the rows it could see before are the rows in its own shop.

DROP POLICY IF EXISTS sales_read ON public.sales;
CREATE POLICY sales_read ON public.sales FOR SELECT USING (shop_id = public.current_shop_id());

DROP POLICY IF EXISTS purchases_read ON public.purchases;
CREATE POLICY purchases_read ON public.purchases FOR SELECT USING (shop_id = public.current_shop_id());

DROP POLICY IF EXISTS returns_read ON public.returns;
CREATE POLICY returns_read ON public.returns FOR SELECT USING (shop_id = public.current_shop_id());

DROP POLICY IF EXISTS stock_adjustments_read ON public.stock_adjustments;
CREATE POLICY stock_adjustments_read ON public.stock_adjustments FOR SELECT USING (shop_id = public.current_shop_id());

NOTIFY pgrst, 'reload schema';

-- Assertion: none of the four policies still has a literal-true predicate.
DO $$
DECLARE
  v_open text[];
BEGIN
  SELECT array_agg(p.policyname ORDER BY p.policyname) INTO v_open
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.policyname IN ('sales_read', 'purchases_read', 'returns_read', 'stock_adjustments_read')
     AND p.cmd = 'SELECT'
     AND p.qual = 'true';
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION '0294: policies still open with USING (true): %', array_to_string(v_open, ', ');
  END IF;
END $$;
