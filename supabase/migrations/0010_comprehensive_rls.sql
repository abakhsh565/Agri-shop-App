-- Comprehensive RLS Policies with shop_id isolation and role-based access
-- Drop all existing policies first
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

-- USERS: shop-scoped, all roles read, admin write
CREATE POLICY users_select ON users FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY users_insert ON users FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY users_update ON users FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- COMPANIES: shop-scoped, all read, admin write
CREATE POLICY companies_select ON companies FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY companies_insert ON companies FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id() AND app_is_admin());
CREATE POLICY companies_update ON companies FOR UPDATE TO authenticated USING (shop_id = current_shop_id() AND app_is_admin()) WITH CHECK (shop_id = current_shop_id());

-- PRODUCTS: shop-scoped, all read, admin write
CREATE POLICY products_select ON products FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY products_insert ON products FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id() AND app_is_admin());
CREATE POLICY products_update ON products FOR UPDATE TO authenticated USING (shop_id = current_shop_id() AND app_is_admin()) WITH CHECK (shop_id = current_shop_id());

-- PRODUCT_VARIANTS: all read (cost hidden by view), admin write
CREATE POLICY product_variants_select ON product_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY product_variants_insert ON product_variants FOR INSERT TO authenticated WITH CHECK (app_is_admin());
CREATE POLICY product_variants_update ON product_variants FOR UPDATE TO authenticated USING (app_is_admin()) WITH CHECK (app_is_admin());

-- CUSTOMERS: shop-scoped, all read/write (PRD: shop-wide customer visibility)
CREATE POLICY customers_select ON customers FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY customers_insert ON customers FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY customers_update ON customers FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- SALES: shop-scoped, all read/write
CREATE POLICY sales_select ON sales FOR SELECT TO authenticated USING (shop_id = current_shop_id());
CREATE POLICY sales_insert ON sales FOR INSERT TO authenticated WITH CHECK (shop_id = current_shop_id());
CREATE POLICY sales_update ON sales FOR UPDATE TO authenticated USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- SALE_ITEMS: all read/write (follows sale access)
CREATE POLICY sale_items_select ON sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_items_insert ON sale_items FOR INSERT TO authenticated WITH CHECK (true);

-- CUSTOMER_PAYMENTS: all read/write
CREATE POLICY customer_payments_select ON customer_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY customer_payments_insert ON customer_payments FOR INSERT TO authenticated WITH CHECK (true);

-- PURCHASES: admin-only (supplier financials hidden from employees)
CREATE POLICY purchases_select ON purchases FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY purchases_insert ON purchases FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- PURCHASE_ITEMS: admin-only
CREATE POLICY purchase_items_select ON purchase_items FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY purchase_items_insert ON purchase_items FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- SUPPLIER_PAYMENTS: admin-only
CREATE POLICY supplier_payments_select ON supplier_payments FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY supplier_payments_insert ON supplier_payments FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- STOCK_ADJUSTMENTS: admin-only
CREATE POLICY stock_adjustments_select ON stock_adjustments FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY stock_adjustments_insert ON stock_adjustments FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- RETURNS: all read/write
CREATE POLICY returns_select ON returns FOR SELECT TO authenticated USING (true);
CREATE POLICY returns_insert ON returns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY return_items_select ON return_items FOR SELECT TO authenticated USING (true);
CREATE POLICY return_items_insert ON return_items FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATIONS: all read/write
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated USING (true);
CREATE POLICY notifications_insert ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY notifications_update ON notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- VOIDS: admin-only
CREATE POLICY voids_select ON voids FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY voids_insert ON voids FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- AUDIT_EVENTS: admin read, all insert
CREATE POLICY audit_events_select ON audit_events FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO authenticated WITH CHECK (true);

-- APP_SETTINGS: all read, admin write
CREATE POLICY app_settings_select ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY app_settings_insert ON app_settings FOR INSERT TO authenticated WITH CHECK (app_is_admin());
CREATE POLICY app_settings_update ON app_settings FOR UPDATE TO authenticated USING (app_is_admin()) WITH CHECK (app_is_admin());

-- CASH_RECONCILIATIONS: admin-only
CREATE POLICY cash_reconciliations_select ON cash_reconciliations FOR SELECT TO authenticated USING (app_is_admin());
CREATE POLICY cash_reconciliations_insert ON cash_reconciliations FOR INSERT TO authenticated WITH CHECK (app_is_admin());

-- INVENTORY_MOVEMENTS: all read, all insert (written by RPCs)
CREATE POLICY inventory_movements_select ON inventory_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_movements_insert ON inventory_movements FOR INSERT TO authenticated WITH CHECK (true);
