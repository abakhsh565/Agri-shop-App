-- 0335 — a farmer can see the shops that sell to him, and what they sell.
--
-- WHY. `0325`–`0334` gave the farmer a credential and a conversation, and nothing to look at. The
-- contract had no call that returned a dealer or a product, so the farmer app could open a thread
-- with the one shop he had joined and could not show him a single shop, price or item anywhere.
-- The owner reported exactly that on 2026-11-23 ("i cant see on the farmer side app any store or
-- dealor shop and even any prouduct"). The screen was never the problem: there was nothing behind
-- it to render.
--
-- WHAT THIS ADDS. Two read-only doors on the same per-farmer credential:
--   * `farmer_api_shops(p_token)` — the dealers this farmer can see: every shop that opted into the
--     marketplace, plus every shop he is already linked to. A shop that later turns the marketplace
--     off does not vanish from the farmer who already buys from it.
--   * `farmer_api_products(p_token, p_shop_id, p_search, p_limit, p_offset)` — that shop's active
--     catalogue with its variants, prices and a coarse stock state. With `p_shop_id` null it answers
--     for the farmer's own shop, so a one-shop farmer needs no extra call.
--
-- WHAT THEY DELIBERATELY DO NOT RETURN. No `shops.join_code` (a staff credential — `0328` is
-- explicit), no email, no licence or CNIC image URLs, no exact stock quantities (a farmer token must
-- not become a way to count a competitor's shelves), no owner identity, no customer data, and no
-- supplier/company: that column is the shop's purchase side, and a farmer browsing a catalogue has
-- no business reason to learn who supplies a competitor. The stock answer is `in_stock` /
-- `low_stock`, derived from `product_variants.stock_qty` against the variant's own
-- `low_stock_threshold`, falling back to `products.stock_qty` when a product has no variants at all.
--
-- WHY `marketplace_enabled` IS THE OPT-IN. It is the shop's own switch and it is already what the
-- public marketplace reads. Per-product `marketplace_listed` is surfaced as `featured` rather than
-- filtered on: a shop that opted into the marketplace but never flagged individual items would
-- otherwise present the farmer with an empty catalogue — the same empty screen, one layer deeper.
--
-- ROLLOUT. Additive: two functions, one declaration, four grants. Replayable.

-- ── 1. The dealer directory ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmer_api_shops(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
BEGIN
  RETURN jsonb_build_object(
    'shops', COALESCE((
      SELECT jsonb_agg(x.entry ORDER BY x.is_linked DESC, x.name)
        FROM (
          SELECT
            jsonb_build_object(
              'shop_id', s.id,
              'name', s.name,
              'city', s.city,
              'address', s.address,
              'phone', s.phone,
              'shop_type', s.shop_type,
              'logo_url', s.logo_url,
              'latitude', s.latitude,
              'longitude', s.longitude,
              'location_label', s.location_label,
              'is_linked', (l.farmer_id IS NOT NULL),
              'linked_since', l.created_at
            ) AS entry,
            (l.farmer_id IS NOT NULL) AS is_linked,
            s.name
          FROM public.shops s
          LEFT JOIN public.marketplace_farmer_links l
                 ON l.shop_id = s.id AND l.farmer_id = v_farmer
          WHERE s.marketplace_enabled OR l.farmer_id IS NOT NULL
          ORDER BY s.name
          LIMIT 500
        ) x
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.farmer_api_shops(text) IS
  'The dealers a farmer can see: every shop that opted into the marketplace plus every shop he is linked to. Public profile only — no join_code, email, licence or owner identity.';

-- ── 2. The catalogue ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmer_api_products(
  p_token   text,
  p_shop_id uuid DEFAULT NULL,
  p_search  text DEFAULT NULL,
  p_limit   integer DEFAULT 50,
  p_offset  integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer   uuid := public.farmer_by_token(p_token);
  v_shop     uuid;
  v_shop_row public.shops;
  v_search   text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_limit    integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 100));
  v_offset   integer := GREATEST(0, COALESCE(p_offset, 0));
  v_total    integer;
BEGIN
  IF p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100) THEN
    RAISE EXCEPTION 'VALIDATION: p_limit must be between 1 and 100';
  END IF;
  IF p_offset IS NOT NULL AND p_offset < 0 THEN
    RAISE EXCEPTION 'VALIDATION: p_offset cannot be negative';
  END IF;

  IF p_shop_id IS NULL THEN
    -- His own shop, resolved exactly as the thread resolves it. No shop yet is NOT_FOUND from
    -- `farmer_shop_scope`, which is the honest answer: there is nothing to list.
    v_shop := public.farmer_shop_scope(v_farmer, NULL);
  ELSE
    SELECT * INTO v_shop_row FROM public.shops s WHERE s.id = p_shop_id;
    IF v_shop_row.id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: that shop does not exist';
    END IF;
    -- A dealer he already buys from stays readable even if the shop leaves the marketplace.
    IF NOT v_shop_row.marketplace_enabled
       AND NOT EXISTS (
         SELECT 1 FROM public.marketplace_farmer_links l
          WHERE l.shop_id = p_shop_id AND l.farmer_id = v_farmer
       ) THEN
      RAISE EXCEPTION 'NOT_FOUND: that shop does not sell to farmers';
    END IF;
    v_shop := p_shop_id;
  END IF;

  SELECT * INTO v_shop_row FROM public.shops s WHERE s.id = v_shop;

  SELECT count(*)::integer INTO v_total
    FROM public.products p
   WHERE p.shop_id = v_shop
     AND p.is_active
     AND (
       v_search IS NULL
       OR p.name ILIKE '%' || v_search || '%'
       OR COALESCE(p.barcode, '') = v_search
     );

  RETURN jsonb_build_object(
    'shop', jsonb_build_object(
      'shop_id', v_shop_row.id,
      'name', v_shop_row.name,
      'city', v_shop_row.city,
      'address', v_shop_row.address,
      'phone', v_shop_row.phone,
      'shop_type', v_shop_row.shop_type,
      'logo_url', v_shop_row.logo_url
    ),
    'count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'products', COALESCE((
      SELECT jsonb_agg(x.entry ORDER BY x.name)
        FROM (
          SELECT
            p.name,
            jsonb_build_object(
              'product_id', p.id,
              'name', p.name,
              'category', (SELECT c.name FROM public.product_categories c WHERE c.id = p.category_id),
              'base_unit', p.base_unit,
              'image_url', p.image_url,
              'featured', p.marketplace_listed,
              'in_stock', CASE
                WHEN EXISTS (SELECT 1 FROM public.product_variants av
                              WHERE av.product_id = p.id AND av.is_active)
                  THEN EXISTS (SELECT 1 FROM public.product_variants sv
                                WHERE sv.product_id = p.id AND sv.is_active AND sv.stock_qty > 0)
                ELSE COALESCE(p.stock_qty, 0) > 0
              END,
              'price_from', (SELECT min(v.selling_price) FROM public.product_variants v
                              WHERE v.product_id = p.id AND v.is_active AND v.selling_price IS NOT NULL),
              'price_to', (SELECT max(v.selling_price) FROM public.product_variants v
                            WHERE v.product_id = p.id AND v.is_active AND v.selling_price IS NOT NULL),
              'variants', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'variant_id', v.id,
                         'name', v.name,
                         'unit_size', v.unit_size,
                         'qty_step', v.qty_step,
                         'price', v.selling_price,
                         'in_stock', v.stock_qty > 0,
                         'low_stock', v.stock_qty > 0
                           AND COALESCE(v.low_stock_threshold, 0) > 0
                           AND v.stock_qty <= COALESCE(v.low_stock_threshold, 0)
                       ) ORDER BY v.name, v.unit_size)
                  FROM public.product_variants v
                 WHERE v.product_id = p.id AND v.is_active
              ), '[]'::jsonb)
            ) AS entry
          FROM public.products p
          WHERE p.shop_id = v_shop
            AND p.is_active
            AND (
              v_search IS NULL
              OR p.name ILIKE '%' || v_search || '%'
                     OR COALESCE(p.barcode, '') = v_search
            )
          ORDER BY p.name
          LIMIT v_limit OFFSET v_offset
        ) x
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) IS
  'A shop''s active catalogue for one farmer: variants, selling prices, and a coarse in_stock/low_stock answer. Never an exact quantity, a cost price or another shop''s row.';

