-- Migration 0080: Payment Idempotency
-- Prevents duplicate payment records from retries/network issues
-- Follows the same proven pattern used in returns (migration 0014)

-- ─── Schema Changes ─────────────────────────────────────────────────────────

-- Idempotency key: client-generated UUID per logical payment submission.
-- All rows from one split-payment share the same key.
-- Nullable: backward compatible — existing rows have NULL (no key = no dedup).
ALTER TABLE customer_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Unique index: only enforced when key is NOT NULL (partial index).
-- This means NULL keys are allowed (backward compatible) but duplicate
-- non-NULL keys are rejected at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_idempotency_key
  ON customer_payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';

COMMENT ON COLUMN customer_payments.idempotency_key IS
  'Client-generated UUID for idempotent payment recording. Same key = same logical payment. NULL = legacy/no-dedup.';

-- ─── Updated RPC ────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS record_customer_payment(jsonb);

CREATE OR REPLACE FUNCTION record_customer_payment(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
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
BEGIN
  -- Resolve actor
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Authorization: admin/co_admin only
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can record customer payments';
  END IF;

  v_customer_id := (payload->>'customerId')::uuid;
  v_notes := payload->>'notes';

  -- Extract idempotency key (accept both snake_case and camelCase)
  v_idempotency_key := NULLIF(COALESCE(
    payload->>'idempotency_key',
    payload->>'idempotencyKey'
  ), '');

  -- ─── IDEMPOTENCY CHECK ─────────────────────────────────────────────────
  -- If a key is provided and a payment with that key already exists,
  -- return the original result without creating new rows or changing balance.
  IF v_idempotency_key IS NOT NULL THEN
    SELECT payment_group_id INTO v_payment_group_id
    FROM customer_payments
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      -- Return the existing payment group
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

    -- Validate splits
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

    -- Deduct total from customer balance
    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_amount),
        total_paid = total_paid + v_total_amount,
        updated_at = now()
    WHERE id = v_customer_id
    RETURNING outstanding_balance INTO v_new_balance;

    -- Insert first split (becomes the group ID)
    v_payment_group_id := gen_random_uuid();
    v_split := payload->'splits'->0;

    BEGIN
      INSERT INTO customer_payments (id, customer_id, amount, method, notes,
        balance_after, payment_group_id, split_index, idempotency_key, created_at)
      VALUES (v_payment_group_id, v_customer_id,
        (v_split->>'amount')::numeric,
        (v_split->>'method')::payment_method,
        v_notes, v_new_balance, v_payment_group_id, 0,
        v_idempotency_key, now());

      -- Insert remaining splits (with same idempotency key)
      FOR v_split_idx IN 1 .. jsonb_array_length(payload->'splits') - 1
      LOOP
        v_split := payload->'splits'->v_split_idx;

        INSERT INTO customer_payments (id, customer_id, amount, method, notes,
          balance_after, payment_group_id, split_index, idempotency_key, created_at)
        VALUES (gen_random_uuid(), v_customer_id,
          (v_split->>'amount')::numeric,
          (v_split->>'method')::payment_method,
          v_notes, v_new_balance, v_payment_group_id, v_split_idx,
          NULL, now());
      END LOOP;

    EXCEPTION WHEN unique_violation THEN
      -- Concurrent duplicate: another request inserted the same key.
      -- Return the existing result (idempotent retry).
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

    UPDATE customers
    SET outstanding_balance = GREATEST(0, outstanding_balance - v_total_amount),
        total_paid = total_paid + v_total_amount,
        updated_at = now()
    WHERE id = v_customer_id
    RETURNING outstanding_balance INTO v_new_balance;

    BEGIN
      INSERT INTO customer_payments (id, customer_id, amount, method, notes,
        balance_after, payment_group_id, split_index, idempotency_key, created_at)
      VALUES (v_single_id, v_customer_id, v_total_amount,
        COALESCE((payload->>'method')::payment_method, 'cash'),
        v_notes, v_new_balance, v_single_id, 0,
        v_idempotency_key, now());

    EXCEPTION WHEN unique_violation THEN
      -- Concurrent duplicate: return existing result
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

    RETURN jsonb_build_object('id', v_single_id, 'balanceAfter', COALESCE(v_new_balance, 0));
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION record_customer_payment(jsonb) TO authenticated;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
