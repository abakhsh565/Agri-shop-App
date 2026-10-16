-- ═══════════════════════════════════════════════════════════════════════════════
-- 0185 — The owner can list a product, and the marketplace can read exactly that
--
-- WHAT THIS IS. The second half of the Owner-side marketplace foundation. 0184 gave a branch the
--   decision ("do we list, and how far will we serve"); this file gives a product the owner's
--   switch, and then publishes the result through ONE curated, deliberately public read.
--
--   Nothing here is a Farmer App. There are no orders, no chat, no credit, no payments and no
--   notifications — only the read contract a future consumer will connect to, so that connecting
--   is not another redesign.
--
-- ── 1. THE LISTING STATE IS A COLUMN, NOT A TABLE ───────────────────────────────
--   `products.marketplace_listed` plus the moment it was listed. A separate `marketplace_listings`
--   TABLE was considered and rejected: it would duplicate the product's identity and price for no
--   gain, it would need its own sync to stay honest with the catalogue, and it would be a second
--   product system — the exact thing this workstream is forbidden to build. The Owner App stays
--   the single source of truth because the flag lives on the owner's own row.
--
--   The read contract below is a VIEW, so the name `marketplace_listings` still exists for the
--   consumer. A view cannot drift from the catalogue, because it holds nothing.
--
-- ── 2. WHY THIS READ IS PUBLIC, AND WHY THAT IS NOT A HOLE ──────────────────────
--   The Farmer App does not exist and therefore has no credential of its own. Discovery must not
--   wait on inventing one, so the contract is readable with the anon key the client already
--   ships — which means the allowlist IS the security boundary, and it is enforced by a frozen
--   projection rather than by a filter someone has to remember to apply.
--
--   `anon` is granted SELECT on the view and EXECUTE on one search function. It is granted
--   nothing else, and a test asserts that after this migration `anon` still cannot read
--   `products`, `product_variants`, `shops` or `inventory_movements`.
--
--   The view runs with its owner's rights (Postgres' default; `security_invoker` is opt-in) and
--   `postgres` owns the tables, so the view does NOT inherit their RLS — its WHERE clause is the
--   enforcement. That is the same construction `product_variants_public` (0179) already uses and
--   `variantIsolation.test.ts` already proves, so this is a pattern the repository has, not a new
--   one invented here.
--
-- ── 3. WHAT IS NEVER EXPOSED, AND WHY EACH ONE MATTERS ──────────────────────────
--   `cost_price`            — the shop's purchase price; markup is nobody else's business.
--   `low_stock_threshold`   — together with a stock number it describes the shop's operations.
--   `stock_qty`             — a farmer who can watch stock tick down can read demand, and can
--                             time a shop's shortage. Availability is published as ONE word.
--   `company_id` / supplier — who the shop buys from is the shop's supply chain.
--   `barcode` / `sku`       — internal identifiers; a public one invites enumeration.
--   `batch_id` / `expiry`   — batch structure and dating are internal inventory facts.
--   `owner_id` / `join_code`— `join_code` is a credential for joining the shop's staff.
--   `phone` / `created_by`  — contact and staffing data belong to the owner's own screens.
--
--   The projection is checked twice: by an assertion in this file that refuses to apply if a
--   forbidden name appears, and by a test that compares the live column set for EQUALITY with the
--   allowlist — so a column added later fails rather than silently publishing.
--
-- ── 4. AVAILABILITY IS A WORD, NOT A BAND ───────────────────────────────────────
--   `'available'` or `'out_of_stock'`, and out-of-stock rows are excluded from the view entirely.
--   A `'low_stock'` value was considered and deliberately NOT shipped: it is derivable from
--   `low_stock_threshold`, so publishing it would hand back the operational detail the redaction
--   above exists to withhold. If a coarse band is ever wanted it is an additive decision, and it
--   belongs in the register rather than in a quiet column.
--
-- ── 5. LOCATION AND RADIUS ──────────────────────────────────────────────────────
--   Distance is measured with the haversine formula over the branch's pinned point. There is no
--   PostGIS in this project — 0172 declined the extension deliberately — and nothing needs a
--   spatial index at this scale.
--
--   A listing is eligible only when it is inside BOTH radii: the branch's own coverage (0184) and
--   the searcher's radius. That is the `LEAST()` in `search_marketplace`, and it is the honest
--   reading of two different promises — "how far will this branch serve" is the owner's, "how far
--   will I travel" is the farmer's, and neither may override the other.
--
--   Coordinates are rounded to 4 decimal places (~11 m) in the projection: enough to find a shop
--   and route to it, not enough to be a precise scrape target.
--
-- ── 6. WHAT A FUTURE CONSUMER MUST DO, AND WHAT IT MUST NOT ─────────────────────
--   Read `marketplace_listings` (or call `search_marketplace`). Never query the base tables. When
--   the Farmer App arrives with its own credential, tightening this is one REVOKE and one GRANT —
--   not a schema change.
--
-- VERIFIED BY: tests/integration/marketplaceContract.test.ts (anon boundary, toggle on/off,
--   archive, zero stock, no-pin branch, both radii in both directions, nearest-first, column-set
--   equality) and tests/unit/marketplaceContractGuard.test.ts (the allowlist, with the guard's
--   non-vacuity proven by injecting a forbidden column once).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The owner's listing decision, on the product that owns it ──────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS marketplace_listed boolean NOT NULL DEFAULT false;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS marketplace_listed_at timestamptz;

