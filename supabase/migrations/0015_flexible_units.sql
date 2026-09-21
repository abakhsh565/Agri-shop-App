-- Migration 0015: Flexible Units & Pricing Model
-- Single source of truth: products.stock_qty (in base units)
-- Variants define sellable units (unitSize, qtyStep) with independent pricing

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

-- Products: add base unit and stock (single source of truth)
ALTER TABLE products ADD COLUMN IF NOT EXISTS base_unit text NOT NULL DEFAULT 'piece';
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_qty numeric(14,4) NOT NULL DEFAULT 0;

-- Add CHECK constraint: stock_qty cannot be negative
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_stock_qty_non_negative CHECK (stock_qty >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Product variants: add unit_size and qty_step
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS unit_size numeric(10,4) NOT NULL DEFAULT 1;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS qty_step numeric(10,4) NOT NULL DEFAULT 1;

-- Add CHECK constraints
DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT variants_unit_size_positive CHECK (unit_size > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE product_variants ADD CONSTRAINT variants_qty_step_positive CHECK (qty_step > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sale items: snapshot unit_size and base_unit for historical integrity
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_size numeric(10,4) DEFAULT 1;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS base_unit text DEFAULT 'piece';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Migrate existing variant stock to product level
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  prod RECORD;
  total_stock numeric;
BEGIN
  FOR prod IN SELECT DISTINCT p.id FROM products p
  LOOP
    SELECT COALESCE(SUM(stock_qty), 0) INTO total_stock
    FROM product_variants
    WHERE product_id = prod.id;

    IF total_stock > 0 THEN
      UPDATE products SET stock_qty = total_stock WHERE id = prod.id;
    END IF;
  END LOOP;
END $$;

-- Set existing variants to unit_size=1, qty_step=1 (backward compatible)
UPDATE product_variants SET unit_size = 1 WHERE unit_size IS NULL;
UPDATE product_variants SET qty_step = 1 WHERE qty_step IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Create product_variants_public view (no cost_price for employees)
-- ═══════════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS product_variants_public;
CREATE VIEW product_variants_public AS
SELECT id, product_id, name, sku, selling_price, unit_size, qty_step,
       low_stock_threshold, expiry_date
FROM product_variants;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Indexes
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_products_base_unit ON products (base_unit);
CREATE INDEX IF NOT EXISTS idx_products_stock_qty ON products (stock_qty);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Atomic RPC — create_sale with oversell guard
-- ═══════════════════════════════════════════════════════════════════════════════
-- Stock deduction happens ATOMICALLY here, never client-side.
-- Uses numeric(14,4) to avoid floating-point accumulation errors.
-- Oversell is rejected by the WHERE stock_qty >= deduction condition.

-- CREATE OR REPLACE cannot change an input parameter's name, and 0012 already
-- created this function as create_sale(payload jsonb). Drop it first, the same
-- way 0025/0027/0028 do, so applying the migrations in order to a fresh database
-- does not stop here with "cannot change name of input parameter payload".
DROP FUNCTION IF EXISTS create_sale(p_payload jsonb);
DROP FUNCTION IF EXISTS create_sale(payload jsonb);

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
  v_total numeric(14,4) := 0;
  v_amount_paid numeric(14,4);
  v_item jsonb;
  v_variant record;
  v_product record;
  v_qty numeric(14,4);
  v_unit_size numeric(10,4);
  v_deduction numeric(14,4);
  v_line_total numeric(14,4);
  v_item_id uuid;
  v_new_stock numeric(14,4);
  v_rows_updated integer;
BEGIN
  v_sale_number := 'SALE-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');
  v_customer_id := NULLIF(p_payload->>'customerId', '')::uuid;
  v_amount_paid := (p_payload->>'amountPaid')::numeric;

  -- Create sale record
  INSERT INTO sales (id, sale_number, customer_id, customer_name, customer_phone, customer_address, employee_id, employee_name,
                     total_amount, amount_paid, outstanding_balance, payment_type, payment_method, note)
  VALUES (
    gen_random_uuid(), v_sale_number, v_customer_id,
    p_payload->>'customerName', p_payload->>'customerPhone', p_payload->>'customerAddress',
    NULLIF(p_payload->>'employeeId', '')::uuid, p_payload->>'employeeName',
    0, v_amount_paid, 0,
    p_payload->>'paymentType', p_payload->>'paymentMethod', p_payload->>'note'
  ) RETURNING id INTO v_sale_id;

  -- Process each line item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := (v_item->>'qty')::numeric;
    v_unit_size := COALESCE((v_item->>'unitSize')::numeric, 1);

    -- Get variant for unit_size
    SELECT id, unit_size INTO v_variant
    FROM product_variants
    WHERE id = NULLIF(v_item->>'variantId', '')::uuid;

    IF v_variant IS NOT NULL THEN
      v_unit_size := v_variant.unit_size;
    END IF;

    -- Get product
    SELECT id, stock_qty INTO v_product
    FROM products
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    IF v_product IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'productId';
    END IF;

    -- Calculate deduction: qty × unitSize (numeric-safe)
    v_deduction := ROUND(v_qty * v_unit_size, 4);
    v_line_total := ROUND(v_qty * (v_item->>'unitPrice')::numeric, 2);
    v_total := v_total + v_line_total;

    -- ATOMIC stock deduction with oversell guard
    -- This UPDATE only succeeds if stock_qty >= deduction (prevents negative stock)
    UPDATE products
    SET stock_qty = ROUND(stock_qty - v_deduction, 4)
    WHERE id = v_product.id
      AND stock_qty >= v_deduction;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
      RAISE EXCEPTION 'Insufficient stock for %: need %, have %',
        (v_item->>'productName'), v_deduction, v_product.stock_qty;
    END IF;

    -- Insert sale line with snapshot
    v_item_id := gen_random_uuid();
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name,
                            qty, unit_price, unit_size, base_unit, line_total)
    VALUES (
      v_item_id, v_sale_id,
      v_product.id, (v_item->>'productName'),
      COALESCE(NULLIF(v_item->>'variantId', '')::uuid, v_variant.id),
      (v_item->>'variantName'), v_qty,
      (v_item->>'unitPrice')::numeric, v_unit_size,
      COALESCE((v_item->>'baseUnit'), 'piece'),
      v_line_total
    );
  END LOOP;

  -- Update sale totals
  UPDATE sales
  SET total_amount = v_total, outstanding_balance = v_total - v_amount_paid
  WHERE id = v_sale_id;

  -- Update customer balance
  IF v_customer_id IS NOT NULL THEN
    IF (p_payload->>'paymentType') != 'full' THEN
      UPDATE customers
      SET outstanding_balance = outstanding_balance + (v_total - v_amount_paid),
          total_purchases = total_purchases + v_total,
          total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
    ELSE
      UPDATE customers
      SET total_purchases = total_purchases + v_total,
          total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_sale_id, 'saleNumber', v_sale_number,
    'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_total - v_amount_paid
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: Atomic RPC — create_purchase (adds product-level stock)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Same rename problem as create_sale above: 0012 created this as
-- create_purchase(payload jsonb), and CREATE OR REPLACE cannot rename it.
DROP FUNCTION IF EXISTS create_purchase(p_payload jsonb);
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);

