-- ═══════════════════════════════════════════════════════════════════════════════
-- 0247 — The business profile can read the record its owner gave at signup
--
-- Settings gained a Business profile screen. Every field on it is something the
-- owner already supplied, in two places:
--
--   • `shops` — the name, phone, address, join code and marketplace answer of the
--     business itself.
--   • `shop_requests` — what the signup form asked: shop type, city, the address
--     the map returned, the registration number and the logo. That table is
--     RLS-protected with no client policy, and the approval path has never kept a
--     link from the request to the shop it produced.
--
-- This function is that read, and it is deliberately narrow:
--
--   • who may call it — an ACTIVE OWNER OR ADMIN of the CURRENT shop. A registration
--     record belongs to the business, not to every person working in it;
--   • what it can name — `current_shop_id()` only. There is no shop parameter, so the
--     function cannot be pointed at another business;
--   • what it returns — business fields only. The approval queue also holds the
--     owner's CNIC front/back and a business licence; those are identity documents,
--     not profile data, and are NOT returned here. A screen that lists them would be
--     one screenshot away from leaking somebody's ID card;
--   • read-only — STABLE, no writes anywhere.
--
-- THE LINK. There is no request id on `shops`, so the request is found by what the
-- two records share: the normalised owner phone and the shop name. A shop renamed
-- after approval no longer matches on name, so a phone that owns exactly ONE
-- approved request is accepted on its own — the only unambiguous fallback. A phone
-- with several approved requests and no name match returns no registration block,
-- and the screen says the record is not linked rather than showing another shop's
-- answers.
--
-- LINEAGE. `shop_requests` is not identical in every environment (production's
-- has 18 columns and no `phone`; staging's has 23 — see 0200 and
-- `get_my_shop_request`). Every column this function reads from it therefore goes
-- through `to_jsonb(sr)`, which answers NULL for a key the row type does not have,
-- instead of failing to compile on a database that never had the column. `shops`
-- is read the same way, so a missing optional column shows as "not provided" on
-- the screen rather than breaking the read.
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
     AND public.canonical_phone(
           COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')
         ) = v_phone
     AND to_jsonb(sr) ->> 'shop_name' = v_shop_row ->> 'name'
   ORDER BY sr.created_at DESC
   LIMIT 1;

  IF v_registration IS NULL AND v_phone IS NOT NULL THEN
    SELECT count(*)
      INTO v_matches
      FROM public.shop_requests sr
     WHERE sr.status = 'approved'
       AND public.canonical_phone(
             COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')
           ) = v_phone;

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
         AND public.canonical_phone(
               COALESCE(to_jsonb(sr) ->> 'owner_phone', to_jsonb(sr) ->> 'phone')
             ) = v_phone
       LIMIT 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'shop', jsonb_build_object(
      'id',                  v_shop_row -> 'id',
      'name',                v_shop_row -> 'name',
      'phone',               v_shop_row -> 'phone',
      'address',             v_shop_row -> 'address',
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

REVOKE EXECUTE ON FUNCTION public.get_business_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';
