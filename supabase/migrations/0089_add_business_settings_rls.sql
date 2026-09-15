-- Migration 0089: Add RLS policies + grants for business_settings
-- business_settings had RLS enabled but no policies, causing PostgREST 406 errors
-- Also missing GRANTs for service_role, causing 403 errors

-- Ensure proper grants
GRANT ALL ON business_settings TO service_role;
GRANT ALL ON business_settings TO authenticated;
GRANT SELECT ON business_settings TO anon;

-- SELECT: allow all roles to read settings
CREATE POLICY IF NOT EXISTS business_settings_select
  ON business_settings FOR SELECT
  USING (true);

-- INSERT: allow authenticated users to create settings
CREATE POLICY IF NOT EXISTS business_settings_insert
  ON business_settings FOR INSERT
  WITH CHECK (true);

-- UPDATE: allow authenticated users to update settings
CREATE POLICY IF NOT EXISTS business_settings_update
  ON business_settings FOR UPDATE
  USING (true);
