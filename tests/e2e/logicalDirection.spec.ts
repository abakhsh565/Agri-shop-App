/**
 * E2E: direction is decided in ONE place — the screen — and the theme layer is gone.
 *
 * WHY THIS FILE EXISTS. `src/index.css` used to carry a block of `!important` shims that
 * flipped physical utilities for RTL (`[dir="rtl"] .absolute.left-4`) and remapped legacy
 * literal colours (`.dark .bg-white`, `.text-black`) onto tokens. Both were deleted, and
 * every positional utility in the app was migrated to logical properties (`start/end`,
 * `ps/pe`). `importantShimGuard` proves statically that no physical utility and no shim
 * came back; it cannot prove the migrated classes actually resolve, because a class that
 * Tailwind never generated is invisible to a source scan.
 *
 * So this measures the live DOM:
 *   • an `end-1` badge must hug the inline END — physically right in English, physically
 *     left in Urdu. A shim would have done that with a stylesheet rule; a logical property
 *     does it because the box's own inline axis flipped.
 *   • the theme switch knob travels along the inline axis, so "off" is the start side in
 *     both languages.
 *   • the token values the removed shims used to compute to are still what renders — the
 *     migration was meant to be byte-identical, so light AND dark are asserted against the
 *     exact colours the shim produced.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await setupFixtures();
});

test.afterAll(async () => {
  await cleanupFixtures();
});

/** Language + theme, written the way the app persists them, then a reload to apply. */
async function setPrefs(page: Page, lang: 'en' | 'ur', theme: 'light' | 'dark') {
  await page.evaluate(
    ({ l, t }) => {
      const raw = localStorage.getItem('agrishop-theme');
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = { ...(parsed.state ?? {}), language: l, theme: t };
      localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
    },
    { l: lang, t: theme },
  );
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function signIn(page: Page) {
  await page.goto(BASE_URL);
  await injectAdminAuth(page);
}

/**
 * Where an element actually sits, in pixels, measured from the app frame's two edges.
 *
 * Geometry rather than declared style, on purpose: a computed `left`/`right` read can be
 * argued with (the browser resolves insets differently per element type), while "16px from
 * the frame's left edge in English, 16px from its right edge in Urdu" is the behaviour a
 * shop owner sees. The frame matters because the app renders inside a centred phone shell,
 * so a viewport-relative gap would include the letterboxing on desktop.
 */
async function edgeGaps(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const frame = document.querySelector('.app-frame') ?? document.body;
    const r = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      leftGap: Math.round(r.left - f.left),
      rightGap: Math.round(f.right - r.right),
      role: el.getAttribute('data-testid'),
      dir: document.documentElement.dir,
      position: s.position,
    };
  }, selector);
}

test('a leading control sits on the inline start in both directions', async ({ page }) => {
  await signIn(page);

  // Two shapes of the same intent: NavHeader's back control (an inline style, migrated from
  // a JS `isRtl ? right : left` ternary) and the shared Sheet's close control (a `start-4`
  // class, migrated from the deleted `[dir="rtl"] .absolute.left-4` rule).
  await setPrefs(page, 'en', 'light');
  // A screen whose header keeps the leading control. Settings is deliberately not used any
  // more: its exit is now the close control on the trailing edge (an approved change), so
  // there is no leading control left there to measure.
  await page.goto(`${BASE_URL}/admin/inventory/new`);
  await page.waitForLoadState('networkidle');

  const ltrBack = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(ltrBack, 'the header back control is not on the page').not.toBeNull();
  expect(ltrBack!.dir).toBe('ltr');
  expect(ltrBack!.leftGap, 'EN: the leading control sits 16px from the left edge').toBe(16);
  expect(ltrBack!.rightGap, 'EN: it is nowhere near the right edge').toBeGreaterThan(100);

  // The trigger label is the dictionary's, in either language, so the locator accepts both
  // and never depends on which language the previous spec left behind.
  await page.getByRole('button', { name: /choose supplier|سپلائر چنیں/i }).first().click();
  // Wait for the sheet to be ON SCREEN before measuring it: reading geometry straight after
  // the click passed on its own and flaked inside the full suite, where the main thread is
  // busier — a measurement taken before the branch is painted reports `null` and reads as
  // "the sheet never opened".
  await expect(page.locator('[data-testid="sheet-close"]')).toBeVisible({ timeout: 10000 });
  const ltrSheet = await edgeGaps(page, '[data-testid="sheet-close"]');
  expect(ltrSheet, 'the sheet did not open, so its close button cannot be measured').not.toBeNull();
  expect(ltrSheet!.leftGap, 'EN: the sheet close control is 16px from the left edge').toBe(16);
  await page.keyboard.press('Escape');

  await setPrefs(page, 'ur', 'light');
  await page.goto(`${BASE_URL}/admin/inventory/new`);
  await page.waitForLoadState('networkidle');

  const rtlBack = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(rtlBack!.dir, 'the Urdu direction did not apply, so nothing below would mean anything').toBe('rtl');
  expect(rtlBack!.rightGap, 'UR: the leading control mirrors to 16px from the right edge').toBe(16);
  expect(rtlBack!.leftGap, 'UR: it is nowhere near the left edge').toBeGreaterThan(100);

  await page.getByRole('button', { name: /choose supplier|سپلائر چنیں/i }).first().click();
  await expect(page.locator('[data-testid="sheet-close"]')).toBeVisible({ timeout: 10000 });
  const rtlSheet = await edgeGaps(page, '[data-testid="sheet-close"]');
  expect(rtlSheet, 'the sheet did not open in Urdu').not.toBeNull();
  expect(rtlSheet!.rightGap, 'UR: the sheet close control is 16px from the right edge').toBe(16);
  expect(rtlSheet!.leftGap, 'UR: it is nowhere near the left edge').toBeGreaterThan(100);
});

