-- ═══════════════════════════════════════════════════════════════════════════════
-- 0242 — The other branch surfaces close
--
-- 0241 put the branch filter on the parent rows (sales, purchases, returns,
-- payments) and made the permission gates restrictive. Reading the policy catalog
-- afterwards showed what the parent filter does not cover:
--
--   • `sale_items`, `purchase_items`, `return_items` and `voids` still carried a
--     shop-wide SELECT policy, so the child rows of another branch's document
--     were readable even when the document itself was not;
--   • those tables (and the payment tables) kept an open `{public}` INSERT policy
--     with no check, which is an OR-ed policy and therefore bypassed the
--     permission gate beside it;
--   • `users` was readable and updatable by every member of the shop, so any
--     employee could list and edit every account in the business;
--   • `customers.outstanding_balance` / `companies.outstanding_payable` are
--     still shop-wide columns. A customer with activity in two branches showed
--     the combined debt in each. The rows are now branch-scoped; the money on
--     them was not.
--
-- Each fix is at the layer that owns the rule: RLS for rows, a helper for the
-- staff directory, and a read function for money that is derived from the
-- branch's own documents.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Child rows follow the document's branch ───────────────────────────────
DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.id = sale_items.sale_id
         AND s.shop_id = public.current_shop_id()
         AND s.branch_id = public.current_branch_id()
    )
  );
DROP POLICY IF EXISTS sale_items_insert ON public.sale_items;

DROP POLICY IF EXISTS purchase_items_select ON public.purchase_items;
CREATE POLICY purchase_items_select ON public.purchase_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
       WHERE p.id = purchase_items.purchase_id
         AND p.shop_id = public.current_shop_id()
         AND p.branch_id = public.current_branch_id()
    )
  );
DROP POLICY IF EXISTS purchase_items_insert ON public.purchase_items;

DROP POLICY IF EXISTS return_items_select ON public.return_items;
CREATE POLICY return_items_select ON public.return_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.returns r
       WHERE r.id = return_items.return_id
         AND r.shop_id = public.current_shop_id()
         AND r.branch_id = public.current_branch_id()
    )
  );
DROP POLICY IF EXISTS return_items_insert ON public.return_items;

DROP POLICY IF EXISTS voids_select ON public.voids;
CREATE POLICY voids_select ON public.voids
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.id = voids.sale_id
         AND s.shop_id = public.current_shop_id()
         AND s.branch_id = public.current_branch_id()
    )
  );
DROP POLICY IF EXISTS voids_insert ON public.voids;

-- ── 1b. Reminders belong to the customer's branch ─────────────────────────
-- A reminder is about one customer, and that customer is visible in a branch
-- because they bought, paid or returned there (0241). The tables were still
-- shop-wide, so a direct read could list every branch's reminder schedule and
-- every sent message. The customer's branch association is the boundary.
DROP POLICY IF EXISTS reminder_configs_select ON public.reminder_configs;
DROP POLICY IF EXISTS reminder_configs_insert ON public.reminder_configs;
DROP POLICY IF EXISTS reminder_configs_update ON public.reminder_configs;
DROP POLICY IF EXISTS reminder_configs_delete ON public.reminder_configs;
DROP POLICY IF EXISTS reminder_configs_branch ON public.reminder_configs;
CREATE POLICY reminder_configs_branch ON public.reminder_configs
  FOR ALL TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.customer_in_branch(customer_id)
  )
  WITH CHECK (
    shop_id = public.current_shop_id()
    AND public.customer_in_branch(customer_id)
  );

DROP POLICY IF EXISTS reminder_occurrences_all ON public.reminder_occurrences;
DROP POLICY IF EXISTS reminder_occurrences_branch ON public.reminder_occurrences;
CREATE POLICY reminder_occurrences_branch ON public.reminder_occurrences
  FOR ALL TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND public.customer_in_branch(customer_id)
  )
  WITH CHECK (
    shop_id = public.current_shop_id()
    AND public.customer_in_branch(customer_id)
  );