COMMENT ON COLUMN public.products.marketplace_listed IS
  'The owner''s "List on Farmer Marketplace" switch for this product. False by default: a product is never publicly visible because a migration ran.';
COMMENT ON COLUMN public.products.marketplace_listed_at IS
  'When the product was most recently listed. Stamped on the false→true flip only, so re-saving an already-listed product does not keep moving the date, and cleared when it is unlisted.';

-- ── 2. create_product carries the decision ────────────────────────────────────
-- Recreated from 0158 verbatim except for the two listing columns in the products INSERT. The
-- body was compared against the live definition before writing this file: the only difference
-- found was the syntax-equivalent `search_path='public'` vs `search_path TO 'public'`, so nothing
-- else in this function has moved.
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

  -- One code per product, minted here when the caller did not supply one, so the code can
  -- never be lost by a client that forgets it.
  v_code := upper(regexp_replace(COALESCE(NULLIF(payload->>'barcode',''), mint_barcode(payload->>'name', v_shop_id)), '\s', '', 'g'));
  IF EXISTS (SELECT 1 FROM product_barcodes WHERE shop_id = v_shop_id AND code = v_code) THEN
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

  RETURN jsonb_build_object('id',v_product_id,'name',payload->>'name','barcode',v_code,'marketplace_listed',v_listed);
END;
$function$;

-- ── 3. update_product carries it too, with present-vs-absent semantics ────────
-- Recreated from 0161 verbatim except for the two listing columns in the products UPDATE. 0161's
-- own distinction is reused rather than reinvented: a payload that does not MENTION
-- `marketplaceListed` leaves the flag alone (so an older client, or an update about something
-- else, cannot silently unlist a product), while a payload that says `false` is the owner
-- unlisting it. That is the same rule `expiryDate` and `barcode` already follow on this screen.
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

-- ── 4. Distance, without an extension ─────────────────────────────────────────
-- Haversine over the sphere. Pure arithmetic over built-ins, so it is IMMUTABLE and can be used
-- in an index expression later if the catalogue ever grows enough to need one. `search_path` is
-- pinned for the same reason 0177 pins it: a caller who can create an object earlier in the path
-- must not be able to shadow a name this function trusts.
CREATE OR REPLACE FUNCTION public.marketplace_distance_km(
  p_lat1 double precision,
  p_lon1 double precision,
  p_lat2 double precision,
  p_lon2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT 6371.0088 * 2 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
         + cos(radians(p_lat1)) * cos(radians(p_lat2))
           * power(sin(radians(p_lon2 - p_lon1) / 2), 2)
         ));
