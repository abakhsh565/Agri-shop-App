-- Change shop_requests.status from text to ENUM with 4 options
-- This makes Supabase Table Editor show a dropdown instead of a text field

-- Create the enum type
DO $$ BEGIN
  CREATE TYPE shop_request_status AS ENUM ('pending', 'approved', 'hold', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Update any existing values that don't match the new enum
UPDATE shop_requests SET status = 'pending' WHERE status NOT IN ('pending', 'approved', 'hold', 'rejected');

-- Change column type
ALTER TABLE shop_requests
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE shop_request_status USING status::shop_request_status,
  ALTER COLUMN status SET DEFAULT 'pending';
