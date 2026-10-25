/**
 * E2E: the opening stock typed on Add Product must actually be recorded.
 *
 * Found while proving the double-tap fixes. `create_product` reads the opening quantity
 * from each VARIANT (`v_item->>'stockQty'`) — the variant is the stock of record since
 * 0128 — but the form collects ONE figure and the page sent it as a product-level field.
 * The database therefore inserted every variant with stock 0 while the screen said
 * "Actual inventory in piece. Sellable units consume from this pool.": a shop could type
 * its real stock on the way in and end up with a product it could not sell.
 *
 * The value is genuine user input, so it cannot be derived in the database — the form
 * owns it and must send it where the database reads it. This drives the real form and
 * judges the database.
 *
 * QA database only; the product it creates is deleted again.
 */
import { test, expect } from './base';
import { QA_IDS, execSql, setupFixtures, cleanupFixtures, claimOwned, injectAdminAuth } from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const PRODUCT_NAME = `QA Opening Stock ${Date.now().toString(36).toUpperCase()}`;
const OPENING_STOCK = 50;
const SELLING_PRICE = 600;
const SUPPLIER = 'QA Supplier A';

test.describe('Product opening stock', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    // The product this lane creates is registered by claimOwned() the moment its id exists, so
    // cleanup removes the product, its variant and its movement by id. The old before/after deletes
    // matched on the product NAME — a prefix is not ownership: a same-shaped name from another run
    // would have been deleted here, and this lane's own row could have escaped if it had been
    // renamed.
    await cleanupFixtures();
  });

  test('the stock typed on the form is what the variant is created with', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('product-name').fill(PRODUCT_NAME);
    // The supplier picker is the app's own sheet, not a native <select> — the design
    // revamp removed every browser-default select, so this opens the field and picks
    // the supplier row. Same requirement (choose a supplier), current UI.
    await page.getByRole('button', { name: 'Choose supplier' }).click();
    await page.locator('.ds-row', { hasText: SUPPLIER }).first().click();

    // The form is one card per pack now, and every field carries its own hook. The pack
    // that starts empty is where the opening figure belongs: its size, its selling price
    // and the quantity on the shelf, addressed by pack index rather than by position on
    // the screen — position is what the old locator got wrong, not the requirement.
    await page.getByTestId('product-pack-size-0').fill('1');
    await page.getByTestId('product-pack-cost-0').fill(String(SELLING_PRICE - 100));
    await page.getByTestId('product-pack-sell-0').fill(String(SELLING_PRICE));
    await page.getByTestId('product-pack-stock-0').fill(String(OPENING_STOCK));

    await page.getByTestId('product-save').click();

    // Wait for the real RPC round-trip, then judge the database, not the screen.
    await page.waitForTimeout(5000);

    // OWNERSHIP: the row exists now, so claim it by the exact name this lane generated — and
    // register the product id cleanup will delete (its variant and movement follow by FK).
    await claimOwned('products', `SELECT id FROM products WHERE name = '${PRODUCT_NAME}'`);

    const rows = await execSql(`
      SELECT v.name, v.stock_qty, v.selling_price
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE p.name = '${PRODUCT_NAME}'
    `);

    expect(rows.length, 'the product and its unit must be created').toBe(1);
    expect(
      Number(rows[0].stock_qty),
      'the opening stock typed on the form must be the stock the variant is created with',
    ).toBe(OPENING_STOCK);
    expect(Number(rows[0].selling_price), 'control: the rest of the row was saved too').toBe(SELLING_PRICE);
  });
});
