/**
 * E2E: the owner's two marketplace switches, driven the way a person drives them.
 *
 * WHY A BROWSER TEST AND NOT ONLY THE CONTRACT SUITE. `marketplaceContract.test.ts` proves
 * what the contract returns once the rows are set; it never touches the two screens that
 * set them. The failure that matters here lives exactly in that gap: the product form shows
 * the switch, and if the form cannot see the stored value, opening a listed product and
 * saving it would unlist it as a side effect of a save the owner never thought was about
 * the marketplace at all. So this spec types into the real form, ticks the real switch and
 * judges the database — and then re-opens the product to prove the form reads back what it
 * saved.
 *
 * The branch half is driven the same way: the switch is only offered when the branch has a
 * location, so the fixture pins the seeded QA branch first (a real point in Lahore), and
 * the assertion after the save is not just the two columns — it is that the product becomes
 * reachable through `marketplace_listings`, the public contract a farmer would read, and
 * that turning the branch off removes it again. The branch sets no distance of its own: how far
 * a farmer searches from is the farmer's choice (0187), so the owner's whole contribution is
 * the pin and the switch.
 *
 * QA database only. Everything this spec creates is deleted in afterAll, and the shared
 * branch is returned to exactly the state it was found in: no pin, marketplace off.
 */
import { test, expect } from '@playwright/test';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  ownership,
  trackOwned,
  injectAdminAuth,
} from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const RUN = Date.now().toString(36).toUpperCase();
const PRODUCT_NAME = `QA Marketplace ${RUN}`;

// This spec's own fixture ids — `d9` is not declared by any other test file (see
// tests/unit/fixtureIdCollision.test.ts: two files sharing a UUID is a defect).
const BRANCH_PRODUCT = 'd9000000-0000-0000-0000-000000000001';
const BRANCH_VARIANT = 'd9000000-0000-0000-0000-000000000002';

const PIN = '4321';

/**
 * Switch the app to Urdu the way the other admin lanes do, and get back past the PIN gate a
 * reload puts in front of the session.
 *
 * The write is unconditional (including creating the key): guarding it on an existing entry
 * silently does nothing in a fresh context, and the test then asserts Urdu against an app that
 * is still English.
 */
async function setUrdu(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.language = 'ur';
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(1500);
  }
}

/**
 * The branch this lane pins: the shop's own default branch row, resolved rather than assumed.
 *
 * The lane used to address both rows as `QA_IDS.shop`. That was true while the tenant WAS the
 * branch; since 0188 a shop owns branch rows with their own ids, and the profile screen lists
 * them by those ids — while the marketplace FLAG still lives on the shop (0188's read returns
 * `s.marketplace_enabled` and 0184's write sets it). So the two ids are genuinely different
 * things, and the selectors below have to say which one they mean.
 */
let BRANCH_ID = '';

/** Put the shared QA branch back exactly as the baseline has it: unpinned and unlisted. */
async function restoreShop() {
  await execSql(
    `UPDATE shops SET marketplace_enabled = false,
       latitude = NULL, longitude = NULL, location_label = NULL, location_source = NULL
     WHERE id = '${QA_IDS.shop}'`,
  ).catch(() => undefined);
  await execSql(
    `UPDATE branches SET latitude = NULL, longitude = NULL, location_label = NULL, location_source = NULL
     WHERE tenant_id = '${QA_IDS.shop}'`,
  ).catch(() => undefined);
}

