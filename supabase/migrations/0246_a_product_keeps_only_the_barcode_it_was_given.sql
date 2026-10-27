-- 0246 — a product keeps only the barcode it was given.
--
-- `create_product` minted a code for every product that arrived without one:
--
--     COALESCE(NULLIF(payload->>'barcode',''), mint_barcode(payload->>'name', v_shop_id))
--
-- so adding a product with the barcode field left empty produced a product WITH a barcode, and
-- the product screen then showed a code nobody had typed, scanned or asked for (owner's report,
-- 2026-10-26, measured on the add form).
--
-- The rule is now the plain one: the barcode is a fact about the product, not housekeeping. If a
-- code was given — typed, scanned off a packet, or minted on purpose with the screen's own
-- Generate button, which calls `preview_product_barcode` — it is stored exactly as before. If no
-- code was given, the product has none: no `product_barcodes` row is written, and because the
-- mirror trigger is the only writer of `products.barcode`, that column stays NULL too.
--
-- What this does NOT change: `mint_barcode` (still the generator the Generate button previews
-- with), the registry, the retirement history, the per-shop uniqueness rule, or `update_product`.
-- Clearing the field on an edit still retires the code it replaces; an empty field on create now
-- means there is no code yet rather than "make one up".

CREATE OR REPLACE FUNCTION public.create_product(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_resolved   jsonb;
  v_shop_id    uuid;
  v_actor      uuid;
  v_branch_id  uuid;
  v_company_id uuid;
  v_item       jsonb;
  v_variant_id uuid;
  v_unit       text;
  v_code       text;
  v_stock      numeric;
  v_cost       numeric;
  v_listed     boolean;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  v_branch_id := NULLIF(payload->>'branchId','')::uuid;
  PERFORM authorize_business_action('products.create',v_shop_id,v_branch_id);

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN v_company_id := (payload->>'companyId')::uuid;
  ELSIF NULLIF(payload->>'company','') IS NOT NULL THEN SELECT id INTO v_company_id FROM companies WHERE name=payload->>'company' AND shop_id=v_shop_id LIMIT 1; END IF;
  IF v_company_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM companies WHERE id=v_company_id AND shop_id=v_shop_id) THEN RAISE EXCEPTION 'NOT_AUTHORIZED: supplier belongs to another tenant'; END IF;

  -- The shop sells by weight or by volume. A new product cannot be anything else, and the
  -- unit is stored rather than defaulted, so the pack size below means what it says.
  v_unit := lower(COALESCE(NULLIF(payload->>'baseUnit',''), 'kg'));
  IF v_unit NOT IN ('kg','liter') THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg or liter, not "%"', v_unit;
  END IF;

  -- The caller's code, or nothing. It used to fall back to `mint_barcode`, which is what put a
  -- barcode on products whose owner never gave one; the fallback is gone (0246). A generated code
  -- still arrives here as a supplied one — the Generate button writes it into the field, and the
  -- field is what the payload carries.
  v_code := upper(regexp_replace(NULLIF(payload->>'barcode',''), '\s', '', 'g'));
  IF v_code IS NOT NULL AND EXISTS (SELECT 1 FROM product_barcodes WHERE shop_id = v_shop_id AND code = v_code) THEN
    RAISE EXCEPTION 'BARCODE_TAKEN: "%" is already on another product in this shop', v_code;
  END IF;

  -- The owner's listing decision. Absent means NOT listed: a product being created is never
  -- publicly visible by accident, and a client that predates this feature cannot list one.
  v_listed := COALESCE((payload->>'marketplaceListed')::boolean, false);

  INSERT INTO products(id,name,category,company_id,image_url,base_unit,is_active,shop_id,created_at,
                       marketplace_listed,marketplace_listed_at)
  VALUES(
    gen_random_uuid(),
    payload->>'name',
    COALESCE((payload->>'category')::product_category,'other'),
    v_company_id,
    NULLIF(payload->>'imageUrl',''),
    v_unit,
    true,
    v_shop_id,
    now(),
    v_listed,
    CASE WHEN v_listed THEN now() ELSE NULL END
  ) RETURNING id INTO v_product_id;

  -- `products.barcode` is written by the mirror trigger, never here: one writer, no drift — and
  -- with no row written, there is no code for the trigger to mirror.
  IF v_code IS NOT NULL THEN
    INSERT INTO product_barcodes(shop_id, product_id, code, is_primary, source, created_by)
    VALUES(v_shop_id, v_product_id, v_code, true, 'supplied', v_actor);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'variants','[]'::jsonb)) LOOP
    v_stock := GREATEST(COALESCE((v_item->>'stockQty')::numeric, 0), 0);
    v_cost  := COALESCE((v_item->>'costPrice')::numeric, 0);

    -- Pack size and step keep any value above zero (500 Gram is 0.5); absent or zero means
    -- one. The old `GREATEST(…, 1)` turned a half-kilo pack into a kilo one in silence.
    -- Expiry is optional per pack, because it is a fact about a batch and not about a
    -- product: the same 10 KG bag is dated differently depending on when it was bought.
    INSERT INTO product_variants(product_id,name,selling_price,cost_price,stock_qty,low_stock_threshold,unit_size,qty_step,is_active,expiry_date)
    VALUES(
      v_product_id,
      v_item->>'name',
      COALESCE((v_item->>'sellingPrice')::numeric,0),
      v_cost,
      v_stock,
      GREATEST(COALESCE((v_item->>'lowStockThreshold')::int,5),0),
      GREATEST(COALESCE(NULLIF((v_item->>'unitSize')::numeric, 0), 1), 0.001),
      GREATEST(COALESCE(NULLIF((v_item->>'qtyStep')::numeric, 0), 1), 0.001),
      true,
      NULLIF(v_item->>'expiryDate','')::date
    ) RETURNING id INTO v_variant_id;

    -- Opening stock is a movement, not a number dropped into a column: it carries the date,
    -- the person and what was actually paid, so Stock Movements has a beginning and the
    -- first sale's profit is measured against the real cost.
    IF v_stock > 0 THEN
      INSERT INTO inventory_movements(
        variant_id, product_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, notes, created_by, branch_id
      ) VALUES (
        v_variant_id, v_product_id, 'adjustment', 0, v_stock, v_stock,
        'product', v_variant_id, v_cost, 'Opening stock', v_actor, v_branch_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name','barcode',v_code,'marketplace_listed',v_listed);
END;
$function$;