$function$;

-- Internal: `search_marketplace` is SECURITY DEFINER and calls it with the owner's rights, so no
-- public grant is needed. Revoking from PUBLIC closes the default that Postgres grants every
-- function.
REVOKE ALL ON FUNCTION public.marketplace_distance_km(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.marketplace_distance_km(double precision, double precision, double precision, double precision) IS
  'Great-circle distance in kilometres between two points. Haversine over built-ins; this project has no PostGIS by deliberate decision (0172).';

-- ── 5. The contract: one curated projection, frozen ───────────────────────────
-- A view, not a table: it holds nothing, so it cannot disagree with the catalogue, and it needs no
-- sync, no trigger and no second writer. Its WHERE clause is the enforcement (see the header), and
-- every column is named explicitly — there is no `SELECT *` anywhere in this file, because a
-- star is how a future column becomes public without anyone deciding it should be.
DROP VIEW IF EXISTS public.marketplace_listings;

CREATE VIEW public.marketplace_listings AS
SELECT
  -- Identity. `listing_id` is what a consumer references; it is the variant id, and
  -- `variant_id` is carried alongside so the owner side can resolve a listing back to the pack
  -- it names. Both come from the same source column, so they cannot drift apart.
  v.id                            AS listing_id,
  -- Where it can be collected from.
  s.id                            AS branch_id,
  s.name::text                    AS branch_name,
  s.address::text                 AS branch_address,
  -- Rounded to 4 dp (~11 m): enough to find and route to the shop, not a precise scrape target.
  round(s.latitude::numeric, 4)   AS branch_latitude,
  round(s.longitude::numeric, 4)  AS branch_longitude,
  s.location_label::text          AS branch_location_label,
  -- What it is.
  p.id                            AS product_id,
  p.name::text                    AS product_name,
  p.category::text                AS category,
  p.image_url::text               AS image_url,
  -- The sellable pack. `cost_price`, `low_stock_threshold` and `stock_qty` are deliberately
  -- absent — see the header for why each one is withheld.
  v.id                            AS variant_id,
  v.name::text                    AS variant_label,
  v.unit_size                     AS unit_size,
  v.qty_step                      AS qty_step,
  p.base_unit::text               AS base_unit,
  v.selling_price                 AS selling_price,
  -- ONE word. `stock_qty > 0` is the whole question a buyer asks, and the filter below means the
  -- only reachable value is 'available'; the CASE is kept so the mapping stays correct if the
  -- filter is ever relaxed.
  CASE WHEN v.stock_qty > 0 THEN 'available' ELSE 'out_of_stock' END AS availability,
  -- When the owner listed it, and when either side of the listing last changed.
  p.marketplace_listed_at         AS listed_at,
  GREATEST(p.updated_at, v.updated_at) AS updated_at
FROM public.product_variants v
JOIN public.products p ON p.id = v.product_id
JOIN public.shops s    ON s.id = p.shop_id
WHERE
  -- The branch must have opted in AND be locatable. A branch with no pin cannot be measured
  -- against any radius, so it is excluded rather than shown to everyone or no one by accident.
  s.marketplace_enabled
  AND s.latitude IS NOT NULL
  AND s.longitude IS NOT NULL
  -- The owner must have listed the product, and it must still be a live catalogue item.
  -- `delete_product` archives with `is_active = false`, so an archived product leaves the
  -- marketplace through this line without the delete path needing to know the marketplace exists.
  AND p.marketplace_listed
  AND p.is_active
  AND v.is_active
  -- A pack with nothing on the shelf is not on offer.
  AND v.stock_qty > 0
  -- A listing with no price would read to a farmer as free.
  AND v.selling_price > 0;

COMMENT ON VIEW public.marketplace_listings IS
  'The curated, deliberately public marketplace contract: one row per listed product pack per branch, with the branch''s pinned place, the price a buyer pays, and availability as a single word. Never carries cost_price, low_stock_threshold, stock_qty, supplier, barcode, sku, batch, expiry, owner_id, join_code, phone or staffing data. Runs with its owner''s rights, so its WHERE clause — not RLS — is the enforcement.';

GRANT SELECT ON public.marketplace_listings TO anon, authenticated;

-- ── 6. The search contract ────────────────────────────────────────────────────
-- The one function the marketplace may call. It exists so a consumer never has to build a query:
-- it states the radius rule in one place, orders by nearest, and refuses to be used as a general
-- geo oracle.
DROP FUNCTION IF EXISTS public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer);

