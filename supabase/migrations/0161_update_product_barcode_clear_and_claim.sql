-- MIGRATION 0161: an emptied barcode field means "no barcode on this product"
--
-- On the Edit Product screen the barcode is one field. Clearing it and saving must mean the
-- product has no barcode — that is the plain reading of an empty field, and it is how the shop
-- removes one without a separate Delete action to find.
--
-- `update_product` could not express that. It treated an empty barcode as "not mentioned":
--
--   v_code := upper(regexp_replace(NULLIF(payload->>'barcode',''), '\s', '', 'g'));
--   IF v_code IS NOT NULL THEN ... END IF;
--
-- NULLIF turns '' into NULL, so clearing the field fell straight through the IF and the old
-- barcode stayed on the product while the screen showed an empty field. The save said it
-- worked and nothing happened — the worst kind of quiet.
--
-- The distinction that was missing is the one `expiryDate` on the same screen already makes:
-- a payload that does not mention the barcode leaves it alone (so an older client, or an
-- update that is not about barcodes at all, cannot wipe one by omission), while a payload that
-- says `"barcode": ""` is the owner saying there is no barcode.
--
-- Removing a code retires it into barcode_registry (0160) rather than forgetting it, so it can
-- never be put on another product, and no past sale changes — a sale references the product and
-- the variant, never the code.
--
-- `create_product` is deliberately untouched: there, an empty barcode still means "mint one",
-- because a product being created should get a code rather than none.

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
  v_unit text;
  v_existing_unit text;
  v_code text;
  v_stock numeric;
  v_cost numeric;
BEGIN
  v_actor := app_current_user_id();

  SELECT shop_id, lower(base_unit) INTO v_shop, v_existing_unit FROM products WHERE id = v_product_id;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;
  PERFORM authorize_business_action('products.edit', v_shop);

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE id = (payload->>'companyId')::uuid AND shop_id = v_shop LIMIT 1;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN
    SELECT id INTO v_company_id FROM companies
     WHERE name = payload->>'company' AND shop_id = v_shop LIMIT 1;
  END IF;

  -- A new product is weighed or measured. An existing one that predates that rule may keep
  -- the unit it already has, so opening a legacy product for editing cannot silently
  -- re-denominate it — but no edit may move a product INTO an unusable unit.
  v_unit := lower(NULLIF(payload->>'baseUnit',''));
  IF v_unit IS NOT NULL AND v_unit NOT IN ('kg','liter') AND v_unit IS DISTINCT FROM v_existing_unit THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg or liter, not "%"', v_unit;
  END IF;

  UPDATE products SET
    name = COALESCE(NULLIF(payload->>'name',''), name),
    company_id = COALESCE(v_company_id, company_id),
    category = COALESCE((NULLIF(payload->>'category',''))::product_category, category),
    base_unit = COALESCE(v_unit, base_unit),
    image_url = COALESCE(NULLIF(payload->>'imageUrl',''), image_url),
    updated_at = now()
  WHERE id = v_product_id;

  -- The code itself lives in product_barcodes; the mirror trigger updates products.barcode.
  --
  -- Three cases, and the difference between them is what the payload says, not what it happens
  -- to contain: absent leaves the code alone; present and empty removes it; present with a code
  -- sets it. A removal travels to the delete trigger as a reason, so the history says why the
  -- code was retired rather than leaving a bare 'deleted'.
  IF payload ? 'barcode' THEN
    v_code := public.barcode_normalize(payload->>'barcode');

    IF v_code = '' THEN
      PERFORM set_config('app.barcode_reason', 'barcode cleared on the product screen', true);
      DELETE FROM product_barcodes WHERE product_id = v_product_id;
      PERFORM set_config('app.barcode_reason', '', true);
    ELSE
      IF EXISTS (
        SELECT 1 FROM product_barcodes
         WHERE shop_id = v_shop AND code = v_code AND product_id <> v_product_id
      ) THEN
        RAISE EXCEPTION 'BARCODE_TAKEN: "%" is already on another product in this shop', v_code;
      END IF;

      UPDATE product_barcodes SET code = v_code
       WHERE product_id = v_product_id AND is_primary;

      IF NOT FOUND THEN
        INSERT INTO product_barcodes(shop_id, product_id, code, is_primary, source, created_by)
        VALUES(v_shop, v_product_id, v_code, true, 'supplied', v_actor);
      END IF;
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    v_variant_id := NULLIF(v_item->>'id','')::uuid;

    IF v_variant_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM product_variants WHERE id = v_variant_id AND product_id = v_product_id)
    THEN
      -- Stock is not in this list on purpose: the catalogue does not own it (0145), and the
      -- `protect_product_stock` trigger refuses a write to the product's rollup anyway.
      UPDATE product_variants SET
        name = COALESCE(NULLIF(v_item->>'name',''), name),
        selling_price = COALESCE((v_item->>'sellingPrice')::numeric, selling_price),
        cost_price = COALESCE((v_item->>'costPrice')::numeric, cost_price),
        unit_size = GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), unit_size), 0.001),
        qty_step = GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), qty_step), 0.001),
        low_stock_threshold = GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, low_stock_threshold), 0),
        -- Present-but-empty clears the date; absent leaves it alone. Without that
        -- distinction, a date typed by mistake could never be removed, and a payload that
        -- simply does not mention expiry would silently wipe it.
        expiry_date = CASE WHEN v_item ? 'expiryDate'
                           THEN NULLIF(v_item->>'expiryDate','')::date
                           ELSE expiry_date END,
        updated_at = now()
      WHERE id = v_variant_id;
    ELSIF NULLIF(v_item->>'name','') IS NOT NULL THEN
      -- A pack added while editing is a creation, so it may arrive with stock — written as
      -- an opening movement for the same reason as on create.
      v_stock := GREATEST(COALESCE((v_item->>'stockQty')::numeric, 0), 0);
      v_cost  := COALESCE((v_item->>'costPrice')::numeric, 0);

      INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,qty_step,is_active,expiry_date)
      VALUES (
        v_product_id,
        v_item->>'name',
        COALESCE((v_item->>'sellingPrice')::numeric, 0),
        v_cost,
        v_stock,
        GREATEST(COALESCE((v_item->>'lowStockThreshold')::int, 5), 0),
        GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), 1), 0.001),
        GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), 1), 0.001),
        true,
        NULLIF(v_item->>'expiryDate','')::date
      ) RETURNING id INTO v_variant_id;

      IF v_stock > 0 THEN
        INSERT INTO inventory_movements(
          variant_id, product_id, movement_type, qty_before, qty_change, qty_after,
          reference_type, reference_id, unit_cost, notes, created_by, branch_id
        ) VALUES (
          v_variant_id, v_product_id, 'adjustment', 0, v_stock, v_stock,
          'product', v_variant_id, v_cost, 'Opening stock', v_actor, NULLIF(payload->>'branchId','')::uuid
        );
      END IF;
    END IF;
  END LOOP;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'product_updated', 'product', v_product_id, payload);

  RETURN jsonb_build_object('id', v_product_id);
END;
$function$;
