/**
 * E2E: the components that appear ON TOP of the app behave correctly in both
 * directions — the confirmation dialog, and the bottom sheet.
 *
 * WHY THIS FILE EXISTS. `rtlLtr.spec.ts` has a case named "ConfirmDialog: centered in
 * both LTR and RTL" that only asserted `document.documentElement.dir`. It never opened
 * a dialog, so it proved nothing about a dialog. Nothing in the suite opened a sheet,
 * a menu or an anchored overlay either, which is exactly where RTL breaks: button
 * order, close-button placement, text alignment and edge anchoring.
 *
 * So this drives the real overlays and measures them. It also covers the two
 * confirmations that were moved off the browser's native `confirm()` into the app's
 * own dialog, because a native popup cannot mirror its buttons for Urdu.
 */
import { test, expect } from '@playwright/test';
import { QA_IDS, setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';

/** The supplier selector's button label, from t("supplier.selectSupplier"). */
const SUPPLIER_TRIGGER_EN = 'Select supplier';
const SUPPLIER_TRIGGER_UR = 'سپلائر منتخب کریں';

async function setLanguage(page: import('@playwright/test').Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
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

/**
 * The visible overlay PANEL.
 *
 * Both ConfirmDialog and SelectSheet are a full-screen `fixed` backdrop with exactly
 * one panel inside it. The panel itself is statically positioned, so filtering on
 * `position: fixed` finds only the backdrop and misses the panel entirely — which is
 * how the first version of this helper reported "the dialog did not open" while a
 * dialog was plainly on screen.
 */
/**
 * Measure the overlay PANEL that holds a known element.
 *
 * Both ConfirmDialog and SelectSheet are a fixed full-screen backdrop with one panel
 * inside it. Walking up from an element the test can already find by role/label gives
 * the panel exactly, instead of guessing from position or DOM order — two guesses that
 * each measured the wrong element and made a visible dialog look like an empty box.
 */
async function panelOf(handle: import('@playwright/test').ElementHandle<Element>) {
  return handle.evaluate((el) => {
    let backdrop: Element | null = el;
    while (backdrop && getComputedStyle(backdrop).position !== 'fixed') backdrop = backdrop.parentElement;
    if (!backdrop) return { found: false, reason: 'no fixed backdrop above this element' };
    const panel = [...backdrop.children].find((c) => c.contains(el)) ?? backdrop;
    const r = panel.getBoundingClientRect();
    // The app renders in a phone frame (`.app-frame`), so "the bottom of the screen"
    // is the bottom of that frame, not the bottom of the browser window.
    const b = (document.querySelector('.app-frame') ?? backdrop).getBoundingClientRect();
    return {
      found: true,
      reason: '',
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      frameTop: b.top,
      frameBottom: b.bottom,
      frameWidth: b.width,
      text: (panel as HTMLElement).innerText ?? '',
    };
  });
}

/**
 * The bottom sheet's own panel.
 *
 * SelectSheet is a `fixed inset-0 flex-col justify-end` backdrop with the panel as its
 * direct child. Looking it up by that contract is exact; measuring "the nearest fixed
 * ancestor of the search box" pointed at the app frame instead and reported the panel
 * as 171px short of the bottom.
 */
async function sheetPanel(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const backdrop = [...document.querySelectorAll<HTMLElement>('div')].find((el) => {
      if (getComputedStyle(el).position !== 'fixed') return false;
      if (!el.className.includes('justify-end')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 200 && r.height > 200;
    });
    if (!backdrop) return { found: false, reason: 'no fixed bottom-anchored backdrop' } as any;
    const panel = backdrop.firstElementChild as HTMLElement | null;
    if (!panel) return { found: false, reason: 'the sheet backdrop has no panel' } as any;
    const r = panel.getBoundingClientRect();
    const b = backdrop.getBoundingClientRect();
    return {
      found: true,
      reason: '',
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      bottom: r.bottom,
      backdropBottom: b.bottom,
      backdropWidth: b.width,
      viewportW: window.innerWidth,
      text: panel.innerText ?? '',
    };
  });
}

/** Centre of a button, for comparing the order of the dialog's action row. */
async function buttonCentre(handle: import('@playwright/test').ElementHandle<Element>) {
  return handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.x + r.width / 2;
  });
}