DROP POLICY IF EXISTS reminder_logs_all ON public.reminder_logs;
DROP POLICY IF EXISTS reminder_logs_branch ON public.reminder_logs;
CREATE POLICY reminder_logs_branch ON public.reminder_logs
  FOR ALL TO authenticated
  USING (
    shop_id = public.current_shop_id()
    AND (
      (config_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.reminder_configs rc
         WHERE rc.id = reminder_logs.config_id
           AND rc.shop_id = public.current_shop_id()
           AND public.customer_in_branch(rc.customer_id)
      ))
      OR (occurrence_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.reminder_occurrences ro
         WHERE ro.id = reminder_logs.occurrence_id
           AND ro.shop_id = public.current_shop_id()
           AND public.customer_in_branch(ro.customer_id)
      ))
    )
  )
  WITH CHECK (
    shop_id = public.current_shop_id()
    AND (
      (config_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.reminder_configs rc
         WHERE rc.id = reminder_logs.config_id
           AND rc.shop_id = public.current_shop_id()
           AND public.customer_in_branch(rc.customer_id)
      ))
      OR (occurrence_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.reminder_occurrences ro
         WHERE ro.id = reminder_logs.occurrence_id
           AND ro.shop_id = public.current_shop_id()
           AND public.customer_in_branch(ro.customer_id)
      ))
    )
  );

-- ── 2. The open write doors ──────────────────────────────────────────────────
-- Each table already has a restrictive `permission_insert_gate` where a direct
-- insert is a legitimate path. Dropping the open policy leaves that gate as the
-- only insert rule. The tables whose writes belong to a definer RPC keep no
-- INSERT policy at all — the RPC continues to work, a direct client insert does
-- not. A restrictive gate with no permissive policy denies by default, which is
-- the fail-closed answer.
DROP POLICY IF EXISTS customer_payments_insert ON public.customer_payments;
DROP POLICY IF EXISTS supplier_payments_insert ON public.supplier_payments;
DROP POLICY IF EXISTS purchases_insert ON public.purchases;
DROP POLICY IF EXISTS returns_insert ON public.returns;
DROP POLICY IF EXISTS inventory_movements_insert ON public.inventory_movements;

