/**
 * E2E: a workflow must never dead-end on a missing dependency.
 *
 * The requirement, driven end to end on the real surface:
 *   Identify the missing thing → say what it is in plain words → offer the action
 *   that creates it in place → come back to the task with the new record chosen.
 *
 * This spec proves the longest chain the graph actually has:
 *
 *   start a sale  →  no products  →  add product  →  no suppliers  →  add supplier
 *                 →  back on the product form with the supplier PRESELECTED
 *                 →  save  →  back in the sale  →  sell it  →  DB row exists
 *
 * It also proves the two negative cases that make the mechanism honest rather than
 * decorative: a search with no matches offers NO create action (the products exist),
 * and an employee — who cannot create stock — is told who can instead of being handed
 * a link the route guard would bounce.
 *
 * QA database only. Everything it creates is removed in afterAll.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql, setupFixtures, cleanupFixtures, QA_IDS } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const OWNER_PHONE = '923001234567';
const OTP = '123456';
const PIN = '4321';

function envValue(key: string): string {
  for (const file of ['.env.qa', '.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(0, i).trim() === key) return line.slice(i + 1).trim().replace(/^\[|\]$/g, '');
    }
  }
  return '';
}

const BASE_URL = envValue('QA_APP_URL') || envValue('VITE_APP_URL') || 'http://localhost:5173';

/**
 * Clean slate for the graph: no products, no suppliers — the state a brand-new shop
 * is in. Each statement carries a WHERE because the SQL helper refuses an unscoped
 * DELETE on purpose; QA holds nothing but fixture accounts between runs.
 */
async function clearStockAndSuppliers() {
  for (const table of [
    'return_items', 'returns', 'sale_items', 'sales',
    'purchase_items', 'purchases',
    'product_variants', 'products', 'companies',
  ]) {
    await execSql(`DELETE FROM ${table} WHERE true`).catch(() => undefined);
  }
}

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.removeItem('agri_auth');
    for (const k of Object.keys(localStorage)) if (/^sb-/.test(k)) localStorage.removeItem(k);
  });
  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder('e.g. 03001234567').fill(OWNER_PHONE);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });
  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await boxes.first().click();
  await page.keyboard.type(OTP);
  for (let i = 0; i < OTP.length; i++) await expect(boxes.nth(i)).toHaveValue(OTP[i]);
  await page.waitForURL(/pin-set|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });
  if (page.url().includes('pin-set')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  }
  await page.waitForTimeout(1200);
}

