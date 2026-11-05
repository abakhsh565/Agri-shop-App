-- 0283 — a person can move their own login number without splitting their identity.
--
-- `users.phone` is the number every sign-in door, directory read and invitation lookup uses, and
-- it is UNIQUE. Changing only that column would leave the Supabase Auth credential on the old
-- number, so the next sign-in would look for a login that no longer matches the person. This
-- function moves the app row and the auth credential in one transaction, and it is the caller's
-- own row only: the actor comes from the JWT, never from a client-supplied user id.
--
-- LIVE SMS: the browser runs Supabase Auth's phone-change OTP first. By the time this is called,
-- auth.users.phone is the new number; that is the proof this function checks. An authenticated
-- caller who has not completed that step is refused.
--
-- LOCAL/DEMO: this project's dev sign-in uses a deterministic email+password derived from the
-- phone (0135/0163). The login row is moved to the new derived address and password here. That
-- path is accepted only when the auth row still carries the OLD derived address, so it cannot be
-- used to take over a live phone identity.

CREATE OR REPLACE FUNCTION public.change_my_phone(p_new_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor      uuid := public.app_current_user_id();
  v_user       public.users;
  v_old        text;
  v_new        text;
  v_auth_phone text;
  v_auth_email text;
  v_old_email  text;
  v_new_email  text;
  v_new_pass   text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = v_actor;
  IF v_user.id IS NULL OR NOT v_user.is_active THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;

  v_old := public.canonical_phone(v_user.phone);
  v_new := public.canonical_phone(p_new_phone);

  IF v_new IS NULL OR length(v_new) <> 12 OR v_new NOT LIKE '923%' THEN
    RAISE EXCEPTION 'PHONE_INVALID';
  END IF;
  IF v_new = v_old THEN
    RAISE EXCEPTION 'PHONE_UNCHANGED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
     WHERE id <> v_actor AND public.canonical_phone(phone) = v_new
  ) THEN
    RAISE EXCEPTION 'PHONE_ALREADY_IN_USE';
  END IF;

  SELECT phone, email INTO v_auth_phone, v_auth_email
    FROM auth.users WHERE id = v_actor;

  v_new_email := 'user-' || v_new || '@agrishop.auth.local';
  v_new_pass  := 'AgriShop-' || v_new || '-2026!';
  v_old_email := 'user-' || v_old || '@agrishop.auth.local';

  IF v_auth_phone IS NOT NULL AND public.canonical_phone(v_auth_phone) = v_new THEN
    -- The browser completed Supabase Auth's phone_change OTP. The auth identity already holds
    -- the new number; this transaction only brings the app directory row along.
    NULL;
  ELSIF v_auth_phone IS NULL AND v_auth_email = v_old_email THEN
    -- Local/demo credential. It must still be the credential derived from the number being
    -- replaced; a live phone identity never reaches this branch.
    BEGIN
      UPDATE auth.users
         SET email              = v_new_email,
             encrypted_password = extensions.crypt(v_new_pass, extensions.gen_salt('bf')),
             email_confirmed_at = COALESCE(email_confirmed_at, now()),
             updated_at         = now()
       WHERE id = v_actor;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'PHONE_ALREADY_IN_USE';
    END;
  ELSE
    RAISE EXCEPTION 'PHONE_NOT_VERIFIED';
  END IF;

  UPDATE public.users
     SET phone = v_new
   WHERE id = v_actor
   RETURNING * INTO v_user;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'phone_number_changed', 'user', v_actor,
          jsonb_build_object('phoneChanged', true));

  RETURN jsonb_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'photo_url', v_user.photo_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.change_my_phone(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_my_phone(text) TO authenticated;

COMMENT ON FUNCTION public.change_my_phone(text) IS
  'Moves the caller''s app number and matching login identity together; duplicates and unverified live changes are refused.';