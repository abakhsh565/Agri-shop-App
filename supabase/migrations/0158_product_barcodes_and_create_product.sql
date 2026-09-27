-- ═══════════════════════════════════════════════════════════════════════════════
-- 0158 — the Add Product screen stopped lying about what it saves
--
-- Measured against the live database before this migration:
--
--   1. `create_product` never wrote `base_unit`, `barcode` or `qty_step`, while
--      `update_product` wrote all three. So the screen collected a unit and threw it
--      away: 10 of 12 products read `base_unit = 'piece'` — including one whose only pack
--      is named "5kg" with `unit_size = 5`. The product's meaning changed the first time
--      anyone opened it for editing.
--
--   2. Every product had a NULL barcode (12 of 12), even though the form generates one on
--      save and the label screen has a "products without barcodes" list to repair the
--      damage. The one guarantee that did exist — `idx_products_barcode` — was UNIQUE
--      (barcode) with no `shop_id`, so two shops could never catalogue the same real EAN,
--      and an empty string (which is not NULL) collided across shops.
--
--   3. Opening stock was written straight into `product_variants.stock_qty` with no
--      movement, so the quantity that starts the shelf had no date, no actor and no cost.
--      `inventory_movements` held two rows and both were sales.
--
--   4. Both RPCs clamped pack size with `GREATEST(…, 1)`, so a 500 Gram pack (0.5) was
--      silently stored as 1 — a half-kilo bag became a kilo bag without a word.
--
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── 1. A code identifies exactly one product, in one shop ─────────────────────
--
-- The column-level index is replaced rather than extended, because the guarantee has to
-- be scoped to the shop: two shops stocking the same branded box is normal, not an error.
-- `upper(barcode)` because codes are compared case-insensitively by the client, and
-- `barcode <> ''` because an empty string is not NULL and would collide on its own.
DROP INDEX IF EXISTS public.idx_products_barcode;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_shop
  ON public.products (shop_id, upper(barcode))
  WHERE barcode IS NOT NULL AND barcode <> '';


-- ── 2. Minting a code ────────────────────────────────────────────────────────
--
-- Same shape the app already generates client-side (`AGS-HMSK-01`), because the label
-- renderer and the receipt renderer are both Code128, and Code128 carries this happily.
-- Server-side so a code can never be lost by a client that forgets to send one.
CREATE OR REPLACE FUNCTION public.mint_barcode(p_name text, p_shop uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_stem text;
  v_code text;
  v_try  int := 0;
BEGIN
  -- A readable stem from the product's name; anything unnameable still gets a valid code.
  v_stem := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'));
  v_stem := rpad(coalesce(nullif(substr(v_stem, 1, 4), ''), 'PRD'), 4, 'X');

  LOOP
    v_try := v_try + 1;
    -- Two digits is the familiar shape; if a shop has genuinely filled all 99 slots for
    -- one stem, the code grows rather than failing to be handed out.
    v_code := 'AGS-' || v_stem || '-' || CASE
      WHEN v_try <= 200 THEN lpad((1 + floor(random() * 99))::int::text, 2, '0')
      ELSE lpad((100 + floor(random() * 899))::int::text, 3, '0')
    END;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.product_barcodes WHERE shop_id = p_shop AND code = v_code
    );
    IF v_try > 400 THEN
      RAISE EXCEPTION 'BARCODE_MINT_FAILED: could not find a free code for this shop';
    END IF;
  END LOOP;

  RETURN v_code;
END;
$function$;

-- Internal: only the SECURITY DEFINER writers call it.
REVOKE ALL ON FUNCTION public.mint_barcode(text, uuid) FROM PUBLIC;


-- ── 3. The codes a product actually carries ──────────────────────────────────
--
-- A dedicated table rather than a column, for three reasons that each cost nothing now
-- and are expensive to retrofit:
--
--   • The guarantee is `UNIQUE (shop_id, code)` — the database decides, so two phones
--     creating two products at the same moment cannot mint a collision.
--   • A product can hold more than one real code. A Suncrop or Bayer box already carries
--     the manufacturer's EAN; the shop's own printed label carries ours. Both resolve to
--     the same product, which a single nullable column cannot express.
--   • Per-pack codes are representable from day one (`variant_id`), so "the 10 KG bag and
--     the 50 KG bag scan differently" needs no schema change when it is asked for.
CREATE TABLE IF NOT EXISTS public.product_barcodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id  uuid REFERENCES public.product_variants(id) ON DELETE CASCADE,
  code        varchar(64) NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  source      varchar(16) NOT NULL DEFAULT 'generated',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.product_barcodes IS
  'Every code a product answers to. `is_primary` is the code the shop prints; the rest are codes it also accepts (a manufacturer EAN, a pack code).';
