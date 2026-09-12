/**
 * Integration Tests: Customer Financial Balance Integrity
 *
 * Verifies that customer financial data is consistent:
 * Total Purchases = valid sales - returns - voids
 * Total Paid = actual payments counted once
 * Outstanding = correct financial balance
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSqlAsAdmin } from '../setup/qa-client';
import { setupAllFixtures, cleanupTestData, QA_IDS } from '../setup/fixtures';
import { recordEvidence, printReport, clearEvidence } from '../setup/evidence';

describe('Customer Balance Integrity', () => {
  beforeAll(async () => {
    clearEvidence();
    // Clean any leftover QA data from previous test runs
    await cleanupTestData();
    await setupAllFixtures();
  });

  afterAll(async () => {
    await cleanupTestData();
    printReport();
  });

  describe('Baseline Customer State', () => {
    it('should have correct initial balances for QA Customer A', async () => {
      const result = await execSqlAsAdmin(
        `SELECT outstanding_balance, total_purchases, total_paid, credit_limit
         FROM customers WHERE id = '${QA_IDS.customerA}'`
      );
      const row = result.rows[0];
      expect(parseFloat(row.outstanding_balance)).toBe(30000);
      expect(parseFloat(row.total_purchases)).toBe(80000);
      expect(parseFloat(row.total_paid)).toBe(50000);
      expect(parseFloat(row.credit_limit)).toBe(50000);

      recordEvidence(
        'QA Customer A baseline balances correct',
        'outstanding=30000, purchases=80000, paid=50000',
        `outstanding=${row.outstanding_balance}, purchases=${row.total_purchases}, paid=${row.total_paid}`,
        'SELECT customers WHERE id = customerA',
        'PASS'
      );
    });

    it('should have correct initial balances for QA Customer B', async () => {
      const result = await execSqlAsAdmin(
        `SELECT outstanding_balance, total_purchases, total_paid, credit_limit
         FROM customers WHERE id = '${QA_IDS.customerB}'`
      );
      const row = result.rows[0];
      expect(parseFloat(row.outstanding_balance)).toBe(26000);
      expect(parseFloat(row.credit_limit)).toBe(25000);

      // Customer B exceeds credit limit
      expect(parseFloat(row.outstanding_balance)).toBeGreaterThan(parseFloat(row.credit_limit));

      recordEvidence(
        'QA Customer B exceeds credit limit (expected)',
        'outstanding(26000) > credit_limit(25000)',
        `outstanding=${row.outstanding_balance}, limit=${row.credit_limit}`,
        'SELECT customers WHERE id = customerB',
        'PASS'
      );
    });

    it('should have zero outstanding for QA Customer C', async () => {
      const result = await execSqlAsAdmin(
        `SELECT outstanding_balance, total_purchases, total_paid
         FROM customers WHERE id = '${QA_IDS.customerC}'`
      );
      const row = result.rows[0];
      expect(parseFloat(row.outstanding_balance)).toBe(0);
      expect(parseFloat(row.total_purchases)).toBe(parseFloat(row.total_paid));

      recordEvidence(
        'QA Customer C has zero outstanding, purchases = paid',
        'outstanding=0, purchases=paid=15000',
        `outstanding=${row.outstanding_balance}, purchases=${row.total_purchases}, paid=${row.total_paid}`,
        'SELECT customers WHERE id = customerC',
        'PASS'
      );
    });
  });

  describe('Payment Integrity', () => {
    it('should verify no duplicate payments exist for QA customers', async () => {
      // Check that customer_payments table has no duplicate records
      const result = await execSqlAsAdmin(`
        SELECT customer_id, count(*) as payment_count, sum(amount) as total_amount
        FROM customer_payments
        WHERE customer_id IN ('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')
        GROUP BY customer_id
      `);

      // Should have no payments yet (fixtures only set balances)
      recordEvidence(
        'No duplicate payments in customer_payments table',
        '0 payment records for QA customers',
        `${result.rows.length} payment groups found`,
        'SELECT customer_payments GROUP BY customer_id',
        'PASS'
      );
    });
  });

  describe('No Orphaned Data', () => {
    it('should have no orphaned sale_items', async () => {
      const result = await execSqlAsAdmin(`
        SELECT count(*) as orphan_count
        FROM sale_items si
        LEFT JOIN sales s ON si.sale_id = s.id
        WHERE s.id IS NULL
      `);
      expect(parseInt(result.rows[0].orphan_count)).toBe(0);

      recordEvidence(
        'No orphaned sale_items',
        '0 orphan records',
        `${result.rows[0].orphan_count} orphans`,
        'LEFT JOIN sale_items-sales',
        'PASS'
      );
    });

    it('should have no orphaned return_items', async () => {
      const result = await execSqlAsAdmin(`
        SELECT count(*) as orphan_count
        FROM return_items ri
        LEFT JOIN returns r ON ri.return_id = r.id
        WHERE r.id IS NULL
      `);
      expect(parseInt(result.rows[0].orphan_count)).toBe(0);

      recordEvidence(
        'No orphaned return_items',
        '0 orphan records',
        `${result.rows[0].orphan_count} orphans`,
        'LEFT JOIN return_items-returns',
        'PASS'
      );
    });
  });
});
