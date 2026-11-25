-- 0328 — A farmer can walk in with the shop's code.
--
-- WHY. `0325` made the conversation work, but only the owner could start one: `register_farmer`
-- is an authenticated RPC, so a farmer standing at the counter had no way to connect his own app
-- without the owner typing his details first. The owner asked for BOTH doors (2026-11-22): the
-- owner can invite a farmer, and a farmer can scan a code at the shop and join himself.
--
-- WHY A SECOND CODE, NOT `shops.join_code`. `shops.join_code` is a staff credential — 0169 and
-- 0185 both say so, and the marketplace guard lists it as something a public surface must never
-- carry. Handing that code to every farmer who walks in would let him attempt to join the shop's
-- staff. This file therefore gives the shop a SEPARATE six-character code, in its own table, that
-- can only join a farmer to the conversation. The two codes never resolve each other.
--
-- WHY THE CODE IS NOT A TOKEN. The code identifies a shop, not a person: it is printed, stuck to
-- the counter and read by anyone. The credential a farmer's app stores is still the per-farmer
-- `marketplace_farmer_tokens` value from 0325, hashed at rest and returned once.
--
-- THE ONE REFUSAL THAT MATTERS. A join does NOT rotate a token that is already live. Rotating on
-- a claim of a phone number would let anyone who knows a farmer's number and any shop's public
-- code mint themselves that farmer's credential and read every thread he has. So:
--   * a farmer with no live token gets one, exactly as the owner's invite would give him;
--   * a farmer who already has one is linked to the new shop and answered `token: null` — his
--     app already holds the credential, and if it does not, the owner issues a new one from the
--     farmer's profile (which rotates deliberately, with the owner's hand on it).
--
-- WHAT IS DELIBERATELY ABSENT: no push, no scheduler, no direct table access, no owner identity
-- in the answer. The RPC returns the shop's name (the farmer must see who he joined), the farmer's
-- own id/name/village and, once, a token. Nothing else.
--
-- ROLLOUT. Additive: one table, two functions, one grant each. Replayable.

-- ── 1. The shop's farmer code ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_shop_join_codes (
  shop_id    uuid PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_shop_join_codes IS
  'The six-character code a shop prints for farmers. Separate from shops.join_code, which is a staff credential: this one can only link a farmer to the conversation. Written by shop_farmer_join_code(), read by farmer_api_join_shop().';

ALTER TABLE public.marketplace_shop_join_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketplace_shop_join_codes FROM PUBLIC, anon, authenticated;

-- ── 2. The owner's side: one code per shop, made on first look ──────────────────────────────
-- The alphabet excludes 0/O and 1/I/L, so a code read off a printed card cannot be mistyped into
-- a different shop. Six characters is 32^6 ≈ 1.07 billion; collisions are retried, not accepted.
CREATE OR REPLACE FUNCTION public.shop_farmer_join_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.memberships;
  v_code   text;
  v_try    integer := 0;
  v_fresh  text;
