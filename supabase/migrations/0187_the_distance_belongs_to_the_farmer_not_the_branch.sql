-- ═══════════════════════════════════════════════════════════════════════════════
-- 0187 — The distance belongs to the farmer, so a branch stops choosing one
--
-- WHY THIS REVERSES 0184's SECOND COLUMN. 0184 gave every branch a listing switch AND a coverage
--   radius, on the reading that "how far will you serve" was the shop's decision. The product
--   owner corrected the model, and this migration follows the correction: the radius is a SEARCH
--   input on the farmer's side — the farmer picks "show me within 20 km" — and the owner's only
--   contribution is a location on a branch that is listed. A shop owner should never be asked
--   what part of a farmer's search belongs to them.
--
-- WHAT THIS CHANGES, EXACTLY.
--   1. `shops.marketplace_radius_km` (and its CHECK) is dropped. An owner-set distance is no
--      longer stored, displayed, or able to hide a branch.
--   2. `set_marketplace_settings(uuid, boolean, numeric)` becomes
--      `set_marketplace_settings(uuid, boolean)` — the switch is the whole decision now. The old
--      three-argument function is dropped first, so no caller can keep passing a distance and no
--      two overloads of one name exist for the API layer to choose between.
--   3. `get_my_branches()` is recreated without the radius column. Its `RETURNS TABLE` is part of
--      its signature, so the DROP is required rather than stylistic — the same shape as 0173 and
--      0186 — and the grants are re-issued because dropping a function takes them with it.
--   4. `search_marketplace(...)` keeps its signature and its result shape, and its eligibility
--      rule becomes the single honest bound: the distance to the branch is within the radius the
--      FARMER asked for (`<= v_radius`). The join to `shops` existed only to read the branch's own
--      radius and is gone with it.
--
-- WHAT DOES NOT CHANGE. `marketplace_listings` is untouched — it never projected a radius, so its
--   20-column surface, its WHERE clause and its grants are exactly as 0185 left them. The switch
--   semantics are unchanged: false by default, refused for a branch with no pinned location,
--   audited, owner/admin of that branch only, revoked from `anon`. Nothing is dropped from a
--   product, and no row loses anything else.
--
-- NOTHING ALREADY LISTED BECOMES UNLISTED, and nothing newly appears. Dropping a radius only
--   widens the set of searches a branch can answer; the farmer's own radius still bounds it, and
--   a search never reaches past 200 km because the search function clamps it there.
--
-- VERIFIED BY: tests/integration/marketplaceContract.test.ts — the switch is the only owner
--   setting; a branch inside the farmer's radius appears with no owner-side distance at all; a
--   branch outside it does not; the writer takes exactly two arguments; and the Branches read
--   carries the switch and no radius.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The writer loses its distance argument, then the column goes ───────────────────────────
-- The old function is dropped BEFORE the column: a function whose body names a dropped column
-- would stay callable and fail at run time, which is the one outcome worse than an error here.
DROP FUNCTION IF EXISTS public.set_marketplace_settings(uuid, boolean, numeric);

ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_marketplace_radius_range;
ALTER TABLE public.shops DROP COLUMN IF EXISTS marketplace_radius_km;

