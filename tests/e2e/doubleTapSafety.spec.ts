/**
 * E2E: one confirm = one business action, even when the button is tapped twice — for payments
 * AND for the sale confirm screen (`sale/cart`, whose button is "Complete Sale").
 *
 * REPORTED BY THE PRODUCT OWNER: "once I create a sale and double-click confirm,
 * it's created twice in the system but it is only one sale… this kind of issues as
 * well". A second click that arrives before React re-renders (which is what a real
 * double tap is) used to reach the RPC twice, and the payment screens minted a new
 * idempotency key per call — so the database had nothing to de-duplicate on and
 * recorded two payments, reducing the balance twice.
 *
 * The two clicks are dispatched in ONE JavaScript task on purpose: that is the only
 * faithful reproduction of a double tap. Two awaited Playwright clicks are not —
 * the browser re-renders in between, so the button is already disabled and the bug
 * disappears. Button state is not the protection being tested anyway: the assertion
 * is on the database.
 *
 * QA database only.
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  claimNew,
  snapshotIds,
  injectAdminAuth,
  ownership,
  trackOwned,
} from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const INITIAL_BALANCE = 20000;
const INITIAL_PAYABLE = 10000;
const PAYMENT_AMOUNT = 3000;

// ISOLATED rows this file owns (unique ids per run): the customer, supplier,
// product and variant every test below runs against. The shared fixtures are
// never asserted on and never deleted.
const RUN = Date.now().toString(36);
const DT_CUST_ID = randomUUID();
const DT_COMP_ID = randomUUID();
const DT_PROD_ID = randomUUID();
const DT_VAR_ID = randomUUID();
const DT_CUST_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;

/** Click the same element twice in one task, i.e. what a double tap really is. */
async function doubleTapButton(page: import('@playwright/test').Page, pattern: string) {
  return page.evaluate((source) => {
    const re = new RegExp(source, 'i');
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      re.test((b.textContent || '').trim())
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error(`confirm button not found: ${source}`);
    if (btn.disabled) throw new Error('confirm button was already disabled before the second tap');
    btn.click();
    btn.click();
  }, pattern);
}

async function doubleTapConfirm(page: import('@playwright/test').Page) {
  return doubleTapButton(page, '^(confirm|record payment|save adjustment)');
}

