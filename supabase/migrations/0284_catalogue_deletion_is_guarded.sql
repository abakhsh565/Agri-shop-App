-- 0284 — a shelf or unit can only be deleted when nothing active still uses it.
--
-- WHY THIS EXISTS. `product_categories` and `product_units` deliberately have no client
-- DELETE policy: writes go through one server function. This file adds the missing delete
-- functions, and makes the dependency rule explicit instead of leaving it to a foreign key
-- that would silently detach a product (0259 uses ON DELETE SET NULL).
--
-- A category with products is refused with the number of products still on it, and a parent
-- with subcategories is refused until those subcategories are gone. The client can explain
-- both cases in the owner's language; the database still refuses a direct RPC call.
--
-- Active products are the dependency. An archived product is not on the shelf any more; the
-- product delete path already preserves its history, and deleting its old shelf must not be
-- blocked by a row the owner cannot see.

CREATE OR REPLACE FUNCTION public.delete_product_category(p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved  jsonb;
  v_shop_id   uuid;
  v_row       public.product_categories;
  v_products  integer := 0;
  v_legacy    integer := 0;
  v_children  integer := 0;
BEGIN
  v_resolved := public.resolve_shop_and_actor(NULL, NULL, NULL);
  v_shop_id  := (v_resolved->>'shop_id')::uuid;

  PERFORM public.authorize_business_action(
    'products.edit', v_shop_id, public.current_branch_id()
  );

  -- Locking this row makes a concurrent product save wait on the same shelf, so the count
  -- below and the delete are one decision rather than two racing ones.
  SELECT * INTO v_row
    FROM public.product_categories
   WHERE id = p_category_id AND shop_id = v_shop_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that category is not part of this shop';
  END IF;

  SELECT count(*) INTO v_products
    FROM public.products
   WHERE shop_id = v_shop_id AND category_id = v_row.id AND is_active;

  -- Products written before 0259 may still carry only the fixed kind. A seeded shelf is
  -- responsible for its kind until the product is re-filed; a custom shelf is not.
  IF v_row.is_system AND v_row.legacy_category IS NOT NULL THEN
    SELECT count(*) INTO v_legacy
      FROM public.products
     WHERE shop_id = v_shop_id
       AND category_id IS NULL
       AND category = v_row.legacy_category
       AND is_active;
    v_products := v_products + v_legacy;
  END IF;

  IF v_products > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'has_products',
      'productCount', v_products
    );
  END IF;

  SELECT count(*) INTO v_children
    FROM public.product_categories
   WHERE parent_id = v_row.id;

  IF v_children > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'has_children',
      'childCount', v_children
    );
  END IF;

  DELETE FROM public.product_categories WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'deleted', true,
    'id', v_row.id,
    'name', v_row.name
  );
END;
$$;

COMMENT ON FUNCTION public.delete_product_category(uuid) IS
  'Deletes one of the shop''s categories only when no active product and no subcategory still uses it. Requires products.edit.';

REVOKE ALL ON FUNCTION public.delete_product_category(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product_category(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_product_unit(p_unit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resolved  jsonb;
  v_shop_id   uuid;
  v_row       public.product_units;
  v_products  integer := 0;
BEGIN
  v_resolved := public.resolve_shop_and_actor(NULL, NULL, NULL);
  v_shop_id  := (v_resolved->>'shop_id')::uuid;

  PERFORM public.authorize_business_action(
    'products.edit', v_shop_id, public.current_branch_id()
  );

  SELECT * INTO v_row
    FROM public.product_units
   WHERE id = p_unit_id AND shop_id = v_shop_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that unit is not part of this shop';
  END IF;

  SELECT count(*) INTO v_products
    FROM public.products
   WHERE shop_id = v_shop_id AND unit_id = v_row.id AND is_active;

  IF v_products > 0 THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'reason', 'has_products',
      'productCount', v_products
    );
  END IF;

  DELETE FROM public.product_units WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'deleted', true,
    'id', v_row.id,
    'name', v_row.name
  );
END;
$$;

COMMENT ON FUNCTION public.delete_product_unit(uuid) IS
  'Deletes one of the shop''s units only when no active product still uses it. Requires products.edit.';

REVOKE ALL ON FUNCTION public.delete_product_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_product_unit(uuid) TO authenticated;