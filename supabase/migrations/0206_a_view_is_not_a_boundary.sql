-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A VIEW IS NOT A BOUNDARY
--
-- MEASURED 2026-10-15, QA database, as a real authenticated session (JWT → PostgREST), tenant A,
-- with tenant A's context resolved to its own shop — the control that makes the reading mean
-- something, so this is not a session with no context failing closed:
--
--   resolve_active_shop(A)                     → 00000000-…-0001   (context IS live)
--   SELECT id FROM shops   WHERE id = <own>    → 1 row             (control: the TABLE works)
--   SELECT id FROM shops   WHERE id = <other>  → 0 rows            (the TABLE refuses)
--   SELECT id FROM tenants WHERE id = <other>  → 1 row             (the VIEW hands it over)
--   SELECT id,name FROM tenants               → 4 rows            every business in the database
--                                                ("fdfdfds", "Baba jaani", "Default Shop", …)
--
-- WHY THE VIEW DIFFERS FROM ITS TABLE
--   `public.tenants` was created by 0094 as a backward-compatibility ALIAS for `shops`
--   (`CREATE OR REPLACE VIEW tenants AS SELECT id, name, phone, address, owner_id, created_at
--   FROM shops`) and granted to `authenticated` — at a time when `shops` had no RLS at all, so an
--   alias was harmless. `shops` later gained RLS with the policy `shops_select_own
--   USING (id = current_shop_id())`. The alias never gained the same boundary, because a view
--   does not inherit its base table's RLS when the view is owned by a role that bypasses RLS:
--
--     pg_class.relowner            → postgres
--     pg_roles.rolbypassrls        → true  for postgres
--     pg_class.reloptions          → NULL  (no security_invoker)
--     the view body                → no WHERE clause of any kind
--
--   A view carries no policies of its own, so its only possible boundaries are its body, its grants
--   or `security_invoker`. This one had none: it re-opened, for every logged-in user of every
--   business, a read of every other business's name, phone, address, owner_id and created_at —
--   reachable with a single `GET /rest/v1/tenants?select=*` and no elevated role.
--
-- FIX AT THE SMALLEST CORRECT LAYER
--   Make the view read AS THE CALLER, so `shops_select_own` — the single definition of "which shop
--   is mine" — becomes the boundary. The name, columns and purpose survive unchanged, so any
--   consumer doing `select id, name from tenants` still gets its own tenant.
--   Nothing in the application reads this view (`grep` over src/ finds no reference; the only
--   consumer of any of the four views is `product_variants_public` in productsStore), so this
--   cannot change product behaviour — it only removes a cross-tenant read path.
--
--   `product_variants_public` is NOT changed: its body already filters on `current_shop_id()` and
--   measurement confirms it (own row 1, tenant B's 0). `marketplace_listings` is NOT changed: it is
--   anon-readable BY DESIGN, gated by the owner's own opt-in flags in its body, and `security_invoker`
--   would break it, because `anon` has no access to the base tables. `users_public` is NOT changed:
--   0167 revoked it from anon and authenticated and granted it to service_role only, with its own
--   assertions — its boundary is the grant, and measurement confirms `permission denied for view
--   users_public` (SQLSTATE 42501) for an authenticated and for an anonymous caller.
--
-- WHY THIS IS GUARDED FOR ABSENCE
--   The view is NOT in every environment, and that was measured rather than assumed: the recorded
--   production schema (supabase/baseline/production-baseline.json, captured read-only 2026-10-01)
--   lists `structure.views = ["product_variants_public", "users_public"]` — no `tenants` — and
--   `node scripts/verify-forward-on-baseline.mjs --baseline production --since 0206` answered
--   `relation "public.tenants" does not exist` for the unguarded form of this file. Production never
--   received 0094's lineage; it moves only by individually verified NEW files. This migration
--   therefore bounds the alias wherever it exists and reports the absence where it does not,
--   instead of failing the release gate in an environment that has nothing to bound.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_options text[];
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE NOTICE '0206: no public.tenants view in this schema — nothing to bound';
    RETURN;
  END IF;

  EXECUTE 'ALTER VIEW public.tenants SET (security_invoker = true)';

  -- The fix is only a fix if the option took AND the boundary it delegates to still exists. Assert
  -- all three, so a future migration that drops the shops policy fails loudly here instead of
  -- silently reopening the view.
  SELECT reloptions INTO v_options FROM pg_class WHERE oid = 'public.tenants'::regclass;
  IF NOT ('security_invoker=true' = ANY (coalesce(v_options, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION '0206: the tenants view still runs with its owner''s privileges';
  END IF;

  IF NOT (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid = 'public.shops'::regclass) THEN
    RAISE EXCEPTION '0206: shops has RLS disabled — the view now has no boundary to delegate to';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'shops' AND cmd = 'SELECT'
       AND coalesce(qual, '') LIKE '%current_shop_id%'
  ) THEN
    RAISE EXCEPTION '0206: shops lost its own-shop SELECT policy — the view would return nothing';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