test.describe('Double tap safety', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    // ISOLATION: this file used to assert the SHARED fixture customer and
    // supplier have zero payments — a premise other runs' leftover rows kept
    // breaking (supplier_payments was exactly 3 in all 5 runs). Every test
    // now runs against rows this file owns, so stale residue elsewhere is
    // irrelevant and nothing of anyone else's is deleted. Balances start at
    // the values the tests assert from.
    await execSql(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${DT_CUST_ID}', 'DT Customer', '${DT_CUST_PHONE}', 100000, ${INITIAL_BALANCE}, 80000, 0, '${QA_IDS.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${DT_COMP_ID}', 'DT Supplier', ${INITIAL_PAYABLE}, 0, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${DT_PROD_ID}', 'DT Product', '${DT_COMP_ID}', 'seed', 100, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${DT_VAR_ID}', '${DT_PROD_ID}', '1kg', 500, 300, 1, 10, 100) ON CONFLICT (id) DO NOTHING`);
    const own = ownership();
    trackOwned(own, 'customers', DT_CUST_ID);
    trackOwned(own, 'companies', DT_COMP_ID);
    trackOwned(own, 'products', DT_PROD_ID);
    trackOwned(own, 'product_variants', DT_VAR_ID);
  });

  test.afterAll(async () => {
    // Only this run's rows, by id — never "every payment of DT Customer".
    await cleanupFixtures();
  });

  test('customer payment: double-tapping confirm records one payment', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/employee/customers/${DT_CUST_ID}/record-payment`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="number"]').first().waitFor({ timeout: 15000 });
    await page.locator('input[type="number"]').first().fill(String(PAYMENT_AMOUNT));

    // Snapshot before the action, claim the difference after it: the row this tap creates.
    const paymentsBefore = await snapshotIds(
      `SELECT id FROM customer_payments WHERE customer_id = '${DT_CUST_ID}'`,
    );
    // …and the NOTIFICATION the payment RPC writes beside it. Measured 2026-10-15: recording a
    // payment writes a notification whose `entity_id` is the customer (`kind='payment'`,
    // "DT Customer paid Rs. 3,000"), and the cleanup plan scopes notifications by owned ids.
    // Claiming it by id is what the plan's `notifications.column = id` entry exists for —
    // before this file owned its customer, the row survived a green run as QA drift.
    const notificationsBefore = await snapshotIds(`SELECT id FROM notifications`);

    await doubleTapConfirm(page);

    // Wait for the real RPC round-trip, then judge the database, not the UI.
    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM customer_payments WHERE customer_id = '${DT_CUST_ID}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one payment').toBe(1);

    await claimNew(
      'customer_payments',
      `SELECT id FROM customer_payments WHERE customer_id = '${DT_CUST_ID}'`,
      paymentsBefore,
    );
    await claimNew('notifications', `SELECT id FROM notifications`, notificationsBefore);

    const after = await execSql(
      `SELECT outstanding_balance, total_paid FROM customers WHERE id = '${DT_CUST_ID}'`
    );
    expect(Number(after[0].outstanding_balance)).toBe(INITIAL_BALANCE - PAYMENT_AMOUNT);
    expect(Number(after[0].total_paid)).toBe(PAYMENT_AMOUNT);
  });

  test('sale: double-tapping Complete Sale creates one sale and deducts stock once', async ({ page }) => {
    // Deterministic starting point for THIS test's rows (QA only). The count below is ours alone.
    await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = '${DT_VAR_ID}'`);
    await execSql(
      `UPDATE customers SET outstanding_balance = 30000, total_purchases = 80000, total_paid = 50000 WHERE id = '${DT_CUST_ID}'`
    );
    // Same premise, asserted rather than enforced: the count below must be THIS run's sale alone.
    const [salesBefore] = await execSql(
      `SELECT count(*)::int AS n FROM sales WHERE customer_id = '${DT_CUST_ID}'`,
    );
    expect(salesBefore.n, 'doubleTapSafety needs a sale-free isolated customer').toBe(0);
    const salesIdsBefore = await snapshotIds(`SELECT id FROM sales WHERE customer_id = '${DT_CUST_ID}'`);
    // The sale RPC writes a notification too; whichever id it carries, the difference is this run's.
    const notificationsBefore = await snapshotIds(`SELECT id FROM notifications`);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // The real flow: customer → product → variant → cart → Complete Sale.
    await page.goto(`${BASE_URL}/employee/sale`);
    await page.waitForLoadState('networkidle');
    await page.getByText('DT Customer').first().click();
    await page.waitForURL(/\/sale\/products/, { timeout: 15000 });
    await page.getByText('DT Product').first().click();
    await page.waitForURL(/\/sale\/products\//, { timeout: 15000 });
    await page.getByText('1kg').first().click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.waitForURL(/\/sale\/cart/, { timeout: 15000 });
    await page.getByRole('button', { name: /complete sale/i }).waitFor({ timeout: 15000 });

    await doubleTapButton(page, '^complete sale');
    await page.waitForTimeout(6000);

    const sales = await execSql(
      `SELECT id, sale_number, total_amount FROM sales WHERE customer_id = '${DT_CUST_ID}'`
    );
    expect(sales.length, 'a double tap must create exactly one sale').toBe(1);

    await claimNew('sales', `SELECT id FROM sales WHERE customer_id = '${DT_CUST_ID}'`, salesIdsBefore);
    await claimNew('notifications', `SELECT id FROM notifications`, notificationsBefore);

    const items = await execSql(`SELECT count(*)::int AS n FROM sale_items WHERE sale_id = '${sales[0].id}'`);
    expect(Number(items[0].n), 'the sale has its one line').toBe(1);

    const stock = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${DT_VAR_ID}'`);
    expect(Number(stock[0].stock_qty), 'stock deducted exactly once').toBe(99);

    const customer = await execSql(`SELECT total_purchases FROM customers WHERE id = '${DT_CUST_ID}'`);
    expect(Number(customer[0].total_purchases), 'purchase total raised exactly once').toBe(80500);

    // Reload: the sale list shows the one sale. The row renders customer, time and amount rather
    // than the sale number, so the assertion is on that row — one row, one sale (the DB count
    // above remains the authority).
    await page.goto(`${BASE_URL}/employee/sales`);
    await page.waitForLoadState('networkidle');
    const rows = page.getByRole('button', { name: /DT Customer/ });
    await expect(rows).toHaveCount(1, { timeout: 15000 });
    await expect(rows.first()).toContainText('Rs. 500');
  });

  test('supplier payment: double-tapping confirm records one payment', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/payments/supplier/${DT_COMP_ID}`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="number"]').first().waitFor({ timeout: 15000 });
    await page.locator('input[type="number"]').first().fill('500');

    // OWNERSHIP — the snapshot must be taken BEFORE the tap.
    //
    // WHY THIS IS HERE NOW (measured 2026-10-15). Tests 1 and 2 of this file already claimed the row
    // they create (`claimNew('customer_payments', …)`, `claimNew('sales', …)`); this test did not. So
    // the Rs. 500 payment it records against the SHARED fixture company stayed in the QA database
    // after a green run and became the exact row that fails this file's own `beforeAll` premise on
    // the next run — "doubleTapSafety needs a payment-free fixture supplier; QA holds payments from
    // another run". Reproduced end to end: a standalone green run (3 passed) left
    // `supplier_payments` = 1 (`22203d47-…`, amount 500.00, `company_id 50000000-…-0001`,
    // `created_at 2026-10-15T15:54:26Z`), and the next full run failed at `:78` with that count.
    // The row is now claimed by id like every other row this file writes, so its own cleanup removes
    // it and the leak cannot compound.
    const paymentsBefore = await snapshotIds(
      `SELECT id FROM supplier_payments WHERE company_id = '${DT_COMP_ID}'`,
    );
    // NO notification claim here, and that is measured rather than assumed: the supplier-payment
    // path writes no notification (the customer payment and the sale do). Claiming one made
    // `claimNew` throw — "found no new row — the action did not create what this lane believes it
    // created" — which is exactly the guard working: test 3's earlier leak was the payment row
    // alone, and it is the row claimed below.

    await doubleTapConfirm(page);

    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM supplier_payments WHERE company_id = '${DT_COMP_ID}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one supplier payment').toBe(1);

    await claimNew(
      'supplier_payments',
      `SELECT id FROM supplier_payments WHERE company_id = '${DT_COMP_ID}'`,
      paymentsBefore,
    );

    const after = await execSql(
      `SELECT outstanding_payable FROM companies WHERE id = '${DT_COMP_ID}'`
    );
    expect(Number(after[0].outstanding_payable)).toBe(INITIAL_PAYABLE - 500);
  });
});