BEGIN
  v_member := public.owner_membership_for_farmers();

  LOOP
    SELECT c.code INTO v_code
      FROM public.marketplace_shop_join_codes c
     WHERE c.shop_id = v_member.tenant_id;
    EXIT WHEN v_code IS NOT NULL;

    v_fresh := (
      SELECT string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               1 + floor(random() * 32)::integer, 1), '')
        FROM generate_series(1, 6)
    );

    BEGIN
      INSERT INTO public.marketplace_shop_join_codes (shop_id, code)
      VALUES (v_member.tenant_id, v_fresh)
      RETURNING code INTO v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Either another session made this shop's code at the same moment (the next SELECT finds
      -- it) or the six characters are already another shop's (a new one is drawn).
      v_code := NULL;
    END;

    v_try := v_try + 1;
    EXIT WHEN v_try >= 12;
  END LOOP;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: a shop code could not be made just now, please try again';
  END IF;

  RETURN jsonb_build_object(
    'code', v_code,
    'shop_name', (SELECT s.name FROM public.shops s WHERE s.id = v_member.tenant_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.shop_farmer_join_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_farmer_join_code() TO authenticated;

COMMENT ON FUNCTION public.shop_farmer_join_code() IS
  'The shop''s farmer code, created on first look and stable afterwards. Resolves the caller''s own shop, so one owner cannot read another shop''s code.';

-- ── 3. The farmer's side: join with the code, and get a credential only if he has none ──────
CREATE OR REPLACE FUNCTION public.farmer_api_join_shop(
  p_code    text,
  p_phone   text,
  p_name    text,
  p_village text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop      uuid;
  v_key       text := public.farmer_phone_key(p_phone);
  v_name      text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_village   text := NULLIF(btrim(COALESCE(p_village, '')), '');
  v_farmer    public.marketplace_farmers;
  v_token     text;
  v_has_token boolean;
  v_new_link  integer := 0;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'VALIDATION: the shop code is needed';
  END IF;

  SELECT c.shop_id INTO v_shop
    FROM public.marketplace_shop_join_codes c
   WHERE upper(c.code) = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'));
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: that shop code is not valid — check the code and try again';
  END IF;

  IF v_key IS NULL OR v_key !~ '^92[0-9]{9,11}$' THEN
    RAISE EXCEPTION 'VALIDATION: that phone number is not a usable Pakistani mobile number';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'VALIDATION: a farmer needs a name';
  END IF;
  IF length(v_name) > 80 THEN
    RAISE EXCEPTION 'VALIDATION: a name is at most 80 characters';
  END IF;
  IF v_village IS NOT NULL AND length(v_village) > 120 THEN
    RAISE EXCEPTION 'VALIDATION: a village is at most 120 characters';
  END IF;

  -- The phone is the identity, exactly as it is on the owner's side (0325): 0300…, +92300… and
  -- 92300… are one farmer, so joining twice does not create a second person.
  INSERT INTO public.marketplace_farmers (phone_key, phone, name, village)
  VALUES (v_key, btrim(p_phone), v_name, v_village)
  ON CONFLICT (phone_key) DO UPDATE
    SET name = EXCLUDED.name,
        village = COALESCE(EXCLUDED.village, public.marketplace_farmers.village),
        updated_at = now()
  RETURNING * INTO v_farmer;

  INSERT INTO public.marketplace_farmer_links (shop_id, farmer_id)
  VALUES (v_shop, v_farmer.id)
  ON CONFLICT (shop_id, farmer_id) DO NOTHING;
  GET DIAGNOSTICS v_new_link = ROW_COUNT;

  SELECT EXISTS (
    SELECT 1 FROM public.marketplace_farmer_tokens t
     WHERE t.farmer_id = v_farmer.id AND t.revoked_at IS NULL
  ) INTO v_has_token;

  -- NEVER rotate on a phone claim. See the header: a live credential means the app already has
  -- it; a missing one is the only reason to mint.
  IF NOT v_has_token THEN
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.marketplace_farmer_tokens (farmer_id, token_hash, issued_by)
    VALUES (v_farmer.id, encode(extensions.digest(v_token, 'sha256'), 'hex'), NULL);
  END IF;

  -- A first join is worth one line in the thread: it is how the owner learns a farmer connected
  -- himself. A re-scan of the same shop writes nothing, so the conversation cannot fill with
  -- join notices.
  IF v_new_link = 1 THEN
    INSERT INTO public.farmer_messages
      (shop_id, farmer_id, direction, channel, body, delivered_to_app_at)
    VALUES (v_shop, v_farmer.id, 'farmer', 'app', 'Joined the shop from the shop code.', now());
  END IF;

  RETURN jsonb_build_object(
    'farmer_id', v_farmer.id,
    'token', v_token,
    'shop_id', v_shop,
    'shop_name', (SELECT s.name FROM public.shops s WHERE s.id = v_shop),
    'name', v_farmer.name,
    'village', v_farmer.village,
    'already_connected', v_has_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.farmer_api_join_shop(text, text, text, text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.farmer_api_join_shop(text, text, text, text) TO anon;

COMMENT ON FUNCTION public.farmer_api_join_shop(text, text, text, text) IS
  'Anonymous shop-code join: normalises the phone, links the farmer to the shop, and returns a one-time token ONLY when he has no live one. Never rotates an existing credential and never returns owner data.';

-- ── 4. Prove the two doors are the doors they claim to be ───────────────────────────────────
DO $proof$
BEGIN
  IF has_table_privilege('anon', 'public.marketplace_shop_join_codes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.marketplace_shop_join_codes', 'SELECT') THEN
    RAISE EXCEPTION 'the farmer join code table must not be readable by a client role';
  END IF;

  IF NOT has_function_privilege('anon', 'public.farmer_api_join_shop(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a farmer app that is not signed in must be able to join with the shop code';
  END IF;
  IF has_function_privilege('authenticated', 'public.farmer_api_join_shop(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the anonymous join must not also be callable by a signed-in owner session';
  END IF;

  -- The staff credential and the farmer credential must remain different columns: reusing
  -- shops.join_code here would hand every farmer a staff code.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'marketplace_shop_join_codes'
       AND column_name = 'join_code'
  ) THEN
    RAISE EXCEPTION 'the farmer code must not reuse the staff join_code column';
  END IF;

  IF has_function_privilege('anon', 'public.shop_farmer_join_code()', 'EXECUTE') THEN
    RAISE EXCEPTION 'only the owner may read the shop code';
  END IF;
END;
$proof$;
