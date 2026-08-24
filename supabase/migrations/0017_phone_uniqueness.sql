-- ═══════════════════════════════════════════════════════════════════════════════
-- 0017: Phone number uniqueness + existing duplicate cleanup
-- ═══════════════════════════════════════════════════════════════════════════════

-- First, clean up any existing duplicates by archiving older duplicates
-- Keep the earliest created customer for each phone number
WITH duplicates AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY phone, shop_id
      ORDER BY created_at ASC
    ) AS rn
  FROM customers
  WHERE phone IS NOT NULL AND phone != ''
)
UPDATE customers SET is_archived = true, archived_at = now()
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Add unique partial index (only non-archived customers per phone per shop)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_unique
  ON customers(phone, shop_id)
  WHERE phone IS NOT NULL AND phone != '' AND (is_archived IS NULL OR is_archived = false);

-- Also add a plain unique constraint for active customers
ALTER TABLE customers
  ADD CONSTRAINT unique_customer_phone_per_shop
  UNIQUE USING INDEX idx_customers_phone_unique;
