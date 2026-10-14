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
 * WHERE ITS "EMPTY CATALOGUE" COMES FROM (2026-10-14). This lane works in the DEDICATED tenant
 * (`WRITE_TENANT`, see `tests/e2e/helpers.ts`): an app-created shop with a default branch, its built-in
 * roles, and ZERO business rows, whose emptiness the QA gate asserts for exactly this reason. That — not
 * a delete statement — is what makes "there is nothing to sell" true, which is the premise this whole
 * spec is built on and the reason it was recorded BLOCKED rather than fixed in place.
 *
 * The employee case signs in as `QA Isolation Employee` (the fixture's second identity, with the branch
 * scope 0188 requires), which is what that identity exists for: the negative case is now observed from
 * the employee's own session instead of by walking the owner into the employee path.
 *
 * QA database only. Everything it creates is removed in afterAll.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  WRITE_TENANT,
  claimWriteTenantLeftovers,
  cleanupFixtures,
  createInWriteTenant,
  execSql,
  loginViaUi,
  ownership,
  trackOwned,
  writeTenantCounts,
  writeTenantTotal,
} from './helpers';
import * as fs from 'fs';
import * as path from 'path';

const OWNER_PHONE = WRITE_TENANT.owner.phone;
const EMPLOYEE_PHONE = WRITE_TENANT.employee.phone;

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
 * The marker every row this lane creates carries, so a FAILED run's rows can be recognised again —
 * Playwright restarts the worker after a failure and the ownership registry lives in that process.
 */
const LANE_MARKER = 'Dep Test';

/**
 * Clean slate for the graph: no products, no suppliers — the state the dedicated tenant is in, and the
 * premise of every case below.
 *
 * WHAT THIS REPLACED. It used to delete 23 tables in full (`DELETE FROM ${table} WHERE true`) to reach
 * "the catalogue is empty, so the sale screen has nothing to sell". That is the shared-QA wipe removed
 * everywhere else, and ownership registration cannot replace it: this lane needs the ABSENCE of rows it
 * did not create, which no amount of ownership gives it. Without a shop of its own the lane could only
 * fail its own premise — which is why it was recorded BLOCKED rather than "fixed".
 *
 * WHAT MAKES IT TRUE NOW. The dedicated tenant holds zero business rows. Cleanup removes what this run
 * registered, leftovers from a failed run of THIS lane are reclaimed by the lane's own marker (scoped to
 * this tenant, which only these two lanes write), and the premise is then asserted BY NAME. A row this
 * lane did not create is never deleted to make the assertion pass — it fails the lane and is reported.
 */
async function clearStockAndSuppliers() {
  await cleanupFixtures();
  const claimed = await claimWriteTenantLeftovers(LANE_MARKER);
  if (claimed.length) {
    console.log(
      `[dependencyContinuity] reclaimed ${claimed.reduce((n, c) => n + c.ids.length, 0)} row(s) left by a failed run of this lane: ` +
        claimed.map((c) => `${c.table}=${c.ids.length}`).join(' '),
    );
    await cleanupFixtures();
  }
  const counts = await writeTenantCounts();
  expect(
    writeTenantTotal(counts),
    `the dedicated tenant ${WRITE_TENANT.id} is not empty (companies=${counts.companies} products=${counts.products} customers=${counts.customers} sales=${counts.sales}): an empty catalogue is this lane's whole premise, and nothing outside this run may write there`,
  ).toBe(0);
}

/**
 * Drop the rows the stores rehydrate from.
 *
 * A store paints its cached rows before the network answers, so emptying the database a moment
 * earlier is not enough: the browser still holds the previous case's product and supplier and
 * the screen keeps showing them. A device that has never run the app has no such cache, so an
 * empty-state case starts without it.
 */
async function clearRowCache(page: Page) {
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('agrishop_cache_')) localStorage.removeItem(k);
    }
  });
}

