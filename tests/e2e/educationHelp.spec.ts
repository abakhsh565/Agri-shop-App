import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { cleanupFixtures, ensureAuthSession, loginViaUi, setupFixtures, QA_IDS } from './helpers';

/**
 * The education surfaces that sit *inside* the app: help on the screen you are on, the
 * workflow videos, the questions, and the way out when none of it answered.
 *
 * This lane exists because none of those can be proven by reading the source: a video is
 * "shipped" only when a browser decodes it, contextual help is "in place" only when it
 * appears on the screen it describes, and "closing writes nothing" is only true if the
 * database is counted afterwards. So every assertion here comes from the running app.
 */
const OWNER_PHONE = '03009999999';
const SHOTS = '.freebuff/interaction-shots';

async function setPrefs(page: Page, lang: 'en' | 'ur', theme: 'light' | 'dark') {
  await page.evaluate(({ l, t }) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state ?? {}), language: l, theme: t };
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, { l: lang, t: theme });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/** Nothing in this pass may push the page sideways — the app is used at phone width. */
async function assertNoOverflow(page: Page, where: string) {
  const over = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(over.scroll, `${where}: page is wider than the phone`).toBeLessThanOrEqual(over.client + 1);
}

test.describe('education — help, tutorials, questions', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await ensureAuthSession(OWNER_PHONE);
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  for (const [lang, theme] of [['en', 'light'], ['ur', 'dark']] as const) {
    test(`contextual help, video, FAQ and questions — ${lang}/${theme}`, async ({ page }) => {
      // Console cleanliness is asserted, but not against noise this app already ships:
      // `index.html` carries an X-Frame-Options meta tag the browser rejects on every load
      // (pre-existing, outside this workstream) and `/favicon.ico` is served as a 404 in
      // dev. Both are named here so a *new* error cannot hide behind them.
      const KNOWN_NOISE = [/X-Frame-Options may only be set via an HTTP header/, /favicon/i, /apple-touch-icon\.png/i];
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        // A console error carries no URL on its face, so it is checked against both the
        // message and the resource it came from — a 404 for the app icon is not a defect,
        // a 404 for our own video would be.
        const url = m.location()?.url ?? '';
        if (KNOWN_NOISE.some((re) => re.test(text) || re.test(url))) return;
        errors.push(`${text} @ ${url}`);
      });
      page.on('response', (r) => {
        if (r.status() < 400) return;
        if (KNOWN_NOISE.some((re) => re.test(r.url()))) return;
        errors.push(`HTTP ${r.status()} ${r.url()}`);
      });

      await loginViaUi(page, OWNER_PHONE);
      await setPrefs(page, lang, theme);

      // ── help on the screen you are on ─────────────────────────────────────────────────
      await page.goto('/admin/dashboard');
      await page.waitForLoadState('networkidle');
      const help = page.getByTestId('context-help');
      await expect(help).toBeVisible();
      await help.click();
      await expect(page.getByTestId('context-help-sheet')).toBeVisible();
      // It describes *this* screen, in this language — not a generic page of filler.
      const what = await page.getByTestId('context-help-what').innerText();
      expect(what.trim().length).toBeGreaterThan(20);
      await assertNoOverflow(page, `${lang} help sheet`);
      await page.screenshot({ path: `${SHOTS}/edu-help-${lang}-${theme}.png` });

      // ── the walkthrough that belongs to a screen that has one ─────────────────────────
      await page.keyboard.press('Escape');
      await page.goto('/admin/reports');
      await page.waitForLoadState('networkidle');
      await page.getByTestId('context-help').click();
      await page.getByTestId('context-help-watch').click();

      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      const src = await video.getAttribute('src');
      expect(src, 'the reports tutorial is wired up').toContain('/tutorials/reports.webm');

      // A player that never receives a frame is a black rectangle, not a tutorial: wait for
      // the browser to actually decode the file that shipped.
      await video.evaluate((v) => (v as HTMLVideoElement).play().catch(() => {}));
      await expect.poll(async () => video.evaluate((v) => (v as HTMLVideoElement).readyState), {
        timeout: 20000,
        message: 'the shipped .webm never decoded in a real browser',
      }).toBeGreaterThanOrEqual(3);
      const seconds = await video.evaluate((v) => (v as HTMLVideoElement).duration);
      expect(seconds, 'the tutorial has real duration').toBeGreaterThan(5);
      await assertNoOverflow(page, `${lang} tutorial sheet`);
      await page.screenshot({ path: `${SHOTS}/edu-video-${lang}-${theme}.png` });

      // ── closing it leaves nothing behind ──────────────────────────────────────────────
      await page.keyboard.press('Escape');
      await expect(page.locator('video')).toHaveCount(0);
      await expect(page.locator('[data-tut-caption]')).toHaveCount(0);
      await expect(page.getByTestId('context-help')).toBeVisible();

      // ── the guide: FAQ answered, and somewhere to ask ─────────────────────────────────
      await page.goto('/admin/guide');
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('guide-faq-sale')).toBeVisible();
      await expect(page.getByTestId('guide-watch-sale')).toBeVisible();
      await assertNoOverflow(page, `${lang} guide`);
      await page.screenshot({ path: `${SHOTS}/edu-guide-${lang}-${theme}.png` });

      await page.getByTestId('guide-ask').click();
      await expect(page.getByTestId('ask-sheet')).toBeVisible();
      await page.getByTestId('ask-input').fill(lang === 'ur' ? 'ادھار کہاں سے دیکھیں؟' : 'Where do I see udhaar?');
      await page.getByTestId('ask-save').click();
      await expect(page.getByTestId('ask-saved')).toBeVisible();
      await assertNoOverflow(page, `${lang} ask sheet`);
      await page.screenshot({ path: `${SHOTS}/edu-ask-${lang}-${theme}.png` });

      expect(errors, `console errors in ${lang}/${theme}: ${errors.join(' | ')}`).toEqual([]);
    });
  }

  test('the pre-login introduction shows real screens of this app', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('agrishop-intro-seen'));
    await page.goto('/welcome');
    await page.waitForLoadState('networkidle');

    // A file path in the model proves nothing: the picture is real only when the browser has
    // decoded it. `naturalWidth` is that proof, and it catches the failure that matters most
    // here — an asset that was never copied into the build.
    const first = page.getByTestId('intro-visual');
    await expect(first).toBeVisible();
    expect(await first.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);

    await page.getByTestId('intro-next').click();
    await page.waitForTimeout(600);
    expect(await first.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
    await page.screenshot({ path: `${SHOTS}/edu-intro-slide.png` });

    // Nothing here may depend on being signed in — this is before login by definition.
    await expect(page.getByTestId('intro-title')).toBeVisible();
  });

  test('a customer account offers the collection walkthrough that belongs to it', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'en', 'light');

    await page.goto(`/admin/customers/${QA_IDS.customerA}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('context-help').click();
    await expect(page.getByTestId('context-help-sheet')).toBeVisible();
    await page.getByTestId('context-help-watch').click();
    const video = page.locator('video').first();
    await expect(video).toHaveAttribute('src', /collect-payment\.webm/);
    await page.screenshot({ path: `${SHOTS}/edu-video-customer-detail.png` });
  });

  test('education writes nothing to the business database', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'en', 'light');

    // Every education interaction, in one pass, then the database is counted by the gate's
    // own independent checker — a promise that closing writes nothing is only worth what
    // that count says.
    for (const route of ['/admin/dashboard', '/admin/reports', '/admin/products', '/admin/purchases']) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const help = page.getByTestId('context-help');
      if (await help.count()) {
        await help.click();
        await expect(page.getByTestId('context-help-sheet')).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
    await page.goto('/admin/guide');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('guide-ask').click();
    await page.getByTestId('ask-input').fill('How do I check stock?');
    await page.getByTestId('ask-save').click();
    await page.keyboard.press('Escape');

    // The question is on the device, as the sheet says — not in a table.
    const stored = await page.evaluate(() => localStorage.getItem('agrishop-edu-questions'));
    expect(stored, 'the question is kept locally').toContain('How do I check stock?');
    await expect(page.locator('[data-tut-caption]')).toHaveCount(0);
  });
});