COMMENT ON COLUMN public.product_barcodes.variant_id IS
  'NULL means the code identifies the product; set means it identifies one pack of it.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_barcodes_code
  ON public.product_barcodes (shop_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_barcodes_primary
  ON public.product_barcodes (product_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product
  ON public.product_barcodes (product_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_variant
  ON public.product_barcodes (variant_id) WHERE variant_id IS NOT NULL;

-- Server-owned, like `user_active_shops` (0153): the read a member is entitled to is
-- their own shop's codes, and there is deliberately no write policy, because minting a
-- code is a decision the server makes, not one a client may assert.
ALTER TABLE public.product_barcodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_barcodes_select_shop ON public.product_barcodes;
CREATE POLICY product_barcodes_select_shop ON public.product_barcodes FOR SELECT
  USING (shop_id = current_shop_id());


-- ── 4. The canonical code stays visible where it already was ─────────────────
--
-- `products.barcode` is read by the products list, the product screen, the label screen
-- and the tests. It becomes a one-way mirror of the primary row, so it cannot drift:
-- the trigger below is the ONLY thing that writes it, and no RPC sets it directly.
CREATE OR REPLACE FUNCTION public.mirror_primary_barcode()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_primary text;
BEGIN
  v_primary := (
    SELECT code FROM public.product_barcodes
     WHERE product_id = COALESCE(NEW.product_id, OLD.product_id) AND is_primary
     LIMIT 1
  );

  UPDATE public.products
     SET barcode = v_primary
   WHERE id = COALESCE(NEW.product_id, OLD.product_id)
     AND barcode IS DISTINCT FROM v_primary;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS mirror_primary_barcode_trg ON public.product_barcodes;
CREATE TRIGGER mirror_primary_barcode_trg
  AFTER INSERT OR UPDATE OR DELETE ON public.product_barcodes
  FOR EACH ROW EXECUTE FUNCTION public.mirror_primary_barcode();


-- ── 5. Every existing product keeps its code, or is given one ────────────────
DO $backfill$
DECLARE
  r record;
  v_code text;
BEGIN
  FOR r IN
    SELECT p.id, p.shop_id, p.name, p.barcode
      FROM public.products p
     WHERE NOT EXISTS (SELECT 1 FROM public.product_barcodes b WHERE b.product_id = p.id)
     ORDER BY p.created_at
  LOOP
    v_code := NULLIF(upper(regexp_replace(coalesce(r.barcode, ''), '\s', '', 'g')), '');

    -- A code already in use by another product of the same shop cannot be mirrored; the
    -- product is given a fresh one instead of losing its identity entirely.
    IF v_code IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.product_barcodes b WHERE b.shop_id = r.shop_id AND b.code = v_code)
    THEN
      v_code := NULL;
    END IF;

    INSERT INTO public.product_barcodes (shop_id, product_id, code, is_primary, source)
    VALUES (
      r.shop_id,
      r.id,
      COALESCE(v_code, public.mint_barcode(r.name, r.shop_id)),
      true,
      CASE WHEN v_code IS NULL THEN 'generated' ELSE 'existing' END
    );
  END LOOP;
END;
$backfill$;


-- ── 6. Adding a product now saves the product that was described ─────────────
CREATE OR REPLACE FUNCTION public.create_product(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
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

  -- One code per product, minted here when the caller did not supply one, so the code can
  -- never be lost by a client that forgets it.
  v_code := upper(regexp_replace(COALESCE(NULLIF(payload->>'barcode',''), mint_barcode(payload->>'name', v_shop_id)), '\s', '', 'g'));
  IF EXISTS (SELECT 1 FROM product_barcodes WHERE shop_id = v_shop_id AND code = v_code) THEN
    RAISE EXCEPTION 'BARCODE_TAKEN: "%" is already on another product in this shop', v_code;
  END IF;

  INSERT INTO products(id,name,category,company_id,image_url,base_unit,is_active,shop_id,created_at)
  VALUES(
    gen_random_uuid(),
    payload->>'name',
    COALESCE((payload->>'category')::product_category,'other'),
    v_company_id,
    NULLIF(payload->>'imageUrl',''),
    v_unit,
    true,
    v_shop_id,
    now()
  ) RETURNING id INTO v_product_id;

  -- `products.barcode` is written by the mirror trigger, never here: one writer, no drift.
  INSERT INTO product_barcodes(shop_id, product_id, code, is_primary, source, created_by)
  VALUES(v_shop_id, v_product_id, v_code, true,
         CASE WHEN NULLIF(payload->>'barcode','') IS NULL THEN 'generated' ELSE 'supplied' END,
         v_actor);

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

  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name','barcode',v_code);
END;
$function$;


-- ── 7. Editing keeps the same rules ──────────────────────────────────────────
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
  v_code := upper(regexp_replace(NULLIF(payload->>'barcode',''), '\s', '', 'g'));
  IF v_code IS NOT NULL THEN
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


-- ── 8. One lookup, one answer ────────────────────────────────────────────────
--
-- Resolving a scanned code used to be a client-side `.find()` over whatever the store had
-- loaded, which is correct only while the list is complete and fresh. This answers the
-- question in the database, in the caller's shop, in one indexed read.
CREATE OR REPLACE FUNCTION public.resolve_product_barcode(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_shop uuid := current_shop_id();
  v_row  record;
BEGIN
  IF v_code = '' OR v_shop IS NULL THEN RETURN NULL; END IF;

  SELECT b.product_id, b.variant_id, b.code
    INTO v_row
    FROM product_barcodes b
    JOIN products p ON p.id = b.product_id AND p.is_active
   WHERE b.shop_id = v_shop AND b.code = v_code
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'productId', v_row.product_id,
    'variantId', v_row.variant_id,
    'code',      v_row.code
  );
END;
$function$;
