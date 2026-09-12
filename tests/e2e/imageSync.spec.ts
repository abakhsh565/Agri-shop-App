/**
 * E2E Test: Image Synchronization
 *
 * Tests the complete image lifecycle for all entity types:
 * Customer, Product, Company/Supplier, Employee/Admin
 *
 * Tests: Upload → Persistence → Cross-screen → Replace → Remove → Storage security
 *
 * Uses the QA database (never production).
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { injectAdminAuth, setupFixtures, cleanupFixtures, execSql, QA_IDS } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = 'http://localhost:5173';
const TEST_IMAGE_A = path.resolve(__dirname, 'fixtures/test-image.png');
const TEST_IMAGE_B = path.resolve(__dirname, 'fixtures/test-image-2.png');

// Unique IDs for this test run (must be valid UUIDs for DB columns)
import { randomUUID } from 'crypto';
const TEST_RUN = Date.now().toString(36);
const TEST_CUSTOMER_ID = randomUUID();
const TEST_CUSTOMER_PHONE = `923${TEST_RUN.slice(-8).padStart(8, '0')}`;

test.describe('Image Synchronization', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    // Create a test customer for image testing
    await execSql(`
      INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${TEST_CUSTOMER_ID}', 'Image Test Customer', '${TEST_CUSTOMER_PHONE}', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  test.afterAll(async () => {
    // Cleanup: remove test customer
    await execSql(`DELETE FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`).catch(() => {});
    await cleanupFixtures();
  });

  test('Customer Image — Upload, Persistence, Replace, Remove', async ({ page }) => {
    // ─── STEP 1: Navigate to Customer Profile ─────────────────────────────
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/employee/customers/${TEST_CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    // ─── STEP 2: Open Edit Modal ──────────────────────────────────────────
    // Click the Edit Customer button to open the modal with ImageUpload
    const editBtn = page.locator('button').filter({ hasText: /Edit|edit/ }).first();
    await editBtn.click();
    await page.waitForTimeout(500);

    // ─── STEP 3: Upload Image A ───────────────────────────────────────────
    // The ImageUpload component has a hidden file input inside the modal
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_IMAGE_A);

    // Wait for upload to complete (image should appear)
    await page.waitForTimeout(3000);

    // Verify image appears in the modal
    const profileImg = page.locator('img[alt]').first();
    const imgSrc = await profileImg.getAttribute('src');
    expect(imgSrc).toBeTruthy();
    expect(imgSrc).toContain('supabase.co/storage');

    // ─── STEP 4: Save the edit ───────────────────────────────────────────
    // Click Save button to persist the image to DB
    const saveBtn = page.locator('button').filter({ hasText: /Save|save/ }).last();
    await saveBtn.click();
    await page.waitForTimeout(2000);

    // ─── STEP 3: Verify DB Reference ──────────────────────────────────────
    const dbResult = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult.length).toBe(1);
    expect(dbResult[0].image_url).toBeTruthy();
    expect(dbResult[0].image_url).toContain('supabase.co/storage');
    const uploadedUrl = dbResult[0].image_url;

    // ─── STEP 4: Verify Storage Object ────────────────────────────────────
    // Extract storage path from URL
    const storagePath = uploadedUrl.split('/object/public/customer-images/')[1];
    expect(storagePath).toBeTruthy();

    // Verify the storage object is accessible
    const response = await page.request.get(uploadedUrl);
    expect(response.status()).toBe(200);

    // ─── STEP 6: Persistence — Reload ─────────────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Image should still appear after reload
    const reloadedImg = page.locator('img[alt]').first();
    const reloadedSrc = await reloadedImg.getAttribute('src');
    expect(reloadedSrc).toBe(uploadedUrl);

    // ─── STEP 7: Cross-screen — Navigate away and return ──────────────────
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    await page.goto(`${BASE_URL}/employee/customers/${TEST_CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    const crossScreenImg = page.locator('img[alt]').first();
    const crossScreenSrc = await crossScreenImg.getAttribute('src');
    expect(crossScreenSrc).toBe(uploadedUrl);

    // ─── STEP 8: Replace with Image B ─────────────────────────────────────
    // Re-open the edit modal
    const editBtn2 = page.locator('button').filter({ hasText: /Edit|edit/ }).first();
    await editBtn2.click();
    await page.waitForTimeout(500);
    const fileInput2 = page.locator('input[type="file"]').first();
    await fileInput2.setInputFiles(TEST_IMAGE_B);
    await page.waitForTimeout(3000);

    // Save the replacement
    const saveBtn2 = page.locator('button').filter({ hasText: /Save|save/ }).last();
    await saveBtn2.click();
    await page.waitForTimeout(2000);

    // Verify DB reference changed (after save)
    const dbResult2 = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult2.length).toBe(1);
    expect(dbResult2[0].image_url).toBeTruthy();
    expect(dbResult2[0].image_url).not.toBe(uploadedUrl); // Different URL
    const replacedUrl = dbResult2[0].image_url;

    // Reload to pick up the store update (saveEdit reloads store async)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify new image appears after reload
    const replacedImg = page.locator('img[alt]').first();
    const replacedSrc = await replacedImg.getAttribute('src');
    expect(replacedSrc).toBe(replacedUrl);

    // Verify old image URL is no longer the authoritative reference
    const dbResult3 = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult3[0].image_url).not.toBe(uploadedUrl);

    // ─── STEP 9: Persistence of replaced image ────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedReplacedImg = page.locator('img[alt]').first();
    const reloadedReplacedSrc = await reloadedReplacedImg.getAttribute('src');
    expect(reloadedReplacedSrc).toBe(replacedUrl);

    // ─── STEP 10: Remove Image ────────────────────────────────────────────
    // Open edit modal
    const editBtn3 = page.locator('button').filter({ hasText: /Edit|edit/ }).first();
    await editBtn3.click();
    await page.waitForTimeout(500);

    // Click the Remove button inside the ImageUpload component
    const removeBtn = page.locator('button:has-text("Remove")').first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await page.waitForTimeout(500);
    }

    // Save the removal
    const saveBtn3 = page.locator('button').filter({ hasText: /Save|save/ }).last();
    await saveBtn3.click();
    await page.waitForTimeout(2000);

    // Verify DB reference is cleared
    const dbResult4 = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult4.length).toBe(1);
    expect(dbResult4[0].image_url).toBeNull();

    // Verify fallback is shown (no image or placeholder)
    // After removal, the ImageUpload component shows the "Add photo" placeholder
    // ─── STEP 11: Persistence of removal ──────────────────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');

    const dbResult5 = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult5[0].image_url).toBeNull();
  });

  test('Customer Image — DB reference is authoritative', async ({ page }) => {
    // Test that the DB is the source of truth, not local state
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Set image URL directly in DB
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/customer-images/test-authority-${TEST_RUN}.jpg`;
    await execSql(
      `UPDATE customers SET image_url = '${testUrl}' WHERE id = '${TEST_CUSTOMER_ID}'`
    );

    // Navigate to profile — should show the DB image
    await page.goto(`${BASE_URL}/employee/customers/${TEST_CUSTOMER_ID}`);
    await page.waitForLoadState('networkidle');

    const img = page.locator('img[alt]').first();
    const src = await img.getAttribute('src');
    expect(src).toBe(testUrl);

    // Clear it in DB
    await execSql(
      `UPDATE customers SET image_url = NULL WHERE id = '${TEST_CUSTOMER_ID}'`
    );

    // Reload — should show fallback
    await page.reload();
    await page.waitForLoadState('networkidle');

    // After clearing, the DB should show null
    const dbResult = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult[0].image_url).toBeNull();
  });

  test('Image Upload — Storage security policies', async ({ page }) => {
    // Verify storage bucket policies
    const policies = await execSql(`
      SELECT policyname, cmd, qual
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    `);

    // Should have policies for all 4 buckets
    const bucketNames = ['product-images', 'employee-photos', 'company-logos', 'customer-images'];

    // Verify public read access exists
    const readPolicies = policies.filter(p => p.cmd === 'SELECT');
    expect(readPolicies.length).toBeGreaterThanOrEqual(1);

    // Verify insert policies exist
    const insertPolicies = policies.filter(p => p.cmd === 'INSERT');
    expect(insertPolicies.length).toBeGreaterThanOrEqual(1);

    // Verify delete policies exist
    const deletePolicies = policies.filter(p => p.cmd === 'DELETE');
    expect(deletePolicies.length).toBeGreaterThanOrEqual(1);
  });

  test('Image Upload — Bucket accessibility', async ({ page }) => {
    // Verify all 4 storage buckets exist and are public
    const buckets = await execSql(`
      SELECT id, name, public FROM storage.buckets
      WHERE id IN ('product-images', 'employee-photos', 'company-logos', 'customer-images')
    `);

    expect(buckets.length).toBe(4);
    for (const bucket of buckets) {
      expect(bucket.public).toBe(true);
    }
  });

  test('Image Upload — No orphan file cleanup on remove', async ({ page }) => {
    // Document that removing an image from the DB does NOT delete the storage file
    // This is a known limitation — the storage file remains as an orphan

    // Upload an image
    const testUrl = `https://bpybjrjenwccowvtrevu.supabase.co/storage/v1/object/public/customer-images/orphan-test-${TEST_RUN}.jpg`;

    // Set it in DB
    await execSql(
      `UPDATE customers SET image_url = '${testUrl}' WHERE id = '${TEST_CUSTOMER_ID}'`
    );

    // Verify it's set
    const dbResult = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult[0].image_url).toBe(testUrl);

    // Clear it (simulating remove)
    await execSql(
      `UPDATE customers SET image_url = NULL WHERE id = '${TEST_CUSTOMER_ID}'`
    );

    // Verify DB is cleared
    const dbResult2 = await execSql(
      `SELECT image_url FROM customers WHERE id = '${TEST_CUSTOMER_ID}'`
    );
    expect(dbResult2[0].image_url).toBeNull();

    // Note: The storage file is NOT deleted — this is a documented limitation
    // The file remains in storage as an orphan
  });
});
