-- FIX ALL RLS POLICIES FOR DEMO MODE
-- Problem: All existing policies require TO authenticated, but the demo app
-- never calls supabase.auth — it uses anon key with direct DB queries.
-- Solution: Drop all existing policies, create permissive public policies.
-- IMPORTANT: For production, revert to authenticated policies + proper auth.

-- ========== DROP ALL EXISTING RESTRICTIVE POLICIES ==========

-- Users
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;

-- Companies
DROP POLICY IF EXISTS companies_select ON companies;
DROP POLICY IF EXISTS companies_insert ON companies;
DROP POLICY IF EXISTS companies_update ON companies;

-- Products
DROP POLICY IF EXISTS products_select ON products;
DROP POLICY IF EXISTS products_insert ON products;
DROP POLICY IF EXISTS products_update ON products;

-- Product variants
DROP POLICY IF EXISTS product_variants_select ON product_variants;
DROP POLICY IF EXISTS product_variants_insert ON product_variants;
DROP POLICY IF EXISTS product_variants_update ON product_variants;

-- Customers
DROP POLICY IF EXISTS customers_select ON customers;
DROP POLICY IF EXISTS customers_insert ON customers;
DROP POLICY IF EXISTS customers_update ON customers;

-- Sales
DROP POLICY IF EXISTS sales_select ON sales;
DROP POLICY IF EXISTS sales_insert ON sales;
DROP POLICY IF EXISTS sales_update ON sales;

-- Sale items
DROP POLICY IF EXISTS sale_items_select ON sale_items;
DROP POLICY IF EXISTS sale_items_insert ON sale_items;

-- Customer payments
DROP POLICY IF EXISTS customer_payments_select ON customer_payments;
DROP POLICY IF EXISTS customer_payments_insert ON customer_payments;

-- Purchases
DROP POLICY IF EXISTS purchases_select ON purchases;
DROP POLICY IF EXISTS purchases_insert ON purchases;

-- Purchase items
DROP POLICY IF EXISTS purchase_items_select ON purchase_items;
DROP POLICY IF EXISTS purchase_items_insert ON purchase_items;

-- Supplier payments
DROP POLICY IF EXISTS supplier_payments_select ON supplier_payments;
DROP POLICY IF EXISTS supplier_payments_insert ON supplier_payments;

-- Stock adjustments
DROP POLICY IF EXISTS stock_adjustments_select ON stock_adjustments;
DROP POLICY IF EXISTS stock_adjustments_insert ON stock_adjustments;

-- Returns
DROP POLICY IF EXISTS returns_select ON returns;
DROP POLICY IF EXISTS returns_insert ON returns;
DROP POLICY IF EXISTS return_items_select ON return_items;
DROP POLICY IF EXISTS return_items_insert ON return_items;

-- Notifications
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;

-- Voids
DROP POLICY IF EXISTS voids_select ON voids;
DROP POLICY IF EXISTS voids_insert ON voids;

-- Audit events
DROP POLICY IF EXISTS audit_events_select ON audit_events;
DROP POLICY IF EXISTS audit_events_insert ON audit_events;

-- App settings
DROP POLICY IF EXISTS app_settings_select ON app_settings;
DROP POLICY IF EXISTS app_settings_insert ON app_settings;
DROP POLICY IF EXISTS app_settings_update ON app_settings;

-- Cash reconciliations
DROP POLICY IF EXISTS cash_reconciliations_select ON cash_reconciliations;
DROP POLICY IF EXISTS cash_reconciliations_insert ON cash_reconciliations;

-- Inventory movements
DROP POLICY IF EXISTS inventory_movements_select ON inventory_movements;
DROP POLICY IF EXISTS inventory_movements_insert ON inventory_movements;

-- Also drop any policies from other migrations
DROP POLICY IF EXISTS "Authenticated users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for image buckets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their uploads" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow reads" ON storage.objects;
DROP POLICY IF EXISTS shop_requests_insert ON shop_requests;
DROP POLICY IF EXISTS shop_requests_select_own ON shop_requests;
DROP POLICY IF EXISTS shop_requests_select_admin ON shop_requests;
DROP POLICY IF EXISTS shop_requests_update_admin ON shop_requests;
DROP POLICY IF EXISTS "Allow all" ON shop_requests;

-- ========== CREATE PERMISSIVE PUBLIC POLICIES (DEMO MODE) ==========

-- Users: full access
CREATE POLICY "public_all_users" ON users FOR ALL USING (true) WITH CHECK (true);

-- Companies: full access
CREATE POLICY "public_all_companies" ON companies FOR ALL USING (true) WITH CHECK (true);

-- Products: full access
CREATE POLICY "public_all_products" ON products FOR ALL USING (true) WITH CHECK (true);

-- Product variants: full access
CREATE POLICY "public_all_product_variants" ON product_variants FOR ALL USING (true) WITH CHECK (true);

-- Customers: full access
CREATE POLICY "public_all_customers" ON customers FOR ALL USING (true) WITH CHECK (true);

-- Sales: full access
CREATE POLICY "public_all_sales" ON sales FOR ALL USING (true) WITH CHECK (true);

-- Sale items: full access
CREATE POLICY "public_all_sale_items" ON sale_items FOR ALL USING (true) WITH CHECK (true);

-- Customer payments: full access
CREATE POLICY "public_all_customer_payments" ON customer_payments FOR ALL USING (true) WITH CHECK (true);

-- Purchases: full access
CREATE POLICY "public_all_purchases" ON purchases FOR ALL USING (true) WITH CHECK (true);

-- Purchase items: full access
CREATE POLICY "public_all_purchase_items" ON purchase_items FOR ALL USING (true) WITH CHECK (true);

-- Supplier payments: full access
CREATE POLICY "public_all_supplier_payments" ON supplier_payments FOR ALL USING (true) WITH CHECK (true);

-- Stock adjustments: full access
CREATE POLICY "public_all_stock_adjustments" ON stock_adjustments FOR ALL USING (true) WITH CHECK (true);

-- Returns: full access
CREATE POLICY "public_all_returns" ON returns FOR ALL USING (true) WITH CHECK (true);

-- Return items: full access
CREATE POLICY "public_all_return_items" ON return_items FOR ALL USING (true) WITH CHECK (true);

-- Notifications: full access
CREATE POLICY "public_all_notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);

-- Voids: full access
CREATE POLICY "public_all_voids" ON voids FOR ALL USING (true) WITH CHECK (true);

-- Audit events: full access
CREATE POLICY "public_all_audit_events" ON audit_events FOR ALL USING (true) WITH CHECK (true);

-- App settings: full access
CREATE POLICY "public_all_app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);

-- Cash reconciliations: full access
CREATE POLICY "public_all_cash_reconciliations" ON cash_reconciliations FOR ALL USING (true) WITH CHECK (true);

-- Inventory movements: full access
CREATE POLICY "public_all_inventory_movements" ON inventory_movements FOR ALL USING (true) WITH CHECK (true);

-- Shop requests: full access
CREATE POLICY "public_all_shop_requests" ON shop_requests FOR ALL USING (true) WITH CHECK (true);

-- ========== STORAGE BUCKETS: full access ==========

CREATE POLICY "public_all_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

CREATE POLICY "public_all_storage_select" ON storage.objects
  FOR SELECT USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

CREATE POLICY "public_all_storage_update" ON storage.objects
  FOR UPDATE USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));

CREATE POLICY "public_all_storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images'));
