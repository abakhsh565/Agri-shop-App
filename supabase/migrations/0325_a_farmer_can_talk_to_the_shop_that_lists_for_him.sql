-- 0325 — A farmer can talk to the shop, and the shop can answer.
--
-- WHY THIS EXISTS. The marketplace (0184–0187) answers "what is listed, where, at what price".
-- It deliberately answers nothing else: no ordering, no chat, no credit, no visits. The owner's
-- next requirement is the other half — a farmer asks this shop for stock on credit, or asks for a
-- field officer to come to his farm, and the two sides talk about it. The Messages tab already
-- exists as an empty stub (`AdminMessagesPage`), built for exactly this, so the surface is not
-- being invented here; the server behind it is.
--
-- THE PHONE IS THE IDENTITY. A farmer is not a `users` row and never becomes one: he has no PIN,
-- no shop membership and no permission to see anything else. He is a phone number, a name, and
-- optionally the place he farms. The same number the owner already WhatsApps is the number this
-- contract keys on, which is what lets a manual WhatsApp message and an app message be the same
-- conversation.
--
-- THE WHATSAPP MIRROR, STATED EXACTLY. The owner still sends by tapping WhatsApp; that does not
-- change. What changes is that the send is RECORDED: `send_farmer_message(p_via => 'whatsapp')`
-- writes the same text into the thread, and when the farmer has opened the farmer app the row is
-- immediately readable there (`delivered_to_app_at`). One message, two doors. A send through the
-- app is refused when the farmer has no token, because a message nobody can read is not a
-- delivery — the screen then offers WhatsApp instead.
--
-- WHY TOKENS ARE HASHED. The farmer app authenticates with a per-farmer token, not with a shop
-- session and not with the service role. Only the sha256 of the token is stored (the
-- `0286` recovery-key pattern); the plaintext is returned once, by `issue_farmer_app_token`, and
-- is never readable again. Revoking is a column, not a delete, so an audit trail survives.
--
-- WHAT IS DELIBERATELY NOT INVENTED:
--   * No push, no scheduler. Nothing is claimed to have been delivered by WhatsApp: the app
--     records that the owner sent it and opens the composer; the farmer app reads what is stored.
--   * No credit approval. A request carries the farmer's ask and the owner's offer; the owner
--     changes the terms and the farmer accepts or declines. No ledger row, no limit change and no
--     sale is written by this contract — `create_sale` remains the only way money moves.
--   * No officer tracking. A visit is a request, an assignment and a timeline. Location tracking
--     of employees is not in scope and is not implied.
--   * No second customer. `customers` is the shop's credit book and is never written from here;
--     these screens are not linked to a customer profile by design.

-- ── 0. Phone normalisation, in one place ─────────────────────────────────────────────────────
-- `users.phone` and `customers.phone` already carry Pakistani numbers in several shapes. A farmer
-- is matched against the number the owner actually typed, so the shape has to collapse before the
-- lookup, not after it. 0300… → 92300…, bare 300… → 92300…, and everything else keeps its digits.
CREATE OR REPLACE FUNCTION public.farmer_phone_key(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_phone IS NULL THEN NULL
    WHEN length(regexp_replace(p_phone, '[^0-9]', '', 'g')) = 0 THEN NULL
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') LIKE '0092%'
      THEN '92' || substr(regexp_replace(p_phone, '[^0-9]', '', 'g'), 5)
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') LIKE '92%'
      THEN regexp_replace(p_phone, '[^0-9]', '', 'g')
    WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') LIKE '0%'
      THEN '92' || substr(regexp_replace(p_phone, '[^0-9]', '', 'g'), 2)
    ELSE '92' || regexp_replace(p_phone, '[^0-9]', '', 'g')
  END;
$$;

COMMENT ON FUNCTION public.farmer_phone_key(text) IS
  'The one normal form for a farmer phone: digits only, 92 prefix, no plus. Used by every lookup so 0300…, +92300… and 92300… are one farmer.';

-- ── 1. The farmer himself ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_farmers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_key   text NOT NULL CHECK (phone_key ~ '^92[0-9]{9,11}$'),
  phone       text NOT NULL,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  village     text CHECK (village IS NULL OR length(btrim(village)) <= 120),
  latitude    numeric(9, 6) CHECK (latitude IS NULL OR latitude BETWEEN 23 AND 38),
  longitude   numeric(9, 6) CHECK (longitude IS NULL OR longitude BETWEEN 60 AND 79),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_key)
);

COMMENT ON TABLE public.marketplace_farmers IS
  'One farmer, identified by his phone in normal form. Not a user, not a customer, not a membership: he holds no session and no permission. Read by the owner screens through list_farmer_threads, and by the farmer app through the token RPCs.';

