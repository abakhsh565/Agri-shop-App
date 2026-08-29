-- Fix: delete_product was hard-deleting products and variants,
-- which fails when sale_items still reference them (FK RESTRICT).
-- Change to soft-delete (set is_active=false) so historical data is preserved.

CREATE OR REPLACE FUNCTION delete_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_has_sales boolean;
BEGIN
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  -- Check if product has any sale history
  SELECT EXISTS(
    SELECT 1 FROM sale_items WHERE product_id = v_product_id
  ) INTO v_has_sales;

  IF v_has_sales THEN
    -- Has sales: soft-delete (archive) — preserve historical data
    UPDATE products SET is_active = false WHERE id = v_product_id;
    UPDATE product_variants SET is_active = false WHERE product_id = v_product_id;
    RETURN jsonb_build_object('id', v_product_id, 'deactivated', true);
  ELSE
    -- No sales: safe to hard-delete
    DELETE FROM product_variants WHERE product_id = v_product_id;
    DELETE FROM products WHERE id = v_product_id;
    RETURN jsonb_build_object('id', v_product_id, 'deactivated', false);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_product(jsonb) TO authenticated;
