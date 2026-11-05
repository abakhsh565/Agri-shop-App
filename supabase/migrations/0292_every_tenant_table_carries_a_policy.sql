-- 0292 — Every tenant table carries at least one policy.
--
-- WHY THIS EXISTS. rbacInvariants Invariant A requires every RLS-enabled table to
-- have at least one policy. Ten tables have RLS enabled and zero policies: the three
-- branch registries (company_branches, customer_branches, product_branches, 0240/0241),
-- employee_access_requests (0243), the finance ledger family (finance_entries 0254,
-- finance_recurrences 0255, payment_reminders 0256, finance_attachments and
-- finance_entry_history 0261) and membership_branch_roles (0233). With zero policies
-- RLS denies every direct read, so the tables are reachable only through SECURITY
-- DEFINER RPCs — which is why the app works — but the invariant exists precisely so
-- a table is never one careless grant away from being wide open, and so the intended
-- read shape is written down where the database enforces it.
--
-- WHAT THIS DOES. Adds ONE SELECT policy per table, tenant-scoped, following the
-- existing policy style (shop predicate first; the permission gate the read RPCs
-- already enforce, second):
--   * the three registries: the parent entity must belong to the caller's shop;
--   * finance_entries, finance_attachments, finance_entry_history,
--     finance_recurrences, payment_reminders: shop_id = current_shop_id() AND the
--     caller holds payments.view (the same permission the read RPCs and the app's
--     Payments route already require);
--   * employee_access_requests and membership_branch_roles: shop-scoped AND the
--     caller holds employees.manage (the same permission the list/get RPCs and the
--     access editor already require).
-- Writes stay RPC/trigger-only: no INSERT/UPDATE/DELETE policy is added, so a direct
-- client write is still denied exactly as before.
--
-- WHY IT IS SAFE TO APPLY. SELECT-only policies cannot grant a write. The predicates
-- reuse the helpers the rest of the schema already calls inside policies
-- (current_shop_id, has_effective_permission — the 0212 permission gates prove the
-- shape). The app reads all ten tables through SECURITY DEFINER RPCs, which bypass
-- RLS, so no app flow changes: the policies only decide what a direct PostgREST
-- read may see, and that is now "its own shop, with the permission the feature
-- already requires" instead of "nothing".

DROP POLICY IF EXISTS company_branches_select ON public.company_branches;
CREATE POLICY company_branches_select ON public.company_branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.companies c
       WHERE c.id = company_branches.company_id
         AND c.shop_id = public.current_shop_id()
    )
  );

DROP POLICY IF EXISTS customer_branches_select ON public.customer_branches;
CREATE POLICY customer_branches_select ON public.customer_branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
       WHERE c.id = customer_branches.customer_id
         AND c.shop_id = public.current_shop_id()
    )
  );

DROP POLICY IF EXISTS product_branches_select ON public.product_branches;
CREATE POLICY product_branches_select ON public.product_branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products p
       WHERE p.id = product_branches.product_id
         AND p.shop_id = public.current_shop_id()
    )
  );

DROP POLICY IF EXISTS employee_access_requests_select ON public.employee_access_requests;
CREATE POLICY employee_access_requests_select ON public.employee_access_requests
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('employees.manage')
  );

DROP POLICY IF EXISTS finance_entries_select ON public.finance_entries;
CREATE POLICY finance_entries_select ON public.finance_entries
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('payments.view')
  );

DROP POLICY IF EXISTS finance_attachments_select ON public.finance_attachments;
CREATE POLICY finance_attachments_select ON public.finance_attachments
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('payments.view')
  );

DROP POLICY IF EXISTS finance_entry_history_select ON public.finance_entry_history;
CREATE POLICY finance_entry_history_select ON public.finance_entry_history
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('payments.view')
  );

DROP POLICY IF EXISTS finance_recurrences_select ON public.finance_recurrences;
CREATE POLICY finance_recurrences_select ON public.finance_recurrences
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('payments.view')
  );

DROP POLICY IF EXISTS membership_branch_roles_select ON public.membership_branch_roles;
CREATE POLICY membership_branch_roles_select ON public.membership_branch_roles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.id = membership_branch_roles.membership_id
         AND m.tenant_id = public.current_shop_id()
    )
    AND public.has_effective_permission('employees.manage')
  );

DROP POLICY IF EXISTS payment_reminders_select ON public.payment_reminders;
CREATE POLICY payment_reminders_select ON public.payment_reminders
  FOR SELECT TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.has_effective_permission('payments.view')
  );

NOTIFY pgrst, 'reload schema';

-- Assertion: each of the ten tables now has at least one policy (Invariant A).
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(t.tablename ORDER BY t.tablename) INTO v_missing
    FROM (
      VALUES ('company_branches'), ('customer_branches'), ('product_branches'),
             ('employee_access_requests'), ('finance_entries'), ('finance_attachments'),
             ('finance_entry_history'), ('finance_recurrences'),
             ('membership_branch_roles'), ('payment_reminders')
    ) AS t(tablename)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tablename
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '0292: tables still without any policy: %', array_to_string(v_missing, ', ');
  END IF;
END $$;
