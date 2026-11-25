-- 0329 — A notification that reaches a pocket.
--
-- WHY. The app already has two notification records: `notifications` (the shop's in-app feed)
-- and `farmer_notifications` (what the shop did, for the farmer app to pull). Both only work
-- while somebody has the app open, which the owner's requirement (2026-11-22) says is not
-- enough: "i want phone push notifications when the app is closed ... not just for this module
-- overall app".
--
-- THE SHAPE. One device registry, one delivery queue, one sender. Nothing here talks to Google:
-- a trigger writes a row describing who should be told and what to say; the `send-push` edge
-- function turns rows into FCM calls and marks them.
--
--   events ──► notifications (in-app, already exists) ──► push_deliveries ──► send-push ──► FCM
--   farmer events ──► notifications + push_deliveries ──► the same sender
--   shop → farmer ──► farmer_notifications (already exists) ──► push_deliveries ──► FCM
--
-- WHY EVERY EVENT FUNNELS THROUGH `notifications`. An employee's sale, a payment, a return, a
-- stock crossing and a farmer's ask should all behave the same way on a locked phone. Writing
-- one trigger on the feed every one of them already writes means a later event gets a push for
-- free instead of needing a second implementation that somebody will forget.
--
-- WHAT IS DELIBERATELY ABSENT: no token is trusted from a caller without resolving who it
-- belongs to (owner session or farmer credential); no delivery is sent by the database (a
-- failed HTTP call must never fail the business write); no cost, supplier or stock figure is
-- ever put in a notification body that a lock screen can show; and nothing is claimed delivered
-- before FCM accepted it.

-- ── 1. The devices ──────────────────────────────────────────────────────────────────────────
-- One row per installation. A token belongs to exactly one recipient — an FCM token registered
-- by a farmer is not also an owner's device, and re-registering the same token moves it rather
-- than duplicating it, which is what happens when the app is reinstalled.
CREATE TABLE IF NOT EXISTS public.push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.users(id) ON DELETE CASCADE,
  farmer_id    uuid REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE CHECK (length(btrim(token)) BETWEEN 16 AND 4096),
  platform     text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  app          text NOT NULL DEFAULT 'owner' CHECK (app IN ('owner', 'farmer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CHECK ((user_id IS NOT NULL) <> (farmer_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS push_devices_user
  ON public.push_devices (user_id) WHERE revoked_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_devices_farmer
  ON public.push_devices (farmer_id) WHERE revoked_at IS NULL AND farmer_id IS NOT NULL;

COMMENT ON TABLE public.push_devices IS
  'One phone per installation: an FCM/APNs token and the account or farmer it belongs to. Written only by register_push_device (owner session) and farmer_api_register_device (farmer credential); read only by the send-push function with the service role.';

-- ── 2. The queue ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.users(id) ON DELETE CASCADE,
  farmer_id   uuid REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 40),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body        text CHECK (body IS NULL OR length(btrim(body)) <= 300),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  attempts    integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error  text,
  CHECK ((user_id IS NOT NULL) <> (farmer_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS push_deliveries_pending
  ON public.push_deliveries (created_at) WHERE sent_at IS NULL;

COMMENT ON TABLE public.push_deliveries IS
  'What should reach a pocket, written in the same transaction as the thing that happened. The send-push function claims unsent rows, sends to every live device of the recipient, and marks sent_at. A failure increments attempts and records why; nothing here is ever claimed delivered before FCM accepted it.';

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_deliveries FROM PUBLIC, anon, authenticated;

-- ── 3. Registration: the owner's phone ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_push_device(
  p_device_token text,
  p_platform     text DEFAULT 'android'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_token    text := NULLIF(btrim(COALESCE(p_device_token, '')), '');
  v_platform text := CASE WHEN p_platform IN ('android', 'ios', 'web') THEN p_platform ELSE 'android' END;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: sign in before registering a phone';
  END IF;
  IF v_token IS NULL OR length(v_token) < 16 THEN
    RAISE EXCEPTION 'VALIDATION: a device token is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid) THEN
    RAISE EXCEPTION 'NOT_FOUND: this account has no profile to attach a phone to';
  END IF;

  INSERT INTO public.push_devices (user_id, token, platform, app)
  VALUES (v_uid, v_token, v_platform, 'owner')
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        farmer_id = NULL,
        platform = EXCLUDED.platform,
        app = 'owner',
        last_seen_at = now(),
        revoked_at = NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_device_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_token text := NULLIF(btrim(COALESCE(p_device_token, '')), '');
BEGIN
  IF v_uid IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE public.push_devices
     SET revoked_at = now()
   WHERE token = v_token AND user_id = v_uid AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

-- ── 4. Registration: the farmer's phone ────────────────────────────────────────────────────
-- The farmer has no session. The credential he already holds is the only thing that can say
-- which farmer this phone belongs to, so the token is the parameter and the farmer is resolved
-- from it — never supplied by the caller.
CREATE OR REPLACE FUNCTION public.farmer_api_register_device(
  p_token        text,
  p_device_token text,
  p_platform     text DEFAULT 'android'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer   uuid := public.farmer_by_token(p_token);
  v_device   text := NULLIF(btrim(COALESCE(p_device_token, '')), '');
  v_platform text := CASE WHEN p_platform IN ('android', 'ios', 'web') THEN p_platform ELSE 'android' END;
BEGIN
  IF v_device IS NULL OR length(v_device) < 16 THEN
    RAISE EXCEPTION 'VALIDATION: a device token is required';
  END IF;

  INSERT INTO public.push_devices (farmer_id, token, platform, app)
  VALUES (v_farmer, v_device, v_platform, 'farmer')
  ON CONFLICT (token) DO UPDATE
    SET farmer_id = EXCLUDED.farmer_id,
        user_id = NULL,
        platform = EXCLUDED.platform,
        app = 'farmer',
        last_seen_at = now(),
        revoked_at = NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_api_register_device(text, text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.farmer_api_register_device(text, text, text) TO anon;

-- ── 5. The one rule: an in-app notification becomes a queued push ──────────────────────────
-- Recipients are the account's owners (and co-owners) in the notification's own shop. This is
-- the same population the Notifications screen is written for, so a phone can never be told
-- something the app itself would not show that person.
CREATE OR REPLACE FUNCTION public.push_enqueue_shop_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_route text;
BEGIN
  IF NEW.shop_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_route := CASE
    WHEN NEW.entity_type = 'marketplace_farmer' AND NEW.entity_id IS NOT NULL
      THEN '/admin/messages/' || NEW.entity_id::text
    WHEN NEW.kind = 'sale' AND NEW.entity_id IS NOT NULL
      THEN '/admin/sales/' || NEW.entity_id::text
    ELSE '/admin/notifications'
  END;

  INSERT INTO public.push_deliveries (user_id, kind, title, body, data)
  SELECT m.user_id,
         NEW.kind,
         NEW.title,
         COALESCE(NULLIF(btrim(COALESCE(NEW.body, NEW.message, '')), ''), NULL),
         jsonb_build_object('route', v_route, 'notification_id', NEW.id)
    FROM public.memberships m
   WHERE m.tenant_id = NEW.shop_id
     AND m.status = 'active'
     -- Compared as text on purpose: `membership_role` is an enum and a shop that stores a
     -- co-owner value this database does not know (a hosted enum can be ahead of a replay)
     -- must not make the whole business write fail. This exact comparison once did.
     AND m.role::text IN ('owner', 'admin', 'co_owner')
     -- Never push somebody about their own tap. A payment the owner just recorded, or a
     -- reply they just sent from this phone, is already on their screen; a banner for it
     -- teaches them to dismiss the ones that matter.
     AND (NEW.actor_id IS NULL OR m.user_id <> NEW.actor_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_enqueue_push ON public.notifications;
CREATE TRIGGER notifications_enqueue_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_enqueue_shop_notification();

-- ── 6. Farmer → shop: the conversation becomes the shop's notification ─────────────────────
-- One row per farmer action, classified from the message the contract already writes. The
-- credit request and the accept/decline answer each write exactly one message, so this produces
-- one notification for one act — never a "new message" beside a "new request" for the same tap.
CREATE OR REPLACE FUNCTION public.farmer_message_notify_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name  text;
  v_kind  text;
  v_title text;
  v_body  text;
BEGIN
  IF NEW.direction <> 'farmer' THEN
    RETURN NEW;
  END IF;

  -- The visit RPC writes the ask twice on purpose: the request row (which is what the shop
  -- schedules) and a line in the conversation (which is what the farmer and the owner read).
  -- The request row already notifies through `farmer_visit_notify_shop`, so this echo must not
  -- become a second banner for the same tap.
  IF NEW.body LIKE 'Field visit requested:%' THEN
    RETURN NEW;
  END IF;

  SELECT f.name INTO v_name FROM public.marketplace_farmers f WHERE f.id = NEW.farmer_id;
  v_name := COALESCE(v_name, 'A farmer');
  v_body := left(NEW.body, 180);

  IF NEW.body LIKE 'Credit request:%' THEN
    v_kind := 'farmer_credit';
    v_title := 'Credit request from ' || v_name;
  ELSIF NEW.body LIKE 'Accepted the offer%' THEN
    v_kind := 'farmer_accepted';
    v_title := v_name || ' accepted your offer';
  ELSIF NEW.body LIKE 'Declined the offer%' THEN
    v_kind := 'farmer_declined';
    v_title := v_name || ' declined your offer';
  ELSIF NEW.body LIKE 'Joined the shop from the shop code.%' THEN
    v_kind := 'farmer_joined';
    v_title := v_name || ' joined your shop';
  ELSE
    v_kind := 'farmer_message';
    v_title := 'New message from ' || v_name;
  END IF;

  INSERT INTO public.notifications
    (kind, title, message, body, shop_id, entity_type, entity_id, actor_name)
  VALUES
    (v_kind, v_title, v_body, v_body, NEW.shop_id, 'marketplace_farmer', NEW.farmer_id, v_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_message_notifies_shop ON public.farmer_messages;
CREATE TRIGGER farmer_message_notifies_shop
  AFTER INSERT ON public.farmer_messages
  FOR EACH ROW EXECUTE FUNCTION public.farmer_message_notify_shop();

-- A visit ask writes a request row and a timeline event, not a message; it needs its own line.
CREATE OR REPLACE FUNCTION public.farmer_visit_notify_shop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  IF NEW.status <> 'requested' THEN
    RETURN NEW;
  END IF;

  SELECT f.name INTO v_name FROM public.marketplace_farmers f WHERE f.id = NEW.farmer_id;
  v_name := COALESCE(v_name, 'A farmer');

  INSERT INTO public.notifications
    (kind, title, message, body, shop_id, entity_type, entity_id, actor_name)
  VALUES
    ('farmer_visit', v_name || ' asked for a field visit', left(NEW.purpose, 180),
     left(NEW.purpose, 180), NEW.shop_id, 'marketplace_farmer', NEW.farmer_id, v_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_visit_notifies_shop ON public.farmer_visit_requests;
CREATE TRIGGER farmer_visit_notifies_shop
  AFTER INSERT ON public.farmer_visit_requests
  FOR EACH ROW EXECUTE FUNCTION public.farmer_visit_notify_shop();

-- ── 7. An employee's sale reaches the owner ────────────────────────────────────────────────
-- Only when the seller is somebody other than the shop's owner: the owner does not need a push
-- about their own sale, and a sale with no employee recorded is the owner's own counter.
CREATE OR REPLACE FUNCTION public.sale_notify_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_name  text;
BEGIN
  SELECT s.owner_id INTO v_owner FROM public.shops s WHERE s.id = NEW.shop_id;
  IF NEW.employee_id IS NULL OR (v_owner IS NOT NULL AND NEW.employee_id = v_owner) THEN
    RETURN NEW;
  END IF;

  v_name := COALESCE(NULLIF(btrim(COALESCE(NEW.employee_name, '')), ''), 'An employee');

  INSERT INTO public.notifications
    (kind, title, message, body, shop_id, branch_id, entity_type, entity_id, actor_name)
  VALUES
    ('sale', v_name || ' made a sale', 'Rs ' || to_char(NEW.total_amount, 'FM999999999990.00'),
     'Sale ' || NEW.sale_number || ' · Rs ' || to_char(NEW.total_amount, 'FM999999999990.00'),
     NEW.shop_id, NEW.branch_id, 'sale', NEW.id, v_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_notify_owner ON public.sales;
CREATE TRIGGER sales_notify_owner
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.sale_notify_owner();

-- ── 8. Shop → farmer: the existing outbox becomes a push ───────────────────────────────────
-- `0327` already writes exactly what the farmer must learn (a reply, an offer, a visit move).
-- This trigger only queues the same row for delivery; it does not create a second copy.
CREATE OR REPLACE FUNCTION public.farmer_notification_enqueue_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.push_deliveries (farmer_id, kind, title, body, data)
  VALUES (
    NEW.farmer_id,
    NEW.kind,
    NEW.title,
    COALESCE(NEW.body, NULL),
    COALESCE(NEW.payload, '{}'::jsonb) || jsonb_build_object('route', '/', 'notification_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_notification_queues_push ON public.farmer_notifications;
CREATE TRIGGER farmer_notification_queues_push
  AFTER INSERT ON public.farmer_notifications
  FOR EACH ROW EXECUTE FUNCTION public.farmer_notification_enqueue_push();

-- ── 9. Prove the doors ─────────────────────────────────────────────────────────────────────
DO $proof$
BEGIN
  IF has_table_privilege('anon', 'public.push_devices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'SELECT') THEN
    RAISE EXCEPTION 'device tokens and the delivery queue must stay server-only';
  END IF;

  IF NOT has_function_privilege('anon', 'public.farmer_api_register_device(text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the farmer app must be able to register its own phone';
  END IF;
  IF has_function_privilege('anon', 'public.register_push_device(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'an owner device must require a signed-in session';
  END IF;
  IF has_function_privilege('authenticated', 'public.register_push_device(text, text)', 'EXECUTE') = false THEN
    RAISE EXCEPTION 'the owner app must be able to register its phone';
  END IF;
END;
$proof$;
