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
import { QA_IDS, execSql, setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';
const INITIAL_BALANCE = 20000;
const INITIAL_PAYABLE = 10000;
const PAYMENT_AMOUNT = 3000;

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
    await execSql(`UPDATE customers SET outstanding_balance = ${INITIAL_BALANCE}, total_paid = 0 WHERE id = '${QA_IDS.customerA}'`);
    await execSql(`UPDATE companies SET outstanding_payable = ${INITIAL_PAYABLE} WHERE id = '${QA_IDS.companyA}'`);
    await execSql(`DELETE FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`);
    await execSql(`DELETE FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`).catch(() => {});
    await execSql(`DELETE FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`).catch(() => {});
    await cleanupFixtures();
  });

  test('customer payment: double-tapping confirm records one payment', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/employee/customers/${QA_IDS.customerA}/record-payment`);
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="number"]').first().waitFor({ timeout: 15000 });
    await page.locator('input[type="number"]').first().fill(String(PAYMENT_AMOUNT));

    await doubleTapConfirm(page);

    // Wait for the real RPC round-trip, then judge the database, not the UI.
    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM customer_payments WHERE customer_id = '${QA_IDS.customerA}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one payment').toBe(1);

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
    await execSql(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${QA_IDS.customerA}')`);
    await execSql(`DELETE FROM sales WHERE customer_id = '${QA_IDS.customerA}'`);

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

    await doubleTapConfirm(page);

    await page.waitForTimeout(6000);

    const payments = await execSql(
      `SELECT count(*)::int AS n FROM supplier_payments WHERE company_id = '${QA_IDS.companyA}'`
    );
    expect(payments[0].n, 'a double tap must record exactly one supplier payment').toBe(1);

    const after = await execSql(
      `SELECT outstanding_payable FROM companies WHERE id = '${QA_IDS.companyA}'`
    );
    expect(Number(after[0].outstanding_payable)).toBe(INITIAL_PAYABLE - 500);
  });
});
