-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0138: one intention, one action — for supplier payments and voids
-- ═══════════════════════════════════════════════════════════════════════════════
-- Found by auditing every consequential money action with a real JWT, submitting
-- each one the way the UI actually submits it (two simultaneous calls, the same
-- instant a double tap produces).
--
-- DEFECT 1 — record_supplier_payment had no idempotency at all
--   Two taps recorded TWO payments and reduced the payable TWICE (10,000 →
--   9,000 instead of 9,500): money the shop never actually paid. The customer
--   payment path has had an idempotency_key since 0080; this one never did. The
--   fix mirrors that proven pattern: the key is CLAIMED by the insert before the
--   payable moves, so a duplicate loses the claim and cannot touch the balance.
--
-- DEFECT 2 — void_sale was a read-then-act race
--   `SELECT * INTO v_sale ... IF v_sale.is_voided THEN RAISE` does not stop a
--   concurrent second call: both read is_voided = false, both pass the check,
--   both insert a voids row and an inventory movement, and both write
--   product_variants.stock_qty (a lost update — the second write wins, so the
--   restored quantity is whatever the last writer computed, not the truth).
--   Voiding is one decision, so the row is now locked for the whole operation:
--   the second call waits, then sees is_voided = true and is refused with the
--   same message the UI already shows for an already-voided sale.
--
-- No money, stock, COGS or history semantics were rewritten. Void messages,
-- return shape, stock restoration and audit behaviour are byte-for-byte the
-- behaviour verified in 0128 — only the concurrency protection is new.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Supplier payments can be de-duplicated
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Partial unique index: NULL/'' keys stay legal (legacy rows and scripts that do
-- not send one), duplicate NON-NULL keys are rejected by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_idempotency_key
  ON public.supplier_payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

COMMENT ON COLUMN public.supplier_payments.idempotency_key IS
  'Client-generated key for one logical supplier payment. Same key = same payment: a double tap or a retry after a lost response returns the original payment instead of paying twice.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. record_supplier_payment: claim the key, THEN move the payable
-- ─────────────────────────────────────────────────────────────────────────────
-- Order is the whole point. Inserting first means a duplicate is rejected by the
-- unique index before the payable is touched; reducing the payable first would
-- deduct twice and then leave the deduction committed.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_payable numeric(12,2);
  v_actor uuid;
  v_company_id uuid;
  v_shop uuid;
  v_key text;
  v_amount numeric(12,2);
BEGIN
  v_actor := app_current_user_id();
  v_company_id := (payload->>'companyId')::uuid;
  v_amount := (payload->>'amount')::numeric;

  SELECT shop_id INTO v_shop FROM companies WHERE id = v_company_id;
  PERFORM authorize_business_action('payments.supplier', COALESCE(v_shop, current_shop_id()));

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company_id) THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND';
  END IF;

  -- Accepts either spelling, exactly like record_customer_payment.
  v_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');

  -- A retry of an already-recorded payment returns that payment, never a second
  -- one. Reporting the CURRENT payable keeps the answer truthful.
  IF v_key IS NOT NULL THEN
    SELECT sp.id INTO v_id FROM supplier_payments sp WHERE sp.idempotency_key = v_key LIMIT 1;

    IF v_id IS NOT NULL THEN
      SELECT outstanding_payable INTO v_payable FROM companies WHERE id = v_company_id;
      RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable, 0), 'idempotent', true);
    END IF;
  END IF;

  v_id := gen_random_uuid();

  BEGIN
    INSERT INTO supplier_payments (id, company_id, amount, method, notes, idempotency_key, created_at)
    VALUES (v_id, v_company_id, v_amount,
      COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', v_key, now());

  EXCEPTION WHEN unique_violation THEN
    -- Concurrent duplicate: the other tap won the claim. Return ITS payment —
    -- which is what the shop owner meant to record — without touching money.
    SELECT sp.id INTO v_id FROM supplier_payments sp WHERE sp.idempotency_key = v_key LIMIT 1;
    SELECT outstanding_payable INTO v_payable FROM companies WHERE id = v_company_id;
    RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable, 0), 'idempotent', true);
  END;

  UPDATE companies SET outstanding_payable = GREATEST(0, outstanding_payable - v_amount),
    updated_at = now()
  WHERE id = v_company_id RETURNING outstanding_payable INTO v_payable;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'supplier_payment_recorded', 'company', v_company_id,
    jsonb_build_object('amount', v_amount));

  RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable,0));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_supplier_payment(jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. void_sale: lock the sale, so voiding twice is impossible
-- ─────────────────────────────────────────────────────────────────────────────
-- Everything below is 0128's verified body except one clause: the sale is read
-- FOR UPDATE. The lock is taken before the is_voided check and held until the
-- transaction ends, so the second of two simultaneous voids waits, then sees the
-- truth and is refused — instead of duplicating the void record, the inventory
-- movement and the stock write.
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_already_returned numeric(14,4);
  v_sale_shop uuid;
BEGIN
  v_actor := COALESCE(app_current_user_id(), p_voided_by);

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = p_sale_id;
  PERFORM authorize_business_action('sales.void', COALESCE(v_sale_shop, current_shop_id()));

  -- FOR UPDATE: the "is this already voided?" answer must not be able to change
  -- between reading it and acting on it.
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    -- Restore only what the sale removed and no return already put back. The
    -- variant is the stock of record (create_sale deducts there by `qty`), and the
    -- product-level column follows from the rollup trigger.
    v_change := ROUND(v_item.qty - v_already_returned, 4);

    IF v_item.variant_id IS NOT NULL AND v_change > 0 THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_item.variant_id;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_change;
      UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_item.variant_id;
      v_restored_stock := v_restored_stock + v_change;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, created_by, created_at)
      VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
        'void', p_sale_id, v_actor, now());
    END IF;
  END LOOP;

  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.total_amount > 0 THEN
    UPDATE customers SET total_purchases = GREATEST(0, total_purchases - v_sale.total_amount), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason, v_actor, now())
  RETURNING id INTO v_void_id;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, voided_by_name = (SELECT name FROM users WHERE id = v_actor), void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'sale_voided', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'reversedOutstanding', v_unpaid));

  RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Prove it against the live database
-- ─────────────────────────────────────────────────────────────────────────────
-- (tests/integration/paymentAndVoidIdempotency.test.ts: two simultaneous supplier
--  payments sharing one key pay once; two simultaneous voids of one sale write
--  one void and restore stock once; an un-keyed call still behaves exactly as
--  before. .freebuff/tmp/prove-duplicate-taps.mjs reproduces the same against QA.)