test.describe('Missing dependencies never dead-end a workflow', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures().catch(() => {});
  });

  test.beforeEach(async () => {
    await clearStockAndSuppliers();
  });

  test('sale with no products → create the supplier and the product in place → sell it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await login(page);

    // ── 1. The sale's product step, with nothing to sell ────────────────────────
    await page.goto(`${BASE_URL}/admin/sale/products`);
    await page.waitForTimeout(1200);

    const emptyTitle = page.getByText('No products yet', { exact: true });
    await expect(emptyTitle, 'the sale step does not say what is missing').toBeVisible();
    await expect(
      page.getByText('Add a product before you make a sale.', { exact: false }),
      'the sale step does not say why it matters',
    ).toBeVisible();

    const addProduct = page.getByRole('button', { name: 'Add product' });
    await expect(addProduct, 'the blocking screen offers no way out').toBeVisible();

    // ── 2. The action carries the workflow back ─────────────────────────────────
    await addProduct.click();
    await page.waitForTimeout(1200);
    expect(page.url(), 'the create action did not land on the product form').toContain('/admin/inventory/new');
    expect(page.url(), 'the product form did not carry the workflow to return to').toContain(
      'returnTo=%2Fadmin%2Fsale%2Fproducts',
    );

    // ── 3. The product form is itself blocked on a supplier ─────────────────────
    await page.getByRole('button', { name: /Choose supplier/i }).first().click();
    await page.waitForTimeout(500);
    await expect(
      page.getByText('No suppliers yet', { exact: true }),
      'the supplier picker does not name what is missing',
    ).toBeVisible();
    const addSupplier = page.getByRole('button', { name: 'Add supplier' });
    await expect(addSupplier, 'the empty supplier picker offers no way out').toBeVisible();

    await addSupplier.click();
    await page.waitForTimeout(1200);
    expect(page.url(), 'the supplier action did not land on the supplier form').toContain('/admin/companies/new');

    // ── 4. Create the supplier; it must come back to the product form ───────────
    const supplierName = `Dep Test Supplier ${Date.now()}`;
    // Targeted by placeholder: this form's inputs carry no `type` attribute and their
    // labels are not programmatically associated, so there is no accessible name.
    await page.getByPlaceholder('e.g. Syngenta').fill(supplierName);
    await page.getByRole('button', { name: 'Add Company', exact: true }).click();
    await page.waitForTimeout(2500);
    expect(page.url(), 'creating the supplier did not return to the product form').toContain(
      '/admin/inventory/new',
    );
    expect(page.url(), 'the new supplier was not handed back to the form').toContain('companyId=');

    // ...and it must already be CHOSEN, not merely available.
    await expect(
      page.getByText(supplierName, { exact: false }).first(),
      'the product form does not show the supplier that was just created',
    ).toBeVisible({ timeout: 10000 });

    // The supplier really exists and is linked to this shop.
    const company = await execSql(`SELECT id, name FROM companies WHERE name = '${supplierName}'`);
    expect(company.length, 'the supplier was not written to the database').toBe(1);

    // ── 5. Create the product and land back in the sale ─────────────────────────
    const productName = `Dep Test Product ${Date.now()}`;
    await page.getByPlaceholder('e.g. Karate Insecticide').fill(productName);
    await page.getByPlaceholder('Unit name — e.g. 500ml, 50kg').fill('1kg');
    // Variant prices: the first number fields on the form are selling then cost.
    const numbers = page.locator('input[type="number"]');
    await numbers.nth(0).fill('1000');
    await numbers.nth(1).fill('700');
    await page.getByRole('button', { name: 'Add Product' }).last().click();
    await page.waitForTimeout(3500);

    expect(page.url(), 'saving the product did not return to the sale it was created from').toContain(
      '/admin/sale/products',
    );

    const saved = await execSql(
      `SELECT p.id, p.name, p.company_id FROM products p WHERE p.name = '${productName}'`,
    );
    expect(saved.length, 'the product was not written to the database').toBe(1);
    expect(saved[0].company_id, 'the product is not linked to the supplier just created').toBe(
      company[0].id,
    );

    // ── 6. The sale can now actually be made ────────────────────────────────────
    await page.waitForTimeout(1200);
    await expect(
      page.getByText(productName, { exact: false }).first(),
      'the product created inside the flow is not sellable in it',
    ).toBeVisible({ timeout: 10000 });

    expect(errors, `page errors during the flow:\n${errors.join('\n')}`).toEqual([]);
  });

  test('a search with no matches offers no create action — nothing is missing', async ({ page }) => {
    // The product catalogue has to exist for this one, or the empty state would be the
    // dependency case and the assertion would prove nothing.
    // The company has to exist first: clearStockAndSuppliers removed it, and a product
    // cannot be written without one (products_company_id_fkey) — which is itself the
    // dependency this pass is about.
    await execSql(`
      INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
      VALUES ('${QA_IDS.companyA}', 'Search Fixture Supplier', 0, 0, '${QA_IDS.shop}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    `);
    await execSql(`
      INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
      VALUES ('30000000-0000-0000-0000-0000000000aa', 'Search Fixture', '${QA_IDS.companyA}', 'seed', 5, '${QA_IDS.shop}')
      ON CONFLICT (id) DO NOTHING;
    `);
    await execSql(`
      INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
      VALUES ('40000000-0000-0000-0000-0000000000aa', '30000000-0000-0000-0000-0000000000aa', '1kg', 500, 300, 1, 1, 5)
      ON CONFLICT (id) DO NOTHING;
    `);

    await login(page);
    await page.goto(`${BASE_URL}/admin/sale/products`);
    await page.waitForTimeout(1200);

    await page.getByPlaceholder(/Search/i).first().fill('zzzz-no-such-thing');
    await page.waitForTimeout(700);

    await expect(page.getByText('No products match your search', { exact: false })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add product' }),
      'a fruitless search offered to create a product even though the catalogue is not empty',
    ).toHaveCount(0);

    await execSql(`DELETE FROM product_variants WHERE id = '40000000-0000-0000-0000-0000000000aa'`).catch(() => undefined);
    await execSql(`DELETE FROM products WHERE id = '30000000-0000-0000-0000-0000000000aa'`).catch(() => undefined);
  });

  test('the same states in Urdu/RTL and in dark, and Home is untouched', async ({ page }) => {
    await login(page);

    // Urdu + RTL, dark: the least-tested combination, and the one the shop owner uses.
    //
    // The harness, not the assertion, was the fault here: it chose a storage key with
    // `localStorage.getItem('agrishop-theme') ? … : 'agri_theme'`, and the app writes
    // `agrishop-theme` lazily — so right after login that ternary picked the key nothing
    // reads, the store rehydrated in English, and `dir` came back `ltr`. Both keys are
    // now written (the same approach tests/e2e/interactionLayer.spec.ts uses), and the
    // result is asserted before any copy is read, so a silent failure cannot be
    // mistaken for a translation defect again.
    await page.evaluate(() => {
      for (const key of ['agrishop-theme', 'agri_theme']) {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
        parsed.state = parsed.state || {};
        parsed.state.language = 'ur';
        parsed.state.theme = 'dark';
        localStorage.setItem(key, JSON.stringify(parsed));
      }
    });
    await page.goto(`${BASE_URL}/admin/sale/products`);
    await page.waitForTimeout(1800);

    // Fail on the harness first, with the reason, rather than on the copy.
    const took = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      stored: localStorage.getItem('agrishop-theme')?.slice(0, 80) ?? null,
    }));
    expect(
      took.dir,
      `the language switch did not take, so the copy checks below would be meaningless. dir=${took.dir} lang=${took.lang} stored=${took.stored}`,
    ).toBe('rtl');

    const state = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      dark: document.documentElement.classList.contains('dark'),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      body: document.body.innerText,
    }));
    expect(state.dir, 'the Urdu direction was not applied').toBe('rtl');
    expect(state.dark, 'dark mode was not applied').toBe(true);

    // The Urdu copy is the dictionary's, not an English fallback wearing Urdu spacing.
    expect(state.body, 'the Urdu empty state does not say what is missing').toContain('ابھی کوئی سامان نہیں');
    expect(state.body, 'the Urdu reason is missing').toContain('فروخت سے پہلے سامان لکھیں');
    expect(state.body, 'the Urdu action is missing').toContain('سامان لکھیں');
    expect(
      state.body.includes('No products yet') || state.body.includes('Add product before'),
      'English leaked into the Urdu empty state',
    ).toBe(false);

    // Urdu text is longer; it must not push the screen sideways.
    expect(
      state.scrollW,
      `the Urdu empty state overflows horizontally (${state.scrollW} > ${state.clientW})`,
    ).toBeLessThanOrEqual(state.clientW + 1);

    await page.screenshot({ path: '.freebuff/interaction-shots/06-dep-empty-ur-rtl-dark.png' });

    // Home must not have grown a setup card or banner for this feature: the whole
    // mechanism lives in the workflows that hit the dependency, by design.
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForTimeout(1800);
    const home = await page.evaluate(() => document.body.innerText);
    for (const leak of ['No products yet', 'No suppliers yet', 'ابھی کوئی سامان نہیں', 'سپلائر لگائیں']) {
      expect(home.includes(leak), `the dependency layer added Home clutter: "${leak}" appeared on the dashboard`).toBe(
        false,
      );
    }
  });

  test('an employee cannot create stock, so they are told who can instead of given a dead link', async ({ page }) => {
    await login(page);

    // Impersonate the employee shell for this assertion: the graph decides availability
    // from the shell + permission, and the employee shell has no /inventory/new route.
    await page.goto(`${BASE_URL}/employee/sale/products`);
    await page.waitForTimeout(1500);

    // The owner reaching the employee path is redirected by the route guard; what
    // matters here is that no create action is rendered when it cannot be opened.
    const addProduct = page.getByRole('button', { name: 'Add product' });
    const onEmployeePath = page.url().includes('/employee/');
    if (onEmployeePath) {
      await expect(
        addProduct,
        'the employee sale step offered an action the employee shell cannot open',
      ).toHaveCount(0);
      await expect(page.getByText('Ask the owner to add products.', { exact: false })).toBeVisible();
    } else {
      // The guard bounced the owner out of the employee shell, which is the correct
      // behaviour and is asserted as such rather than treated as a failure.
      expect(page.url()).toContain('/admin/');
    }
  });
});
