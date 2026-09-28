-- ============================================================================
-- AGRISHOP COMPLETE DATABASE SETUP (Self-Contained)
-- Project: gkswcfljxlutkfdvvqng
-- Run this SINGLE file in Supabase SQL Editor → New Query → Run
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE everywhere
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 1: ENUMS
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin','employee'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE product_category AS ENUM ('spray','seed','fertilizer','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_type AS ENUM ('full','partial','credit'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('cash','bank_transfer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE notification_kind AS ENUM ('sale','payment','return','stock_adjust','low_stock','employee','purchase','system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE adjustment_kind AS ENUM ('add','remove','set'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE movement_type AS ENUM ('sale','return','purchase','adjustment','void','opening'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 2: SHOPS TABLE (must exist first — referenced by everything)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shops (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  phone      text,
  address    text,
  owner_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Default shop
INSERT INTO shops(id, name) VALUES('00000000-0000-0000-0000-000000000001','Default Shop') ON CONFLICT(id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 3: HELPER FUNCTIONS (must exist before policies/other functions)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 4: CORE TABLES (with ALL columns from migrations 0001-0017)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 4.1 USERS / EMPLOYEES
CREATE TABLE IF NOT EXISTS users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  phone             text UNIQUE NOT NULL,
  role              user_role NOT NULL DEFAULT 'employee',
  is_original_owner boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  pin_hash          varchar(255),
  employee_number   text,
  job_title         text,
  photo_url         text,
  shop_id           uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  first_login_at    timestamptz,
  last_login_at     timestamptz,
  deactivated_at    timestamptz,
  deactivated_by    uuid REFERENCES users(id),
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 4.2 COMPANIES / SUPPLIERS
CREATE TABLE IF NOT EXISTS companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  contact_person      text,
  phone               text,
  address             text,
  logo_url            text,
  outstanding_payable numeric(14,2) NOT NULL DEFAULT 0,
  total_purchases     numeric(14,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  shop_id             uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 4.3 PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  company      text NOT NULL DEFAULT '',
  company_id   uuid REFERENCES companies(id),
  category     product_category NOT NULL DEFAULT 'other',
  image_url    text,
  barcode      text,
  base_unit    text NOT NULL DEFAULT 'piece',
  stock_qty    numeric(14,4) NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active    boolean NOT NULL DEFAULT true,
  shop_id      uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 4.4 PRODUCT VARIANTS
CREATE TABLE IF NOT EXISTS product_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                text NOT NULL,
  sku                 text,
  selling_price       numeric(12,2) NOT NULL DEFAULT 0,
  cost_price          numeric(12,2) NOT NULL DEFAULT 0,
  stock_qty           integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  unit_size           numeric(10,4) NOT NULL DEFAULT 1 CHECK (unit_size > 0),
  qty_step            numeric(10,4) NOT NULL DEFAULT 1 CHECK (qty_step > 0),
  low_stock_threshold integer NOT NULL DEFAULT 5,
  expiry_date         date,
  is_active           boolean NOT NULL DEFAULT true,
  batch_id            uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 4.5 CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  phone               text NOT NULL,
  address             text,
  image_url           text,
  credit_limit        numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(14,2) NOT NULL DEFAULT 0,
  total_purchases     numeric(14,2) NOT NULL DEFAULT 0,
  total_paid          numeric(14,2) NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  is_archived         boolean NOT NULL DEFAULT false,
  archived_at         timestamptz,
  archived_by         uuid REFERENCES users(id),
  shop_id             uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 4.6 SALES
CREATE TABLE IF NOT EXISTS sales (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_number               text UNIQUE NOT NULL,
  customer_id               uuid REFERENCES customers(id),
  customer_name             text NOT NULL,
  historical_customer_name  text,
  historical_customer_phone text,
  historical_customer_address text,
  employee_id               uuid REFERENCES users(id),
  employee_name             text NOT NULL,
  subtotal                  numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount                numeric(14,2) NOT NULL DEFAULT 0,
  total_amount              numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid               numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_balance       numeric(14,2) NOT NULL DEFAULT 0,
  payment_type              payment_type NOT NULL DEFAULT 'full',
  payment_method            payment_method NOT NULL DEFAULT 'cash',
  status                    text NOT NULL DEFAULT 'completed',
  is_voided                 boolean NOT NULL DEFAULT false,
  voided_at                 timestamptz,
  voided_by                 uuid REFERENCES users(id),
  voided_by_name            text,
  void_reason               text,
  note                      text,
  shop_id                   uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- 4.7 SALE ITEMS
CREATE TABLE IF NOT EXISTS sale_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id      uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES products(id),
  product_name text NOT NULL,
  variant_id   uuid REFERENCES product_variants(id),
  variant_name text NOT NULL,
  qty          numeric(12,4) NOT NULL,
  unit_price   numeric(12,2) NOT NULL,
  line_total   numeric(14,2) NOT NULL,
  cogs_amount  numeric(14,2) NOT NULL DEFAULT 0,
  unit_size    numeric(10,4) DEFAULT 1,
  base_unit    text DEFAULT 'piece',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4.8 NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       notification_kind NOT NULL,
  title      text NOT NULL,
  body       text,
  entity_id  uuid,
  actor_id   uuid REFERENCES users(id),
  actor_name text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.9 CUSTOMER PAYMENTS
CREATE TABLE IF NOT EXISTS customer_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      uuid NOT NULL REFERENCES customers(id),
  amount           numeric(14,2) NOT NULL,
  method           payment_method NOT NULL DEFAULT 'cash',
  notes            text,
  recorded_by      uuid REFERENCES users(id),
  recorded_by_name text,
  balance_after    numeric(14,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 4.10 SUPPLIER PAYMENTS
CREATE TABLE IF NOT EXISTS supplier_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  amount           numeric(14,2) NOT NULL,
  method           payment_method NOT NULL DEFAULT 'cash',
  notes            text,
  recorded_by      uuid REFERENCES users(id),
  recorded_by_name text,
  payable_after    numeric(14,2) NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 4.11 PURCHASES
CREATE TABLE IF NOT EXISTS purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number     text NOT NULL UNIQUE,
  company_id          uuid REFERENCES companies(id),
  company_name        text NOT NULL,
  total_amount        numeric(14,2) NOT NULL DEFAULT 0,
  amount_paid         numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_payable numeric(14,2) NOT NULL DEFAULT 0,
  payment_method      payment_method NOT NULL DEFAULT 'cash',
  note                text,
  shop_id             uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 4.12 PURCHASE ITEMS
CREATE TABLE IF NOT EXISTS purchase_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES products(id),
  product_name text NOT NULL,
  variant_id   uuid REFERENCES product_variants(id),
  variant_name text NOT NULL,
  qty          numeric(12,4) NOT NULL,
  cost_price   numeric(12,2) NOT NULL DEFAULT 0,
  line_total   numeric(14,2) NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 4.13 STOCK ADJUSTMENTS
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       uuid REFERENCES products(id),
  product_name     text NOT NULL,
  variant_id       uuid REFERENCES product_variants(id),
  variant_name     text NOT NULL,
  adjustment_type  adjustment_kind NOT NULL,
  qty_before       numeric(12,4) NOT NULL,
  qty_change       numeric(12,4) NOT NULL,
  qty_after        numeric(12,4) NOT NULL,
  reason           text,
  adjusted_by      uuid REFERENCES users(id),
  adjusted_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 4.14 RETURNS
CREATE TABLE IF NOT EXISTS returns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number     text NOT NULL UNIQUE,
  sale_id           uuid REFERENCES sales(id),
  customer_id       uuid REFERENCES customers(id),
  customer_name     text NOT NULL,
  total_refund      numeric(14,2) NOT NULL DEFAULT 0,
  resolution        text NOT NULL DEFAULT 'refund',
  note              text,
  processed_by      uuid REFERENCES users(id),
  processed_by_name text,
  shop_id           uuid NOT NULL REFERENCES shops(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 4.15 RETURN ITEMS
CREATE TABLE IF NOT EXISTS return_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id     uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id  uuid REFERENCES sale_items(id),
  product_id    uuid REFERENCES products(id),
  product_name  text NOT NULL,
  variant_id    uuid REFERENCES product_variants(id),
  variant_name  text NOT NULL,
  qty           numeric(12,4) NOT NULL,
  unit_price    numeric(12,2) NOT NULL DEFAULT 0,
  line_total    numeric(14,2) NOT NULL DEFAULT 0,
  refund_amount numeric(14,2) NOT NULL DEFAULT 0,
  restock       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 4.16 VOIDS
CREATE TABLE IF NOT EXISTS voids (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    uuid NOT NULL REFERENCES sales(id),
  reason     varchar(50) NOT NULL,
  notes      text,
  voided_by  uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4.17 AUDIT EVENTS
CREATE TABLE IF NOT EXISTS audit_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  action      varchar(100) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id   uuid,
  details     jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 4.18 INVENTORY MOVEMENTS
CREATE TABLE IF NOT EXISTS inventory_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id     uuid NOT NULL REFERENCES product_variants(id),
  movement_type  movement_type NOT NULL,
  qty_before     numeric(12,4) NOT NULL,
  qty_change     numeric(12,4) NOT NULL,
  qty_after      numeric(12,4) NOT NULL,
  reference_type varchar(50),
  reference_id   uuid,
  batch_id       uuid,
  unit_cost      numeric(12,2),
  notes          text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_qty_after_non_negative CHECK (qty_after >= 0)
);

-- 4.19 APP SETTINGS
CREATE TABLE IF NOT EXISTS app_settings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  setting_key   varchar(100) NOT NULL,
  setting_value text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_shop_setting UNIQUE (shop_id, setting_key)
);

-- 4.20 CASH RECONCILIATIONS
CREATE TABLE IF NOT EXISTS cash_reconciliations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  reconciliation_date  date NOT NULL,
  expected_cash        numeric(14,2) NOT NULL,
  counted_cash         numeric(14,2) NOT NULL,
  variance             numeric(14,2) NOT NULL,
  notes                text,
  reconciled_by        uuid NOT NULL REFERENCES users(id),
  reconciled_by_name   varchar(255) NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_shop_reconciliation_date UNIQUE (shop_id, reconciliation_date)
);

-- Table-dependent functions (references users table — must be after Section 4)
CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = app_current_user_id()
    AND role IN ('admin') AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.current_shop_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT shop_id FROM users WHERE id = app_current_user_id();
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 5: VIEW (employee-safe — no cost_price)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS product_variants_public;
CREATE VIEW product_variants_public AS
SELECT id, product_id, name, sku, selling_price, unit_size, qty_step,
       low_stock_threshold, expiry_date
FROM product_variants;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 6: INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_users_shop_id ON users(shop_id);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_companies_shop_id ON companies(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_company_id ON products(company_id);
CREATE INDEX IF NOT EXISTS idx_products_base_unit ON products(base_unit);
CREATE INDEX IF NOT EXISTS idx_products_stock_qty ON products(stock_qty);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_customers_shop_id ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_is_archived ON customers(is_archived);
CREATE INDEX IF NOT EXISTS idx_sales_shop_id ON sales(shop_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales(employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_is_voided ON sales(is_voided);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_id ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_purchases_shop_id ON purchases(shop_id);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 7: TRIGGERS (auto-update updated_at)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_users_updated_at') THEN CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_companies_updated_at') THEN CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_products_updated_at') THEN CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_product_variants_updated_at') THEN CREATE TRIGGER update_product_variants_updated_at BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_customers_updated_at') THEN CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_sales_updated_at') THEN CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); END IF; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 8: RLS POLICIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_reconciliations ENABLE ROW LEVEL SECURITY;

-- Clean up any existing policies
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Users: admin full access, employees read own
CREATE POLICY users_admin_all ON users FOR ALL USING (app_is_admin());
CREATE POLICY users_read_own ON users FOR SELECT USING (id = app_current_user_id());

-- Companies: admin full access, employees read active only
CREATE POLICY companies_admin_all ON companies FOR ALL USING (app_is_admin());
CREATE POLICY companies_emp_read ON companies FOR SELECT USING (is_active = true);

-- Products: admin full access, employees read (via view without cost)
CREATE POLICY products_admin_all ON products FOR ALL USING (app_is_admin());
CREATE POLICY products_emp_read ON products FOR SELECT USING (is_active = true);

-- Product variants: admin full access, employees read via view
CREATE POLICY variants_admin_all ON product_variants FOR ALL USING (app_is_admin());
CREATE POLICY variants_emp_read ON product_variants FOR SELECT USING (true);

-- Customers: all authenticated can read/insert/update, admin can archive
CREATE POLICY customers_all_access ON customers FOR ALL USING (true);

-- Sales: all authenticated read, admin full access
CREATE POLICY sales_read ON sales FOR SELECT USING (true);
CREATE POLICY sales_insert ON sales FOR INSERT WITH CHECK (true);
CREATE POLICY sales_update ON sales FOR UPDATE USING (app_is_admin());

-- Sale items: all authenticated read/insert
CREATE POLICY sale_items_all ON sale_items FOR ALL USING (true);

-- Notifications: all authenticated read, admin can manage
CREATE POLICY notifications_read ON notifications FOR SELECT USING (true);
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (true);

-- Customer payments: all authenticated read/create
CREATE POLICY cust_pay_all ON customer_payments FOR ALL USING (true);

-- Supplier payments: admin only
CREATE POLICY sup_pay_admin ON supplier_payments FOR ALL USING (app_is_admin());

-- Purchases: admin only
CREATE POLICY purchases_admin ON purchases FOR ALL USING (app_is_admin());
CREATE POLICY purchase_items_admin ON purchase_items FOR ALL USING (app_is_admin());

-- Stock adjustments: admin only
CREATE POLICY stock_adj_admin ON stock_adjustments FOR ALL USING (app_is_admin());

-- Returns: all authenticated read/create
CREATE POLICY returns_all ON returns FOR ALL USING (true);
CREATE POLICY return_items_all ON return_items FOR ALL USING (true);

-- Voids: admin only
CREATE POLICY voids_admin ON voids FOR ALL USING (app_is_admin());

-- Audit events: admin read, system insert
CREATE POLICY audit_read ON audit_events FOR SELECT USING (app_is_admin());
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (true);

-- Inventory movements: admin read, system insert
CREATE POLICY inv_movements_admin ON inventory_movements FOR ALL USING (app_is_admin());

-- App settings: admin only
CREATE POLICY settings_admin ON app_settings FOR ALL USING (app_is_admin());

-- Cash reconciliations: admin only
CREATE POLICY cash_rec_admin ON cash_reconciliations FOR ALL USING (app_is_admin());

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 9: DEFAULT APP SETTINGS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO app_settings(shop_id, setting_key, setting_value, description) VALUES
  ('00000000-0000-0000-0000-000000000001','low_stock_threshold_default','10','Default low stock alert threshold'),
  ('00000000-0000-0000-0000-000000000001','expiry_warning_days','30','Days before expiry to show warning'),
  ('00000000-0000-0000-0000-000000000001','void_window_hours','24','Hours after sale to allow void'),
  ('00000000-0000-0000-0000-000000000001','credit_limit_override_policy','warn_allow_log','Employee credit limit policy'),
  ('00000000-0000-0000-0000-000000000001','seed_kg_step','0.5','Default kg increment for seed products')
ON CONFLICT(shop_id, setting_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 10: RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- 10a. create_sale — atomic sale + stock deduction
CREATE OR REPLACE FUNCTION create_sale(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_customer_id uuid;
  v_customer_name text := coalesce(p_payload->>'customerName','Walk-in');
  v_total numeric(14,4) := 0;
  v_amount_paid numeric(14,4);
  v_payment_type payment_type := coalesce((p_payload->>'paymentType')::payment_type,'full');
  v_payment_method payment_method := coalesce((p_payload->>'paymentMethod')::payment_method,'cash');
  v_note text := p_payload->>'note';
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_outstanding numeric(14,4);
  v_item jsonb;
  v_deduction numeric(14,4);
  v_stock numeric(14,4);
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  v_sale_number := '#' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');
  v_customer_id := nullif(p_payload->>'customerId','')::uuid;
  v_amount_paid := coalesce((p_payload->>'amountPaid')::numeric, 0);

  -- Validate stock (pass 1)
  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    IF v_item->>'variantId' IS NOT NULL AND v_item->>'variantId' != '' THEN
      v_deduction := (v_item->>'qty')::numeric * coalesce((v_item->>'unitSize')::numeric, 1);
      SELECT stock_qty INTO v_stock FROM products WHERE id = (v_item->>'productId')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;
      IF v_stock < v_deduction THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: need %, have %', v_deduction, v_stock;
      END IF;
      v_total := v_total + ((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric);
    END IF;
  END LOOP;

  IF v_payment_type = 'full' THEN v_amount_paid := v_total; END IF;
  v_outstanding := greatest(v_total - v_amount_paid, 0);

  INSERT INTO sales(sale_number, customer_id, customer_name, historical_customer_name,
    historical_customer_phone, historical_customer_address,
    employee_id, employee_name, subtotal, tax_amount, total_amount, amount_paid,
    outstanding_balance, payment_type, payment_method, note, status)
  VALUES (v_sale_number, v_customer_id, v_customer_name,
    (SELECT name FROM customers WHERE id = v_customer_id),
    (SELECT phone FROM customers WHERE id = v_customer_id),
    (SELECT address FROM customers WHERE id = v_customer_id),
    v_actor_id, coalesce(v_actor_name, 'Staff'), v_total, 0, v_total,
    v_amount_paid, v_outstanding, v_payment_type, v_payment_method, v_note, 'completed')
  RETURNING id INTO v_sale_id;

  -- Deduct stock + write line items (pass 2)
  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    IF v_item->>'variantId' IS NOT NULL AND v_item->>'variantId' != '' THEN
      v_deduction := (v_item->>'qty')::numeric * coalesce((v_item->>'unitSize')::numeric, 1);
      UPDATE products SET stock_qty = stock_qty - v_deduction WHERE id = (v_item->>'productId')::uuid;
    END IF;
    INSERT INTO sale_items(sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, line_total, unit_size, base_unit)
    VALUES (v_sale_id, (v_item->>'productId')::uuid, coalesce(v_item->>'productName',''),
      nullif(v_item->>'variantId','')::uuid, coalesce(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric,
      (v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric,
      coalesce((v_item->>'unitSize')::numeric, 1), coalesce(v_item->>'baseUnit','piece'));
  END LOOP;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = outstanding_balance + v_outstanding,
      total_purchases = total_purchases + v_total, total_paid = total_paid + v_amount_paid
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('sale', 'New sale ' || v_sale_number,
    coalesce(v_actor_name,'Staff') || ' sold to ' || v_customer_name || ' · Rs. ' || v_total::text,
    v_sale_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'totalAmount', v_total, 'amountPaid', v_amount_paid, 'outstandingBalance', v_outstanding);
END;
$$;

-- 10b. create_purchase — atomic purchase + stock increment
CREATE OR REPLACE FUNCTION create_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_purchase_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4) := coalesce((p_payload->>'amountPaid')::numeric,0);
  v_company_id uuid := nullif(p_payload->>'companyId','')::uuid;
  v_company_name text := coalesce(p_payload->>'companyName','');
  v_method payment_method := coalesce((p_payload->>'paymentMethod')::payment_method,'cash');
  v_note text := p_payload->>'note';
  v_payable numeric(14,4);
  v_item jsonb;
  v_stock_addition numeric(14,4);
BEGIN
  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    v_total := v_total + ((v_item->>'qty')::numeric * coalesce((v_item->>'costPrice')::numeric,0));
  END LOOP;
  v_payable := greatest(v_total - v_paid, 0);
  v_number := 'PO-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  INSERT INTO purchases(purchase_number, company_id, company_name, total_amount,
    amount_paid, outstanding_payable, payment_method, note, created_by)
  VALUES (v_number, v_company_id, v_company_name, v_total, v_paid, v_payable, v_method, v_note, v_actor_id)
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    v_stock_addition := (v_item->>'qty')::numeric * coalesce((v_item->>'unitSize')::numeric, 1);
    INSERT INTO purchase_items(purchase_id, product_id, product_name, variant_id, variant_name,
      qty, cost_price, line_total)
    VALUES (v_purchase_id, (v_item->>'productId')::uuid, coalesce(v_item->>'productName',''),
      nullif(v_item->>'variantId','')::uuid, coalesce(v_item->>'variantName',''),
      (v_item->>'qty')::numeric, coalesce((v_item->>'costPrice')::numeric,0),
      (v_item->>'qty')::numeric * coalesce((v_item->>'costPrice')::numeric,0));

    UPDATE products SET stock_qty = stock_qty + v_stock_addition WHERE id = (v_item->>'productId')::uuid;
  END LOOP;

  IF v_company_id IS NOT NULL THEN
    UPDATE companies SET total_purchases = total_purchases + v_total,
      outstanding_payable = outstanding_payable + v_payable WHERE id = v_company_id;
  END IF;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id)
  VALUES ('purchase', 'Stock received ' || v_number, v_company_name || ' · Rs. ' || v_total::text, v_purchase_id, v_actor_id);

  RETURN jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_number, 'totalAmount', v_total, 'outstandingPayable', v_payable);
END;
$$;

-- 10c. record_customer_payment
CREATE OR REPLACE FUNCTION record_customer_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_customer_id uuid := (p_payload->>'customerId')::uuid;
  v_amount numeric(14,2) := (p_payload->>'amount')::numeric;
  v_method payment_method := coalesce((p_payload->>'method')::payment_method,'cash');
  v_notes text := p_payload->>'notes';
  v_new_balance numeric(14,2);
  v_pay_id uuid;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_amount, 0),
    total_paid = total_paid + v_amount
  WHERE id = v_customer_id RETURNING outstanding_balance INTO v_new_balance;

  INSERT INTO customer_payments(customer_id, amount, method, notes, recorded_by, recorded_by_name, balance_after)
  VALUES (v_customer_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_balance)
  RETURNING id INTO v_pay_id;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('payment', 'Payment received', 'Rs. ' || v_amount::text || ' collected', v_pay_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_pay_id, 'balanceAfter', v_new_balance);
END;
$$;

-- 10d. record_supplier_payment
CREATE OR REPLACE FUNCTION record_supplier_payment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_company_id uuid := (p_payload->>'companyId')::uuid;
  v_amount numeric(14,2) := (p_payload->>'amount')::numeric;
  v_method payment_method := coalesce((p_payload->>'method')::payment_method,'cash');
  v_notes text := p_payload->>'notes';
  v_new_payable numeric(14,2);
  v_pay_id uuid;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  UPDATE companies SET outstanding_payable = greatest(outstanding_payable - v_amount, 0)
  WHERE id = v_company_id RETURNING outstanding_payable INTO v_new_payable;

  INSERT INTO supplier_payments(company_id, amount, method, notes, recorded_by, recorded_by_name, payable_after)
  VALUES (v_company_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_payable)
  RETURNING id INTO v_pay_id;

  RETURN jsonb_build_object('id', v_pay_id, 'payableAfter', v_new_payable);
END;
$$;

-- 10e. adjust_stock
CREATE OR REPLACE FUNCTION adjust_stock(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_product_id uuid := (p_payload->>'productId')::uuid;
  v_type adjustment_kind := (p_payload->>'adjustmentType')::adjustment_kind;
  v_input numeric(14,4) := coalesce((p_payload->>'qty')::numeric, 0);
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_change numeric(14,4);
  v_pname text := coalesce(p_payload->>'productName','');
  v_adj_id uuid;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND'; END IF;

  v_after := CASE
    WHEN v_type = 'add'    THEN v_before + v_input
    WHEN v_type = 'remove' THEN v_before - v_input
    ELSE v_input
  END;
  IF v_after < 0 THEN RAISE EXCEPTION 'NEGATIVE_STOCK: result %', v_after; END IF;
  v_change := v_after - v_before;

  UPDATE products SET stock_qty = v_after WHERE id = v_product_id;

  INSERT INTO stock_adjustments(product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, adjusted_by_name)
  VALUES (v_product_id, v_pname, nullif(p_payload->>'variantId','')::uuid, coalesce(p_payload->>'variantName',''),
    v_type, v_before, v_change, v_after, p_payload->>'reason', v_actor_id, v_actor_name)
  RETURNING id INTO v_adj_id;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('stock_adjust', 'Stock adjusted', v_pname || ' → ' || v_after::text || ' units',
    v_product_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_adj_id, 'qtyBefore', v_before, 'qtyChange', v_change, 'qtyAfter', v_after);
END;
$$;

-- 10f. create_product
CREATE OR REPLACE FUNCTION create_product(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_product_id uuid;
  v_item jsonb;
BEGIN
  INSERT INTO products(name, company, category, image_url, barcode, base_unit, created_by)
  VALUES (p_payload->>'name', coalesce(p_payload->>'company',''),
    coalesce((p_payload->>'category')::product_category,'other'),
    nullif(p_payload->>'imageUrl',''), nullif(p_payload->>'barcode',''),
    coalesce(p_payload->>'baseUnit','piece'), v_actor_id)
  RETURNING id INTO v_product_id;

  FOR v_item IN SELECT jsonb_array_elements(p_payload->'variants') LOOP
    INSERT INTO product_variants(product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold,
      unit_size, qty_step)
    VALUES (v_product_id, v_item->>'name',
      coalesce((v_item->>'sellingPrice')::numeric,0),
      coalesce((v_item->>'costPrice')::numeric,0),
      0,
      greatest(coalesce((v_item->>'lowStockThreshold')::int,5),0),
      coalesce((v_item->>'unitSize')::numeric, 1),
      coalesce((v_item->>'qtyStep')::numeric, 1));
  END LOOP;

  RETURN jsonb_build_object('id', v_product_id);
END;
$$;

-- 10g. process_return
CREATE OR REPLACE FUNCTION process_return(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_return_id uuid;
  v_number text;
  v_sale_id uuid := nullif(p_payload->>'saleId','')::uuid;
  v_customer_id uuid := nullif(p_payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(p_payload->>'customerName','');
  v_total numeric(14,2) := 0;
  v_item jsonb;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    v_total := v_total + ((v_item->>'qty')::numeric * coalesce((v_item->>'unitPrice')::numeric,0));
  END LOOP;
  v_number := 'RET-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  INSERT INTO returns(return_number, sale_id, customer_id, customer_name, total_refund,
    resolution, note, processed_by, processed_by_name)
  VALUES (v_number, v_sale_id, v_customer_id, v_customer_name, v_total,
    coalesce(p_payload->>'resolution','refund'), p_payload->>'note', v_actor_id, v_actor_name)
  RETURNING id INTO v_return_id;

  FOR v_item IN SELECT jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, variant_id,
      variant_name, qty, unit_price, line_total, refund_amount, restock)
    VALUES (v_return_id, nullif(v_item->>'saleItemId','')::uuid, nullif(v_item->>'productId','')::uuid,
      coalesce(v_item->>'productName',''), nullif(v_item->>'variantId','')::uuid,
      coalesce(v_item->>'variantName',''), (v_item->>'qty')::numeric,
      coalesce((v_item->>'unitPrice')::numeric,0),
      (v_item->>'qty')::numeric * coalesce((v_item->>'unitPrice')::numeric,0),
      coalesce((v_item->>'refundAmount')::numeric, 0),
      coalesce((v_item->>'restock')::boolean, true));
    IF coalesce((v_item->>'restock')::boolean, true) AND v_item->>'variantId' IS NOT NULL THEN
      UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric
      WHERE id = (v_item->>'productId')::uuid;
    END IF;
  END LOOP;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_total, 0),
      total_purchases = greatest(total_purchases - v_total, 0) WHERE id = v_customer_id;
  END IF;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('return', 'Return ' || v_number, v_customer_name || ' · Rs. ' || v_total::text,
    v_return_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_return_id, 'returnNumber', v_number, 'totalRefund', v_total);
END;
$$;

-- 10h. void_sale
CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_sale record;
  v_item record;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'ALREADY_VOIDED'; END IF;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor_id,
    voided_by_name = v_actor_name, void_reason = p_reason, status = 'voided'
  WHERE id = p_sale_id;

  INSERT INTO voids(sale_id, reason, notes, voided_by) VALUES (p_sale_id, p_reason, p_notes, v_actor_id);

  -- Restore stock using historical unit_size
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    UPDATE products SET stock_qty = stock_qty + (v_item.qty * coalesce(v_item.unit_size, 1))
    WHERE id = v_item.product_id;
  END LOOP;

  -- Reverse customer balance
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_sale.outstanding_balance, 0),
      total_purchases = greatest(total_purchases - v_sale.total_amount, 0),
      total_paid = greatest(total_paid - v_sale.amount_paid, 0)
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('sale', 'Sale voided ' || v_sale.sale_number,
    v_actor_name || ' voided sale · Rs. ' || v_sale.total_amount::text, p_sale_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('ok', true, 'saleId', p_sale_id);
END;
$$;

-- 10i. archive_customer
CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  UPDATE customers SET is_archived = true, archived_at = now(), archived_by = v_actor_id WHERE id = p_customer_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 10j. restore_customer
CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  UPDATE customers SET is_archived = false, archived_at = NULL, archived_by = NULL WHERE id = p_customer_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 10k. generate_barcode
CREATE OR REPLACE FUNCTION generate_barcode()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := 'AG' || lpad((floor(random() * 999999999))::text, 9, '0');
    SELECT EXISTS(SELECT 1 FROM products WHERE barcode = v_code) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 11: GRANTS
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION create_sale(jsonb)              TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION record_supplier_payment(jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb)             TO authenticated;
GRANT EXECUTE ON FUNCTION create_product(jsonb)           TO authenticated;
GRANT EXECUTE ON FUNCTION process_return(jsonb)           TO authenticated;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION archive_customer(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION restore_customer(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION generate_barcode()              TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 12: REALTIME PUBLICATIONS
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sales; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE sale_items; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE product_variants; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customers; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE customer_payments; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE purchases; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE stock_adjustments; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE returns; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SECTION 13: STORAGE BUCKETS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public) VALUES ('product-images','product-images', true) ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('employee-photos','employee-photos', true) ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('company-logos','company-logos', true) ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('customer-images','customer-images', true) ON CONFLICT(id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "images public read" ON storage.objects
    FOR SELECT USING (bucket_id IN ('product-images','employee-photos','company-logos','customer-images'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "images auth write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id IN ('product-images','employee-photos','company-logos','customer-images'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "images auth update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id IN ('product-images','employee-photos','company-logos','customer-images'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "images auth delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id IN ('product-images','employee-photos','company-logos','customer-images'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- DONE! All tables, functions, policies, indexes, and storage created.
-- Next: seed an admin user + sample data via the app or another SQL script.
-- ============================================================================
