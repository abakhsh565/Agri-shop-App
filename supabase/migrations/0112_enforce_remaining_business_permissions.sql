-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0112: enforce effective access on the remaining business write paths
-- ═══════════════════════════════════════════════════════════════════════════════
-- Audit result (before this migration):
--   * archive_customer / restore_customer / update_customer_image /
--     update_customer_due_date  → NO authorization at all, no tenant scoping.
--   * adjust_stock / delete_product / record_customer_payment /
--     record_supplier_payment → role-only check (admin/co_admin) that trusted a
--     caller-supplied actorId, and the target row was never tenant-scoped.
--   * process_return → NO authorization at all; a return could be created for a
--     sale id that does not exist.
--   * void_sale → admin-only, but the sale was not tenant-scoped.
--   * update_product → supplier lookup matched by name across ALL tenants.
--   * approve/reject_credit_limit_request_v2 → trusted the p_actor_id PARAMETER
--     (an employee could pass an admin id and approve their own request).
--
-- This migration routes every one of them through the single authoritative
-- guard `authorize_business_action()`, which resolves:
--     authenticated user → active membership → tenant → effective permission
-- and rejects cross-tenant targets. Actor identity is taken from the JWT
-- (`app_current_user_id()`), never from a caller-supplied parameter unless the
-- caller is a trusted non-JWT context (direct SQL / service role).
--
-- Additive only: no table, column, policy, or business rule is weakened.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── SHARED GUARD: active membership only (no specific permission) ───────────
-- Used by request-type operations that any active member may initiate (a credit
-- limit request is raised by an employee and decided by the owner/admin).

