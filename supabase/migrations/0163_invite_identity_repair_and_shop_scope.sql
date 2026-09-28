-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0163: an invited employee's login can be repaired, and an invitation
--                 says which shop it came from
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE DEFECT (reproduced in QA, 4 of the last 8 invitations)
--
--   `provision_member_login` failed with
--       duplicate key value violates unique constraint "users_email_partial_key"
--   and `create_employee` correctly tolerated it, recording
--   `member_login_provision_failed`. The employee row and its pending membership
--   existed; their *login identity* did not.
--
--   The employee then opened the invitation and typed their own number, which was
--   found (is_active = true), so a code was sent and accepted — and sign-in still
--   failed. Two independent faults were needed for that, and both are here:
--
--   1. The repair branch only looked for a row with id = p_user_id. The address
--      `user-<e164>@agrishop.auth.local` is 1:1 with the phone, so the row that
--      held it had a DIFFERENT id — an identity created by the old client-side
--      `signUp` bridge. It could never sign anybody in (its `sub` resolves to no
--      app user, so every authorization path denies it), and it permanently
--      blocked the real row from being created. The delete below claims the
--      address back.
--
--   2. The client, finding no identity to sign in to, MINTED one with
--      `auth.signUp` — a fresh random id, which is exactly how a stray identity is
--      born. That is the cycle this migration plus the client change breaks: the
--      browser must never create an identity. (0135 already says so; the code
--      contradicted it.)
--
--   With a stray present, the invitee's session `sub` is the stray id, and
--   `complete_member_onboarding()` raises ACCOUNT_INACTIVE — the "inactive" the
--   owner saw, printed raw on the OTP screen because that screen shows
--   `result.message` verbatim.
--
-- SCOPE OF THE DELETE
--   Only the one address derived from THIS caller's tenant employee, and only
--   when it belongs to a different id. A row matching that cannot sign in, so
--   removing it destroys no working access; and the whole function still begins
--   with authorize_business_action('employees.manage'), so no employee can repair
--   anybody, including themselves.
--
-- WHY THE SHOP IS IN THE LINK
--   `lookup_user_by_phone` answers from the phone alone, which is right while a
--   phone belongs to exactly one shop. An invitation is a claim about a specific
--   (shop, phone) pair — "this owner added this number" — so the link now carries
--   the shop and `resolve_invite()` answers whether that pair is real. That is
--   also the seam a multi-shop membership needs: today `create_employee` refuses a
--   phone that already exists anywhere, so one person cannot work for two shops.
--   That is a product decision (and a data model change), not a repair, and it is
--   NOT taken here.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The provisioner claims back an address held by a stray identity
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_member_login(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_phone  text;
  v_e164   text;
  v_email  text;
  v_pass   text;
  v_name   text;
  v_stray  uuid;
BEGIN
  v_tenant := authorize_business_action('employees.manage');

  SELECT name, phone INTO v_name, v_phone
    FROM users
   WHERE id = p_user_id AND shop_id = v_tenant;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  v_e164 := public.canonical_phone(v_phone);
  IF v_e164 IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_PHONE_INVALID';
  END IF;
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';
  v_pass  := 'AgriShop-' || v_e164 || '-2026!';

  -- An identity holding this address under another id is a stray: a login whose `sub`
  -- resolves to no app user, so it can satisfy no authorization anywhere, and whose
  -- presence is what made the INSERT below fail with `users_email_partial_key`. Every
  -- FK from the auth schema to auth.users cascades, so this one delete is complete.
  SELECT id INTO v_stray FROM auth.users WHERE email = v_email AND id <> p_user_id LIMIT 1;
  IF v_stray IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_stray;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    UPDATE auth.users
       SET email               = v_email,
           encrypted_password  = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           email_confirmed_at  = COALESCE(email_confirmed_at, now()),
           updated_at          = now()
     WHERE id = p_user_id;
    RETURN jsonb_build_object('provisioned', false, 'repaired', true,
                              'claimedFrom', v_stray, 'userId', p_user_id, 'name', v_name);
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_user_id, p_user_id::text,
    jsonb_build_object('sub', p_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'member_login_provisioned', 'user', p_user_id,
          jsonb_build_object('invited', true, 'claimedFrom', v_stray));

  RETURN jsonb_build_object('provisioned', true, 'repaired', false,
                            'claimedFrom', v_stray, 'userId', p_user_id, 'name', v_name);
END; $$;

GRANT EXECUTE ON FUNCTION public.provision_member_login(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_member_login(uuid) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ask whether an invitation is real: is this phone invited to this shop?
-- ─────────────────────────────────────────────────────────────────────────────
-- Called before a code is sent, from the invitation link, and again when the code is
-- verified — so an invitation cannot be completed by a different number. It must be
-- callable before a session exists (that is the whole point), hence the anon grant.
--
-- It answers with the shop's NAME as well, which the invitee is shown ("you were
-- invited to <shop>"). That is a deliberate, small disclosure: it is the same name
-- the shop puts over its own door, and the caller must already hold the shop id,
-- which only appears in a link the owner sent. What it does NOT return is any
-- contact detail, so it cannot be used to harvest numbers.
CREATE OR REPLACE FUNCTION public.resolve_invite(p_shop_id uuid, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_shop_name text;
  v_e164      text := public.canonical_phone(p_phone);
  v_user      uuid;
  v_status    text;
BEGIN
  IF p_shop_id IS NULL OR v_e164 IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT name INTO v_shop_name FROM shops WHERE id = p_shop_id;
  IF v_shop_name IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT u.id, m.status::text INTO v_user, v_status
    FROM memberships m
    JOIN users u ON u.id = m.user_id
   WHERE m.tenant_id = p_shop_id
     AND public.canonical_phone(u.phone) = v_e164
   ORDER BY m.created_at ASC
   LIMIT 1;

  RETURN jsonb_build_object(
    'found', true,
    'shopId', p_shop_id,
    'shopName', v_shop_name,
    'invited', v_user IS NOT NULL,
    'status', v_status
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.resolve_invite(uuid, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_invite(uuid, text) FROM PUBLIC;
