-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A SALE KEEPS ITS DUE DATE, AND A STOCK CHANGE LEAVES A MOVEMENT
--
-- Two gaps, both confirmed by measurement against the running app (docs/LOCAL_DEVELOPMENT.md §7):
--
--   1. `sales.due_date` was never written. The cart renders "Payment Due Date — Required for credit
--      sales", disables the confirm button until one is chosen, and `salesStore` sends `dueDate` in
--      the payload — and the column came out NULL on every credit sale (locally and on staging's own
--      rows: SALE-14273). Reminders and overdue credit therefore had nothing to read, which is why
--      the dashboard's overdue tile always reported Rs. 0 on a shop with credit sales.
--
--   2. The stock ledger recorded three of the five writers. Measured in one session:
--        create product with stock  → row      buy (purchase) → row      void sale → row
--        sale (create_sale)         → NO ROW   return         → NO ROW
--      Stock moved in both missing cases; `sale` and `return` already exist in the
--      `movement_type` enum, so nothing here invents a vocabulary — it uses the one the void and the
--      purchase write.
--
-- HOW: both functions are redefined from their LIVE definitions with the insertions marked below and
-- nothing else changed. The return's row is inside the same `IF restock` branch that moves the stock,
-- because a return that does not restock must not claim stock came back. Values are read from the row
-- the statement just wrote, in the same transaction, so qty_before/qty_after cannot drift.
--
-- `branch_id` is deliberately not set here: 0188's `enforce_branch_scope` trigger stamps it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_sale_unchecked(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id uuid; v_sale_number text; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
  v_customer_id uuid; v_total numeric(14,4):=0; v_paid numeric(14,4):=0; v_item jsonb;
  v_credit numeric(14,4):=0; v_outstanding numeric(14,4):=0; v_limit numeric(14,4):=0;
  v_stock_after numeric(14,4); v_stock_change numeric(14,4);
BEGIN
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid; v_actor:=(v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('sales.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  v_customer_id:=NULLIF(payload->>'customerId','')::uuid;
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  v_sale_number:='SALE-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');

  INSERT INTO sales(id,sale_number,customer_id,customer_name_snapshot,employee_id,employee_name,total_amount,discount,payment_type,payment_method,amount_paid,amount_due,due_date,status,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),v_sale_number,v_customer_id,COALESCE((SELECT name FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id),COALESCE(payload->>'customerName','Walk-in')),v_actor,COALESCE(payload->>'employeeName',(SELECT name FROM users WHERE id=v_actor)),0,0,COALESCE(payload->>'paymentType','full')::payment_type,COALESCE(payload->>'paymentMethod','cash')::payment_method,v_paid,0,NULLIF(COALESCE(payload->>'dueDate',payload->>'due_date'),'')::date,'completed',v_shop_id,now(),now()) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total:=v_total+ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2);
    IF NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NULLIF(v_item->>'productId','')::uuid AND p.shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product belongs to another tenant'; END IF;
    INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_sale_id,NULLIF(v_item->>'productId','')::uuid,NULLIF(v_item->>'variantId','')::uuid,v_item->>'productName',COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'unitPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2));
    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      UPDATE product_variants SET stock_qty=stock_qty-(v_item->>'qty')::numeric WHERE id=(v_item->>'variantId')::uuid AND stock_qty >= (v_item->>'qty')::numeric;
      IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
      -- The row that was missing: this line moved stock, so the ledger records it, with the
      -- values read from the same locked row the UPDATE just wrote.
      SELECT stock_qty INTO v_stock_after FROM product_variants WHERE id=(v_item->>'variantId')::uuid;
      v_stock_change:=-(v_item->>'qty')::numeric;
      INSERT INTO inventory_movements(product_id,variant_id,movement_type,qty_before,qty_change,qty_after,
        reference_type,reference_id,created_by)
      VALUES(NULLIF(v_item->>'productId','')::uuid,(v_item->>'variantId')::uuid,'sale',
        v_stock_after-v_stock_change,v_stock_change,v_stock_after,'sale',v_sale_id,v_actor);
    END IF;
  END LOOP;

  -- The credit rule, measured on the part of this sale that is not being paid for now.
  v_credit:=GREATEST(0,v_total-v_paid);
  IF v_credit > 0 AND v_customer_id IS NOT NULL THEN
    SELECT COALESCE(outstanding_balance,0),COALESCE(credit_limit,0)
      INTO v_outstanding,v_limit
      FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id;

    IF v_limit <= 0 THEN
      RAISE EXCEPTION 'CREDIT_LIMIT_REQUIRED: this customer has no credit limit, and a credit sale is measured against one';
    END IF;

    IF v_outstanding + v_credit > v_limit THEN
      IF app_is_admin() THEN
        INSERT INTO audit_events(user_id,action,entity_type,entity_id,details)
        VALUES(app_current_user_id(),'sale_credit_limit_override','sale',v_sale_id,
          jsonb_build_object('credit',v_credit,'outstandingBefore',v_outstanding,'creditLimit',v_limit,
                             'overBy',(v_outstanding+v_credit)-v_limit,'customerId',v_customer_id));
      ELSE
        RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Rs. % of credit would bring the balance to Rs. %, over the Rs. % limit',
          v_credit, v_outstanding + v_credit, v_limit;
      END IF;
    END IF;
  END IF;

  UPDATE sales SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_sale_id;

  IF v_customer_id IS NOT NULL THEN
    -- `total_paid` is the third member of the identity: bought = paid + owed. Without this
    -- line, cash taken at the counter was recorded on the sale and nowhere else.
    UPDATE customers
       SET outstanding_balance = outstanding_balance + (v_total - v_paid),
           total_purchases     = total_purchases + v_total,
           total_paid          = total_paid + v_paid,
           updated_at = now()
     WHERE id = v_customer_id AND shop_id = v_shop_id;
  END IF;

  RETURN jsonb_build_object('id',v_sale_id,'saleNumber',v_sale_number,'totalAmount',v_total,'amountPaid',v_paid,'outstandingBalance',GREATEST(0,v_total-v_paid));