test.describe('Overlays — dialogs and sheets in EN/LTR and UR/RTL', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('the deactivate confirmation is centred, translated, and mirrors its buttons', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    const COPY = {
      en: {
        trigger: /Deactivate employee|Cancel invitation|Reactivate employee/,
        action: /^(Deactivate employee|Cancel invitation|Reactivate employee)$/,
        cancel: 'Cancel',
        body: /sign in|access/i,
      },
      ur: {
        trigger: /غیر فعال کریں|منسوخ کریں|دوبارہ فعال کریں/,
        action: /^(ملازم غیر فعال کریں|دعوت منسوخ کریں|ملازم دوبارہ فعال کریں)$/,
        cancel: 'منسوخ',
        body: /[\u0600-\u06FF]/,
      },
    } as const;

    /** Opens the access dialog on the fixture employee and measures it. */
    async function openAndMeasure(lang: 'en' | 'ur') {
      const copy = COPY[lang];
      await setLanguage(page, lang);
      await page.goto(`${BASE_URL}/admin/employees/${QA_IDS.employee}`);
      await page.waitForLoadState('networkidle');

      // Either arm is consequential now: deactivate, cancel invitation, or reactivate.
      const trigger = page.getByRole('button', { name: copy.trigger }).last();
      await expect(
        trigger,
        `${lang}: the access button is not on the employee page — did the page load?`,
      ).toBeVisible({ timeout: 15000 });
      await trigger.click();

      const actionBtn = page.getByRole('button', { name: copy.action }).last();
      const cancelBtn = page.getByRole('button', { name: copy.cancel, exact: true }).last();
      await expect(actionBtn, `${lang}: the confirmation did not open`).toBeVisible({ timeout: 10000 });
      await expect(cancelBtn, `${lang}: the confirmation has no cancel button`).toBeVisible();

      const box = await panelOf(await actionBtn.elementHandle());
      expect(box.found, `${lang}: ${box.reason}`).toBe(true);
      return {
        box,
        actionCentre: await buttonCentre(await actionBtn.elementHandle()),
        cancelCentre: await buttonCentre(await cancelBtn.elementHandle()),
      };
    }

    // ── English / LTR ──────────────────────────────────────────────────────
    const en = await openAndMeasure('en');
    expect(en.box.text).toMatch(COPY.en.body);
    expect(
      Math.abs(en.box.x + en.box.width / 2 - en.box.viewportW / 2),
      'the dialog is not horizontally centred in LTR',
    ).toBeLessThan(3);
    expect(en.cancelCentre, 'in LTR the cancel button must sit before the action button').toBeLessThan(
      en.actionCentre,
    );

    // Escape must dismiss it, the same way the backdrop does.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: COPY.en.cancel, exact: true })).toHaveCount(0, {
      timeout: 5000,
    });

    // ── Urdu / RTL ─────────────────────────────────────────────────────────
    const ur = await openAndMeasure('ur');
    expect(ur.box.text).toMatch(COPY.ur.body);
    expect(
      Math.abs(ur.box.x + ur.box.width / 2 - ur.box.viewportW / 2),
      'the dialog is not horizontally centred in RTL',
    ).toBeLessThan(3);
    // The SAME two buttons, mirrored: in RTL the cancel button is on the right.
    expect(ur.cancelCentre, 'in RTL the button row must be mirrored').toBeGreaterThan(ur.actionCentre);
    // The cancel action is a translated word, not the browser's own "Cancel".
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: COPY.ur.cancel, exact: true })).toHaveCount(0, {
      timeout: 5000,
    });
  });

  test('the supplier sheet anchors to the bottom and reads correctly in both directions', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    const SHEET = {
      en: { trigger: SUPPLIER_TRIGGER_EN, search: 'Search…' },
      ur: { trigger: SUPPLIER_TRIGGER_UR, search: 'تلاش کریں…' },
    } as const;

    /** Opens the supplier sheet and measures its panel through a marker inside it. */
    async function openSheet(lang: 'en' | 'ur') {
      await setLanguage(page, lang);
      await page.goto(`${BASE_URL}/admin/purchases/new`);
      await page.waitForLoadState('networkidle');

      const trigger = page.getByRole('button', { name: SHEET[lang].trigger }).first();
      await expect(trigger, `${lang}: the supplier selector is not on the page`).toBeVisible({
        timeout: 15000,
      });
      await trigger.click();

      // The search box exists only inside the sheet, so it is a reliable marker.
      const marker = page.getByPlaceholder(SHEET[lang].search).first();
      await expect(marker, `${lang}: the supplier sheet did not open`).toBeVisible({ timeout: 10000 });
      // The marker proves the sheet is open; the panel is measured by its own contract.
      const box = await sheetPanel(page);
      expect(box.found, `${lang}: ${box.reason}`).toBe(true);
      return box;
    }

    // The sheet slides up into place, so the anchor is polled rather than sampled
    // mid-animation (a single sample read 171px short while it was still moving).
    const anchored = async () => {
      const b = await sheetPanel(page);
      return Math.abs(b.bottom - b.backdropBottom);
    };

    const en = await openSheet('en');
    expect(en.width, 'the sheet is too narrow to be usable').toBeGreaterThan(300);
    await expect
      .poll(anchored, { message: 'the sheet is not anchored to the bottom', timeout: 5000 })
      .toBeLessThan(4);
    expect(
      Math.abs(en.x + en.width / 2 - en.viewportW / 2),
      'the sheet is not horizontally centred in LTR',
    ).toBeLessThan(3);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    const ur = await openSheet('ur');
    expect(ur.text, 'the sheet is not Urdu in Urdu mode').toMatch(/[\u0600-\u06FF]/);
    await expect
      .poll(anchored, { message: 'the RTL sheet is not anchored to the bottom', timeout: 5000 })
      .toBeLessThan(4);
    expect(
      Math.abs(ur.x + ur.width / 2 - ur.viewportW / 2),
      'the sheet is not horizontally centred in RTL',
    ).toBeLessThan(3);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    // No sideways scroll while an overlay is open.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollW, 'the Urdu sheet forced a horizontal scrollbar').toBeLessThanOrEqual(
      overflow.clientW + 1,
    );
  });
});
