-- 0151_child_read_write_policies_shop_scope.sql
--
-- The active-shop isolation guarantee was enforced for the parent tables (sales, products,
-- customers, companies) but not for the child/ledger tables. Each of purchases,
-- purchase_items, returns, return_items, sale_items, customer_payments, inventory_movements,
-- supplier_payments and voids carried a permissive policy — `USING (true)` or
-- `USING (app_is_admin())` — plus a branch policy that passes whenever
-- current_branch_scope() IS NULL. app_is_admin() answers "is the caller an owner/admin of
-- their ACTIVE shop", not "does this row belong to that shop", so any owner/admin could
-- read every shop's rows, and any authenticated user could insert rows attributed to
-- another shop.
--
-- Proven live on QA (2026-09-27), active shop = QA Shop B, all fixtures in Shop A:
--   * B dashboard "Credit collect" showed A's Rs. 850 customer payment (customer_payments)
--   * B purchases list rendered A's PUR-52995 (purchases, via fetchPurchases)
--   * B activity log rendered A's Rs. 850 payment (customer_payments)
--   * a direct client insert attached a Rs. 999 payment to A's customer while B was active
-- Business RPCs were already refused ("NOT_AUTHORIZED: tenant access denied") because they
-- authorize through authorize_business_action(); only the table layer was open.
--
-- Fix: scope every SELECT/INSERT policy on these tables to the active shop, deriving the
-- shop through the parent row where the table carries no shop_id of its own. Role gates that
-- existed (app_is_admin()) are preserved where they were present; branch scope, where the
-- table has branch_id, is folded into the same policy and keeps unbranched rows visible.

BEGIN;

-- ── purchases ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS purchases_select ON public.purchases;
DROP POLICY IF EXISTS purchases_branch_select ON public.purchases;
CREATE POLICY purchases_select ON public.purchases FOR SELECT
  USING (
    shop_id = current_shop_id()
    AND app_is_admin()
    AND (branch_id IS NULL OR current_branch_scope() IS NULL OR branch_id = ANY (current_branch_scope()))
  );

DROP POLICY IF EXISTS purchases_insert ON public.purchases;
CREATE POLICY purchases_insert ON public.purchases FOR INSERT
  WITH CHECK (shop_id = current_shop_id() AND app_is_admin());

-- ── purchase_items ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS purchase_items_select ON public.purchase_items;
CREATE POLICY purchase_items_select ON public.purchase_items FOR SELECT
  USING (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.purchases pu
      WHERE pu.id = purchase_items.purchase_id AND pu.shop_id = current_shop_id()
    )
  );

DROP POLICY IF EXISTS purchase_items_insert ON public.purchase_items;
CREATE POLICY purchase_items_insert ON public.purchase_items FOR INSERT
  WITH CHECK (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.purchases pu
      WHERE pu.id = purchase_items.purchase_id AND pu.shop_id = current_shop_id()
    )
  );

-- ── returns ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS returns_select ON public.returns;
DROP POLICY IF EXISTS returns_branch_select ON public.returns;
CREATE POLICY returns_select ON public.returns FOR SELECT
  USING (
    shop_id = current_shop_id()
    AND (branch_id IS NULL OR current_branch_scope() IS NULL OR branch_id = ANY (current_branch_scope()))
  );

DROP POLICY IF EXISTS returns_insert ON public.returns;
CREATE POLICY returns_insert ON public.returns FOR INSERT
  WITH CHECK (shop_id = current_shop_id());

-- ── return_items ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS return_items_select ON public.return_items;
CREATE POLICY return_items_select ON public.return_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.returns r
      WHERE r.id = return_items.return_id AND r.shop_id = current_shop_id()
    )
  );

DROP POLICY IF EXISTS return_items_insert ON public.return_items;
CREATE POLICY return_items_insert ON public.return_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.returns r
      WHERE r.id = return_items.return_id AND r.shop_id = current_shop_id()
    )
  );

-- ── sale_items ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id AND s.shop_id = current_shop_id()
    )
  );

DROP POLICY IF EXISTS sale_items_insert ON public.sale_items;
CREATE POLICY sale_items_insert ON public.sale_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id AND s.shop_id = current_shop_id()
    )
  );

-- ── customer_payments (no shop_id: scoped through the customer) ──────────────
DROP POLICY IF EXISTS customer_payments_select ON public.customer_payments;
DROP POLICY IF EXISTS customer_payments_branch_select ON public.customer_payments;
CREATE POLICY customer_payments_select ON public.customer_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_payments.customer_id AND c.shop_id = current_shop_id()
    )
    AND (branch_id IS NULL OR current_branch_scope() IS NULL OR branch_id = ANY (current_branch_scope()))
  );

DROP POLICY IF EXISTS customer_payments_insert ON public.customer_payments;
CREATE POLICY customer_payments_insert ON public.customer_payments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_payments.customer_id AND c.shop_id = current_shop_id()
    )
  );

-- ── inventory_movements (no shop_id: scoped through product / variant) ───────
DROP POLICY IF EXISTS inventory_movements_select ON public.inventory_movements;
DROP POLICY IF EXISTS inventory_movements_branch_select ON public.inventory_movements;
CREATE POLICY inventory_movements_select ON public.inventory_movements FOR SELECT
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = inventory_movements.product_id AND p.shop_id = current_shop_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
        WHERE pv.id = inventory_movements.variant_id AND p.shop_id = current_shop_id()
      )
    )
    AND (branch_id IS NULL OR current_branch_scope() IS NULL OR branch_id = ANY (current_branch_scope()))
  );

DROP POLICY IF EXISTS inventory_movements_insert ON public.inventory_movements;
CREATE POLICY inventory_movements_insert ON public.inventory_movements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = inventory_movements.product_id AND p.shop_id = current_shop_id()
    )
    OR EXISTS (
      SELECT 1 FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      WHERE pv.id = inventory_movements.variant_id AND p.shop_id = current_shop_id()
    )
  );

-- ── supplier_payments (no shop_id: scoped through the company) ──────────────
DROP POLICY IF EXISTS supplier_payments_select ON public.supplier_payments;
DROP POLICY IF EXISTS supplier_payments_branch_select ON public.supplier_payments;
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT
  USING (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.companies co
      WHERE co.id = supplier_payments.company_id AND co.shop_id = current_shop_id()
    )
    AND (branch_id IS NULL OR current_branch_scope() IS NULL OR branch_id = ANY (current_branch_scope()))
  );

DROP POLICY IF EXISTS supplier_payments_insert ON public.supplier_payments;
CREATE POLICY supplier_payments_insert ON public.supplier_payments FOR INSERT
  WITH CHECK (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.companies co
      WHERE co.id = supplier_payments.company_id AND co.shop_id = current_shop_id()
    )
  );

-- ── voids (no shop_id: scoped through the sale) ─────────────────────────────
DROP POLICY IF EXISTS voids_select ON public.voids;
CREATE POLICY voids_select ON public.voids FOR SELECT
  USING (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = voids.sale_id AND s.shop_id = current_shop_id()
    )
  );

DROP POLICY IF EXISTS voids_insert ON public.voids;
CREATE POLICY voids_insert ON public.voids FOR INSERT
  WITH CHECK (
    app_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = voids.sale_id AND s.shop_id = current_shop_id()
    )
  );

COMMIT;
