-- 0259 — A shelf and a unit belong to the shop, not to the code.
--
-- WHY THIS EXISTS. The app shipped seven categories and two units, both compiled in: the
-- `product_category` enum and `base_unit` restricted to kg/liter (0246). The owner's reference
-- asks for the two screens every shopkeeper expects — Categories (with subcategories) and
-- Units — and for both to be what the Add Product screen offers. That is impossible while the
-- list lives in the source, so the list moves to the database, per shop.
--
-- WHAT IS DELIBERATELY KEPT. `products.category` stays, and stays in sync: the recommendation
-- engine, the season windows and the sales filters all reason about the seven fixed kinds, and
-- they are not wrong to — a fertilizer is a fertilizer whatever the shop calls the shelf. So a
-- category row carries the kind it answers to (`legacy_category`), and `products.category` is
-- written from it. A custom shelf that answers to nothing is filed as "other", which is what
-- the engine already does with anything it does not recognise. Nothing about stock, sale lines,
-- purchases or reports changes: only the NAME of the shelf does.
--
-- Two levels, on purpose. A parent's parent is refused by `save_product_category`, so a
-- category tree is exactly one level deep. The reference shows one; a deep tree turns a picker
-- into a directory walk, and a shop with five hundred products does not need a third level.
--
-- UNITS. A unit row is a name, a symbol, the measurement family it belongs to (kg / liter /
-- piece) and how many decimals it is written with. The family matters: pack sizes and stock are
-- arithmetic in the family's own unit, so a unit cannot invent a new one. A shop that counts in
-- dozens records "Dozen" as a unit of pieces — the arithmetic below it is unchanged, which is
-- the whole point of keeping the family and the label apart.
--
-- Seeding. Every existing shop gets the seven shelves and the three units it has been using all
-- along, and a trigger does the same for a shop created later, so a new business starts with a
-- usable catalogue instead of an empty picker it cannot fill from the Add Product screen.

-- ── 1. The categories ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  parent_id       uuid REFERENCES public.product_categories(id) ON DELETE RESTRICT,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  -- The fixed kind this shelf answers to. NULL means "no particular kind" and reads as other.
  legacy_category public.product_category,
  -- True for the shelves seeded from the seven the app already shipped. It turns false the
  -- moment the owner renames one, because the name is theirs from then on and the app must
  -- stop printing its own translated label over it.
  is_system       boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One name per shelf per parent. COALESCE because two top-level shelves both have a NULL parent,
-- and NULLs are never equal in a unique index — without it a shop could hold "Seed" twice.
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_name_unique
  ON public.product_categories (
    shop_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  );

CREATE INDEX IF NOT EXISTS product_categories_shop_parent
  ON public.product_categories (shop_id, parent_id, sort_order);

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

-- Read: this shop's shelves, and nothing else. Write: no direct door at all — the RPC below is
-- the only writer, so a category can never be created for another tenant or as its own parent.
DROP POLICY IF EXISTS product_categories_select ON public.product_categories;
CREATE POLICY product_categories_select ON public.product_categories
  FOR SELECT TO authenticated USING (shop_id = public.current_shop_id());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_categories TO authenticated;

COMMENT ON TABLE public.product_categories IS
  'The shop''s own shelves, one level deep, seeded from the seven fixed kinds. products.category_id files a product here; products.category stays the engine''s kind, written from legacy_category.';

