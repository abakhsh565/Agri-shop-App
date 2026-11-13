-- 0289 — A category says what it sells and how it is measured.
--
-- WHY THIS EXISTS. 0259 made categories and units the shop's own, but a category is still only
-- a name. The Add Product screen offers every unit to every product, so the owner has to know
-- that a pesticide is a liquid and that a liquid is measured in litres. The category already
-- carries that knowledge; it just had nowhere to store it.
--
-- WHAT THIS ADDS. One optional profile per category. The profile lists physical forms and, for
-- each form, the measurement families that product can use. A child category has no row of its
-- own by default and therefore inherits the nearest ancestor's profile. An explicit child row is
-- the override. Nothing is copied, so editing a parent changes every inheriting child.
--
-- WHAT THIS DOES NOT CHANGE. No category, unit, product, stock or sale row is rewritten. Existing
-- products keep their category and unit, and `physical_form` is null until a product is created
-- or edited through the new wrapper. The old RPCs still work unchanged for older clients.
--
-- LENGTH IS NOT IN THIS RELEASE. The pack arithmetic only understands kg/liter/piece today.
-- Adding metre/cm would touch conversion, display and every fallback that assumes three families.
-- This migration therefore exposes weight, volume and count only; irrigation can use those.

-- ── 1. The profile ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_classification_profiles (
  -- A category owns at most one profile. No row is the inheritance signal.
  category_id    uuid PRIMARY KEY REFERENCES public.product_categories(id) ON DELETE CASCADE,
  shop_id        uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  -- The named agricultural preset this profile started from. Edits are still allowed.
  preset         text NOT NULL DEFAULT 'general'
    CHECK (preset IN (
      'crop_protection', 'fertilizers', 'seeds', 'equipment',
      'irrigation', 'plant_nutrition', 'general'
    )),
  -- [{ "code": "liquid", "unitGroups": ["volume"] }, ...]
  physical_forms jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(physical_forms) = 'array'),
  handling_types text[] NOT NULL DEFAULT '{}'
    CHECK (handling_types <@ ARRAY['standard','hazardous','cold_chain','fragile']::text[]),
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_classification_profiles_shop
  ON public.product_classification_profiles (shop_id);

ALTER TABLE public.product_classification_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_classification_profiles_select ON public.product_classification_profiles;
CREATE POLICY product_classification_profiles_select ON public.product_classification_profiles
  FOR SELECT TO authenticated USING (shop_id = public.current_shop_id());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.product_classification_profiles
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.product_classification_profiles TO authenticated;

COMMENT ON TABLE public.product_classification_profiles IS
  'The optional classification profile of one shop category. A missing row means inherit the nearest configured ancestor; an explicit row is the product-level default for forms and unit groups.';

-- Make the category profile visible to the catalogue's realtime subscription. Categories and
-- units already live on the same feed; without this a profile edited on one phone would wait for
-- a full reload on another.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.product_classification_profiles;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. The product remembers the form it actually is ────────────────────────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS physical_form text;

COMMENT ON COLUMN public.products.physical_form IS
  'The physical form chosen for this product from its category profile. Null on products created before 0289 or on categories with no profile.';