test('the theme switch knob travels along the inline axis, in both languages', async ({ page }) => {
  await signIn(page);

  /**
   * The knob's distance from each end of its own track, expressed on the INLINE axis.
   *
   * `inset-inline-start` is the right-hand edge in Urdu, so a purely physical left-gap would
   * report 28px for a knob that is correctly sitting 4px from the inline start — which is
   * exactly how a mirrored control looks like a broken one.
   */
  const knobGaps = () =>
    page.evaluate(() => {
      const knob = document.querySelector('[data-testid="theme-knob"]') as HTMLElement | null;
      const track = knob?.parentElement;
      if (!knob || !track) return null;
      const k = knob.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      return {
        inlineStart: Math.round(rtl ? t.right - k.right : k.left - t.left),
        inlineEnd: Math.round(rtl ? k.left - t.left : t.right - k.right),
        trackWidth: Math.round(t.width),
      };
    });

  await setPrefs(page, 'en', 'light');
  await page.goto(`${BASE_URL}/admin/settings`);
  await page.waitForLoadState('networkidle');
  const ltr = await knobGaps();
  expect(ltr, 'the theme switch is not on the Settings page').not.toBeNull();
  expect(ltr!.inlineStart, 'EN light: the knob rests at the track’s inline start').toBeLessThanOrEqual(6);
  expect(ltr!.inlineEnd, 'EN light: and it is not at the far end').toBeGreaterThan(20);

  await setPrefs(page, 'ur', 'light');
  await page.goto(`${BASE_URL}/admin/settings`);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  const rtl = await knobGaps();
  expect(rtl!.inlineStart, 'UR light: off is still the inline start, not the physical left').toBeLessThanOrEqual(6);
  expect(rtl!.inlineEnd, 'UR light: and it is not at the far end').toBeGreaterThan(20);
});

test('the migrated token colours render exactly what the removed shims produced', async ({ page }) => {
  await signIn(page);

  /**
   * The values below are the ones the deleted rules computed to, not new choices:
   *   `.text-[#888]`  light `--text-secondary` #6e6e6b · dark `--muted-foreground` #7c7c78
   *   `.border-black` both themes `--border-control`
   * The migration is only correct if the pixels did not move.
   */
  const caption = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="auth-caption"]') as HTMLElement | null;
    return el ? getComputedStyle(el).color : null;
  });

  await setPrefs(page, 'en', 'light');
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState('networkidle');
  expect(await caption(), 'light caption text moved off #6e6e6b').toBe('rgb(110, 110, 107)');

  await setPrefs(page, 'en', 'dark');
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect(await caption(), 'dark caption text moved off #7c7c78').toBe('rgb(124, 124, 120)');

  const outline = await page.evaluate(() => {
    const el = document.querySelector('input[type="tel"], input') as HTMLElement | null;
    return el ? getComputedStyle(el).borderColor : null;
  });
  expect(outline, 'the dark field outline no longer names the control token').toBe('rgb(58, 58, 52)');
});
