-- 0327 — The request lifecycle, as three parties experience it.
--
-- WHY. `0325` gave the shop a conversation with a farmer, a credit request and a visit request.
-- It gave no way to see, at a glance, which requests are waiting on the OWNER, and it gave the
-- assigned employee no surface at all: an officer could be named in `assigned_to` and never learn
-- of it. The farmer likewise learned of a decision only by reopening the app.
--
-- WHAT THIS ADDS — three readings of the same rows, never a second copy of them:
--   * `list_farmer_actions()`   the owner's queue: what is waiting on him, in one list.
--   * `list_my_farmer_visits()` the employee's queue: the visits assigned to the caller.
--   * `farmer_notifications`    an outbox the farmer app (or its bot) pulls from, written by
--                               triggers on the rows that already changed state.
--
-- WHAT IT DOES NOT DO. No stock, money, customer or membership row is written. The notification
-- outbox is written by triggers inside the same transaction as the change it describes, so a
-- decision that rolls back announces nothing. Nothing here widens a caller set: both list RPCs
-- resolve the caller's membership themselves and are granted to `authenticated` only.

-- ── 1. The farmer's outbox ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farmer_notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  farmer_id    uuid NOT NULL REFERENCES public.marketplace_farmers(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN (
                 'message', 'credit_offer', 'visit_scheduled', 'visit_started',
                 'visit_completed', 'visit_cancelled')),
  title        text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  body         text CHECK (body IS NULL OR length(btrim(body)) <= 500),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS farmer_notifications_pending
  ON public.farmer_notifications (farmer_id, created_at DESC)
  WHERE delivered_at IS NULL;

COMMENT ON TABLE public.farmer_notifications IS
  'What the shop did that the farmer must learn about. Written only by triggers on farmer_credit_requests, farmer_visit_requests and farmer_messages, inside the transaction that made the change; read only through farmer_api_notifications(), which resolves the farmer from his token.';

ALTER TABLE public.farmer_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.farmer_notifications FROM PUBLIC, anon, authenticated;

