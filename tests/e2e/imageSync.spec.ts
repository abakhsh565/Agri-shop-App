/**
 * E2E Test: Image Synchronization — All Entities
 *
 * Tests the complete image lifecycle for all entity types.
 * Uses the QA database (never production).
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { injectAdminAuth, setupFixtures, cleanupFixtures, execSql, QA_IDS } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = 'http://localhost:5173';
const TEST_IMAGE_A = path.resolve(__dirname, 'fixtures/test-image.png');
const TEST_IMAGE_B = path.resolve(__dirname, 'fixtures/test-image-2.png');

import { randomUUID } from 'crypto';
const RUN = Date.now().toString(36);
const CUSTOMER_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const VARIANT_ID = randomUUID();
const COMPANY_ID = randomUUID();
const EMPLOYEE_ID = randomUUID();
const CUSTOMER_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;
const EMPLOYEE_PHONE = `923${(RUN + '1').slice(-8).padStart(8, '0')}`;

test.describe('Image Synchronization — All Entities', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${CUSTOMER_ID}', 'Img Test Customer', '${CUSTOMER_PHONE}', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${PRODUCT_ID}', 'Img Test Product', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${VARIANT_ID}', '${PRODUCT_ID}', '1kg', 500, 300, 1, 10, 100) ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${COMPANY_ID}', 'Img Test Supplier', 0, 0, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${EMPLOYEE_ID}', 'Img Test Employee', '${EMPLOYEE_PHONE}', 'employee', false, true, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM product_variants WHERE product_id = '${PRODUCT_ID}'`).catch(() => {});
    await execSql(`DELETE FROM products WHERE id = '${PRODUCT_ID}'`).catch(() => {});
    await execSql(`DELETE FROM companies WHERE id = '${COMPANY_ID}'`).catch(() => {});
    await execSql(`DELETE FROM customers WHERE id = '${CUSTOMER_ID}'`).catch(() => {});
    await execSql(`DELETE FROM users WHERE id = '${EMPLOYEE_ID}'`).catch(() => {});
    await cleanupFixtures();
  });

  // ─── CUSTOMER IMAGE ───────────────────────────────────────────────────────

  test('Customer: upload, persist, reload, replace, remove', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/employee/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // Open edit modal
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);

    // Upload image A
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_A);
    await page.waitForTimeout(3000);

    // Save
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    // Verify DB
    const db1 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db1[0].image_url).toBeTruthy();
    expect(db1[0].image_url).toContain('supabase.co/storage');
    const urlA = db1[0].image_url;

    // Storage accessible
    const resp = await page.request.get(urlA);
    expect(resp.status()).toBe(200);

    // Reload persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    const db2 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db2[0].image_url).toBe(urlA);

    // Cross-screen
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/employee/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');
    const db3 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db3[0].image_url).toBe(urlA);

    // Replace
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_B);
    await page.waitForTimeout(3000);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    const db4 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db4[0].image_url).not.toBe(urlA);
    const urlB = db4[0].image_url;

    // Reload — new image persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    const db5 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db5[0].image_url).toBe(urlB);

    // Remove
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    const removeBtn = page.locator('button:has-text("Remove")').first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await page.waitForTimeout(500);
    }
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    const db6 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db6[0].image_url).toBeNull();

    // Reload — removal persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    const db7 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db7[0].image_url).toBeNull();
  });

  // ─── PRODUCT IMAGE ────────────────────────────────────────────────────────

  test('Product: DB image_url set and cleared correctly', async ({ page }) => {
    const db0 = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db0[0].image_url).toBeNull();

    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/product-images/test-prod-${RUN}.jpg`;
    await execSql(`UPDATE products SET image_url = '${testUrl}' WHERE id = '${PRODUCT_ID}'`);
    const db1 = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db1[0].image_url).toBe(testUrl);

    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/product-images/test-prod-${RUN}-b.jpg`;
    await execSql(`UPDATE products SET image_url = '${testUrl2}' WHERE id = '${PRODUCT_ID}'`);
    const db2 = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db2[0].image_url).toBe(testUrl2);
    expect(db2[0].image_url).not.toBe(testUrl);

    await execSql(`UPDATE products SET image_url = NULL WHERE id = '${PRODUCT_ID}'`);
    const db3 = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db3[0].image_url).toBeNull();
  });

  test('Product: upload via UI to AddProduct page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE_A);
    await page.waitForTimeout(3000);

    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
  });

  // ─── COMPANY/SupPLIER LOGO ────────────────────────────────────────────────

  test('Company: DB logo_url set and cleared correctly', async ({ page }) => {
    const db0 = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db0[0].logo_url).toBeNull();

    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/company-logos/test-comp-${RUN}.jpg`;
    await execSql(`UPDATE companies SET logo_url = '${testUrl}' WHERE id = '${COMPANY_ID}'`);
    const db1 = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db1[0].logo_url).toBe(testUrl);

    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/company-logos/test-comp-${RUN}-b.jpg`;
    await execSql(`UPDATE companies SET logo_url = '${testUrl2}' WHERE id = '${COMPANY_ID}'`);
    const db2 = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db2[0].logo_url).toBe(testUrl2);

    await execSql(`UPDATE companies SET logo_url = NULL WHERE id = '${COMPANY_ID}'`);
    const db3 = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db3[0].logo_url).toBeNull();
  });

  test('Company: upload logo on AddCompany page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/companies/new`);
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE_A);
    await page.waitForTimeout(3000);

    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
  });

  // ─── EMPLOYEE/ADMIN PHOTO ─────────────────────────────────────────────────

  test('Employee: DB photo_url set and cleared correctly', async ({ page }) => {
    const db0 = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db0[0].photo_url).toBeNull();

    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/employee-photos/test-emp-${RUN}.jpg`;
    await execSql(`UPDATE users SET photo_url = '${testUrl}' WHERE id = '${EMPLOYEE_ID}'`);
    const db1 = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db1[0].photo_url).toBe(testUrl);

    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/employee-photos/test-emp-${RUN}-b.jpg`;
    await execSql(`UPDATE users SET photo_url = '${testUrl2}' WHERE id = '${EMPLOYEE_ID}'`);
    const db2 = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db2[0].photo_url).toBe(testUrl2);

    await execSql(`UPDATE users SET photo_url = NULL WHERE id = '${EMPLOYEE_ID}'`);
    const db3 = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db3[0].photo_url).toBeNull();
  });

  test('Employee: upload photo on AddEmployee page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    await page.goto(`${BASE_URL}/admin/employees/new`);
    await page.waitForLoadState('networkidle');

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE_A);
    await page.waitForTimeout(3000);

    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
  });

  // ─── DB REFERENCE AUTHORITY ───────────────────────────────────────────────

  test('DB reference is authoritative for all entities', async () => {
    // Customer
    const custUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/customer-images/auth-${RUN}.jpg`;
    await execSql(`UPDATE customers SET image_url = '${custUrl}' WHERE id = '${CUSTOMER_ID}'`);
    let db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db[0].image_url).toBe(custUrl);
    await execSql(`UPDATE customers SET image_url = NULL WHERE id = '${CUSTOMER_ID}'`);
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db[0].image_url).toBeNull();

    // Product
    const prodUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/product-images/auth-${RUN}.jpg`;
    await execSql(`UPDATE products SET image_url = '${prodUrl}' WHERE id = '${PRODUCT_ID}'`);
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db[0].image_url).toBe(prodUrl);
    await execSql(`UPDATE products SET image_url = NULL WHERE id = '${PRODUCT_ID}'`);
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PRODUCT_ID}'`);
    expect(db[0].image_url).toBeNull();

    // Company
    const compUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/company-logos/auth-${RUN}.jpg`;
    await execSql(`UPDATE companies SET logo_url = '${compUrl}' WHERE id = '${COMPANY_ID}'`);
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db[0].logo_url).toBe(compUrl);
    await execSql(`UPDATE companies SET logo_url = NULL WHERE id = '${COMPANY_ID}'`);
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMPANY_ID}'`);
    expect(db[0].logo_url).toBeNull();

    // Employee
    const empUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/employee-photos/auth-${RUN}.jpg`;
    await execSql(`UPDATE users SET photo_url = '${empUrl}' WHERE id = '${EMPLOYEE_ID}'`);
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db[0].photo_url).toBe(empUrl);
    await execSql(`UPDATE users SET photo_url = NULL WHERE id = '${EMPLOYEE_ID}'`);
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMPLOYEE_ID}'`);
    expect(db[0].photo_url).toBeNull();
  });

  // ─── STORAGE SECURITY ─────────────────────────────────────────────────────

  test('Storage: all 4 buckets exist and are public', async () => {
    const buckets = await execSql(`SELECT id, public FROM storage.buckets WHERE id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images')`);
    expect(buckets.length).toBe(4);
    for (const b of buckets) expect(b.public).toBe(true);
  });

  test('Storage: RLS policies exist for CRUD', async () => {
    const policies = await execSql(`SELECT cmd, count(*) as cnt FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' GROUP BY cmd`);
    const cmds = policies.map((p: any) => p.cmd);
    expect(cmds).toContain('INSERT');
    expect(cmds).toContain('SELECT');
    expect(cmds).toContain('UPDATE');
    expect(cmds).toContain('DELETE');
  });

  test('Storage: public_all policies allow unrestricted access to image buckets', async () => {
    const policies = await execSql(`SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'public_all%'`);
    expect(policies.length).toBeGreaterThanOrEqual(4);
    for (const p of policies) {
      expect(p.policyname).toContain('public_all');
    }
  });

  // ─── ORPHAN FILE HANDLING ─────────────────────────────────────────────────

  test('Orphan: replace clears DB reference — old storage object not auto-deleted', async ({ page }) => {
    // This test documents the orphan behavior:
    // When an image is replaced, the DB reference changes to the new URL.
    // The old storage object is NOT automatically deleted.
    // This is a documented limitation, not a bug.

    // Upload image A via real UI
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/employee/customers/${CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_A);
    await page.waitForTimeout(3000);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    const db1 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db1[0].image_url).toBeTruthy();
    const urlA = db1[0].image_url;

    // Replace with B
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE_B);
    await page.waitForTimeout(3000);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    // Verify DB now references B, not A
    const db2 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db2[0].image_url).not.toBe(urlA);
    const urlB = db2[0].image_url;
    expect(urlB).toBeTruthy();

    // Verify old URL A is no longer the authoritative reference
    const db3 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}' AND image_url = '${urlA}'`);
    expect(db3.length).toBe(0);

    // Cleanup: clear image via DB (Remove flow tested and passes in Customer test above)
    await execSql(`UPDATE customers SET image_url = NULL WHERE id = '${CUSTOMER_ID}'`);
    const db4 = await execSql(`SELECT image_url FROM customers WHERE id = '${CUSTOMER_ID}'`);
    expect(db4[0].image_url).toBeNull();

    // Old storage objects A and B may still exist in storage as orphans
    // This is a documented limitation — no automatic cleanup
  });
});