CREATE OR REPLACE FUNCTION public.set_marketplace_settings(
  p_shop_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_role   membership_role;
  v_before record;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage marketplace listing';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can manage marketplace listing';
  END IF;

  SELECT s.marketplace_enabled, s.latitude, s.longitude
    INTO v_before
    FROM shops s
   WHERE s.id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  -- Turning the switch on for a branch with no pin is refused rather than accepted-and-ignored,
  -- and this check matters more now, not less: with no owner-set distance, the pin is the ONLY
  -- thing the owner contributes to being findable. A listed branch that was never located could
  -- never be measured against any search, so the switch would claim something untrue.
  IF p_enabled AND (v_before.latitude IS NULL OR v_before.longitude IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: this branch has no location, so it cannot serve the marketplace';
  END IF;

  UPDATE shops
     SET marketplace_enabled = p_enabled
   WHERE id = p_shop_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'marketplace_settings_changed', 'shop', p_shop_id,
          jsonb_build_object(
            'enabled', p_enabled,
            'was_enabled', v_before.marketplace_enabled
          ));

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'marketplace_enabled', p_enabled
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_marketplace_settings(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_marketplace_settings(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_marketplace_settings(uuid, boolean) IS
  'Turns one branch''s farmer-marketplace listing on or off. Requires an active owner/admin membership of that branch, and refuses to list a branch that has no pinned location. The search distance is the farmer''s, not the branch''s.';

-- ── 2. The Branches read loses the column the owner no longer has ─────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_branches();

CREATE FUNCTION public.get_my_branches()
RETURNS TABLE (
  shop_id           uuid,
  name              text,
  membership_role   membership_role,
  membership_status membership_status,
  is_current        boolean,
  is_main           boolean,
  created_at        timestamptz,
  employee_count    int,
  product_count     int,
  customer_count    int,
  sales_count       int,
  sales_total       numeric,
  address           text,
  latitude          double precision,
  longitude         double precision,
  location_label    text,
  location_source   text,
  -- The branch's marketplace decision, as stored by 0184 and narrowed by 0187: a switch, and
  -- nothing else. The place travels with it because the two are answered together on screen —
  -- a branch with no pin cannot be listed, so the screen needs both to say anything true.
  marketplace_enabled boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT (SELECT u.shop_id FROM users u WHERE u.id = app_current_user_id()) AS home
  )
  SELECT m.tenant_id,
         s.name::text,
         m.role,
         m.status,
         (m.tenant_id = public.current_shop_id()),
         (m.tenant_id = (SELECT home FROM me)),
         s.created_at,
         (SELECT count(*) FROM memberships  x WHERE x.tenant_id = m.tenant_id AND x.status = 'active')::int,
         (SELECT count(*) FROM products     p WHERE p.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM customers    c WHERE c.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM sales        v WHERE v.shop_id   = m.tenant_id)::int,
         (SELECT COALESCE(sum(v.total_amount), 0) FROM sales v WHERE v.shop_id = m.tenant_id),
         s.address,
         s.latitude,
         s.longitude,
         s.location_label,
         s.location_source,
         s.marketplace_enabled
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = app_current_user_id()
   ORDER BY (m.tenant_id = (SELECT home FROM me)) DESC, s.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;

COMMENT ON FUNCTION public.get_my_branches() IS
  'Every branch (shop) the caller is a member of, the main one first, with the counts the Branches screen states before a delete, the place the branch was pinned to, and its farmer-marketplace switch. The caller''s own memberships only — this is the one read allowed to see a branch the account is not standing in.';

-- ── 3. One radius, and it is the searcher's ───────────────────────────────────────────────────
-- Signature and result shape are unchanged, so a consumer written against 0185 keeps working;
-- only the eligibility line changes. `p_radius_km` is the farmer's own choice, clamped to 1–200
-- exactly as before.
CREATE OR REPLACE FUNCTION public.search_marketplace(
  p_latitude   double precision,
  p_longitude  double precision,
  p_radius_km  numeric DEFAULT 25,
  p_query      text    DEFAULT NULL,
  p_category   text    DEFAULT NULL,
  p_limit      int     DEFAULT 50,
  p_offset     int     DEFAULT 0
)
RETURNS TABLE (
  listing_id            uuid,
  branch_id             uuid,
  branch_name           text,
  branch_address        text,
  branch_latitude       numeric,
  branch_longitude      numeric,
  branch_location_label text,
  product_id            uuid,
  product_name          text,
  category              text,
  image_url             text,
  variant_id            uuid,
  variant_label         text,
  unit_size             numeric,
  qty_step              numeric,
  base_unit             text,
  selling_price         numeric,
  availability          text,
  listed_at             timestamptz,
  updated_at            timestamptz,
  distance_km           numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_radius   numeric;
  v_limit    int;
  v_offset   int;
  v_query    text;
  v_category text;
BEGIN
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < 23.0 OR p_latitude > 37.5
     OR p_longitude < 60.0 OR p_longitude > 78.0 THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;

  v_radius := LEAST(GREATEST(COALESCE(p_radius_km, 25), 1), 200);
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_query  := NULLIF(trim(COALESCE(p_query, '')), '');

  v_category := NULLIF(trim(COALESCE(p_category, '')), '');
  IF v_category IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'product_category' AND e.enumlabel = v_category
  ) THEN
    RAISE EXCEPTION 'VALIDATION: unknown category "%"', v_category;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      l.listing_id, l.branch_id, l.branch_name, l.branch_address, l.branch_latitude,
      l.branch_longitude, l.branch_location_label, l.product_id, l.product_name, l.category,
      l.image_url, l.variant_id, l.variant_label, l.unit_size, l.qty_step, l.base_unit,
      l.selling_price, l.availability, l.listed_at, l.updated_at,
      public.marketplace_distance_km(
        p_latitude, p_longitude,
        l.branch_latitude::double precision, l.branch_longitude::double precision
      ) AS d
    FROM public.marketplace_listings l
    WHERE
      -- The distance the farmer asked for, and nothing else. There is no owner-set coverage to
      -- combine with it any more: a listed branch with a location is reachable from anywhere
      -- inside the searcher's own radius.
      public.marketplace_distance_km(
        p_latitude, p_longitude,
        l.branch_latitude::double precision, l.branch_longitude::double precision
      ) <= v_radius
      AND (v_query IS NULL OR l.product_name ILIKE '%' || v_query || '%')
      AND (v_category IS NULL OR l.category = v_category)
  )
  SELECT
    e.listing_id, e.branch_id, e.branch_name, e.branch_address, e.branch_latitude,
    e.branch_longitude, e.branch_location_label, e.product_id, e.product_name, e.category,
    e.image_url, e.variant_id, e.variant_label, e.unit_size, e.qty_step, e.base_unit,
    e.selling_price, e.availability, e.listed_at, e.updated_at,
    round(e.d::numeric, 2) AS distance_km
  FROM eligible e
  -- Nearest first, which is the stated priority when the same product is available from several
  -- eligible branches. Price then name break ties deterministically.
  ORDER BY e.d ASC, e.selling_price ASC, e.product_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) TO anon, authenticated;

COMMENT ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) IS
  'Listed products a farmer at this point can reach: one row per listed branch, nearest first, within the radius the farmer asked for (1–200 km). Refuses a point outside Pakistan; clamps the radius and the page.';

NOTIFY pgrst, 'reload schema';
