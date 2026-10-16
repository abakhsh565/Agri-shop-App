-- ═══════════════════════════════════════════════════════════════════════════════
-- 0186 — The Branches read carries its marketplace state
--
-- WHY THIS IS NEEDED. 0184 gave every branch a marketplace switch and a coverage radius, and a
--   guarded writer to change them. The screen that manages a branch reads `get_my_branches()`,
--   and that function did not return either value — so the owner would have been shown a switch
--   that could not display what it currently was. A control that cannot state its own value is
--   the same defect 0173 fixed for the location pin, where the edit sheet read the row from a
--   query that was allowed to return nothing and then reported "never pinned" about a branch that
--   was pinned.
--
-- WHY NOT READ `shops` DIRECTLY. `shops` has exactly one SELECT policy, `id = current_shop_id()`,
--   so a screen may read the branch it is standing in and no other. 0173 already settled this:
--   `get_my_branches()` is the one read allowed to see every branch the caller belongs to,
--   because it is SECURITY DEFINER and answers only about the caller's own memberships. Widening
--   the `shops` policy to fix one screen's display would make every column of every branch
--   readable instead.
--
-- WHY THE WHOLE FUNCTION IS RECREATED. A function's `RETURNS TABLE` is part of its signature and
--   `CREATE OR REPLACE` cannot change it; the DROP is required, not stylistic, and the grants are
--   re-issued below because a dropped function takes its privileges with it. This is the same
--   shape as 0173.
--
-- NOTHING ELSE MOVES. Same row set (the caller's memberships), same order (the account's home
--   branch first, then oldest first), same counts, same place columns. Two columns are appended.
--
-- WHO MAY SEE IT. The caller's own branches only, as before. The radius is an operating decision
--   rather than a secret, but it is the owner's business, and this read is scoped to their own
--   memberships either way.
--
-- VERIFIED BY: tests/integration/marketplaceContract.test.ts — the owner sets a branch's switch
--   and radius through the writer, and the value is the one the branch row then reports.
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
  location_source   text,
  -- The branch's marketplace decision, as stored by 0184. Read together with the place because
  -- the two are answered together on screen: a branch with no pin cannot serve the marketplace,
  -- and the switch is refused for one — so the screen needs both to say anything true.
  marketplace_enabled   boolean,
  marketplace_radius_km numeric
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
         s.location_source,
         s.marketplace_enabled,
         s.marketplace_radius_km
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
  'Every branch (shop) the caller is a member of, the main one first, with the counts the Branches screen states before a delete, the place the branch was pinned to, and its farmer-marketplace switch and coverage. The caller''s own memberships only — this is the one read allowed to see a branch the account is not standing in.';

NOTIFY pgrst, 'reload schema';
