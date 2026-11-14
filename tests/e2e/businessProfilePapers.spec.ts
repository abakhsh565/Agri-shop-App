/**
 * E2E Test: Business profile — the record, its lines, and its papers
 *
 * Covers the three things the owner asked for on this screen, in the order they meet them:
 *
 *   1. the record reads as lines, and every line carries its own Add/Change. There is no Edit for
 *      the whole section any more, and the shop id is copy-only.
 *   2. the Images slots take a picture. An empty slot opens the file picker; what lands in the
 *      database is a PATH inside this business's folder of the private bucket, never a public URL,
 *      and the screen draws it through a signed URL.
 *   3. a descriptive field (shop type) saves without a code and its link turns into Change,
 *      because the code is owed only by the fields that name the business or say how to reach it.
 *
 * Uses the QA database (never production). The picture it uploads is registered for cleanup, and
 * the shop columns it changes are restored to the values they held before the run.
 */
import { test, expect } from './base';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  injectAdminAuth,
  setupFixtures,
  cleanupFixtures,
  settle,
  execSql,
  trackUploadedObject,
  QA_IDS,
} from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const PAPER = path.resolve(__dirname, 'fixtures/test-image.png');
const PROFILE = `${BASE_URL}/admin/settings/business`;

/** What the shop's own record held before this lane touched it. */
type ShopSnapshot = {
  licence_url: string | null;
  cnic_front_url: string | null;
  cnic_back_url: string | null;
  shop_type: string | null;
};

let before: ShopSnapshot | null = null;

async function readShop(): Promise<ShopSnapshot> {
  const rows = await execSql(
    `SELECT licence_url, cnic_front_url, cnic_back_url, shop_type FROM shops WHERE id = '${QA_IDS.shop}'`,
  );
  return rows[0] as ShopSnapshot;
}