-- ── 2. The triggers ─────────────────────────────────────────────────────────────────────────
-- An offer is the ONE thing a credit request needs to announce: the farmer's own ask needs no
-- telling, and his answer is visible to the owner in the thread he is reading anyway.
CREATE OR REPLACE FUNCTION public.farmer_notify_credit_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'offer_sent'
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.revision IS DISTINCT FROM OLD.revision) THEN
    INSERT INTO public.farmer_notifications (shop_id, farmer_id, kind, title, body, payload)
    VALUES (
      NEW.shop_id, NEW.farmer_id, 'credit_offer',
      'آپ کی ادھار درخواست کا جواب',
      COALESCE(NEW.offer_note, 'دکان نے شرائط بھیج دی ہیں'),
      jsonb_build_object('request_id', NEW.id, 'total', NEW.offer_total,
                         'due_on', NEW.offer_due_on, 'revision', NEW.revision)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_credit_offer_notifies ON public.farmer_credit_requests;
CREATE TRIGGER farmer_credit_offer_notifies
  AFTER INSERT OR UPDATE OF status, revision ON public.farmer_credit_requests
  FOR EACH ROW EXECUTE FUNCTION public.farmer_notify_credit_offer();

-- A visit changes state four times; the farmer is told about every one of them.
CREATE OR REPLACE FUNCTION public.farmer_notify_visit_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_title text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_kind := CASE NEW.status
              WHEN 'scheduled'   THEN 'visit_scheduled'
              WHEN 'in_progress' THEN 'visit_started'
              WHEN 'completed'   THEN 'visit_completed'
              WHEN 'cancelled'   THEN 'visit_cancelled'
            END;
  IF v_kind IS NULL THEN RETURN NEW; END IF;

  v_title := CASE NEW.status
               WHEN 'scheduled'   THEN 'آپ کے کھیت کا وزٹ طے ہو گیا'
               WHEN 'in_progress' THEN 'افسر آپ کی طرف روانہ ہو گیا'
               WHEN 'completed'   THEN 'کھیت کا وزٹ مکمل ہو گیا'
               WHEN 'cancelled'   THEN 'وزٹ منسوخ ہو گیا'
             END;

  INSERT INTO public.farmer_notifications (shop_id, farmer_id, kind, title, body, payload)
  VALUES (
    NEW.shop_id, NEW.farmer_id, v_kind, v_title,
    COALESCE(NEW.owner_note, NEW.purpose),
    jsonb_build_object('visit_id', NEW.id, 'status', NEW.status,
                       'scheduled_for', NEW.scheduled_for,
                       'officer', (SELECT u.name FROM public.users u WHERE u.id = NEW.assigned_to))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_visit_notifies ON public.farmer_visit_requests;
CREATE TRIGGER farmer_visit_notifies
  AFTER INSERT OR UPDATE OF status ON public.farmer_visit_requests
  FOR EACH ROW EXECUTE FUNCTION public.farmer_notify_visit_change();

-- A reply from the shop, whichever channel carried it. The row already exists; this only makes
-- the farmer app able to say "you have a new message" without polling the thread.
CREATE OR REPLACE FUNCTION public.farmer_notify_owner_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction <> 'owner' THEN RETURN NEW; END IF;
  INSERT INTO public.farmer_notifications (shop_id, farmer_id, kind, title, body, payload)
  VALUES (NEW.shop_id, NEW.farmer_id, 'message', 'دکان کا نیا پیغام', left(NEW.body, 200),
          jsonb_build_object('message_id', NEW.id, 'channel', NEW.channel));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS farmer_message_notifies ON public.farmer_messages;
CREATE TRIGGER farmer_message_notifies
  AFTER INSERT ON public.farmer_messages
  FOR EACH ROW EXECUTE FUNCTION public.farmer_notify_owner_message();

-- ── 3. The owner's queue ────────────────────────────────────────────────────────────────────
-- One row per thing that is genuinely waiting on the owner: an ask with no offer yet, a visit
-- with no officer yet. Requests waiting on the FARMER are deliberately not here — they need no
-- decision and listing them as work would be a lie the owner learns to ignore.
CREATE OR REPLACE FUNCTION public.list_farmer_actions()
RETURNS TABLE (
  farmer_id     uuid,
  farmer_name   text,
  farmer_phone  text,
  farmer_village text,
  kind          text,
  ref_id        uuid,
  status        text,
  amount        numeric,
  purpose       text,
  scheduled_for timestamptz,
  created_at    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_member public.memberships;
BEGIN
  v_member := public.owner_membership_for_farmers();
  RETURN QUERY
  SELECT f.id, f.name, f.phone, f.village,
         'credit'::text, r.id, r.status, r.requested_amount,
         r.requested_note, NULL::timestamptz, r.created_at
    FROM public.farmer_credit_requests r
    JOIN public.marketplace_farmers f ON f.id = r.farmer_id
   WHERE r.shop_id = v_member.tenant_id AND r.status = 'submitted'
  UNION ALL
  SELECT f.id, f.name, f.phone, f.village,
         'visit'::text, v.id, v.status, NULL::numeric,
         v.purpose, COALESCE(v.scheduled_for, v.created_at), v.created_at
    FROM public.farmer_visit_requests v
    JOIN public.marketplace_farmers f ON f.id = v.farmer_id
   WHERE v.shop_id = v_member.tenant_id AND v.status = 'requested'
  ORDER BY created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.list_farmer_actions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_farmer_actions() TO authenticated;

COMMENT ON FUNCTION public.list_farmer_actions() IS
  'What is waiting on the owner right now: credit asks with no offer, visits with no officer. The owner Messages screen and the dashboard widget both read this, so the number they show cannot disagree.';

-- ── 4. The officer's queue ──────────────────────────────────────────────────────────────────
-- A visit assigned to the caller, with only what a person driving to a field needs. No price,
-- no credit, no customer record: the officer is going to look at a crop, not to sell.
CREATE OR REPLACE FUNCTION public.list_my_farmer_visits()
RETURNS TABLE (
  id              uuid,
  farmer_id       uuid,
  farmer_name     text,
  farmer_phone    text,
  farmer_village  text,
  status          text,
  purpose         text,
  preferred_window text,
  scheduled_for   timestamptz,
  owner_note      text,
  created_at      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_member public.memberships;
BEGIN
  v_member := public.membership_in_active_shop(NULL);
  IF v_member.id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: tenant access denied';
  END IF;
  RETURN QUERY
  SELECT v.id, f.id, f.name, f.phone, f.village,
         v.status, v.purpose, v.preferred_window, v.scheduled_for, v.owner_note, v.created_at
    FROM public.farmer_visit_requests v
    JOIN public.marketplace_farmers f ON f.id = v.farmer_id
   WHERE v.shop_id = v_member.tenant_id
     AND v.assigned_to = v_member.user_id
     AND v.status IN ('scheduled', 'in_progress')
   ORDER BY COALESCE(v.scheduled_for, v.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_farmer_visits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_farmer_visits() TO authenticated;

COMMENT ON FUNCTION public.list_my_farmer_visits() IS
  'The visits assigned to the calling employee, in the order he will drive them. Resolves the caller itself; an employee cannot ask for another officer''s visits.';

-- ── 5. What the farmer app pulls ───────────────────────────────────────────────────────────
-- Token in, his own outbox out. Pulling marks them delivered, so a bot can poll without a
-- second "ack" call and without ever seeing another farmer's rows.
CREATE OR REPLACE FUNCTION public.farmer_api_notifications(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_rows   jsonb;
BEGIN
  WITH pending AS (
    SELECT n.*
      FROM public.farmer_notifications n
     WHERE n.farmer_id = v_farmer AND n.delivered_at IS NULL
     ORDER BY n.created_at
     LIMIT 50
     FOR UPDATE SKIP LOCKED
  ), marked AS (
    UPDATE public.farmer_notifications n
       SET delivered_at = now()
      FROM pending p
     WHERE n.id = p.id
    RETURNING n.id, n.kind, n.title, n.body, n.payload, n.created_at
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'title', m.title, 'body', m.body,
           'payload', m.payload, 'created_at', m.created_at) ORDER BY m.created_at), '[]'::jsonb)
    INTO v_rows
    FROM marked m;

  RETURN jsonb_build_object('notifications', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_api_notifications(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.farmer_api_notifications(text) TO anon;

COMMENT ON FUNCTION public.farmer_api_notifications(text) IS
  'The farmer app''s inbox: what the shop did since he last pulled. Resolves the farmer from the token, returns at most 50 and marks them delivered in the same statement, so the bot can poll it directly.';
