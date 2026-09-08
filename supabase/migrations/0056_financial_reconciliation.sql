-- ============================================================
-- Migration 0056: Financial Reconciliation
--
-- Problem: historical total_paid was double-counted because old
-- create_sale migrations updated total_paid while payment
-- records also updated it.
--
-- Fix: Recalculate ALL customer totals from authoritative
-- sales, returns, voids, and payment records.
--
-- Formula:
--   total_purchases = SUM(valid sales) - SUM(returns) - SUM(voids)
--   total_paid = SUM(sales.amount_paid at creation) + SUM(customer_payments.amount)
--   outstanding_balance = total_purchases - total_paid
-- ============================================================

-- Step 1: Recalculate total_purchases from sales (excluding voided)
-- total_purchases = SUM(sales.total_amount) WHERE status != 'voided'
UPDATE customers c
SET total_purchases = COALESCE(
  (SELECT SUM(s.total_amount)
   FROM sales s
   WHERE s.customer_id = c.id
     AND s.status != 'voided'
     AND s.customer_id IS NOT NULL),
  0
),
updated_at = now();

-- Step 2: Recalculate total_paid from sales.amount_paid + payments/customer_payments
-- Note: old record_customer_payment inserted into customer_payments
-- Newer versions insert into payments
UPDATE customers c
SET total_paid = COALESCE(
  (SELECT SUM(s.amount_paid)
   FROM sales s
   WHERE s.customer_id = c.id
     AND s.status != 'voided'
     AND s.customer_id IS NOT NULL),
  0
) + COALESCE(
  (SELECT SUM(p.amount)
   FROM payments p
   WHERE p.customer_id = c.id),
  0
) + COALESCE(
  (SELECT SUM(cp.amount)
   FROM customer_payments cp
   WHERE cp.customer_id = c.id),
  0
),
updated_at = now();

-- Step 3: Recalculate outstanding_balance = total_purchases - total_paid
-- But ensure it's never negative (customer overpaid = 0 outstanding)
UPDATE customers c
SET outstanding_balance = GREATEST(0, c.total_purchases - c.total_paid),
    updated_at = now();

-- Step 4: Also recalculate sales.outstanding_balance for each sale
-- This ensures individual sale records are consistent
UPDATE sales s
SET outstanding_balance = GREATEST(0, s.total_amount - s.amount_paid)
WHERE s.status != 'voided';

-- Step 5: Verify results (for logging)
DO $$
DECLARE
  v_count integer;
  v_total_purchases numeric;
  v_total_paid numeric;
  v_total_outstanding numeric;
BEGIN
  SELECT count(*), sum(total_purchases), sum(total_paid), sum(outstanding_balance)
  INTO v_count, v_total_purchases, v_total_paid, v_total_outstanding
  FROM customers
  WHERE is_archived = false;

  RAISE NOTICE 'Financial Reconciliation Complete:';
  RAISE NOTICE '  Customers: %', v_count;
  RAISE NOTICE '  Total Purchases: %', v_total_purchases;
  RAISE NOTICE '  Total Paid: %', v_total_paid;
  RAISE NOTICE '  Total Outstanding: %', v_total_outstanding;
END $$;
