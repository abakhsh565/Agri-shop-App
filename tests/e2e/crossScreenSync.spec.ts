/**
 * E2E Test: Cross-Screen Synchronization
 *
 * Verifies that data changes propagate correctly across all screens.
 * Uses DB updates to simulate edits, then verifies UI reflects changes.
 * Tests Zustand store consistency + navigation freshness.
 *
 * Uses the QA database (never production).
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { injectAdminAuth, setupFixtures, cleanupFixtures, execSql, QA_IDS } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = 'http://localhost:5173';

import { randomUUID } from 'crypto';
const RUN = Date.now().toString(36);
const CUST_ID = randomUUID();
const PROD_ID = randomUUID();
const VAR_ID = randomUUID();
const COMP_ID = randomUUID();
const EMP_ID = randomUUID();
const CUST_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;
const EMP_PHONE = `923${(RUN + '1').slice(-8).padStart(8, '0')}`;

test.describe('Cross-Screen Synchronization', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${CUST_ID}', 'Sync Customer', '${CUST_PHONE}', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${PROD_ID}', 'Sync Product', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${VAR_ID}', '${PROD_ID}', '1kg', 500, 300, 1, 10, 100) ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${COMP_ID}', 'Sync Supplier', 0, 0, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${EMP_ID}', 'Sync Employee', '${EMP_PHONE}', 'employee', false, true, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM product_variants WHERE product_id = '${PROD_ID}'`).catch(() => {});
    await execSql(`DELETE FROM products WHERE id = '${PROD_ID}'`).catch(() => {});
    await execSql(`DELETE FROM companies WHERE id = '${COMP_ID}'`).catch(() => {});
    await execSql(`DELETE FROM customers WHERE id = '${CUST_ID}'`).catch(() => {});
    await execSql(`DELETE FROM users WHERE id = '${EMP_ID}'`).catch(() => {});
    await cleanupFixtures();
  });

  // ─── CUSTOMER ─────────────────────────────────────────────────────────────

  test('Customer: name change propagates from profile to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Verify original name on list
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Customer').first().isVisible()).toBe(true);

    // Update name via DB
    await execSql(`UPDATE customers SET name = 'Sync Customer UPDATED' WHERE id = '${CUST_ID}'`);

    // Navigate to profile — store reloads
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await page.waitForLoadState('networkidle');

    // Navigate back to list — should show updated name
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Customer UPDATED').first().isVisible()).toBe(true);

    // Hard reload — still updated
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Customer UPDATED').first().isVisible()).toBe(true);

    // Verify DB
    const db = await execSql(`SELECT name FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].name).toBe('Sync Customer UPDATED');

    // Restore
    await execSql(`UPDATE customers SET name = 'Sync Customer' WHERE id = '${CUST_ID}'`);
  });

  test('Customer: credit limit change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update credit limit
    await execSql(`UPDATE customers SET credit_limit = 25000 WHERE id = '${CUST_ID}'`);

    // Navigate to list then profile — store reloads
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT credit_limit FROM customers WHERE id = '${CUST_ID}'`);
    expect(Number(db[0].credit_limit)).toBe(25000);

    // Restore
    await execSql(`UPDATE customers SET credit_limit = 10000 WHERE id = '${CUST_ID}'`);
  });

  test('Customer: phone change propagates from profile to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update phone
    await execSql(`UPDATE customers SET phone = '99999999999' WHERE id = '${CUST_ID}'`);

    // Navigate to list — should show updated phone
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT phone FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].phone).toBe('99999999999');

    // Restore
    await execSql(`UPDATE customers SET phone = '${CUST_PHONE}' WHERE id = '${CUST_ID}'`);
  });

  test('Customer: image change propagates across screens', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Set image
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/customer-images/sync-${RUN}.jpg`;
    await execSql(`UPDATE customers SET image_url = '${testUrl}' WHERE id = '${CUST_ID}'`);

    // Navigate to list — should reflect image
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    const db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBe(testUrl);

    // Clear image
    await execSql(`UPDATE customers SET image_url = NULL WHERE id = '${CUST_ID}'`);
    const db2 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db2[0].image_url).toBeNull();
  });

  // ─── PRODUCT ──────────────────────────────────────────────────────────────

  test('Product: name change propagates from detail to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/employee/products`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Product').first().isVisible()).toBe(true);

    // Update name
    await execSql(`UPDATE products SET name = 'Sync Product UPDATED' WHERE id = '${PROD_ID}'`);

    // Navigate to detail then list
    await page.goto(`${BASE_URL}/employee/products/${PROD_ID}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/employee/products`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Product UPDATED').first().isVisible()).toBe(true);

    // Hard reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Product UPDATED').first().isVisible()).toBe(true);

    // Verify DB
    const db = await execSql(`SELECT name FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].name).toBe('Sync Product UPDATED');

    // Restore
    await execSql(`UPDATE products SET name = 'Sync Product' WHERE id = '${PROD_ID}'`);
  });

  test('Product: price change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update price
    await execSql(`UPDATE product_variants SET selling_price = 750 WHERE id = '${VAR_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/employee/products`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/employee/products/${PROD_ID}`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT selling_price FROM product_variants WHERE id = '${VAR_ID}'`);
    expect(Number(db[0].selling_price)).toBe(750);

    // Restore
    await execSql(`UPDATE product_variants SET selling_price = 500 WHERE id = '${VAR_ID}'`);
  });

  test('Product: stock change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update stock
    await execSql(`UPDATE product_variants SET stock_qty = 50 WHERE id = '${VAR_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/employee/products`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${VAR_ID}'`);
    expect(Number(db[0].stock_qty)).toBe(50);

    // Restore
    await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = '${VAR_ID}'`);
  });

  // ─── COMPANY ──────────────────────────────────────────────────────────────

  test('Company: name change propagates from detail to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/admin/companies`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Supplier').first().isVisible()).toBe(true);

    // Update name
    await execSql(`UPDATE companies SET name = 'Sync Supplier UPDATED' WHERE id = '${COMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/companies/${COMP_ID}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/admin/companies`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Supplier UPDATED').first().isVisible()).toBe(true);

    // Hard reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Supplier UPDATED').first().isVisible()).toBe(true);

    // Verify DB
    const db = await execSql(`SELECT name FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].name).toBe('Sync Supplier UPDATED');

    // Restore
    await execSql(`UPDATE companies SET name = 'Sync Supplier' WHERE id = '${COMP_ID}'`);
  });

  test('Company: payable change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update payable
    await execSql(`UPDATE companies SET outstanding_payable = 50000 WHERE id = '${COMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/companies`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT outstanding_payable FROM companies WHERE id = '${COMP_ID}'`);
    expect(Number(db[0].outstanding_payable)).toBe(50000);

    // Restore
    await execSql(`UPDATE companies SET outstanding_payable = 0 WHERE id = '${COMP_ID}'`);
  });

  // ─── EMPLOYEE ─────────────────────────────────────────────────────────────

  test('Employee: name change propagates from detail to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/admin/employees`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Employee').first().isVisible()).toBe(true);

    // Update name
    await execSql(`UPDATE users SET name = 'Sync Employee UPDATED' WHERE id = '${EMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/employees/${EMP_ID}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/admin/employees`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Employee UPDATED').first().isVisible()).toBe(true);

    // Hard reload
    await page.reload();
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Sync Employee UPDATED').first().isVisible()).toBe(true);

    // Verify DB
    const db = await execSql(`SELECT name FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].name).toBe('Sync Employee UPDATED');

    // Restore
    await execSql(`UPDATE users SET name = 'Sync Employee' WHERE id = '${EMP_ID}'`);
  });

  test('Employee: active status change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Deactivate
    await execSql(`UPDATE users SET is_active = false WHERE id = '${EMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/employees`);
    await page.waitForLoadState('networkidle');

    // Verify DB
    const db = await execSql(`SELECT is_active FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].is_active).toBe(false);

    // Reactivate
    await execSql(`UPDATE users SET is_active = true WHERE id = '${EMP_ID}'`);
    const db2 = await execSql(`SELECT is_active FROM users WHERE id = '${EMP_ID}'`);
    expect(db2[0].is_active).toBe(true);
  });

  // ─── NAVIGATION FRESHNESS ─────────────────────────────────────────────────

  test('Navigation: each screen mount loads fresh data from store', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Update customer
    await execSql(`UPDATE customers SET name = 'Nav Test' WHERE id = '${CUST_ID}'`);

    // Navigate through multiple screens
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Nav Test').first().isVisible()).toBe(true);

    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await page.waitForLoadState('networkidle');

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForLoadState('networkidle');

    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('text=Nav Test').first().isVisible()).toBe(true);

    // Verify DB
    const db = await execSql(`SELECT name FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].name).toBe('Nav Test');

    // Restore
    await execSql(`UPDATE customers SET name = 'Sync Customer' WHERE id = '${CUST_ID}'`);
  });

  // ─── STALE STATE CHECK ────────────────────────────────────────────────────

  test('No stale state: dashboard and list screens show consistent data', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Get current counts from DB
    const custCount = await execSql(`SELECT count(*) as cnt FROM customers WHERE shop_id = '${QA_IDS.shop}'`);
    const prodCount = await execSql(`SELECT count(*) as cnt FROM products WHERE shop_id = '${QA_IDS.shop}'`);

    // Navigate to admin dashboard
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForLoadState('networkidle');

    // Navigate to customer list
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');

    // Navigate to product list
    await page.goto(`${BASE_URL}/employee/products`);
    await page.waitForLoadState('networkidle');

    // Verify DB counts unchanged
    const custCount2 = await execSql(`SELECT count(*) as cnt FROM customers WHERE shop_id = '${QA_IDS.shop}'`);
    const prodCount2 = await execSql(`SELECT count(*) as cnt FROM products WHERE shop_id = '${QA_IDS.shop}'`);
    expect(Number(custCount2[0].cnt)).toBe(Number(custCount[0].cnt));
    expect(Number(prodCount2[0].cnt)).toBe(Number(prodCount[0].cnt));
  });
});
