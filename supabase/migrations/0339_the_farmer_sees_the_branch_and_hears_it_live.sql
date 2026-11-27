-- 0339 — the farmer sees the branch he is dealing with, and both ends hear about a change at once.
--
-- WHY THIS FILE EXISTS. The dealer app is complete and working; the farmer app is the new consumer,
-- and the owner reported four concrete integration failures that all live in this gap:
--
--   1. DELAYED SYNCHRONISATION. Nothing on the farmer side was live. A dealer's reply, a revised
--      credit offer or a visit move reached the farmer only when his app happened to re-read the
--      thread, and the dealer's own Messages screen did not move either: `farmer_messages` is in no
--      publication, RLS is on with zero policies, and every client grant is revoked (0325/0330), so
--      even the dealer could only see a new message by reopening the screen. Push existed (0329) but
--      a cron tick once a minute (0331) put a floor of up to 60 s under every notification.
--
--   2. MISSING SHOP/BRANCH INFORMATION. `farmer_api_thread` answered a shop id and a name and
--      nothing a farmer could act on — no address, no pin, no number to call, no way to know whether
--      the branch was a real registered business. `farmer_api_shops` and `farmer_api_products`
--      answered a partial profile too, each with its own copy of the field list, so the three doors
--      could drift apart one edit at a time.
--
--   3. AVAILABILITY INCONSISTENCIES. The marketplace view (0185) treats a pack as sellable only when
--      it is active, has stock AND has a positive price. `farmer_api_products` (0335) asked only
--      about stock, so a pack with stock and a zero/null price was "in stock" on the farmer's
--      catalogue and absent from discovery — the same product, two answers.
--
--   4. UNCERTAIN COMMUNICATION. The transport was poll + a once-a-minute push tick. There was no
--      channel at all for a farmer token (no JWT, so `postgres_changes` cannot authorise him) and the
--      dealer had no live channel either.
--
-- WHAT THIS ADDS, AND WHY IN THIS SHAPE.
--
--   * `farmer_shop_profile(shops)` — ONE definition of what a farmer may know about a branch: name,
--     city, address, phone, WhatsApp number, type, logo, pin rounded to ~11 m, the place label, the
--     owner's display name and whether the business is registered. The three reader doors call it
--     instead of repeating a field list. Withheld exactly as before plus by decision: `join_code` (a
--     staff credential, 0328), email, licence/CNIC URLs, `owner_id` as an identifier, and the exact
--     registration number. The farmer gets a verified flag and the human he is dealing with, never a
--     way to impersonate or re-register the business.
--
--   * `farmer_variant_is_available(stock, price, active)` — the marketplace's own eligibility rule as
--     a pure function, used by the farmer catalogue. One rule, one place: a zero-price pack is not
--     sellable anywhere, and a pack cannot be "in stock" on one screen and absent from another.
--
--   * REALTIME. Two topics, chosen for the two different credentials rather than one compromised
--     design:
--       - the FARMER has no JWT, so RLS cannot authorise a private channel for him. He subscribes to
--         `farmer:<first 40 hex chars of his token's sha256>` — the topic is derived from his own
--         credential, so it is unguessable to anyone who does not hold the token, and `farmer_api_me`
--         hands him the exact string to subscribe to. Revoking or rotating the token changes the
--         topic, so a leaked topic stops working when the credential does.
--       - the DEALER is a signed-in member, so he gets a PRIVATE topic `shop:<shop_id>` and the
--         authorisation is one RLS policy on `realtime.messages` that admits exactly an active member
--         of that shop. No business table gains a policy or a grant; `farmer_messages` stays
--         server-owned and policy-free, which is the decision 0325/0330 made and this file keeps.
--     A trigger on `farmer_messages`, `farmer_credit_requests` and `farmer_visit_requests` broadcasts
--     in the same transaction as the write, so delivery is a WebSocket frame, not a poll interval.
--
--   * IMMEDIATE PUSH. A row in `push_deliveries` now wakes the dispatcher in the same transaction
--     instead of waiting for the next minute, with the cron job kept as the safety net. The call is
--     advisory-locked (one dispatch per transaction burst), extension-guarded (a rehearsal database
--     without pg_net is not an error) and exception-wrapped, because a failed push must never fail
--     the business write that produced it.
--
-- WHAT IT DOES NOT DO. No table, column or row is added or rewritten. No existing payload key is
-- removed: `shop_id` and `shop_name` stay where they were and the richer `shop` object sits beside
-- them. No message, credit or visit rule changes. No cost price, stock quantity, supplier or staff
-- credential becomes reachable. Additive and replayable.

