-- ═══════════════════════════════════════════════════════════════════════════════
-- 0184 — A branch decides whether, and how far, it serves the marketplace
--
-- WHAT THIS IS FOR. The Owner side is being prepared so that a future Farmer App can connect to
--   a contract that already exists, instead of forcing another database redesign later. The
--   first half of that contract is a decision only a branch can make: "we list on the
--   marketplace, and we will serve up to this far from here."
--
-- WHY A BRANCH AND NOT A SHOP. In this schema they are the same row, and that is not a
--   coincidence to be worked around — it is the model the app already presents. `get_my_branches()`
--   (0168, 0173) returns `m.tenant_id` joined to `shops`, `shopStore` maps `r.shop_id` to
--   `Branch.id`, and `BranchEditSheet` writes the location with `set_place(p_table => 'shops',
--   p_id => branch.id)`. So "Branch A Lahore / Branch B Multan" is two `shops` rows today, each
--   already carrying its own pin from 0172. A product belongs to one of them through
--   `products.shop_id`, and its stock sits on `product_variants` reached through that product.
--
--   The `branches` table is a finer structure — a shop's own sub-locations (`… - Main`,
--   `… - Warehouse`), used to stamp where an inventory movement happened. It is deliberately NOT
--   used here: a listing is a public promise made by a place a farmer can travel to, and that is
--   the shop row. Nothing in this migration reads or writes `branches`.
--
-- WHY COVERAGE IS STORED AND NOT ASSUMED. The requirement is that a branch outside the applicable
--   coverage must not appear even when it has the product in stock, and that a farmer's search
--   radius also applies. Those are two different promises — "how far will you deliver" is the
--   branch's, "how far will I travel" is the farmer's — and a single radius would silently
--   conflate them. Storing the branch's own answer means the eligibility rule can be the honest
--   `LEAST()` of the two later, and the owner is never shown as serving somewhere they never
--   agreed to serve.
--
-- WHY NOT A SEPARATE "marketplace_branches" TABLE. It would duplicate the branch's identity,
--   location and membership for no gain, and the Owner App must stay the single source of truth.
--   Two columns on the row that already IS the branch is the whole change.
--
-- THE DEFAULT IS OFF, ON PURPOSE. `marketplace_enabled` defaults to false, so no existing branch
--   becomes publicly listed because a migration ran. Listing is an act the owner performs.
--
-- NOTHING IS MOVED OR DESTROYED. Additive columns with defaults, one guarded writer. No existing
--   column is altered, no row is rewritten, and no policy on `shops` changes — which matters,
--   because `shops_select_own` is what keeps a branch readable only to the account standing in it.
--
-- VERIFIED BY: tests/integration/marketplaceContract.test.ts — a branch with the switch off is
--   absent from the contract; a branch with no pin is absent; the radius is refused outside 1–200;
--   and a caller who is not an owner/admin of THAT branch cannot flip it.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The branch's marketplace decision ──────────────────────────────────────
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS marketplace_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS marketplace_radius_km numeric NOT NULL DEFAULT 25;

-- A branch that serves the marketplace serves a real, bounded distance. The floor stops a
-- zero-or-negative radius (which would make a listing permanently invisible while the switch
-- said "on" — a state that reads as a bug and is impossible to explain to the owner), and the
-- ceiling stops a typo like 25000 turning a branch into a nationwide shop.
ALTER TABLE public.shops
  DROP CONSTRAINT IF EXISTS shops_marketplace_radius_range;
ALTER TABLE public.shops
  ADD CONSTRAINT shops_marketplace_radius_range
  CHECK (marketplace_radius_km >= 1 AND marketplace_radius_km <= 200);

COMMENT ON COLUMN public.shops.marketplace_enabled IS
  'Whether this branch (a shops row) offers its listed products to the farmer marketplace. False by default: listing is an act the owner performs, never a consequence of deploying.';
COMMENT ON COLUMN public.shops.marketplace_radius_km IS
  'How far from this branch''s pinned location it will serve marketplace buyers, in kilometres (1–200). The eligibility rule takes the LEAST of this and the searcher''s own radius, so a branch is never shown outside the distance it agreed to.';

-- ── 2. The one writer for that decision ───────────────────────────────────────
-- Authority is stated twice, deliberately, and both statements are needed. `authorize_business_action`
-- is the app-wide gate every settings write carries; the membership check names THIS branch,
-- because a gate that only asked "are you an owner somewhere" would let an owner of one branch
-- turn another branch's marketplace switch on.
CREATE OR REPLACE FUNCTION public.set_marketplace_settings(
  p_shop_id  uuid,
  p_enabled  boolean,
  p_radius_km numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_role   membership_role;
  v_before record;
  v_radius numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage marketplace listing';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can manage marketplace listing';
  END IF;

  SELECT s.marketplace_enabled, s.marketplace_radius_km, s.latitude, s.longitude
    INTO v_before
    FROM shops s
   WHERE s.id = p_shop_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  -- A radius is only meaningful when the branch is listed, but it is stored either way: turning
  -- the switch off must not throw away the distance the owner already chose, or switching back on
  -- would silently reset their decision to the default.
  v_radius := COALESCE(p_radius_km, v_before.marketplace_radius_km);
  IF v_radius IS NULL OR v_radius < 1 OR v_radius > 200 THEN
    RAISE EXCEPTION 'VALIDATION: the marketplace radius must be between 1 and 200 kilometres';
  END IF;

  -- Turning the switch on for a branch with no pin is refused rather than accepted-and-ignored.
  -- Distance cannot be measured from a place that was never picked, so such a branch could never
  -- appear; accepting the switch would tell the owner they had listed when they had not.
  IF p_enabled AND (v_before.latitude IS NULL OR v_before.longitude IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION: this branch has no location, so it cannot serve the marketplace';
  END IF;

  UPDATE shops
     SET marketplace_enabled   = p_enabled,
         marketplace_radius_km = v_radius
   WHERE id = p_shop_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'marketplace_settings_changed', 'shop', p_shop_id,
          jsonb_build_object(
            'enabled', p_enabled,
            'radius_km', v_radius,
            'was_enabled', v_before.marketplace_enabled,
            'was_radius_km', v_before.marketplace_radius_km
          ));

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'marketplace_enabled', p_enabled,
    'marketplace_radius_km', v_radius
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_marketplace_settings(uuid, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_marketplace_settings(uuid, boolean, numeric) TO authenticated;

COMMENT ON FUNCTION public.set_marketplace_settings(uuid, boolean, numeric) IS
  'Turns one branch''s farmer-marketplace listing on or off and sets how far it will serve (1–200 km). Requires an active owner/admin membership of that branch, and refuses to list a branch that has no pinned location.';

NOTIFY pgrst, 'reload schema';
