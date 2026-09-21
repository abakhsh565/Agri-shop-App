-- MERGED: two files shared migration version 0091, which makes a
-- fresh `supabase db push` fail with a duplicate key on
-- supabase_migrations.schema_migrations. Both bodies follow, in the order the
-- runner would have applied them:
--   1. 0091_grant_role_permissions.sql
--   2. 0091_grant_service_role_permissions.sql

-- Grant proper permissions to Supabase roles for test infrastructure
-- The service_role needs direct table access for PostgREST visibility checks
-- The authenticated role needs access for RPC authorization testing

-- Service role: full access (bypasses RLS anyway)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- Authenticated: CRUD access (RLS controls actual visibility)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Anon: SELECT + limited INSERT/UPDATE (for RLS-based testing)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO anon;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- Grant service_role full access to all public tables
-- This is needed so PostgREST can verify fixture visibility in test setup
-- (service_role bypasses RLS but still needs GRANTs for table access)
-- anon and authenticated access is controlled by RLS policies, NOT grants

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
