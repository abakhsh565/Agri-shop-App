-- FIX: Relax RLS for dev mode (no Supabase Auth session)
-- The publishable key acts as anonymous without auth — needs permissive policies
-- Run this in Supabase SQL Editor AFTER COMPLETE_DATABASE_SETUP.sql

-- ============ USERS ============
DROP POLICY IF EXISTS users_select_all ON users;
DROP POLICY IF EXISTS users_insert_auth ON users;
DROP POLICY IF EXISTS users_admin_all ON users;
DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_dev_all ON users FOR ALL USING (true);

-- ============ COMPANIES ============
DROP POLICY IF EXISTS companies_admin_all ON companies;
DROP POLICY IF EXISTS companies_emp_read ON companies;
CREATE POLICY companies_dev_all ON companies FOR ALL USING (true);

-- ============ PRODUCTS ============
DROP POLICY IF EXISTS products_admin_all ON products;
DROP POLICY IF EXISTS products_emp_read ON products;
CREATE POLICY products_dev_all ON products FOR ALL USING (true);

-- ============ PRODUCT VARIANTS ============
DROP POLICY IF EXISTS variants_admin_all ON product_variants;
DROP POLICY IF EXISTS variants_emp_read ON product_variants;
CREATE POLICY variants_dev_all ON product_variants FOR ALL USING (true);

-- ============ CUSTOMERS ============
DROP POLICY IF EXISTS customers_all_access ON customers;
CREATE POLICY customers_dev_all ON customers FOR ALL USING (true);

-- ============ SALES ============
DROP POLICY IF EXISTS sales_read ON sales;
DROP POLICY IF EXISTS sales_insert ON sales;
DROP POLICY IF EXISTS sales_update ON sales;
CREATE POLICY sales_dev_all ON sales FOR ALL USING (true);

-- ============ SALE ITEMS ============
DROP POLICY IF EXISTS sale_items_all ON sale_items;
CREATE POLICY sale_items_dev_all ON sale_items FOR ALL USING (true);

-- ============ NOTIFICATIONS ============
DROP POLICY IF EXISTS notifications_read ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_dev_all ON notifications FOR ALL USING (true);

-- ============ CUSTOMER PAYMENTS ============
DROP POLICY IF EXISTS cust_pay_all ON customer_payments;
CREATE POLICY cust_pay_dev_all ON customer_payments FOR ALL USING (true);

-- ============ SUPPLIER PAYMENTS ============
DROP POLICY IF EXISTS sup_pay_admin ON supplier_payments;
CREATE POLICY supplier_payments_dev_all ON supplier_payments FOR ALL USING (true);

-- ============ PURCHASES ============
DROP POLICY IF EXISTS purchases_admin ON purchases;
DROP POLICY IF EXISTS purchase_items_admin ON purchase_items;
CREATE POLICY purchases_dev_all ON purchases FOR ALL USING (true);
CREATE POLICY purchase_items_dev_all ON purchase_items FOR ALL USING (true);

-- ============ STOCK ADJUSTMENTS ============
DROP POLICY IF EXISTS stock_adj_admin ON stock_adjustments;
CREATE POLICY stock_adjustments_dev_all ON stock_adjustments FOR ALL USING (true);

-- ============ RETURNS ============
DROP POLICY IF EXISTS returns_all ON returns;
DROP POLICY IF EXISTS return_items_all ON return_items;
CREATE POLICY returns_dev_all ON returns FOR ALL USING (true);
CREATE POLICY return_items_dev_all ON return_items FOR ALL USING (true);

-- ============ VOIDS ============
DROP POLICY IF EXISTS voids_admin ON voids;
CREATE POLICY voids_dev_all ON voids FOR ALL USING (true);

-- ============ AUDIT EVENTS ============
DROP POLICY IF EXISTS audit_read ON audit_events;
DROP POLICY IF EXISTS audit_insert ON audit_events;
CREATE POLICY audit_events_dev_all ON audit_events FOR ALL USING (true);

-- ============ INVENTORY MOVEMENTS ============
DROP POLICY IF EXISTS inv_movements_admin ON inventory_movements;
CREATE POLICY inventory_movements_dev_all ON inventory_movements FOR ALL USING (true);

-- ============ APP SETTINGS ============
DROP POLICY IF EXISTS settings_admin ON app_settings;
CREATE POLICY app_settings_dev_all ON app_settings FOR ALL USING (true);

-- ============ CASH RECONCILIATIONS ============
DROP POLICY IF EXISTS cash_rec_admin ON cash_reconciliations;
CREATE POLICY cash_reconciliations_dev_all ON cash_reconciliations FOR ALL USING (true);

-- Done! All RLS is now permissive for dev mode.
-- NOTE: This is for development ONLY. Before production, restore proper RLS.
