-- ═══════════════════════════════════════════════════════════════════════════════
-- 0249 — The business profile can show the papers the owner submitted
--
-- The owner asked, looking at their own Business profile screen: "where is the image I
-- added at signup?" The signup form takes a logo, a business licence and the two sides of
-- a CNIC, and stores them on the approval record — and 0247 deliberately did NOT return
-- them, on the rule that an identity document is one screenshot away from leaking.
--
-- That rule was written for a screen that listed whatever it could find. This is a
-- different question: the OWNER of the business, signed in, looking at their own record.
-- So the documents are returned, under three limits that are enforced here rather than
-- on the screen:
--
--   • WHO — an ACTIVE OWNER OR ADMIN of `current_shop_id()`, the same gate as every other
--     field on this page. An employee never sees them: the function refuses the call
--     outright, it does not blank the fields.
--   • WHICH BUSINESS — `current_shop_id()` only. There is no shop parameter, so the
--     function cannot be pointed at another business's paperwork.
--   • WHAT — the four images the form accepts, and nothing else. No CNIC NUMBER, no
--     licence number, no date of birth: the record has none of those, and this file does
--     not invent them.
--
-- The screen draws them as thumbnails that open full size, which is the only way a
-- photographed document can be checked at all. They are NOT editable here: the approval
-- record is what the business was admitted on, and replacing it is a re-review, not an
-- edit.
--
-- Everything else is 0248's read, unchanged, so the two cannot drift apart.
-- ═══════════════════════════════════════════════════════════════════════════════

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
    'documents', CASE WHEN v_documents IS NULL THEN NULL ELSE jsonb_build_object(
      'logo',       v_documents -> 'logo',
      'licence',    v_documents -> 'licence',
      'cnic_front', v_documents -> 'cnic_front',
      'cnic_back',  v_documents -> 'cnic_back'
    ) END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_business_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';
