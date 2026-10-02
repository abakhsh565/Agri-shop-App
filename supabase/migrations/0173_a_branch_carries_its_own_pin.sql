-- ═══════════════════════════════════════════════════════════════════════════════
-- 0173 — A branch carries its own pin, from the list that already lists it
--
-- THE BUG THIS FIXES, found in the browser. Editing a branch that is NOT the one the account is
--   currently working in always showed "Choose on the map" — as if that branch had never been
--   pinned — even when its pin was in the database. The cause was not the picker: the edit sheet
--   read the row with `select … from shops where id = …`, and `shops` has exactly one SELECT
--   policy, `id = current_shop_id()`. That policy is right (you may read the shop you are working
--   in and no other), so the query for a different branch returned an empty array, not an error,
--   and the screen turned "you may not read this row" into "this branch has no location". A picker
--   that lies about the stored value is worse than one that fails: it invites somebody to re-pick
--   a location that was already right, on a screen that says nothing was ever there.
--
-- WHAT THIS CHANGES. `get_my_branches()` — the one read the Branches screen already makes, and the
--   only one that is allowed to see every branch the caller is a member of, because it is SECURITY
--   DEFINER and answers only about the caller's own memberships — now returns the place with the
--   rest of the branch: `address`, `latitude`, `longitude`, `location_label`, `location_source`.
--   The screen then reads the pin from the same row it read the name from, in the same call, and no
--   screen ever has to ask `shops` about a branch it is not standing in.
--
-- WHY THE WHOLE FUNCTION IS RECREATED. A function's `RETURNS TABLE` is part of its signature and
--   `CREATE OR REPLACE` cannot change it; the DROP is required, not stylistic, and the grants are
--   re-issued below because a dropped function takes its privileges with it.
--
-- WHY NOT WIDEN THE `shops` POLICY. Relaxing `shops_select_own` to "any branch of my tenant" would
--   make every other column of every branch readable to fix one screen's display. The data that
--   belongs on the Branches screen is what `get_my_branches()` returns; nothing else changes.
--
-- NOTHING ELSE MOVES. Same row set (the caller's memberships), same order (the account's home
--   branch first, then oldest first), same counts. Five columns are appended.
--
-- VERIFIED BY: tests/integration/branchPlaceRead.test.ts — the caller sees the pin of a branch they
--   are not standing in, a stranger's branch id still returns nothing, and the app-side read in
--   `BranchEditSheet` no longer touches `shops`.
-- ═══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_my_branches();

CREATE FUNCTION public.get_my_branches()
RETURNS TABLE (
  shop_id           uuid,
  name              text,
  membership_role   membership_role,
  membership_status membership_status,
  is_current        boolean,
  is_main           boolean,
  created_at        timestamptz,
  employee_count    int,
  product_count     int,
  customer_count    int,
  sales_count       int,
  sales_total       numeric,
  -- The place, as stored by 0172. All four arrive together or not at all (the table CHECK
  -- enforces that), so a row with coordinates always has a source, and a row without them is a
  -- branch that has never been pinned rather than one whose pin was lost.
  address           text,
  latitude          double precision,
  longitude         double precision,
  location_label    text,
  location_source   text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT (SELECT u.shop_id FROM users u WHERE u.id = app_current_user_id()) AS home
  )
  SELECT m.tenant_id,
         s.name::text,
         m.role,
         m.status,
         (m.tenant_id = public.current_shop_id()),
         (m.tenant_id = (SELECT home FROM me)),
         s.created_at,
         (SELECT count(*) FROM memberships  x WHERE x.tenant_id = m.tenant_id AND x.status = 'active')::int,
         (SELECT count(*) FROM products     p WHERE p.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM customers    c WHERE c.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM sales        v WHERE v.shop_id   = m.tenant_id)::int,
         (SELECT COALESCE(sum(v.total_amount), 0) FROM sales v WHERE v.shop_id = m.tenant_id),
         s.address,
         s.latitude,
         s.longitude,
         s.location_label,
         s.location_source
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = app_current_user_id()
   -- The branch this account registered with reads first; the rest follow in the
   -- order they were created, so the list does not reshuffle between reads.
   ORDER BY (m.tenant_id = (SELECT home FROM me)) DESC, s.created_at ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;

COMMENT ON FUNCTION public.get_my_branches() IS
  'Every branch (shop) the caller is a member of, the main one first, with the counts the Branches screen states before a delete and the place the branch was pinned to. The caller''s own memberships only — this is the one read allowed to see a branch the account is not standing in.';
