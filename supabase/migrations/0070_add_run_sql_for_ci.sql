-- Migration 0070: Add run_sql function for CI test infrastructure
-- This function allows test setup/teardown to execute SQL via the Supabase HTTP API
-- (which uses Cloudflare CDN with IPv4 support) instead of direct PostgreSQL connections.
--
-- SECURITY: This function:
-- 1. Runs as postgres (SECURITY DEFINER) to bypass RLS
-- 2. Is intended ONLY for the QA database — never deploy to production
-- 3. Should be removed after CI testing is complete if desired

-- Drop first to avoid return type conflicts
DROP FUNCTION IF EXISTS run_sql(text) CASCADE;

CREATE OR REPLACE FUNCTION run_sql(sql_query text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $FN$
BEGIN
  RETURN (EXECUTE sql_query)::text;
END;
$FN$;

-- Grant execute to all roles used by tests
GRANT EXECUTE ON FUNCTION run_sql(text) TO authenticated;
GRANT EXECUTE ON FUNCTION run_sql(text) TO service_role;