/**
 * Sign in through the repo's own helper rather than a second copy of the flow.
 *
 * This spec used to hand-roll it (clear storage, type, wait for `pin-set`, type a PIN), which is the
 * same sequence `loginViaUi` performs with the extra assertions that make a mis-entered digit visible:
 * the boxes are checked one by one, and `account-ready` — the third screen a first sign-in can land on,
 * which this copy did not know about — is followed rather than treated as a stuck page.
 */
const login = (page: Page) => loginViaUi(page, OWNER_PHONE);

test.describe('Missing dependencies never dead-end a workflow', () => {
  test.afterAll(async () => {
    // Only what this run owns, inside its own tenant. Nothing shared is touched.
    await cleanupFixtures();
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
    // Wait for the return navigation itself rather than a fixed sleep: on a 2-core CI runner the
    // write + redirect can outrun a timeout sized on a developer machine, and the test then fails
    // for being early rather than for being wrong. The bound still fails the lane if the return
    // never happens, and the assertion below keeps its own message.
    await page.waitForURL(/\/admin\/inventory\/new/, { timeout: 30000 }).catch(() => {});
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
    // OWNED, immediately after creation: the supplier this lane just created in the form, by the
    // id the database assigned it (its purchases and supplier payments follow `company_id`).
    await trackOwned(ownership(), 'companies', String(company[0].id));

    // ── 5. Create the product and land back in the sale ─────────────────────────
    const productName = `Dep Test Product ${Date.now()}`;
    // The form is one card per pack now, and each card's fields are addressed by test id: the
    // old "Unit name" placeholder belonged to the single-pack shape and is no longer rendered.
    await page.getByTestId('product-name').fill(productName);
    await page.getByTestId('product-pack-size-0').fill('1');
    await page.getByTestId('product-pack-sell-0').fill('1000');
    await page.getByTestId('product-pack-cost-0').fill('700');
    // Opening stock: the sale screen lists what is on the shelf, so the pack needs some.
    await page.getByTestId('product-pack-stock-0').fill('5');
    await page.getByTestId('product-save').click();
    // Same reason as the supplier step above: this is the save that failed in run 37068142514
    // after 3.5s on a 2-core runner, although the identical save returned in time in the previous
    // run. Wait for the navigation, then judge the URL.
    await page.waitForURL(/\/admin\/sale\/products/, { timeout: 30000 }).catch(() => {});
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
    // OWNED, immediately after creation: the product built inside this flow (its variants and
    // stock movements follow `product_id`).
    await trackOwned(ownership(), 'products', String(saved[0].id));

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
    //
    // The company has to exist first — a product cannot be written without one
    // (products_company_id_fkey). Both rows are created HERE, inside this lane's own tenant: an earlier
    // version asserted the SHARED supplier fixture (and before that, re-INSERTed it under another name),
    // which made this case depend on a shop it does not own. The names carry the lane's marker, so a run
    // that fails before cleanup can still be reclaimed.
    const supplierId = await createInWriteTenant(
      'companies',
      `INSERT INTO companies (id, name, shop_id) VALUES ('__ID__', '${LANE_MARKER} Search Fixture Supplier', '${WRITE_TENANT.id}')`,
    );
    const productId = await createInWriteTenant(
      'products',
      `INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
       VALUES ('__ID__', '${LANE_MARKER} Search Fixture', '${supplierId}', 'seed', 5, '${WRITE_TENANT.id}')`,
    );
    // The variant is not tracked separately: the registry removes it through the product's id
    // (`product_variants.product_id`), which is also why no hand-written order is needed here. Its own
    // id is left to the column default — a fixed id here was what made the product come back carrying an
    // id the registry did not know, and the delete that should have removed it then matched nothing.
    await execSql(`
      INSERT INTO product_variants (product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
      VALUES ('${productId}', '1kg', 500, 300, 1, 1, 5);
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

    // The two fixture rows are owned by id and removed through the registry — here, and again in
    // afterAll if this case fails first.
    await cleanupFixtures();
  });

  test('the same states in Urdu/RTL and in dark, with no empty-state clutter on Home', async ({ page }) => {
    // The catalogue is emptied for this case by the shared beforeEach; the browser's copy of it
    // is dropped here too, because a store paints cached rows for a moment before the network
    // answers and "not arrived yet" must not be read as "the Urdu copy is missing".
    await login(page);
    await clearRowCache(page);

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

    // Wait for the screen to settle on its own answer before reading its words: a revalidating
    // store shows the previous rows for a moment, and "the empty state has not arrived yet" must
    // not be read as "the Urdu copy is missing".
    await expect(
      page.getByText('ابھی کوئی سامان نہیں', { exact: false }),
      'the sale screen never showed its empty state after the catalogue was emptied',
    ).toBeVisible({ timeout: 15000 });

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

    // Home is allowed exactly one thing: the single first-run next step (its own row,
    // asserted in setupCompletion). What it must never grow is the in-flow empty-state
    // copy or a second prompt — those belong to the screen that met the dependency, and a
    // wall of them on the dashboard is the clutter this design exists to avoid.
    await page.goto(`${BASE_URL}/admin/dashboard`);
    await page.waitForTimeout(1800);
    // The first-run step list is allowed to use the dependency wording — that wording IS
    // the instruction it is giving. What must not happen is the same copy arriving from
    // somewhere else on Home, so the block's own text is subtracted before the scan
    // rather than the scan being weakened to accommodate it.
    const home = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="setup-next-step"]') as HTMLElement | null;
      return { all: document.body.innerText, fromBlock: block?.innerText ?? '' };
    });
    expect(
      await page.locator('[data-testid="setup-next-step"]').count(),
      'Home is carrying more than one dependency prompt',
    ).toBeLessThanOrEqual(1);
    const outsideTheBlock = home.fromBlock ? home.all.split(home.fromBlock).join(' ') : home.all;
    for (const leak of ['No products yet', 'No suppliers yet', 'ابھی کوئی سامان نہیں', 'ابھی کوئی سپلائر نہیں']) {
      expect(
        outsideTheBlock.includes(leak),
        `the empty-state copy leaked onto Home outside the first-run steps: "${leak}" appeared on the dashboard`,
      ).toBe(false);
    }
  });

  test('an employee cannot create stock, so they are told who can instead of given a dead link', async ({ page }) => {
    // A REAL employee session, not the owner walking into the employee shell.
    //
    // WHY THIS CHANGED. The case used to sign in as the OWNER and navigate to `/employee/sale/products`,
    // then accept either outcome: if the route guard bounced the owner out (it does), the assertion
    // degraded to "the URL still says /admin/" and the copy this test exists for — "Ask the owner to add
    // products." — was never read at all. The dedicated tenant's second identity exists for this case:
    // a real `employee` membership, in the same shop, scoped to its branch (0188/0190), which is what a
    // screen needs before it can render at all.
    //
    // "Ask the owner to add products" is the empty catalogue's sentence, so the catalogue stays empty
    // (the shared beforeEach) and the browser's cache of a fuller one is dropped first.
    await page.goto(`${BASE_URL}/login`);
    await page.evaluate(() => {
      localStorage.removeItem('agri_auth');
      for (const k of Object.keys(localStorage)) if (/^sb-/.test(k)) localStorage.removeItem(k);
    });
    // The employee door asks which shop invited the number: a phone on its own does not say, and the
    // fixture's shop id is what the field accepts.
    await loginViaUi(page, EMPLOYEE_PHONE, 'employee', WRITE_TENANT.id);
    await clearRowCache(page);

    await page.goto(`${BASE_URL}/employee/sale/products`);
    await page.waitForTimeout(1500);

    // The employee's own shell, reached by the employee: the guard must not have bounced them, or the
    // assertions below would be reading somebody else's screen.
    expect(page.url(), 'the employee session did not reach the employee shell').toContain('/employee/');
    await expect(
      page.getByRole('button', { name: 'Add product' }),
      'the employee sale step offered an action the employee shell cannot open',
    ).toHaveCount(0);
    await expect(
      page.getByText('Ask the owner to add products.', { exact: false }),
      'the employee is not told who can add stock',
    ).toBeVisible({ timeout: 15000 });
  });
});
