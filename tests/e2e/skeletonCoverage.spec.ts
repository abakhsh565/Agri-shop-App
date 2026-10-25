/**
 * E2E Test: no list jumps from nothing to content.
 *
 * The unit guard (`tests/unit/skeletonCoverageGuard.test.ts`) proves the gate and
 * the placeholder still exist in the source. This spec proves they are REACHED:
 * every read is held, each screen is opened, and the screen must be showing its
 * own grey shape — and must NOT be claiming there is no data — while the data is
 * genuinely in flight. Then the hold is released and the placeholder must settle
 * away, so a screen that is stuck in its loading state cannot pass either.
 *
 * Before this pass, several of these screens painted "No sales recorded",
 * "No products found" or a blank page during that window, which is a false
 * statement about data that had not arrived.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { loginViaUi, setupFixtures, cleanupFixtures, QA_IDS } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

const ADMIN_PHONE = '923001234567';
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';

/** route → the sentence that must NOT be shown while the data is still loading. */
const ROUTES: Array<{ path: string; mustNotSay?: string; label: string }> = [
  { path: '/admin/sales', mustNotSay: 'No sales recorded', label: 'admin sales list' },
  { path: '/admin/products', mustNotSay: 'No products found', label: 'products list' },
  { path: '/admin/companies', mustNotSay: 'No companies yet.', label: 'companies list' },
  { path: '/admin/payments', mustNotSay: 'No customer credit outstanding', label: 'payments list' },
  { path: '/admin/reports', mustNotSay: 'No sales in this period', label: 'reports' },
  { path: '/admin/alerts/inventory', label: 'inventory alerts' },
  { path: '/admin/inventory/reorder', label: 'reorder suggestions' },
  { path: '/admin/settings/roles', label: 'roles & access' },
  { path: `/admin/products/${QA_IDS.productA}`, label: 'product detail (store not loaded)' },
  { path: '/admin/activity', mustNotSay: 'Nothing has happened yet', label: 'activity log' },
  { path: '/admin/dashboard', label: 'admin dashboard' },
];

/**
 * Open a route the way a fresh install does: with no persisted store cache.
 *
 * Without this the stores rehydrate from localStorage and paint cached rows
 * instantly, so the loading state is never reached and the test would be
 * measuring the cache rather than the placeholder. Clearing everything except
 * the session, theme and Supabase keys reproduces the cold start.
 */
async function coldStart(page: Page, path: string) {
  await page.evaluate(() => {
    const keep = /^(agri_auth|agrishop-theme|sb-)/;
    for (const k of Object.keys(localStorage)) if (!keep.test(k)) localStorage.removeItem(k);
  }).catch(() => undefined);
  await page.goto(`${BASE_URL}${path}`).catch(() => undefined);
  await page.waitForTimeout(500);
}

