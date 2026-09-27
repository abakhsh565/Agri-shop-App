-- Migration 0155: the two money rules a credit sale has to keep
--
-- ── 1. Money received at the counter counts as paid ─────────────────────────────────
--
-- `create_sale_unchecked` wrote `outstanding_balance = outstanding + (total - paid)` and
-- `total_purchases = total_purchases + total` — and never touched `total_paid`. So a sale
-- of 7,200 with 600 taken at the counter left the customer row saying purchases 7,200,
-- outstanding 6,600, **paid 0**: three numbers that do not add up, with the 600 invisible.
-- `record_customer_payment` has always incremented `total_paid`; only the sale path forgot.
--
-- The ledger identity this restores is the one the app already relies on:
--
--     total_purchases = total_paid + outstanding_balance
--
-- i.e. everything bought was either paid for or is still owed. The backfill at the end
-- applies that identity to rows written before this fix, so existing customers stop
-- contradicting themselves. Nothing about what a customer *owes* changes: the outstanding
-- balance is not recalculated, only the paid column catches up with it.
--
-- ── 2. A credit sale may not run past the limit (with an owner's override) ──────────
--
-- Migration 0041 enforced the credit lifecycle inside `create_sale`, and a later rewrite
-- dropped it: the deployed function authorized `sales.create` and then sold on credit with
-- no limit check at all, so a customer 70,000 over their limit could still be given more.
--
-- Restored here, on the credit *portion* rather than on the payment type, so `credit` and
-- `partial` are both covered:
--
--   • no limit set (0 or null)  → refuse. The app already offers "Set limit" in the sale
--     flow, and a limit is what the rule is measured against.
--   • would exceed the limit    → refuse, with both numbers in the message.
--   • owner / admin             → allowed, and written to `audit_events` as
--     `sale_credit_limit_override`, because the shop's own policy record for this
--     (`credit_limit_override_policy` = `warn_allow_log`, migration 0009) says: warn,
--     allow, log. A shopkeeper can override their own shop's limit; an employee cannot.
--
-- Nothing here recalculates existing debt. Lowering a limit below what is already owed
-- stays allowed (0154), leaves the outstanding balance untouched, and simply blocks new
-- credit until the balance is back under the limit.

CREATE OR REPLACE FUNCTION public.create_sale_unchecked(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_sale_id uuid; v_sale_number text; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
  v_customer_id uuid; v_total numeric(14,4):=0; v_paid numeric(14,4):=0; v_item jsonb;
  v_credit numeric(14,4):=0; v_outstanding numeric(14,4):=0; v_limit numeric(14,4):=0;
BEGIN
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid; v_actor:=(v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('sales.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);
  v_customer_id:=NULLIF(payload->>'customerId','')::uuid;
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  v_sale_number:='SALE-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');

  INSERT INTO sales(id,sale_number,customer_id,customer_name_snapshot,employee_id,employee_name,total_amount,discount,payment_type,payment_method,amount_paid,amount_due,status,shop_id,created_at,updated_at)
  VALUES(gen_random_uuid(),v_sale_number,v_customer_id,COALESCE((SELECT name FROM customers WHERE id=v_customer_id AND shop_id=v_shop_id),COALESCE(payload->>'customerName','Walk-in')),v_actor,COALESCE(payload->>'employeeName',(SELECT name FROM users WHERE id=v_actor)),0,0,COALESCE(payload->>'paymentType','full')::payment_type,COALESCE(payload->>'paymentMethod','cash')::payment_method,v_paid,0,'completed',v_shop_id,now(),now()) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_total:=v_total+ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2);
    IF NOT EXISTS(SELECT 1 FROM products p WHERE p.id=NULLIF(v_item->>'productId','')::uuid AND p.shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: product belongs to another tenant'; END IF;
    INSERT INTO sale_items(id,sale_id,product_id,variant_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_sale_id,NULLIF(v_item->>'productId','')::uuid,NULLIF(v_item->>'variantId','')::uuid,v_item->>'productName',COALESCE(v_item->>'variantName',''),(v_item->>'qty')::numeric,(v_item->>'unitPrice')::numeric,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),ROUND((v_item->>'qty')::numeric*(v_item->>'unitPrice')::numeric,2));
    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      UPDATE product_variants SET stock_qty=stock_qty-(v_item->>'qty')::numeric WHERE id=(v_item->>'variantId')::uuid AND stock_qty >= (v_item->>'qty')::numeric;
      IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_STOCK'; END IF;
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

-- Backfill: apply `paid = bought - owed` to rows written before the sale path kept the
-- paid column. Existing debt is untouched — `outstanding_balance` is what a customer owes
-- and stays exactly as it is; only the paid figure catches up with the two that are right.
UPDATE customers
   SET total_paid = GREATEST(0, total_purchases - outstanding_balance),
       updated_at = now()
 WHERE total_purchases >= 0
   AND GREATEST(0, total_purchases - outstanding_balance) IS DISTINCT FROM total_paid;
