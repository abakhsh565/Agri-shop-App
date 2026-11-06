/**
 * E2E: the write that timed out after the server had already accepted it.
 *
 * This is the retry the product owner asked about, at the browser level: the request
 * reaches the database and is committed, but the client never hears back and reports
 * a failure. A user retry in that state must not write a second sale — the key the
 * cart minted for THIS attempt has to survive the failure and be reused, or
 * `create_sale`'s claim table has nothing to match on and one bill becomes two.
 *
 * The first request is performed for real (so the row exists) and then answered as a
 * timeout (so the page sees a failure). The second click is an ordinary user retry.
 * Everything is judged against the database, and the success screen must show the row
 * the database actually holds.
 *
 * QA database only.
 */
import { test, expect } from '@playwright/test';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  claimNew,
  snapshotIds,
  injectAdminAuth,
} from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';

test.describe('Browser retry after a timed-out write', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = '${QA_IDS.variantA}'`);
    await execSql(
      `UPDATE customers SET outstanding_balance = 30000, total_purchases = 80000, total_paid = 50000 WHERE id = '${QA_IDS.customerA}'`
    );

    // OWNERSHIP: the three deletes that used to run here removed every sale of the shared fixture
    // customer and every sale submission of the shared shop — other runs' rows. The premise this
    // lane needs ("this fixture has no sale yet") is asserted instead, so a dirty database makes
    // the lane fail loudly rather than letting it delete the difference.
    const [sales] = await execSql(
      `SELECT count(*)::int AS n FROM sales WHERE customer_id = '${QA_IDS.customerA}'`,
    );
    expect(sales.n, 'retryAfterTimeout needs a sale-free fixture customer').toBe(0);
  });

  test.afterAll(async () => {
    // The sale this lane creates is claimed by id; its items and submission follow by FK.
    await cleanupFixtures();
  });

  test('one sale — the timed-out attempt is reused on retry, never repeated', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // The real flow: customer → product → variant → cart.
    await page.goto(`${BASE_URL}/employee/sale`);
    await page.waitForLoadState('networkidle');
    // networkidle does not mean the customers store hydrated — wait for the
    // customer to actually render before clicking it (same pattern as the
    // Complete Sale button below).
    await expect(page.getByText('QA Customer A').first()).toBeVisible({ timeout: 15000 });
    await page.getByText('QA Customer A').first().click();
    await page.waitForURL(/\/sale\/products/, { timeout: 15000 });
    await page.getByText('QA Product A').first().click();
    await page.waitForURL(/\/sale\/products\//, { timeout: 15000 });
    await page.getByText('1kg').first().click();
    await page.getByRole('button', { name: /add to cart/i }).click();
    await page.waitForURL(/\/sale\/cart/, { timeout: 15000 });
    await expect(page.getByRole('button', { name: /complete sale/i })).toBeVisible({ timeout: 15000 });

    const keys: string[] = [];
    let calls = 0;
    await page.route('**/rest/v1/rpc/create_sale*', async (route) => {
      calls += 1;
      const body = route.request().postDataJSON() as { payload?: { idempotencyKey?: string } } | null;
      keys.push(String(body?.payload?.idempotencyKey ?? ''));
      if (calls === 1) {
        // Delivered for real — the server writes the sale — and then answered as a
        // timeout, which is what the client sees when the response never comes back.
        await route.fetch();
        await route.fulfill({
          status: 504,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Gateway Timeout' }),
        });
        return;
      }
      await route.continue();
    });

    // Snapshot before the FIRST attempt: the timed-out write is the one that creates the row.
    const salesIdsBefore = await snapshotIds(`SELECT id FROM sales WHERE customer_id = '${QA_IDS.customerA}'`);

    await page.getByRole('button', { name: /complete sale/i }).click();

    // The write landed even though the page saw a failure.
    await expect
      .poll(
        async () =>
          Number((await execSql(`SELECT count(*)::int AS n FROM sales WHERE customer_id = '${QA_IDS.customerA}'`))[0].n),
        { timeout: 20000, message: 'the first attempt never reached the database — the scenario was not reproduced' }
      )
      .toBe(1);

    // The user is left on the cart with the action available again — this is the retry.
    await expect(
      page.getByRole('button', { name: /complete sale/i }),
      'the sale button did not come back for the retry',
    ).toBeEnabled({ timeout: 20000 });

    await page.getByRole('button', { name: /complete sale/i }).click();
    await page.waitForURL(/\/sale\/success/, { timeout: 30000 });

    // One key, used twice: the retry is the same submission, not a new one.
    expect(calls).toBe(2);
    expect(keys[0], 'the cart minted no idempotency key').not.toBe('');
    expect(keys[1], 'the retry used a different key — a second bill was possible').toBe(keys[0]);

    // The database is the judge: one sale, one line, stock and totals moved once.
    const sales = await execSql(`SELECT id, sale_number, total_amount FROM sales WHERE customer_id = '${QA_IDS.customerA}'`);
    expect(sales.length, 'the retry wrote a second sale').toBe(1);

    await claimNew('sales', `SELECT id FROM sales WHERE customer_id = '${QA_IDS.customerA}'`, salesIdsBefore);
    const items = await execSql(`SELECT count(*)::int AS n FROM sale_items WHERE sale_id = '${sales[0].id}'`);
    expect(Number(items[0].n), 'the sale carries one line').toBe(1);
    const submissions = await execSql(`SELECT count(*)::int AS n FROM sale_submissions WHERE idempotency_key = '${keys[0]}'`);
    expect(Number(submissions[0].n), 'the key was claimed twice').toBe(1);
    const stock = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${QA_IDS.variantA}'`);
    expect(Number(stock[0].stock_qty), 'stock was deducted twice').toBe(99);
    const customer = await execSql(`SELECT total_purchases FROM customers WHERE id = '${QA_IDS.customerA}'`);
    expect(Number(customer[0].total_purchases), 'the purchase total moved twice').toBe(80500);

    // The screen shows the row the database holds, not a local stand-in.
    await expect(
      page.getByText(String(sales[0].sale_number)).first(),
      'the receipt does not show the database sale number',
    ).toBeVisible({ timeout: 15000 });

    // And the sale list still shows exactly one sale for this customer.
    await page.goto(`${BASE_URL}/employee/sales`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /QA Customer A/ })).toHaveCount(1, { timeout: 15000 });
  });
});
