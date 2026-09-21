/**
 * E2E: the admin side reads naturally in BOTH languages.
 *
 * The users are Pakistani shop owners who are not technical. Every message they read
 * on the admin side must be plain, and must actually appear in the language they are
 * reading — not fall back to English because it was hardcoded in a component.
 *
 * Source scans cannot prove that: `t("...")` can point at a missing key, a screen can
 * render a raw backend failure, and Urdu text can overflow a layout that English fits.
 * So this drives the real app in real Chrome, in both languages, and asserts what is
 * ON SCREEN.
 *
 * Admin scope only (sign-in → onboarding → admin screens); the employee side is a
 * separate batch, deliberately not touched here.
 */
import { test, expect } from '@playwright/test';
import { QA_IDS, execSql, setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';

/** Language switch, the same way the RTL/LTR suite does it. */
async function setLanguage(page: import('@playwright/test').Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    // Create the persisted entry when it does not exist yet. Guarding the write on
    // an existing key (as the first version did) silently did NOTHING on a fresh
    // browser context, so the app stayed English and the test asserted English
    // against itself.
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.language = l;
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
    document.documentElement.dir = l === 'ur' ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
  }, lang);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/** Words that must never reach a shop owner's screen, in either language. */
const FORBIDDEN_ON_SCREEN = [
  'Postgres', 'postgres', 'SQL', 'RPC', 'JWT', 'foreign key', 'constraint',
  'permission denied', 'PGRST', 'null value', 'schema', 'stack trace', 'undefined',
];