-- ── 1. What a farmer may know about one branch, defined once ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmer_shop_profile(p_shop public.shops)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'shop_id',        p_shop.id,
    'name',           p_shop.name,
    'city',           p_shop.city,
    'address',        p_shop.address,
    'phone',          p_shop.phone,
    'whatsapp_phone', p_shop.whatsapp_phone,
    'shop_type',      p_shop.shop_type,
    'logo_url',       p_shop.logo_url,
    -- ~11 m, the same rounding the public marketplace contract already applies (0185), so the two
    -- doors cannot disagree about where a branch is.
    'latitude',       round(p_shop.latitude::numeric, 4),
    'longitude',      round(p_shop.longitude::numeric, 4),
    'location_label', p_shop.location_label,
    -- The human the farmer is dealing with. A display name, never the owner's user id: the id is a
    -- key into the shop session and has no business on a farmer's screen.
    'owner_name',     (SELECT u.name FROM public.users u WHERE u.id = p_shop.owner_id),
    -- Registered with a number on file: what "a real shop" means to a buyer, without publishing the
    -- number itself.
    'is_verified',    (p_shop.registration_number IS NOT NULL)
  )
$$;

COMMENT ON FUNCTION public.farmer_shop_profile(public.shops) IS
  'The public profile of one branch as a farmer may see it: contact, pin, place label, owner display name and a verified flag. Withholds join_code, email, licence/CNIC URLs, owner_id and the registration number itself.';

REVOKE ALL ON FUNCTION public.farmer_shop_profile(public.shops) FROM PUBLIC, anon, authenticated;

-- ── 2. One eligibility rule for a pack ─────────────────────────────────────────────────────────
-- Exactly the condition `marketplace_listings` applies (0185, condition 5–7). Immutable and pure, so
-- it can be asserted without a row: active AND stock > 0 AND price > 0.
CREATE OR REPLACE FUNCTION public.farmer_variant_is_available(
  p_stock_qty      numeric,
  p_selling_price  numeric,
  p_is_active      boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_is_active, false)
     AND COALESCE(p_stock_qty, 0) > 0
     AND COALESCE(p_selling_price, 0) > 0
$$;

COMMENT ON FUNCTION public.farmer_variant_is_available(numeric, numeric, boolean) IS
  'The marketplace eligibility rule for one pack: active, in stock and priced above zero. Used by the farmer catalogue so it cannot answer differently from discovery.';

