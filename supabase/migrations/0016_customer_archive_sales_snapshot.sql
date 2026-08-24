-- Migration 0016: Customer Archive, Sales Snapshot, Pagination, Void Audit
-- Reuses existing architecture. Minimal changes.

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Customer Archive (instead of delete)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_by uuid;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Sales — historical customer snapshot
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add snapshot columns to sales for historical safety
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_address text;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Performance Indexes for pagination & filtering
-- ═══════════════════════════════════════════════════════════════════════════════

-- Sales: date, status, customer, employee filtering
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_is_voided ON sales (is_voided);
CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales (employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales (payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_composite_date_status ON sales (created_at DESC, is_voided);

-- Sale items by sale (for joining)
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);

-- Customers: archive status, search
CREATE INDEX IF NOT EXISTS idx_customers_is_archived ON customers (is_archived);
CREATE INDEX IF NOT EXISTS idx_customers_name_phone ON customers (name, phone);

-- Products: barcode lookup
CREATE INDEX IF NOT EXISTS idx_products_barcode_lookup ON products (barcode) WHERE barcode IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Archive Customer RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer record;
BEGIN
  SELECT id, name INTO v_customer FROM customers WHERE id = p_customer_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;

  UPDATE customers
  SET is_archived = true, archived_at = now(), archived_by = p_archived_by
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'archived', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Restore Customer RPC
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE customers
  SET is_archived = false, archived_at = NULL, archived_by = NULL
  WHERE id = p_customer_id;

  RETURN jsonb_build_object('id', p_customer_id, 'restored', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 6: Void Sale RPC (atomic, with audit, inventory restore)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_historical_unit_size numeric(10,4);
  v_restore_qty numeric(14,4);
BEGIN
  -- Get the sale
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;

  -- Restore inventory using HISTORICAL unitSize from sale_items
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id
  LOOP
    -- Use the historical unit_size from the sale item (not current variant)
    v_historical_unit_size := COALESCE(v_item.unit_size, 1);
    v_restore_qty := ROUND(v_item.qty * v_historical_unit_size, 4);

    UPDATE products
    SET stock_qty = ROUND(stock_qty + v_restore_qty, 4)
    WHERE id = v_item.product_id;
  END LOOP;

  -- Restore customer balance if credit sale
  IF v_sale.customer_id IS NOT NULL AND v_sale.payment_type != 'full' THEN
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - (v_sale.total_amount - v_sale.amount_paid))
    WHERE id = v_sale.customer_id;
  END IF;

  -- Mark sale as voided
  UPDATE sales
  SET is_voided = true,
      voided_at = now(),
      voided_by = p_voided_by,
      void_reason = p_reason
  WHERE id = p_sale_id;

  -- Record in audit log (using existing activity_log table if it exists)
  INSERT INTO activity_log (id, actor_id, action, entity_type, entity_id, details, created_at)
  VALUES (
    gen_random_uuid(), p_voided_by, 'void_sale', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'sale_number', v_sale.sale_number),
    now()
  );

  RETURN jsonb_build_object('id', p_sale_id, 'voided', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 7: Populate historical snapshots on existing sales
-- ═══════════════════════════════════════════════════════════════════════════════

-- Fill customer_phone and customer_address from current customer data
-- for sales that don't have snapshots yet
UPDATE sales s
SET customer_phone = c.phone,
    customer_address = c.address
FROM customers c
WHERE s.customer_id = c.id
  AND s.customer_phone IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 8: Grant permissions
-- ═══════════════════════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION archive_customer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_customer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;