test.describe('skeleton coverage: a waiting list shows its own shape', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('every fetching screen waits in shape and never claims to be empty', async ({ page }) => {
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // Pre-existing and NOT this pass's: index.html declares header-only security
      // directives (X-Frame-Options, X-Content-Type-Options) as <meta>, which the
      // browser ignores and warns about on every load. Named here rather than
      // silently swallowed — it is tracked separately from the skeleton work.
      if (m.text().includes('X-Frame-Options may only be set via an HTTP header')) return;
      // The dev server serves no /favicon.ico, so the browser's implicit request
      // for one 404s on every route. Also pre-existing and not a screen defect.
      if (m.location()?.url?.endsWith('/favicon.ico')) return;
      consoleErrors.push(`${m.text()} @ ${m.location()?.url ?? 'unknown'}`);
    });

    await loginViaUi(page, ADMIN_PHONE);

    // Hold every read so the loading state is observable rather than a race.
    await page.route('**/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1800));
      // A navigation can end the request while it is being held; that is not a
      // failure of the screen under test, so it must not throw here.
      await route.continue().catch(() => undefined);
    });

    const failures: string[] = [];
    let shapesMeasured = 0;

    for (const { path, mustNotSay, label } of ROUTES) {
      await coldStart(page, path);

      const found = await page.evaluate(() => {
        const shapes = document.querySelectorAll('.ds-skeleton');
        const first = shapes[0] as HTMLElement | undefined;
        const row = first?.closest('.ds-row') as HTMLElement | null;
        return {
          count: shapes.length,
          inCard: !!first?.closest('.ds-listcard'),
          rowHeight: row ? Math.round(row.getBoundingClientRect().height) : 0,
          bodyText: document.body.innerText,
        };
      });

      if (found.count === 0) failures.push(`${label} (${path}): nothing shaped while loading`);
      else shapesMeasured++;
      if (mustNotSay && found.bodyText.includes(mustNotSay)) {
        failures.push(`${label} (${path}): claims "${mustNotSay}" while the data is in flight`);
      }
    }

    // The placeholder has to be the shape of the list it becomes, not any grey box.
    await coldStart(page, '/admin/sales');
    const shape = await page.evaluate(() => {
      const el = document.querySelector('.ds-listcard .ds-skeleton') as HTMLElement | null;
      const row = el?.closest('.ds-row') as HTMLElement | null;
      return {
        inCard: !!el,
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : 0,
        animated: el ? getComputedStyle(el).animationName : '',
      };
    });
    if (!shape.inCard) failures.push('sales skeleton is not inside the grouped card it becomes');
    if (shape.rowHeight < 46 || shape.rowHeight > 64) {
      failures.push(`sales skeleton row is ${shape.rowHeight}px, outside the 46–64pt row band`);
    }
    if (shape.animated !== 'shimmer') failures.push('sales skeleton does not shimmer');

    // Release the hold: the placeholders must settle away rather than stay stuck, and
    // real rows must take their place. Products is the dataset that does not depend on
    // today's date, so an empty list here would mean the read itself failed.
    await page.unroute('**/rest/v1/**');
    await page.evaluate(() => {
      const keep = /^(agri_auth|agrishop-theme|sb-)/;
      for (const k of Object.keys(localStorage)) if (!keep.test(k)) localStorage.removeItem(k);
    });
    await page.goto(`${BASE_URL}/admin/products`);
    await page.waitForTimeout(2500);
    const settled = await page.locator('.ds-skeleton').count();
    const rowsAfter = await page.locator('.ds-listcard .ds-row').count();
    if (settled !== 0) failures.push(`products kept ${settled} placeholders after the data arrived`);
    if (rowsAfter === 0) failures.push('no real rows rendered after loading — the read failed, not the placeholder');

    expect(badResponses, 'a request behind the loading state failed').toEqual([]);
    expect(consoleErrors, 'the console must stay clean').toEqual([]);
    expect(
      failures,
      `${shapesMeasured}/${ROUTES.length} screens waited in shape`,
    ).toEqual([]);
  });

  test('the customer picker inside the group-reminder sheet waits too', async ({ page }) => {
    await loginViaUi(page, ADMIN_PHONE);

    await page.route('**/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1800));
      await route.continue().catch(() => undefined);
    });
    await coldStart(page, '/admin/alerts/reminders');

    // Groups tab → the create sheet, whose customer list is the thing under test.
    await page.getByText('Group Reminder', { exact: true }).click();
    await page.getByRole('button', { name: /Create (New Group|Group Reminder)/ }).first().click();
    await page.waitForTimeout(400);

    const seen = await page.evaluate(() => ({
      shapes: document.querySelectorAll('.ds-skeleton').length,
      text: document.body.innerText,
    }));
    expect(seen.text, 'the picker claims there are no customers while they load').not.toContain(
      'No customers found',
    );
    expect(seen.shapes, 'the picker showed nothing shaped while loading').toBeGreaterThan(0);

    await page.unroute('**/rest/v1/**');
  });
});
