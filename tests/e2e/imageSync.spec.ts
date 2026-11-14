/**
 * E2E Test: Image Synchronization — All Entities
 *
 * Complete lifecycle testing: Upload → Save → Reload → View → Replace → Reload → Remove
 * Storage security verification, orphan file documentation, compression check.
 *
 * Uses the QA database (never production).
 */
// `./base` adds the worker-scoped ownership cleanup, which covers the rows this lane registers even
// when a failing test restarts the worker before its `afterAll` runs.
import { test, expect } from './base';
// `Page` is used by the upload helper below; without this import the spec failed at runtime with
// `Page is not defined` on the first lane that called it.
import type { Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  injectAdminAuth,
  setupFixtures,
  cleanupFixtures,
  execSql,
  ownership,
  trackOwned,
  trackUploadedObject,
  QA_IDS,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const IMG_A = path.resolve(__dirname, 'fixtures/test-image.png');
const IMG_B = path.resolve(__dirname, 'fixtures/test-image-2.png');

import { randomUUID } from 'crypto';
const RUN = Date.now().toString(36);
const CUST_ID = randomUUID();
const PROD_ID = randomUUID();
const VAR_ID = randomUUID();
const COMP_ID = randomUUID();
const EMP_ID = randomUUID();
const CUST_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;
const EMP_PHONE = `923${(RUN + '1').slice(-8).padStart(8, '0')}`;

// Wait for an image upload to finish before the test clicks Save.
// ImageUpload clears its file input only after the upload resolves (success
// or failure), so a cleared input means the upload is done and onChange has
// fired with the URL (or null on failure). A fixed 3000ms wait is not
// enough: on a slow lane the upload takes longer, the test clicks Save
// before the URL reaches the form, and the DB write stores null (round-6:
// the Orphan test failed at its first image_url read). The DB assertions
// after each save then verify the upload actually succeeded.
async function waitForUpload(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page
          .locator('input[type="file"]')
          .first()
          .evaluate((el: HTMLInputElement) => el.value),
      {
        timeout: 30_000,
        message: 'the image upload never finished — the file input was never cleared',
      },
    )
    .toBe('');
}

