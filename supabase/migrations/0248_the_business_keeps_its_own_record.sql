-- ═══════════════════════════════════════════════════════════════════════════════
-- 0248 — The business keeps its own record, and the owner can fill it in later
--
-- Settings' Business profile screen used to be an audit of what the owner supplied at
-- signup: a read of `shops` beside a read of `shop_requests`. That is the wrong shape for
-- the screen an owner opens to answer "is this what my business looks like?" — the signup
-- form marks almost everything optional, so a field left empty there was permanently empty
-- in the app, and the only way to correct a business name was to open a branch.
--
-- So the business now OWNS these facts on its own row:
--
--   • `email`, `whatsapp_phone` — contact details the signup form never asked for. A shop
--     that wants to be reachable off the phone had no place to put an address.
--   • `logo_url` — the picture the shop uses as itself. The signup record kept one, but a
--     historical approval record is not a place to edit today's logo.
--   • `shop_type`, `city`, `registration_number` — asked at signup, never copied to `shops`,
--     so nothing could read them except the audit screen.
--   • `address` already existed on `shops`; it is simply editable here now.
--
-- ONE SOURCE OF TRUTH. The signup answers are copied into `shops` ONCE, here, using the
-- same link rule as 0247 (normalised owner phone + shop name), and only where the shop's
-- own column is still NULL. After this file `shop_requests` stays what it is — the record
-- of what was applied for — and the screen reads and writes `shops` alone. No field is
-- shown from two places, and nothing the owner edits rewrites an approval record.
--
-- WHO MAY WRITE. An ACTIVE OWNER OR ADMIN of `current_shop_id()`, checked in the function.
-- There is no shop parameter, so a caller cannot point it at another business; `shops` is
-- read and written through `current_shop_id()` only. PER BRANCH this changes nothing:
-- `shops` is the business, and every branch of it shares this row by definition (0233 /
-- 0241 keep the LEDGERS apart — stock, sales, people, receivables — not the brand name).
--
-- A PATCH, NOT A ROW. `p_patch` carrying only the keys that changed is what lets the server
-- tell "leave this alone" (key absent) from "clear this" (key present, blank). A single
-- positional parameter per column cannot say that, and NULL would mean both.
--
-- THE CONFIRMATION STEP IS NOT HERE, AND THAT IS DELIBERATE. A name or phone change asks
-- the owner for a one-time code first (the same `sendOTP` / `verifyConfirmOTP` pair the
-- delete sheet uses); the database cannot see that code, so it must not pretend to. What
-- the database enforces is the part it can: who is calling, which business they may touch,
-- and what a value is allowed to look like. The screen enforces the second factor.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS whatsapp_phone varchar(20);
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS shop_type varchar(50);
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS city varchar(100);
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS registration_number varchar(100);

-- Shapes, not policies: a value the app would refuse to draw is refused here too, so a
-- direct PostgREST write cannot leave a row the screens cannot render.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_email_shape') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_email_shape
      CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_whatsapp_shape') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_whatsapp_shape
      CHECK (whatsapp_phone IS NULL OR whatsapp_phone ~ '^92[0-9]{10}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_phone_shape') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_phone_shape
      CHECK (phone IS NULL OR phone ~ '^92[0-9]{10}$');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_type_shape') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_type_shape
      CHECK (shop_type IS NULL OR shop_type IN ('retail', 'wholesale', 'both'));
  END IF;
END
$do$;

-- One copy of the signup answers into the row that now carries them. `COALESCE` keeps a
-- value the business has since set: this runs once, on the batch's own apply, and must
-- never overwrite a correction made between approval and deployment.
UPDATE public.shops s
   SET city                = COALESCE(s.city, r.shop_city),
       shop_type           = COALESCE(s.shop_type, r.shop_type),
       registration_number = COALESCE(s.registration_number, r.business_registration_number),
       logo_url            = COALESCE(s.logo_url, r.logo_url),
       address             = COALESCE(s.address, r.shop_address)
  FROM (
    SELECT DISTINCT ON (s2.id)
           s2.id AS shop_id,
           sr.shop_city,
           sr.shop_type,
           sr.business_registration_number,
           sr.logo_url,
           sr.shop_address
      FROM public.shops s2
      LEFT JOIN public.users u ON u.id = s2.owner_id
      JOIN public.shop_requests sr
        ON sr.status = 'approved'
       AND public.canonical_phone(COALESCE(sr.owner_phone, sr.phone))
           = public.canonical_phone(COALESCE(u.phone, s2.phone))
       AND sr.shop_name = s2.name
     ORDER BY s2.id, sr.created_at DESC
  ) r
 WHERE s.id = r.shop_id;