-- ── 2. The shop's side of the relationship ───────────────────────────────────────────────────
-- One row per (shop, farmer). `owner_last_read_at` / `farmer_last_read_at` are the whole unread
-- mechanism: a count is derived, never stored, so it cannot drift from the messages it counts.
CREATE TABLE IF NOT EXISTS public.marketplace_farmer_links (
  shop_id             uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  farmer_id           uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  whatsapp_opted_in   boolean NOT NULL DEFAULT true,
  owner_last_read_at  timestamptz,
  farmer_last_read_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, farmer_id)
);

COMMENT ON TABLE public.marketplace_farmer_links IS
  'The shop ↔ farmer relationship. Created when the owner adds a farmer, or the first time a farmer writes to the shop from the app. Carries the two read watermarks the unread counts are derived from.';

-- ── 3. Farmer app tokens ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_farmer_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id   uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  issued_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  last_used_at timestamptz,
  revoked_at  timestamptz
);

-- One live token per farmer: issuing a new one is a rotation, done in the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_farmer_tokens_one_live
  ON public.marketplace_farmer_tokens (farmer_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.marketplace_farmer_tokens IS
  'A farmer app credential, stored only as a sha256 hash. The plaintext is returned once by issue_farmer_app_token and never selectable again. Revocation is revoked_at, never a delete.';

-- ── 4. The conversation ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farmer_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  farmer_id          uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  direction          text NOT NULL CHECK (direction IN ('owner', 'farmer')),
  channel            text NOT NULL CHECK (channel IN ('app', 'whatsapp')),
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  sent_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  delivered_to_app_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS farmer_messages_thread
  ON public.farmer_messages (shop_id, farmer_id, created_at DESC);

COMMENT ON TABLE public.farmer_messages IS
  'One thread per (shop, farmer). `channel` says how the owner sent it — app or the WhatsApp composer — and `delivered_to_app_at` says whether the farmer app can already read it. A WhatsApp send to a registered farmer is the same row, which is the mirror.';

-- ── 5. Credit requests: the farmer asks, the owner offers, the farmer answers ────────────────
CREATE TABLE IF NOT EXISTS public.farmer_credit_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id        uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  farmer_id        uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'submitted'
                     CHECK (status IN ('submitted', 'offer_sent', 'accepted', 'declined', 'cancelled')),
  requested_amount numeric(14, 2) CHECK (requested_amount IS NULL OR requested_amount > 0),
  requested_note   text CHECK (requested_note IS NULL OR length(btrim(requested_note)) <= 1000),
  offer_lines      jsonb CHECK (offer_lines IS NULL OR jsonb_typeof(offer_lines) = 'array'),
  offer_total      numeric(14, 2) CHECK (offer_total IS NULL OR offer_total > 0),
  offer_due_on     date,
  offer_note       text CHECK (offer_note IS NULL OR length(btrim(offer_note)) <= 1000),
  revision         integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS farmer_credit_requests_open
  ON public.farmer_credit_requests (shop_id, status, created_at DESC);

COMMENT ON TABLE public.farmer_credit_requests IS
  'A farmer asks for stock on credit; the owner rewrites the terms and sends them back; the farmer accepts or declines. The revision counter is the owner-side edit history. Nothing here moves money or stock: create_sale remains the only writer of a credit sale.';

-- ── 6. Field visits: the farmer asks, the owner schedules, three parties update ──────────────
CREATE TABLE IF NOT EXISTS public.farmer_visit_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  branch_id        uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  farmer_id        uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  purpose          text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 500),
  preferred_window text CHECK (preferred_window IS NULL OR length(btrim(preferred_window)) <= 200),
  assigned_to      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scheduled_for    timestamptz,
  owner_note       text CHECK (owner_note IS NULL OR length(btrim(owner_note)) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS farmer_visits_open
  ON public.farmer_visit_requests (shop_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.farmer_visit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      uuid NOT NULL REFERENCES public.farmer_visit_requests(id) ON DELETE CASCADE,
  actor         text NOT NULL CHECK (actor IN ('farmer', 'owner', 'officer')),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status        text NOT NULL CHECK (status IN ('requested', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  note          text CHECK (note IS NULL OR length(btrim(note)) <= 500),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS farmer_visit_events_timeline
  ON public.farmer_visit_events (visit_id, created_at);

COMMENT ON TABLE public.farmer_visit_requests IS
  'One field-visit request: what the farmer wants, the owner''s chosen time and officer, and the current state. The timeline lives in farmer_visit_events, so all three parties append to one record instead of overwriting a status column with no history.';

-- ── 7. Server-owned tables ───────────────────────────────────────────────────────────────────
-- No client reads or writes these directly. Every access path is a SECURITY DEFINER function
-- below, which is where the shop scope and the farmer token are checked. A direct PostgREST call
-- answers `permission denied`, so the screens cannot accidentally become the security boundary.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketplace_farmers', 'marketplace_farmer_links', 'marketplace_farmer_tokens',
    'farmer_messages', 'farmer_credit_requests', 'farmer_visit_requests', 'farmer_visit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END;
$$;

-- ── 8. Who is calling? Two answers, never mixed ─────────────────────────────────────────────
-- Owner side: the working membership, exactly as 0256 reads it.
CREATE OR REPLACE FUNCTION public.owner_membership_for_farmers()
RETURNS public.memberships
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_member public.memberships;
BEGIN
  SELECT * INTO v_member FROM public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  RETURN v_member;
END;
$$;

-- Farmer side: a token, hashed and looked up. Never granted to a client — only the token RPCs
-- below call it, and they are the only functions anon may execute.
CREATE OR REPLACE FUNCTION public.farmer_by_token(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash   text;
  v_farmer uuid;
BEGIN
  IF p_token IS NULL OR length(btrim(p_token)) < 20 THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: a farmer token is required';
  END IF;
  v_hash := encode(extensions.digest(btrim(p_token), 'sha256'), 'hex');
  SELECT t.farmer_id INTO v_farmer
    FROM public.marketplace_farmer_tokens t
   WHERE t.token_hash = v_hash AND t.revoked_at IS NULL;
  IF v_farmer IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: that farmer token is not valid';
  END IF;
  UPDATE public.marketplace_farmer_tokens
     SET last_used_at = now()
   WHERE token_hash = v_hash AND revoked_at IS NULL;
  RETURN v_farmer;
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_by_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_membership_for_farmers() FROM PUBLIC, anon, authenticated;

-- The shop a farmer is talking to. Explicit when he deals with several, resolved when there is
-- exactly one — never guessed when there are none.
CREATE OR REPLACE FUNCTION public.farmer_shop_scope(p_farmer uuid, p_shop uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_shop uuid;
BEGIN
  IF p_shop IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.marketplace_farmer_links l
                    WHERE l.farmer_id = p_farmer AND l.shop_id = p_shop) THEN
      RAISE EXCEPTION 'NOT_FOUND: this farmer is not linked to that shop';
    END IF;
    RETURN p_shop;
  END IF;
  SELECT l.shop_id INTO v_shop
    FROM public.marketplace_farmer_links l
   WHERE l.farmer_id = p_farmer
   ORDER BY l.created_at
   LIMIT 2;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: this farmer is not linked to any shop yet';
  END IF;
  IF (SELECT count(*) FROM public.marketplace_farmer_links l WHERE l.farmer_id = p_farmer) > 1 THEN
    RAISE EXCEPTION 'VALIDATION: this farmer deals with more than one shop — name the shop';
  END IF;
  RETURN v_shop;
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_shop_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 9. Owner side: the thread list, the thread, and sending ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_farmer_threads(p_search text DEFAULT NULL)
RETURNS TABLE (
  farmer_id       uuid,
  name            text,
  phone           text,
  village         text,
  app_ready       boolean,
  last_message    text,
  last_message_at timestamptz,
  unread_count    integer,
  open_requests   integer,
  open_visits     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_q      text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_key    text;
BEGIN
  v_member := public.owner_membership_for_farmers();
  v_key := CASE WHEN v_q IS NULL THEN NULL ELSE public.farmer_phone_key(v_q) END;

  RETURN QUERY
  SELECT
    f.id,
    f.name,
    f.phone,
    f.village,
    EXISTS (SELECT 1 FROM public.marketplace_farmer_tokens t
             WHERE t.farmer_id = f.id AND t.revoked_at IS NULL) AS app_ready,
    (SELECT m.body FROM public.farmer_messages m
      WHERE m.shop_id = v_member.tenant_id AND m.farmer_id = f.id
      ORDER BY m.created_at DESC LIMIT 1) AS last_message,
    (SELECT m.created_at FROM public.farmer_messages m
      WHERE m.shop_id = v_member.tenant_id AND m.farmer_id = f.id
      ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
    (SELECT count(*)::integer FROM public.farmer_messages m
      WHERE m.shop_id = v_member.tenant_id AND m.farmer_id = f.id
        AND m.direction = 'farmer'
        AND m.created_at > COALESCE(l.owner_last_read_at, TIMESTAMPTZ '1970-01-01')) AS unread_count,
    (SELECT count(*)::integer FROM public.farmer_credit_requests r
      WHERE r.shop_id = v_member.tenant_id AND r.farmer_id = f.id
        AND r.status IN ('submitted', 'offer_sent')) AS open_requests,
    (SELECT count(*)::integer FROM public.farmer_visit_requests v
      WHERE v.shop_id = v_member.tenant_id AND v.farmer_id = f.id
        AND v.status IN ('requested', 'scheduled', 'in_progress')) AS open_visits
  FROM public.marketplace_farmer_links l
  JOIN public.marketplace_farmers f ON f.id = l.farmer_id
  WHERE l.shop_id = v_member.tenant_id
    AND (
      v_q IS NULL
      OR f.name ILIKE '%' || v_q || '%'
      OR f.village ILIKE '%' || v_q || '%'
      OR (v_key IS NOT NULL AND f.phone_key = v_key)
      OR f.phone ILIKE '%' || v_q || '%'
    )
  ORDER BY COALESCE(
    (SELECT m.created_at FROM public.farmer_messages m
      WHERE m.shop_id = v_member.tenant_id AND m.farmer_id = f.id
      ORDER BY m.created_at DESC LIMIT 1),
    l.created_at
  ) DESC;
END;
$$;

COMMENT ON FUNCTION public.list_farmer_threads(text) IS
  'The Messages tab: every farmer linked to the working shop, newest conversation first, with a derived unread count and the open request/visit counts. Search matches name, village and the normalised phone.';

REVOKE ALL ON FUNCTION public.list_farmer_threads(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_farmer_threads(text) TO authenticated;

-- One transaction's worth of truth for one thread.
CREATE OR REPLACE FUNCTION public.get_farmer_thread(p_farmer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_farmer  public.marketplace_farmers;
  v_link    public.marketplace_farmer_links;
BEGIN
  v_member := public.owner_membership_for_farmers();

  SELECT f.* INTO v_farmer
    FROM public.marketplace_farmers f
    JOIN public.marketplace_farmer_links l ON l.farmer_id = f.id
   WHERE l.shop_id = v_member.tenant_id AND f.id = p_farmer_id;
  IF v_farmer.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that farmer is not linked to this shop';
  END IF;

  SELECT * INTO v_link FROM public.marketplace_farmer_links l
   WHERE l.shop_id = v_member.tenant_id AND l.farmer_id = p_farmer_id;

  RETURN jsonb_build_object(
    'farmer', jsonb_build_object(
      'id', v_farmer.id,
      'name', v_farmer.name,
      'phone', v_farmer.phone,
      'village', v_farmer.village,
      'latitude', v_farmer.latitude,
      'longitude', v_farmer.longitude,
      'app_ready', EXISTS (SELECT 1 FROM public.marketplace_farmer_tokens t
                            WHERE t.farmer_id = v_farmer.id AND t.revoked_at IS NULL),
      'whatsapp_opted_in', v_link.whatsapp_opted_in,
      'since', v_link.created_at
    ),
    'messages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'direction', m.direction, 'channel', m.channel,
               'body', m.body, 'delivered_to_app_at', m.delivered_to_app_at,
               'created_at', m.created_at
             ) ORDER BY m.created_at)
        FROM (SELECT * FROM public.farmer_messages
               WHERE shop_id = v_member.tenant_id AND farmer_id = p_farmer_id
               ORDER BY created_at DESC LIMIT 200) m
    ), '[]'::jsonb),
    'requests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status, 'requested_amount', r.requested_amount,
               'requested_note', r.requested_note, 'offer_lines', r.offer_lines,
               'offer_total', r.offer_total, 'offer_due_on', r.offer_due_on,
               'offer_note', r.offer_note, 'revision', r.revision,
               'created_at', r.created_at, 'decided_at', r.decided_at
             ) ORDER BY r.created_at DESC)
        FROM public.farmer_credit_requests r
       WHERE r.shop_id = v_member.tenant_id AND r.farmer_id = p_farmer_id
    ), '[]'::jsonb),
    'visits', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id, 'status', v.status, 'purpose', v.purpose,
               'preferred_window', v.preferred_window,
               'assigned_to', v.assigned_to,
               'assigned_name', (SELECT u.name FROM public.users u WHERE u.id = v.assigned_to),
               'scheduled_for', v.scheduled_for, 'owner_note', v.owner_note,
               'created_at', v.created_at,
               'timeline', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'status', e.status, 'actor', e.actor, 'note', e.note,
                          'created_at', e.created_at) ORDER BY e.created_at)
                   FROM public.farmer_visit_events e WHERE e.visit_id = v.id
               ), '[]'::jsonb)
             ) ORDER BY v.created_at DESC)
        FROM public.farmer_visit_requests v
       WHERE v.shop_id = v_member.tenant_id AND v.farmer_id = p_farmer_id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_farmer_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_farmer_thread(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_farmer_thread_read(p_farmer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_member public.memberships;
BEGIN
  v_member := public.owner_membership_for_farmers();
  UPDATE public.marketplace_farmer_links l
     SET owner_last_read_at = now()
   WHERE l.shop_id = v_member.tenant_id AND l.farmer_id = p_farmer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: that farmer is not linked to this shop';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_farmer_thread_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_farmer_thread_read(uuid) TO authenticated;

/**
 * Send one message, and say honestly where it went.
 *
 * `p_via = 'whatsapp'` is the owner's existing habit: the screen opens the WhatsApp composer with
 * this text, and this row is what makes the same text visible in the farmer app when the farmer
 * has one. `p_via = 'app'` is refused without a live token — a message into a room nobody can
 * open is not a delivery.
 */
CREATE OR REPLACE FUNCTION public.send_farmer_message(
  p_farmer_id uuid,
  p_body      text,
  p_via       text DEFAULT 'app'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member    public.memberships;
  v_via       text := COALESCE(NULLIF(btrim(COALESCE(p_via, '')), ''), 'app');
  v_app_ready boolean;
  v_id        uuid;
BEGIN
  v_member := public.owner_membership_for_farmers();

  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: a message needs something in it';
  END IF;
  IF length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'VALIDATION: a message is at most 2000 characters';
  END IF;
  IF v_via NOT IN ('app', 'whatsapp') THEN
    RAISE EXCEPTION 'VALIDATION: expected app or whatsapp';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_farmer_links l
                  WHERE l.shop_id = v_member.tenant_id AND l.farmer_id = p_farmer_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: that farmer is not linked to this shop';
  END IF;

  v_app_ready := EXISTS (SELECT 1 FROM public.marketplace_farmer_tokens t
                          WHERE t.farmer_id = p_farmer_id AND t.revoked_at IS NULL);

  IF v_via = 'app' AND NOT v_app_ready THEN
    RAISE EXCEPTION 'VALIDATION: this farmer has not opened the farmer app — send on WhatsApp instead';
  END IF;

  INSERT INTO public.farmer_messages (
    shop_id, farmer_id, direction, channel, body, sent_by, delivered_to_app_at
  ) VALUES (
    v_member.tenant_id, p_farmer_id, 'owner', v_via, btrim(p_body), v_member.user_id,
    CASE WHEN v_app_ready THEN now() ELSE NULL END
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'delivered_to_app', v_app_ready,
    'channel', v_via
  );
END;
$$;

COMMENT ON FUNCTION public.send_farmer_message(uuid, text, text) IS
  'Records one owner message in the thread. whatsapp is the manual send the owner already does (and is mirrored into the farmer app when a token exists); app is refused without a token.';

REVOKE ALL ON FUNCTION public.send_farmer_message(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_farmer_message(uuid, text, text) TO authenticated;

/**
 * Add a farmer the owner already talks to on WhatsApp.
 *
 * This is the door that makes the mirror possible: the number is normalised and kept as the
 * identity, so the next WhatsApp send to that number is a thread the app knows.
 */
CREATE OR REPLACE FUNCTION public.register_farmer(
  p_phone   text,
  p_name    text,
  p_village text    DEFAULT NULL,
  p_lat     numeric DEFAULT NULL,
  p_lng     numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_key    text := public.farmer_phone_key(p_phone);
  v_farmer public.marketplace_farmers;
BEGIN
  v_member := public.owner_membership_for_farmers();

  IF v_key IS NULL OR v_key !~ '^92[0-9]{9,11}$' THEN
    RAISE EXCEPTION 'VALIDATION: that phone number is not a usable Pakistani mobile number';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'VALIDATION: a farmer needs a name';
  END IF;

  INSERT INTO public.marketplace_farmers (phone_key, phone, name, village, latitude, longitude)
  VALUES (v_key, btrim(p_phone), btrim(p_name), NULLIF(btrim(COALESCE(p_village, '')), ''), p_lat, p_lng)
  ON CONFLICT (phone_key) DO UPDATE
    SET name = EXCLUDED.name,
        village = COALESCE(EXCLUDED.village, public.marketplace_farmers.village),
        latitude = COALESCE(EXCLUDED.latitude, public.marketplace_farmers.latitude),
        longitude = COALESCE(EXCLUDED.longitude, public.marketplace_farmers.longitude),
        updated_at = now()
  RETURNING * INTO v_farmer;

  INSERT INTO public.marketplace_farmer_links (shop_id, farmer_id)
  VALUES (v_member.tenant_id, v_farmer.id)
  ON CONFLICT (shop_id, farmer_id) DO NOTHING;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, tenant_id, details)
  VALUES (v_member.user_id, 'farmer_registered', 'marketplace_farmer', v_farmer.id,
          v_member.tenant_id, jsonb_build_object('phone_key', v_key));

  RETURN jsonb_build_object('id', v_farmer.id, 'name', v_farmer.name, 'phone', v_farmer.phone);
END;
$$;

REVOKE ALL ON FUNCTION public.register_farmer(text, text, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_farmer(text, text, text, numeric, numeric) TO authenticated;

/**
 * Issue (or rotate) the farmer's app token. The plaintext is returned exactly once.
 *
 * 32 random bytes from the database, stored as sha256. The owner shows it to the farmer, the
 * farmer app stores it, and this function is the only place it ever exists in the clear.
 */
CREATE OR REPLACE FUNCTION public.issue_farmer_app_token(p_farmer_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_token  text;
BEGIN
  v_member := public.owner_membership_for_farmers();

  IF NOT EXISTS (SELECT 1 FROM public.marketplace_farmer_links l
                  WHERE l.shop_id = v_member.tenant_id AND l.farmer_id = p_farmer_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: that farmer is not linked to this shop';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.marketplace_farmer_tokens
     SET revoked_at = now()
   WHERE farmer_id = p_farmer_id AND revoked_at IS NULL;

  INSERT INTO public.marketplace_farmer_tokens (farmer_id, token_hash, issued_by)
  VALUES (p_farmer_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_member.user_id);

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, tenant_id, details)
  VALUES (v_member.user_id, 'farmer_token_issued', 'marketplace_farmer', p_farmer_id,
          v_member.tenant_id, '{}'::jsonb);

  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_farmer_app_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_farmer_app_token(uuid) TO authenticated;

-- Who can be sent to a farm. Active employees of this shop, nothing else.
CREATE OR REPLACE FUNCTION public.list_assignable_officers()
RETURNS TABLE (user_id uuid, name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_member public.memberships;
BEGIN
  v_member := public.owner_membership_for_farmers();
  RETURN QUERY
  SELECT u.id, u.name, m.role::text
    FROM public.memberships m
    JOIN public.users u ON u.id = m.user_id
   WHERE m.tenant_id = v_member.tenant_id
     AND m.status = 'active'
     AND u.is_active
   ORDER BY u.name;
END;
$$;

REVOKE ALL ON FUNCTION public.list_assignable_officers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_assignable_officers() TO authenticated;

-- ── 10. Owner side: changing the terms, and the visit ────────────────────────────────────────
/**
 * Rewrite a farmer's ask into an offer. The owner-side edit is the whole point: the farmer sent a
 * number and a note, and what comes back is a set of lines, a total, a date and a remark.
 * `revision` counts how many times the terms were rewritten.
 */
CREATE OR REPLACE FUNCTION public.revise_farmer_credit_request(
  p_request_id uuid,
  p_lines      jsonb,
  p_total      numeric,
  p_due_on     date    DEFAULT NULL,
  p_note       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_request public.farmer_credit_requests;
BEGIN
  v_member := public.owner_membership_for_farmers();

  SELECT * INTO v_request FROM public.farmer_credit_requests r
   WHERE r.id = p_request_id AND r.shop_id = v_member.tenant_id;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that request is not part of this business';
  END IF;
  IF v_request.status NOT IN ('submitted', 'offer_sent') THEN
    RAISE EXCEPTION 'VALIDATION: that request is already %', v_request.status;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'VALIDATION: an offer needs at least one line';
  END IF;
  IF p_total IS NULL OR p_total <= 0 THEN
    RAISE EXCEPTION 'VALIDATION: an offer needs a total above zero';
  END IF;

  UPDATE public.farmer_credit_requests r
     SET status = 'offer_sent',
         offer_lines = p_lines,
         offer_total = p_total,
         offer_due_on = p_due_on,
         offer_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
         revision = r.revision + 1,
         updated_at = now()
   WHERE r.id = p_request_id
   RETURNING * INTO v_request;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, tenant_id, details)
  VALUES (v_member.user_id, 'farmer_credit_offer_sent', 'farmer_credit_request', p_request_id,
          v_member.tenant_id,
          jsonb_build_object('revision', v_request.revision, 'total', p_total));

  RETURN jsonb_build_object(
    'id', v_request.id, 'status', v_request.status,
    'revision', v_request.revision, 'offer_total', v_request.offer_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revise_farmer_credit_request(uuid, jsonb, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revise_farmer_credit_request(uuid, jsonb, numeric, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_farmer_credit_request(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.memberships;
  v_request public.farmer_credit_requests;
BEGIN
  v_member := public.owner_membership_for_farmers();

  SELECT * INTO v_request FROM public.farmer_credit_requests r
   WHERE r.id = p_request_id AND r.shop_id = v_member.tenant_id;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that request is not part of this business';
  END IF;
  IF v_request.status IN ('accepted', 'declined', 'cancelled') THEN
    RAISE EXCEPTION 'VALIDATION: that request is already %', v_request.status;
  END IF;

  UPDATE public.farmer_credit_requests r
     SET status = 'cancelled',
         offer_note = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), r.offer_note),
         decided_at = now(),
         updated_at = now()
   WHERE r.id = p_request_id
   RETURNING * INTO v_request;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, tenant_id, details)
  VALUES (v_member.user_id, 'farmer_credit_request_cancelled', 'farmer_credit_request',
          p_request_id, v_member.tenant_id, jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object('id', v_request.id, 'status', v_request.status);
END;
$$;

REVOKE ALL ON FUNCTION public.close_farmer_credit_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_farmer_credit_request(uuid, text) TO authenticated;

/**
 * Put a time and an officer on a visit request.
 *
 * `p_employee_id` must be an ACTIVE member of this shop — assigning an outsider would let one
 * business put a name on another business's farm.
 */
CREATE OR REPLACE FUNCTION public.schedule_farmer_visit(
  p_visit_id    uuid,
  p_employee_id uuid,
  p_scheduled   timestamptz,
  p_note        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_visit  public.farmer_visit_requests;
BEGIN
  v_member := public.owner_membership_for_farmers();

  SELECT * INTO v_visit FROM public.farmer_visit_requests v
   WHERE v.id = p_visit_id AND v.shop_id = v_member.tenant_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that visit is not part of this business';
  END IF;
  IF v_visit.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'VALIDATION: that visit is already %', v_visit.status;
  END IF;
  IF p_scheduled IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: a visit needs a time';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.tenant_id = v_member.tenant_id
       AND m.user_id = p_employee_id
       AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'VALIDATION: that person is not an active member of this business';
  END IF;

  UPDATE public.farmer_visit_requests v
     SET status = 'scheduled',
         assigned_to = p_employee_id,
         scheduled_for = p_scheduled,
         owner_note = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), v.owner_note),
         updated_at = now()
   WHERE v.id = p_visit_id
   RETURNING * INTO v_visit;

  INSERT INTO public.farmer_visit_events (visit_id, actor, actor_user_id, status, note)
  VALUES (p_visit_id, 'owner', v_member.user_id, 'scheduled', v_visit.owner_note);

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, tenant_id, details)
  VALUES (v_member.user_id, 'farmer_visit_scheduled', 'farmer_visit_request', p_visit_id,
          v_member.tenant_id,
          jsonb_build_object('employee_id', p_employee_id, 'scheduled_for', p_scheduled));

  RETURN jsonb_build_object(
    'id', v_visit.id, 'status', v_visit.status,
    'assigned_to', v_visit.assigned_to, 'scheduled_for', v_visit.scheduled_for
  );
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_farmer_visit(uuid, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.schedule_farmer_visit(uuid, uuid, timestamptz, text) TO authenticated;

/**
 * Move a visit along. The owner may move any of his shop's visits; the assigned officer may move
 * his own. An officer may never touch another officer's visit.
 */
CREATE OR REPLACE FUNCTION public.advance_farmer_visit(p_visit_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_visit  public.farmer_visit_requests;
  v_status text := btrim(COALESCE(p_status, ''));
  v_actor  text;
BEGIN
  v_member := public.owner_membership_for_farmers();

  SELECT * INTO v_visit FROM public.farmer_visit_requests v
   WHERE v.id = p_visit_id AND v.shop_id = v_member.tenant_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that visit is not part of this business';
  END IF;
  IF v_status NOT IN ('scheduled', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'VALIDATION: expected scheduled, in_progress, completed or cancelled';
  END IF;

  IF v_visit.assigned_to = v_member.user_id AND v_member.role <> 'owner' THEN
    v_actor := 'officer';
  ELSIF v_member.role IN ('owner', 'admin') THEN
    v_actor := 'owner';
  ELSE
    RAISE EXCEPTION 'NOT_AUTHORIZED: only the owner or the assigned officer moves a visit';
  END IF;

  UPDATE public.farmer_visit_requests v
     SET status = v_status,
         updated_at = now(),
         owner_note = CASE WHEN v_actor = 'owner'
                           THEN COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), v.owner_note)
                           ELSE v.owner_note END
   WHERE v.id = p_visit_id
   RETURNING * INTO v_visit;

  INSERT INTO public.farmer_visit_events (visit_id, actor, actor_user_id, status, note)
  VALUES (p_visit_id, v_actor, v_member.user_id, v_status, NULLIF(btrim(COALESCE(p_note, '')), ''));

  RETURN jsonb_build_object('id', v_visit.id, 'status', v_visit.status, 'actor', v_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_farmer_visit(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_farmer_visit(uuid, text, text) TO authenticated;

-- ── 11. The farmer app: token in, nothing else ──────────────────────────────────────────────
-- These are the only functions anon may execute. Every one of them resolves the farmer FROM THE
-- TOKEN, so a caller cannot name another farmer, another shop's thread, or a request that is not
-- his. The payloads deliberately carry no cost, supplier, stock count or owner identity.
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
    'shops', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'shop_id', l.shop_id,
               'shop_name', (SELECT s.name FROM public.shops s WHERE s.id = l.shop_id)
             ))
        FROM public.marketplace_farmer_links l WHERE l.farmer_id = v_farmer
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_api_thread(p_token text, p_shop_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
BEGIN
  UPDATE public.marketplace_farmer_links l
     SET farmer_last_read_at = now()
   WHERE l.shop_id = v_shop AND l.farmer_id = v_farmer;

  RETURN jsonb_build_object(
    'shop_id', v_shop,
    'shop_name', (SELECT s.name FROM public.shops s WHERE s.id = v_shop),
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

CREATE OR REPLACE FUNCTION public.farmer_api_send_message(p_token text, p_body text, p_shop_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
  v_id     uuid;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) = 0 OR length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'VALIDATION: a message needs 1 to 2000 characters';
  END IF;

  INSERT INTO public.farmer_messages (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
  VALUES (v_shop, v_farmer, 'farmer', 'app', btrim(p_body), now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_api_create_credit_request(
  p_token  text,
  p_amount numeric,
  p_note   text,
  p_shop_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
  v_branch uuid := p_branch_id;
  v_id     uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'VALIDATION: an amount above zero is required';
  END IF;
  IF p_note IS NULL OR btrim(p_note) = '' OR length(btrim(p_note)) > 1000 THEN
    RAISE EXCEPTION 'VALIDATION: say what the credit is for, in up to 1000 characters';
  END IF;

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch FROM public.branches b
     WHERE b.tenant_id = v_shop AND b.is_active
     ORDER BY b.is_default DESC, b.created_at LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: that shop has no branch to serve the request';
  END IF;

  INSERT INTO public.farmer_credit_requests
    (shop_id, branch_id, farmer_id, requested_amount, requested_note)
  VALUES (v_shop, v_branch, v_farmer, p_amount, btrim(p_note))
  RETURNING id INTO v_id;

  -- The request lands in the thread as a message too, so the owner sees it in the place he reads.
  INSERT INTO public.farmer_messages (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
  VALUES (v_shop, v_farmer, 'farmer', 'app',
          'Credit request: Rs ' || to_char(p_amount, 'FM999999999990.00') || ' — ' || btrim(p_note),
          now());

  RETURN jsonb_build_object('id', v_id, 'status', 'submitted');
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_api_answer_offer(
  p_token      text,
  p_request_id uuid,
  p_accept     boolean,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer  uuid := public.farmer_by_token(p_token);
  v_request public.farmer_credit_requests;
  v_status  text;
BEGIN
  SELECT * INTO v_request FROM public.farmer_credit_requests r
   WHERE r.id = p_request_id AND r.farmer_id = v_farmer;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that request is not yours';
  END IF;
  IF v_request.status <> 'offer_sent' THEN
    RAISE EXCEPTION 'VALIDATION: there is no offer waiting for an answer';
  END IF;

  v_status := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;

  UPDATE public.farmer_credit_requests r
     SET status = v_status,
         decided_at = now(),
         updated_at = now(),
         offer_note = COALESCE(r.offer_note, NULLIF(btrim(COALESCE(p_note, '')), ''))
   WHERE r.id = p_request_id
   RETURNING * INTO v_request;

  INSERT INTO public.farmer_messages (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
  VALUES (v_request.shop_id, v_farmer, 'farmer', 'app',
          CASE WHEN p_accept THEN 'Accepted the offer of Rs ' ELSE 'Declined the offer of Rs ' END
            || to_char(v_request.offer_total, 'FM999999999990.00')
            || COALESCE(' — ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''),
          now());

  RETURN jsonb_build_object('id', v_request.id, 'status', v_request.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.farmer_api_request_visit(
  p_token     text,
  p_purpose   text,
  p_window    text DEFAULT NULL,
  p_shop_id   uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   uuid := public.farmer_shop_scope(v_farmer, p_shop_id);
  v_branch uuid := p_branch_id;
  v_id     uuid;
BEGIN
  IF p_purpose IS NULL OR btrim(p_purpose) = '' OR length(btrim(p_purpose)) > 500 THEN
    RAISE EXCEPTION 'VALIDATION: say why the officer should come, in up to 500 characters';
  END IF;
  IF p_window IS NOT NULL AND length(btrim(p_window)) > 200 THEN
    RAISE EXCEPTION 'VALIDATION: the preferred time is at most 200 characters';
  END IF;

  IF v_branch IS NULL THEN
    SELECT b.id INTO v_branch FROM public.branches b
     WHERE b.tenant_id = v_shop AND b.is_active
     ORDER BY b.is_default DESC, b.created_at LIMIT 1;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: that shop has no branch to send an officer from';
  END IF;

  INSERT INTO public.farmer_visit_requests (shop_id, branch_id, farmer_id, purpose, preferred_window)
  VALUES (v_shop, v_branch, v_farmer, btrim(p_purpose), NULLIF(btrim(COALESCE(p_window, '')), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.farmer_visit_events (visit_id, actor, status, note)
  VALUES (v_id, 'farmer', 'requested', btrim(p_purpose));

  INSERT INTO public.farmer_messages (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
  VALUES (v_shop, v_farmer, 'farmer', 'app',
          'Field visit requested: ' || btrim(p_purpose), now());

  RETURN jsonb_build_object('id', v_id, 'status', 'requested');
END;
$$;

-- Farmer-side grants: anon ONLY, and ONLY these four endpoints plus `me`.
REVOKE ALL ON FUNCTION public.farmer_api_me(text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_thread(text, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_send_message(text, text, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_create_credit_request(text, numeric, text, uuid, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_answer_offer(text, uuid, boolean, text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.farmer_api_request_visit(text, text, text, uuid, uuid) FROM PUBLIC, authenticated;

GRANT EXECUTE ON FUNCTION public.farmer_api_me(text) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_thread(text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_send_message(text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_create_credit_request(text, numeric, text, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_answer_offer(text, uuid, boolean, text) TO anon;
GRANT EXECUTE ON FUNCTION public.farmer_api_request_visit(text, text, text, uuid, uuid) TO anon;