-- ── 2. The units ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_units (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  symbol      text NOT NULL CHECK (length(btrim(symbol)) BETWEEN 1 AND 12),
  -- The family the arithmetic happens in. A unit is a LABEL for one of these three, never a
  -- fourth kind of measurement: pack sizes, stock and every sale line are numbers in the family.
  base_unit   text NOT NULL CHECK (base_unit IN ('kg', 'liter', 'piece')),
  -- Decimals this unit is written with, 0 to 4.
  precision   integer NOT NULL DEFAULT 0 CHECK (precision BETWEEN 0 AND 4),
  is_system   boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The column was added while this migration was being written; the ALTER keeps a database
-- that saw the earlier revision on the same shape as a fresh one.
ALTER TABLE public.product_units ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS product_units_symbol_unique
  ON public.product_units (shop_id, lower(btrim(symbol)));

CREATE INDEX IF NOT EXISTS product_units_shop ON public.product_units (shop_id, sort_order);

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_units_select ON public.product_units;
CREATE POLICY product_units_select ON public.product_units
  FOR SELECT TO authenticated USING (shop_id = public.current_shop_id());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_units FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_units TO authenticated;

COMMENT ON TABLE public.product_units IS
  'The shop''s own units: a name, a symbol, and the measurement family (kg/liter/piece) the arithmetic underneath is done in. Seeded with Kilogram, Liter and Piece.';

-- ── 3. What a product is filed under ─────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.product_categories(id) ON DELETE SET NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES public.product_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_category_idx ON public.products (category_id);
CREATE INDEX IF NOT EXISTS products_unit_idx ON public.products (unit_id);

COMMENT ON COLUMN public.products.category_id IS
  'The shelf this product sits on, in the owner''s own words. NULL on a product that predates 0259 and was never re-filed; products.category still says which kind it is.';
COMMENT ON COLUMN public.products.unit_id IS
  'The unit this shop sells the product in, when it is one of the shop''s own units. base_unit is the family it belongs to and is what all arithmetic uses.';

-- ── 4. Seeding, for the shops that exist and the shops that come ─────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_product_taxonomy(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The seven the app has always had. Kept in the enum's own order, so the picker reads the way
  -- the category chips always did.
  INSERT INTO public.product_categories (shop_id, name, legacy_category, is_system, sort_order)
  SELECT p_shop_id, v.name, v.kind::public.product_category, true, v.sort
    FROM (VALUES
      ('Seed',       'seed',       1),
      ('Fertilizer', 'fertilizer', 2),
      ('Pesticide',  'pesticide',  3),
      ('Herbicide',  'herbicide',  4),
      ('Spray',      'spray',      5),
      ('Equipment',  'equipment',  6),
      ('Other',      'other',      7)
    ) AS v(name, kind, sort)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.product_categories c WHERE c.shop_id = p_shop_id
   );

  -- The three units the shop has been selling in all along, with the precision each is written
  -- with: weights and volumes to three decimals, countable things whole.
  INSERT INTO public.product_units (shop_id, name, symbol, base_unit, precision, is_system, sort_order)
  SELECT p_shop_id, v.name, v.symbol, v.base, v.prec, true, v.sort
    FROM (VALUES
      ('Kilogram', 'kg',    'kg',    3, 1),
      ('Liter',    'liter', 'liter', 3, 2),
      ('Piece',    'piece', 'piece', 0, 3)
    ) AS v(name, symbol, base, prec, sort)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.product_units u WHERE u.shop_id = p_shop_id
   );
END;
$$;

COMMENT ON FUNCTION public.seed_product_taxonomy(uuid) IS
  'Gives a shop the seven shelves and three units the app already knew. Idempotent: a shop that has any category or unit of its own is left completely alone.';

