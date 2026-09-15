-- Migration 0088: Fix void_sale voided_by_name + deactivate_employee parameter names
--
-- Bug 1: void_sale didn't set voided_by_name, so tests checking it fail.
-- Bug 2: deactivate_employee_v1 only accepts camelCase employeeId, but tests pass snake_case employee_id.

-- Fix void_sale: add voided_by_name to the UPDATE
CREATE OR REPLACE FUNCTION void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_caller_role text;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_already_returned numeric(14,4);
BEGIN
  v_actor := COALESCE(
    p_voided_by,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can void sales';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALE_NOT_FOUND'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'SALE_ALREADY_VOIDED'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(qi.qty), 0) INTO v_already_returned
    FROM return_items qi JOIN returns r ON r.id = qi.return_id
    WHERE qi.sale_item_id = v_item.id;
    v_restored_stock := v_restored_stock + (v_item.qty - v_already_returned) * COALESCE(v_item.unit_size, 1);
  END LOOP;

  IF v_restored_stock > 0 THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      SELECT stock_qty INTO v_before FROM products WHERE id = v_item.product_id;
      v_before := COALESCE(v_before, 0);
      v_change := (v_item.qty - COALESCE(
        (SELECT COALESCE(SUM(qi.qty), 0) FROM return_items qi JOIN returns r ON r.id = qi.return_id WHERE qi.sale_item_id = v_item.id), 0
      )) * COALESCE(v_item.unit_size, 1);
      IF v_change > 0 THEN
        UPDATE products SET stock_qty = stock_qty + v_change WHERE id = v_item.product_id;
        v_after := v_before + v_change;
        INSERT INTO inventory_movements (product_id, movement_type, qty_before, qty_change, qty_after, reference_type, reference_id, created_by, created_at)
        VALUES (v_item.product_id, 'return', v_before, v_change, v_after, 'void', p_sale_id, v_actor, now());
      END IF;
    END LOOP;
  END IF;

  v_unpaid := v_sale.total_amount - v_sale.amount_paid;
  IF v_unpaid > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), total_purchases = GREATEST(0, total_purchases - v_unpaid) WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, voided_by_name = (SELECT name FROM users WHERE id = v_actor), void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO voids (id, sale_id, voided_by, void_reason, created_at) VALUES (gen_random_uuid(), p_sale_id, v_actor, p_reason, now()) RETURNING id INTO v_void_id;

  RETURN jsonb_build_object('id', v_void_id, 'voided_by', v_actor, 'voided_by_name', (SELECT name FROM users WHERE id = v_actor));
END;
$$;

-- Fix deactivate_employee_v1: accept both employeeId and employee_id
CREATE OR REPLACE FUNCTION deactivate_employee_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor_id uuid := app_current_user_id(); v_emp_id uuid; v_emp record;
BEGIN
  IF NOT app_is_admin() THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  -- Accept both camelCase and snake_case
  v_emp_id := COALESCE(
    NULLIF((payload->>'employeeId')::text, '')::uuid,
    NULLIF((payload->>'employee_id')::text, '')::uuid
  );
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.is_original_owner THEN RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER'; END IF;
  UPDATE users SET is_active=false, deactivated_at=now(), deactivated_by=v_actor_id WHERE id=v_emp_id;
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES (v_actor_id,'employee_deactivated','user',v_emp_id,jsonb_build_object('name',v_emp.name));
  RETURN jsonb_build_object('id',v_emp_id,'isActive',false);
END;
$$;