test.describe('Admin microcopy — English and Urdu', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`DELETE FROM companies WHERE name LIKE 'QA Microcopy%'`).catch(() => {});
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM companies WHERE name LIKE 'QA Microcopy%'`).catch(() => {});
    await cleanupFixtures();
  });

  test('validation and success messages are plain, translated, and fit the screen', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // ── English / LTR ───────────────────────────────────────────────────────
    await setLanguage(page, 'en');
    await page.goto(`${BASE_URL}/admin/companies/new`);
    await page.waitForLoadState('networkidle');

    // Submitting an empty form must explain what is missing, in plain words.
    // Exact label: a loose /add/i also matches the "Add logo" button, which submits
    // nothing (the first version of this test clicked that and proved nothing).
    const saveButton = page.getByRole('button', { name: 'Add Company', exact: true }).last();
    await saveButton.click();
    await expect(page.getByText('Write the supplier name.').first()).toBeVisible({ timeout: 10000 });

    // ── Urdu / RTL: the same screen, the same moment ────────────────────────
    await setLanguage(page, 'ur');
    await page.goto(`${BASE_URL}/admin/companies/new`);
    await page.waitForLoadState('networkidle');

    // In Urdu the button label is Urdu too, so it is addressed by that label — an
    // English-name lookup matches nothing and the "missing validation" would look
    // like a translation bug instead of a test mistake.
    await page.locator('button', { hasText: /کمپنی شامل کریں/ }).last().click();

    const urduValidation = page.getByText('کمپنی کا نام لکھیں۔').first();
    await expect(urduValidation).toBeVisible({ timeout: 10000 });

    // No English leakage for a message the app itself produces.
    await expect(page.getByText('Write the supplier name.').first()).toHaveCount(0);

    // Urdu must fit: the page must not scroll sideways, and nothing may be clipped.
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, rtl: de.dir };
    });
    expect(overflow.rtl).toBe('rtl');
    expect(overflow.scrollW, 'Urdu text overflows the viewport horizontally').toBeLessThanOrEqual(overflow.clientW + 1);

    // ── A real save, in Urdu: the success message must be Urdu too ──────────
    const name = `QA Microcopy Supplier ${Date.now().toString(36)}`;
    await page.getByRole('textbox').first().fill(name);
    await page.locator('button', { hasText: /کمپنی شامل کریں/ }).last().click();
    await expect(page.getByText(new RegExp(name)).first()).toBeVisible({ timeout: 15000 });

    const toastText = await page.evaluate(() => document.body.innerText);
    for (const banned of FORBIDDEN_ON_SCREEN) {
      expect(toastText, `technical wording "${banned}" reached the screen`).not.toContain(banned);
    }
  });

  test('the first screens a shop owner sees — phone, then code — read in both languages', async ({ page }) => {
    // ── English ────────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await setLanguage(page, 'en');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Welcome back').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Enter your phone number to sign in').first()).toBeVisible();

    // ── Urdu: the same screen, and the code screen an owner reaches from it ─
    await setLanguage(page, 'ur');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('خوش آمدید').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('سائن ان کرنے کے لیے اپنا فون نمبر درج کریں').first()).toBeVisible();
    await expect(page.getByText('Welcome back').first()).toHaveCount(0);

    const loginScreen = await page.evaluate(() => ({
      text: document.body.innerText,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      rtl: document.documentElement.dir,
    }));
    expect(loginScreen.rtl).toBe('rtl');
    expect(loginScreen.scrollW, 'the Urdu sign-in screen overflows horizontally').toBeLessThanOrEqual(loginScreen.clientW + 1);
    for (const banned of FORBIDDEN_ON_SCREEN) {
      expect(loginScreen.text, `technical wording "${banned}" is on the sign-in screen`).not.toContain(banned);
    }

    await page.getByRole('textbox').first().fill('03009999999');
    await page.locator('button', { hasText: /کوڈ بھیجیں|بھیجیں/ }).first().click();
    await page.waitForURL(/\/login\/otp|pin-set|dashboard/, { timeout: 20000 });

    if (page.url().includes('/login/otp')) {
      await expect(page.getByText('اپنے 6 نمبر لکھیں').first()).toBeVisible({ timeout: 10000 });
    }
  });

  /**
   * The exact English wording this pass replaced with keys. Each is asserted absent on
   * the screens that used to print it, in Urdu. It is a direct regression test for the
   * change rather than a general "looks translated" check.
   */
  const REPLACED_ENGLISH = [
    'Loading…', 'Threshold:', 'Order from', 'units — threshold', 'total due',
    'units in stock', 'Price/unit:', 'previously returned', 'Qty to return:', 'PAID',
  ];

  test('the screens whose wording was replaced now read Urdu only', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    const routes = [
      '/admin/purchases',
      '/admin/payments',
      '/admin/products',
      '/admin/inventory/movements',
      '/admin/inventory/reorder',
      '/admin/reports',
      '/admin/sales',
      '/admin/settings',
      '/admin/companies',
      '/admin/employees',
    ];

    for (const path of routes) {
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');
      await setLanguage(page, 'ur');
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');

      const screen = await page.evaluate(() => ({
        text: document.body.innerText,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));

      expect(/[\u0600-\u06FF]/.test(screen.text), `${path}: no Urdu text rendered`).toBe(true);
      for (const english of REPLACED_ENGLISH) {
        expect(
          screen.text,
          `${path}: "${english}" is still English in Urdu mode — it should have become a t() key`,
        ).not.toContain(english);
      }
      expect(screen.scrollW, `${path}: Urdu overflows horizontally`).toBeLessThanOrEqual(screen.clientW + 1);
    }
  });

  test('the admin dashboard and settings show no raw or technical wording in Urdu', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    for (const path of ['/admin/dashboard', '/admin/settings', '/admin/companies', '/admin/products', '/admin/employees']) {
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');
      await setLanguage(page, 'ur');
      await page.goto(`${BASE_URL}${path}`);
      await page.waitForLoadState('networkidle');

      const screen = await page.evaluate(() => ({
        text: document.body.innerText,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));

      // Proof the switch actually happened: Urdu script is on screen. Without this,
      // "no English leakage" would pass on an English page.
      expect(/[\u0600-\u06FF]/.test(screen.text), `${path}: no Urdu text is rendered at all`).toBe(true);

      for (const banned of FORBIDDEN_ON_SCREEN) {
        expect(screen.text, `${path}: technical wording "${banned}" is on screen`).not.toContain(banned);
      }
      expect(screen.scrollW, `${path}: horizontal overflow in Urdu`).toBeLessThanOrEqual(screen.clientW + 1);
    }
  });
});