-- ── 3. Measurement families ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unit_group_for_base(p_base_unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(COALESCE(p_base_unit, ''))
    WHEN 'kg' THEN 'weight'
    WHEN 'liter' THEN 'volume'
    WHEN 'piece' THEN 'count'
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.unit_group_for_base(text) IS
  'Maps an existing product_units.base_unit value to the classification vocabulary. Length is deliberately absent until the unit arithmetic supports it.';

-- ── 4. Nearest explicit profile ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_product_classification(
  p_category_id uuid,
  p_shop_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.parent_id, 0 AS depth
      FROM public.product_categories c
     WHERE c.id = p_category_id
       AND c.shop_id = p_shop_id
       AND c.is_active
    UNION ALL
    SELECT parent.id, parent.parent_id, chain.depth + 1
      FROM public.product_categories parent
      JOIN chain ON parent.id = chain.parent_id
     WHERE parent.shop_id = p_shop_id
       AND parent.is_active
  ), resolved AS (
    SELECT p.*, chain.id AS source_category_id, chain.depth
      FROM chain
      JOIN public.product_classification_profiles p
        ON p.category_id = chain.id
       AND p.shop_id = p_shop_id
     ORDER BY chain.depth
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'categoryId', resolved.source_category_id,
    'preset', resolved.preset,
    'physicalForms', resolved.physical_forms,
    'handlingTypes', to_jsonb(resolved.handling_types)
  )
  FROM resolved
$$;

COMMENT ON FUNCTION public.resolve_product_classification(uuid, uuid) IS
  'Returns the profile of the selected category or its nearest configured ancestor. Returns null when no category in the chain has a profile.';

REVOKE ALL ON FUNCTION public.resolve_product_classification(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 5. Presets for existing and future shops ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_product_classification_profiles(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only roots get seeded rows. Children inherit, which is the point of the feature: a shelf
  -- added under Pesticide must follow Pesticide without copying anything.
  WITH presets(preset, forms, handling) AS (
    VALUES
      ('crop_protection',
        '[{"code":"liquid","unitGroups":["volume"]},{"code":"powder","unitGroups":["weight"]},{"code":"granular","unitGroups":["weight"]},{"code":"crystal","unitGroups":["weight"]}]'::jsonb,
        ARRAY['hazardous']::text[]),
      ('fertilizers',
        '[{"code":"granular","unitGroups":["weight"]},{"code":"powder","unitGroups":["weight"]},{"code":"crystal","unitGroups":["weight"]},{"code":"liquid","unitGroups":["volume"]}]'::jsonb,
        ARRAY['standard']::text[]),
      ('seeds',
        '[{"code":"seed","unitGroups":["weight","count"]},{"code":"granular","unitGroups":["weight"]},{"code":"solid","unitGroups":["count"]}]'::jsonb,
        ARRAY['standard']::text[]),
      ('equipment',
        '[{"code":"unit","unitGroups":["count"]},{"code":"solid","unitGroups":["count"]}]'::jsonb,
        ARRAY['standard']::text[]),
      ('irrigation',
        '[{"code":"unit","unitGroups":["count"]},{"code":"solid","unitGroups":["count"]},{"code":"liquid","unitGroups":["volume"]}]'::jsonb,
        ARRAY['standard']::text[]),
      ('plant_nutrition',
        '[{"code":"liquid","unitGroups":["volume"]},{"code":"powder","unitGroups":["weight"]},{"code":"granular","unitGroups":["weight"]},{"code":"crystal","unitGroups":["weight"]}]'::jsonb,
        ARRAY['standard']::text[]),
      ('general',
        '[{"code":"liquid","unitGroups":["volume"]},{"code":"powder","unitGroups":["weight"]},{"code":"granular","unitGroups":["weight"]},{"code":"crystal","unitGroups":["weight"]},{"code":"seed","unitGroups":["weight","count"]},{"code":"solid","unitGroups":["count"]},{"code":"unit","unitGroups":["count"]}]'::jsonb,
        ARRAY['standard']::text[])
  ), mapped AS (
    SELECT
      c.id,
      c.shop_id,
      CASE
        WHEN c.legacy_category IN ('pesticide','herbicide','spray') THEN 'crop_protection'
        WHEN c.legacy_category = 'fertilizer' THEN 'fertilizers'
        WHEN c.legacy_category = 'seed' THEN 'seeds'
        WHEN c.legacy_category = 'equipment' THEN 'equipment'
        ELSE 'general'
      END AS preset
    FROM public.product_categories c
    WHERE c.shop_id = p_shop_id
      AND c.parent_id IS NULL
      AND c.is_active
  )
  INSERT INTO public.product_classification_profiles
    (category_id, shop_id, preset, physical_forms, handling_types)
  SELECT mapped.id, mapped.shop_id, mapped.preset, presets.forms, presets.handling
    FROM mapped
    JOIN presets ON presets.preset = mapped.preset
  ON CONFLICT (category_id) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seed_product_classification_profiles(uuid) IS
  'Gives every top-level category a starting classification preset. Idempotent and non-destructive. Child categories deliberately receive no row.';

-- A new shop gets the same taxonomy and profiles as an existing one.
CREATE OR REPLACE FUNCTION public.seed_product_taxonomy_for_new_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_product_taxonomy(NEW.id);
  PERFORM public.seed_product_classification_profiles(NEW.id);
  RETURN NEW;
END;
$$;

DO $$
DECLARE v_shop uuid;
BEGIN
  FOR v_shop IN SELECT id FROM public.shops LOOP
    PERFORM public.seed_product_classification_profiles(v_shop);
  END LOOP;
END $$;

-- ── 6. Save a category profile atomically with the category ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_product_category_with_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result      jsonb;
  v_category_id uuid;
  v_shop_id     uuid;
  v_actor       uuid;
  v_class       jsonb;
  v_preset      text;
  v_forms       jsonb := '[]'::jsonb;
  v_form        jsonb;
  v_code        text;
  v_groups      jsonb;
  v_group       text;
  v_seen        text[] := '{}';
  v_handling    text[];
BEGIN
  -- The existing RPC remains the one writer for the category itself. This wrapper only adds the
  -- profile, inside the same statement/transaction, so a category cannot be saved with half a
  -- classification.
  v_result := public.save_product_category(payload);
  v_category_id := (v_result->>'id')::uuid;

  SELECT shop_id INTO v_shop_id
    FROM public.product_categories
   WHERE id = v_category_id;

  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'CATEGORY_NOT_FOUND';
  END IF;

  -- Re-authorize for the profile write even though the inner RPC already did. This keeps the
  -- wrapper safe if its implementation ever changes.
  PERFORM public.authorize_business_action(
    'products.edit', v_shop_id, public.current_branch_id()
  );
  v_actor := public.app_current_user_id();

  IF payload ? 'classification' THEN
    v_class := payload->'classification';

    -- Explicit null means “use the parent settings”; absent means “leave this profile alone”.
    IF v_class IS NULL OR jsonb_typeof(v_class) = 'null' THEN
      DELETE FROM public.product_classification_profiles
       WHERE category_id = v_category_id AND shop_id = v_shop_id;
    ELSE
      IF jsonb_typeof(v_class) <> 'object' THEN
        RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: classification must be an object';
      END IF;

      v_preset := COALESCE(NULLIF(btrim(v_class->>'preset'), ''), 'general');
      IF v_preset NOT IN (
        'crop_protection', 'fertilizers', 'seeds', 'equipment',
        'irrigation', 'plant_nutrition', 'general'
      ) THEN
        RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: unknown classification preset';
      END IF;

      IF jsonb_typeof(v_class->'physicalForms') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_class->'physicalForms') = 0 THEN
        RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: choose at least one physical form';
      END IF;

      FOR v_form IN SELECT value FROM jsonb_array_elements(v_class->'physicalForms') LOOP
        v_code := NULLIF(btrim(v_form->>'code'), '');
        IF v_code IS NULL OR v_code NOT IN (
          'liquid','powder','granular','crystal','seed','solid','unit'
        ) THEN
          RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: unknown physical form';
        END IF;
        IF v_code = ANY(v_seen) THEN
          RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: duplicate physical form';
        END IF;
        v_seen := array_append(v_seen, v_code);

        IF jsonb_typeof(v_form->'unitGroups') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_form->'unitGroups') = 0 THEN
          RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: each form needs a unit group';
        END IF;

        v_groups := '[]'::jsonb;
        FOR v_group IN SELECT value FROM jsonb_array_elements_text(v_form->'unitGroups') LOOP
          IF v_group NOT IN ('weight','volume','count') THEN
            RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: unsupported unit group';
          END IF;
          IF NOT v_groups @> to_jsonb(v_group) THEN
            v_groups := v_groups || to_jsonb(v_group);
          END IF;
        END LOOP;

        v_forms := v_forms || jsonb_build_array(
          jsonb_build_object('code', v_code, 'unitGroups', v_groups)
        );
      END LOOP;

      IF jsonb_typeof(COALESCE(v_class->'handlingTypes', '[]'::jsonb)) <> 'array' THEN
        RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: handling types must be an array';
      END IF;
      SELECT ARRAY(
        SELECT DISTINCT value
          FROM jsonb_array_elements_text(COALESCE(v_class->'handlingTypes', '[]'::jsonb))
      ) INTO v_handling;

      IF EXISTS (
        SELECT 1 FROM unnest(v_handling) h
         WHERE h NOT IN ('standard','hazardous','cold_chain','fragile')
      ) THEN
        RAISE EXCEPTION 'CLASSIFICATION_PROFILE_INVALID: unknown handling type';
      END IF;

      INSERT INTO public.product_classification_profiles
        (category_id, shop_id, preset, physical_forms, handling_types, created_by)
      VALUES
        (v_category_id, v_shop_id, v_preset, v_forms, COALESCE(v_handling, '{}'), v_actor)
      ON CONFLICT (category_id) DO UPDATE
        SET preset = EXCLUDED.preset,
            physical_forms = EXCLUDED.physical_forms,
            handling_types = EXCLUDED.handling_types,
            updated_at = now();
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.save_product_category_with_classification(jsonb) IS
  'Saves a category and its optional classification profile atomically. A missing classification key leaves the profile alone; null removes an override.';

REVOKE ALL ON FUNCTION public.save_product_category_with_classification(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_product_category_with_classification(jsonb) TO authenticated;

-- ── 7. Product creation and editing with classification validation ───────────────────────────
CREATE OR REPLACE FUNCTION public.create_product_with_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result    jsonb;
  v_id        uuid;
  v_shop_id   uuid;
  v_category  uuid;
  v_base      text;
  v_form      text;
  v_class     jsonb;
  v_forms     jsonb;
  v_groups    text[];
BEGIN
  -- The long-standing RPC still owns the product, variants, opening stock and barcode. This
  -- wrapper reads the resulting row, validates the classification, and writes the one new column.
  v_result := public.create_product(payload);
  v_id := (v_result->>'id')::uuid;

  SELECT shop_id, category_id, lower(COALESCE(base_unit, ''))
    INTO v_shop_id, v_category, v_base
    FROM public.products
   WHERE id = v_id;

  v_form := NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '');

  IF v_category IS NOT NULL THEN
    v_class := public.resolve_product_classification(v_category, v_shop_id);
    IF v_class IS NOT NULL THEN
      v_forms := v_class->'physicalForms';

      IF v_form IS NULL AND jsonb_array_length(v_forms) = 1 THEN
        v_form := v_forms->0->>'code';
      END IF;

      IF v_form IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_forms) f WHERE f->>'code' = v_form
        ) THEN
          RAISE EXCEPTION 'CLASSIFICATION_FORM_INVALID: that physical form is not allowed by this category';
        END IF;

        SELECT array_agg(g) INTO v_groups
          FROM jsonb_array_elements(v_forms) f
          CROSS JOIN LATERAL jsonb_array_elements_text(f->'unitGroups') g
         WHERE f->>'code' = v_form;

        IF public.unit_group_for_base(v_base) IS NULL
           OR NOT (public.unit_group_for_base(v_base) = ANY(COALESCE(v_groups, '{}'))) THEN
          RAISE EXCEPTION 'CLASSIFICATION_UNIT: choose a unit that matches the physical form';
        END IF;
      ELSIF jsonb_array_length(v_forms) > 0 THEN
        RAISE EXCEPTION 'CLASSIFICATION_FORM_REQUIRED: choose a physical form';
      END IF;
    END IF;
  END IF;

  IF v_form IS NOT NULL THEN
    UPDATE public.products
       SET physical_form = v_form,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN v_result || jsonb_build_object('physical_form', v_form);
