-- 0152_create_purchase_writes_inventory_movement.sql
--
-- A purchase moved variant stock but left no inventory movement, so the stock ledger had a
-- hole exactly where goods arrive: `void_sale` was the only writer of inventory_movements,
-- and movement_type even carries an unused 'purchase' label. Proven live on QA
-- (2026-09-27): purchase PUR-52995 raised variant stock 19 → 24 and moved the supplier
-- payable, yet `inventory_movements` gained no row (it held only the void movement).
--
-- This migration replaces create_purchase with the same logic plus one movement row per
-- received line, written the way void_sale writes its 'void' movement: capture stock before,
-- update, record qty_change/qty_after, reference the document. reference_type = 'purchase',
-- reference_id = the purchase id, unit_cost = the line's unit cost, movement_type =
-- 'purchase' (the enum value that already existed for this). It also records the
-- 'purchase_recorded' audit event, matching how void_sale, process_return and the payment
-- RPCs audit their documents (a received purchase previously left no audit trail at all).

CREATE OR REPLACE FUNCTION public.create_purchase(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4):=0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_shop_id uuid;
  v_resolved jsonb;
  v_actor uuid;
  v_key text;
  v_existing record;
  v_qty numeric(14,4);
  v_unit numeric(14,4);
  v_line numeric(14,4);
  v_sell numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
BEGIN
  v_actor := app_current_user_id();
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid;
  PERFORM authorize_business_action('purchases.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);

  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NOT NULL THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'purchaseNumber', v_existing.purchase_number,
        'totalAmount', v_existing.total_amount,
        'outstandingPayable', COALESCE(v_existing.amount_due, 0),
        'idempotent', true
      );
    END IF;
  END IF;

  v_number:='PUR-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  SELECT name INTO v_company_name FROM companies WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;

  BEGIN
    INSERT INTO purchases(id,purchase_number,company_id,company_name,total_amount,amount_paid,amount_due,status,notes,shop_id,recorded_by,idempotency_key,created_at,updated_at)
    VALUES(gen_random_uuid(),v_number,NULLIF(payload->>'companyId','')::uuid,COALESCE(v_company_name,'Unknown'),0,v_paid,0,'completed',payload->>'note',v_shop_id,v_actor::text,v_key,now(),now()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    RETURN jsonb_build_object(
      'id', v_existing.id,
      'purchaseNumber', v_existing.purchase_number,
      'totalAmount', v_existing.total_amount,
      'outstandingPayable', COALESCE(v_existing.amount_due, 0),
      'idempotent', true
    );
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_qty := COALESCE((v_item->>'qty')::numeric, 0);
    v_unit := COALESCE((v_item->>'costPrice')::numeric, 0);
    v_line := COALESCE((v_item->>'lineTotal')::numeric, v_qty * v_unit);
    v_total := v_total + v_line;

    INSERT INTO purchase_items(id,purchase_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_id,NULLIF(v_item->>'productId','')::uuid,v_item->>'productName',NULLIF(v_item->>'variantId','')::uuid,COALESCE(v_item->>'variantName',''),v_qty,v_unit,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),v_line);

    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      v_sell := COALESCE((v_item->>'sellingPrice')::numeric, 0);
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = (v_item->>'variantId')::uuid FOR UPDATE;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_qty;
      UPDATE product_variants
         SET stock_qty = v_after,
             cost_price    = CASE WHEN v_unit > 0 THEN v_unit ELSE cost_price END,
             selling_price = CASE WHEN v_sell > 0 THEN v_sell ELSE selling_price END
       WHERE id = (v_item->>'variantId')::uuid;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by, created_at)
      VALUES (NULLIF(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'purchase', v_before, v_qty, v_after,
        'purchase', v_id, v_unit, v_actor, now());
    END IF;
  END LOOP;

  UPDATE purchases SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable=outstanding_payable+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'purchase_recorded', 'purchase', v_id,
          jsonb_build_object('purchaseNumber', v_number, 'totalAmount', v_total, 'shopId', v_shop_id));

  RETURN jsonb_build_object('id',v_id,'purchaseNumber',v_number,'totalAmount',v_total,'outstandingPayable',GREATEST(0,v_total-v_paid));
END; $function$;

REVOKE EXECUTE ON FUNCTION public.create_purchase(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase(jsonb) TO authenticated, service_role;
