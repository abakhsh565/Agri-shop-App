-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0140: a purchase is recorded — once, with its real total and its actor
-- ═══════════════════════════════════════════════════════════════════════════════
-- Found by submitting the app's own payloads twice at the same instant (real JWT,
-- real database), the way a double tap submits them.
--
-- DEFECT 1 — RECORDING A PURCHASE FAILED COMPLETELY
--   purchase_items.line_total is NOT NULL, and create_purchase wrote it from
--   `payload->items[i].lineTotal`. RecordPurchasePage does not send that field: it
--   sends qty and costPrice and nothing else. So EVERY purchase raised
--       null value in column "line_total" of relation "purchase_items"
--   and the whole transaction rolled back — no purchase row, no stock received, no
--   supplier payable. The screen's success path was unreachable: a shop could not
--   record a delivery from a supplier at all.
--
--   The same NULL propagated into the total: `v_total := v_total + NULL` is NULL, so
--   even if the item row had been accepted the purchase would have carried no amount
--   and the supplier's payable would have been written as NULL.
--
--   FIX: the line total is DERIVED where it is authoritative — qty * unit cost — and
--   the accumulated total uses that same value. A client cannot break the total by
--   omitting a column the database can compute, and a caller that DOES send an
--   explicit lineTotal is still honoured.
--
-- DEFECT 2 — NO IDEMPOTENCY
--   create_purchase had none, and unlike employees (users.phone is unique) there is
--   no natural key for a delivery, so two taps recorded two purchases: stock up
--   twice and the supplier's payable up twice for one delivery. This is the same
--   "one user intention = one business action" defect fixed for create_sale (0134),
--   record_supplier_payment (0138) and adjust_stock (0139) — and a purchase moves
--   both money and inventory, so it belongs in that family.
--
--   FIX: the same claim-then-apply shape as those three:
--     1. the purchase row is inserted FIRST carrying a client key, so the partial
--        unique index rejects a duplicate before any stock or payable moves —
--        `BEGIN ... EXCEPTION WHEN unique_violation` also catches the concurrent
--        case, because the second insert blocks until the first commits;
--     2. a retry of an already-recorded purchase returns THAT purchase rather than
--        recording a second one. The key stays valid after a genuine failure,
--        because the failed attempt rolled back with it.
--
-- DEFECT 3 — NO ACTOR
--   recorded_by was never written, so the display-name trigger added in 0124 had
--   nothing to stamp and `purchases.recorded_by_name` was permanently blank
--   (0124 measured 2/2 null). The actor is now stamped from the authenticated
--   session, which is what the existing trigger was waiting for.
--
-- Authorization, tenant resolution, purchase numbering, the company payable and
-- total_purchases updates, and the return shape are unchanged from 0109.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_idempotency_key
  ON public.purchases (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

COMMENT ON COLUMN public.purchases.idempotency_key IS
  'Client-generated key for one logical purchase. Same key = same purchase: a double tap receives stock once.';

CREATE OR REPLACE FUNCTION public.create_purchase(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
BEGIN
  v_actor := app_current_user_id();
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid;
  PERFORM authorize_business_action('purchases.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);

  -- A retry of a purchase that already went through returns THAT purchase.
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

  -- Claim the key BEFORE anything moves. A duplicate loses the claim here and never
  -- reaches the stock or payable writes below.
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
    -- Derived, not demanded: the page sends qty and unit cost. An explicit lineTotal
    -- from a caller that computes one is still honoured.
    v_line := COALESCE((v_item->>'lineTotal')::numeric, v_qty * v_unit);
    v_total := v_total + v_line;

    INSERT INTO purchase_items(id,purchase_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_id,NULLIF(v_item->>'productId','')::uuid,v_item->>'productName',NULLIF(v_item->>'variantId','')::uuid,COALESCE(v_item->>'variantName',''),v_qty,v_unit,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),v_line);

    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      UPDATE product_variants SET stock_qty=stock_qty+v_qty WHERE id=(v_item->>'variantId')::uuid;
    END IF;
  END LOOP;

  UPDATE purchases SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable=outstanding_payable+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;
  END IF;

  RETURN jsonb_build_object('id',v_id,'purchaseNumber',v_number,'totalAmount',v_total,'outstandingPayable',GREATEST(0,v_total-v_paid));
END; $$;

GRANT EXECUTE ON FUNCTION public.create_purchase(jsonb) TO authenticated;
