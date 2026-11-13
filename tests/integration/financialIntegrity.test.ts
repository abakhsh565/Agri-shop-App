/**
 * Financial Integrity Test Suite
 *
 * Verifies that customer/supplier financial calculations are mathematically
 * correct against authoritative sales, payments, returns, and void records.
 *
 * Business Rules:
 * - Total Purchases = valid sales − returns − voids
 * - Total Paid = actual payments counted once
 * - Outstanding = Total Purchases − Total Paid
 * - Supplier payable = supplier purchases − supplier payments
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbClient, execSqlAsAdmin } from '../setup/qa-client';

let client: any;

/**
 * The branch every operational row this fixture writes belongs to.
 *
 * `sales`, `returns`, `customer_payments` and `supplier_payments` are branch-owned, and
 * `enforce_branch_scope()` (0188) refuses a background write — a direct connection with no
 * authenticated actor — that states no resolvable branch: `INVALID_BRANCH_SCOPE`. The two payment
 * tables are the sharp case, because they carry no `shop_id` at all, so there is nothing for the
 * trigger to derive a branch from and the row must name one itself.
 *
 * The old fixture worked around those refusals by disabling every trigger in `public` on the
 * SHARED QA database (`disableTriggers()`), and the refusals happened anyway: `run_sql` runs each
 * statement, the loop swallowed any error, and no trigger was left disabled — `sales` and
 * `returns` passed only because their `shop_id` let the trigger resolve a branch, and exactly the
 * three payment inserts were refused. So the workaround achieved nothing except attempting a
 * database-wide `ALTER TABLE … DISABLE TRIGGER ALL` on a database every other suite shares.
 *
 * The fixture now states its own branch, resolved at run time with `default_branch_id()` — the
 * same function the trigger itself calls for a background write — so the fixture and the rule
 * cannot drift apart.
 */
let mainBranch = '';

const TEST = {
  shop: '00000000-0000-0000-0000-000000000001',
  customerA: 'F0000000-0000-0000-0000-000000000001',
  customerB: 'F0000000-0000-0000-0000-000000000002',
  customerC: 'F0000000-0000-0000-0000-000000000003',
  companyA: 'F0000000-0000-0000-0000-000000000010',
  productA: 'F0000000-0000-0000-0000-000000000020',
  variantA: 'F0000000-0000-0000-0000-000000000030',
  saleA: 'F0000000-0000-0000-0000-000000000040',
  saleB: 'F0000000-0000-0000-0000-000000000041',
  saleItemA: 'F0000000-0000-0000-0000-000000000050',
  saleItemB: 'F0000000-0000-0000-0000-000000000051',
  paymentA: 'F0000000-0000-0000-0000-000000000060',
  paymentB: 'F0000000-0000-0000-0000-000000000061',
  returnA: 'F0000000-0000-0000-0000-000000000070',
  returnItemA: 'F0000000-0000-0000-0000-000000000080',
  voidA: 'F0000000-0000-0000-0000-000000000090',
  supplierPaymentA: 'F0000000-0000-0000-0000-0000000000A0',
  // Never written by the fixture: the id a deliberately unowned write is refused for.
  ghostPayment: 'F0000000-0000-0000-0000-0000000000F1',
  evidence: [] as Array<{test: string; expected: string; actual: string; result: string}>,
};

function record(test: string, expected: string, actual: string, result: 'PASS' | 'FAIL') {
  TEST.evidence.push({ test, expected, actual, result });
  if (result === 'FAIL') console.error(`FAIL: ${test} — Expected: ${expected}, Actual: ${actual}`);
}

