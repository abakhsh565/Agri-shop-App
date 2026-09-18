-- Fix create_purchase to match actual purchases table schema
-- Actual columns: id, purchase_number, company_id, company_name, total_amount,
--   amount_paid, amount_due, due_date, status, notes, recorded_by, recorded_by_name,
--   created_at, shop_id, updated_at

DROP FUNCTION IF EXISTS create_purchase(jsonb);

CREATE OR REPLACE FUNCTION create_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_shop_id uuid;
  v_resolved jsonb;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;

  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);

  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;

  INSERT INTO purchases (
    id, purchase_number, company_id, company_name, total_amount,
    amount_paid, amount_due, status, notes, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_number,
    NULLIF(payload->>'companyId', '')::uuid,
    COALESCE(v_company_name, 'Unknown'),
    0, v_paid, 0,
    'completed',
    payload->>'note',
    v_shop_id, now(), now()
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_total := v_total + (v_item->>'lineTotal')::numeric;

    INSERT INTO purchase_items (
      id, purchase_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, unit_size, base_unit, line_total
    ) VALUES (
      gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId', '')::uuid,
      v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid,
      COALESCE(v_item->>'variantName', ''),
      (v_item->>'qty')::numeric,
      (v_item->>'costPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1),
      COALESCE(v_item->>'baseUnit', 'piece'),
      (v_item->>'lineTotal')::numeric
    );

    -- Add stock to variant
    IF (v_item->>'variantId')::uuid IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty + (v_item->>'qty')::numeric
        WHERE id = (v_item->>'variantId')::uuid;
    END IF;
  END LOOP;

  -- Update totals
  UPDATE purchases SET
    total_amount = v_total,
    amount_due = GREATEST(0, v_total - v_paid),
    updated_at = now()
  WHERE id = v_id;

  -- Update company payable
  IF NULLIF(payload->>'companyId', '') IS NOT NULL THEN
    UPDATE companies SET
      outstanding_payable = outstanding_payable + (v_total - v_paid),
      total_purchases = total_purchases + v_total,
      updated_at = now()
    WHERE id = (payload->>'companyId')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'purchaseNumber', v_number,
    'totalAmount', v_total, 'outstandingPayable', GREATEST(0, v_total - v_paid)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO anon;


-- Fix process_return to match actual returns/return_items table schemas
-- returns: id, sale_id, customer_id, refund_amount, reason, processed_by,
--   processed_by_name, status, created_at, shop_id, updated_at,
--   idempotency_key, return_number, customer_name, total_refund,
--   resolution, note
-- return_items: id, return_id, sale_item_id, product_id, product_name,
--   variant_id, variant_name, qty_to_return, unit_price, refund_amount,
--   created_at

DROP FUNCTION IF EXISTS process_return(jsonb);

CREATE OR REPLACE FUNCTION process_return(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_return_number text;
  v_sale_id uuid;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_item jsonb;
  v_shop_id uuid;
  v_resolution text;
  v_reason text;
  v_processed_by uuid;
BEGIN
  v_sale_id := NULLIF(payload->>'saleId', '')::uuid;
  v_customer_id := NULLIF(payload->>'customerId', '')::uuid;
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := payload->>'reason';
  v_processed_by := COALESCE(
    NULLIF(payload->>'processedBy', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );

  SELECT COALESCE(shop_id, '00000000-0000-0000-0000-000000000001')
    INTO v_shop_id FROM sales WHERE id = v_sale_id;

  v_return_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  INSERT INTO returns (
    id, return_number, sale_id, customer_id, customer_name,
    total_refund, resolution, reason, processed_by, processed_by_name,
    shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_return_number, v_sale_id, v_customer_id,
    COALESCE(payload->>'customerName', 'Customer'),
    0, v_resolution, v_reason, v_processed_by,
    (SELECT name FROM users WHERE id = v_processed_by),
    v_shop_id, now(), now()
  )
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);

    INSERT INTO return_items (
      id, return_id, sale_item_id, product_id, product_name,
      variant_id, variant_name, qty_to_return, unit_price, refund_amount,
      created_at
    ) VALUES (
      gen_random_uuid(), v_id,
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'productId', '')::uuid,
      v_item->>'productName',
      NULLIF(v_item->>'variantId', '')::uuid,
      COALESCE(v_item->>'variantName', ''),
      (v_item->>'qty')::numeric,
      (v_item->>'unitPrice')::numeric,
      ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2),
      now()
    );

    -- Restock if requested
    IF COALESCE((v_item->>'restock')::boolean, false) THEN
      IF (v_item->>'variantId')::uuid IS NOT NULL THEN
        UPDATE product_variants SET stock_qty = stock_qty + (v_item->>'qty')::numeric
          WHERE id = (v_item->>'variantId')::uuid;
      END IF;
    END IF;
  END LOOP;

  -- Update return total
  UPDATE returns SET total_refund = v_total WHERE id = v_id;

  -- Update customer outstanding (refund reduces outstanding)
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      outstanding_balance = GREATEST(0, outstanding_balance - v_total),
      updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'returnNumber', v_return_number,
    'totalRefund', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_return(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION process_return(jsonb) TO anon;
