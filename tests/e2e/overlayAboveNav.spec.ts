/**
 * E2E: an overlay is never hidden behind the bottom tab bar.
 *
 * Reported directly: "bottom sheets are shown behind the bottom nav". Reproduced on
 * `/admin/sales` — a top-level screen, so the tab bar is visible — with the custom-date
 * sheet open. The sheet covered the whole viewport, yet the browser's own hit test at the
 * centre of the nav returned THE TAB BAR, not the sheet: the nav was painted on top.
 *
 * Cause: `.ds-anim-screen` used `animation: … both`, and a filling animation on `opacity`
 * stays "in effect" after it finishes, which makes the page wrapper a PERMANENT stacking
 * context at `z-index: auto`. The tab bar is a `fixed` later sibling with `z-index: auto`,
 * so both shared one painting layer and DOM order put the nav on top.
 *
 * The assertion is the browser's own hit test, not a z-index number: the point is what the
 * user can touch, and a hit test is the only thing that answers that.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { cleanupFixtures, loginViaUi, setupFixtures } from './helpers';

const OWNER_PHONE = '923001234567';

async function setLanguage(page: Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    const raw = localStorage.getItem('agrishop-theme') ?? localStorage.getItem('agri_theme');
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    parsed.state = { ...(parsed.state ?? {}), language: l };
    const v = JSON.stringify(parsed);
    localStorage.setItem('agrishop-theme', v);
    localStorage.setItem('agri_theme', v);
  }, lang);
  await page.reload();
  await page.waitForTimeout(1200);
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((th) => {
    const raw = localStorage.getItem('agrishop-theme') ?? localStorage.getItem('agri_theme');
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    parsed.state = { ...(parsed.state ?? {}), theme: th };
    const v = JSON.stringify(parsed);
    localStorage.setItem('agrishop-theme', v);
    localStorage.setItem('agri_theme', v);
  }, theme);
  await page.reload();
  await page.waitForTimeout(1000);
}

/**
 * Open the custom-date sheet on the sales list — a real overlay on a tab-bar screen.
 * The chip is addressed by its own translated label (`sales.customFilter`), so the Urdu run
 * clicks the real Urdu chip instead of failing to find an English word.
 */
async function openDateSheet(page: Page) {
  await page.goto('/admin/sales');
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: /^(Custom|حسب ضرورت)$/ }).first().click();
  await page.waitForTimeout(700);
}

test.describe('overlays paint above the bottom tab bar', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the sheet, not the nav, is on top where they overlap`, async ({ page }) => {
      await loginViaUi(page, OWNER_PHONE);
      await setTheme(page, theme);
      await openDateSheet(page);

      const measured = await page.evaluate(() => {
        const overlay = document.querySelector('.fixed.inset-0.z-50') as HTMLElement | null;
        const nav = document.querySelector('div.fixed.bottom-0') as HTMLElement | null;
        if (!overlay || !nav) return null;
        const r = nav.getBoundingClientRect();
        const at = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          return el ? { inOverlay: !!el.closest('.fixed.inset-0.z-50'), inNav: !!el.closest('div.fixed.bottom-0') } : null;
        };
        return {
          navZ: getComputedStyle(nav).zIndex,
          overlayZ: getComputedStyle(overlay).zIndex,
          navCentre: at(r.x + r.width / 2, r.y + r.height / 2),
          navTopEdge: at(r.x + r.width / 2, r.y + 4),
          wrapperFillMode: (() => {
            const w = document.querySelector('.ds-anim-screen');
            return w ? getComputedStyle(w).animationFillMode : '';
          })(),
        };
      });

      expect(measured, 'no overlay or tab bar on the sales list').not.toBeNull();
      console.log(`[overlayAboveNav ${theme}] ` + JSON.stringify(measured));

      // The nav must be in a layer below the overlay band...
      expect(measured!.navZ, 'the nav has no declared layer').toBe('30');
      expect(Number(measured!.overlayZ)).toBeGreaterThan(Number(measured!.navZ));
      // ...and the page wrapper must not be a permanent stacking context.
      expect(measured!.wrapperFillMode, 'the screen wrapper still fills, re-creating the trap').toBe('none');
      // ...and the browser must agree at the pixel level.
      expect(measured!.navCentre, 'the tab bar is painted over the sheet at the nav centre').toEqual({
        inOverlay: true,
        inNav: false,
      });
      expect(measured!.navTopEdge).toEqual({ inOverlay: true, inNav: false });
    });
  }

  test('Urdu / RTL: the same sheet still wins', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);
    await setLanguage(page, 'ur');
    await openDateSheet(page);

    const measured = await page.evaluate(() => {
      const overlay = document.querySelector('.fixed.inset-0.z-50') as HTMLElement | null;
      const nav = document.querySelector('div.fixed.bottom-0') as HTMLElement | null;
      if (!overlay || !nav) return null;
      const r = nav.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) as HTMLElement | null;
      return {
        dir: document.documentElement.dir,
        inOverlay: !!el?.closest('.fixed.inset-0.z-50'),
        inNav: !!el?.closest('div.fixed.bottom-0'),
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

    expect(measured).not.toBeNull();
    expect(measured!.dir).toBe('rtl');
    expect(measured!.inOverlay, 'in RTL the nav covers the sheet').toBe(true);
    expect(measured!.inNav).toBe(false);
    expect(measured!.overflow, 'RTL layout overflows horizontally').toBe(false);

    await page.evaluate(() => localStorage.removeItem('agrishop-theme'));
  });
});