END;
$function$;


CREATE OR REPLACE FUNCTION public.process_return(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_return_number text;
  v_sale_id uuid;
  v_customer_id uuid;
  v_total numeric(14,4) := 0;
  v_item jsonb;
  v_shop_id uuid;
  v_sale_shop uuid;
  v_resolution text;
  v_reason text;
  v_processed_by uuid;
  v_idempotency_key text;
  v_sale_is_voided boolean;
  v_sale_created timestamptz;
  v_sale_item_id uuid;
  v_sale_item_sale_id uuid;
  v_original_qty numeric;
  v_sale_item_unit_price numeric;
  v_already_returned numeric;
  v_request_qty numeric;
  v_request_price numeric;
  v_stock_after numeric(14,4);
  v_stock_change numeric(14,4);
BEGIN
  PERFORM public.guard_operational_request('process_return',payload);
  v_sale_id := COALESCE(NULLIF(payload->>'saleId', '')::uuid, NULLIF(payload->>'sale_id', '')::uuid);
  v_customer_id := COALESCE(NULLIF(payload->>'customerId', '')::uuid, NULLIF(payload->>'customer_id', '')::uuid);
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := NULLIF(trim(COALESCE(payload->>'reason', '')), '');
  v_idempotency_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');
  v_processed_by := COALESCE(
    app_current_user_id(),
    NULLIF(payload->>'processedBy', '')::uuid
  );

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = v_sale_id;
  PERFORM authorize_business_action('returns.create', COALESCE(v_sale_shop, current_shop_id()));

  IF v_sale_shop IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: Sale does not exist in your organization';
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_sale_shop AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
        'id', v_id, 'return_number', v_return_number,
        'total_refund', v_total, 'idempotent', true
      );
    END IF;
  END IF;

  v_total := 0; v_id := NULL; v_return_number := NULL;

  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT created_at, is_voided INTO v_sale_created, v_sale_is_voided FROM sales WHERE id = v_sale_id;
  IF v_sale_created IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: Sale does not exist in your organization';
  END IF;
  IF v_sale_is_voided THEN
    RAISE EXCEPTION 'SALE_VOIDED: Cannot return items from a voided sale';
  END IF;
  IF (now() - v_sale_created) > interval '30 days' THEN
    RAISE EXCEPTION 'RETURN_WINDOW_EXPIRED';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb))
  LOOP
    v_sale_item_id := COALESCE(
      NULLIF(v_item->>'saleItemId', '')::uuid,
      NULLIF(v_item->>'sale_item_id', '')::uuid
    );
    v_request_qty := COALESCE(
      NULLIF(v_item->>'qty', '')::numeric,
      NULLIF(v_item->>'qty_to_return', '')::numeric
    );
    v_request_price := COALESCE(
      NULLIF(v_item->>'unitPrice', '')::numeric,
      NULLIF(v_item->>'unit_price', '')::numeric
    );

    SELECT si.sale_id, si.qty, si.unit_price
      INTO v_sale_item_sale_id, v_original_qty, v_sale_item_unit_price
    FROM sale_items si WHERE si.id = v_sale_item_id;

    IF v_sale_item_sale_id IS NULL THEN
      RAISE EXCEPTION 'SALE_ITEM_NOT_FOUND';
    END IF;
    IF v_sale_item_sale_id IS DISTINCT FROM v_sale_id THEN
      RAISE EXCEPTION 'ITEM_NOT_OWNED: That item belongs to a different sale';
    END IF;
    IF v_request_qty IS NULL OR v_request_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: Return quantity must be greater than zero';
    END IF;

    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_sale_item_id AND r.sale_id = v_sale_id;

    IF v_already_returned + v_request_qty > v_original_qty THEN
      RAISE EXCEPTION 'EXCESS_RETURN: Cannot return more than the sold quantity for this item';
    END IF;

    IF v_request_price IS NOT NULL AND v_request_price > v_sale_item_unit_price THEN
      RAISE EXCEPTION 'REFUND_EXCEEDS_SALE_PRICE: Refund cannot exceed the original sale price for this item';
    END IF;
  END LOOP;

  v_shop_id := v_sale_shop;
  v_return_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  BEGIN
    INSERT INTO returns (
      id, return_number, sale_id, customer_id, customer_name,
      total_refund, resolution, reason, processed_by, processed_by_name,
      shop_id, idempotency_key, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_return_number, v_sale_id, v_customer_id,
      COALESCE(payload->>'customerName', 'Customer'),
      0, v_resolution, v_reason, v_processed_by,
      (SELECT name FROM users WHERE id = v_processed_by),
      v_shop_id, v_idempotency_key, now(), now()
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_shop_id AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
    PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
      'id', v_id, 'return_number', v_return_number,
      'total_refund', v_total, 'idempotent', true
    );
  END;

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

    IF COALESCE((v_item->>'restock')::boolean, false) THEN
      IF (v_item->>'variantId')::uuid IS NOT NULL THEN
        UPDATE product_variants SET stock_qty = stock_qty + (v_item->>'qty')::numeric
          WHERE id = (v_item->>'variantId')::uuid;
        -- Inside `IF restock` on purpose: a return that does NOT put the goods back must not
        -- claim stock came back. The ledger follows the stock, not the paperwork.
        SELECT stock_qty INTO v_stock_after FROM product_variants WHERE id = (v_item->>'variantId')::uuid;
        v_stock_change := (v_item->>'qty')::numeric;
        INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
          reference_type, reference_id, created_by)
        VALUES (NULLIF(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'return',
          v_stock_after - v_stock_change, v_stock_change, v_stock_after, 'return', v_id, v_processed_by);
      END IF;
    END IF;
  END LOOP;

  UPDATE returns SET total_refund = v_total WHERE id = v_id;

  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      outstanding_balance = GREATEST(0, outstanding_balance - v_total),
      updated_at = now()
    WHERE id = v_customer_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_processed_by, 'return_processed', 'return', v_id,
    jsonb_build_object('saleId', v_sale_id, 'totalRefund', v_total));

  PERFORM public.guard_operational_request('process_return',payload);
 RETURN jsonb_build_object(
    'id', v_id, 'return_number', v_return_number,
    'total_refund', v_total
  );
END;
$function$;