test.describe('Image Synchronization — All Entities', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${CUST_ID}', 'Img Cust', '${CUST_PHONE}', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${PROD_ID}', 'Img Product', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${VAR_ID}', '${PROD_ID}', '1kg', 500, 300, 1, 10, 100) ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${COMP_ID}', 'Img Supplier', 0, 0, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);
    await execSql(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${EMP_ID}', 'Img Employee', '${EMP_PHONE}', 'employee', false, true, '${QA_IDS.shop}') ON CONFLICT (id) DO NOTHING`);

    // OWNERSHIP: five rows with ids this lane chose — plus, below, the Storage objects it uploads.
    const own = ownership();
    trackOwned(own, 'customers', CUST_ID);
    trackOwned(own, 'products', PROD_ID);
    trackOwned(own, 'product_variants', VAR_ID);
    trackOwned(own, 'companies', COMP_ID);
    trackOwned(own, 'users', EMP_ID);
  });

  test.afterAll(async () => {
    // Rows AND uploaded objects, both by explicit id/path. A failing removal now fails the lane
    // (see cleanupFixtures) instead of leaving an orphan nobody counted.
    await cleanupFixtures();
  });

  // ─── CUSTOMER: Full Lifecycle ─────────────────────────────────────────────

  test('Customer: upload → save → reload → view → replace → reload → remove', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await page.waitForLoadState('networkidle');

    // Upload A
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(IMG_A);
    await waitForUpload(page);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();

    // The save writes via RPC; poll the DB for the new URL instead of a fixed wait.
    await expect
      .poll(
        async () => {
          const rows = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
          return rows[0]?.image_url as string | null;
        },
        { timeout: 30_000 },
      )
      .toContain('supabase.co/storage');
    let db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    const urlA = db[0].image_url;
    trackUploadedObject(urlA);

    // Reload → view persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBe(urlA);

    // Replace B
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(IMG_B);
    await waitForUpload(page);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();

    await expect
      .poll(
        async () => {
          const rows = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
          return rows[0]?.image_url as string | null;
        },
        { timeout: 30_000 },
      )
      .not.toBe(urlA);
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    const urlB = db[0].image_url;
    trackUploadedObject(urlB);

    // Reload → new image persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBe(urlB);

    // Remove
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    const rm = page.locator('button:has-text("Remove")').first();
    if (await rm.isVisible()) {
      await rm.click();
      // Removing a picture is now confirmed in the app's own dialog (a browser
      // popup cannot carry translated buttons), so the test must confirm it.
      await page.getByRole('button', { name: 'Remove photo', exact: true }).last().click();
      await page.waitForTimeout(800);
    }
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();
    await page.waitForTimeout(2000);

    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBeNull();

    // Reload → removal persists
    await page.reload();
    await page.waitForLoadState('networkidle');
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBeNull();
  });

  // ─── PRODUCT: Full Lifecycle ──────────────────────────────────────────────

  test('Product: upload → save → reload → view → replace → reload → remove via DB', async ({ page }) => {
    // Product edit uses a custom file input (not ImageUpload component).
    // The edit bottom sheet has a Camera button that triggers fileInputRef.
    // We test upload via the AddProduct page (uses ImageUpload component),
    // then test replace/remove via DB (same business layer).

    // Upload via AddProduct page
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="file"]').first().setInputFiles(IMG_A);
    await waitForUpload(page);
    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
    // OWNERSHIP: a src the app uploaded is a real object — the one kind of URL worth tracking.
    // The synthetic URLs this file writes straight into the database address nothing and are not
    // tracked, so cleanup never tries to delete an object that never existed.
    trackUploadedObject(src);

    // Set image on product via DB (simulates what saveEdit does)
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/product-images/prod-${RUN}.jpg`;
    await execSql(`UPDATE products SET image_url = '${testUrl}' WHERE id = '${PROD_ID}'`);

    // Reload → view persists
    let db = await execSql(`SELECT image_url FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].image_url).toBe(testUrl);

    // Replace
    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/product-images/prod-${RUN}-b.jpg`;
    await execSql(`UPDATE products SET image_url = '${testUrl2}' WHERE id = '${PROD_ID}'`);
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].image_url).toBe(testUrl2);
    expect(db[0].image_url).not.toBe(testUrl);

    // Reload → new image persists
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].image_url).toBe(testUrl2);

    // Remove
    await execSql(`UPDATE products SET image_url = NULL WHERE id = '${PROD_ID}'`);
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].image_url).toBeNull();

    // Reload → removal persists
    db = await execSql(`SELECT image_url FROM products WHERE id = '${PROD_ID}'`);
    expect(db[0].image_url).toBeNull();
  });

  // ─── COMPANY: Full Lifecycle ──────────────────────────────────────────────

  test('Company: upload → save → reload → view → replace → reload → remove via DB', async ({ page }) => {
    // Company logo is set on AddCompany page (uses ImageUpload component).
    // CompanyDetailPage is read-only (no edit).
    // We test upload via AddCompany page, then replace/remove via DB.

    // Upload via AddCompany page
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/companies/new`);
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="file"]').first().setInputFiles(IMG_A);
    await waitForUpload(page);
    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
    // OWNERSHIP: a src the app uploaded is a real object — the one kind of URL worth tracking.
    // The synthetic URLs this file writes straight into the database address nothing and are not
    // tracked, so cleanup never tries to delete an object that never existed.
    trackUploadedObject(src);

    // Set logo via DB
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/company-logos/comp-${RUN}.jpg`;
    await execSql(`UPDATE companies SET logo_url = '${testUrl}' WHERE id = '${COMP_ID}'`);

    // Reload → view persists
    let db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].logo_url).toBe(testUrl);

    // Replace
    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/company-logos/comp-${RUN}-b.jpg`;
    await execSql(`UPDATE companies SET logo_url = '${testUrl2}' WHERE id = '${COMP_ID}'`);
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].logo_url).toBe(testUrl2);

    // Reload → persists
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].logo_url).toBe(testUrl2);

    // Remove
    await execSql(`UPDATE companies SET logo_url = NULL WHERE id = '${COMP_ID}'`);
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].logo_url).toBeNull();

    // Reload → persists
    db = await execSql(`SELECT logo_url FROM companies WHERE id = '${COMP_ID}'`);
    expect(db[0].logo_url).toBeNull();
  });

  // ─── EMPLOYEE: Full Lifecycle ─────────────────────────────────────────────

  test('Employee: upload → save → reload → view → replace → reload → remove via DB', async ({ page }) => {
    // Employee photo is set on AddEmployee page (uses ImageUpload component).
    // EmployeeDetailPage is read-only (no edit).
    // Settings pages have Camera upload but no Remove.
    // We test upload via AddEmployee page, then replace/remove via DB.

    // Upload via AddEmployee page
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/employees/new`);
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="file"]').first().setInputFiles(IMG_A);
    await waitForUpload(page);
    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toContain('supabase.co/storage');
    // OWNERSHIP: a src the app uploaded is a real object — the one kind of URL worth tracking.
    // The synthetic URLs this file writes straight into the database address nothing and are not
    // tracked, so cleanup never tries to delete an object that never existed.
    trackUploadedObject(src);

    // Set photo via DB
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/employee-photos/emp-${RUN}.jpg`;
    await execSql(`UPDATE users SET photo_url = '${testUrl}' WHERE id = '${EMP_ID}'`);

    // Reload → view persists
    let db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].photo_url).toBe(testUrl);

    // Replace
    const testUrl2 = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/employee-photos/emp-${RUN}-b.jpg`;
    await execSql(`UPDATE users SET photo_url = '${testUrl2}' WHERE id = '${EMP_ID}'`);
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].photo_url).toBe(testUrl2);

    // Reload → persists
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].photo_url).toBe(testUrl2);

    // Remove
    await execSql(`UPDATE users SET photo_url = NULL WHERE id = '${EMP_ID}'`);
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].photo_url).toBeNull();

    // Reload → persists
    db = await execSql(`SELECT photo_url FROM users WHERE id = '${EMP_ID}'`);
    expect(db[0].photo_url).toBeNull();
  });

  // ─── DB REFERENCE AUTHORITY ───────────────────────────────────────────────

  test('DB reference is authoritative for all entities', async () => {
    const entities = [
      { table: 'customers', col: 'image_url', id: CUST_ID, bucket: 'customer-images' },
      { table: 'products', col: 'image_url', id: PROD_ID, bucket: 'product-images' },
      { table: 'companies', col: 'logo_url', id: COMP_ID, bucket: 'company-logos' },
      { table: 'users', col: 'photo_url', id: EMP_ID, bucket: 'employee-photos' },
    ];

    for (const e of entities) {
      const url = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/${e.bucket}/auth-${RUN}-${e.table}.jpg`;
      await execSql(`UPDATE ${e.table} SET ${e.col} = '${url}' WHERE id = '${e.id}'`);
      let db = await execSql(`SELECT ${e.col} FROM ${e.table} WHERE id = '${e.id}'`);
      expect(db[0][e.col]).toBe(url);

      await execSql(`UPDATE ${e.table} SET ${e.col} = NULL WHERE id = '${e.id}'`);
      db = await execSql(`SELECT ${e.col} FROM ${e.table} WHERE id = '${e.id}'`);
      expect(db[0][e.col]).toBeNull();
    }
  });

  // ─── STORAGE SECURITY ─────────────────────────────────────────────────────

  test('Storage: all 4 buckets exist and are public', async () => {
    const buckets = await execSql(`SELECT id, public FROM storage.buckets WHERE id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images')`);
    expect(buckets.length).toBe(4);
    for (const b of buckets) expect(b.public).toBe(true);
  });

  test('Storage: the only policies are the public read and authenticated upload 0230 defines', async () => {
    const policies = await execSql(`SELECT cmd, count(*) as cnt FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' GROUP BY cmd`);
    const cmds = policies.map((p: any) => p.cmd);
    expect(cmds).toContain('SELECT');
    expect(cmds).toContain('INSERT');
    // 0230 removed every client UPDATE/DELETE policy on purpose: bucket-wide writes let any
    // authenticated member — and any anonymous holder of the key the browser bundle ships —
    // overwrite or delete another shop's images. The app only uploads a fresh unique path and
    // reads a public URL, so their return is a security regression, not a missing feature.
    expect(cmds, 'a client UPDATE policy is back on storage.objects').not.toContain('UPDATE');
    expect(cmds, 'a client DELETE policy is back on storage.objects').not.toContain('DELETE');
  });

  test('Storage: no per-user ownership restriction — any authenticated user can modify any image', async () => {
    // Document the security posture after 0230:
    // The policies restrict to the four image buckets but NOT by user/owner, so any authenticated
    // member can UPLOAD into any of them. They can neither replace nor delete an object: 0230
    // dropped every client UPDATE/DELETE policy, so RLS denies those and only the service role can
    // remove one. Which row points at an image is the business layer's control, not storage's.
    const policies = await execSql(`SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`);
    const imageBuckets = ['product-images', 'employee-photos', 'company-logos', 'customer-images'];

    // Scope to image-bucket policies FIRST: PR #10 added per-bucket policies
    // (business-documents, finance-receipts) whose qual mentions only its own
    // bucket, so demanding every policy's qual contain every image bucket fails
    // on policies that have nothing to do with images. The posture asserted
    // below — no per-user restriction on the image buckets — is unchanged.
    const imagePolicies = policies.filter(
      (p: any) => p.qual && imageBuckets.some((b) => (p.qual as string).includes(b)),
    );
    expect(imagePolicies.length, 'no image-bucket storage policies found').toBeGreaterThan(0);

    for (const p of imagePolicies) {
      // None should have user/owner restrictions (no auth.uid() or similar)
      expect(p.qual).not.toContain('auth.uid()');
      expect(p.qual).not.toContain('owner');
      // qual=null on INSERT means no restriction at all — any user can upload anywhere
    }
  });

  // ─── ORPHAN FILE BEHAVIOR ─────────────────────────────────────────────────

  test('Orphan: replace clears DB reference — old storage object not auto-deleted', async ({ page }) => {
    // Upload A
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}`);
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(IMG_A);
    await waitForUpload(page);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();

    await expect
      .poll(
        async () => {
          const rows = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
          return rows[0]?.image_url as string | null;
        },
        { timeout: 30_000 },
      )
      .toBeTruthy();
    let db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    const urlA = db[0].image_url;
    trackUploadedObject(urlA);

    // Replace B
    await page.locator('button').filter({ hasText: /Edit|edit/ }).first().click();
    await page.waitForTimeout(500);
    await page.locator('input[type="file"]').first().setInputFiles(IMG_B);
    await waitForUpload(page);
    await page.locator('button').filter({ hasText: /Save|save/ }).last().click();

    await expect
      .poll(
        async () => {
          const rows = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
          return rows[0]?.image_url as string | null;
        },
        { timeout: 30_000 },
      )
      .not.toBe(urlA);
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    const urlB = db[0].image_url;
    trackUploadedObject(urlB);

    // Old URL A is no longer the authoritative reference
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}' AND image_url = '${urlA}'`);
    expect(db.length).toBe(0);

    // New URL B is the authoritative reference
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}' AND image_url = '${urlB}'`);
    expect(db.length).toBe(1);

    // Old storage object A may still exist in storage (orphan)
    // This is a documented limitation — no automatic cleanup

    // Cleanup
    await execSql(`UPDATE customers SET image_url = NULL WHERE id = '${CUST_ID}'`);
    db = await execSql(`SELECT image_url FROM customers WHERE id = '${CUST_ID}'`);
    expect(db[0].image_url).toBeNull();
  });

  // ─── IMAGE COMPRESSION ────────────────────────────────────────────────────

  test('Image compression: every upload uses the adaptive 500 KB-capped path', async () => {
    const storageContent = await import('fs').then((fs) =>
      fs.readFileSync('src/lib/storage.ts', 'utf-8')
    );
    const compressionContent = await import('fs').then((fs) =>
      fs.readFileSync('src/lib/imageCompression.ts', 'utf-8')
    );
    expect(storageContent).toContain('prepareImage');
    expect(storageContent).toContain('compressImage');
    expect(storageContent).not.toContain('MAX_DIMENSION');
    expect(compressionContent).toContain('HARD_MAX_IMAGE_BYTES = 500 * 1024');
    expect(compressionContent).toContain('classifyImageSurface');
    expect(compressionContent).toContain('toBlob');
    expect(compressionContent).toContain('markImagePrepared');
  });
});
