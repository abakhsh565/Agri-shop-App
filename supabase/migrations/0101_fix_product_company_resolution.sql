-- Fix create_product to resolve company_id from company name
-- The frontend sends `company` (string name), not `companyId` (UUID).
-- This migration updates the RPC to look up the company_id from the companies table.

-- 1. Fix create_product: resolve company_id from company name
DROP FUNCTION IF EXISTS create_product(jsonb);

CREATE OR REPLACE FUNCTION create_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_id uuid;
  v_resolved jsonb;
  v_shop_id uuid;
  v_actor uuid;
  v_company_id uuid;
  v_item jsonb;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId', '')::uuid,
    NULLIF(payload->>'userId', '')::uuid,
    NULLIF(payload->>'createdBy', '')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  -- Resolve company_id from company name (frontend sends 'company', not 'companyId')
  IF payload->>'company' IS NOT NULL AND payload->>'company' != '' THEN
    SELECT id INTO v_company_id FROM companies
    WHERE name = payload->>'company' AND shop_id = v_shop_id
    LIMIT 1;
  END IF;

  INSERT INTO products (
    id, name, category, company_id, image_url, is_active, shop_id, created_at
  ) VALUES (
    gen_random_uuid(),
    payload->>'name',
    COALESCE((payload->>'category')::product_category, 'other'),
    v_company_id,
    NULLIF(payload->>'imageUrl', ''),
    true, v_shop_id, now()
  )
  RETURNING id INTO v_product_id;

  -- Insert variants
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants', '[]'::jsonb))
  LOOP
    INSERT INTO product_variants (
      product_id, name, selling_price, cost_price, stock_qty,
      low_stock_threshold, unit_size, is_active
    ) VALUES (
      v_product_id,
      v_item->>'name',
      COALESCE((v_item->>'sellingPrice')::numeric, 0),
      COALESCE((v_item->>'costPrice')::numeric, 0),
      COALESCE((v_item->>'stockQty')::int, 0),
      GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, 5), 0),
      GREATEST(COALESCE((v_item->>'unitSize')::numeric, 1), 1),
      true
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_product_id, 'name', payload->>'name');
END;
$$;

GRANT EXECUTE ON FUNCTION create_product(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION create_product(jsonb) TO anon;


-- 2. Fix update_product: resolve company_id from company name
DROP FUNCTION IF EXISTS update_product(jsonb);

CREATE OR REPLACE FUNCTION update_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_actor uuid;
  v_caller_role text;
  v_company_id uuid;
BEGIN
  -- Resolve actor
  v_actor := COALESCE(
    NULLIF(payload->>'actorId', '')::uuid,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );

  -- Authorization: only admin/co_admin
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' AND v_caller_role IS DISTINCT FROM 'co_admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can update products';
  END IF;

  -- Resolve company_id from company name if provided
  IF payload->>'company' IS NOT NULL AND payload->>'company' != '' THEN
    SELECT id INTO v_company_id FROM companies
    WHERE name = payload->>'company'
    LIMIT 1;
  END IF;

  UPDATE products SET
    name = COALESCE(payload->>'name', name),
    company_id = COALESCE(v_company_id, company_id),
    category = COALESCE((payload->>'category')::product_category, category),
    image_url = COALESCE(NULLIF(payload->>'imageUrl', ''), image_url),
    updated_at = now()
  WHERE id = v_product_id;

  RETURN jsonb_build_object('id', v_product_id);
END;
$$;

GRANT EXECUTE ON FUNCTION update_product(jsonb) TO authenticated;
