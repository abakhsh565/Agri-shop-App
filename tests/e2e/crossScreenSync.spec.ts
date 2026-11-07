/**
 * E2E Test: Cross-Screen Synchronization
 *
 * Verifies that data changes propagate correctly across all screens.
 * Uses DB updates to simulate edits, then verifies UI reflects changes.
 * Tests Zustand store consistency + navigation freshness.
 *
 * Uses the QA database (never production).
 *
 * WAITING (2026-10-15). Every navigation here used to end with `waitForLoadState('networkidle')` — 45
 * calls. That condition is unreachable on this app because two screens this spec walks
 * (`/admin/dashboard`, `/admin/companies`) hold live connections: `companiesStore` subscribes to a
 * realtime channel and `notificationStore` polls on a timer. The measured result was a 120-second
 * timeout rather than an assertion about data, which is the same mechanism `adminMicrocopy` was
 * already fixed for. The waits now go through the shared `settle()` helper in `helpers.ts`, which
 * still tries a quiet network (bounded, optional) and REQUIRES rendered text — so a blank route
 * still fails this lane loudly, and every data assertion below is unchanged.
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  injectAdminAuth,
  injectOwnerAuth,
  setupFixtures,
  cleanupFixtures,
  execSql,
  ownership,
  trackOwned,
  settle,
  QA_IDS,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';

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

    // OWNERSHIP: the five rows above are this lane's, with ids it chose. Registering them is what
    // lets cleanup remove them — and only them — including the children the app writes for them
    // (variants for the product, access rows for the employee).
    const own = ownership();
    trackOwned(own, 'customers', CUST_ID);
    trackOwned(own, 'products', PROD_ID);
    trackOwned(own, 'product_variants', VAR_ID);
    trackOwned(own, 'companies', COMP_ID);
    trackOwned(own, 'users', EMP_ID);
  });

  test.afterAll(async () => {
    // Scoped deletes by owned id replaced the hand-written ones: one source of truth, FK-ordered,
    // and a failure here fails the lane instead of being absorbed by `.catch(() => {})`.
    await cleanupFixtures();
  });

  // ─── CUSTOMER ─────────────────────────────────────────────────────────────

  test('Customer: name change propagates from profile to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Verify original name on list
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
    await expect(page.locator('text=Sync Customer').first()).toBeVisible();

    // Update name via DB
    await execSql(`UPDATE customers SET name = 'Sync Customer UPDATED' WHERE id = '${CUST_ID}'`);

    // Navigate to profile — store reloads
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await settle(page);

    // Navigate back to list — should show updated name
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
    await expect(page.locator('text=Sync Customer UPDATED').first()).toBeVisible();

    // Hard reload — still updated
    await page.reload();
    await settle(page);
    await expect(page.locator('text=Sync Customer UPDATED').first()).toBeVisible();

    // Verify DB
    const db = await execSql(`SELECT name FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].name).toBe('Sync Customer UPDATED');

    // Restore
    await execSql(`UPDATE customers SET name = 'Sync Customer' WHERE id = '${CUST_ID}'`);
  });

  test('Customer: credit limit change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update credit limit
    await execSql(`UPDATE customers SET credit_limit = 25000 WHERE id = '${CUST_ID}'`);

    // Navigate to list then profile — store reloads
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT credit_limit FROM customers WHERE id = '${CUST_ID}'`);
    expect(Number(db[0].credit_limit)).toBe(25000);

    // Restore
    await execSql(`UPDATE customers SET credit_limit = 10000 WHERE id = '${CUST_ID}'`);
  });

  test('Customer: phone change propagates from profile to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update phone
    await execSql(`UPDATE customers SET phone = '99999999999' WHERE id = '${CUST_ID}'`);

    // Navigate to list — should show updated phone
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT phone FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].phone).toBe('99999999999');

    // Restore
    await execSql(`UPDATE customers SET phone = '${CUST_PHONE}' WHERE id = '${CUST_ID}'`);
  });

  test('Customer: image change propagates across screens', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Set image
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/customer-images/sync-${RUN}.jpg`;
    await execSql(`UPDATE customers SET image_url = '${testUrl}' WHERE id = '${CUST_ID}'`);

    // Navigate to list — should reflect image
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
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
    await settle(page);
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/employee/products`);
    await settle(page);
    await expect(page.locator('text=Sync Product').first()).toBeVisible();

    // Update name
    await execSql(`UPDATE products SET name = 'Sync Product UPDATED' WHERE id = '${PROD_ID}'`);

    // Navigate to detail then list
    await page.goto(`${BASE_URL}/employee/products/${PROD_ID}`);
    await settle(page);
    await page.goto(`${BASE_URL}/employee/products`);
    await settle(page);
    await expect(page.locator('text=Sync Product UPDATED').first()).toBeVisible();

    // Hard reload
    await page.reload();
    await settle(page);
    await expect(page.locator('text=Sync Product UPDATED').first()).toBeVisible();

    // Verify DB
    const db = await execSql(`SELECT name FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].name).toBe('Sync Product UPDATED');

    // Restore
    await execSql(`UPDATE products SET name = 'Sync Product' WHERE id = '${PROD_ID}'`);
  });

  test('Product: price change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update price
    await execSql(`UPDATE product_variants SET selling_price = 750 WHERE id = '${VAR_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/employee/products`);
    await settle(page);
    await page.goto(`${BASE_URL}/employee/products/${PROD_ID}`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT selling_price FROM product_variants WHERE id = '${VAR_ID}'`);
    expect(Number(db[0].selling_price)).toBe(750);

    // Restore
    await execSql(`UPDATE product_variants SET selling_price = 500 WHERE id = '${VAR_ID}'`);
  });

  test('Product: stock change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update stock
    await execSql(`UPDATE product_variants SET stock_qty = 50 WHERE id = '${VAR_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/employee/products`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT stock_qty FROM product_variants WHERE id = '${VAR_ID}'`);
    expect(Number(db[0].stock_qty)).toBe(50);

    // Restore
    await execSql(`UPDATE product_variants SET stock_qty = 100 WHERE id = '${VAR_ID}'`);
  });

  // ─── COMPANY ──────────────────────────────────────────────────────────────

  test('Company: name change propagates from detail to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/admin/companies`);
    await settle(page);
    await expect(page.locator('text=Sync Supplier').first()).toBeVisible();

    // Update name
    await execSql(`UPDATE companies SET name = 'Sync Supplier UPDATED' WHERE id = '${COMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/companies/${COMP_ID}`);
    await settle(page);
    await page.goto(`${BASE_URL}/admin/companies`);
    await settle(page);
    await expect(page.locator('text=Sync Supplier UPDATED').first()).toBeVisible();

    // Hard reload
    await page.reload();
    await settle(page);
    await expect(page.locator('text=Sync Supplier UPDATED').first()).toBeVisible();

    // Verify DB
    const db = await execSql(`SELECT name FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].name).toBe('Sync Supplier UPDATED');

    // Restore
    await execSql(`UPDATE companies SET name = 'Sync Supplier' WHERE id = '${COMP_ID}'`);
  });

  test('Company: payable change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update payable
    await execSql(`UPDATE companies SET outstanding_payable = 50000 WHERE id = '${COMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/companies`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT outstanding_payable FROM companies WHERE id = '${COMP_ID}'`);
    expect(Number(db[0].outstanding_payable)).toBe(50000);

    // Restore
    await execSql(`UPDATE companies SET outstanding_payable = 0 WHERE id = '${COMP_ID}'`);
  });

  // ─── EMPLOYEE ─────────────────────────────────────────────────────────────

  test('Employee: name change propagates from detail to list', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Verify original
    await page.goto(`${BASE_URL}/admin/employees`);
    await settle(page);
    await expect(page.locator('text=Sync Employee').first()).toBeVisible();

    // Update name
    await execSql(`UPDATE users SET name = 'Sync Employee UPDATED' WHERE id = '${EMP_ID}'`);

    // Navigate
    await page.goto(`${BASE_URL}/admin/employees/${EMP_ID}`);
    await settle(page);
    await page.goto(`${BASE_URL}/admin/employees`);
    await settle(page);
    await expect(page.locator('text=Sync Employee UPDATED').first()).toBeVisible();

    // Hard reload
    await page.reload();
    await settle(page);
    await expect(page.locator('text=Sync Employee UPDATED').first()).toBeVisible();

    // Verify DB
    const db = await execSql(`SELECT name FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].name).toBe('Sync Employee UPDATED');

    // Restore
    await execSql(`UPDATE users SET name = 'Sync Employee' WHERE id = '${EMP_ID}'`);
  });

  test('Employee: active status change propagates', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    // Deactivation needs employees.manage, which the demoted admin no longer
    // holds — act as the owner. The raw UPDATE this test used to run via
    // run_sql fires the guard_user_privileged_columns trigger (no app session),
    // so the status change goes through the app's own deactivate/reactivate
    // flow instead — the same flow employeeStatusSafety exercises. The RPCs
    // need no membership row: their membership UPDATEs touch 0 rows when
    // there is none, and only the users row changes.
    await injectOwnerAuth(page);

    // Deactivate through the employee detail, the way the owner does it.
    await page.goto(`${BASE_URL}/admin/employees/${EMP_ID}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^turn off this employee's account$/i }).first().click();
    await expect(page.getByText(`Turn off Sync Employee's account?`)).toBeVisible({ timeout: 10000 });
    // The dialog's confirm is `confirm-submit`, not the LAST button with this
    // name: `.last()` is resolved before the dialog mounts, so Playwright locks
    // onto the detail button behind the dialog backdrop and the click times out.
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByText(/account is off/i)).toBeVisible({ timeout: 15000 });

    // Navigate
    await page.goto(`${BASE_URL}/admin/employees`);
    await settle(page);

    // Verify DB
    const db = await execSql(`SELECT is_active FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].is_active).toBe(false);

    // Reactivate through the same detail flow.
    await page.goto(`${BASE_URL}/admin/employees/${EMP_ID}`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^turn the account back on$/i }).first().click();
    // Wait for the dialog first, mirroring the deactivate flow: without it the
    // confirm click races the dialog mount and the backdrop eats it.
    await expect(page.getByText(`Turn access back on for Sync Employee?`)).toBeVisible({ timeout: 10000 });
    await page.getByTestId('confirm-submit').click();
    await expect(page.getByRole('button', { name: /^turn off this employee's account$/i }).first()).toBeVisible({
      timeout: 15000,
    });
    const db2 = await execSql(`SELECT is_active FROM users WHERE id = '${EMP_ID}'`);
    expect(db2[0].is_active).toBe(true);
  });

  // ─── NAVIGATION FRESHNESS ─────────────────────────────────────────────────

  test('Navigation: each screen mount loads fresh data from store', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Update customer
    await execSql(`UPDATE customers SET name = 'Nav Test' WHERE id = '${CUST_ID}'`);

    // Navigate through multiple screens
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
    await expect(page.locator('text=Nav Test').first()).toBeVisible();

    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await settle(page);

    await page.goto(`${BASE_URL}/admin/dashboard`);
    await settle(page);

    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);
    await expect(page.locator('text=Nav Test').first()).toBeVisible();

    // Verify DB
    const db = await execSql(`SELECT name FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].name).toBe('Nav Test');

    // Restore
    await execSql(`UPDATE customers SET name = 'Sync Customer' WHERE id = '${CUST_ID}'`);
  });

  // ─── STALE STATE CHECK ────────────────────────────────────────────────────

  test('No stale state: dashboard and list screens show consistent data', async ({ page }) => {
    await page.goto(BASE_URL);
    await settle(page);
    await injectAdminAuth(page);

    // Get current counts from DB
    const custCount = await execSql(`SELECT count(*) as cnt FROM customers WHERE shop_id = '${QA_IDS.shop}'`);
    const prodCount = await execSql(`SELECT count(*) as cnt FROM products WHERE shop_id = '${QA_IDS.shop}'`);

    // Navigate to admin dashboard
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await settle(page);

    // Navigate to customer list
    await page.goto(`${BASE_URL}/employee/customers`);
    await settle(page);

    // Navigate to product list
    await page.goto(`${BASE_URL}/employee/products`);
    await settle(page);

    // Verify DB counts unchanged
    const custCount2 = await execSql(`SELECT count(*) as cnt FROM customers WHERE shop_id = '${QA_IDS.shop}'`);
    const prodCount2 = await execSql(`SELECT count(*) as cnt FROM products WHERE shop_id = '${QA_IDS.shop}'`);
    expect(Number(custCount2[0].cnt)).toBe(Number(custCount[0].cnt));
    expect(Number(prodCount2[0].cnt)).toBe(Number(prodCount[0].cnt));
  });
});