REVOKE ALL ON FUNCTION public.farmer_variant_is_available(numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;

-- ── 3. The farmer's realtime topic ─────────────────────────────────────────────────────────────
-- Derived from the hash the server already stores, never from a new secret. `farmer_api_me` returns
-- it to the token holder; the broadcaster derives the same string from the same row.
CREATE OR REPLACE FUNCTION public.farmer_realtime_topic(p_farmer_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'farmer:' || substr(t.token_hash, 1, 40)
    FROM public.marketplace_farmer_tokens t
   WHERE t.farmer_id = p_farmer_id
     AND t.revoked_at IS NULL
   ORDER BY t.issued_at DESC
   LIMIT 1
$$;

COMMENT ON FUNCTION public.farmer_realtime_topic(uuid) IS
  'The realtime topic for one farmer: the first 40 hex characters of his live token hash. Only the credential holder can compute it, and rotating the token changes it.';

REVOKE ALL ON FUNCTION public.farmer_realtime_topic(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. The dealer directory carries the branch, not just a name ────────────────────────────────
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
            public.farmer_shop_profile(s)
              || jsonb_build_object('is_linked', (l.farmer_id IS NOT NULL),
                                    'linked_since', l.created_at) AS entry,
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
  'The dealers a farmer can see: every shop that opted into the marketplace plus every shop he is linked to, each with its full public branch profile.';

-- ── 5. The catalogue answers the same availability discovery does ──────────────────────────────
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
    v_shop := public.farmer_shop_scope(v_farmer, NULL);
  ELSE
    SELECT * INTO v_shop_row FROM public.shops s WHERE s.id = p_shop_id;
    IF v_shop_row.id IS NULL THEN
      RAISE EXCEPTION 'NOT_FOUND: that shop does not exist';
    END IF;
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
    'shop', public.farmer_shop_profile(v_shop_row),
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
              -- ONE rule for "can a farmer buy this", the same one discovery applies.
              'in_stock', CASE
                WHEN EXISTS (SELECT 1 FROM public.product_variants av
                              WHERE av.product_id = p.id AND av.is_active)
                  THEN EXISTS (SELECT 1 FROM public.product_variants sv
                                WHERE sv.product_id = p.id
                                  AND public.farmer_variant_is_available(sv.stock_qty, sv.selling_price, sv.is_active))
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
                         -- Sellable, not merely present: the same predicate as `availability` in
                         -- `marketplace_listings`, so the two never disagree again.
                         'in_stock', public.farmer_variant_is_available(v.stock_qty, v.selling_price, v.is_active),
                         'low_stock', public.farmer_variant_is_available(v.stock_qty, v.selling_price, v.is_active)
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
  'A shop''s active catalogue for one farmer: variants, selling prices, the branch profile and a coarse in_stock/low_stock answer that uses the marketplace eligibility rule. Never an exact quantity, a cost price or another shop''s row.';

-- ── 6. The farmer's own identity, and the topic to listen on ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmer_api_me(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_row    public.marketplace_farmers;
BEGIN
  SELECT * INTO v_row FROM public.marketplace_farmers f WHERE f.id = v_farmer;
  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'village', v_row.village,
    -- Subscribe to this string; the database broadcasts a message, an offer and a visit move here
    -- in the same transaction that writes them.
    'realtime_topic', public.farmer_realtime_topic(v_farmer),
    'shops', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'shop_id', l.shop_id,
               'shop_name', (SELECT s.name FROM public.shops s WHERE s.id = l.shop_id)
             ) ORDER BY l.created_at)
        FROM public.marketplace_farmer_links l WHERE l.farmer_id = v_farmer
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.farmer_api_me(text) IS
  'The farmer behind a credential, the shops he is linked to, and the realtime topic derived from his token.';

-- ── 7. The farmer's thread names its branch ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.farmer_api_thread(p_token text, p_shop_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer   uuid := public.farmer_by_token(p_token);
  v_shop     uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
  v_shop_row public.shops;
BEGIN
  UPDATE public.marketplace_farmer_links l
     SET farmer_last_read_at = now()
   WHERE l.shop_id = v_shop AND l.farmer_id = v_farmer;

  SELECT * INTO v_shop_row FROM public.shops s WHERE s.id = v_shop;

  RETURN jsonb_build_object(
    'shop_id', v_shop,
    'shop_name', v_shop_row.name,
    -- Which branch this conversation is: where to collect, who to call, and whether it is a
    -- registered business. Without it the farmer had a thread with a name he could not visit.
    'shop', public.farmer_shop_profile(v_shop_row),
    'realtime_topic', public.farmer_realtime_topic(v_farmer),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'direction', m.direction, 'channel', m.channel,
               'body', m.body, 'created_at', m.created_at) ORDER BY m.created_at)
        FROM (SELECT * FROM public.farmer_messages
               WHERE shop_id = v_shop AND farmer_id = v_farmer
               ORDER BY created_at DESC LIMIT 200) m
    ), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status,
               'requested_amount', r.requested_amount, 'requested_note', r.requested_note,
               'offer_lines', r.offer_lines, 'offer_total', r.offer_total,
               'offer_due_on', r.offer_due_on, 'offer_note', r.offer_note,
               'revision', r.revision, 'created_at', r.created_at) ORDER BY r.created_at DESC)
        FROM public.farmer_credit_requests r
       WHERE r.shop_id = v_shop AND r.farmer_id = v_farmer
    ), '[]'::jsonb),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'status', v.status, 'purpose', v.purpose,
               'preferred_window', v.preferred_window,
               'assigned_name', (SELECT u.name FROM public.users u WHERE u.id = v.assigned_to),
               'scheduled_for', v.scheduled_for, 'owner_note', v.owner_note,
               'created_at', v.created_at) ORDER BY v.created_at DESC)
        FROM public.farmer_visit_requests v
       WHERE v.shop_id = v_shop AND v.farmer_id = v_farmer
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.farmer_api_thread(text, uuid) IS
  'One branch''s conversation with one farmer, including the branch profile and the realtime topic. Scoped to a branch the farmer is linked to.';

