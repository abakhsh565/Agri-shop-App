-- FINAL FIX: Create default shop + fix create_product function
-- The products table has NOT NULL shop_id but no shop exists

-- 1. Create default shop (bypasses RLS)
INSERT INTO shops(id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Default Shop') ON CONFLICT(id) DO NOTHING;

-- 2. Also fix RLS on shops table
DROP POLICY IF EXISTS "public_all_shops" ON shops;
CREATE POLICY "public_all_shops" ON shops FOR ALL USING (true) WITH CHECK (true);

-- 3. Drop and recreate create_product with fallback shop_id
DROP FUNCTION IF EXISTS create_product(payload jsonb);
DROP FUNCTION IF EXISTS create_product(p_payload jsonb);

CREATE OR REPLACE FUNCTION create_product(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid; v_variant jsonb;
  v_shop_id uuid;
BEGIN
  -- Get shop_id from JWT, or fallback to default shop
  v_shop_id := NULLIF(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid;
  IF v_shop_id IS NULL THEN
    v_shop_id := '00000000-0000-0000-0000-000000000001';
  END IF;

  v_product_id := gen_random_uuid();
  INSERT INTO products (id, name, company, category, base_unit, stock_qty,
    image_url, barcode, shop_id, created_at, updated_at)
  VALUES (v_product_id, payload->>'name', payload->>'company',
    COALESCE(payload->>'category','spray')::product_category,
    COALESCE(payload->>'baseUnit','piece'), COALESCE((payload->>'stockQty')::numeric,0),
    payload->>'image_url', payload->>'barcode',
    v_shop_id, now(), now());

  FOR v_variant IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb))
  LOOP
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price,
      unit_size, qty_step, low_stock_threshold, created_at, updated_at)
    VALUES (gen_random_uuid(), v_product_id, v_variant->>'name',
      (v_variant->>'sellingPrice')::numeric, (v_variant->>'costPrice')::numeric,
      (v_variant->>'unitSize')::numeric, (v_variant->>'qtyStep')::numeric,
      COALESCE((v_variant->>'lowStockThreshold')::numeric, 5), now(), now());
  END LOOP;
  RETURN jsonb_build_object('id', v_product_id);
END;
$$;
