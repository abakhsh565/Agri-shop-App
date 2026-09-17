-- ============================================================
-- Migration 0093: Fix create_customer — add shop_id from JWT
-- ============================================================
-- Root cause: create_customer INSERTed into customers without shop_id,
-- but customers.shop_id is NOT NULL. This caused every customer
-- creation to fail with:
--   "null value in column shop_id of relation customers violates not-null constraint"
-- Fix: resolve shop_id from JWT claims, same pattern as create_product.
-- ============================================================

CREATE OR REPLACE FUNCTION create_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_phone text;
  v_shop_id uuid;
  v_actor uuid;
BEGIN
  -- Resolve actor from explicit parameter → JWT sub → system default
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  );

  -- Resolve shop_id from JWT claims → system default
  v_shop_id := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::json->>'shop_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );

  -- Validate phone uniqueness
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  -- Insert customer WITH shop_id
  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, shop_id, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    NULLIF(payload->>'created_by', '')::uuid,
    v_shop_id,
    now(),
    now()
  ) RETURNING id INTO v_id;

  -- Insert crops if provided
  IF payload ? 'crops' THEN
    INSERT INTO customer_crops (customer_id, crop_name)
    SELECT v_id, crop.value
    FROM jsonb_array_elements_text(payload->'crops') AS crop;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_customer(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION create_customer(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
