-- Fix delete_product: soft-delete instead of hard DELETE
-- The test expects is_active = false, not row removal

CREATE OR REPLACE FUNCTION delete_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor uuid;
  v_caller_role text;
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
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can delete products';
  END IF;

  -- Soft-delete: set is_active = false, record deleted_at
  UPDATE products SET is_active = false, deleted_at = NOW() WHERE id = (payload->>'id')::uuid;
  UPDATE product_variants SET is_active = false WHERE product_id = (payload->>'id')::uuid;

  RETURN jsonb_build_object('success', true);
END;
$$;
