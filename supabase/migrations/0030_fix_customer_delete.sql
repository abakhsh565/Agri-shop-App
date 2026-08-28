-- Fix customer delete/archive on both Admin and Employee sides
-- Run this SQL in Supabase Dashboard → SQL Editor if delete is not working

-- 1. Ensure is_archived columns exist on customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS archived_by uuid;

-- 2. Create archive_customer function (drop old signatures first)
DROP FUNCTION IF EXISTS archive_customer(p_uuid, p_uuid);
DROP FUNCTION IF EXISTS archive_customer(uuid, uuid);
DROP FUNCTION IF EXISTS archive_customer(p_customer_id uuid, p_archived_by uuid);

CREATE OR REPLACE FUNCTION archive_customer(p_customer_id uuid, p_archived_by uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers SET
    is_archived = true,
    archived_at = now(),
    archived_by = COALESCE(p_archived_by, NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
  WHERE id = p_customer_id;
END;
$$;

-- 3. Create restore_customer function
DROP FUNCTION IF EXISTS restore_customer(p_uuid);
DROP FUNCTION IF EXISTS restore_customer(p_customer_id uuid);

CREATE OR REPLACE FUNCTION restore_customer(p_customer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers SET
    is_archived = false,
    archived_at = NULL,
    archived_by = NULL
  WHERE id = p_customer_id;
END;
$$;

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION archive_customer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION restore_customer(uuid) TO authenticated;

-- 5. Create index if missing
CREATE INDEX IF NOT EXISTS idx_customers_is_archived ON customers (is_archived);
