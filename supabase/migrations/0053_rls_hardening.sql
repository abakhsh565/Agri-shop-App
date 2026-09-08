-- ============================================================
-- Migration 0053: RLS Hardening — Prevent Direct Anon Writes
--
-- PROBLEM: Anon key has INSERT/UPDATE/DELETE access to:
--   - customers (CRITICAL)
--   - companies (CRITICAL)
--   - products (CRITICAL)
--
-- SOLUTION: Add RLS policies that:
--   - Allow anon SELECT (app needs to read data)
--   - Block anon INSERT/UPDATE/DELETE (writes go through RPCs)
--
-- All legitimate writes use SECURITY DEFINER RPCs which bypass RLS.
-- ============================================================

-- ── 1. customers ─────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Allow anon to read customers
DROP POLICY IF EXISTS "customers_select_anon" ON customers;
CREATE POLICY "customers_select_anon" ON customers
  FOR SELECT USING (true);

-- Block anon INSERT — must use RPC
DROP POLICY IF EXISTS "customers_insert_anon" ON customers;
CREATE POLICY "customers_insert_anon" ON customers
  FOR INSERT WITH CHECK (false);

-- Block anon UPDATE — must use RPC
DROP POLICY IF EXISTS "customers_update_anon" ON customers;
CREATE POLICY "customers_update_anon" ON customers
  FOR UPDATE USING (false);

-- Block anon DELETE — must use RPC/archive
DROP POLICY IF EXISTS "customers_delete_anon" ON customers;
CREATE POLICY "customers_delete_anon" ON customers
  FOR DELETE USING (false);

-- ── 2. companies ─────────────────────────────────────────────
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select_anon" ON companies;
CREATE POLICY "companies_select_anon" ON companies
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "companies_insert_anon" ON companies;
CREATE POLICY "companies_insert_anon" ON companies
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "companies_update_anon" ON companies;
CREATE POLICY "companies_update_anon" ON companies
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "companies_delete_anon" ON companies;
CREATE POLICY "companies_delete_anon" ON companies
  FOR DELETE USING (false);

-- ── 3. products ──────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_select_anon" ON products;
CREATE POLICY "products_select_anon" ON products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "products_insert_anon" ON products;
CREATE POLICY "products_insert_anon" ON products
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "products_update_anon" ON products;
CREATE POLICY "products_update_anon" ON products
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "products_delete_anon" ON products;
CREATE POLICY "products_delete_anon" ON products
  FOR DELETE USING (false);

-- ── 4. product_variants ──────────────────────────────────────
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variants_select_anon" ON product_variants;
CREATE POLICY "product_variants_select_anon" ON product_variants
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "product_variants_insert_anon" ON product_variants;
CREATE POLICY "product_variants_insert_anon" ON product_variants
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "product_variants_update_anon" ON product_variants;
CREATE POLICY "product_variants_update_anon" ON product_variants
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "product_variants_delete_anon" ON product_variants;
CREATE POLICY "product_variants_delete_anon" ON product_variants
  FOR DELETE USING (false);

-- ── 5. sales ─────────────────────────────────────────────────
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_select_anon" ON sales;
CREATE POLICY "sales_select_anon" ON sales
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "sales_insert_anon" ON sales;
CREATE POLICY "sales_insert_anon" ON sales
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "sales_update_anon" ON sales;
CREATE POLICY "sales_update_anon" ON sales
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "sales_delete_anon" ON sales;
CREATE POLICY "sales_delete_anon" ON sales
  FOR DELETE USING (false);

-- ── 6. sale_items ────────────────────────────────────────────
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_items_select_anon" ON sale_items;
CREATE POLICY "sale_items_select_anon" ON sale_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "sale_items_insert_anon" ON sale_items;
CREATE POLICY "sale_items_insert_anon" ON sale_items
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "sale_items_update_anon" ON sale_items;
CREATE POLICY "sale_items_update_anon" ON sale_items
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "sale_items_delete_anon" ON sale_items;
CREATE POLICY "sale_items_delete_anon" ON sale_items
  FOR DELETE USING (false);

-- ── 7. returns ───────────────────────────────────────────────
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "returns_select_anon" ON returns;
CREATE POLICY "returns_select_anon" ON returns
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "returns_insert_anon" ON returns;
CREATE POLICY "returns_insert_anon" ON returns
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "returns_update_anon" ON returns;
CREATE POLICY "returns_update_anon" ON returns
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "returns_delete_anon" ON returns;
CREATE POLICY "returns_delete_anon" ON returns
  FOR DELETE USING (false);

-- ── 8. return_items ──────────────────────────────────────────
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "return_items_select_anon" ON return_items;
CREATE POLICY "return_items_select_anon" ON return_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "return_items_insert_anon" ON return_items;
CREATE POLICY "return_items_insert_anon" ON return_items
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "return_items_update_anon" ON return_items;
CREATE POLICY "return_items_update_anon" ON return_items
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "return_items_delete_anon" ON return_items;
CREATE POLICY "return_items_delete_anon" ON return_items
  FOR DELETE USING (false);