CREATE OR REPLACE FUNCTION create_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_id uuid;
  v_purchase_number text;
  v_company_id uuid;
  v_total numeric(14,4) := 0;
  v_amount_paid numeric(14,4);
  v_item jsonb;
  v_item_id uuid;
BEGIN
  v_purchase_number := 'PUR-' || LPAD(FLOOR(RANDOM() * 99999)::text, 5, '0');
  v_company_id := NULLIF(p_payload->>'companyId', '')::uuid;
  v_amount_paid := (p_payload->>'amountPaid')::numeric;

  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount,
                         amount_paid, outstanding_payable, payment_method, note, created_by)
  VALUES (
    gen_random_uuid(), v_purchase_number, v_company_id, p_payload->>'companyName',
    0, v_amount_paid, 0, p_payload->>'paymentMethod', p_payload->>'note',
    NULLIF(p_payload->>'createdBy', '')::uuid
  ) RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2);

    -- Add stock to PRODUCT level (qty is in base units from purchase)
    UPDATE products
    SET stock_qty = ROUND(stock_qty + (v_item->>'qty')::numeric, 4)
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    v_item_id := gen_random_uuid();
    INSERT INTO purchase_items (id, purchase_id, product_id, product_name, variant_id, variant_name,
                                qty, cost_price, line_total)
    VALUES (
      v_item_id, v_purchase_id,
      NULLIF(v_item->>'productId', '')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid, v_item->>'variantName',
      (v_item->>'qty')::numeric, (v_item->>'costPrice')::numeric,
      ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2)
    );
  END LOOP;

  UPDATE purchases
  SET total_amount = v_total, outstanding_payable = v_total - v_amount_paid
  WHERE id = v_purchase_id;

  IF v_company_id IS NOT NULL THEN
    UPDATE companies
    SET outstanding_payable = outstanding_payable + (v_total - v_amount_paid),
        total_purchases = total_purchases + v_total
    WHERE id = v_company_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_purchase_id, 'purchaseNumber', v_purchase_number,
    'totalAmount', v_total, 'outstandingPayable', v_total - v_amount_paid
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: Atomic RPC — adjust_stock (adjusts product-level stock)
-- ═══════════════════════════════════════════════════════════════════════════════

-- This file is the first to define adjust_stock in the repository, so the only
-- thing it can collide with is an adjust_stock that already exists in the
-- database — which is exactly the case on a Supabase preview branch, since the
-- branch is forked from the project's current schema and the versions above are
-- not recorded there. Drop whatever signature exists before redefining.
DROP FUNCTION IF EXISTS adjust_stock(p_payload jsonb);
DROP FUNCTION IF EXISTS adjust_stock(payload jsonb);

