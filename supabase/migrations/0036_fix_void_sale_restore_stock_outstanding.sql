-- ============================================================
-- Migration 0036: Fix void_sale — restore stock + outstanding
--
-- Changes from 0027:
-- 1. Restores products.stock_qty using qty * unit_size per sale_item
-- 2. Reduces customers.outstanding_balance by the unpaid portion
-- 3. Records the void in the voids table
-- 4. Idempotent: rejects if sale is already voided
-- 5. No activity_log dependency (removed obsolete reference)
-- ============================================================

DROP FUNCTION IF EXISTS void_sale(uuid, text, uuid);

CREATE OR REPLACE FUNCTION void_sale(
  p_sale_id uuid,
  p_reason text,
  p_voided_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
BEGIN
  -- Get the sale
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Idempotent: reject if already voided
  IF v_sale.is_voided THEN
    RAISE EXCEPTION 'Sale is already voided';
  END IF;

  -- Validate reason
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Void reason is required';
  END IF;

  -- Restore inventory for each sale item
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_restored_stock := v_restored_stock + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4);
    UPDATE products
    SET stock_qty = ROUND(stock_qty + ROUND(v_item.qty * COALESCE(v_item.unit_size, 1), 4), 4)
    WHERE id = v_item.product_id;
  END LOOP;

  -- Reverse customer outstanding (only for credit/partial sales)
  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid),
        updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  -- Record in voids table
  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (
    gen_random_uuid(),
    p_sale_id,
    p_reason,
    COALESCE(p_voided_by, NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid),
    now()
  ) RETURNING id INTO v_void_id;

  -- Mark sale as voided
  UPDATE sales
  SET is_voided = true,
      voided_at = now(),
      voided_by = COALESCE(p_voided_by, NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid),
      void_reason = p_reason
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'id', v_void_id,
    'saleId', p_sale_id,
    'restoredStock', v_restored_stock,
    'reversedOutstanding', v_unpaid,
    'status', 'voided'
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

GRANT EXECUTE ON FUNCTION void_sale(uuid, text, uuid) TO authenticated;
