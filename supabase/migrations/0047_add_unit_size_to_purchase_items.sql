-- 0047: Add missing unit_size column to purchase_items
-- The create_purchase RPC (migrations 0027-0029) inserts unit_size but the column
-- was never added to the table, causing "column unit_size does not exist" error.

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS unit_size numeric(14,4) NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