-- ── 3. The staff directory ───────────────────────────────────────────────────
-- An owner may read every account in the business. An employee may read their
-- own row and the people who share one of their branches; missing scope grants
-- nobody. The helper is definer because the policy it is used by would otherwise
-- recurse into `memberships` RLS (`memberships_select_own`).
CREATE OR REPLACE FUNCTION public.app_can_read_user(p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
     WHERE u.id = p_user AND u.shop_id = public.current_shop_id()
  )
  AND (
    public.app_is_admin()
    OR p_user = public.app_current_user_id()
    OR EXISTS (
      SELECT 1
        FROM public.memberships me
        JOIN public.membership_branch_roles my_branch
          ON my_branch.membership_id = me.id
        JOIN public.membership_branch_roles their_branch
          ON their_branch.branch_id = my_branch.branch_id
        JOIN public.memberships them
          ON them.id = their_branch.membership_id
       WHERE me.user_id = public.app_current_user_id()
         AND me.tenant_id = public.current_shop_id()
         AND me.status = 'active'
         AND them.user_id = p_user
         AND them.tenant_id = public.current_shop_id()
         AND them.status = 'active'
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.app_can_read_user(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.app_can_read_user(uuid) FROM PUBLIC, anon;

DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated USING (public.app_can_read_user(id));

DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.app_is_admin() OR id = public.app_current_user_id())
  WITH CHECK (
    public.current_shop_id() IS NOT NULL
    AND shop_id = public.current_shop_id()
    AND (public.app_is_admin() OR id = public.app_current_user_id())
  );

DROP POLICY IF EXISTS users_insert ON public.users;
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.app_is_admin() AND shop_id = public.current_shop_id());

-- A self-update is for the person's own profile, not for their authority. RLS
-- cannot compare OLD and NEW, so the column rule lives in a trigger.
CREATE OR REPLACE FUNCTION public.guard_user_privileged_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.app_is_admin() THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
     OR NEW.is_original_owner IS DISTINCT FROM OLD.is_original_owner
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: those account fields belong to the owner';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_user_privileged_columns_trg ON public.users;
CREATE TRIGGER guard_user_privileged_columns_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_privileged_columns();

-- ── 4. Money derived from this branch's own documents ────────────────────────
-- The customer row keeps the shop-wide columns for history; what the app shows
-- and what a credit check uses comes from this branch. One row per customer the
-- branch can see, so a customer created here with no activity is present at 0.
CREATE OR REPLACE FUNCTION public.get_branch_customer_balances()
RETURNS TABLE (
  customer_id uuid,
  total_purchases numeric,
  total_paid numeric,
  outstanding_balance numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH b AS (SELECT public.current_branch_id() AS id),
  sold AS (
    SELECT s.customer_id, sum(s.total_amount) AS total, sum(s.amount_paid) AS paid
      FROM public.sales s, b
     WHERE s.shop_id = public.current_shop_id()
       AND s.branch_id = b.id
       AND s.is_voided = false
       AND s.customer_id IS NOT NULL
     GROUP BY s.customer_id
  ),
  refunded AS (
    SELECT r.customer_id,
           sum(COALESCE(r.total_refund, r.refund_amount, 0)) AS amount
      FROM public.returns r, b
     WHERE r.shop_id = public.current_shop_id()
       AND r.branch_id = b.id
       AND r.customer_id IS NOT NULL
     GROUP BY r.customer_id
  ),
  collected AS (
    SELECT p.customer_id, sum(p.amount) AS amount
      FROM public.customer_payments p
      JOIN public.customers c ON c.id = p.customer_id
      JOIN b ON b.id = p.branch_id
     WHERE c.shop_id = public.current_shop_id()
       AND p.customer_id IS NOT NULL
     GROUP BY p.customer_id
  )
  SELECT c.id,
         GREATEST(COALESCE(s.total, 0) - COALESCE(r.amount, 0), 0),
         COALESCE(s.paid, 0) + COALESCE(p.amount, 0),
         GREATEST(
           COALESCE(s.total, 0) - COALESCE(r.amount, 0)
           - COALESCE(s.paid, 0) - COALESCE(p.amount, 0),
           0
         )
    FROM public.customers c
    LEFT JOIN sold s ON s.customer_id = c.id
    LEFT JOIN refunded r ON r.customer_id = c.id
    LEFT JOIN collected p ON p.customer_id = c.id
   WHERE c.shop_id = public.current_shop_id()
     AND c.is_archived = false
     AND public.customer_in_branch(c.id);
$$;
GRANT EXECUTE ON FUNCTION public.get_branch_customer_balances() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_customer_balances() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.get_branch_company_balances()
RETURNS TABLE (
  company_id uuid,
  total_purchases numeric,
  total_paid numeric,
  outstanding_payable numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH b AS (SELECT public.current_branch_id() AS id),
  bought AS (
    SELECT p.company_id, sum(p.total_amount) AS total, sum(p.amount_paid) AS paid
      FROM public.purchases p, b
     WHERE p.shop_id = public.current_shop_id()
       AND p.branch_id = b.id
       AND p.status <> 'cancelled'
       AND p.company_id IS NOT NULL
     GROUP BY p.company_id
  ),
  paid AS (
    SELECT p.company_id, sum(p.amount) AS amount
      FROM public.supplier_payments p
      JOIN public.companies c ON c.id = p.company_id
      JOIN b ON b.id = p.branch_id
     WHERE c.shop_id = public.current_shop_id()
       AND p.company_id IS NOT NULL
     GROUP BY p.company_id
  )
  SELECT c.id,
         COALESCE(bought.total, 0),
         COALESCE(bought.paid, 0) + COALESCE(paid.amount, 0),
         GREATEST(
           COALESCE(bought.total, 0)
           - COALESCE(bought.paid, 0) - COALESCE(paid.amount, 0),
           0
         )
    FROM public.companies c
    LEFT JOIN bought ON bought.company_id = c.id
    LEFT JOIN paid ON paid.company_id = c.id
   WHERE c.shop_id = public.current_shop_id()
     AND c.is_active = true
     AND public.company_in_branch(c.id);
$$;
GRANT EXECUTE ON FUNCTION public.get_branch_company_balances() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_company_balances() FROM PUBLIC, anon;

-- ── 5. The roster the branch card counts ─────────────────────────────────────
-- The same population as `get_my_branches().employee_count`, so the Employees
-- screen and the card can never disagree again: explicitly scoped people count
-- at their branch, and people the roster scopes nowhere sit on the main branch.
CREATE OR REPLACE FUNCTION public.get_branch_employee_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH b AS (SELECT public.current_branch_id() AS id),
  main_branch AS (
    SELECT br.id FROM public.branches br
     WHERE br.tenant_id = public.current_shop_id() AND br.is_active
     ORDER BY br.is_default DESC, br.created_at, br.id
     LIMIT 1
  ),
  scoped_anywhere AS (
    SELECT DISTINCT m.user_id
      FROM public.memberships m
     WHERE m.tenant_id = public.current_shop_id()
       AND m.status = 'active'
       AND cardinality(COALESCE(m.branch_scope, '{}'::uuid[])) > 0
  )
  SELECT m.user_id
    FROM public.memberships m, b
   WHERE m.tenant_id = public.current_shop_id()
     AND m.status = 'active'
     AND (
       b.id = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
       OR (
         b.id = (SELECT id FROM main_branch)
         AND NOT EXISTS (SELECT 1 FROM scoped_anywhere s WHERE s.user_id = m.user_id)
       )
     );
$$;
GRANT EXECUTE ON FUNCTION public.get_branch_employee_ids() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_employee_ids() FROM PUBLIC, anon;

-- ── 6. The trigger function is not part of the API ─────────────────────────
-- `guard_branch_stock_movement` is a trigger body: it is invoked by the table,
-- never by a client. 0239 closed it to PUBLIC and anon, but a function created
-- after the default-privilege reset is not granted to `authenticated` either, and
-- the ledger records it as server-only. Name it here, the way 0217/0226/0229 name
-- the other retired functions, and prove the closure rather than assume it.
DO $server_only$
DECLARE
  v_server_only constant text[] := array['guard_branch_stock_movement'];
  v_name text;
  v_open int;
BEGIN
  IF to_regprocedure('public.guard_branch_stock_movement()') IS NULL THEN
    RAISE EXCEPTION '0242: the branch movement guard is missing';
  END IF;
  FOREACH v_name IN ARRAY v_server_only LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', v_name);
  END LOOP;
  SELECT count(*) INTO v_open
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (v_server_only)
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_open > 0 THEN
    RAISE EXCEPTION '0242: % trigger function(s) are still executable by authenticated', v_open;
  END IF;
  RAISE NOTICE '0242: the branch movement guard is server-only';
END
$server_only$;

-- ── 7. Assert the shape ──────────────────────────────────────────────────────
DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'sale_items'
       AND policyname = 'sale_items_select'
  ) THEN
    RAISE EXCEPTION '0242: sale_items has no branch read policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN (
       'sale_items', 'purchase_items', 'return_items', 'voids',
       'purchases', 'returns', 'customer_payments', 'supplier_payments',
       'inventory_movements'
     )
       AND policyname IN (
         'sale_items_insert', 'purchase_items_insert', 'return_items_insert',
         'voids_insert', 'purchases_insert', 'returns_insert',
         'customer_payments_insert', 'supplier_payments_insert',
         'inventory_movements_insert'
       )
  ) THEN
    RAISE EXCEPTION '0242: an open insert policy survived';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_branch_customer_balances'
  ) THEN
    RAISE EXCEPTION '0242: branch customer balances are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_branch_employee_ids'
  ) THEN
    RAISE EXCEPTION '0242: the branch roster read is missing';
  END IF;
END
$assert$;
