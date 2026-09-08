-- 0047: Fix purchase_items schema + create_purchase RPC
-- Two issues:
-- 1. purchase_items.unit_size column missing (RPC tries to INSERT it)
-- 2. create_purchase RPC reads lineTotal from payload but frontend doesn't send it,
--    causing NULL line_total and NULL total_amount

-- 1. Add missing unit_size column
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS unit_size numeric(14,4) NOT NULL DEFAULT 1;

-- 2. Fix create_purchase RPC to calculate line_total from qty * costPrice
DROP FUNCTION IF EXISTS create_purchase(payload jsonb);
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_line_total numeric(14,4);
BEGIN
  v_number := 'PUR-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');
  v_paid := COALESCE((payload->>'amountPaid')::numeric, 0);
  SELECT name INTO v_company_name FROM companies WHERE id = (payload->>'companyId')::uuid;

  INSERT INTO purchases (id, purchase_number, company_id, company_name, total_amount, amount_paid,
    outstanding_payable, payment_method, note, shop_id, created_at, updated_at)
  VALUES (gen_random_uuid(), v_number,
    NULLIF(payload->>'companyId','')::uuid,
    COALESCE(v_company_name, 'Unknown'),
    0, v_paid, 0,
    COALESCE(payload->>'paymentMethod','cash')::payment_method,
    payload->>'note',
    '00000000-0000-0000-0000-000000000001',
    now(), now())
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    -- Calculate line_total from qty * costPrice (frontend doesn't send lineTotal)
    v_line_total := ROUND((v_item->>'qty')::numeric * (v_item->>'costPrice')::numeric, 2);
    v_total := v_total + v_line_total;

    INSERT INTO purchase_items (id, purchase_id, product_id, variant_id, product_name, variant_name,
      qty, cost_price, unit_size, line_total)
    VALUES (gen_random_uuid(), v_id,
      NULLIF(v_item->>'productId','')::uuid,
      NULLIF(v_item->>'variantId','')::uuid,
      v_item->>'productName',
      COALESCE(v_item->>'variantName',''),
      (v_item->>'qty')::numeric,
      (v_item->>'costPrice')::numeric,
      COALESCE((v_item->>'unitSize')::numeric, 1),
      v_line_total);

    UPDATE products SET stock_qty = stock_qty + (v_item->>'qty')::numeric * COALESCE((v_item->>'unitSize')::numeric, 1)
    WHERE id = NULLIF(v_item->>'productId','')::uuid;
  END LOOP;

  UPDATE purchases SET total_amount = v_total, outstanding_payable = v_total - v_paid WHERE id = v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable = outstanding_payable + (v_total - v_paid), updated_at = now()
    WHERE id = (payload->>'companyId')::uuid;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'purchaseNumber', v_number, 'total', v_total);
END;
$$;

NOTIFY pgrst, 'reload schema';
