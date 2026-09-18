-- Fix create_sale to match actual sales table schema
-- Previous migration 0099 used wrong column names (customer_name, subtotal, total, outstanding)
-- Actual columns: customer_name_snapshot, total_amount, amount_due, payment_type, status

DROP FUNCTION IF EXISTS create_sale(jsonb);

CREATE OR REPLACE FUNCTION create_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4) := 0;
  v_item jsonb;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;
  v_customer_id := NULLIF(payload->>'customerId', '')::uuid;
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  v_sale_number := 'SALE-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  INSERT INTO sales (
    id, sale_number, customer_id, customer_name_snapshot,
    employee_id, employee_name, total_amount, discount,
    payment_type, payment_method, amount_paid, amount_due,
    status, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_sale_number, v_customer_id,
    COALESCE((SELECT name FROM customers WHERE id = v_customer_id), COALESCE(payload->>'customerName', 'Walk-in')),
    v_actor,
    COALESCE(payload->>'employeeName', (SELECT name FROM users WHERE id = v_actor)),
    0, 0,
    COALESCE(payload->>'paymentType', 'full')::payment_type,
    COALESCE(payload->>'paymentMethod', 'cash')::payment_method,
    v_paid, 0,
    'completed', v_shop_id, now(), now()
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_total := v_total + ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2);

    INSERT INTO sale_items (
      id, sale_id, product_id, variant_id, product_name, variant_name,
      qty, unit_price, unit_size, base_unit, line_total
    ) VALUES (
      gen_random_uuid(), v_sale_id,
      NULLIF(v_item->>'productId', '')::uuid,
      NULLIF(v_item->>'variantId', '')::uuid,
      v_item->>'productName', COALESCE(v_item->>'variantName', ''),
      (v_item->>'qty')::numeric, (v_item->>'unitPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1),
      COALESCE(v_item->>'baseUnit', 'piece'),
      ROUND((v_item->>'qty')::numeric * (v_item->>'unitPrice')::numeric, 2)
    );

    -- Deduct stock from variant
    IF (v_item->>'variantId')::uuid IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty - (v_item->>'qty')::numeric
        WHERE id = (v_item->>'variantId')::uuid;
    END IF;
  END LOOP;

  -- Update totals
  UPDATE sales SET
    total_amount = v_total,
    amount_due = GREATEST(0, v_total - v_paid),
    updated_at = now()
  WHERE id = v_sale_id;

  -- Update customer outstanding balance
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      outstanding_balance = outstanding_balance + (v_total - v_paid),
      total_purchases = total_purchases + v_total,
      updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_sale_id, 'saleNumber', v_sale_number,
    'totalAmount', v_total, 'amountPaid', v_paid,
    'outstandingBalance', GREATEST(0, v_total - v_paid)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO anon;
