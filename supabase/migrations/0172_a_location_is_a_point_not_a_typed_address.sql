-- ═══════════════════════════════════════════════════════════════════════════════
-- 0172 — A location is a point, and it is inside Pakistan
--
-- THE OWNER'S REQUIREMENT. "When I add a new branch, add an input field of location as well —
--   and this location is not input, it is the location the user can select from Google Maps.
--   The user cannot manually enter the location. This location will be saved only via the
--   selected map location. Also in the whole app, when admin or owner onboard, show the
--   location on the map as well, and if we add a customer, show the map location too."
--
-- WHAT WAS MISSING. Every one of these places had an `address` column and nothing else, so
--   "location" could only ever be a typed line of text: unmappable, unverifiable, written two
--   ways by two people. There was nowhere to put a picked point.
--
-- WHAT THIS ADDS.
--
--   1. A place, as four columns on `customers`, `branches`, `shops` and `shop_requests`:
--      `latitude`, `longitude`, `location_label` (the short name the map service gave) and
--      `location_source` (which service produced it, so a later move to another provider is
--      visible in the data instead of being indistinguishable from the old rows). `address`
--      already existed and is what the service returned, not what somebody typed.
--
--   2. PAKISTAN, ENFORCED BY THE DATABASE, not only by the screen. The screen asks the map
--      service for `countrycodes=pk` and checks the returned `country_code`, but those are
--      checks a caller can be wrong about — a proxy, a cached answer, a future screen. A
--      bounding box cannot be argued with: a point outside Pakistan is refused by the table
--      itself. The box is deliberately a little wider than the country (23–37.5 N, 60–78 E) so
--      that a genuine border town is never rejected; what it stops is a pin in another country
--      entirely, which is the failure that actually happens when a search result is misread.
--
--   3. `set_place()` — one guarded writer for all of them, so a location is saved the same way
--      wherever it is picked: which table (whitelisted), which row (must be in the caller's own
--      shop), what authorisation (`customers.edit` for a customer, `settings.edit` for a shop or
--      branch). A location is not a thing any signed-in person may write onto any row.
--
--   4. `create_customer` and `insert_shop_request` carry the place with them, so the ordinary
--      paths store it in one write rather than two.
--
-- WHY NOT A POSTGIS COLUMN. `geography(Point)` is the right type the day anything measures
--   distance; today nothing does, and introducing an extension to the schema is a decision with
--   its own consequences (backups, local development, the pooler). Plain numbers plus a box are
--   what this feature actually needs, and they are readable in the dashboard when something
--   looks wrong.
--
-- VERIFIED BY: tests/unit/geo.test.ts (the provider and the two Pakistan locks) and the
--   database-side refusal exercised in tests/integration/placeLocation.test.ts.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The four columns, on every table that has a place ──────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'branches', 'shops', 'shop_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS latitude double precision', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS longitude double precision', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS location_label text', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS location_source text', t);
  END LOOP;
END $$;

-- ── 2. The box. A point is all-or-nothing, and it is in Pakistan. ─────────────
DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'branches', 'shops', 'shop_requests'] LOOP
    c := t || '_location_in_pakistan';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = c AND conrelid = ('public.' || t)::regclass
    ) THEN
      -- All four set, or none of them: half a coordinate is worse than no location, because it
      -- reads as one on screen and cannot be drawn on a map.
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
           (latitude IS NULL AND longitude IS NULL)
           OR (latitude IS NOT NULL AND longitude IS NOT NULL
               AND latitude BETWEEN 23.0 AND 37.5
               AND longitude BETWEEN 60.0 AND 78.0)
         )', t, c);
    END IF;
  END LOOP;
END $$;

