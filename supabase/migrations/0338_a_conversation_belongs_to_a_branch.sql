-- 0338 — A conversation belongs to a branch, and a farmer can open one from a place.
--
-- WHY THIS EXISTS. The conversation model is already built and is not being replaced: every
--   message already carries `shop_id` (0325), so a dealer with two branches has two separate
--   threads with the same farmer, and the dealer side already resolves the branch from the
--   caller's own membership (`owner_membership_for_farmers`). Two things were genuinely missing
--   for the farmer app, and only those two are added here.
--
-- 1. A FARMER COULD ONLY START A CONVERSATION WITH A CODE. `farmer_api_join_shop` (0328) needs
--    the shop's six-character code, and the owner-side `register_farmer` needs the dealer to add
--    him first. Discovery (0185/0335) already shows a farmer the dealers around him, so the app
--    could render a shop and a price and then have no way to say anything without walking into
--    the shop for a code. Requirement: discovery must not require a code. `farmer_api_contact_shop`
--    is that door — the farmer names a shop he can already see, and the link is created. The code
--    stays exactly as it is: a manual, optional way to connect, never the only one.
--
--    WHAT IT WILL NOT DO. It refuses a shop that has not opted into the marketplace (that is the
--    dealer's own decision, and a farmer must not be able to open a thread with a shop that never
--    offered itself), it never creates a second link, and it never rotates a credential. A farmer
--    who is already linked gets `is_new_link: false` and no second "connected" line in the thread.
--
-- 2. THE DEALER THREAD DID NOT SAY WHICH BRANCH IT WAS. The messages were already scoped by the
--    caller's active shop, but the payload carried no shop at all, so the screen could not show
--    the branch it was standing in — and a dealer switching branches could not see that the
--    conversation under him had changed. `get_farmer_thread` now answers a `shop` block beside the
--    farmer. The row set, the scope and every existing key are untouched.
--
-- WHAT IS DELIBERATELY NOT HERE. No new table, no new column, no message row rewritten, no change
--   to the shop-code join, no new discovery function (0185's `search_marketplace` already answers
--   radius and per-branch offers), and no change to how a message is sent, stored or read.
--
-- VERIFIED BY: tests/integration/farmerChatBranches.test.ts — a farmer sees two branches, contacts
--   each once, gets one link and one notice per branch, two threads that do not share a message,
--   and a dealer reading branch A's thread cannot see branch B's messages; a shop that never opted
--   in is refused; and the dealer payload names its own branch.

