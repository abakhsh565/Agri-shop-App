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
 * Open a sheet that carries its close control, and wait until it is on screen.
 *
 * The field pickers (supplier, unit) are deliberately close-less now — "a field picker
 * resolves in one tap, so it has no close button". The branches list now opens a detail page
 * rather than a sheet, and that page's location field opens the location picker as a PAGE of its
 * own (`/pick-location`), so the leading control measured here is that page's own header back
 * button rather than a sheet's close button. The way in is: open the branch, then open its
 * location field. Waiting for the control rather than reading geometry straight after the click
 * is deliberate: a measurement taken before the screen is painted reports `null` and reads as
 * "the picker never opened".
 */
async function openPickerWithLeadingControl(page: Page) {
  await page.goto(`${BASE_URL}/admin/more`);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid^="branch-row-"]').first().click();
  await page.locator('[data-testid^="branch-location-"][data-testid$="-open"]').first().click();
  await expect(page.locator('[data-testid="nav-back"]')).toBeVisible({ timeout: 10000 });
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

  // Two screens that each carry the shared leading control: the header back control on an
  // ordinary form screen (an inline logical inset, migrated from a JS `isRtl ? right : left`
  // ternary) and the same control on the location picker page. The inset is 20px — the row's
  // own `px-5` gutter — so the arrow lines up with the header it belongs to rather than
  // reading a few pixels inward of it.
  await setPrefs(page, 'en', 'light');
  // A screen whose header keeps the leading control. Settings is deliberately not used any
  // more: its exit is now the close control on the trailing edge (an approved change), so
  // there is no leading control left there to measure.
  await page.goto(`${BASE_URL}/admin/inventory/new`);
  await page.waitForLoadState('networkidle');

  const ltrBack = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(ltrBack, 'the header back control is not on the page').not.toBeNull();
  expect(ltrBack!.dir).toBe('ltr');
  expect(ltrBack!.leftGap, 'EN: the leading control sits 20px from the left edge').toBe(20);
  expect(ltrBack!.rightGap, 'EN: it is nowhere near the right edge').toBeGreaterThan(100);

  await openPickerWithLeadingControl(page);
  const ltrPicker = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(ltrPicker, 'the picker page did not open, so its back button cannot be measured').not.toBeNull();
  expect(ltrPicker!.leftGap, 'EN: the picker back control is 20px from the left edge').toBe(20);

  await setPrefs(page, 'ur', 'light');
  await page.goto(`${BASE_URL}/admin/inventory/new`);
  await page.waitForLoadState('networkidle');

  const rtlBack = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(rtlBack!.dir, 'the Urdu direction did not apply, so nothing below would mean anything').toBe('rtl');
  expect(rtlBack!.rightGap, 'UR: the leading control mirrors to 20px from the right edge').toBe(20);
  expect(rtlBack!.leftGap, 'UR: it is nowhere near the left edge').toBeGreaterThan(100);

  await openPickerWithLeadingControl(page);
  const rtlPicker = await edgeGaps(page, '[data-testid="nav-back"]');
  expect(rtlPicker, 'the picker page did not open in Urdu').not.toBeNull();
  expect(rtlPicker!.rightGap, 'UR: the picker back control is 20px from the right edge').toBe(20);
  expect(rtlPicker!.leftGap, 'UR: it is nowhere near the left edge').toBeGreaterThan(100);
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
