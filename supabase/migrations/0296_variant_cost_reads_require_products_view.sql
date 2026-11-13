-- 0296 — Reading a variant's cost requires products.view.
--
-- WHY THIS EXISTS. securityMatrix proves that a member WITHOUT products.view can
-- still read product_variants rows including cost_price: the test's ADMIN_NO_RIGHTS
-- member selects (id, cost_price) and gets rows back. The customers and companies
-- checks in the same file pass, because those tables have a RESTRICTIVE
-- `permission_read_gate` (0212) requiring has_effective_permission('<table>.view').
-- product_variants was simply never added to that loop: its live SELECT policy
-- (0212 product_variants_select) only requires the parent product to belong to the
-- caller's shop, with no permission check at all. Cost price is the owner's business
-- (0179); a member who may not view products must not read it through the variant.
--
-- WHAT THIS DOES. Adds the missing gate in exactly the 0212 shape:
-- a RESTRICTIVE `permission_read_gate` FOR SELECT on product_variants,
-- USING (current_branch_id() IS NOT NULL AND has_effective_permission('products.view')).
-- It ANDs with the existing permissive policies (product_variants_select,
-- product_variants_branch_select), so a row is visible only when the shop predicate,
-- the branch predicate AND the permission gate all pass.
--
-- WHY IT IS SAFE TO APPLY. The products table already carries the identical gate
-- with the same permission, and the app reads variants in the same sessions it reads
-- products in — every staff role that works with stock holds products.view, and the
-- owner holds every permission. INSERT/UPDATE gates are deliberately NOT added here:
-- variant writes go through RPCs, and the failing test is the SELECT cost read;
-- write gates are a separate hardening decision, not this fix.

DROP POLICY IF EXISTS permission_read_gate ON public.product_variants;
CREATE POLICY permission_read_gate ON public.product_variants AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (public.current_branch_id() IS NOT NULL AND public.has_effective_permission('products.view'::varchar));

NOTIFY pgrst, 'reload schema';

-- Assertion: the restrictive read gate exists and names products.view.
DO $$
DECLARE
  v_found integer;
BEGIN
  SELECT count(*) INTO v_found
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'product_variants'
     AND policyname = 'permission_read_gate'
     AND cmd = 'SELECT'
     AND qual LIKE '%products.view%';
  IF v_found <> 1 THEN
    RAISE EXCEPTION '0296: permission_read_gate on product_variants is missing or wrong';
  END IF;
END $$;