-- ── 9. voids ─────────────────────────────────────────────────
ALTER TABLE voids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voids_select_anon" ON voids;
CREATE POLICY "voids_select_anon" ON voids
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "voids_insert_anon" ON voids;
CREATE POLICY "voids_insert_anon" ON voids
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "voids_update_anon" ON voids;
CREATE POLICY "voids_update_anon" ON voids
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "voids_delete_anon" ON voids;
CREATE POLICY "voids_delete_anon" ON voids
  FOR DELETE USING (false);

-- ── 10. purchases ────────────────────────────────────────────
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchases_select_anon" ON purchases;
CREATE POLICY "purchases_select_anon" ON purchases
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "purchases_insert_anon" ON purchases;
CREATE POLICY "purchases_insert_anon" ON purchases
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "purchases_update_anon" ON purchases;
CREATE POLICY "purchases_update_anon" ON purchases
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "purchases_delete_anon" ON purchases;
CREATE POLICY "purchases_delete_anon" ON purchases
  FOR DELETE USING (false);

-- ── 11. purchase_items ───────────────────────────────────────
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_items_select_anon" ON purchase_items;
CREATE POLICY "purchase_items_select_anon" ON purchase_items
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "purchase_items_insert_anon" ON purchase_items;
CREATE POLICY "purchase_items_insert_anon" ON purchase_items
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "purchase_items_update_anon" ON purchase_items;
CREATE POLICY "purchase_items_update_anon" ON purchase_items
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "purchase_items_delete_anon" ON purchase_items;
CREATE POLICY "purchase_items_delete_anon" ON purchase_items
  FOR DELETE USING (false);

-- ── 12. supplier_payments ────────────────────────────────────
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "supplier_payments_select_anon" ON supplier_payments;
CREATE POLICY "supplier_payments_select_anon" ON supplier_payments
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "supplier_payments_insert_anon" ON supplier_payments;
CREATE POLICY "supplier_payments_insert_anon" ON supplier_payments
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "supplier_payments_update_anon" ON supplier_payments;
CREATE POLICY "supplier_payments_update_anon" ON supplier_payments
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "supplier_payments_delete_anon" ON supplier_payments;
CREATE POLICY "supplier_payments_delete_anon" ON supplier_payments
  FOR DELETE USING (false);

-- ── 13. inventory_movements ──────────────────────────────────
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_movements_select_anon" ON inventory_movements;
CREATE POLICY "inventory_movements_select_anon" ON inventory_movements
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "inventory_movements_insert_anon" ON inventory_movements;
CREATE POLICY "inventory_movements_insert_anon" ON inventory_movements
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "inventory_movements_update_anon" ON inventory_movements;
CREATE POLICY "inventory_movements_update_anon" ON inventory_movements
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS "inventory_movements_delete_anon" ON inventory_movements;
CREATE POLICY "inventory_movements_delete_anon" ON inventory_movements
  FOR DELETE USING (false);

-- ── 14. stock_adjustments ────────────────────────────────────
-- Already has RLS, but ensure consistent policies
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_adjustments_select_anon" ON stock_adjustments;
CREATE POLICY "stock_adjustments_select_anon" ON stock_adjustments
  FOR SELECT USING (true);

-- ── 15. customer_crops ───────────────────────────────────────
ALTER TABLE customer_crops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_crops_select_anon" ON customer_crops;
CREATE POLICY "customer_crops_select_anon" ON customer_crops
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "customer_crops_insert_anon" ON customer_crops;
CREATE POLICY "customer_crops_insert_anon" ON customer_crops
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "customer_crops_delete_anon" ON customer_crops;
CREATE POLICY "customer_crops_delete_anon" ON customer_crops
  FOR DELETE USING (false);

-- ── 16. reminder_occurrences ─────────────────────────────────
ALTER TABLE reminder_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reminder_occurrences_select_anon" ON reminder_occurrences;
CREATE POLICY "reminder_occurrences_select_anon" ON reminder_occurrences
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "reminder_occurrences_insert_anon" ON reminder_occurrences;
CREATE POLICY "reminder_occurrences_insert_anon" ON reminder_occurrences
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "reminder_occurrences_update_anon" ON reminder_occurrences;
CREATE POLICY "reminder_occurrences_update_anon" ON reminder_occurrences
  FOR UPDATE USING (false);

-- ── 17. shop_requests ────────────────────────────────────────
ALTER TABLE shop_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_requests_select_anon" ON shop_requests;
CREATE POLICY "shop_requests_select_anon" ON shop_requests
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "shop_requests_insert_anon" ON shop_requests;
CREATE POLICY "shop_requests_insert_anon" ON shop_requests
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS "shop_requests_update_anon" ON shop_requests;
CREATE POLICY "shop_requests_update_anon" ON shop_requests
  FOR UPDATE USING (false);

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