-- ── 3. The declaration ──────────────────────────────────────────────────────────────────────
-- Same shape as `0330` and `0332`: this file is the record of what it retires, and it proves the
-- result instead of asserting it in a comment. A signed-in shop session must never be able to call
-- a farmer door — it has no farmer token, and if it could call one it could mint a message, a
-- credit request or a catalogue read as somebody else's farmer.
DO $acl$
DECLARE
  v_server_only constant text[] := array[
    'farmer_api_products',
    'farmer_api_shops'
  ];
  v_fn    record;
  v_sig   text;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, n.nspname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_server_only)
  LOOP
    v_sig := format('%I.%I(%s)', v_fn.nspname, v_fn.proname,
                    pg_get_function_identity_arguments(v_fn.oid));

    EXECUTE format('revoke all on function %s from public, authenticated', v_sig);

    IF has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0335: % is still executable by authenticated', v_sig;
    END IF;
    -- Deliberately NOT asserted here: whether anon can execute is decided by the GRANT below,
    -- and asserting it before the GRANT only passes where a default privilege happens to grant
    -- it (local Supabase does; the production baseline does not). The proof block after the
    -- GRANT is where that claim belongs.
  END LOOP;
END;
$acl$;

-- The literal form the ledger's static reader parses, so a database that applies only this file
-- ends with the ACL it promises.
REVOKE ALL ON FUNCTION public.farmer_api_shops(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.farmer_api_shops(text) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) TO anon;

-- ── 4. The proofs ───────────────────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  v_rejected boolean;
BEGIN
  -- The doors exist for the farmer app and for nobody else.
  IF NOT has_function_privilege('anon', 'public.farmer_api_shops(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0335: the farmer app cannot list shops';
  END IF;
  IF NOT has_function_privilege('anon', 'public.farmer_api_products(text, uuid, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '0335: the farmer app cannot read a catalogue';
  END IF;
  IF has_function_privilege('authenticated', 'public.farmer_api_shops(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.farmer_api_products(text, uuid, text, integer, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '0335: a signed-in shop session can call a farmer door';
  END IF;

  -- Both are definers with a pinned search_path, so a caller cannot shadow `shops` or
  -- `product_variants` with a schema of their own.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('farmer_api_shops', 'farmer_api_products')
       AND (p.prosecdef = false OR p.proconfig IS NULL)
  ) THEN
    RAISE EXCEPTION '0335: a farmer door is not a definer with a pinned search_path';
  END IF;

  -- A credential is required, and a wrong one is refused with the code the app already handles.
  -- The probe is deliberately shorter than the 20-character floor, so it is refused before the
  -- hash is touched: the proof asserts the door, not the availability of pgcrypto.
  v_rejected := false;
  BEGIN
    PERFORM public.farmer_api_shops('x');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_AUTHORIZED:%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '0335: the shop directory answered without a credential';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.farmer_api_products('x');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_AUTHORIZED:%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '0335: the catalogue answered without a credential';
  END IF;
END;
$proof$;
