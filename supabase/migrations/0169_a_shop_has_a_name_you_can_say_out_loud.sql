-- ════════════════════════════════════════════════════════════════════════════════
-- 0169 — a shop has a name you can say out loud
--
-- An invitation is a claim about a PAIR: this phone number, that shop. The phone half has
-- always been sayable. The shop half has been a uuid — `00000000-0000-0000-0000-000000000001` —
-- which no owner can read down a phone line and no employee can type without a mistake. That
-- is fine while there are three shops and hopeless at the scale this app is for: an employee
-- asking "which owner added my number?" needs an answer a person can pass on.
--
-- So every shop gets a `join_code`: six characters from an alphabet with no 0/O/1/I/L in it,
-- because it will be read out loud and written down by hand. It identifies a shop; it does
-- not authorize anything. Signing in still requires being invited to that shop and still ends
-- in a code sent to the person's own phone, so a leaked join code is a nuisance, not a door.
--
-- Anyone may resolve a code to a shop NAME (the sign-in screen is anonymous by definition),
-- exactly as `resolve_invite` already lets an anonymous caller confirm that a pair is real.
-- ════════════════════════════════════════════════════════════════════════════════

-- ── 1. The column ───────────────────────────────────────────────────────────────
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS join_code text;

COMMENT ON COLUMN public.shops.join_code IS
  'Short, human-shareable identifier for this shop (6 chars, no 0/O/1/I/L). Read aloud by an owner so an employee can name the shop that invited them. Identifies, never authorizes.';

-- One code per shop, compared case-insensitively: someone typing a code in lowercase is
-- naming the same shop, not a second one.
CREATE UNIQUE INDEX IF NOT EXISTS shops_join_code_upper_key
  ON public.shops (upper(join_code))
  WHERE join_code IS NOT NULL;

-- ── 2. Minting ──────────────────────────────────────────────────────────────────
-- 31 characters, then six of them: ~887 million codes, with a retry on the unique index so a
-- collision is a second attempt rather than a failed shop creation.
CREATE OR REPLACE FUNCTION public.new_shop_join_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_i        int;
  v_tries    int := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM shops WHERE upper(join_code) = v_code);
    IF v_tries >= 50 THEN
      -- Not a hash collision anyone will meet; a sign the alphabet or the table is wrong.
      RAISE EXCEPTION 'JOIN_CODE_EXHAUSTED: could not mint a free shop code in % tries', v_tries;
    END IF;
  END LOOP;
  RETURN v_code;
END; $function$;

/*
 * Filled in the database rather than by each caller, so a shop cannot exist without a code —
 * not from `create_shop_internal`, not from `approve_shop_request`, not from a row inserted by
 * hand during a migration, and not from a screen that forgot to ask for one.
 */
CREATE OR REPLACE FUNCTION public.shop_join_code_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.join_code IS NULL OR btrim(NEW.join_code) = '' THEN
    NEW.join_code := public.new_shop_join_code();
  ELSE
    -- Normalised here, once: the stored code is always uppercase, so lookups and the unique
    -- index never have to guess how it was typed.
    NEW.join_code := upper(btrim(NEW.join_code));
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS shops_join_code_before_insert ON public.shops;
CREATE TRIGGER shops_join_code_before_insert
  BEFORE INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.shop_join_code_default();

-- Shops that already exist (every one of them) get a code now. A code is only ever wrong for
-- a shop if it is missing, so this is unconditional and idempotent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM shops WHERE join_code IS NULL OR btrim(join_code) = '' LOOP
    UPDATE shops SET join_code = public.new_shop_join_code() WHERE id = r.id;
  END LOOP;
END $$;

-- ── 3. Resolving a code to a shop (anonymous: this is the sign-in screen) ───────
/*
 * Answers "is this a shop, and what is it called?" for one code.
 *
 * Returns the shop's NAME and id and nothing else — no owner, no address, no counts — because
 * the caller is unauthenticated and the only thing they are entitled to is being told whether
 * the code names a real shop. `found: false` for anything else, including a malformed code.
 */
CREATE OR REPLACE FUNCTION public.resolve_shop_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_shop record;
BEGIN
  IF length(v_norm) <> 6 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT s.id, s.name INTO v_shop FROM shops s WHERE upper(s.join_code) = v_norm;
  IF v_shop.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object('found', true, 'shopId', v_shop.id, 'shopName', v_shop.name);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.resolve_shop_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_shop_code(text) TO anon, authenticated;

COMMENT ON FUNCTION public.resolve_shop_code(text) IS
  'Anonymous: a join code → the shop it names (id and name only). Used by the sign-in screen so an employee can say which shop invited them. Identifies a shop; grants nothing.';

-- ── 4. Reading your own shop's code (the owner shares it) ───────────────────────
/*
 * The code for the shop the caller is working in.
 *
 * Any active member may read it. An employee handing the code to the colleague sitting next to
 * them is the whole point of it existing, and the code on its own opens nothing: the colleague
 * still needs an invitation to that shop and a code sent to their own number.
 */
CREATE OR REPLACE FUNCTION public.my_shop_join_code()
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop  uuid := current_shop_id();
  v_code  text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_shop IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships m
     WHERE m.user_id = v_actor AND m.tenant_id = v_shop AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this shop';
  END IF;

  SELECT s.join_code INTO v_code FROM shops s WHERE s.id = v_shop;
  RETURN v_code;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.my_shop_join_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_shop_join_code() TO authenticated;

-- ── 5. Tell PostgREST the new functions exist ───────────────────────────────────
-- The API layer caches the schema; without this the two new RPCs answer 404 until it
-- refreshes on its own (learned the hard way in 0166).
NOTIFY pgrst, 'reload schema';
