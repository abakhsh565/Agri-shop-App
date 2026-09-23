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
import { test, expect } from '@playwright/test';
import { QA_IDS, execSql, setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';
const PRODUCT_NAME = `QA Opening Stock ${Date.now().toString(36).toUpperCase()}`;
const OPENING_STOCK = 50;
const SELLING_PRICE = 600;
const SUPPLIER = 'QA Supplier A';

test.describe('Product opening stock', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name = '${PRODUCT_NAME}')`);
    await execSql(`DELETE FROM products WHERE name = '${PRODUCT_NAME}'`);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE name = '${PRODUCT_NAME}')`).catch(() => {});
    await execSql(`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name = '${PRODUCT_NAME}')`).catch(() => {});
    await execSql(`DELETE FROM products WHERE name = '${PRODUCT_NAME}'`).catch(() => {});
    await cleanupFixtures();
  });

  test('the stock typed on the form is what the variant is created with', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');

    await page.getByPlaceholder('e.g. Karate Insecticide').fill(PRODUCT_NAME);
    // The supplier picker is the app's own sheet, not a native <select> — the design
    // revamp removed every browser-default select, so this opens the field and picks
    // the supplier row. Same requirement (choose a supplier), current UI.
    await page.getByRole('button', { name: 'Choose supplier' }).click();
    await page.locator('.ds-row', { hasText: SUPPLIER }).first().click();
    // The single unit row starts with an empty name, and the form refuses to save
    // without one — so this is the one unit the opening figure belongs to.
    await page.getByPlaceholder('Unit name — e.g. 500ml, 50kg').fill('1kg');

    // The opening-stock field comes before the unit rows, so it is the first number
    // input on the screen; the unit row's selling price is the next one.
    const numbers = page.locator('input[type="number"]');
    await numbers.nth(0).fill(String(OPENING_STOCK));
    await numbers.nth(1).fill(String(SELLING_PRICE));

    await page.getByRole('button', { name: 'Add Product' }).click();

    // Wait for the real RPC round-trip, then judge the database, not the screen.
    await page.waitForTimeout(5000);

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
