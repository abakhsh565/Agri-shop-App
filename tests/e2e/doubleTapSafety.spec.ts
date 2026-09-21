/**
 * E2E: one confirm = one payment, even when the button is tapped twice.
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
async function doubleTapConfirm(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      /^(confirm|record payment|save adjustment)/i.test((b.textContent || '').trim())
    ) as HTMLButtonElement | undefined;
    if (!btn) throw new Error('confirm button not found');
    if (btn.disabled) throw new Error('confirm button was already disabled before the second tap');
    btn.click();
    btn.click();
  });
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
