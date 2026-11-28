-- 0342 — the farmer can ring the shop.
--
-- WHAT WAS WRONG. `farmer_shop_profile` published `phone` and `whatsapp_phone`, and on the QA shops
-- both are null: a branch created by the onboarding flow keeps the owner's number on his user
-- record, and the business profile screen shows exactly that (`user.phone ?? shop.phone`). The
-- farmer app, reading only the shop's two columns, therefore had no number to show for any of
-- them — the chat header, the shop card and the shop's page were all silent.
--
-- WHAT THIS ADDS. One field, `contact_phone`: the shop's own landline, else its WhatsApp line, else
-- the owner's business number — the same number the dealer sees on his own business profile. No
-- new personal data is published: the owner's name was already in this profile, and this is the
-- contact number the business presents to its customers.
--
-- NOTHING ELSE CHANGES. Every existing key stays, the withheld keys stay withheld, and the three
-- reader doors keep calling this one definition.

CREATE OR REPLACE FUNCTION public.farmer_shop_profile(p_shop public.shops)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'shop_id',        p_shop.id,
    'name',           p_shop.name,
    'city',           p_shop.city,
    'address',        p_shop.address,
    'phone',          p_shop.phone,
    'whatsapp_phone', p_shop.whatsapp_phone,
    -- The number a farmer can actually ring. The dealer's own business profile treats the owner's
    -- number as the shop's contact when no branch line is set; a farmer asking "where do I call"
    -- must get the same answer the counter gives.
    'contact_phone',  COALESCE(
                        p_shop.phone,
                        p_shop.whatsapp_phone,
                        (SELECT u.phone FROM public.users u WHERE u.id = p_shop.owner_id)
                      ),
    'shop_type',      p_shop.shop_type,
    'logo_url',       p_shop.logo_url,
    -- ~11 m, the same rounding the public marketplace contract already applies (0185), so the two
    -- doors cannot disagree about where a branch is.
    'latitude',       round(p_shop.latitude::numeric, 4),
    'longitude',      round(p_shop.longitude::numeric, 4),
    'location_label', p_shop.location_label,
    -- The human the farmer is dealing with. A display name, never the owner's user id: the id is a
    -- key into the shop session and has no business on a farmer's screen.
    'owner_name',     (SELECT u.name FROM public.users u WHERE u.id = p_shop.owner_id),
    -- Registered with a number on file: what "a real shop" means to a buyer, without publishing the
    -- number itself.
    'is_verified',    (p_shop.registration_number IS NOT NULL)
  )
$$;

COMMENT ON FUNCTION public.farmer_shop_profile(public.shops) IS
  'The public profile of one branch as a farmer may see it: contact (shop line, else WhatsApp, else the owner business number), pin, place label, owner display name and a verified flag. Withholds join_code, email, licence/CNIC URLs, owner_id and the registration number itself.';

REVOKE ALL ON FUNCTION public.farmer_shop_profile(public.shops) FROM PUBLIC, anon, authenticated;