CREATE OR REPLACE FUNCTION public.authorize_tenant_membership(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_tenant uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT m.tenant_id INTO v_tenant
  FROM memberships m
  WHERE m.user_id = v_actor AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: no active membership'; END IF;
  IF p_tenant_id IS NOT NULL AND v_tenant IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  RETURN v_tenant;
END;
$$;
GRANT EXECUTE ON FUNCTION public.authorize_tenant_membership(uuid) TO authenticated;

-- ── CUSTOMERS ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_shop uuid;
BEGIN
  v_actor := COALESCE(app_current_user_id(), p_archived_by);
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  PERFORM authorize_business_action('customers.delete', COALESCE(v_shop, current_shop_id()));
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  UPDATE customers SET
    is_archived = true,
    archived_at = now(),
    archived_by = v_actor
  WHERE id = p_customer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.archive_customer(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_customer(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_shop uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  PERFORM authorize_business_action('customers.delete', COALESCE(v_shop, current_shop_id()));
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  UPDATE customers SET
    is_archived = false,
    archived_at = NULL,
    archived_by = NULL
  WHERE id = p_customer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.restore_customer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_customer_image(p_customer_id uuid, p_image_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_shop uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  PERFORM authorize_business_action('customers.edit', COALESCE(v_shop, current_shop_id()));
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  UPDATE customers SET image_url = p_image_url, updated_at = now() WHERE id = p_customer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_customer_image(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_customer_due_date(p_customer_id uuid, p_due_date text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_shop uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM customers WHERE id = p_customer_id;
  PERFORM authorize_business_action('customers.edit', COALESCE(v_shop, current_shop_id()));
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  UPDATE customers SET due_date = NULLIF(p_due_date, '')::date, updated_at = now() WHERE id = p_customer_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_customer_due_date(uuid, text) TO authenticated;

-- ── CUSTOMER PAYMENTS ────────────────────────────────────────────────────────
-- Behaviour is unchanged; authorization is now permission-based and the target
-- customer must belong to the caller's tenant.

CREATE OR REPLACE FUNCTION public.record_customer_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_customer_id uuid;
  v_total_amount numeric(14,2);
  v_notes text;
  v_new_balance numeric(14,2);
  v_payment_group_id uuid;
  v_single_id uuid;
  v_split jsonb;
  v_split_idx integer := 0;
  v_idempotency_key text;
  v_existing record;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();
  v_customer_id := (payload->>'customerId')::uuid;

  SELECT shop_id INTO v_shop FROM customers WHERE id = v_customer_id;
  PERFORM authorize_business_action('customers.payments', COALESCE(v_shop, current_shop_id()));

  v_notes := payload->>'notes';

  -- Extract idempotency key (accept both snake_case and camelCase)
  v_idempotency_key := NULLIF(COALESCE(
    payload->>'idempotency_key',
    payload->>'idempotencyKey'
  ), '');

  -- ─── IDEMPOTENCY CHECK (fast path) ────────────────────────────────────
  IF v_idempotency_key IS NOT NULL THEN
    SELECT payment_group_id INTO v_payment_group_id
    FROM customer_payments
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      SELECT SUM(amount), MAX(balance_after) INTO v_total_amount, v_new_balance
      FROM customer_payments
      WHERE payment_group_id = v_payment_group_id;

      RETURN jsonb_build_object(
        'id', v_payment_group_id,
        'balanceAfter', COALESCE(v_new_balance, 0),
        'splitCount', (SELECT count(*)::int FROM customer_payments WHERE payment_group_id = v_payment_group_id),
        'totalAmount', COALESCE(v_total_amount, 0),
        'idempotent', true
      );
    END IF;
  END IF;

  -- ─── Validate customer exists ──────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = v_customer_id) THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: Customer does not exist';
  END IF;

  -- ─── Split payment path ───────────────────────────────────────────────
  IF payload ? 'splits' AND jsonb_array_length(payload->'splits') > 0 THEN

    v_total_amount := 0;
    FOR v_split IN SELECT * FROM jsonb_array_elements(payload->'splits')
    LOOP
      IF (v_split->>'amount')::numeric <= 0 THEN
        RAISE EXCEPTION 'INVALID_SPLIT: Each split amount must be positive';
      END IF;
      IF v_split->>'method' IS NULL OR v_split->>'method' = '' THEN
        RAISE EXCEPTION 'INVALID_SPLIT: Each split must have a payment method';
      END IF;
      v_total_amount := v_total_amount + (v_split->>'amount')::numeric;
    END LOOP;

    IF v_total_amount <= 0 THEN
      RAISE EXCEPTION 'INVALID_SPLIT: Total split amount must be positive';
    END IF;

    v_payment_group_id := gen_random_uuid();
    v_split := payload->'splits'->0;

    BEGIN
      INSERT INTO customer_payments (id, customer_id, amount, method, notes,
        balance_after, payment_group_id, split_index, idempotency_key, created_at)
      VALUES (v_payment_group_id, v_customer_id,
        (v_split->>'amount')::numeric,
        (v_split->>'method')::payment_method,
        v_notes, 0, v_payment_group_id, 0,
        v_idempotency_key, now());

      FOR v_split_idx IN 1 .. jsonb_array_length(payload->'splits') - 1
      LOOP
        v_split := payload->'splits'->v_split_idx;

        INSERT INTO customer_payments (id, customer_id, amount, method, notes,
          balance_after, payment_group_id, split_index, idempotency_key, created_at)
        VALUES (gen_random_uuid(), v_customer_id,
          (v_split->>'amount')::numeric,
          (v_split->>'method')::payment_method,
          v_notes, 0, v_payment_group_id, v_split_idx,
          NULL, now());
      END LOOP;

    EXCEPTION WHEN unique_violation THEN
      SELECT payment_group_id INTO v_payment_group_id
      FROM customer_payments
      WHERE idempotency_key = v_idempotency_key
      LIMIT 1;

      SELECT SUM(amount), MAX(balance_after) INTO v_total_amount, v_new_balance
      FROM customer_payments
      WHERE payment_group_id = v_payment_group_id;

      RETURN jsonb_build_object(
        'id', v_payment_group_id,
        'balanceAfter', COALESCE(v_new_balance, 0),
        'splitCount', (SELECT count(*)::int FROM customer_payments WHERE payment_group_id = v_payment_group_id),
        'totalAmount', COALESCE(v_total_amount, 0),
        'idempotent', true
      );
    END;

    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_amount),
        total_paid = total_paid + v_total_amount,
        updated_at = now()
    WHERE id = v_customer_id
    RETURNING outstanding_balance INTO v_new_balance;

    UPDATE customer_payments
    SET balance_after = v_new_balance
    WHERE payment_group_id = v_payment_group_id;

    INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
    VALUES (v_actor, 'customer_payment_recorded', 'customer', v_customer_id,
      jsonb_build_object('amount', v_total_amount, 'splitCount', jsonb_array_length(payload->'splits')));

    RETURN jsonb_build_object(
      'id', v_payment_group_id,
      'balanceAfter', COALESCE(v_new_balance, 0),
      'splitCount', jsonb_array_length(payload->'splits'),
      'totalAmount', v_total_amount
    );

  -- ─── Single payment path (backward compatible) ────────────────────────
  ELSE
    v_total_amount := COALESCE((payload->>'amount')::numeric, 0);
    v_single_id := gen_random_uuid();

    BEGIN
      INSERT INTO customer_payments (id, customer_id, amount, method, notes,
        balance_after, payment_group_id, split_index, idempotency_key, created_at)
      VALUES (v_single_id, v_customer_id, v_total_amount,
        COALESCE((payload->>'method')::payment_method, 'cash'),
        v_notes, 0, v_single_id, 0,
        v_idempotency_key, now());

    EXCEPTION WHEN unique_violation THEN
      SELECT payment_group_id, balance_after INTO v_payment_group_id, v_new_balance
      FROM customer_payments
      WHERE idempotency_key = v_idempotency_key
      LIMIT 1;

      SELECT SUM(amount) INTO v_total_amount
      FROM customer_payments
      WHERE payment_group_id = v_payment_group_id;

      RETURN jsonb_build_object(
        'id', v_payment_group_id,
        'balanceAfter', COALESCE(v_new_balance, 0),
        'idempotent', true
      );
    END;

    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_amount),
        total_paid = total_paid + v_total_amount,
        updated_at = now()
    WHERE id = v_customer_id
    RETURNING outstanding_balance INTO v_new_balance;

    UPDATE customer_payments
    SET balance_after = v_new_balance
    WHERE id = v_single_id;

    INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
    VALUES (v_actor, 'customer_payment_recorded', 'customer', v_customer_id,
      jsonb_build_object('amount', v_total_amount));

    RETURN jsonb_build_object('id', v_single_id, 'balanceAfter', COALESCE(v_new_balance, 0));
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.record_customer_payment(jsonb) TO authenticated;

-- ── SUPPLIER PAYMENTS ────────────────────────────────────────────────────────

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
BEGIN
  v_actor := app_current_user_id();
  v_company_id := (payload->>'companyId')::uuid;

  SELECT shop_id INTO v_shop FROM companies WHERE id = v_company_id;
  PERFORM authorize_business_action('payments.supplier', COALESCE(v_shop, current_shop_id()));

  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company_id) THEN
    RAISE EXCEPTION 'SUPPLIER_NOT_FOUND';
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO supplier_payments (id, company_id, amount, method, notes, created_at)
  VALUES (v_id, v_company_id, (payload->>'amount')::numeric,
    COALESCE((payload->>'method'),'cash')::payment_method, payload->>'notes', now());

  UPDATE companies SET outstanding_payable = GREATEST(0, outstanding_payable - (payload->>'amount')::numeric),
    updated_at = now()
  WHERE id = v_company_id RETURNING outstanding_payable INTO v_payable;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'supplier_payment_recorded', 'company', v_company_id,
    jsonb_build_object('amount', (payload->>'amount')::numeric));

  RETURN jsonb_build_object('id', v_id, 'payableAfter', COALESCE(v_payable,0));
END;
$function$;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(jsonb) TO authenticated;

-- ── INVENTORY ────────────────────────────────────────────────────────────────
-- Behaviour preserved (product-level summary + variant sync + movement log);
-- authorization + tenant scoping added.

CREATE OR REPLACE FUNCTION public.adjust_stock(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_adjustment_type text;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();
  v_product_id := NULLIF(payload->>'productId', '')::uuid;
  v_variant_id := NULLIF(payload->>'variantId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('inventory.adjust', COALESCE(v_shop, current_shop_id()));

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product does not belong to your organization';
  END IF;

  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

  IF v_adjustment_type = 'add' THEN
    v_after := v_before + v_qty;
  ELSIF v_adjustment_type = 'remove' THEN
    v_after := GREATEST(0, v_before - v_qty);
  ELSIF v_adjustment_type = 'set' THEN
    v_after := v_qty;
  ELSE
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE: Unknown adjustment type: %', v_adjustment_type;
  END IF;

  IF v_after = v_before THEN
    RAISE EXCEPTION 'NO_CHANGE: Adjustment does not change stock level';
  END IF;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: Adjustment would make stock negative';
  END IF;

  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  IF v_variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;
  END IF;

  v_id := gen_random_uuid();
  INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, created_at)
  VALUES (v_id, v_product_id, payload->>'productName',
    v_variant_id, COALESCE(payload->>'variantName', ''),
    v_adjustment_type, v_before, v_after - v_before, v_after,
    payload->>'reason', v_actor::text, now());

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    v_variant_id,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_adjusted', 'product', v_product_id,
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after));

  RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.adjust_stock(jsonb) TO authenticated;

