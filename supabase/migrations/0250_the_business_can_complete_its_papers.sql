-- ═══════════════════════════════════════════════════════════════════════════════
-- 0250 — The business can complete its papers
--
-- The owner, looking at their Business profile, asked for two things in one breath: "show the
-- document image I added at signup" and "let me add the ones I did not add". 0249 answered the
-- first for the pictures that made it onto the approval record. This file answers the second, so
-- a business is never stuck with a permanently empty slot because the form was submitted once,
-- in passing, without a licence photo.
--
-- WHERE AN ADDED PAPER LIVES, AND WHY IT IS NOT ON `shop_requests`
--   `shop_requests` is the application a reviewer approved: it is evidence of what the business
--   claimed on the day, and rewriting it would silently change what was approved. A paper the
--   owner adds later is part of the business's CURRENT record, so it is stored on `shops`, beside
--   the logo that 0248 already keeps there. Reads prefer the shop's own picture and fall back to
--   the approval record, so an owner who never replaces anything still sees the originals.
--
-- WHY A SEPARATE, PRIVATE BUCKET
--   The four existing image buckets are public by design — a product photo rendered in a list is
--   not a secret. A licence and a CNIC are not that: 0249 gates them to an active owner/admin of
--   the business precisely because an identity document is a screenshot away from leaking. Sending
--   those into a public bucket to make an upload button convenient would undo that gate in one
--   line, so this file adds `business-documents` as a PRIVATE bucket and lets the screen read
--   through short-lived signed URLs.
--
--   The policy is scoped by path prefix, `${shop_id}/…`, and checked against `current_shop_id()` —
--   the same "which branch am I working in" answer every RPC uses. So a member of shop A can
--   neither write under shop B's prefix nor list B's objects. Legacy pictures from the signup form
--   are full https URLs and are returned as they are; only bare paths are signed.
--
-- NO UPDATE, NO DELETE — as 0230 established for every other bucket: `src/lib/storage.ts` only
-- ever writes a fresh, uniquely named object, so an update/delete policy would be surface with no
-- user. Replacing a picture means uploading a new one and pointing the column at it.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The three papers the signup form asks for ────────────────────────────────────────────────
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS licence_url    text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS cnic_front_url text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS cnic_back_url  text;

-- ── 2. The private bucket ───────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-documents',
  'business-documents',
  false,
  5 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5 * 1024 * 1024,
      allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

-- ── 3. Who may put a paper in, and who may take one out ─────────────────────────────────────────
DROP POLICY IF EXISTS "business documents read"  ON storage.objects;
DROP POLICY IF EXISTS "business documents write" ON storage.objects;

CREATE POLICY "business documents read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'business-documents'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
  );

CREATE POLICY "business documents write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'business-documents'
    AND (storage.foldername(name))[1] = public.current_shop_id()::text
  );

