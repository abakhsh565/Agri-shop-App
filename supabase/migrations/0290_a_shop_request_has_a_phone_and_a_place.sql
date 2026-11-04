-- 0290 — A shop request has a phone and a place.
--
-- WHY THIS EXISTS. `insert_shop_request` writes the applicant's phone and the map-picked place
-- (0172). Production's `shop_requests` predates those columns: it has the older 18-column shape,
-- while staging has 23. The production registration therefore fails before the request is stored:
--
--   column "phone" of relation "shop_requests" does not exist
--
-- WHAT THIS DOES. Adds the same five nullable columns staging already has, backfills the contact
-- phone from the login phone on older rows, and adds the same Pakistan point constraint used by
-- customers, branches and shops. It does not create, delete or rewrite any request, and it does
-- not change the registration function.
--
-- WHY IT IS SAFE TO APPLY. Every column is IF NOT EXISTS. The backfill only fills a NULL phone on
-- rows that already have an owner_phone. The constraint is added only when it is absent and only
-- accepts complete coordinates inside the same box as 0172; an empty coordinate pair is allowed.

ALTER TABLE public.shop_requests ADD COLUMN IF NOT EXISTS phone varchar(20);
ALTER TABLE public.shop_requests ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE public.shop_requests ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE public.shop_requests ADD COLUMN IF NOT EXISTS location_label text;
ALTER TABLE public.shop_requests ADD COLUMN IF NOT EXISTS location_source text;

UPDATE public.shop_requests
SET phone = owner_phone
WHERE phone IS NULL
  AND owner_phone IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'shop_requests_location_in_pakistan'
      AND conrelid = 'public.shop_requests'::regclass
  ) THEN
    ALTER TABLE public.shop_requests
      ADD CONSTRAINT shop_requests_location_in_pakistan CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (
          latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN 23.0 AND 37.5
          AND longitude BETWEEN 60.0 AND 78.0
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.shop_requests.phone IS
  'The contact phone supplied with the registration. Existing rows fall back to owner_phone.';

NOTIFY pgrst, 'reload schema';
