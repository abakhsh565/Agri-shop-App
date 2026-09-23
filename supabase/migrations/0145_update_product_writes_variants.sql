-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0145: editing a product must actually save its prices
-- ═══════════════════════════════════════════════════════════════════════════════
-- FOUND (by driving the real RPC as the owner and reading the table back):
--
--   update_product wrote ONLY the product row —
--       name, company_id, category, image_url
--   — and nothing else. There was no variant handling at all.
--
-- The Edit Product screen collects a selling price and a cost price per unit, plus
-- unit size, quantity step and the low-stock threshold, and the app sends every one
-- of them. All of it was accepted by the API and silently dropped: the screen said
-- "saved", the row was unchanged, and the old price kept being used at the till.
-- Selling prices could not be changed at all, so "a price change applies to future
-- sales only" was untestable — there was no way to make one.
--
-- FIX: variants are applied by id (update in place) or inserted when they are new.
-- Two things are deliberately NOT written:
--
--   1. `stock_qty` is never taken from the payload. Stock is owned by the movement
--      path (create_sale / create_purchase / process_return / void_sale /
--      adjust_stock) and a catalogue edit must not overwrite the quantity on hand.
--   2. An existing variant is never deleted; a variant omitted from the payload is
--      left alone. Deleting one would orphan historical sale/purchase lines that
--      reference it.
--
-- Price changes are forward-looking by construction: past sales already carry their
-- own stamped unit price and COGS snapshot (0127), and past purchases carry their own
-- unit cost, so nothing historical is rewritten by editing the catalogue.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid := (payload->>'id')::uuid;
  v_actor uuid;
  v_company_id uuid;
  v_shop uuid;
  v_item jsonb;
  v_variant_id uuid;
BEGIN
  v_actor := app_current_user_id();

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  PERFORM authorize_business_action('products.edit', v_shop);

  -- Supplier resolution stays name-based for frontend compatibility, but is now
  -- scoped to this tenant so a product can never be linked to another tenant's supplier.
  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE id = (payload->>'companyId')::uuid AND shop_id = v_shop LIMIT 1;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE name = payload->>'company' AND shop_id = v_shop LIMIT 1;
  END IF;

  UPDATE products SET
    name = COALESCE(NULLIF(payload->>'name',''), name),
    company_id = COALESCE(v_company_id, company_id),
    category = COALESCE((NULLIF(payload->>'category',''))::product_category, category),
    base_unit = COALESCE(NULLIF(payload->>'baseUnit',''), base_unit),
    barcode = COALESCE(NULLIF(payload->>'barcode',''), barcode),
    image_url = COALESCE(NULLIF(payload->>'imageUrl',''), image_url),
    updated_at = now()
  WHERE id = v_product_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    v_variant_id := NULLIF(v_item->>'id','')::uuid;

    IF v_variant_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = v_product_id)
    THEN
      -- In place. `stock_qty` is intentionally absent: the catalogue does not own it.
      UPDATE product_variants SET
        name = COALESCE(NULLIF(v_item->>'name',''), name),
        selling_price = COALESCE((v_item->>'sellingPrice')::numeric, selling_price),
        cost_price = COALESCE((v_item->>'costPrice')::numeric, cost_price),
        unit_size = GREATEST(COALESCE((v_item->>'unitSize')::numeric, unit_size), 1),
        qty_step = GREATEST(COALESCE((v_item->>'qtyStep')::numeric, qty_step), 1),
        low_stock_threshold = GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, low_stock_threshold), 0),
        updated_at = now()
      WHERE id = v_variant_id;
    ELSIF NULLIF(v_item->>'name','') IS NOT NULL THEN
      -- A newly added unit starts empty; stock arrives by purchase or adjustment.
      INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,is_active)
      VALUES (
        v_product_id,
        v_item->>'name',
        COALESCE((v_item->>'sellingPrice')::numeric, 0),
        COALESCE((v_item->>'costPrice')::numeric, 0),
        0,
        GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, 5), 0),
        GREATEST(COALESCE((v_item->>'unitSize')::numeric, 1), 1),
        true
      );
    END IF;
  END LOOP;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'product_updated', 'product', v_product_id, payload);

  RETURN jsonb_build_object('id', v_product_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_product(jsonb) TO authenticated;
