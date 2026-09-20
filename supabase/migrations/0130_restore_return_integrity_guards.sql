-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0130: Restore the return-integrity guards 0112 dropped
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT HAPPENED
--   0052 (block_return_on_voided_sale) was the last version of process_return
--   that enforced the return rules. 0112 then rewrote the function to add the
--   RBAC permission gate and to follow the 0128 shaped schema — and in doing so
--   silently dropped every rule except a SALE_NOT_FOUND existence check. The
--   frontend still expects those rules: src/lib/db.ts maps these exact error
--   codes to user-facing messages, which is the fingerprint of the loss:
--
--     RETURN_WINDOW_EXPIRED · EXCESS_RETURN · ITEM_NOT_OWNED
--     SALE_ITEM_NOT_FOUND   · REASON_REQUIRED
--
--   It also dropped the idempotency short-circuit, even though the client has
--   been sending `idempotency_key` on every return (src/lib/db.ts:170) and
--   returns.idempotency_key has been UNIQUE since 0014. A retried or
--   double-submitted return therefore created a SECOND return: refunded twice
--   and restored stock twice.
--
--   Finally the response keys changed from the snake_case the UI reads
--   (`return_number`, `total_refund`) to camelCase, so the return number
--   rendered as undefined and the refund as 0.
--
-- RULES RESTORED (from BUSINESS-RULES.md §8, the authoritative spec)
--   * a return must originate from an existing, non-voided sale
--   * return quantity per item cannot exceed the original sale quantity, and
--     repeated returns accumulate against that line
--   * a line must belong to the sale being returned
--   * returns are idempotent per key
--   * a return needs a reason
--
-- PRESERVED FROM 0112
--   The authorize_business_action('returns.create', ...) gate (that gate was the
--   reason for the rewrite), the current return_items column names
--   (qty_to_return), variant stock restoration and the audit event.
--
-- NOT CHANGED HERE (see ENGINEERING_OS_STATE.md §1.13 — needs a product decision)
--   How a CASH refund affects customer.outstanding_balance. The spec says a cash
--   refund leaves outstanding unaffected and only a credit adjustment reduces it;
--   the live function reduces outstanding by the full refund for both.
-- ═══════════════════════════════════════════════════════════════════════════════

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
  -- restored guards
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
BEGIN
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

  -- Idempotency first, so a retry of an already-accepted return returns that
  -- return instead of creating a second refund. Scoped to the tenant: a key
  -- collision in another shop must never surface another shop's return (the
  -- lesson recorded in 0116).
  IF v_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_sale_shop AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'id', v_id, 'return_number', v_return_number,
        'total_refund', v_total, 'idempotent', true
      );
    END IF;
  END IF;

  -- plpgsql's SELECT ... INTO assigns NULL to every target when no row matches,
  -- so the lookup above wipes the `:= 0` initialisation of v_total on the normal
  -- path. Without this reset every refund is computed from NULL: total_refund is
  -- written as NULL and `outstanding_balance - NULL` silently propagates it.
  -- (0052 had this reset line; it was dropped in the 0112 rewrite.)
  v_total := 0; v_id := NULL; v_return_number := NULL;

  -- §8: a return needs a reason.
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- §8: the sale must exist, must not be voided (void already restored stock),
  -- and must still be inside the return window.
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

  -- Validate every line BEFORE creating anything, so a bad payload cannot leave
  -- a half-written return behind.
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

    -- Repeated returns accumulate against the same original sale line.
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_sale_item_id AND r.sale_id = v_sale_id;

    IF v_already_returned + v_request_qty > v_original_qty THEN
      RAISE EXCEPTION 'EXCESS_RETURN: Cannot return more than the sold quantity for this item';
    END IF;

    -- A refund must not be inflated above what the line was actually sold for;
    -- the sale line is the authority, not the caller's number.
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
    -- Two identical requests raced past the lookup above; the unique index on
    -- returns.idempotency_key settles it. Return the winner instead of a second refund.
    SELECT r.id, r.return_number, r.total_refund
      INTO v_id, v_return_number, v_total
    FROM returns r
    WHERE r.shop_id = v_shop_id AND r.idempotency_key = v_idempotency_key
    LIMIT 1;
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

  -- snake_case: src/lib/db.ts maps data.return_number / data.total_refund.
  RETURN jsonb_build_object(
    'id', v_id, 'return_number', v_return_number,
    'total_refund', v_total
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.process_return(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.process_return(jsonb) FROM PUBLIC, anon;
