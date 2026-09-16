-- Fix shop_requests table: add columns that migration 0019 defined but weren't created
-- This happened because the table was created by an earlier migration with fewer columns

ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS owner_phone varchar(20);
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS shop_address text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS shop_city varchar(100);
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS shop_type varchar(50) DEFAULT 'retail';
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS business_registration_number varchar(100);
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS cnic_front_url text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS cnic_back_url text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS business_license_url text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE shop_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Fix reviewed_by column type (was varchar, should be uuid FK to users)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_requests'
    AND column_name = 'reviewed_by'
    AND data_type = 'character varying'
  ) THEN
    ALTER TABLE shop_requests DROP CONSTRAINT IF EXISTS shop_requests_reviewed_by_fkey;
    ALTER TABLE shop_requests ALTER COLUMN reviewed_by TYPE uuid USING reviewed_by::uuid;
  END IF;
END $$;

-- Fix broken RLS policies (previous migration created policies with with_check=false)
DROP POLICY IF EXISTS shop_requests_insert_anon ON shop_requests;
DROP POLICY IF EXISTS shop_requests_select_anon ON shop_requests;
DROP POLICY IF EXISTS shop_requests_update_anon ON shop_requests;

CREATE POLICY shop_requests_insert_public ON shop_requests FOR INSERT WITH CHECK (true);
CREATE POLICY shop_requests_select_own ON shop_requests FOR SELECT USING (owner_phone = current_setting('request.headers')::json->>'x-phone');
CREATE POLICY shop_requests_select_admin ON shop_requests FOR SELECT USING (app_is_admin());
CREATE POLICY shop_requests_update_admin ON shop_requests FOR UPDATE USING (app_is_admin()) WITH CHECK (app_is_admin());

-- Ensure proper grants
GRANT INSERT, SELECT ON shop_requests TO anon;
GRANT INSERT, SELECT ON shop_requests TO authenticated;
GRANT ALL ON shop_requests TO service_role;