-- ── The read, extended by the six columns above ────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_business_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop uuid := current_shop_id();
  v_shop_row jsonb;
  v_registration jsonb;
  v_matches int;
  v_phone text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_shop IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.memberships m
     WHERE m.user_id = v_actor
       AND m.tenant_id = v_shop
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: the business profile belongs to the people who answer for the business';
  END IF;

  SELECT to_jsonb(s) || jsonb_build_object('owner_name', u.name, 'owner_phone', u.phone)
    INTO v_shop_row
    FROM public.shops s
    LEFT JOIN public.users u ON u.id = s.owner_id
   WHERE s.id = v_shop;

  IF v_shop_row IS NULL THEN
    RETURN NULL;
  END IF;

  v_phone := public.canonical_phone(COALESCE(v_shop_row ->> 'owner_phone', v_shop_row ->> 'phone'));

  -- The signup record is still returned, because the screen names where a value came from
  -- when the business never touched it. Every column is read through `to_jsonb(sr)` for the
  -- lineage reason in 0247: environments disagree about which columns that table has.
  SELECT jsonb_build_object(
           'shop_name',                     to_jsonb(sr) ->> 'shop_name',
           'shop_type',                     to_jsonb(sr) ->> 'shop_type',
           'shop_city',                     to_jsonb(sr) ->> 'shop_city',
           'shop_address',                  to_jsonb(sr) ->> 'shop_address',
           'business_registration_number',  to_jsonb(sr) ->> 'business_registration_number',
           'logo_url',                      to_jsonb(sr) ->> 'logo_url',
           'submitted_at',                  sr.created_at
         )
    INTO v_registration
    FROM public.shop_requests sr
   WHERE sr.status = 'approved'
     AND v_phone IS NOT NULL
     AND public.canonical_phone(COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')) = v_phone
     AND to_jsonb(sr) ->> 'shop_name' = v_shop_row ->> 'name'
   ORDER BY sr.created_at DESC
   LIMIT 1;

  IF v_registration IS NULL AND v_phone IS NOT NULL THEN
    SELECT count(*)
      INTO v_matches
      FROM public.shop_requests sr
     WHERE sr.status = 'approved'
       AND public.canonical_phone(COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')) = v_phone;

    IF v_matches = 1 THEN
      SELECT jsonb_build_object(
               'shop_name',                     to_jsonb(sr) ->> 'shop_name',
               'shop_type',                     to_jsonb(sr) ->> 'shop_type',
               'shop_city',                     to_jsonb(sr) ->> 'shop_city',
               'shop_address',                  to_jsonb(sr) ->> 'shop_address',
               'business_registration_number',  to_jsonb(sr) ->> 'business_registration_number',
               'logo_url',                      to_jsonb(sr) ->> 'logo_url',
               'submitted_at',                  sr.created_at
             )
        INTO v_registration
        FROM public.shop_requests sr
       WHERE sr.status = 'approved'
         AND public.canonical_phone(COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')) = v_phone
       LIMIT 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'shop', jsonb_build_object(
      'id',                  v_shop_row -> 'id',
      'name',                v_shop_row -> 'name',
      'phone',               v_shop_row -> 'phone',
      'whatsapp_phone',      v_shop_row -> 'whatsapp_phone',
      'email',               v_shop_row -> 'email',
      'address',             v_shop_row -> 'address',
      'city',                v_shop_row -> 'city',
      'shop_type',           v_shop_row -> 'shop_type',
      'registration_number', v_shop_row -> 'registration_number',
      'logo_url',            v_shop_row -> 'logo_url',
      'join_code',           v_shop_row -> 'join_code',
      'created_at',          v_shop_row -> 'created_at',
      'marketplace_enabled', v_shop_row -> 'marketplace_enabled',
      'latitude',            v_shop_row -> 'latitude',
      'longitude',           v_shop_row -> 'longitude',
      'location_label',      v_shop_row -> 'location_label',
      'owner_name',          v_shop_row -> 'owner_name',
      'owner_phone',         v_shop_row -> 'owner_phone'
    ),
    'registration', v_registration
  );
END;
$function$;

-- ── The write ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_business_profile(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  v_shop uuid := current_shop_id();
  v_name text;
  v_phone text;
  v_whatsapp text;
  v_email text;
  v_address text;
  v_city text;
  v_type text;
  v_registration text;
  v_logo text;
  v_row jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_BUSINESS';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.memberships m
     WHERE m.user_id = v_actor
       AND m.tenant_id = v_shop
       AND m.status = 'active'
       AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin may change the business record';
  END IF;

  -- ── Values ────────────────────────────────────────────────────────────────
  -- A key that is absent stays as it is. A key present with a blank string clears the
  -- optional field it names. The two required fields refuse a blank instead of clearing.
  IF p_patch ? 'name' THEN
    v_name := nullif(btrim(COALESCE(p_patch ->> 'name', '')), '');
    IF v_name IS NULL OR char_length(v_name) > 120 THEN
      RAISE EXCEPTION 'INVALID_NAME';
    END IF;
  END IF;

  IF p_patch ? 'phone' THEN
    v_phone := public.canonical_phone(p_patch ->> 'phone');
    IF v_phone !~ '^92[0-9]{10}$' THEN
      RAISE EXCEPTION 'INVALID_PHONE';
    END IF;
  END IF;

  IF p_patch ? 'whatsapp' THEN
    IF nullif(btrim(COALESCE(p_patch ->> 'whatsapp', '')), '') IS NULL THEN
      v_whatsapp := NULL;
    ELSE
      v_whatsapp := public.canonical_phone(p_patch ->> 'whatsapp');
      IF v_whatsapp !~ '^92[0-9]{10}$' THEN
        RAISE EXCEPTION 'INVALID_WHATSAPP';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'email' THEN
    v_email := nullif(btrim(COALESCE(p_patch ->> 'email', '')), '');
    IF v_email IS NOT NULL AND (
         char_length(v_email) > 254
         OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'
       ) THEN
      RAISE EXCEPTION 'INVALID_EMAIL';
    END IF;
  END IF;

  IF p_patch ? 'address' THEN
    v_address := nullif(btrim(COALESCE(p_patch ->> 'address', '')), '');
    IF v_address IS NOT NULL AND char_length(v_address) > 500 THEN
      RAISE EXCEPTION 'INVALID_ADDRESS';
    END IF;
  END IF;

  IF p_patch ? 'city' THEN
    v_city := nullif(btrim(COALESCE(p_patch ->> 'city', '')), '');
    IF v_city IS NOT NULL AND char_length(v_city) > 100 THEN
      RAISE EXCEPTION 'INVALID_CITY';
    END IF;
  END IF;

  IF p_patch ? 'type' THEN
    v_type := nullif(btrim(COALESCE(p_patch ->> 'type', '')), '');
    IF v_type IS NOT NULL AND v_type NOT IN ('retail', 'wholesale', 'both') THEN
      RAISE EXCEPTION 'INVALID_TYPE';
    END IF;
  END IF;

  IF p_patch ? 'registration' THEN
    v_registration := nullif(btrim(COALESCE(p_patch ->> 'registration', '')), '');
    IF v_registration IS NOT NULL AND char_length(v_registration) > 100 THEN
      RAISE EXCEPTION 'INVALID_REGISTRATION';
    END IF;
  END IF;

  IF p_patch ? 'logo' THEN
    v_logo := nullif(btrim(COALESCE(p_patch ->> 'logo', '')), '');
    IF v_logo IS NOT NULL AND char_length(v_logo) > 1000 THEN
      RAISE EXCEPTION 'INVALID_LOGO';
    END IF;
  END IF;

  UPDATE public.shops s
     SET name                = COALESCE(v_name, s.name),
         phone               = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE s.phone END,
         whatsapp_phone      = CASE WHEN p_patch ? 'whatsapp' THEN v_whatsapp ELSE s.whatsapp_phone END,
         email               = CASE WHEN p_patch ? 'email' THEN v_email ELSE s.email END,
         address             = CASE WHEN p_patch ? 'address' THEN v_address ELSE s.address END,
         city                = CASE WHEN p_patch ? 'city' THEN v_city ELSE s.city END,
         shop_type           = CASE WHEN p_patch ? 'type' THEN v_type ELSE s.shop_type END,
         registration_number = CASE WHEN p_patch ? 'registration' THEN v_registration ELSE s.registration_number END,
         logo_url            = CASE WHEN p_patch ? 'logo' THEN v_logo ELSE s.logo_url END
   WHERE s.id = v_shop
  RETURNING to_jsonb(s) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'NO_BUSINESS';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'shop', jsonb_build_object(
      'id',                  v_row -> 'id',
      'name',                v_row -> 'name',
      'phone',               v_row -> 'phone',
      'whatsapp_phone',      v_row -> 'whatsapp_phone',
      'email',               v_row -> 'email',
      'address',             v_row -> 'address',
      'city',                v_row -> 'city',
      'shop_type',           v_row -> 'shop_type',
      'registration_number', v_row -> 'registration_number',
      'logo_url',            v_row -> 'logo_url'
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_business_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_profile() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_business_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_profile(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
