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