-- ── 3. One guarded writer for any of them ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_place(
  p_table    text,
  p_id       uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_label    text DEFAULT NULL,
  p_address  text DEFAULT NULL,
  p_source   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_table  text := lower(trim(COALESCE(p_table, '')));
  v_shop   uuid;
  v_home   uuid;
  v_updated int := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- A whitelist, not a table name taken from the caller: `set_place` writes coordinates, and the
  -- only way to be sure it never writes them somewhere unexpected is to name what it may touch.
  IF v_table NOT IN ('customers', 'branches', 'shops') THEN
    RAISE EXCEPTION 'VALIDATION: a location cannot be stored on %', COALESCE(NULLIF(p_table, ''), '(nothing)');
  END IF;

  -- A point means a point. The bounding box is checked by the table below as well; this is the
  -- sentence, that is the rule.
  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < 23.0 OR p_latitude > 37.5
     OR p_longitude < 60.0 OR p_longitude > 78.0 THEN
    RAISE EXCEPTION 'VALIDATION: that point is not in Pakistan';
  END IF;

  SELECT u.shop_id INTO v_home FROM users u WHERE u.id = v_actor;

  -- Authority: the same permission the table's own edits require. A customer location is a
  -- customer edit; a shop or branch location is a setting.
  IF v_table = 'customers' THEN
    PERFORM authorize_business_action('customers.edit');
    EXECUTE 'UPDATE customers SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                    address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, ''''),
                    updated_at = now()
              WHERE id = $6 AND shop_id = $7'
      USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_home;
  ELSE
    PERFORM authorize_business_action('settings.edit');
    -- A branch row lives in the tenant it names, and the caller must be a member of THAT tenant
    -- — an owner of one shop cannot pin a branch of another by guessing an id.
    IF v_table = 'branches' THEN
      EXECUTE 'UPDATE branches SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                      address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, '''')
                WHERE id = $6 AND tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id = $7 AND status = ''active'')'
        USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_actor;
    ELSE
      EXECUTE 'UPDATE shops SET latitude = $1, longitude = $2, location_label = NULLIF($3, ''''),
                      address = COALESCE(NULLIF($4, ''''), address), location_source = NULLIF($5, '''')
                WHERE id = $6 AND id IN (SELECT tenant_id FROM memberships WHERE user_id = $7 AND status = ''active'')'
        USING p_latitude, p_longitude, p_label, p_address, p_source, p_id, v_actor;
    END IF;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  -- Nothing written is reported, never swallowed: a location that did not save must not look
  -- like one that did.
  IF v_updated = 0 THEN RAISE EXCEPTION 'NOT_FOUND: nothing of yours matches that row'; END IF;

  RETURN jsonb_build_object('ok', true, 'table', v_table, 'id', p_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.set_place(text, uuid, double precision, double precision, text, text, text) IS
  'Stores a location picked on a map onto one customer, branch or shop the caller may edit. '
  'Refuses a point outside Pakistan and a row that is not theirs.';

-- ── 4. The ordinary paths carry the place with them ───────────────────────────
CREATE OR REPLACE FUNCTION public.create_customer(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_phone text; v_resolved jsonb; v_shop_id uuid; v_actor uuid;
BEGIN
  v_resolved := resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id := (v_resolved->>'shop_id')::uuid; v_actor := (v_resolved->>'actor_id')::uuid;
  PERFORM authorize_business_action('customers.create', v_shop_id, NULLIF(payload->>'branchId','')::uuid);
  v_phone := NULLIF(payload->>'phone','');
  IF v_phone IS NOT NULL AND EXISTS(SELECT 1 FROM customers WHERE phone=v_phone AND is_archived=false AND shop_id=v_shop_id) THEN RAISE EXCEPTION 'DUPLICATE_CUSTOMER_PHONE'; END IF;
  -- The place arrives with the customer when the screen had one picked, so the ordinary path is
  -- one write. Cast through NULLIF: an empty string is not a latitude, and `''::double precision`
  -- raises rather than being ignored.
  INSERT INTO customers(id,name,phone,address,credit_limit,created_by,shop_id,created_at,updated_at,
                        latitude,longitude,location_label,location_source)
  VALUES(gen_random_uuid(),payload->>'name',v_phone,NULLIF(payload->>'address',''),COALESCE((payload->>'credit_limit')::numeric,0),v_actor,v_shop_id,now(),now(),
         NULLIF(payload->>'latitude','')::double precision,
         NULLIF(payload->>'longitude','')::double precision,
         NULLIF(payload->>'locationLabel',''),
         NULLIF(payload->>'locationSource',''))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'name',payload->>'name');
END; $$;

-- The registration form is the one place a location is written by somebody who is not signed in
-- yet, so it cannot go through set_place. The columns added above are the guard: the sign-up
-- location is subject to the same Pakistan box as every other one.
DROP FUNCTION IF EXISTS public.insert_shop_request(text, text, text, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.insert_shop_request(
  p_owner_name text,
  p_owner_phone text,
  p_phone text,
  p_shop_name text,
  p_shop_type text DEFAULT 'retail',
  p_shop_city text DEFAULT NULL,
  p_shop_address text DEFAULT NULL,
  p_business_registration_number text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_location_label text DEFAULT NULL,
  p_location_source text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO shop_requests (owner_name, owner_phone, phone, shop_name, shop_type, shop_city,
                             shop_address, business_registration_number, status,
                             latitude, longitude, location_label, location_source)
  VALUES (p_owner_name, p_owner_phone, p_phone, p_shop_name, p_shop_type, p_shop_city,
          p_shop_address, p_business_registration_number, 'pending',
          p_latitude, p_longitude, p_location_label, p_location_source)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'id', new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.insert_shop_request(text, text, text, text, text, text, text, text, double precision, double precision, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
