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
import { test, expect } from './base';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  claimNew,
  snapshotIds,
  injectAdminAuth,
} from './helpers';
import {
  captureSharedCells,
  restorationStatements,
  sharedCellLabel,
  type CapturedSharedCell,
} from './sharedRowRestore';
import { runCleanupStatements, runTeardownSteps } from '../setup/ownedCleanup';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const INITIAL_BALANCE = 20000;
const INITIAL_PAYABLE = 10000;
const PAYMENT_AMOUNT = 3000;

/**
 * The shared cells this lane writes, with the value each had BEFORE it wrote. Filled in beforeAll.
 *
 * `INITIAL_BALANCE` / `INITIAL_PAYABLE` are this lane's own starting points, not the fixture's — the
 * lane moved QA Customer A's balance and QA Supplier A's payable to them and never put them back, so
 * a green run still left both rows off-baseline for whoever ran next.
 */
const sharedCells: CapturedSharedCell[] = [];

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

    // CAPTURE BEFORE THE FIRST WRITE — see `sharedCells` above and `afterAll` below.
    sharedCells.push(
      ...(await captureSharedCells(execSql, [
        { table: 'product_variants', column: 'stock_qty', id: QA_IDS.variantA },
        { table: 'customers', column: 'outstanding_balance', id: QA_IDS.customerA },
        { table: 'customers', column: 'total_purchases', id: QA_IDS.customerA },
        { table: 'customers', column: 'total_paid', id: QA_IDS.customerA },
        { table: 'companies', column: 'outstanding_payable', id: QA_IDS.companyA },
      ])),
    );

    await execSql(`UPDATE customers SET outstanding_balance = ${INITIAL_BALANCE}, total_paid = 0 WHERE id = '${QA_IDS.customerA}'`);
    await execSql(`UPDATE companies SET outstanding_payable = ${INITIAL_PAYABLE} WHERE id = '${QA_IDS.companyA}'`);

    // OWNERSHIP: this used to start by DELETING every payment of the shared fixture customer and
    // supplier — rows that belong to whoever created them, not to this lane. The premise the lane
    // actually needs is "this fixture has no payments yet", and that is now asserted instead of
    // enforced by deletion: if another run left payments behind, this lane fails here, visibly,
    // and deletes nothing.
    const [customerPayments] = await execSql(
      `SELECT count(*)::int AS n FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`,
    );
    expect(
      customerPayments.n,
      'doubleTapSafety needs a payment-free fixture customer; QA holds payments from another run',
    ).toBe(0);
    const [supplierPayments] = await execSql(
      `SELECT count(*)::int AS n FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`,
    );
    expect(
      supplierPayments.n,
      'doubleTapSafety needs a payment-free fixture supplier; QA holds payments from another run',
    ).toBe(0);
  });

  test.afterAll(async () => {
    // Only this run's rows, by id — never "every payment of QA Customer A". And the shared cells the
    // lane moved go back to their captured values here, whatever the tests above did: the payment and
    // sale screens write to the shared customer, the supplier and the variant, so a failing assertion
    // no longer leaves those rows holding this lane's numbers.
    await runTeardownSteps([
      {
        label: `restore ${sharedCells.map(sharedCellLabel).join(', ') || 'the shared cells this lane mutates'}`,
        run: () =>
          runCleanupStatements(execSql, restorationStatements(sharedCells), 'doubleTapSafety shared-row restore'),
      },
      { label: 'remove the rows this lane owns', run: () => cleanupFixtures() },
    ]);
  });

  test('customer payment: double-tapping confirm records one payment', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/employee/customers/${QA_IDS.customerA}/record-payment`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="number"]').first().waitFor({ timeout: 15000 });
    await page.locator('input[type="number"]').first().fill(String(PAYMENT_AMOUNT));

    // Snapshot before the action, claim the difference after it: the row this tap creates.
    const paymentsBefore = await snapshotIds(
      `SELECT id FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`,
    );
    // …and the NOTIFICATION the payment RPC writes beside it. Measured 2026-10-15: recording a
    // payment for a SHARED fixture customer writes a notification whose `entity_id` is that
    // customer (`kind='payment'`, `entity_id 20000000-…-0001`, "QA Customer A paid Rs. 3,000"),
    // and the cleanup plan scopes notifications by owned ids — the customer here belongs to the
    // fixture floor, not to this run — so the row survived a green run as QA drift. Claiming it by
    // id is what the plan's `notifications.column = id` entry exists for.
    const notificationsBefore = await snapshotIds(`SELECT id FROM notifications`);

    await doubleTapConfirm(page);

    // Wait for the real RPC round-trip, then judge the database, not the UI.
    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one payment').toBe(1);

    await claimNew(
      'customer_payments',
      `SELECT id FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`,
      paymentsBefore,
    );
    await claimNew('notifications', `SELECT id FROM notifications`, notificationsBefore);

    const after = await execSql(
      `SELECT outstanding_balance, total_paid FROM customers WHERE id = '${QA_IDS.customerA}'`
    );
    expect(Number(after[0].outstanding_balance)).toBe(INITIAL_BALANCE - PAYMENT_AMOUNT);
    expect(Number(after[0].total_paid)).toBe(PAYMENT_AMOUNT);
  });

  test('sale: double-tapping Complete Sale creates one sale and deducts stock once', async ({ page }) => {
    // Deterministic starting point for THIS test's rows (QA only). The count below is ours alone.
    await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = '${QA_IDS.variantA}'`);
    await execSql(
      `UPDATE customers SET outstanding_balance = 30000, total_purchases = 80000, total_paid = 50000 WHERE id = '${QA_IDS.customerA}'`
    );
    // Same premise, asserted rather than enforced: the count below must be THIS run's sale alone.
    const [salesBefore] = await execSql(
      `SELECT count(*)::int AS n FROM sales WHERE customer_id = '${QA_IDS.customerA}'`,
    );
    expect(salesBefore.n, 'doubleTapSafety needs a sale-free fixture customer').toBe(0);
    const salesIdsBefore = await snapshotIds(`SELECT id FROM sales WHERE customer_id = '${QA_IDS.customerA}'`);
    // The sale RPC writes a notification too; whichever id it carries, the difference is this run's.
    const notificationsBefore = await snapshotIds(`SELECT id FROM notifications`);

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // The real flow: customer → product → variant → cart → Complete Sale.
    await page.goto(`${BASE_URL}/employee/sale`);
    await page.waitForLoadState('networkidle');
    await page.getByText('QA Customer A').first().click();
    await page.waitForURL(/\/sale\/products/, { timeout: 15000 });
    await page.getByText('QA Product A').first().click();
    await page.waitForURL(/\/sale\/products\//, { timeout: 15000 });
    await page.getByText('1kg').first().click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.waitForURL(/\/sale\/cart/, { timeout: 15000 });
    await page.getByRole('button', { name: /complete sale/i }).waitFor({ timeout: 15000 });

    await doubleTapButton(page, '^complete sale');
    await page.waitForTimeout(6000);

    const sales = await execSql(
      `SELECT id, sale_number, total_amount FROM sales WHERE customer_id = '${QA_IDS.customerA}'`
    );
    expect(sales.length, 'a double tap must create exactly one sale').toBe(1);

    await claimNew('sales', `SELECT id FROM sales WHERE customer_id = '${QA_IDS.customerA}'`, salesIdsBefore);
    await claimNew('notifications', `SELECT id FROM notifications`, notificationsBefore);

    const items = await execSql(`SELECT count(*)::int AS n FROM sale_items WHERE sale_id = '${sales[0].id}'`);
    expect(Number(items[0].n), 'the sale has its one line').toBe(1);

    const stock = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${QA_IDS.variantA}'`);
    expect(Number(stock[0].stock_qty), 'stock deducted exactly once').toBe(99);

    const customer = await execSql(`SELECT total_purchases FROM customers WHERE id = '${QA_IDS.customerA}'`);
    expect(Number(customer[0].total_purchases), 'purchase total raised exactly once').toBe(80500);

    // Reload: the sale list shows the one sale. The row renders customer, time and amount rather
    // than the sale number, so the assertion is on that row — one row, one sale (the DB count
    // above remains the authority).
    await page.goto(`${BASE_URL}/employee/sales`);
    await page.waitForLoadState('networkidle');
    const rows = page.getByRole('button', { name: /QA Customer A/ });
    await expect(rows).toHaveCount(1, { timeout: 15000 });
    await expect(rows.first()).toContainText('Rs. 500');
  });

  test('supplier payment: double-tapping confirm records one payment', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/payments/supplier/${QA_IDS.companyA}`);
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
      `SELECT id FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`,
    );
    // NO notification claim here, and that is measured rather than assumed: the supplier-payment
    // path writes no notification (the customer payment and the sale do). Claiming one made
    // `claimNew` throw — "found no new row — the action did not create what this lane believes it
    // created" — which is exactly the guard working: test 3's earlier leak was the payment row
    // alone, and it is the row claimed below.

    await doubleTapConfirm(page);

    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one supplier payment').toBe(1);

    await claimNew(
      'supplier_payments',
      `SELECT id FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`,
      paymentsBefore,
    );

    const after = await execSql(
      `SELECT outstanding_payable FROM companies WHERE id = '${QA_IDS.companyA}'`
    );
    expect(Number(after[0].outstanding_payable)).toBe(INITIAL_PAYABLE - 500);
  });
});
