-- =====================================================
-- ADMIN SQL: Clean up Integration Test v3 data
-- Run in Supabase Dashboard SQL Editor
-- =====================================================

-- 1. Delete test sale items (must go before sales due to FK)
DELETE FROM sale_items WHERE sale_id IN (
  '9932416e-ffd7-4d6c-ac0b-f4de78f41d30',
  '423b2362-ff18-4088-b252-dbbe5b35eedf',
  '992df52d-4d65-42ab-a9fe-5c5676af507d',
  '79a8cd6f-5afd-462f-ac1e-911b75ddb00a'
);

-- 2. Delete test sales
DELETE FROM sales WHERE id IN (
  '9932416e-ffd7-4d6c-ac0b-f4de78f41d30',
  '423b2362-ff18-4088-b252-dbbe5b35eedf',
  '992df52d-4d65-42ab-a9fe-5c5676af507d',
  '79a8cd6f-5afd-462f-ac1e-911b75ddb00a'
);

-- 3. Delete test payments
DELETE FROM customer_payments WHERE notes IN (
  'Integration test partial',
  'Integration test full',
  'Integration test overpay',
  'Integration test return',
  'test'
);

-- 4. Delete test return records
-- (returns are tracked as 'returned' status sales — none exist from this test)

-- 5. Delete test reminder configs and occurrences
DELETE FROM reminder_occurrences WHERE config_id IN (
  SELECT id FROM reminder_configs
);
DELETE FROM reminder_configs WHERE id IS NOT NULL;

-- 6. Restore Bilal Ahmed to correct baseline
-- Bilal's original sales (pre-test) give:
-- total_purchases = 9010
-- outstanding_balance = 3880
UPDATE customers SET
  outstanding_balance = 3880,
  total_purchases = 9010
WHERE id = '00000000-0000-0000-0000-000000000052';

-- 7. Restore Hybrid Maize Seed stock
UPDATE products SET stock_qty = 46.5
WHERE id = '00000000-0000-0000-0000-000000000020';

-- 8. Verify
SELECT 'customers' as tbl, count(*) as cnt FROM customers WHERE is_active = true AND is_archived = false
UNION ALL
SELECT 'sales', count(*) FROM sales WHERE status = 'completed'
UNION ALL
SELECT 'sale_items', count(*) FROM sale_items
UNION ALL
SELECT 'payments', count(*) FROM customer_payments
UNION ALL
SELECT 'configs', count(*) FROM reminder_configs;

SELECT name, outstanding_balance, total_purchases FROM customers
WHERE id = '00000000-0000-0000-0000-000000000052';

SELECT name, stock_qty FROM products
WHERE id = '00000000-0000-0000-0000-000000000020';