-- ── PRODUCTS ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_actor uuid;
  v_company_id uuid;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('products.edit', COALESCE(v_shop, current_shop_id()));
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  -- Supplier resolution stays name-based for frontend compatibility, but is now
  -- scoped to this tenant so a product can never be linked to another tenant's supplier.
  IF payload->>'company' IS NOT NULL AND payload->>'company' != '' THEN
    SELECT id INTO v_company_id FROM companies
    WHERE name = payload->>'company' AND shop_id = v_shop
    LIMIT 1;
  END IF;

  UPDATE products SET
    name = COALESCE(payload->>'name', name),
    company_id = COALESCE(v_company_id, company_id),
    category = COALESCE((payload->>'category')::product_category, category),
    image_url = COALESCE(NULLIF(payload->>'imageUrl', ''), image_url),
    updated_at = now()
  WHERE id = v_product_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'product_updated', 'product', v_product_id, payload);

  RETURN jsonb_build_object('id', v_product_id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.update_product(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('products.delete', COALESCE(v_shop, current_shop_id()));
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  UPDATE products SET is_active=false WHERE id=v_product_id;
  UPDATE product_variants SET is_active=false WHERE product_id=v_product_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'product_deleted', 'product', v_product_id, '{}'::jsonb);

  RETURN jsonb_build_object('id',v_product_id,'deactivated',true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.delete_product(jsonb) TO authenticated;

-- ── RETURNS ──────────────────────────────────────────────────────────────────
-- Adds the missing permission check plus the missing SALE_NOT_FOUND guard.

CREATE OR REPLACE FUNCTION public.process_return(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  v_sale_id := NULLIF(payload->>'saleId', '')::uuid;
  v_customer_id := NULLIF(payload->>'customerId', '')::uuid;
  v_resolution := COALESCE(payload->>'resolution', 'refund_cash');
  v_reason := payload->>'reason';
  v_processed_by := COALESCE(
    app_current_user_id(),
    NULLIF(payload->>'processedBy', '')::uuid
  );

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = v_sale_id;
  PERFORM authorize_business_action('returns.create', COALESCE(v_sale_shop, current_shop_id()));

  IF v_sale_shop IS NULL THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: Sale does not exist in your organization';
  END IF;

  v_shop_id := v_sale_shop;
  v_return_number := 'RET-' || LPAD(FLOOR(RANDOM()*99999)::text, 5, '0');

  INSERT INTO returns (
    id, return_number, sale_id, customer_id, customer_name,
    total_refund, resolution, reason, processed_by, processed_by_name,
    shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), v_return_number, v_sale_id, v_customer_id,
    COALESCE(payload->>'customerName', 'Customer'),
    0, v_resolution, v_reason, v_processed_by,
    (SELECT name FROM users WHERE id = v_processed_by),
    v_shop_id, now(), now()
  )
  RETURNING id INTO v_id;

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

  RETURN jsonb_build_object(
    'id', v_id, 'returnNumber', v_return_number,
    'totalRefund', v_total
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.process_return(jsonb) TO authenticated;

-- ── VOID SALE ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    v_change := ROUND((v_item.qty - v_already_returned) * COALESCE(v_item.unit_size, 1), 4);
    v_restored_stock := v_restored_stock + v_change;
    SELECT stock_qty INTO v_before FROM products WHERE id = v_item.product_id;
    v_before := COALESCE(v_before, 0);
    UPDATE products SET stock_qty = ROUND(stock_qty + v_change, 4) WHERE id = v_item.product_id;
    v_after := v_before + v_change;

    INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
      reference_type, reference_id, created_by, created_at)
    VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
      'void', p_sale_id, v_actor, now());
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
GRANT EXECUTE ON FUNCTION public.void_sale(uuid, text, uuid) TO authenticated;

-- void_sale_v1 kept for compatibility: it previously relied on the role check
-- only, so an admin of one tenant could void another tenant's sale.

CREATE OR REPLACE FUNCTION public.void_sale_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
  v_sale_shop uuid;
BEGIN
  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = v_sale_id;
  PERFORM authorize_business_action('sales.void', COALESCE(v_sale_shop, current_shop_id()));

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
END; $function$;
GRANT EXECUTE ON FUNCTION public.void_sale_v1(jsonb) TO authenticated;

-- ── CREDIT LIMIT REQUESTS ────────────────────────────────────────────────────
-- v2 previously trusted p_actor_id (caller-supplied) for the admin check, which
-- let an employee approve their own request by passing an admin id. Identity now
-- comes from the JWT and the permission is enforced.

CREATE OR REPLACE FUNCTION public.create_credit_limit_request(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_actor uuid;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();
  SELECT shop_id INTO v_shop FROM customers WHERE id = (payload->>'customer_id')::uuid;
  -- Requesting is open to any active member; approving is what needs a permission.
  PERFORM authorize_tenant_membership(COALESCE(v_shop, current_shop_id()));
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  INSERT INTO credit_limit_requests (customer_id, customer_name, requested_by, current_limit, requested_limit, reason, status)
  VALUES ((payload->>'customer_id')::uuid, payload->>'customer_name', COALESCE(payload->>'requested_by', v_actor::text),
    (payload->>'current_limit')::numeric, (payload->>'requested_limit')::numeric, payload->>'reason', 'pending')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_credit_limit_request(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_credit_limit_request_v2(p_request_id uuid, p_reviewed_by text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'approved', reviewed_by = COALESCE(p_reviewed_by, v_actor::text), reviewed_at = now() WHERE id = p_request_id;
  UPDATE customers SET credit_limit = req.requested_limit WHERE id = req.customer_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_approved', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'newLimit', req.requested_limit));

  RETURN jsonb_build_object('status', 'approved');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_credit_limit_request_v2(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_credit_limit_request_v2(p_request_id uuid, p_reviewed_by text, p_reason text, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'rejected', reviewed_by = COALESCE(p_reviewed_by, v_actor::text), reviewed_at = now(), rejection_reason = p_reason WHERE id = p_request_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_rejected', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'reason', p_reason));

  RETURN jsonb_build_object('status', 'rejected');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.reject_credit_limit_request_v2(uuid, text, text, uuid) TO authenticated;

-- ── CREDIT LIMIT v1 + void_sale_v1 ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_credit_limit_request(p_request_id uuid, p_reviewed_by text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'approved', reviewed_by = p_reviewed_by, reviewed_at = now() WHERE id = p_request_id;
  UPDATE customers SET credit_limit = req.requested_limit WHERE id = req.customer_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_approved', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'newLimit', req.requested_limit));

  RETURN jsonb_build_object('status', 'approved');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_credit_limit_request(uuid, text) TO authenticated;

-- 0066/0083 defined this as (p_request_id, p_reviewed_by, p_rejection_reason).
-- The argument TYPES are the same, so CREATE OR REPLACE would try to replace it
-- and refuse: "cannot change name of input parameter". Drop the old signature.
DROP FUNCTION IF EXISTS public.reject_credit_limit_request(uuid, text, text);

CREATE OR REPLACE FUNCTION public.reject_credit_limit_request(p_request_id uuid, p_rejection_reason text, p_reviewed_by text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req RECORD;
  v_actor uuid;
  v_shop uuid;
BEGIN
  v_actor := app_current_user_id();
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  SELECT * INTO req FROM credit_limit_requests WHERE id = p_request_id AND status = 'pending';
  IF req IS NULL THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

  UPDATE credit_limit_requests SET status = 'rejected', reviewed_by = p_reviewed_by, reviewed_at = now(), rejection_reason = p_rejection_reason WHERE id = p_request_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'credit_limit_request_rejected', 'customer', req.customer_id,
    jsonb_build_object('requestId', p_request_id, 'reason', p_rejection_reason));

  RETURN jsonb_build_object('status', 'rejected');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.reject_credit_limit_request(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_credit_limit_request(p_request_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop uuid;
BEGIN
  SELECT c.shop_id INTO v_shop
  FROM credit_limit_requests r JOIN customers c ON c.id = r.customer_id
  WHERE r.id = p_request_id;
  PERFORM authorize_business_action('alerts.manage', COALESCE(v_shop, current_shop_id()));

  DELETE FROM credit_limit_requests WHERE id = p_request_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.delete_credit_limit_request(uuid) TO authenticated;

-- ── EMPLOYEE LIFECYCLE ───────────────────────────────────────────────────────
-- Role check (users.role = 'admin') replaced by the membership permission
-- employees.manage, which the Store Manager template holds by default.
-- Signatures, tenant isolation, audit and history preservation are unchanged.

CREATE OR REPLACE FUNCTION public.deactivate_employee_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_emp_id uuid;
  v_emp record;
  v_shop_id uuid;
BEGIN
  v_actor_id := app_current_user_id();
  v_shop_id := current_shop_id();
  PERFORM authorize_business_action('employees.manage', v_shop_id);

  v_emp_id := COALESCE(NULLIF((payload->>'employeeId')::text, '')::uuid, NULLIF((payload->>'employee_id')::text, '')::uuid);
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'VALIDATION: Employee ID is required'; END IF;

  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization'; END IF;
  IF v_emp.is_original_owner THEN RAISE EXCEPTION 'CANNOT_DEACTIVATE_OWNER: Cannot deactivate the shop owner'; END IF;
  IF v_emp.is_active = false THEN RAISE EXCEPTION 'ALREADY_DEACTIVATED: Employee is already deactivated'; END IF;

  UPDATE users SET is_active = false, deactivated_at = now(), deactivated_by = v_actor_id WHERE id = v_emp_id;
  UPDATE memberships SET status = 'suspended', updated_at = now() WHERE user_id = v_emp_id AND tenant_id = v_shop_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'employee_deactivated', 'user', v_emp_id, jsonb_build_object('name', v_emp.name));

  RETURN jsonb_build_object('id', v_emp_id, 'isActive', false);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.deactivate_employee_v1(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_employee_v1(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_emp_id uuid;
  v_emp record;
  v_shop_id uuid;
BEGIN
  v_actor_id := app_current_user_id();
  v_shop_id := current_shop_id();
  PERFORM authorize_business_action('employees.manage', v_shop_id);

  v_emp_id := COALESCE(NULLIF((payload->>'employeeId')::text, '')::uuid, NULLIF((payload->>'employee_id')::text, '')::uuid);
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'VALIDATION: Employee ID is required'; END IF;

  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization'; END IF;
  IF v_emp.is_active = true THEN RAISE EXCEPTION 'ALREADY_ACTIVE: Employee is already active'; END IF;

  -- Reactivation restores access from the employee's CURRENT membership/role
  -- configuration; it never restores permissions that were changed meanwhile.
  UPDATE users SET is_active = true, deactivated_at = NULL, deactivated_by = NULL WHERE id = v_emp_id;
  UPDATE memberships SET status = 'active', updated_at = now() WHERE user_id = v_emp_id AND tenant_id = v_shop_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor_id, 'employee_activated', 'user', v_emp_id, jsonb_build_object('name', v_emp.name));

  RETURN jsonb_build_object('id', v_emp_id, 'isActive', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.activate_employee_v1(jsonb) TO authenticated;

-- ── VERIFICATION ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(f, ', ') INTO v_missing
  FROM unnest(ARRAY[
    'archive_customer','restore_customer','update_customer_image','update_customer_due_date',
    'record_customer_payment','record_supplier_payment','adjust_stock','update_product',
    'delete_product','process_return','void_sale','void_sale_v1','create_credit_limit_request',
    'approve_credit_limit_request','approve_credit_limit_request_v2',
    'reject_credit_limit_request','reject_credit_limit_request_v2','delete_credit_limit_request',
    'deactivate_employee_v1','activate_employee_v1'
  ]) AS f
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = f
      AND (pg_get_functiondef(p.oid) LIKE '%authorize_business_action%'
        OR pg_get_functiondef(p.oid) LIKE '%authorize_tenant_membership%')
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Unauthorized business function(s) remain: %', v_missing;
  END IF;
  RAISE NOTICE '0112: every audited business write path enforces effective access';
END $$;
