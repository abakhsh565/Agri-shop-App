-- New RPC functions: void_sale, cash_reconciliation, deactivate_employee, update/delete product
-- These are ADDITIONS to the existing RPCs in migration 0004

-- void_sale_v1 — Admin-only, time-windowed, reverses stock + balance
CREATE OR REPLACE FUNCTION void_sale_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_sale_id uuid := (payload->>'saleId')::uuid;
  v_reason text := payload->>'reason';
  v_notes text := payload->>'notes';
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_void_window interval;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  -- Get void window from settings (default 24h)
  SELECT (setting_value || ' hours')::interval INTO v_void_window
    FROM app_settings WHERE shop_id = v_sale.shop_id AND setting_key = 'void_window_hours';
  IF v_void_window IS NULL THEN v_void_window := interval '24 hours'; END IF;

  IF (now() - v_sale.created_at) > v_void_window THEN
    RAISE EXCEPTION 'VOID_WINDOW_EXPIRED';
  END IF;

  -- Restore stock
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = v_sale_id LOOP
    IF v_item.variant_id IS NOT NULL THEN
      UPDATE product_variants SET stock_qty = stock_qty + v_item.qty WHERE id = v_item.variant_id;
      INSERT INTO inventory_movements(variant_id,movement_type,qty_before,qty_change,qty_after,reference_type,reference_id,created_by)
      SELECT v_item.variant_id,'void',stock_qty-v_item.qty,v_item.qty,stock_qty,'void',v_sale_id,v_actor_id
      FROM product_variants WHERE id = v_item.variant_id;
    END IF;
  END LOOP;

  -- Reverse customer balance
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = greatest(outstanding_balance - v_sale.outstanding_balance,0),
      total_purchases = greatest(total_purchases - v_sale.total_amount,0),
      total_paid = greatest(total_paid - v_sale.amount_paid,0) WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET is_voided=true, voided_at=now(), voided_by=v_actor_id, void_reason=v_reason WHERE id=v_sale_id;
  INSERT INTO voids(sale_id,reason,notes,voided_by) VALUES (v_sale_id,v_reason,v_notes,v_actor_id) RETURNING id INTO v_void_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'sale_voided','sale',v_sale_id,jsonb_build_object('reason',v_reason,'total',v_sale.total_amount));
  INSERT INTO notifications(kind,title,body,entity_id,actor_id,actor_name) VALUES ('sale','Sale voided '||v_sale.sale_number,coalesce(v_actor_name,'Admin')||' voided Rs. '||v_sale.total_amount::text,v_sale_id,v_actor_id,v_actor_name);

  RETURN jsonb_build_object('id',v_void_id,'saleId',v_sale_id,'status','voided');
END; $$;

-- record_cash_reconciliation_v1 — Admin-only daily cash counting
CREATE OR REPLACE FUNCTION record_cash_reconciliation_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_date date := (payload->>'date')::date;
  v_expected numeric(14,2) := (payload->>'expectedCash')::numeric;
  v_counted numeric(14,2) := (payload->>'countedCash')::numeric;
  v_notes text := payload->>'notes';
  v_recon_id uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT name INTO v_actor_name FROM users WHERE id = v_actor_id;
  INSERT INTO cash_reconciliations(shop_id,reconciliation_date,expected_cash,counted_cash,variance,notes,reconciled_by,reconciled_by_name)
  VALUES (v_shop_id,v_date,v_expected,v_counted,v_counted-v_expected,v_notes,v_actor_id,v_actor_name)
  ON CONFLICT(shop_id,reconciliation_date) DO UPDATE SET expected_cash=EXCLUDED.expected_cash,counted_cash=EXCLUDED.counted_cash,variance=EXCLUDED.variance,notes=EXCLUDED.notes,reconciled_by=EXCLUDED.reconciled_by,reconciled_by_name=EXCLUDED.reconciled_by_name
  RETURNING id INTO v_recon_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'cash_reconciled','cash_reconciliation',v_recon_id,jsonb_build_object('date',v_date,'variance',v_counted-v_expected));
  RETURN jsonb_build_object('id',v_recon_id,'variance',v_counted-v_expected);
END; $$;

-- deactivate_employee_v1 — preserves historical references
CREATE OR REPLACE FUNCTION deactivate_employee_v1(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_emp_id uuid := (payload->>'employeeId')::uuid; v_emp record;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.is_original_owner THEN RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER'; END IF;
  UPDATE users SET is_active=false, deactivated_at=now(), deactivated_by=v_actor_id WHERE id=v_emp_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'employee_deactivated','user',v_emp_id,jsonb_build_object('name',v_emp.name));
  RETURN jsonb_build_object('id',v_emp_id,'isActive',false);
END; $$;

-- update_product_v1 — atomic product + variants update
CREATE OR REPLACE FUNCTION update_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_product_id uuid := (payload->>'id')::uuid; item jsonb;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE products SET name=payload->>'name',company_id=nullif(payload->>'companyId','')::uuid,category=coalesce((payload->>'category')::product_category,category),image_url=nullif(payload->>'imageUrl','') WHERE id=v_product_id;
  FOR item IN SELECT jsonb_array_elements(payload->'variants') LOOP
    IF item->>'id' IS NOT NULL AND item->>'id' != '' THEN
      UPDATE product_variants SET name=item->>'name',selling_price=coalesce((item->>'sellingPrice')::numeric,selling_price),cost_price=coalesce((item->>'costPrice')::numeric,cost_price),low_stock_threshold=coalesce((item->>'lowStockThreshold')::int,low_stock_threshold) WHERE id=(item->>'id')::uuid AND product_id=v_product_id;
    ELSE
      INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold) VALUES (v_product_id,item->>'name',coalesce((item->>'sellingPrice')::numeric,0),coalesce((item->>'costPrice')::numeric,0),greatest(coalesce((item->>'stockQty')::int,0),0),greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('id',v_product_id);
END; $$;

-- delete_product_v1 — soft delete
CREATE OR REPLACE FUNCTION delete_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_product_id uuid := (payload->>'id')::uuid;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  UPDATE products SET is_active=false WHERE id=v_product_id;
  UPDATE product_variants SET is_active=false WHERE product_id=v_product_id;
  RETURN jsonb_build_object('id',v_product_id,'deactivated',true);
END; $$;

-- Grants
GRANT EXECUTE ON FUNCTION void_sale_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION record_cash_reconciliation_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_employee_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION update_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO authenticated;