-- ── 1. The farmer starts the conversation from the shop he can already see ────────────────────
CREATE OR REPLACE FUNCTION public.farmer_api_contact_shop(p_token text, p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_farmer uuid := public.farmer_by_token(p_token);
  v_shop   public.shops;
  v_linked boolean;
  v_new    integer := 0;
BEGIN
  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: name the dealer you want to talk to';
  END IF;

  SELECT * INTO v_shop FROM public.shops s WHERE s.id = p_shop_id;
  IF v_shop.id IS NULL THEN
    -- One answer for "no such shop" and "not open to farmers", so a token cannot be used to
    -- enumerate the shops that exist but have not listed themselves.
    RAISE EXCEPTION 'NOT_FOUND: that dealer is not open to farmers';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_farmer_links l
     WHERE l.shop_id = v_shop.id AND l.farmer_id = v_farmer
  ) INTO v_linked;

  IF v_linked THEN
    -- Idempotent by design: opening the chat twice is not a second connection, and the thread must
    -- not fill with "connected" notices every time the farmer taps the shop again.
    RETURN jsonb_build_object(
      'shop_id', v_shop.id,
      'shop_name', v_shop.name,
      'is_new_link', false
    );
  END IF;

  IF NOT v_shop.marketplace_enabled THEN
    RAISE EXCEPTION 'NOT_FOUND: that dealer is not open to farmers';
  END IF;

  INSERT INTO public.marketplace_farmer_links (shop_id, farmer_id)
  VALUES (v_shop.id, v_farmer)
  ON CONFLICT (shop_id, farmer_id) DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  -- A first contact is worth one line, because it is how the branch learns a farmer is waiting.
  -- It is a normal `farmer` message: it appears in that branch's thread and in nobody else's.
  IF v_new = 1 THEN
    INSERT INTO public.farmer_messages
      (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
    VALUES (v_shop.id, v_farmer, 'farmer', 'app',
            'Started a conversation from the marketplace.', now());
  END IF;

  RETURN jsonb_build_object(
    'shop_id', v_shop.id,
    'shop_name', v_shop.name,
    'is_new_link', (v_new = 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_api_contact_shop(text, uuid) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.farmer_api_contact_shop(text, uuid) TO anon;

COMMENT ON FUNCTION public.farmer_api_contact_shop(text, uuid) IS
  'Opens (or reopens) one farmer''s conversation with one branch he can already see, without a shop code. Refuses a branch that has not opted into the marketplace; creates at most one link and one notice per branch; never rotates a token.';

-- ── 2. The dealer thread names the branch it belongs to ──────────────────────────────────────
-- Recreated from 0325 verbatim except for the added `shop` key. `RETURNS jsonb` is unchanged, so
-- this is a body replacement rather than a signature change; the scope is still
-- `owner_membership_for_farmers()` — the branch the caller is actually standing in.
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
  v_shop    public.shops;
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

  SELECT * INTO v_shop FROM public.shops s WHERE s.id = v_member.tenant_id;

  RETURN jsonb_build_object(
    -- Which branch this conversation is. Without it a dealer in two branches could not tell
    -- which one he was answering from, and a branch switch would look like the same chat.
    'shop', jsonb_build_object(
      'id', v_shop.id,
      'name', v_shop.name,
      'city', v_shop.city,
      'address', v_shop.address,
      'latitude', v_shop.latitude,
      'longitude', v_shop.longitude
    ),
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

COMMENT ON FUNCTION public.get_farmer_thread(uuid) IS
  'One branch''s whole conversation with one farmer: the branch it belongs to, the farmer, the messages, the credit asks and the visits. Scoped to the caller''s own active shop, so two branches never read each other''s thread (0338).';

-- ── 3. The declaration, then the proof that the door is only the farmer's ────────────────────
-- Same shape as `0335`: the set of functions a signed-in shop session must NOT be able to call is
-- declared in the file that adds one, so the repository's ACL guard (which compares the declared
-- union with the ledger's own set, in both directions) keeps covering the newest door.
DO $acl$
DECLARE
  v_server_only constant text[] := array[
    'farmer_api_contact_shop'
  ];
  v_fn  record;
  v_sig text;
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
      RAISE EXCEPTION '0338: % is still executable by authenticated', v_sig;
    END IF;
  END LOOP;
END;
$acl$;

DO $proof$
DECLARE
  v_rejected boolean;
BEGIN
  IF NOT has_function_privilege('anon', 'public.farmer_api_contact_shop(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0338: the farmer app cannot open a conversation';
  END IF;
  IF has_function_privilege('authenticated', 'public.farmer_api_contact_shop(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0338: a signed-in shop session can call the farmer contact door';
  END IF;
  IF has_function_privilege('anon', 'public.get_farmer_thread(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0338: the dealer thread is readable with the farmer app''s key';
  END IF;

  -- A definer with a pinned search_path, or the caller could shadow `shops`.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'farmer_api_contact_shop'
       AND (p.prosecdef = false OR p.proconfig IS NULL)
  ) THEN
    RAISE EXCEPTION '0338: the contact door is not a definer with a pinned search_path';
  END IF;

  -- A credential is required, and it is checked before any shop is read.
  v_rejected := false;
  BEGIN
    PERFORM public.farmer_api_contact_shop('x', gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NOT_AUTHORIZED:%' THEN v_rejected := true; ELSE RAISE; END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION '0338: the contact door answered without a credential';
  END IF;

  -- The thread still carries its branch, and still resolves it from the membership.
  IF pg_get_functiondef('public.get_farmer_thread(uuid)'::regprocedure) NOT LIKE '%''shop''%' THEN
    RAISE EXCEPTION '0338: the dealer thread does not name its branch';
  END IF;
  IF pg_get_functiondef('public.get_farmer_thread(uuid)'::regprocedure) NOT LIKE '%owner_membership_for_farmers%' THEN
    RAISE EXCEPTION '0338: the dealer thread no longer resolves the caller''s own branch';
  END IF;
END;
$proof$;