CREATE FUNCTION public.search_marketplace(
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
  -- How far the branch is from the point that was searched. Returned so a consumer can show it,
  -- and so "nearest" is a fact the caller can check rather than one it must trust.
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
  -- A point means a point, and it is in Pakistan. The same box 0172 puts on every stored
  -- location, applied here so this function cannot be pointed at another country to probe it.
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < 23.0 OR p_latitude > 37.5
     OR p_longitude < 60.0 OR p_longitude > 78.0 THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;

  -- A caller asking for 5000 km is not describing a journey, it is trying to enumerate the
  -- catalogue; a caller asking for 0 is describing a mistake. Both are clamped rather than
  -- refused, because the sensible answer is available either way.
  v_radius := LEAST(GREATEST(COALESCE(p_radius_km, 25), 1), 200);
  v_limit  := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_offset := GREATEST(COALESCE(p_offset, 0), 0);
  v_query  := NULLIF(trim(COALESCE(p_query, '')), '');

  -- An unknown category is a caller error, not an empty result: answering "nothing found" would
  -- read to the caller as "no shop has it" and hide the typo.
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
    -- The branch's own coverage comes from the base row, not from the projection: how far a shop
    -- will serve is the owner's operating decision, and it is not part of the public contract.
    JOIN public.shops s ON s.id = l.branch_id
    WHERE
      -- BOTH radii, and neither may override the other. A branch that serves 30 km stays
      -- invisible to a search asking for 200, and a search asking for 5 does not reach a branch
      -- 40 km away even though that branch would have served it.
      public.marketplace_distance_km(
        p_latitude, p_longitude,
        l.branch_latitude::double precision, l.branch_longitude::double precision
      ) <= LEAST(v_radius, s.marketplace_radius_km)
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
  -- eligible branches. Price then name break ties deterministically, so the same search does not
  -- reshuffle between calls.
  ORDER BY e.d ASC, e.selling_price ASC, e.product_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) TO anon, authenticated;

COMMENT ON FUNCTION public.search_marketplace(double precision, double precision, numeric, text, text, integer, integer) IS
  'Listed products a farmer at this point can reach: one row per eligible branch, nearest first. A branch is eligible only inside BOTH the searcher''s radius and the branch''s own coverage (0184). Refuses a point outside Pakistan; clamps the radius to 1–200 km and the page to 100 rows.';

-- ── 7. Proof, in the migration itself ─────────────────────────────────────────
-- Two assertions that make this file refuse to apply if it is ever edited into an unsafe state.
-- The column set is compared for EQUALITY by the test suite as well; this block is the cheap
-- guard that runs on every apply.
DO $$
DECLARE
  bad     text;
  anon_ok boolean;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO bad
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'marketplace_listings'
     AND column_name IN (
       'cost_price', 'low_stock_threshold', 'stock_qty', 'company_id', 'barcode', 'sku',
       'batch_id', 'expiry_date', 'owner_id', 'join_code', 'phone', 'created_by'
     );

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0185: marketplace_listings exposes %', bad;
  END IF;

  anon_ok := has_table_privilege('anon', 'public.marketplace_listings', 'SELECT');
  IF NOT anon_ok THEN
    RAISE EXCEPTION '0185: the marketplace contract is not readable by the marketplace identity';
  END IF;

  RAISE NOTICE '0185: marketplace contract carries no cost, stock count, supplier, code or owner field';
END $$;

-- PostgREST caches the schema. Without this the view and the RPC answer 404 from a client until
-- the cache happens to expire.
NOTIFY pgrst, 'reload schema';