-- ── 8. The broadcasts ─────────────────────────────────────────────────────────────────────────
-- In the same transaction as the write: the farmer's unguessable topic (public channel, no JWT to
-- authorise one) and the dealer's private per-shop topic (RLS authorises the subscriber).
CREATE OR REPLACE FUNCTION public.farmer_broadcast_change(
  p_event    text,
  p_shop_id  uuid,
  p_farmer_id uuid,
  p_payload  jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer_topic text;
BEGIN
  -- A rehearsal database without Realtime is not an error: the write still succeeds, it just has
  -- nothing to notify.
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RETURN;
  END IF;

  v_farmer_topic := public.farmer_realtime_topic(p_farmer_id);

  IF v_farmer_topic IS NOT NULL THEN
    PERFORM realtime.send(p_payload, p_event, v_farmer_topic, false);
  END IF;

  IF p_shop_id IS NOT NULL THEN
    PERFORM realtime.send(p_payload, p_event, 'shop:' || p_shop_id::text, true);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.farmer_broadcast_change(text, uuid, uuid, jsonb) IS
  'Sends one change to a farmer''s token-derived topic and to the owning branch''s private topic. Silently does nothing where Realtime is absent.';

CREATE OR REPLACE FUNCTION public.farmer_messages_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.farmer_broadcast_change(
    'message',
    NEW.shop_id,
    NEW.farmer_id,
    jsonb_build_object(
      'id', NEW.id,
      'shop_id', NEW.shop_id,
      'farmer_id', NEW.farmer_id,
      'direction', NEW.direction,
      'channel', NEW.channel,
      'body', NEW.body,
      'delivered_to_app_at', NEW.delivered_to_app_at,
      'created_at', NEW.created_at
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_credit_requests_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.revision IS NOT DISTINCT FROM OLD.revision THEN
    RETURN NULL;
  END IF;
  PERFORM public.farmer_broadcast_change(
    'request',
    NEW.shop_id,
    NEW.farmer_id,
    jsonb_build_object(
      'id', NEW.id, 'shop_id', NEW.shop_id, 'farmer_id', NEW.farmer_id,
      'status', NEW.status, 'revision', NEW.revision,
      'offer_total', NEW.offer_total, 'offer_due_on', NEW.offer_due_on,
      'decided_at', NEW.decided_at, 'created_at', NEW.created_at
    )
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_visit_requests_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  PERFORM public.farmer_broadcast_change(
    'visit',
    NEW.shop_id,
    NEW.farmer_id,
    jsonb_build_object(
      'id', NEW.id, 'shop_id', NEW.shop_id, 'farmer_id', NEW.farmer_id,
      'status', NEW.status, 'scheduled_for', NEW.scheduled_for,
      'assigned_to', NEW.assigned_to, 'created_at', NEW.created_at
    )
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS farmer_messages_broadcast ON public.farmer_messages;
CREATE TRIGGER farmer_messages_broadcast
  AFTER INSERT ON public.farmer_messages
  FOR EACH ROW EXECUTE FUNCTION public.farmer_messages_broadcast();

DROP TRIGGER IF EXISTS farmer_credit_requests_broadcast ON public.farmer_credit_requests;
CREATE TRIGGER farmer_credit_requests_broadcast
  AFTER INSERT OR UPDATE ON public.farmer_credit_requests
  FOR EACH ROW EXECUTE FUNCTION public.farmer_credit_requests_broadcast();

DROP TRIGGER IF EXISTS farmer_visit_requests_broadcast ON public.farmer_visit_requests;
CREATE TRIGGER farmer_visit_requests_broadcast
  AFTER INSERT OR UPDATE ON public.farmer_visit_requests
  FOR EACH ROW EXECUTE FUNCTION public.farmer_visit_requests_broadcast();

-- ── 9. The dealer's side of the private channel ───────────────────────────────────────────────
-- One policy on the Realtime table, not on any business table: an active member of the shop whose
-- id names the topic may read that topic's broadcast. `farmer_messages` keeps its zero policies
-- and its revoked grants, so a direct PostgREST read is still refused (0325/0330).
DO $policy$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'DROP POLICY IF EXISTS farmer_shop_broadcast ON realtime.messages';
  EXECUTE $p$
    CREATE POLICY farmer_shop_broadcast ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        extension = 'broadcast'
        AND EXISTS (
          SELECT 1 FROM public.memberships m
           WHERE m.user_id = (SELECT auth.uid())
             AND m.status = 'active'
             AND realtime.topic() = 'shop:' || m.tenant_id::text
        )
      )
  $p$;
END
$policy$;

-- ── 10. Push leaves immediately, the cron stays as the safety net ─────────────────────────────
CREATE OR REPLACE FUNCTION public.push_deliveries_dispatch_now()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No pg_net (a plain Postgres rehearsal) — nothing to do, and definitely not an error.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RETURN NULL;
  END IF;
  -- One dispatch per concurrent burst; the cron tick (0331) remains the fallback for whatever a
  -- skipped lock left behind.
  IF NOT pg_try_advisory_xact_lock(hashtext('agrishop.push_dispatch_now')) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.push_dispatch_tick();
  EXCEPTION WHEN OTHERS THEN
    -- A delivery is not the business write. The row stays queued and the cron retries it.
    NULL;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS push_deliveries_dispatch_now ON public.push_deliveries;
CREATE TRIGGER push_deliveries_dispatch_now
  AFTER INSERT ON public.push_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.push_deliveries_dispatch_now();

-- ── 11. The ACL, declared and then proved ────────────────────────────────────────────────────
DO $acl$
DECLARE
  -- The three the ledger reads as retired from `authenticated` (they carry the literal REVOKE lines
  -- below). The declaration must match that set exactly, in both directions, or the repository's
  -- ACL guard goes blind — so the trigger helpers are NOT in this array.
  v_server_only constant text[] := array[
    'farmer_shop_profile',
    'farmer_variant_is_available',
    'farmer_realtime_topic'
  ];
  -- Internal machinery with no HTTP door at all: a broadcaster and four triggers. A trigger does not
  -- check EXECUTE when it fires, so the only thing to prove is that no client could call one.
  v_internal constant text[] := array[
    'farmer_broadcast_change',
    'farmer_messages_broadcast',
    'farmer_credit_requests_broadcast',
    'farmer_visit_requests_broadcast',
    'push_deliveries_dispatch_now'
  ];
  v_fn  record;
  v_sig text;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, n.nspname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_server_only || v_internal)
  LOOP
    v_sig := format('%I.%I(%s)', v_fn.nspname, v_fn.proname,
                    pg_get_function_identity_arguments(v_fn.oid));
    EXECUTE format('revoke all on function %s from public, anon, authenticated', v_sig);
    IF has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0339: % is executable by a client role', v_sig;
    END IF;
  END LOOP;
END;
$acl$;

-- The literal forms the ledger's static reader parses.
REVOKE ALL ON FUNCTION public.farmer_shop_profile(public.shops) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.farmer_variant_is_available(numeric, numeric, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.farmer_realtime_topic(uuid) FROM PUBLIC, anon, authenticated;

-- The farmer doors stay the farmer app's, and stay shut to a signed-in shop session.
REVOKE ALL ON FUNCTION public.farmer_api_shops(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_me(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_thread(text, uuid) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.farmer_api_shops(text) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_products(text, uuid, text, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_me(text) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_thread(text, uuid) TO anon;

-- ── 12. Proofs ────────────────────────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  v_off_boolean boolean;
BEGIN
  -- The three doors are definers with a pinned search_path.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('farmer_api_shops', 'farmer_api_products', 'farmer_api_me', 'farmer_api_thread')
       AND (p.prosecdef = false OR p.proconfig IS NULL)
  ) THEN
    RAISE EXCEPTION '0339: a farmer door is not a definer with a pinned search_path';
  END IF;

  -- A signed-in shop session still cannot call one.
  IF has_function_privilege('authenticated', 'public.farmer_api_products(text, uuid, text, integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.farmer_api_me(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '0339: a signed-in shop session can call a farmer door';
  END IF;

  -- The availability rule is the marketplace rule: a zero-price or empty pack is never sellable,
  -- and an inactive one never is either.
  IF public.farmer_variant_is_available(5, 0, true) THEN
    RAISE EXCEPTION '0339: a zero-price pack is still sellable';
  END IF;
  IF public.farmer_variant_is_available(5, NULL, true) THEN
    RAISE EXCEPTION '0339: an unpriced pack is still sellable';
  END IF;
  IF public.farmer_variant_is_available(0, 100, true) THEN
    RAISE EXCEPTION '0339: an empty pack is still sellable';
  END IF;
  IF public.farmer_variant_is_available(5, 100, false) THEN
    RAISE EXCEPTION '0339: an archived pack is still sellable';
  END IF;
  IF NOT public.farmer_variant_is_available(5, 100, true) THEN
    RAISE EXCEPTION '0339: a stocked, priced, active pack is not sellable';
  END IF;

  -- The catalogue uses that rule rather than its own comparison.
  IF pg_get_functiondef('public.farmer_api_products(text,uuid,text,integer,integer)'::regprocedure)
       NOT LIKE '%farmer_variant_is_available%' THEN
    RAISE EXCEPTION '0339: the farmer catalogue does not use the shared availability rule';
  END IF;

  -- The branch profile is what all three doors answer with, and it does not publish a credential.
  IF pg_get_functiondef('public.farmer_shop_profile(public.shops)'::regprocedure) LIKE '%join_code%' THEN
    RAISE EXCEPTION '0339: the farmer branch profile leaks the shop join code';
  END IF;
  IF pg_get_functiondef('public.farmer_shop_profile(public.shops)'::regprocedure)
       NOT LIKE '%whatsapp_phone%' THEN
    RAISE EXCEPTION '0339: the farmer branch profile has no way to call the shop';
  END IF;

  -- The triggers exist on all three conversation tables.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'farmer_messages_broadcast' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0339: a new message is not broadcast';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'farmer_credit_requests_broadcast' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0339: a credit offer is not broadcast';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'farmer_visit_requests_broadcast' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0339: a visit move is not broadcast';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'push_deliveries_dispatch_now' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0339: a queued push still waits for the minute tick';
  END IF;

  -- The dealer's private topic is authorised by exactly one policy, on the Realtime table only.
  IF to_regclass('realtime.messages') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'realtime' AND tablename = 'messages'
          AND policyname = 'farmer_shop_broadcast'
     ) THEN
    RAISE EXCEPTION '0339: a dealer cannot subscribe to his own shop''s channel';
  END IF;

  -- The conversation tables keep their server-owned shape: RLS on, still no policy.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('farmer_messages', 'farmer_credit_requests', 'farmer_visit_requests')) <> 0 THEN
    RAISE EXCEPTION '0339: a conversation table became client-readable instead of broadcast';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.farmer_messages'::regclass) THEN
    RAISE EXCEPTION '0339: farmer_messages lost RLS';
  END IF;

  -- A credential is still required, and a wrong one is refused before any read.
  v_off_boolean := false;
  BEGIN
    PERFORM public.farmer_api_shops('x');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_AUTHORIZED:%' THEN v_off_boolean := true; ELSE RAISE; END IF;
  END;
  IF NOT v_off_boolean THEN
    RAISE EXCEPTION '0339: the shop directory answered without a credential';
  END IF;
END;
$proof$;
