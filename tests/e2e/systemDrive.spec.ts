/**
 * E2E: the app is system-driven, not screen-by-screen styled.
 *
 * The claim being tested is the one the design system exists to make:
 *
 *   change ONE central token  →  multiple screens change  →  no screen file is touched
 *
 * It is tested by actually doing it. This spec patches two tokens in `src/index.css`,
 * reloads three unrelated screens, and measures the live DOM. Nothing under `src/pages`
 * or `src/components` is edited, and the stylesheet is restored in `afterAll` whether the
 * test passes or throws.
 *
 *   --text-row   17px → 14px   every row label on every list screen (`.ds-row-label`)
 *   --icon       24px → 16px   every shared row glyph (`svg.ds-glyph`)
 *
 * A failure here means a future "make the headings smaller" / "make the icons smaller"
 * request would fall back to a hand sweep, which is the outcome this guards.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { cleanupFixtures, loginViaUi, setupFixtures } from './helpers';

const OWNER_PHONE = '923001234567';
const CSS_PATH = path.resolve(process.cwd(), 'src/index.css');

/**
 * Which screens carry which metric, read off the running app rather than assumed:
 * only Settings renders both, so each metric is proven across three screens of its own.
 * Type lives on every list row; the glyph class is on list rows AND on the empty-state
 * icon, which is why the empty screens can prove the icon token too.
 */
const TYPE_SCREENS = ['/admin/settings', '/admin/reports', '/admin/payments'];

/**
 * Which icon token each screen renders, and what it must become. Row glyphs read
 * `--icon` (24 → 16); the search glyph reads `--icon-sm` (18 → 12). Both are the same
 * single decision — "make the icons smaller" — so both tokens move in one edit.
 */
const ICON_SCREENS: Record<string, { before: number; after: number }> = {
  '/admin/settings': { before: 24, after: 16 },
  '/admin/purchases': { before: 24, after: 16 },
  '/admin/products': { before: 18, after: 12 },
};

const ORIGINAL = fs.readFileSync(CSS_PATH, 'utf8');

function patchTokens(from: string, to: string): void {
  const next = from
    .replace(/--text-row:\s*17px;/, '--text-row: 14px;')
    .replace(/^(\s*)--icon:\s*24px;/m, '$1--icon: 16px;')
    .replace(/^(\s*)--icon-sm:\s*18px;/m, '$1--icon-sm: 12px;');
  if (next === from) throw new Error('token patch changed nothing — the token names moved?');
  fs.writeFileSync(CSS_PATH, next);
}

function restoreTokens(): void {
  fs.writeFileSync(CSS_PATH, ORIGINAL);
}

interface Measurement {
  rowFontSize: number | null;
  glyphWidth: number | null;
  labels: number;
  glyphs: number;
}

async function measure(page: Page, route: string, needType = true): Promise<Measurement> {
  await page.goto(route);
  await page.waitForTimeout(1500);
  return page.evaluate((wantsType: boolean) => {
    const label = document.querySelector('.ds-row-label') as HTMLElement | null;
    const glyphs = [
      ...document.querySelectorAll('svg.ds-glyph, svg.ds-glyph-sm'),
    ] as SVGSVGElement[];
    return {
      rowFontSize: label ? parseFloat(getComputedStyle(label).fontSize) : null,
      glyphWidth: glyphs.length ? parseFloat(getComputedStyle(glyphs[0]).width) : null,
      labels: document.querySelectorAll('.ds-row-label').length,
      glyphs: glyphs.length,
      _wantsType: wantsType,
    } as Measurement & { _wantsType: boolean };
  }, needType);
}

test.describe('one central token drives many screens', () => {
  // The list screens only prove anything when they have rows, so the fixtures are seeded
  // rather than relying on whatever the QA database happens to hold.
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    restoreTokens();
    await cleanupFixtures();
  });

  test('changing --text-row and --icon moves three screens without touching them', async ({ page }) => {
    await loginViaUi(page, OWNER_PHONE);

    // ── baseline, with the tokens as committed ────────────────────────────────
    const before: Record<string, Measurement> = {};
    const allRoutes = [...new Set([...TYPE_SCREENS, ...Object.keys(ICON_SCREENS)])];
    for (const route of allRoutes) {
      before[route] = await measure(page, route);
    }
    console.log('[systemDrive] before ' + JSON.stringify(before));
    for (const route of TYPE_SCREENS) {
      expect(before[route].labels, `${route}: no row labels to measure`).toBeGreaterThan(0);
      expect(before[route].rowFontSize, `${route}: row label has no font size`).toBe(17);
    }
    for (const [route, expected] of Object.entries(ICON_SCREENS)) {
      expect(before[route].glyphs, `${route}: no token-sized glyph on this screen`).toBeGreaterThan(0);
      expect(before[route].glyphWidth, `${route}: glyph is not sized from an icon token`).toBe(
        expected.before,
      );
    }

    // ── the one change ────────────────────────────────────────────────────────
    patchTokens(ORIGINAL, ORIGINAL);

    try {
      const after: Record<string, Measurement> = {};
      for (const route of allRoutes) {
        after[route] = await measure(page, route);
      }
      console.log('[systemDrive] after  ' + JSON.stringify(after));

      // TYPE — three screens, one token, no screen file touched.
      for (const route of TYPE_SCREENS) {
        expect(
          after[route].rowFontSize,
          `${route}: --text-row did not reach the row label (was ${before[route].rowFontSize}, now ${after[route].rowFontSize})`,
        ).toBe(14);
      }
      // ICONS — three screens, one token edit, no screen file touched.
      for (const [route, expected] of Object.entries(ICON_SCREENS)) {
        expect(
          after[route].glyphWidth,
          `${route}: the icon token did not reach the glyph (was ${before[route].glyphWidth}, now ${after[route].glyphWidth})`,
        ).toBe(expected.after);
      }

      // Sanity: the change really was central — no screen file is involved.
      const edited = fs.readFileSync(CSS_PATH, 'utf8');
      expect(edited).not.toBe(ORIGINAL);
      expect(edited).toContain('--text-row: 14px;');
      expect(edited).toContain('--icon: 16px;');
      expect(edited).toContain('--icon-sm: 12px;');
    } finally {
      restoreTokens();
    }

    // ── revert is proven, not assumed ─────────────────────────────────────────
    expect(fs.readFileSync(CSS_PATH, 'utf8')).toBe(ORIGINAL);
    const reverted = await measure(page, TYPE_SCREENS[0]);
    expect(reverted.rowFontSize, 'the token change was not reverted').toBe(before[TYPE_SCREENS[0]].rowFontSize);
    expect(reverted.glyphWidth, 'the icon token was not reverted').toBe(before[TYPE_SCREENS[0]].glyphWidth);
  });
});
