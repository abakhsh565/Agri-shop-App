-- Schema Upgrade: Multi-tenancy + Missing Tables + Columns

-- Helper functions
CREATE OR REPLACE FUNCTION public.app_current_user_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid; $$;
CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM users WHERE id = app_current_user_id() AND role IN ('admin', 'co_admin') AND is_active = true); $$;
CREATE OR REPLACE FUNCTION public.current_shop_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT shop_id FROM users WHERE id = app_current_user_id(); $$;

-- 1. Add shop_id to existing tables
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='shop_id') THEN
  ALTER TABLE users ADD COLUMN shop_id uuid REFERENCES shops(id);
  INSERT INTO shops(id,name) VALUES('00000000-0000-0000-0000-000000000001','Default Shop') ON CONFLICT(id) DO NOTHING;
  UPDATE users SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE users ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='shop_id') THEN
  ALTER TABLE companies ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE companies SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE companies ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='shop_id') THEN
  ALTER TABLE products ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE products SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE products ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='shop_id') THEN
  ALTER TABLE customers ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE customers SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE customers ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='shop_id') THEN
  ALTER TABLE sales ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE sales SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE sales ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='shop_id') THEN
  ALTER TABLE purchases ADD COLUMN shop_id uuid REFERENCES shops(id);
  UPDATE purchases SET shop_id='00000000-0000-0000-0000-000000000001' WHERE shop_id IS NULL;
  ALTER TABLE purchases ALTER COLUMN shop_id SET NOT NULL;
END IF; END $$;

-- 2. Add missing columns
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='pin_hash') THEN ALTER TABLE users ADD COLUMN pin_hash varchar(255); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at') THEN ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='is_active') THEN ALTER TABLE companies ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='companies' AND column_name='updated_at') THEN ALTER TABLE companies ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='is_active') THEN ALTER TABLE products ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='updated_at') THEN ALTER TABLE products ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='company_id') THEN ALTER TABLE products ADD COLUMN company_id uuid REFERENCES companies(id); UPDATE products p SET company_id = c.id FROM companies c WHERE p.company = c.name; ALTER TABLE products DROP COLUMN company; ALTER TABLE products ALTER COLUMN company_id SET NOT NULL; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='is_active') THEN ALTER TABLE product_variants ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='updated_at') THEN ALTER TABLE product_variants ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='product_variants' AND column_name='batch_id') THEN ALTER TABLE product_variants ADD COLUMN batch_id uuid; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='is_active') THEN ALTER TABLE customers ADD COLUMN is_active boolean NOT NULL DEFAULT true; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='image_url') THEN ALTER TABLE customers ADD COLUMN image_url text; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='updated_at') THEN ALTER TABLE customers ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='updated_at') THEN ALTER TABLE sales ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='cogs_amount') THEN ALTER TABLE sale_items ADD COLUMN cogs_amount numeric(14,2) NOT NULL DEFAULT 0; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sale_items' AND column_name='created_at') THEN ALTER TABLE sale_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchases' AND column_name='updated_at') THEN ALTER TABLE purchases ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='purchase_items' AND column_name='created_at') THEN ALTER TABLE purchase_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='returns' AND column_name='updated_at') THEN ALTER TABLE returns ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(); END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='return_items' AND column_name='refund_amount') THEN ALTER TABLE return_items ADD COLUMN refund_amount numeric(14,2) NOT NULL DEFAULT 0; END IF;
IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='return_items' AND column_name='created_at') THEN ALTER TABLE return_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); END IF;
END $$;

-- 3. Create missing tables
CREATE TABLE IF NOT EXISTS voids (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES sales(id), reason varchar(50) NOT NULL, notes text, voided_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), action varchar(100) NOT NULL, entity_type varchar(50) NOT NULL, entity_id uuid, details jsonb, ip_address inet, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE, setting_key varchar(100) NOT NULL, setting_value text NOT NULL, description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT unique_shop_setting UNIQUE (shop_id, setting_key));
CREATE TABLE IF NOT EXISTS cash_reconciliations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE, reconciliation_date date NOT NULL, expected_cash numeric(14,2) NOT NULL, counted_cash numeric(14,2) NOT NULL, variance numeric(14,2) NOT NULL, notes text, reconciled_by uuid NOT NULL REFERENCES users(id), reconciled_by_name varchar(255) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT unique_shop_reconciliation_date UNIQUE (shop_id, reconciliation_date));

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='movement_type') THEN CREATE TYPE movement_type AS ENUM ('sale','return','purchase','adjustment','void','opening'); END IF; END $$;
CREATE TABLE IF NOT EXISTS inventory_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), variant_id uuid NOT NULL REFERENCES product_variants(id), movement_type movement_type NOT NULL, qty_before numeric(12,2) NOT NULL, qty_change numeric(12,2) NOT NULL, qty_after numeric(12,2) NOT NULL, reference_type varchar(50), reference_id uuid, batch_id uuid, unit_cost numeric(12,2), notes text, created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT check_qty_after_non_negative CHECK (qty_after >= 0));

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_users_shop_id ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_companies_shop_id ON companies(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_shop_id ON sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales(employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_is_voided ON sales(is_voided);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_shop_id ON purchases(shop_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_company_id ON supplier_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant_id ON stock_adjustments(variant_id);
CREATE INDEX IF NOT EXISTS idx_returns_sale_id ON returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_voids_sale_id ON voids(sale_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_id ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity_type ON audit_events(entity_type);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_id ON inventory_movements(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created_at ON inventory_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_app_settings_shop_id ON app_settings(shop_id);
CREATE INDEX IF NOT EXISTS idx_cash_reconciliations_shop_id ON cash_reconciliations(shop_id);

-- 5. Default app settings
INSERT INTO app_settings(shop_id,setting_key,setting_value,description) VALUES
  ('00000000-0000-0000-0000-000000000001','low_stock_threshold_default','10','Default low stock alert threshold'),
  ('00000000-0000-0000-0000-000000000001','expiry_warning_days','30','Days before expiry to show warning'),
  ('00000000-0000-0000-0000-000000000001','void_window_hours','24','Hours after sale to allow void'),
  ('00000000-0000-0000-0000-000000000001','credit_limit_override_policy','warn_allow_log','Employee credit limit policy'),
  ('00000000-0000-0000-0000-000000000001','seed_kg_step','0.5','Default kg increment for seed products')
ON CONFLICT(shop_id,setting_key) DO NOTHING;

-- 6. Trigger for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_users_updated_at') THEN
  CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_companies_updated_at') THEN
  CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_products_updated_at') THEN
  CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_product_variants_updated_at') THEN
  CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_customers_updated_at') THEN
  CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_sales_updated_at') THEN
  CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
END IF;
END $$;