/** Wait for a column to reach the value the screen claims it saved, or fail with what it held. */
async function waitForColumn(column: keyof ShopSnapshot, done: (value: string | null) => boolean) {
  for (let i = 0; i < 20; i++) {
    const row = await readShop();
    if (done(row[column])) return row[column];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const row = await readShop();
  throw new Error(`${column} never reached the expected value; it held ${JSON.stringify(row[column])}`);
}

test.describe('Business profile — lines, papers and codes', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    before = await readShop();
  });

  test.afterAll(async () => {
    // Restore the record this lane edited. A picture stays in the bucket as an unreferenced object
    // (the bucket has no delete policy by design); the column that pointed at it goes back.
    if (before) {
      await execSql(
        `UPDATE shops SET
           licence_url = ${before.licence_url ? `'${before.licence_url}'` : 'NULL'},
           cnic_front_url = ${before.cnic_front_url ? `'${before.cnic_front_url}'` : 'NULL'},
           cnic_back_url = ${before.cnic_back_url ? `'${before.cnic_back_url}'` : 'NULL'},
           shop_type = ${before.shop_type ? `'${before.shop_type}'` : 'NULL'}
         WHERE id = '${QA_IDS.shop}'`,
      );
    }
    await cleanupFixtures();
  });

  async function openProfile(page: import('@playwright/test').Page) {
    await page.goto(BASE_URL);
    await injectAdminAuth(page);
    await page.goto(PROFILE);
    await settle(page, { minText: 40 });
    await expect(page.getByTestId('business-profile-page')).toBeVisible({ timeout: 30000 });
  }

  test('every line carries its own Add or Change, and the shop id only copies', async ({ page }) => {
    await openProfile(page);

    await expect(page.getByTestId('business-name')).not.toHaveText('');
    await expect(page.getByTestId('business-phone')).toBeVisible();

    // The section-wide Edit is gone: changing one fact must not require opening a form of five.
    await expect(page.getByTestId('business-details-edit')).toHaveCount(0);

    // Each editable fact has its own quiet control beside it.
    for (const field of ['name', 'whatsapp', 'email', 'type', 'registration']) {
      await expect(page.getByTestId(`business-field-${field}-change`)).toHaveCount(1);
    }

    // The shop id is a code customers and staff use, so it is never editable here.
    await expect(page.getByTestId('business-field-shop-id')).toBeVisible();
    await expect(page.getByTestId('business-field-shop-id-change')).toHaveCount(0);
    await expect(page.getByTestId('business-copy-shop-id')).toBeVisible();

    // The section is called Images, and it draws a slot for each paper — filled or not.
    await expect(page.getByTestId('business-images')).toContainText('Images');
    for (const paper of ['licence', 'cnic_front', 'cnic_back']) {
      await expect(page.getByTestId(`business-document-${paper}`)).toBeVisible();
    }
  });

  test('a paper added from its slot is framed, stored as a path and drawn from a signed URL', async ({ page }) => {
    await openProfile(page);

    const tile = page.getByTestId('business-document-licence');

    // The empty slot is the control: tapping it opens the picker, and the chosen file is what the
    // screen uploads. `filechooser` is the same event a finger on a real device produces.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), tile.click()]);
    await chooser.setFiles(PAPER);

    // The picture is framed before it is stored: the camera's own file is never uploaded raw, and
    // the frame is the shape the slot will draw. Confirming it is what starts the upload.
    const crop = page.getByTestId('image-crop');
    await expect(crop).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('image-crop-confirm')).toBeEnabled({ timeout: 20000 });
    await page.getByTestId('image-crop-confirm').click();
    await expect(crop).toHaveCount(0, { timeout: 20000 });

    const stored = await waitForColumn('licence_url', (value) => Boolean(value));
    expect(stored, 'a paper must be stored as a path in this business\'s own folder').toContain(`${QA_IDS.shop}/`);
    expect(stored, 'the bucket is private, so no public URL may be stored').not.toMatch(/^https?:/);

    // Drawn through a signature, not a public link — and the picture is really there.
    const picture = tile.locator('img');
    await expect(picture).toBeVisible({ timeout: 20000 });
    const src = await picture.getAttribute('src');
    expect(src).toContain('/object/sign/business-documents/');
    expect(src).toContain('token=');
    expect(trackUploadedObject(src), 'the uploaded object must be registered for QA cleanup').toBe(true);

    // It survives a reload: the picture is the record, not local state.
    await page.reload();
    await settle(page, { minText: 40 });
    await expect(page.getByTestId('business-document-licence').locator('img')).toBeVisible({ timeout: 20000 });

    // A stored picture opens full screen — the reference's grammar of a cross on the leading edge
    // and Change on the trailing edge, over the picture itself rather than in a bottom sheet.
    await page.getByTestId('business-document-licence').click();
    const viewer = page.getByTestId('business-image-viewer');
    await expect(viewer).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('business-image-change')).toBeVisible();
    await page.getByTestId('business-image-viewer-close').click();
    await expect(viewer).toHaveCount(0, { timeout: 20000 });
  });

  test('a descriptive field saves without a code, and its link becomes Change', async ({ page }) => {
    await openProfile(page);

    const current = (await readShop()).shop_type;
    const next = current === 'retail' ? 'wholesale' : 'retail';

    await page.getByTestId('business-field-type-change').click();
    await expect(page.getByTestId('business-field-sheet-type')).toBeVisible();
    await page.getByTestId(`business-type-${next}`).click();
    await page.getByTestId('business-field-save').click();

    // No code step: the sheet closes and the line itself shows the new answer.
    await expect(page.getByTestId('business-field-sheet-type')).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId('business-field-type')).toContainText(
      next === 'retail' ? 'Retail' : 'Wholesale',
    );
    await expect(page.getByTestId('business-field-type-change')).toHaveText('Change');

    const stored = await waitForColumn('shop_type', (value) => value === next);
    expect(stored).toBe(next);
  });
});
