-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0135: an invited employee can actually sign in
-- ═══════════════════════════════════════════════════════════════════════════════
-- THE GAP
--   app_current_user_id() reads the JWT `sub`, so an employee's Supabase Auth
--   identity must have id = public.users.id. That only ever existed for accounts an
--   operator had provisioned out of band (scripts/provision-auth-sessions.mjs uses
--   the service-role admin API). So a freshly invited employee could open the invite
--   link, receive a code, type it — and land on "we could not open the app for this
--   number yet", because every authorization path treats their session as an unknown
--   actor. The client-side bridge cannot fix this: Supabase rejects the derived
--   address at signUp, and signUp is rate-limited on top ("email rate limit
--   exceeded") — the app must not be minting identities from the browser at all.
--
-- THE FIX
--   One authorized, idempotent RPC that creates the identity for a specific app
--   user with THAT id, using the same derived credential the app already signs in
--   with (so no client change and no new secret the employee must be told).
--   It runs as SECURITY DEFINER and begins with authorize_business_action, so only
--   a caller who already holds employees.manage in that tenant can provision
--   anybody — and only for a user inside their own tenant.
--
-- VERIFIED BEFORE WRITING (QA, real sign-in):
--   auth row created from SQL: true / sign-in error: none / jwt sub == app user id
--   / get_my_permissions returned that employee's real permissions.
--
-- NOTE FOR PRODUCTION: this writes to the auth schema directly, which is
-- version-dependent (the column set below was verified against this project). The
-- equivalent admin-API call inside a server-side function is the long-term home; the
-- gate, the idempotency and the derived-credential contract stay the same either way.
-- ═══════════════════════════════════════════════════════════════════════════════

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
BEGIN
  -- Authorization first: the caller must be allowed to manage employees, and the
  -- person being provisioned must belong to the caller's own tenant.
  v_tenant := authorize_business_action('employees.manage');

  SELECT name, phone INTO v_name, v_phone
    FROM users
   WHERE id = p_user_id AND shop_id = v_tenant;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  -- Exactly the derivation in src/lib/auth.ts phoneToAuthCredentials(): digits only,
  -- local "0300…" becomes "92300…". Kept here in SQL so the row and the client agree
  -- without either side guessing.
  v_e164 := regexp_replace(v_phone, '\D', '', 'g');
  IF v_e164 LIKE '0%' THEN
    v_e164 := '92' || substr(v_e164, 2);
  ELSIF v_e164 NOT LIKE '92%' THEN
    v_e164 := '92' || v_e164;
  END IF;
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';
  v_pass  := 'AgriShop-' || v_e164 || '-2026!';

  -- Already has a login: repair the credential rather than duplicating the account.
  -- This is what makes "they were invited before this migration" and "re-send the
  -- invitation" both work.
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    UPDATE auth.users
       SET email               = v_email,
           encrypted_password  = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           email_confirmed_at  = COALESCE(email_confirmed_at, now()),
           updated_at          = now()
     WHERE id = p_user_id;
    RETURN jsonb_build_object('provisioned', false, 'repaired', true, 'userId', p_user_id);
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
          jsonb_build_object('invited', true));

  RETURN jsonb_build_object('provisioned', true, 'userId', p_user_id, 'name', v_name);
END; $$;

GRANT EXECUTE ON FUNCTION public.provision_member_login(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_member_login(uuid) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Provision as part of inviting, in the same transaction
-- ─────────────────────────────────────────────────────────────────────────────
-- Inviting and being-able-to-accept are one decision, so they are one statement:
-- the client keeps calling create_employee (no call site changes, nothing to
-- forget), and the invite it returns is always usable. Same rename-and-wrap
-- pattern as 0134 used for create_sale, so the invitation logic itself is not
-- re-written here — only wrapped.
ALTER FUNCTION public.create_employee(jsonb) RENAME TO create_employee_core;
REVOKE EXECUTE ON FUNCTION public.create_employee_core(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created jsonb;
  v_id uuid;
BEGIN
  -- create_employee_core re-checks the caller's own authorization (it calls
  -- authorize_business_action('employees.manage') itself); this wrapper adds no
  -- authority, so the ONLY reachable path to an invite is through that check.
  v_created := public.create_employee_core(payload);
  v_id := (v_created->>'id')::uuid;

  -- Tolerant by design: if provisioning fails the employee is still invited and the
  -- owner can retry from the invitation card, instead of losing the record. The
  -- failure is recorded rather than swallowed.
  BEGIN
    PERFORM public.provision_member_login(v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
    VALUES (app_current_user_id(), 'member_login_provision_failed', 'user', v_id,
            jsonb_build_object('reason', SQLERRM));
  END;

  RETURN v_created;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_employee(jsonb) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: employees invited before this migration still cannot sign in
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_row record; v_e164 text;
BEGIN
  FOR v_row IN
    SELECT u.id, u.phone
      FROM users u
     WHERE u.shop_id IS NOT NULL
       AND u.is_active
       AND u.phone IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id)
  LOOP
    v_e164 := regexp_replace(v_row.phone, '\D', '', 'g');
    IF v_e164 LIKE '0%' THEN
      v_e164 := '92' || substr(v_e164, 2);
    ELSIF v_e164 NOT LIKE '92%' THEN
      v_e164 := '92' || v_e164;
    END IF;

    BEGIN
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_row.id, 'authenticated', 'authenticated',
        'user-' || v_e164 || '@agrishop.auth.local',
        extensions.crypt('AgriShop-' || v_e164 || '-2026!', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_row.id, v_row.id::text,
        jsonb_build_object('sub', v_row.id::text, 'email',
          'user-' || v_e164 || '@agrishop.auth.local'),
        'email', now(), now(), now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'login provisioning skipped for % (%)', v_row.id, SQLERRM;
    END;
  END LOOP;
END $$;