test.describe('Farmer marketplace listing — the owner switches', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    const branches = await execSql(
      `SELECT id FROM branches WHERE tenant_id = '${QA_IDS.shop}' AND is_active ORDER BY is_default DESC, created_at LIMIT 1`,
    );
    BRANCH_ID = String(branches[0]?.id ?? '');
    expect(BRANCH_ID, 'the shared shop has no active branch to list on').not.toBe('');
    // A switch that has nothing to measure distance from is refused, and since 0188 the location
    // the branch screen reads is the BRANCH's own — while the flag it writes is the shop's. Both
    // are pinned, and both are restored in afterAll.
    await execSql(
      `UPDATE branches SET latitude = 31.5204, longitude = 74.3587, location_label = 'QA Lahore'
       WHERE id = '${BRANCH_ID}'`,
    );
    await execSql(
      `UPDATE shops SET latitude = 31.5204, longitude = 74.3587, location_label = 'QA Lahore'
       WHERE id = '${QA_IDS.shop}'`,
    );
  });

  test.afterAll(async () => {
    // CLEANUP IS OWNERSHIP-BASED NOW. The five deletes that used to run here were scoped by a NAME
    // (`WHERE name LIKE 'QA Marketplace …%'`) and by a hand-written join order, with every error
    // swallowed. The products this lane creates are registered by id the moment they exist — the
    // form-created one from the id the database returns, the branch fixture from its fixed id — and
    // the registry removes their variants and stock movements through `product_id` before the
    // product itself. `restoreShop` stays because it RESTORES state (no pin, switch off) rather
    // than deleting a record that was never this lane's.
    await restoreShop();
    await cleanupFixtures();
  });

  test('1. the product switch saves, reads back on the form, and only unlists when unticked', async ({ page }) => {
    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('product-name').fill(PRODUCT_NAME);
    // The supplier picker is the app's own sheet, not a native <select>.
    await page.getByRole('button', { name: 'Choose supplier' }).click();
    await page.locator('.ds-row', { hasText: 'QA Supplier A' }).first().click();
    await page.getByTestId('product-pack-size-0').fill('1');
    await page.getByTestId('product-pack-cost-0').fill('500');
    await page.getByTestId('product-pack-sell-0').fill('600');
    await page.getByTestId('product-pack-stock-0').fill('10');

    const toggle = page.getByTestId('product-marketplace-toggle');
    await expect(toggle, 'a new product starts unlisted').toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle, 'the switch follows the tap').toHaveAttribute('aria-checked', 'true');

    await page.getByTestId('product-save').click();
    await page.waitForTimeout(6000);

    const created = await execSql(
      `SELECT id, marketplace_listed, marketplace_listed_at FROM products WHERE name = '${PRODUCT_NAME}'`,
    );
    // OWNED BEFORE ANY ASSERTION ON IT, and that ordering is the whole point. These assertions are
    // the ones this lane exists to catch — a form that cannot see the stored value saves `false`.
    // When that happened on 2026-10-14, the row was created, the assertion threw, and the
    // registration below it never ran: the product, its variant and its opening-stock movement sat
    // in the QA baseline as unexplained drift (`qa:baseline` reported products 6, declared 5).
    // "Registered the moment it exists" has to mean before the check, not after it, or a lane can
    // only clean up after the runs that did not need cleaning up.
    for (const row of created) await trackOwned(ownership(), 'products', String(row.id));
    expect(created.length, 'the product must be created').toBe(1);
    expect(
      created[0].marketplace_listed,
      'the ticked switch must be what the product is stored with',
    ).toBe(true);
    expect(created[0].marketplace_listed_at, 'listing records when it happened').not.toBeNull();

    // The packs and any opening stock movement follow `product_id` in the cleanup graph, and the id
    // is used before the rename below, which would make the name marker useless.
    const productId = created[0].id as string;
    const editUrl = `${BASE_URL}/admin/inventory/${productId}/edit`;

    // Re-open the product: the switch must read the stored decision, not a default.
    await page.goto(editUrl);
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByTestId('product-marketplace-toggle'),
      'a listed product opens listed',
    ).toHaveAttribute('aria-checked', 'true');

    // Save an unrelated edit WITHOUT touching the switch. This is the defect the guard exists
    // for: a form that cannot see the stored value saves `false` and unlists a listed product.
    await page.getByTestId('product-name').fill(`${PRODUCT_NAME} edited`);
    await page.getByTestId('product-save').click();
    await page.waitForTimeout(6000);

    const untouched = await execSql(
      `SELECT name, marketplace_listed FROM products WHERE id = '${productId}'`,
    );
    expect(untouched[0].name, 'the unrelated edit is what was saved').toBe(`${PRODUCT_NAME} edited`);
    expect(
      untouched[0].marketplace_listed,
      'an edit that did not touch the switch must not unlist a listed product',
    ).toBe(true);

    // Now untick it on purpose: that must travel as a decision, and clear the listing moment.
    await page.goto(editUrl);
    await page.waitForLoadState('networkidle');
    const reopen = page.getByTestId('product-marketplace-toggle');
    await expect(reopen).toHaveAttribute('aria-checked', 'true');
    await reopen.click();
    await expect(reopen).toHaveAttribute('aria-checked', 'false');
    await page.getByTestId('product-save').click();
    await page.waitForTimeout(6000);

    const unlisted = await execSql(
      `SELECT marketplace_listed, marketplace_listed_at FROM products WHERE id = '${productId}'`,
    );
    expect(unlisted[0].marketplace_listed, 'unticking and saving unlists').toBe(false);
    expect(unlisted[0].marketplace_listed_at, 'the listing moment is cleared with the listing').toBeNull();
  });

  test('3. both new controls read in Urdu, with nothing English left behind', async ({ page }) => {
    await injectAdminAuth(page);
    await setUrdu(page);

    // The page itself mirrors — the sheet and the switch row are laid out by the same direction.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // ── The product switch ──────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForLoadState('networkidle');
    const productToggle = page.getByTestId('product-marketplace-toggle');
    await expect(productToggle, 'the product switch is announced in Urdu').toHaveAttribute(
      'aria-label',
      'کسان مارکیٹ میں شامل کریں',
    );
    await expect(
      page.getByText('کسان اس سامان کو آپ کی اُن شاخوں میں تلاش کر سکتے ہیں جو مارکیٹ میں شامل ہیں۔'),
      'the hint under the product switch is the Urdu sentence',
    ).toBeVisible();
    await expect(
      page.getByText('List on Farmer Marketplace', { exact: true }),
      'no English left on the product switch',
    ).toHaveCount(0);

    // ── The branch switch ───────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/admin/settings/profile`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId(`branch-row-${BRANCH_ID}`).click();
    const branchToggle = page.getByTestId(`branch-marketplace-toggle-${BRANCH_ID}`);
    await expect(branchToggle, 'the branch switch is announced in Urdu').toHaveAttribute(
      'aria-label',
      'اس شاخ کو شامل کریں',
    );
    // The switch is the whole decision — there is no distance row under it any more, so nothing
    // here depends on turning it on.
    await expect(
      page.getByText('List this branch', { exact: true }),
      'no English left on the branch switch',
    ).toHaveCount(0);
    await expect(
      page.getByText('Farmers searching near this branch can find the products you listed for it.', {
        exact: true,
      }),
      'no English left under the branch switch',
    ).toHaveCount(0);
    await expect(
      page.getByText('Farmers within', { exact: true }),
      'the owner-side distance row is gone, in every language',
    ).toHaveCount(0);
  });

  test('2. the branch switch saves and decides what a farmer can collect', async ({ page }) => {
    // A listed, priced, in-stock product at the shared branch, so the branch switch is the only
    // thing standing between it and the public contract.
    await execSql(`
      INSERT INTO products (id, name, category, shop_id, is_active, base_unit, marketplace_listed, marketplace_listed_at)
      VALUES ('${BRANCH_PRODUCT}', '${PRODUCT_NAME} branch', 'seed', '${QA_IDS.shop}', true, 'kg', true, now())
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
        marketplace_listed = true, marketplace_listed_at = now()
    `);
    await execSql(`
      INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty, is_active)
      VALUES ('${BRANCH_VARIANT}', '${BRANCH_PRODUCT}', '10kg bag', 900, 700, 10, 2, 12, true)
      ON CONFLICT (id) DO UPDATE SET selling_price = 900, stock_qty = 12, is_active = true
    `);
    // OWNED: the branch fixture product, by its fixed id (this lane's own `d9…` block). Its
    // variant and its movements are removed through `product_id` by the registry.
    await trackOwned(ownership(), 'products', BRANCH_PRODUCT);

    await injectAdminAuth(page);
    await page.goto(`${BASE_URL}/admin/settings/profile`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId(`branch-row-${BRANCH_ID}`).click();
    const toggle = page.getByTestId(`branch-marketplace-toggle-${BRANCH_ID}`);
    await expect(toggle, 'a pinned branch can be listed').toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');

    // The switch writes the moment it is moved — the branch screen has no Save button, because
    // there is nothing on it worth batching (one place, one switch).
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(6000);

    const saved = await execSql(
      `SELECT marketplace_enabled FROM shops WHERE id = '${QA_IDS.shop}'`,
    );
    expect(saved[0].marketplace_enabled, 'the branch switch is what was saved').toBe(true);

    // Both switches on and the pack in stock: the product is now reachable through the public
    // contract — which is the whole point of the owner-side work.
    const reachable = await execSql(
      `SELECT count(*)::int AS n FROM marketplace_listings WHERE product_id = '${BRANCH_PRODUCT}'`,
    );
    expect(Number(reachable[0].n), 'a listed product at a listed branch is on the public contract').toBe(1);

    // Turning the branch off removes it again. Back to the list first: the toggle left the page
    // on the branch itself, and the row lives on the list.
    await page.goto(`${BASE_URL}/admin/settings/profile`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId(`branch-row-${BRANCH_ID}`).click();
    const offToggle = page.getByTestId(`branch-marketplace-toggle-${BRANCH_ID}`);
    await expect(offToggle, 'the saved switch reads back on').toHaveAttribute('aria-checked', 'true');
    await offToggle.click();
    await page.waitForTimeout(6000);

    const after = await execSql(
      `SELECT marketplace_enabled FROM shops WHERE id = '${QA_IDS.shop}'`,
    );
    expect(after[0].marketplace_enabled, 'turning it off is what was saved').toBe(false);
    const gone = await execSql(
      `SELECT count(*)::int AS n FROM marketplace_listings WHERE product_id = '${BRANCH_PRODUCT}'`,
    );
    expect(Number(gone[0].n), 'a branch that stopped listing is no longer on the contract').toBe(0);
  });
});
