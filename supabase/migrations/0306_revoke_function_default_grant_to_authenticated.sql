-- 0306: revoke the FUNCTIONS default grant to authenticated (FOR ROLE postgres)
--
-- Root cause (proven 2026-11-11, prod-acl-probe run 42958894466 on main f4292c8):
-- production's pg_default_acl holds, in schema public, a FUNCTIONS entry
-- FOR ROLE postgres granting EXECUTE to authenticated:
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Migrations run as current_user='postgres', so every function 0266 CREATEs
-- acquires authenticated EXECUTE at creation time; 0266's
-- REVOKE ALL ... FROM PUBLIC, anon cannot remove that named grant, so its
-- DO-block assertion (has_function_privilege('authenticated')) fires and the
-- batch-1 rehearsal fails. 0242 passes only because it revokes authenticated
-- by name. 0266 is already recorded on QA, so it must not be edited; the
-- default grant is removed here instead.
-- The FOR ROLE supabase_admin FUNCTIONS entry (same grant list, grantor
-- supabase_admin) is OUT OF SCOPE: it applies only to objects supabase_admin
-- creates, and postgres cannot alter it (not superuser, not a member — probe
-- Q1/Q2). Only the FOR ROLE postgres entry affects migration-created functions.
-- Must apply BEFORE batch 1 (0233-0276), as its own apply: the default grant
-- must be gone before 0266 CREATEs co_owner_sync_membership, so it cannot
-- ride inside the batch-1 transaction.

-- 1. Remove the default grant, only if the entry exists (no-op where the
--    entry is absent, e.g. a fresh database that never had it).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_default_acl
     WHERE defaclnamespace = 'public'::regnamespace
       AND defaclobjtype = 'f'
       AND defaclrole = 'postgres'::regrole
       AND defaclacl::text LIKE '%authenticated=X%'
  ) THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
  END IF;
END $$;

-- 2. Self-check: no FUNCTIONS default grant to authenticated may remain for
--    the postgres role in schema public.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_default_acl
     WHERE defaclnamespace = 'public'::regnamespace
       AND defaclobjtype = 'f'
       AND defaclrole = 'postgres'::regrole
       AND defaclacl::text LIKE '%authenticated=X%'
  ) THEN
    RAISE EXCEPTION '0306: FUNCTIONS default grant to authenticated (FOR ROLE postgres, schema public) is still present';
  END IF;
END $$;

-- 3. Defensive: if co_owner_sync_membership already exists (it does not on
--    production yet — probe Q6 counted 0), strip authenticated from it as
--    well. Guarded so this is a no-op, never an error, when the function is
--    absent.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'co_owner_sync_membership'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.co_owner_sync_membership(uuid) FROM authenticated;
  END IF;
END $$;