beforeAll(async () => {
  client = getDbClient();
  await client.connect();

  // The tenant's branch, by the database's own rule. Stamping this is the fixture agreeing with
  // the rule rather than inventing a second definition of "main branch".
  const branch = await execSqlAsAdmin(`SELECT public.default_branch_id('${TEST.shop}') AS id`);
  mainBranch = branch.rows[0]?.id ?? '';
  // A tenant with no active branch is an environment problem, not a financial one: say so rather
  // than writing rows whose ownership nothing can resolve.
  if (!mainBranch) {
    throw new Error(
      `financialIntegrity: tenant ${TEST.shop} has no active branch in QA, so nothing can own the ` +
        `rows this suite writes. Seed the baseline first: npm run qa:seed baseline`,
    );
  }

  // Clear anything an earlier run left behind. This has to succeed: residue would corrupt every
  // number measured below, so a failure is reported here instead of being swallowed.
  const leftover = await cleanupTestData();
  if (leftover.length) {
    throw new Error(`financialIntegrity: pre-run cleanup failed — ${leftover.join('; ')}`);
  }

  // Create test fixtures
  await client.query(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${TEST.customerA}', 'Fin Test User', '92300FIN0001', 'admin', false, true, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${TEST.companyA}', 'Fin Test Supplier', 0, 0, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${TEST.customerA}', 'Fin Customer A', '92300FIN1001', 100000, 0, 0, 0, '${TEST.shop}', 'QA'), ('${TEST.customerB}', 'Fin Customer B', '92300FIN1002', 50000, 0, 0, 0, '${TEST.shop}', 'QA'), ('${TEST.customerC}', 'Fin Customer C', '92300FIN1003', 25000, 0, 0, 0, '${TEST.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${TEST.productA}', 'Fin Test Product', '${TEST.companyA}', 'seed', 500, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${TEST.variantA}', '${TEST.productA}', '10kg', 5000, 3000, 10, 10, 500) ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  const failures = await cleanupTestData();
  const residue = await fixtureResidue();
  await client?.end();

  // Cleanup is part of the result, not a courtesy. The previous version discarded every error
  // (`catch {}`), so a failed delete kept this fixture's sale and sale_item in the shared QA
  // database while the suite reported success.
  record('Fixture cleanup — statements completed', '0 errors', `${failures.length} error(s): ${failures.join('; ') || 'none'}`, failures.length === 0 ? 'PASS' : 'FAIL');
  record('Fixture cleanup — operator rows removed', '0', String(residue.total) + ` (${residue.detail})`, residue.total === 0 ? 'PASS' : 'FAIL');
  record('Branch ownership — fixture rows carry the tenant branch', mainBranch || '(none)', String(mainBranch ? 'resolved' : 'MISSING'), mainBranch ? 'PASS' : 'FAIL');

  // Print evidence report
  const passed = TEST.evidence.filter(e => e.result === 'PASS').length;
  const failed = TEST.evidence.filter(e => e.result === 'FAIL').length;
  console.log(`\n=== FINANCIAL INTEGRITY EVIDENCE ===\nTotal: ${TEST.evidence.length}, PASS: ${passed}, FAIL: ${failed}`);
  for (const e of TEST.evidence) {
    console.log(`[${e.result}] ${e.test}\n  Expected: ${e.expected}\n  Actual:   ${e.actual}`);
  }
  // Printed FAIL evidence must fail the build.
  expect(TEST.evidence.filter(e => e.result === 'FAIL').map(e => `${e.test}: expected ${e.expected}, got ${e.actual}`)).toEqual([]);
});

/**
 * Remove everything this suite writes — children before parents.
 *
 * WHY THE ORDER IS THE POINT. The previous version deleted `sales` before the `voids` and
 * `returns` rows that reference it, and `sale_items` before the `return_items` that reference
 * them, and it discarded every error with `catch {}`. Those deletes therefore failed silently: a
 * sale and a sale_item survived in the shared QA database after every run, while the suite
 * reported success. Dependency order plus reported errors is what makes cleanup a result rather
 * than a courtesy.
 *
 * @returns the statements that failed, as `statement: message`. Empty means cleanup completed.
 */
async function cleanupTestData(): Promise<string[]> {
  const failures: string[] = [];
  // Use fresh connections for cleanup (pooler may drop idle connections)
  const q = async (sql: string) => {
    try {
      await execSqlAsAdmin(sql);
    } catch (e: any) {
      failures.push(`${sql.split(' WHERE ')[0]}: ${e.message}`);
    }
  };
  // return_items -> sale_items and returns -> sale: the rows that reference them go first.
  await q(`DELETE FROM return_items WHERE return_id = '${TEST.returnA}'`);
  await q(`DELETE FROM return_items WHERE sale_item_id IN ('${TEST.saleItemA}', '${TEST.saleItemB}')`);
  await q(`DELETE FROM returns WHERE id = '${TEST.returnA}'`);
  await q(`DELETE FROM voids WHERE id = '${TEST.voidA}'`);
  await q(`DELETE FROM voids WHERE sale_id IN ('${TEST.saleA}', '${TEST.saleB}')`);
  await q(`DELETE FROM customer_payments WHERE id IN ('${TEST.paymentA}', '${TEST.paymentB}')`);
  await q(`DELETE FROM supplier_payments WHERE id = '${TEST.supplierPaymentA}'`);
  await q(`DELETE FROM inventory_movements WHERE product_id = '${TEST.productA}'`);
  await q(`DELETE FROM sale_items WHERE sale_id IN ('${TEST.saleA}', '${TEST.saleB}')`);
  await q(`DELETE FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}')`);
  // Reset customer balances
  await q(`UPDATE customers SET outstanding_balance = 0, total_purchases = 0, total_paid = 0, credit_limit = CASE WHEN id = '${TEST.customerA}' THEN 100000 WHEN id = '${TEST.customerB}' THEN 50000 WHEN id = '${TEST.customerC}' THEN 25000 ELSE credit_limit END WHERE id IN ('${TEST.customerA}', '${TEST.customerB}', '${TEST.customerC}')`);
  // Reset supplier
  await q(`UPDATE companies SET outstanding_payable = 0, total_purchases = 0 WHERE id = '${TEST.companyA}'`);
  return failures;
}

/**
 * How much of this suite's own output is still in the database, counted independently of the
 * cleanup's own return value: "the delete reported no error" and "the row is gone" are two
 * different claims, and only the second one is evidence.
 */
async function fixtureResidue(): Promise<{ total: number; detail: string }> {
  const res = await execSqlAsAdmin(`
    SELECT 'sales' AS t, count(*)::int AS n FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}')
    UNION ALL SELECT 'sale_items', count(*)::int FROM sale_items WHERE id IN ('${TEST.saleItemA}', '${TEST.saleItemB}')
    UNION ALL SELECT 'returns', count(*)::int FROM returns WHERE id = '${TEST.returnA}'
    UNION ALL SELECT 'return_items', count(*)::int FROM return_items WHERE id = '${TEST.returnItemA}'
    UNION ALL SELECT 'voids', count(*)::int FROM voids WHERE id = '${TEST.voidA}'
    UNION ALL SELECT 'inventory_movements', count(*)::int FROM inventory_movements WHERE product_id = '${TEST.productA}'
    UNION ALL SELECT 'customer_payments', count(*)::int FROM customer_payments WHERE id IN ('${TEST.paymentA}', '${TEST.paymentB}')
    UNION ALL SELECT 'supplier_payments', count(*)::int FROM supplier_payments WHERE id = '${TEST.supplierPaymentA}'
  `);
  const rows = res.rows as Array<{ t: string; n: number }>;
  return {
    total: rows.reduce((sum, r) => sum + Number(r.n), 0),
    detail: rows.filter((r) => Number(r.n)).map((r) => `${r.t}=${r.n}`).join(', ') || 'none',
  };
}

// ── Customer Financial Tests ──

describe('Financial Integrity — Customer Transactions', () => {
  it('should correctly calculate single sale total', async () => {
    // Create a sale for Customer A: 2 units × Rs. 5000 = Rs. 10,000
    const saleTotal = 2 * 5000;
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, branch_id, created_at, updated_at) VALUES ('${TEST.saleA}', 'QA-SALE-001', '${TEST.customerA}', '${TEST.customerA}', ${saleTotal}, 'completed', 'credit', 'cash', 0, ${saleTotal}, 0, false, '${TEST.shop}', '${mainBranch}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total) VALUES ('${TEST.saleItemA}', '${TEST.saleA}', '${TEST.productA}', 'Fin Test Product', '${TEST.variantA}', '10kg', 2, 5000, ${saleTotal}) ON CONFLICT (id) DO NOTHING`);
    // Update customer total_purchases
    await client.query(`UPDATE customers SET total_purchases = total_purchases + ${saleTotal}, outstanding_balance = outstanding_balance + ${saleTotal} WHERE id = '${TEST.customerA}'`);
    // Update supplier
    await client.query(`UPDATE companies SET total_purchases = total_purchases + ${saleTotal}, outstanding_payable = outstanding_payable + ${saleTotal} WHERE id = '${TEST.companyA}'`);

    // Verify
    const cust = await client.query(`SELECT total_purchases, outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customerA}'`);
    const row = cust.rows[0];
    record('Single sale — total_purchases', String(saleTotal), String(row.total_purchases), Number(row.total_purchases) === saleTotal ? 'PASS' : 'FAIL');
    record('Single sale — outstanding_balance', String(saleTotal), String(row.outstanding_balance), Number(row.outstanding_balance) === saleTotal ? 'PASS' : 'FAIL');
    record('Single sale — total_paid', '0', String(row.total_paid), Number(row.total_paid) === 0 ? 'PASS' : 'FAIL');
  });

  it('should correctly calculate partial payment', async () => {
    // Customer A pays Rs. 3,000 of Rs. 10,000 outstanding
    const paymentAmount = 3000;
    await client.query(`INSERT INTO customer_payments (id, customer_id, amount, method, recorded_by, branch_id, created_at) VALUES ('${TEST.paymentA}', '${TEST.customerA}', ${paymentAmount}, 'cash', 'QA Admin', '${mainBranch}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE customers SET total_paid = total_paid + ${paymentAmount}, outstanding_balance = outstanding_balance - ${paymentAmount} WHERE id = '${TEST.customerA}'`);

    const cust = await client.query(`SELECT total_purchases, outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customerA}'`);
    const row = cust.rows[0];
    const expectedOutstanding = 10000 - 3000;
    record('Partial payment — outstanding_balance', String(expectedOutstanding), String(row.outstanding_balance), Number(row.outstanding_balance) === expectedOutstanding ? 'PASS' : 'FAIL');
    record('Partial payment — total_paid', '3000', String(row.total_paid), Number(row.total_paid) === 3000 ? 'PASS' : 'FAIL');
    record('Partial payment — total_purchases unchanged', '10000', String(row.total_purchases), Number(row.total_purchases) === 10000 ? 'PASS' : 'FAIL');

    // Verify: Outstanding = Total Purchases − Total Paid
    const calculatedOutstanding = Number(row.total_purchases) - Number(row.total_paid);
    record('Partial payment — Outstanding = Purchases − Paid', String(expectedOutstanding), String(calculatedOutstanding), calculatedOutstanding === expectedOutstanding ? 'PASS' : 'FAIL');
  });

  it('should correctly calculate full payment', async () => {
    // Customer A pays remaining Rs. 7,000
    const paymentAmount = 7000;
    await client.query(`INSERT INTO customer_payments (id, customer_id, amount, method, recorded_by, branch_id, created_at) VALUES ('${TEST.paymentB}', '${TEST.customerA}', ${paymentAmount}, 'cash', 'QA Admin', '${mainBranch}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE customers SET total_paid = total_paid + ${paymentAmount}, outstanding_balance = outstanding_balance - ${paymentAmount} WHERE id = '${TEST.customerA}'`);

    const cust = await client.query(`SELECT total_purchases, outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customerA}'`);
    const row = cust.rows[0];
    record('Full payment — outstanding_balance', '0', String(row.outstanding_balance), Number(row.outstanding_balance) === 0 ? 'PASS' : 'FAIL');
    record('Full payment — total_paid', '10000', String(row.total_paid), Number(row.total_paid) === 10000 ? 'PASS' : 'FAIL');
    record('Full payment — Outstanding = Purchases − Paid', '0', String(Number(row.total_purchases) - Number(row.total_paid)), Number(row.total_purchases) - Number(row.total_paid) === 0 ? 'PASS' : 'FAIL');
  });

  it('should verify payment records match customer totals', async () => {
    const payments = await client.query(`SELECT COALESCE(SUM(amount), 0) as total FROM customer_payments WHERE customer_id = '${TEST.customerA}'`);
    const cust = await client.query(`SELECT total_paid FROM customers WHERE id = '${TEST.customerA}'`);
    const paymentSum = Number(payments.rows[0].total);
    const customerPaid = Number(cust.rows[0].total_paid);
    record('Payment records sum = customer.total_paid', String(customerPaid), String(paymentSum), paymentSum === customerPaid ? 'PASS' : 'FAIL');
  });

  it('should correctly calculate Customer B — multiple sales', async () => {
    // Customer B: Sale 1 = Rs. 8,000, Sale 2 = Rs. 12,000
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, branch_id, created_at, updated_at) VALUES ('${TEST.saleB}', 'QA-SALE-002', '${TEST.customerB}', '${TEST.customerA}', 12000, 'completed', 'credit', 'cash', 0, 12000, 0, false, '${TEST.shop}', '${mainBranch}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total) VALUES ('${TEST.saleItemB}', '${TEST.saleB}', '${TEST.productA}', 'Fin Test Product', '${TEST.variantA}', '10kg', 2, 5000, 10000) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE customers SET total_purchases = 20000, outstanding_balance = 20000 WHERE id = '${TEST.customerB}'`);

    const cust = await client.query(`SELECT total_purchases, outstanding_balance FROM customers WHERE id = '${TEST.customerB}'`);
    const row = cust.rows[0];
    record('Customer B — total_purchases after 2 sales', '20000', String(row.total_purchases), Number(row.total_purchases) === 20000 ? 'PASS' : 'FAIL');
    record('Customer B — outstanding_balance', '20000', String(row.outstanding_balance), Number(row.outstanding_balance) === 20000 ? 'PASS' : 'FAIL');
  });

  it('should verify outstanding = purchases − paid for all customers', async () => {
    const customers = await client.query(`SELECT id, name, total_purchases, total_paid, outstanding_balance FROM customers WHERE id IN ('${TEST.customerA}', '${TEST.customerB}', '${TEST.customerC}')`);
    for (const c of customers.rows) {
      const expected = Number(c.total_purchases) - Number(c.total_paid);
      const actual = Number(c.outstanding_balance);
      record(`${c.name} — Outstanding = Purchases − Paid`, String(expected), String(actual), actual === expected ? 'PASS' : 'FAIL');
    }
  });
});

// ── Supplier Financial Tests ──

describe('Financial Integrity — Supplier Transactions', () => {
  it('should correctly track supplier payable after purchase', async () => {
    const supplier = await client.query(`SELECT outstanding_payable, total_purchases FROM companies WHERE id = '${TEST.companyA}'`);
    const row = supplier.rows[0];
    // We updated total_purchases +10000 and outstanding_payable +10000 in the customer sale test
    record('Supplier — total_purchases reflects sales', '10000', String(row.total_purchases), Number(row.total_purchases) === 10000 ? 'PASS' : 'FAIL');
    record('Supplier — outstanding_payable reflects sales', '10000', String(row.outstanding_payable), Number(row.outstanding_payable) === 10000 ? 'PASS' : 'FAIL');
  });

  it('should correctly reduce supplier payable on payment', async () => {
    const payAmount = 4000;
    await client.query(`INSERT INTO supplier_payments (id, company_id, amount, method, recorded_by, branch_id, created_at) VALUES ('${TEST.supplierPaymentA}', '${TEST.companyA}', ${payAmount}, 'cash', 'QA Admin', '${mainBranch}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE companies SET outstanding_payable = outstanding_payable - ${payAmount} WHERE id = '${TEST.companyA}'`);

    const supplier = await client.query(`SELECT outstanding_payable FROM companies WHERE id = '${TEST.companyA}'`);
    const row = supplier.rows[0];
    record('Supplier — outstanding after payment', '6000', String(row.outstanding_payable), Number(row.outstanding_payable) === 6000 ? 'PASS' : 'FAIL');
  });
});

// ── Return Financial Tests ──

describe('Financial Integrity — Return Calculations', () => {
  it('should correctly reduce customer outstanding on return', async () => {
    // Customer B returns 1 unit × Rs. 5000
    const returnAmount = 5000;
    await client.query(`INSERT INTO returns (id, sale_id, customer_id, refund_amount, reason, shop_id, branch_id, created_at) VALUES ('${TEST.returnA}', '${TEST.saleB}', '${TEST.customerB}', ${returnAmount}, 'QA test return', '${TEST.shop}', '${mainBranch}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name, variant_id, variant_name, qty_to_return, unit_price, refund_amount) VALUES ('${TEST.returnItemA}', '${TEST.returnA}', '${TEST.saleItemB}', '${TEST.productA}', 'Fin Test Product', '${TEST.variantA}', '10kg', 1, 5000, ${returnAmount}) ON CONFLICT (id) DO NOTHING`);
    // Return reduces: total_purchases, outstanding_balance
    await client.query(`UPDATE customers SET total_purchases = total_purchases - ${returnAmount}, outstanding_balance = outstanding_balance - ${returnAmount} WHERE id = '${TEST.customerB}'`);

    const cust = await client.query(`SELECT total_purchases, outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customerB}'`);
    const row = cust.rows[0];
    record('Customer B after return — total_purchases', '15000', String(row.total_purchases), Number(row.total_purchases) === 15000 ? 'PASS' : 'FAIL');
    record('Customer B after return — outstanding_balance', '15000', String(row.outstanding_balance), Number(row.outstanding_balance) === 15000 ? 'PASS' : 'FAIL');
    record('Customer B after return — Outstanding = Purchases − Paid', '15000', String(Number(row.total_purchases) - Number(row.total_paid)), Number(row.total_purchases) - Number(row.total_paid) === 15000 ? 'PASS' : 'FAIL');
  });

  it('should verify return record exists and is correct', async () => {
    const ret = await client.query(`SELECT refund_amount, reason FROM returns WHERE id = '${TEST.returnA}'`);
    const row = ret.rows[0];
    record('Return record — refund_amount', '5000', String(row.refund_amount), Number(row.refund_amount) === 5000 ? 'PASS' : 'FAIL');
    record('Return record — reason', 'QA test return', row.reason, row.reason === 'QA test return' ? 'PASS' : 'FAIL');
  });

  it('should verify return_item record is correct', async () => {
    const ri = await client.query(`SELECT qty_to_return, unit_price, refund_amount FROM return_items WHERE id = '${TEST.returnItemA}'`);
    const row = ri.rows[0];
    record('Return item — quantity', '1', String(row.qty_to_return), Number(row.qty_to_return) === 1 ? 'PASS' : 'FAIL');
    record('Return item — total', '5000', String(row.refund_amount), Number(row.refund_amount) === 5000 ? 'PASS' : 'FAIL');
  });
});

// ── Void Financial Tests ──

describe('Financial Integrity — Void Calculations', () => {
  it('should correctly record void for a sale', async () => {
    // Void the remaining sale B (originally Rs. 12,000, returned Rs. 5,000, remaining Rs. 7,000)
    await client.query(`INSERT INTO voids (id, sale_id, reason, voided_by, created_at) VALUES ('${TEST.voidA}', '${TEST.saleB}', 'QA test void', '${TEST.customerA}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE sales SET is_voided = true, voided_by_name = 'QA Admin' WHERE id = '${TEST.saleB}'`);

    const sale = await client.query(`SELECT is_voided, voided_by_name FROM sales WHERE id = '${TEST.saleB}'`);
    const row = sale.rows[0];
    record('Sale voided', 'true', String(row.is_voided), row.is_voided === true ? 'PASS' : 'FAIL');
    record('Voided by recorded', 'QA Admin', row.voided_by_name, row.voided_by_name === 'QA Admin' ? 'PASS' : 'FAIL');
  });

  it('should verify void record exists', async () => {
    const v = await client.query(`SELECT reason, voided_by FROM voids WHERE id = '${TEST.voidA}'`);
    const row = v.rows[0];
    record('Void record — reason', 'QA test void', row.reason, row.reason === 'QA test void' ? 'PASS' : 'FAIL');
    record('Void record — voided_by', TEST.customerA, row.voided_by, String(row.voided_by).toLowerCase() === TEST.customerA.toLowerCase() ? 'PASS' : 'FAIL');
  });

  it('should verify voided sale excluded from active calculations', async () => {
    // Verify is_voided flag is set
    const sale = await client.query(`SELECT is_voided FROM sales WHERE id = '${TEST.saleB}'`);
    record('Voided sale — is_voided flag', 'true', String(sale.rows[0].is_voided), sale.rows[0].is_voided === true ? 'PASS' : 'FAIL');

    // Count non-voided sales for Customer B
    const activeSales = await client.query(`SELECT COUNT(*) as cnt FROM sales WHERE customer_id = '${TEST.customerB}' AND is_voided = false`);
    record('Active (non-voided) sales for Customer B', '0', String(activeSales.rows[0].cnt), Number(activeSales.rows[0].cnt) === 0 ? 'PASS' : 'FAIL');
  });
});

// ── Combined Return + Void Tests ──

describe('Financial Integrity — Combined Return + Void', () => {
  it('should correctly handle return after partial payment', async () => {
    // Customer C: Sale of Rs. 25,000, paid Rs. 10,000, outstanding Rs. 15,000
    await client.query(`UPDATE customers SET total_purchases = 25000, outstanding_balance = 15000, total_paid = 10000 WHERE id = '${TEST.customerC}'`);
    // Return Rs. 5,000
    await client.query(`UPDATE customers SET total_purchases = total_purchases - 5000, outstanding_balance = outstanding_balance - 5000 WHERE id = '${TEST.customerC}'`);

    const cust = await client.query(`SELECT total_purchases, outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customerC}'`);
    const row = cust.rows[0];
    record('Customer C after return — total_purchases', '20000', String(row.total_purchases), Number(row.total_purchases) === 20000 ? 'PASS' : 'FAIL');
    record('Customer C after return — outstanding_balance', '10000', String(row.outstanding_balance), Number(row.outstanding_balance) === 10000 ? 'PASS' : 'FAIL');
    record('Customer C — Outstanding = Purchases − Paid', '10000', String(Number(row.total_purchases) - Number(row.total_paid)), Number(row.total_purchases) - Number(row.total_paid) === 10000 ? 'PASS' : 'FAIL');
  });

  it('should not double-count return and void for same sale', async () => {
    // Verify: total_purchases should reflect net of returns, not voids
    // (voids are flagged, not subtracted from totals in the same way)
    const cust = await client.query(`SELECT total_purchases, outstanding_balance FROM customers WHERE id = '${TEST.customerC}'`);
    const row = cust.rows[0];
    // After our setup: purchases = 20000, outstanding = 10000
    const calculated = Number(row.total_purchases) - Number(row.outstanding_balance);
    record('Customer C — paid portion consistent', '10000', String(calculated), calculated === 10000 ? 'PASS' : 'FAIL');
  });
});

// ── Reload Persistence Tests ──

describe('Financial Integrity — Persistence', () => {
  it('should persist all customer totals after reload (re-query)', async () => {
    const customers = await client.query(`SELECT id, name, total_purchases, total_paid, outstanding_balance FROM customers WHERE id IN ('${TEST.customerA}', '${TEST.customerB}', '${TEST.customerC}') ORDER BY id`);
    for (const c of customers.rows) {
      const expected = Number(c.total_purchases) - Number(c.total_paid);
      const actual = Number(c.outstanding_balance);
      record(`Persistence — ${c.name} outstanding after reload`, String(expected), String(actual), actual === expected ? 'PASS' : 'FAIL');
    }
  });

  it('should verify no orphaned payment records', async () => {
    const orphans = await client.query(`SELECT cp.id FROM customer_payments cp LEFT JOIN customers c ON cp.customer_id = c.id WHERE c.id IS NULL`);
    record('No orphaned customer_payments', '0', String(orphans.rows.length), orphans.rows.length === 0 ? 'PASS' : 'FAIL');
  });

  it('should verify no duplicate payment records', async () => {
    const dupes = await client.query(`SELECT customer_id, amount, created_at, COUNT(*) as cnt FROM customer_payments WHERE customer_id = '${TEST.customerA}' GROUP BY customer_id, amount, created_at HAVING COUNT(*) > 1`);
    record('No duplicate payments for Customer A', '0', String(dupes.rows.length), dupes.rows.length === 0 ? 'PASS' : 'FAIL');
  });
});

// ── Branch ownership — the rule this fixture satisfies is still enforced ──

/**
 * Two things must be true at once, and the old fixture proved neither.
 *
 * It "passed" by trying to disable every trigger in `public` so that rows with no branch would be
 * accepted. That workaround was ineffective — the payment inserts were refused anyway — but its
 * intent is the reason these tests exist: a fixture that satisfies a rule by removing it proves
 * nothing about the product. So the fixture's rows must genuinely carry a branch, AND the guard
 * that refuses unowned rows must still be doing its job.
 */
describe('Financial Integrity — branch ownership is enforced, not bypassed', () => {
  /** A branch that exists nowhere: valid as a uuid, invalid as ownership. */
  const GHOST_BRANCH = 'F0000000-0000-0000-0000-0000000000FF';

  it('has the branch-scope trigger enabled on every branch-owned table this suite writes', async () => {
    const res = await execSqlAsAdmin(`
      SELECT c.relname AS table_name, t.tgenabled
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
         AND t.tgname = 'enforce_branch_scope_trg'
         AND c.relname IN ('sales', 'returns', 'customer_payments', 'supplier_payments')
       ORDER BY c.relname
    `);
    // 'O' is origin mode — the ordinary enabled state, and the only one that enforces the rule.
    // 'D' is disabled: exactly what the old workaround tried to leave behind for every other suite
    // sharing this database.
    expect(res.rows.map((r: any) => `${r.table_name}:${r.tgenabled}`)).toEqual([
      'customer_payments:O',
      'returns:O',
      'sales:O',
      'supplier_payments:O',
    ]);
    record('Branch-scope trigger enabled on the branch-owned tables', '4 of 4 enabled', `${res.rows.length} rows, all 'O'`, res.rows.length === 4 ? 'PASS' : 'FAIL');
  });

  it('refuses a payment addressed to a branch that does not exist', async () => {
    const ghost = await execSqlAsAdmin(`SELECT count(*)::int AS c FROM branches WHERE id = '${GHOST_BRANCH}'`);
    // Non-vacuity: the refusal below means nothing unless this branch really is absent.
    expect(ghost.rows[0].c).toBe(0);

    // The row is valid in every other respect — it is the branch that is wrong. With the trigger
    // disabled (what the old workaround attempted) this insert SUCCEEDS and leaves a payment that
    // no branch-limited reader, including whoever recorded it, could ever see.
    let error = '';
    try {
      await client.query(`INSERT INTO customer_payments (id, customer_id, amount, method, recorded_by, branch_id, created_at) VALUES ('${TEST.ghostPayment}', '${TEST.customerA}', 1, 'cash', 'QA Branch Guard', '${GHOST_BRANCH}', NOW())`);
    } catch (e: any) {
      error = e.message;
    }
    record('Unowned payment refused', 'INVALID_BRANCH_SCOPE', error || '(accepted)', error.includes('INVALID_BRANCH_SCOPE') ? 'PASS' : 'FAIL');

    const persisted = await execSqlAsAdmin(`SELECT count(*)::int AS c FROM customer_payments WHERE id = '${TEST.ghostPayment}'`);
    record('Refused payment persisted nothing', '0', String(persisted.rows[0].c), Number(persisted.rows[0].c) === 0 ? 'PASS' : 'FAIL');
  });

  it('stamps every operational row this fixture writes with the tenant branch', async () => {
    const res = await execSqlAsAdmin(`
      SELECT 'sales' AS t, branch_id::text AS branch_id FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}')
      UNION ALL SELECT 'returns', branch_id::text FROM returns WHERE id = '${TEST.returnA}'
      UNION ALL SELECT 'customer_payments', branch_id::text FROM customer_payments WHERE id IN ('${TEST.paymentA}', '${TEST.paymentB}')
      UNION ALL SELECT 'supplier_payments', branch_id::text FROM supplier_payments WHERE id = '${TEST.supplierPaymentA}'
    `);
    const rows = res.rows as Array<{ t: string; branch_id: string | null }>;
    // Six operational rows exist by now: two sales, a return, two customer payments and a
    // supplier payment. A null here is the exact condition the old fixture hid.
    const unowned = rows.filter((r) => r.branch_id === null).map((r) => r.t);
    record('Operational rows carrying no branch', '0', unowned.length ? unowned.join(', ') : '0', unowned.length === 0 ? 'PASS' : 'FAIL');
    record('Operational rows stamped with the tenant branch', `${rows.length} of ${rows.length}`, `${rows.filter((r) => r.branch_id === mainBranch).length} of ${rows.length}`,
      rows.length > 0 && rows.every((r) => r.branch_id === mainBranch) ? 'PASS' : 'FAIL');
  });
});
