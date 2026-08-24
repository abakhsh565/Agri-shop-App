-- Fix existing RPC functions to include shop_id after migration 0009 added NOT NULL shop_id columns
-- These replace the functions from migration 0004 with shop_id-aware versions

-- update_updated_at_column trigger function (already in 0009 but ensuring idempotency)
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ language 'plpgsql';

-- create_sale — now includes shop_id
CREATE OR REPLACE FUNCTION create_sale(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_amount_paid numeric(14,2) := coalesce((payload->>'amountPaid')::numeric, 0);
  v_customer_id uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','Walk-in');
  v_payment_type payment_type := coalesce((payload->>'paymentType')::payment_type,'full');
  v_payment_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note text := payload->>'note';
  v_outstanding numeric(14,2);
  item jsonb;
  v_variant_id uuid;
  v_product_id uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_stock integer;
  v_vname text;
  v_cogs_total numeric(14,2) := 0;
BEGIN
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  v_sale_number := 'SL-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    IF v_variant_id IS NOT NULL THEN
      SELECT stock_qty, selling_price, cost_price, name INTO v_stock, v_price, v_cost, v_vname
        FROM product_variants WHERE id = v_variant_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'VARIANT_NOT_FOUND'; END IF;
      IF v_stock < v_qty THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK: % (have %, need %)', coalesce(v_vname,''), v_stock, v_qty; END IF;
    ELSE
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_cost := 0;
    END IF;
    v_subtotal := v_subtotal + (v_price * v_qty);
    v_cogs_total := v_cogs_total + (v_cost * v_qty);
  END LOOP;

  v_total := v_subtotal;
  IF v_payment_type = 'full' THEN v_amount_paid := v_total; END IF;
  v_outstanding := greatest(v_total - v_amount_paid, 0);

  INSERT INTO sales(shop_id, sale_number, customer_id, customer_name, employee_id, employee_name,
    subtotal, tax_amount, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note)
  VALUES (v_shop_id, v_sale_number, v_customer_id, v_customer_name, v_actor_id,
    coalesce(v_actor_name, payload->>'employeeName','Staff'),
    v_subtotal, 0, v_total, v_amount_paid, v_outstanding,
    v_payment_type, v_payment_method, v_note)
  RETURNING id INTO v_sale_id;

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_product_id := nullif(item->>'productId','')::uuid;
    v_qty := (item->>'qty')::int;
    IF v_variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty - v_qty WHERE id = v_variant_id
        RETURNING selling_price, cost_price, name INTO v_price, v_cost, v_vname;
    ELSE
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_cost := 0;
      v_vname := item->>'variantName';
    END IF;
    INSERT INTO sale_items(sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, line_total, cogs_amount)
    VALUES (v_sale_id, v_product_id, coalesce(item->>'productName',''), v_variant_id,
      coalesce(v_vname, item->>'variantName',''), v_qty, v_price, v_price * v_qty, v_cost * v_qty);

    IF v_variant_id IS NOT NULL THEN
      INSERT INTO inventory_movements(variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by)
      SELECT v_variant_id, 'sale', stock_qty + v_qty, -v_qty, stock_qty,
        'sale', v_sale_id, v_cost, v_actor_id
      FROM product_variants WHERE id = v_variant_id;
    END IF;
  END LOOP;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = outstanding_balance + v_outstanding,
      total_purchases = total_purchases + v_total, total_paid = total_paid + v_amount_paid
      WHERE id = v_customer_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'sale_created', 'sale', v_sale_id,
    jsonb_build_object('total', v_total, 'customer', v_customer_name, 'items', jsonb_array_length(payload->'items')));

  INSERT INTO notifications(kind, title, body, entity_id, actor_id, actor_name)
  VALUES ('sale', 'New sale ' || v_sale_number,
    coalesce(v_actor_name,'Staff') || ' sold to ' || v_customer_name || ' Rs. ' || v_total::text,
    v_sale_id, v_actor_id, v_actor_name);

  RETURN jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'subtotal', v_subtotal, 'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_outstanding, 'cogsTotal', v_cogs_total);
END; $$;

-- create_purchase — now includes shop_id
CREATE OR REPLACE FUNCTION create_purchase(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_shop_id uuid := current_shop_id();
  v_purchase_id uuid;
  v_number text;
  v_total numeric(14,2) := 0;
  v_paid numeric(14,2) := coalesce((payload->>'amountPaid')::numeric,0);
  v_company_id uuid := nullif(payload->>'companyId','')::uuid;
  v_company_name text := coalesce(payload->>'companyName','');
  v_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note text := payload->>'note';
  v_payable numeric(14,2);
  item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_cost numeric(12,2);
  v_before integer;
BEGIN
  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_qty := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    v_total := v_total + (v_qty * v_cost);
  END LOOP;
  v_payable := greatest(v_total - v_paid, 0);
  v_number := 'PO-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  INSERT INTO purchases(shop_id, purchase_number, company_id, company_name, total_amount,
    amount_paid, outstanding_payable, payment_method, note, created_by)
  VALUES (v_shop_id, v_number, v_company_id, v_company_name, v_total, v_paid, v_payable, v_method, v_note, v_actor_id)
  RETURNING id INTO v_purchase_id;

  FOR item IN SELECT jsonb_array_elements(payload->'items') LOOP
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    INSERT INTO purchase_items(purchase_id, product_id, product_name, variant_id, variant_name,
      qty, cost_price, line_total)
    VALUES (v_purchase_id, nullif(item->>'productId','')::uuid, coalesce(item->>'productName',''),
      v_variant_id, coalesce(item->>'variantName',''), v_qty, v_cost, v_qty*v_cost);
    IF v_variant_id IS NOT NULL THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_variant_id FOR UPDATE;
      UPDATE product_variants SET stock_qty = stock_qty + v_qty,
        cost_price = case when v_cost > 0 then v_cost else cost_price end WHERE id = v_variant_id;
      INSERT INTO inventory_movements(variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by)
      VALUES (v_variant_id, 'purchase', v_before, v_qty, v_before + v_qty, 'purchase', v_purchase_id, v_cost, v_actor_id);
    END IF;
  END LOOP;

  IF v_company_id IS NOT NULL THEN
    UPDATE companies SET total_purchases = total_purchases + v_total,
      o
utstanding_payable = outstanding_payable + v_payable WHERE id = v_company_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'purchase_created', 'purchase', v_purchase_id,
    jsonb_build_object('total', v_total, 'company', v_company_name));

  INSERT INTO notifications(kind,title,body,entity_id,actor_id)
  VALUES ('purchase','Stock received '||v_number, v_company_name||' Rs. '||v_total::text, v_purchase_id, v_actor_id);

  RETURN jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_number,
    'totalAmount', v_total, 'outstandingPayable', v_payable);
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION create_sale(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(jsonb) TO authenticated;