-- A shop created later starts with the same catalogue. Without this the Add Product screen of a
-- new business would offer an empty picker with no way to fill it from that screen.
CREATE OR REPLACE FUNCTION public.seed_product_taxonomy_for_new_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_product_taxonomy(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shops_seed_product_taxonomy ON public.shops;
CREATE TRIGGER shops_seed_product_taxonomy
  AFTER INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.seed_product_taxonomy_for_new_shop();

-- Every shop that is already trading.
DO $$
DECLARE v_shop uuid;
BEGIN
  FOR v_shop IN SELECT id FROM public.shops LOOP
    PERFORM public.seed_product_taxonomy(v_shop);
  END LOOP;
END $$;

-- File the products that exist. A product's kind already says which shelf it belongs on: that is
-- exactly the mapping the seven seeded shelves carry. Nothing is moved between kinds.
UPDATE public.products p
   SET category_id = c.id
  FROM public.product_categories c
 WHERE p.category_id IS NULL
   AND c.shop_id = p.shop_id
   AND c.parent_id IS NULL
   AND c.is_system
   AND c.legacy_category = p.category;

UPDATE public.products p
   SET unit_id = u.id
  FROM public.product_units u
 WHERE p.unit_id IS NULL
   AND u.shop_id = p.shop_id
   AND u.is_system
   AND lower(coalesce(p.base_unit, '')) = u.symbol;

-- ── 5. The one way to save a category ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_product_category(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved   jsonb;
  v_shop_id    uuid;
  v_actor      uuid;
  v_id         uuid := NULLIF(payload->>'id', '')::uuid;
  v_parent     uuid := NULLIF(payload->>'parentId', '')::uuid;
  v_name       text := btrim(COALESCE(payload->>'name', ''));
  v_existing   public.product_categories;
  v_parent_row public.product_categories;
  v_legacy     public.product_category;
  v_system     boolean := false;
  v_sort       integer;
BEGIN
  v_resolved := public.resolve_shop_and_actor(NULL, NULL, NULL);
  v_shop_id  := (v_resolved->>'shop_id')::uuid;
  v_actor    := (v_resolved->>'actor_id')::uuid;

  PERFORM public.authorize_business_action('products.edit', v_shop_id, public.current_branch_id());

  IF length(v_name) < 1 OR length(v_name) > 60 THEN
    RAISE EXCEPTION 'INVALID_NAME: a category needs a name of up to 60 characters';
  END IF;

  IF v_parent IS NOT NULL THEN
    SELECT * INTO v_parent_row
      FROM public.product_categories
     WHERE id = v_parent AND shop_id = v_shop_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: that parent category is not part of this shop';
    END IF;
    -- One level. A parent that is itself a child would make a grandchild, which this catalogue
    -- does not have and the picker is not built for.
    IF v_parent_row.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_PARENT: a category can be nested one level deep';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    v_legacy := COALESCE(v_parent_row.legacy_category, 'other');
    v_sort   := COALESCE((payload->>'sortOrder')::integer, 0);
    BEGIN
      INSERT INTO public.product_categories (shop_id, parent_id, name, legacy_category, is_system, sort_order, created_by)
      VALUES (v_shop_id, v_parent, v_name, v_legacy, false, v_sort, v_actor)
      RETURNING * INTO v_existing;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'CATEGORY_EXISTS: "%" is already a category here', v_name;
    END;
  ELSE
    SELECT * INTO v_existing
      FROM public.product_categories
     WHERE id = v_id AND shop_id = v_shop_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: that category is not part of this shop';
    END IF;
    IF v_parent = v_id THEN
      RAISE EXCEPTION 'INVALID_PARENT: a category cannot be its own parent';
    END IF;
    -- A shelf with subcategories under it cannot move: its children would be left one level
    -- deeper than this catalogue allows, and silently re-parenting them is not this call's job.
    IF v_parent IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.product_categories WHERE parent_id = v_id
    ) THEN
      RAISE EXCEPTION 'INVALID_PARENT: this category has subcategories of its own';
    END IF;

    -- Renaming a seeded shelf makes it the owner's own name, so the app stops overriding it
    -- with its translated label for that kind.
    v_system := v_existing.is_system AND v_existing.name = v_name;
    v_legacy := CASE
      WHEN v_parent IS NOT NULL THEN COALESCE(v_parent_row.legacy_category, 'other')
      ELSE v_existing.legacy_category
    END;

    BEGIN
      UPDATE public.product_categories
         SET name = v_name,
             parent_id = v_parent,
             legacy_category = v_legacy,
             is_system = v_system,
             updated_at = now()
       WHERE id = v_id
       RETURNING * INTO v_existing;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'CATEGORY_EXISTS: "%" is already a category here', v_name;
    END;
  END IF;

  RETURN jsonb_build_object(
    'id', v_existing.id,
    'name', v_existing.name,
    'parentId', v_existing.parent_id,
    'legacyCategory', v_existing.legacy_category,
    'isSystem', v_existing.is_system
  );
END;
$$;

COMMENT ON FUNCTION public.save_product_category(jsonb) IS
  'Creates or renames one of the shop''s categories, with an optional parent one level up. Requires products.edit; refuses a duplicate name, a foreign parent and a third level.';

REVOKE ALL ON FUNCTION public.save_product_category(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category(jsonb) TO authenticated;

-- ── 6. The one way to save a unit ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_product_unit(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved jsonb;
  v_shop_id  uuid;
  v_actor    uuid;
  v_id       uuid := NULLIF(payload->>'id', '')::uuid;
  v_name     text := btrim(COALESCE(payload->>'name', ''));
  v_symbol   text := btrim(COALESCE(payload->>'symbol', ''));
  v_base     text := lower(btrim(COALESCE(payload->>'baseUnit', '')));
  v_prec     integer := COALESCE((payload->>'precision')::integer, 0);
  v_row      public.product_units;
BEGIN
  v_resolved := public.resolve_shop_and_actor(NULL, NULL, NULL);
  v_shop_id  := (v_resolved->>'shop_id')::uuid;
  v_actor    := (v_resolved->>'actor_id')::uuid;

  PERFORM public.authorize_business_action('products.edit', v_shop_id, public.current_branch_id());

  IF length(v_name) < 1 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'INVALID_NAME: a unit needs a name of up to 40 characters';
  END IF;
  IF length(v_symbol) < 1 OR length(v_symbol) > 12 THEN
    RAISE EXCEPTION 'INVALID_SYMBOL: a unit needs a short symbol of up to 12 characters';
  END IF;
  -- The family is the arithmetic. A unit that named a fourth one would put stock and pack sizes
  -- into a measurement nothing else in the app can convert.
  IF v_base NOT IN ('kg', 'liter', 'piece') THEN
    RAISE EXCEPTION 'INVALID_UNIT: a unit measures weight, volume or count, not "%"', v_base;
  END IF;
  IF v_prec < 0 OR v_prec > 4 THEN
    RAISE EXCEPTION 'INVALID_PRECISION: choose between 0 and 4 decimals';
  END IF;

  IF v_id IS NULL THEN
    BEGIN
      INSERT INTO public.product_units (shop_id, name, symbol, base_unit, precision, is_system, created_by)
      VALUES (v_shop_id, v_name, v_symbol, v_base, v_prec, false, v_actor)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'UNIT_EXISTS: "%" is already a unit here', v_symbol;
    END;
  ELSE
    SELECT * INTO v_row FROM public.product_units WHERE id = v_id AND shop_id = v_shop_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: that unit is not part of this shop';
    END IF;
    BEGIN
      UPDATE public.product_units
         SET name = v_name,
             symbol = v_symbol,
             base_unit = v_base,
             precision = v_prec,
             is_system = v_row.is_system AND v_row.name = v_name,
             updated_at = now()
       WHERE id = v_id
       RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'UNIT_EXISTS: "%" is already a unit here', v_symbol;
    END;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'symbol', v_row.symbol,
    'baseUnit', v_row.base_unit,
    'precision', v_row.precision,
    'isSystem', v_row.is_system
  );
END;
$$;

COMMENT ON FUNCTION public.save_product_unit(jsonb) IS
  'Creates or edits one of the shop''s units. Requires products.edit; refuses a duplicate symbol, a family outside kg/liter/piece and a precision outside 0-4.';

REVOKE ALL ON FUNCTION public.save_product_unit(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_unit(jsonb) TO authenticated;

-- ── 7. Creating a product files it, if the caller said where ─────────────────────────────────
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
  v_unit_id    uuid;
  v_category   public.product_category;
  v_category_id uuid;
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

  -- The shelf, when the screen named one. The kind written into `products.category` is the one
  -- the ROOT of that shelf answers to — a subcategory is a finer name for its parent's kind.
  v_category_id := NULLIF(payload->>'categoryId','')::uuid;
  IF v_category_id IS NOT NULL THEN
    SELECT COALESCE(root.legacy_category, 'other')
      INTO v_category
      FROM product_categories c
      LEFT JOIN product_categories root ON root.id = COALESCE(c.parent_id, c.id)
     WHERE c.id = v_category_id AND c.shop_id = v_shop_id AND c.is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_CATEGORY: that category is not part of this shop';
    END IF;
  ELSE
    -- A client that predates the catalogue still files by kind, exactly as before.
    v_category := COALESCE((payload->>'category')::product_category,'other');
  END IF;

  -- The unit, when the screen named one: the family comes from the unit row rather than from
  -- the client, so a unit can never put a product into a measurement it does not belong to.
  v_unit_id := NULLIF(payload->>'unitId','')::uuid;
  IF v_unit_id IS NOT NULL THEN
    SELECT lower(base_unit) INTO v_unit
      FROM product_units
     WHERE id = v_unit_id AND shop_id = v_shop_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_UNIT: that unit is not part of this shop';
    END IF;
  ELSE
    -- The shop sells by weight, by volume or by the piece. A new product cannot be anything
    -- else, and the unit is stored rather than defaulted, so the pack size below means what
    -- it says.
    v_unit := lower(COALESCE(NULLIF(payload->>'baseUnit',''), 'kg'));
  END IF;
  IF v_unit NOT IN ('kg','liter','piece') THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg, liter or piece, not "%"', v_unit;
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
                       marketplace_listed,marketplace_listed_at,category_id,unit_id)
  VALUES(
    gen_random_uuid(),
    payload->>'name',
    v_category,
    v_company_id,
    NULLIF(payload->>'imageUrl',''),
    v_unit,
    true,
    v_shop_id,
    now(),
    v_listed,
    CASE WHEN v_listed THEN now() ELSE NULL END,
    v_category_id,
    v_unit_id
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

  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name','barcode',v_code,'marketplace_listed',v_listed,
                            'category_id',v_category_id,'unit_id',v_unit_id);
END;
$function$;

-- ── 8. Editing a product re-files it, if the caller said where ───────────────────────────────
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
  v_unit_id uuid;
  v_unit_given boolean;
  v_category public.product_category;
  v_category_id uuid;
  v_category_given boolean;
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

  -- The shelf, with the same three cases the barcode below distinguishes: absent leaves it
  -- alone; present and empty takes the product off the shelf; present with an id files it.
  v_category_given := payload ? 'categoryId';
  IF v_category_given THEN
    v_category_id := NULLIF(payload->>'categoryId','')::uuid;
    IF v_category_id IS NOT NULL THEN
      SELECT COALESCE(root.legacy_category, 'other')
        INTO v_category
        FROM product_categories c
        LEFT JOIN product_categories root ON root.id = COALESCE(c.parent_id, c.id)
       WHERE c.id = v_category_id AND c.shop_id = v_shop AND c.is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_CATEGORY: that category is not part of this shop';
      END IF;
    END IF;
  END IF;

  -- The unit, the same way, and the family is read from the unit rather than trusted from the
  -- client. A new product is weighed, measured or counted; an existing one that predates that
  -- rule may keep the unit it already has, so opening a legacy product for editing cannot
  -- silently re-denominate it.
  v_unit_given := payload ? 'unitId';
  IF v_unit_given THEN
    v_unit_id := NULLIF(payload->>'unitId','')::uuid;
    IF v_unit_id IS NOT NULL THEN
      SELECT lower(base_unit) INTO v_unit
        FROM product_units
       WHERE id = v_unit_id AND shop_id = v_shop AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_UNIT: that unit is not part of this shop';
      END IF;
    END IF;
  ELSE
    v_unit := lower(NULLIF(payload->>'baseUnit',''));
  END IF;
  IF v_unit IS NOT NULL AND v_unit NOT IN ('kg','liter','piece') AND v_unit IS DISTINCT FROM v_existing_unit THEN
    RAISE EXCEPTION 'INVALID_UNIT: a product is measured in kg, liter or piece, not "%"', v_unit;
  END IF;

  UPDATE products SET
    name = COALESCE(NULLIF(payload->>'name',''), name),
    company_id = COALESCE(v_company_id, company_id),
    category = CASE
      WHEN v_category_given AND v_category_id IS NOT NULL THEN v_category
      ELSE category END,
    category_id = CASE WHEN v_category_given THEN v_category_id ELSE category_id END,
    base_unit = COALESCE(v_unit, base_unit),
    unit_id = CASE WHEN v_unit_given THEN v_unit_id ELSE unit_id END,
    image_url = COALESCE(NULLIF(payload->>'imageUrl',''), image_url),
    -- The listing switch, with the three cases the barcode below also distinguishes: absent
    -- leaves it alone; present-true lists it; present-false unlists it. The timestamp is
    -- stamped on the false→true flip only and preserved while the product stays listed, so
    -- "listed since" means something rather than "whenever it was last saved".
    marketplace_listed = CASE
      WHEN payload ? 'marketplaceListed' THEN COALESCE((payload->>'marketplaceListed')::boolean, false)
      ELSE marketplace_listed END,
    marketplace_listed_at = CASE
      WHEN payload ? 'marketplaceListed' THEN
        CASE WHEN COALESCE((payload->>'marketplaceListed')::boolean, false)
             THEN COALESCE(products.marketplace_listed_at, now())
             ELSE NULL END
      ELSE marketplace_listed_at END,
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
