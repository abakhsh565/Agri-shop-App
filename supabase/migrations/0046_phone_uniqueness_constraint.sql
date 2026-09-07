-- ============================================================
-- Add UNIQUE constraint on customers.phone
-- ============================================================
-- Prevents duplicate phone numbers at the database level.
-- Frontend validation catches most cases, but direct API
-- requests could previously bypass it.
-- ============================================================

-- First, check for and remove any existing duplicate phones
-- (keep the earliest created record for each phone)
DELETE FROM customers a USING customers b
WHERE a.phone = b.phone
  AND a.phone IS NOT NULL
  AND a.phone != ''
  AND a.created_at > b.created_at;

-- Add the UNIQUE constraint
ALTER TABLE customers ADD CONSTRAINT customers_phone_unique UNIQUE (phone);

NOTIFY pgrst, 'reload schema';