-- ── 4. Writing a paper into the business record ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_business_profile(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  v_licence text;
  v_cnic_front text;
  v_cnic_back text;
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

  -- A document is either a path inside THIS shop's folder of the private bucket, or an https
  -- URL the signup form produced. Anything else is refused: it is the one place where a caller
  -- could otherwise write a path belonging to another business.
  IF p_patch ? 'licence' THEN
    v_licence := nullif(btrim(COALESCE(p_patch ->> 'licence', '')), '');
    IF v_licence IS NOT NULL AND (
         char_length(v_licence) > 1000
         OR NOT (v_licence LIKE v_shop::text || '/%' OR v_licence ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_LICENCE';
    END IF;
  END IF;

  IF p_patch ? 'cnic_front' THEN
    v_cnic_front := nullif(btrim(COALESCE(p_patch ->> 'cnic_front', '')), '');
    IF v_cnic_front IS NOT NULL AND (
         char_length(v_cnic_front) > 1000
         OR NOT (v_cnic_front LIKE v_shop::text || '/%' OR v_cnic_front ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_CNIC_FRONT';
    END IF;
  END IF;

  IF p_patch ? 'cnic_back' THEN
    v_cnic_back := nullif(btrim(COALESCE(p_patch ->> 'cnic_back', '')), '');
    IF v_cnic_back IS NOT NULL AND (
         char_length(v_cnic_back) > 1000
         OR NOT (v_cnic_back LIKE v_shop::text || '/%' OR v_cnic_back ~* '^https?://')
       ) THEN
      RAISE EXCEPTION 'INVALID_CNIC_BACK';
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
         logo_url            = CASE WHEN p_patch ? 'logo' THEN v_logo ELSE s.logo_url END,
         licence_url         = CASE WHEN p_patch ? 'licence' THEN v_licence ELSE s.licence_url END,
         cnic_front_url      = CASE WHEN p_patch ? 'cnic_front' THEN v_cnic_front ELSE s.cnic_front_url END,
         cnic_back_url       = CASE WHEN p_patch ? 'cnic_back' THEN v_cnic_back ELSE s.cnic_back_url END
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
      'logo_url',            v_row -> 'logo_url',
      'licence_url',         v_row -> 'licence_url',
      'cnic_front_url',      v_row -> 'cnic_front_url',
      'cnic_back_url',       v_row -> 'cnic_back_url'
    )
  );
END;
$function$;

-- ── 5. Reading the papers: the business's own copy first, the signup record second ──────────────
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
  v_documents jsonb;
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

  -- Every column read from `shop_requests` goes through `to_jsonb(sr)`, for the lineage
  -- reason in 0247: environments disagree about which columns that table has, and a missing
  -- one must answer NULL rather than fail to compile.
  SELECT jsonb_build_object(
           'shop_name',                     to_jsonb(sr) ->> 'shop_name',
           'shop_type',                     to_jsonb(sr) ->> 'shop_type',
           'shop_city',                     to_jsonb(sr) ->> 'shop_city',
           'shop_address',                  to_jsonb(sr) ->> 'shop_address',
           'business_registration_number',  to_jsonb(sr) ->> 'business_registration_number',
           'logo_url',                      to_jsonb(sr) ->> 'logo_url',
           'submitted_at',                  sr.created_at
         ),
         jsonb_build_object(
           'logo',      to_jsonb(sr) ->> 'logo_url',
           'licence',   to_jsonb(sr) ->> 'business_license_url',
           'cnic_front',to_jsonb(sr) ->> 'cnic_front_url',
           'cnic_back', to_jsonb(sr) ->> 'cnic_back_url'
         )
    INTO v_registration, v_documents
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
             ),
             jsonb_build_object(
               'logo',      to_jsonb(sr) ->> 'logo_url',
               'licence',   to_jsonb(sr) ->> 'business_license_url',
               'cnic_front',to_jsonb(sr) ->> 'cnic_front_url',
               'cnic_back', to_jsonb(sr) ->> 'cnic_back_url'
             )
        INTO v_registration, v_documents
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
      'licence_url',         v_shop_row -> 'licence_url',
      'cnic_front_url',      v_shop_row -> 'cnic_front_url',
      'cnic_back_url',       v_shop_row -> 'cnic_back_url',
      'join_code',           v_shop_row -> 'join_code',
      'created_at',          v_shop_row -> 'created_at',
      'marketplace_enabled', v_shop_row -> 'marketplace_enabled',
      'latitude',            v_shop_row -> 'latitude',
      'longitude',           v_shop_row -> 'longitude',
      'location_label',      v_shop_row -> 'location_label',
      'owner_name',          v_shop_row -> 'owner_name',
      'owner_phone',         v_shop_row -> 'owner_phone'
    ),
    'registration', v_registration,
    -- The business's own picture wins; the approval record answers only where the owner has not
    -- added one. `null` still means "no record to read", which the screen says out loud.
    'documents', CASE
      WHEN v_documents IS NULL
       AND COALESCE(v_shop_row ->> 'licence_url', v_shop_row ->> 'cnic_front_url', v_shop_row ->> 'cnic_back_url') IS NULL
      THEN NULL
      ELSE jsonb_build_object(
        'logo',       COALESCE(v_shop_row ->> 'logo_url',      v_documents ->> 'logo'),
        'licence',    COALESCE(v_shop_row ->> 'licence_url',   v_documents ->> 'licence'),
        'cnic_front', COALESCE(v_shop_row ->> 'cnic_front_url',v_documents ->> 'cnic_front'),
        'cnic_back',  COALESCE(v_shop_row ->> 'cnic_back_url', v_documents ->> 'cnic_back')
      )
    END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_business_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_profile() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_business_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_profile(jsonb) TO authenticated;

-- ── 6. Asserted, not assumed ────────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_public boolean;
  v_read int;
  v_write int;
  v_cols int;
BEGIN
  SELECT b.public INTO v_public FROM storage.buckets b WHERE b.id = 'business-documents';
  IF v_public IS NULL THEN
    RAISE EXCEPTION '0250: the business-documents bucket was not created';
  END IF;
  IF v_public THEN
    RAISE EXCEPTION '0250: identity papers must not sit in a public bucket';
  END IF;

  SELECT count(*) INTO v_read
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'business documents read' AND cmd = 'SELECT';
  SELECT count(*) INTO v_write
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname = 'business documents write' AND cmd = 'INSERT';
  IF v_read <> 1 OR v_write <> 1 THEN
    RAISE EXCEPTION '0250: expected one read and one write policy on business-documents (read=%, write=%)', v_read, v_write;
  END IF;

  SELECT count(*) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'shops'
     AND column_name IN ('licence_url', 'cnic_front_url', 'cnic_back_url');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION '0250: expected three document columns on shops, found %', v_cols;
  END IF;

  RAISE NOTICE '0250: business papers are stored on the business, in a private bucket';
END
$verify$;

NOTIFY pgrst, 'reload schema';
