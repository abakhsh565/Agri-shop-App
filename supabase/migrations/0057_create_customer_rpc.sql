-- ============================================================
-- Migration 0057: Create Customer RPC — Secure Customer Creation
-- ============================================================

CREATE OR REPLACE FUNCTION create_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  -- Validate phone uniqueness
  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM customers WHERE phone = v_phone AND is_archived = false) THEN
      RAISE EXCEPTION 'A customer with this phone number already exists';
    END IF;
  END IF;

  -- Insert customer
  INSERT INTO customers (
    id, name, phone, address, credit_limit, created_by, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    v_phone,
    NULLIF(payload->>'address', ''),
    COALESCE((payload->>'credit_limit')::numeric, 0),
    NULLIF(payload->>'created_by', '')::uuid,
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

-- Also create RPCs for other customer mutations that use direct table access

-- Update customer image
CREATE OR REPLACE FUNCTION update_customer_image(p_customer_id uuid, p_image_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers SET image_url = p_image_url, updated_at = now() WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_image(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION update_customer_image(uuid, text) TO authenticated;

-- Update customer due date
CREATE OR REPLACE FUNCTION update_customer_due_date(p_customer_id uuid, p_due_date text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE customers SET due_date = NULLIF(p_due_date, '')::date, updated_at = now() WHERE id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION update_customer_due_date(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION update_customer_due_date(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