CREATE OR REPLACE FUNCTION adjust_stock(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
  v_product record;
  v_before numeric(14,4);
  v_after numeric(14,4);
  v_change numeric(14,4);
  v_adj_type text;
  v_qty numeric(14,4);
  v_reason text;
BEGIN
  v_product_id := NULLIF(p_payload->>'productId', '')::uuid;
  v_adj_type := p_payload->>'adjustmentType';
  v_qty := (p_payload->>'qty')::numeric;
  v_reason := p_payload->>'reason';

  SELECT id, stock_qty, name INTO v_product FROM products WHERE id = v_product_id;
  IF v_product IS NULL THEN RAISE EXCEPTION 'Product not found'; END IF;

  v_before := v_product.stock_qty;

  IF v_adj_type = 'add' THEN
    v_after := ROUND(v_before + v_qty, 4);
  ELSIF v_adj_type = 'remove' THEN
    v_after := GREATEST(0, ROUND(v_before - v_qty, 4));
  ELSE
    v_after := v_qty;
  END IF;

  v_change := ROUND(v_after - v_before, 4);

  UPDATE products SET stock_qty = v_after WHERE id = v_product_id;

  INSERT INTO stock_adjustments (id, product_id, product_name, adjustment_type,
                                 qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (gen_random_uuid(), v_product_id, v_product.name, v_adj_type,
          v_before, v_change, v_after, v_reason, NULLIF(p_payload->>'adjustedBy', '')::uuid, now());

  -- Notify admin of stock adjustment
  INSERT INTO notifications(kind, title, body, entity_id, actor_id)
  VALUES ('stock_adjust',
    'Stock adjusted: ' || v_product.name,
    v_product.name || ' ' || v_adj_type || ' ' || abs(v_change)::text || ' → ' || v_after::text || ' units',
    v_product_id,
    NULLIF(p_payload->>'adjustedBy', '')::uuid);

  RETURN jsonb_build_object('qtyBefore', v_before, 'qtyChange', v_change, 'qtyAfter', v_after);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Atomic RPC — process_return (restores stock using historical unitSize)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Same rename problem: 0014 created this as process_return(payload jsonb).
DROP FUNCTION IF EXISTS process_return(p_payload jsonb);
DROP FUNCTION IF EXISTS process_return(payload jsonb);

CREATE OR REPLACE FUNCTION process_return(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_customer_id uuid;
  v_total_refund numeric(14,4) := 0;
  v_item jsonb;
  v_sale record;
  v_return_id uuid;
  v_historical_unit_size numeric(10,4);
  v_return_qty numeric(14,4);
  v_restored numeric(14,4);
BEGIN
  v_sale_id := NULLIF(p_payload->>'saleId', '')::uuid;
  v_customer_id := NULLIF(p_payload->>'customerId', '')::uuid;

  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;

  v_return_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_return_qty := (v_item->>'qty')::numeric;
    v_total_refund := v_total_refund + ROUND(v_return_qty * (v_item->>'unitPrice')::numeric, 2);

    -- Use HISTORICAL unitSize from the original sale_items record (not current variant)
    -- This ensures editing a variant later does not alter historical returns
    SELECT COALESCE(si.unit_size, 1) INTO v_historical_unit_size
    FROM sale_items si
    WHERE si.id = NULLIF(v_item->>'saleItemId', '')::uuid;

    IF v_historical_unit_size IS NULL THEN
      -- Fallback: try to get from current variant (legacy data)
      SELECT COALESCE(v.unit_size, 1) INTO v_historical_unit_size
      FROM product_variants v
      WHERE v.id = NULLIF(v_item->>'variantId', '')::uuid;
    END IF;

    -- Restore stock: returnQty × historicalUnitSize
    v_restored := ROUND(v_return_qty * v_historical_unit_size, 4);

    UPDATE products
    SET stock_qty = ROUND(stock_qty + v_restored, 4)
    WHERE id = NULLIF(v_item->>'productId', '')::uuid;

    INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name,
                              variant_id, variant_name, qty, unit_price, refund_amount)
    VALUES (
      gen_random_uuid(), v_return_id,
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'productId', '')::uuid, v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid, v_item->>'variantName',
      v_return_qty, (v_item->>'unitPrice')::numeric,
      ROUND(v_return_qty * (v_item->>'unitPrice')::numeric, 2)
    );
  END LOOP;

  INSERT INTO returns (id, sale_id, sale_number, customer_id, customer_name,
                       total_refund, resolution, processed_by, created_at)
  VALUES (v_return_id, v_sale_id, v_sale.sale_number, v_customer_id, v_sale.customer_name,
          v_total_refund, p_payload->>'resolution', NULLIF(p_payload->>'processedBy', '')::uuid, now());

  IF v_customer_id IS NOT NULL THEN
    IF (p_payload->>'resolution') = 'credit_note' THEN
      UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_refund)
      WHERE id = v_customer_id;
    ELSIF (p_payload->>'resolution') = 'refund_cash' THEN
      UPDATE customers SET total_paid = total_paid + v_total_refund WHERE id = v_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_return_id, 'totalRefund', v_total_refund);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 9: Grant permissions
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;
