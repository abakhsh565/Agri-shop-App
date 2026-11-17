-- A sale can carry a discount — one on a line, or one on the whole bill.
--
-- `sales.discount` has been on the table since it was created and was never written: every total
-- in the app came from `create_sale_unchecked`, which multiplied quantity by price and nothing
-- else. The owner wants the review screen to take money off a single line or off the whole sale,
-- in percent or in rupees (2026-11-17) — and a discount that only exists on one screen is not a
-- discount, it is a note. So the amount is written where every other figure already reads it:
-- `line_total` stays the net of its line, `sales.discount` records the bill's own reduction, and
-- `sales.total_amount` is what the customer actually owes.
--
-- One rule at both levels: the client sends amounts, never percentages. A percent is a way of
-- typing an amount, and the screen that offers the percent is the one place that arithmetic can
-- be checked against what the cashier sees. The database caps a line's discount at the line's
-- value and the bill's discount at what the lines left, so no path can produce a negative sale.

alter table public.sale_items
  add column if not exists discount numeric(14,2) not null default 0 check (discount >= 0);

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
  v_gross numeric(14,4); v_line_discount numeric(14,4); v_line numeric(14,4);
  v_discount numeric(14,4):=GREATEST(COALESCE((payload->>'discount')::numeric,0),0);
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
    v_gross:=ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2);
    -- A line can never give back more than it is worth, whatever the screen sent.
    v_line_discount:=LEAST(GREATEST(COALESCE((v_item->>'discount')::numeric,0),0),v_gross);
    v_line:=ROUND(v_gross-v_line_discount,2);
    v_total:=v_total+v_line;
    IF NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NULLIF(v_item->>'productId','')::uuid AND p.shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product belongs to another tenant'; END IF;
    INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total,discount)
    VALUES(gen_random_uuid(),v_sale_id,NULLIF(v_item->>'productId','')::uuid,NULLIF(v_item->>'variantId','')::uuid,v_item->>'productName',COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'unitPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),v_line,v_line_discount);
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

  -- The bill's own discount comes off what the lines left, never below zero: a shop may give
  -- away the whole sale but cannot owe the customer money through a discount field.
  v_discount:=LEAST(v_discount,v_total);
  v_total:=ROUND(v_total-v_discount,2);

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

  UPDATE sales SET total_amount=v_total,discount=v_discount,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_sale_id;

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

  RETURN jsonb_build_object('id',v_sale_id,'saleNumber',v_sale_number,'totalAmount',v_total,'discount',v_discount,'amountPaid',v_paid,'outstandingBalance',GREATEST(0,v_total-v_paid));
END;
$function$;