END;
$$;

COMMENT ON FUNCTION public.create_product_with_classification(jsonb) IS
  'Creates a product through create_product, then validates and stores its physical form. Older clients keep using create_product unchanged.';

REVOKE ALL ON FUNCTION public.create_product_with_classification(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_classification(jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.update_product_with_classification(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result           jsonb;
  v_id               uuid;
  v_shop_id          uuid;
  v_category         uuid;
  v_existing_category uuid;
  v_base             text;
  v_existing_form    text;
  v_form             text;
  v_form_given       boolean;
  v_form_changed     boolean;
  v_category_given   boolean;
  v_category_changed boolean;
  v_class            jsonb;
  v_forms            jsonb;
  v_groups           text[];
BEGIN
  v_id := (payload->>'id')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  SELECT shop_id, category_id, lower(COALESCE(base_unit, '')), physical_form
    INTO v_shop_id, v_existing_category, v_base, v_existing_form
    FROM public.products
   WHERE id = v_id;

  IF v_shop_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  v_result := public.update_product(payload);

  SELECT category_id, lower(COALESCE(base_unit, '')), physical_form
    INTO v_category, v_base, v_form
    FROM public.products
   WHERE id = v_id;

  v_form_given := payload ? 'physicalForm';
  v_form_changed := v_form_given
    AND NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '') IS DISTINCT FROM v_existing_form;
  v_category_given := payload ? 'categoryId';
  v_category_changed := v_category_given
    AND NULLIF(payload->>'categoryId', '')::uuid IS DISTINCT FROM v_existing_category;

  IF v_form_given THEN
    v_form := NULLIF(btrim(COALESCE(payload->>'physicalForm', '')), '');
  END IF;

  IF v_category IS NOT NULL THEN
    v_class := public.resolve_product_classification(v_category, v_shop_id);
    IF v_class IS NOT NULL THEN
      v_forms := v_class->'physicalForms';

      IF v_form IS NULL
         AND (v_form_given OR v_category_changed)
         AND jsonb_array_length(v_forms) = 1 THEN
        v_form := v_forms->0->>'code';
      END IF;

      -- Validate only when the caller actually changed the form or moved the shelf. An old
      -- product whose profile changed underneath it keeps its stored form on an unrelated
      -- edit, exactly as it keeps its stored unit.
      IF (v_form_changed OR v_category_changed) AND v_form IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_forms) f WHERE f->>'code' = v_form
        ) THEN
          RAISE EXCEPTION 'CLASSIFICATION_FORM_INVALID: that physical form is not allowed by this category';
        END IF;

        SELECT array_agg(g) INTO v_groups
          FROM jsonb_array_elements(v_forms) f
          CROSS JOIN LATERAL jsonb_array_elements_text(f->'unitGroups') g
         WHERE f->>'code' = v_form;

        IF public.unit_group_for_base(v_base) IS NULL
           OR NOT (public.unit_group_for_base(v_base) = ANY(COALESCE(v_groups, '{}'))) THEN
          RAISE EXCEPTION 'CLASSIFICATION_UNIT: choose a unit that matches the physical form';
        END IF;
      END IF;
    ELSIF v_category_changed THEN
      v_form := NULL;
    END IF;
  ELSIF v_category_changed THEN
    v_form := NULL;
  END IF;

  IF v_form_changed OR v_category_changed OR v_form IS DISTINCT FROM v_existing_form THEN
    UPDATE public.products
       SET physical_form = v_form,
           updated_at = now()
     WHERE id = v_id;
  END IF;

  RETURN v_result || jsonb_build_object('physical_form', v_form);
END;
$$;

COMMENT ON FUNCTION public.update_product_with_classification(jsonb) IS
  'Updates a product through update_product, then validates and stores a changed physical form. An unchanged form is preserved without reclassifying an old product.';

REVOKE ALL ON FUNCTION public.update_product_with_classification(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_with_classification(jsonb) TO authenticated;
