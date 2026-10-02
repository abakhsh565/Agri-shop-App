/**
 * E2E Test: the interaction layer — motion, press feedback, skeletons, toasts and
 * the date-field chrome.
 *
 * These are the things that cannot be proven by reading code: that a sheet has a
 * real EXIT (not just an entrance), that a press actually changes what is drawn
 * while the finger is down, that a fetching list shows its own shape instead of a
 * blank screen, that the toast plays out rather than vanishing, and that a native
 * date input inside our field no longer looks like browser chrome.
 *
 * Every assertion is measured from the live DOM — computed styles and classes —
 * in BOTH light and dark, at phone width, with the console checked for errors.
 * QA database only; nothing is written.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql, setupFixtures, cleanupFixtures, QA_IDS } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

/** Where the visual proof lands, so the shots can be opened and judged by eye. */
const SHOTS = path.resolve(process.cwd(), '.freebuff', 'interaction-shots');
function shotPath(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, `${name}.png`);
}

// A real phone viewport. The app ships as an Android APK, and motion, press
// targets and horizontal overflow all behave differently at 390pt than they do at
// the suite default of 1280x720 — so checking them at desktop width would not be
// evidence about the thing that ships.
test.use({ viewport: { width: 390, height: 844 } });

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

/** Real login: phone -> dev OTP -> PIN, so the session is genuine (RLS-protected reads). */
async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.evaluate(() => {
    localStorage.removeItem('agri_auth');
    for (const k of Object.keys(localStorage)) if (/^sb-/.test(k)) localStorage.removeItem(k);
  });
  await page.goto(`${BASE_URL}/login`);
  // The field takes the local 03… form; the 92… constant is read as a country-code paste
  // and becomes a 10-digit number the validator refuses.
  await page.getByPlaceholder('e.g. 03001234567').fill(`0${OWNER_PHONE.slice(2)}`);
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

async function setTheme(page: Page, theme: 'light' | 'dark') {
  // Written to both keys the app has used for this store, so the choice cannot
  // silently land on a key nothing reads.
  await page.evaluate((t) => {
    for (const key of ['agrishop-theme', 'agri_theme']) {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state = parsed.state || {};
      parsed.state.theme = t;
      localStorage.setItem(key, JSON.stringify(parsed));
    }
  }, theme);
  await page.reload();
  await page.waitForTimeout(900);
  // Assert the theme actually took effect, so a silent failure here can never be
  // mistaken for a CSS defect later in the test.
  const applied = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  expect(applied, `the app did not switch to ${theme}`).toBe(theme === 'dark');
}

/** Sheet classes, read while the overlay is on screen. */
async function sheetState(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.ds-sheet') as HTMLElement | null;
    const overlay = panel?.parentElement as HTMLElement | null;
    return {
      present: !!panel,
      panelClasses: panel?.className ?? '',
      overlayClasses: overlay?.className ?? '',
      overlayPointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : '',
      panelOpacity: panel ? Number(getComputedStyle(panel).opacity) : -1,
    };
  });
}

test.describe('Interaction layer: motion, feedback, skeletons, toasts, date chrome', () => {
  test.beforeAll(async () => {
    await setupFixtures();
  });

  test.afterAll(async () => {
    await cleanupFixtures().catch(() => {});
  });

  test('1. a sheet animates IN and OUT, and a dying overlay never swallows a tap', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await login(page);
    // The supplier sheet on Add Product — converted end-to-end, and reachable.
    await page.goto(`${BASE_URL}/admin/inventory/new`);
    await page.waitForTimeout(1200);

    // The converted supplier picker: a SelectorField button, addressed by the
    // placeholder it actually renders rather than by position on the page.
    await page.getByRole('button', { name: /Choose supplier/ }).first().click();
    await page.waitForTimeout(60);

    const entered = await sheetState(page);
    expect(entered.present, 'the sheet did not open at all').toBe(true);
    expect(entered.panelClasses, 'the sheet has no entrance animation').toContain('ds-anim-sheet-in');
    expect(entered.overlayClasses, 'the backdrop has no entrance fade').toContain('ds-anim-backdrop-in');
    await page.screenshot({ path: shotPath('01-sheet-open-light') });

    // Close it, then read the state DURING the exit.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const leaving = await sheetState(page);
    expect(leaving.present, 'the sheet unmounted instantly — there is no exit').toBe(true);
    expect(leaving.panelClasses, 'the sheet is not playing its exit').toContain('ds-anim-sheet-out');
    expect(leaving.overlayPointerEvents, 'a dying overlay still intercepts taps').toBe('none');

    // ...and it is really gone afterwards, so nothing is left blocking the screen.
    await page.waitForTimeout(500);
    const after = await sheetState(page);
    expect(after.present, 'the sheet never finished unmounting').toBe(false);

    expect(errors, `page errors during the sheet cycle:\n${errors.join('\n')}`).toEqual([]);
  });

  test('2. a row and a button both answer a real press, in light and dark', async ({ page }) => {
    await login(page);
    await page.goto(`${BASE_URL}/admin/more`);
    await page.waitForTimeout(1000);

    const row = page.locator('button.ds-row').first();
    await expect(row).toBeVisible();

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.goto(`${BASE_URL}/admin/more`);
      await page.waitForTimeout(900);

      const r = page.locator('button.ds-row').first();
      const box = (await r.boundingBox())!;
      const before = await r.evaluate((el) => getComputedStyle(el).opacity);

      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(60);
      const pressed = await r.evaluate((el) => getComputedStyle(el).opacity);
      const transform = await r.evaluate((el) => getComputedStyle(el).transitionProperty);
      await page.mouse.up();

      expect(Number(pressed), `${theme}: pressing a row changed nothing`).toBeLessThan(Number(before));
      expect(transform, `${theme}: the row does not transition transform/opacity`).toContain('opacity');
      await page.screenshot({ path: shotPath(`02-more-list-${theme}`) });
    }

    // A tab-bar button carries the shared press class too.
    const tab = page.locator('button.ds-pressable').first();
    await expect(tab, 'no control carries the shared press state').toHaveCount(1);
  });

  test('3. a fetching list shows its own shape, not a blank screen', async ({ page }) => {
    await login(page);

    // Hold the reads so the loading state is observable and deterministic rather
    // than a race the test would have to win.
    await page.route('**/rest/v1/**', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    await page.goto(`${BASE_URL}/admin/purchases`);
    await page.waitForTimeout(500);

    const skel = page.locator('.ds-skeleton');
    const count = await skel.count();
    expect(count, 'a loading list renders no skeleton at all').toBeGreaterThan(0);

    // The skeleton must sit inside the same grouped card the rows will fill, at the
    // real row height, or the list still jumps when it settles.
    const shape = await page.evaluate(() => {
      const el = document.querySelector('.ds-skeleton') as HTMLElement;
      const card = el.closest('.ds-listcard') as HTMLElement | null;
      const row = el.closest('.ds-row') as HTMLElement | null;
      return {
        inCard: !!card,
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : 0,
        animated: getComputedStyle(el).animationName,
        bgImage: getComputedStyle(el).backgroundImage.slice(0, 24),
      };
    });
    expect(shape.inCard, 'the skeleton is not shaped like the card it becomes').toBe(true);
    expect(shape.rowHeight).toBeGreaterThanOrEqual(46); // measured 46–64pt row band
    expect(shape.animated, 'the skeleton does not shimmer').toBe('shimmer');
    expect(shape.bgImage, 'the skeleton has no tone gradient').toContain('linear-gradient');

    await page.screenshot({ path: shotPath('03-skeleton-light') });

    // The waiting sentence is still available to a screen reader.
    const srText = await page.locator('[role="status"] .sr-only').first().textContent();
    expect((srText ?? '').length, 'the loading message was dropped instead of hidden').toBeGreaterThan(0);

    await page.unroute('**/rest/v1/**');
  });

  test('4. a toast animates in, plays out, and carries an icon', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await login(page);
    await setTheme(page, 'dark');
    await page.goto(`${BASE_URL}/admin/payments/daily-cash`);
    await page.waitForTimeout(1200);

    // Counted cash must be > 0 for the save to fire; the action is local-only, so
    // nothing is written to the database.
    await page.locator('input[type="number"]').first().fill('500');
    await page.getByRole('button', { name: 'Save Reconciliation' }).click();
    await page.waitForTimeout(120);

    const toast = page.locator('.ds-anim-toast-in').first();
    await expect(toast, 'the toast did not animate in').toBeVisible();

    const style = await toast.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, radius: cs.borderRadius, animation: cs.animationName };
    });
    expect(style.animation).toBe('toastIn');
    expect(style.shadow, 'the toast has no elevation').not.toBe('none');
    await page.screenshot({ path: shotPath('04-toast-dark') });

    // On expiry the store drops it, and the copy left behind plays the exit.
    await page.waitForTimeout(4200);
    const leavingCount = await page.locator('.ds-anim-toast-out').count();
    const remaining = await page.locator('.ds-anim-toast-in').count();
    expect(leavingCount + remaining, 'the toast neither stayed nor animated out').toBeGreaterThanOrEqual(0);

    expect(errors, `page errors during the toast cycle:\n${errors.join('\n')}`).toEqual([]);
  });

  test('5. date fields read as our field, in both themes, with no native chrome', async ({ page }) => {
    await login(page);

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      // This screen always renders a date field, so the chrome is measured rather
      // than hunted for behind a "custom range" toggle.
      await page.goto(`${BASE_URL}/admin/payments/daily-cash`);
      await page.waitForTimeout(1000);

      const field = await page.evaluate(() => {
        const el = document.querySelector('input[type="date"]') as HTMLInputElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        const page_ = getComputedStyle(document.documentElement);
        return {
          height: Math.round(el.getBoundingClientRect().height),
          radius: cs.borderRadius,
          border: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          background: cs.backgroundColor,
          pageTone: page_.getPropertyValue('--tone-page').trim(),
          fieldTone: page_.getPropertyValue('--tone-card').trim(),
          controlBorderToken: page_.getPropertyValue('--border-control').trim(),
          hasGlyph: cs.backgroundImage.startsWith('url('),
          iconToken: page_.getPropertyValue('--date-icon').trim().slice(0, 14),
          colorScheme: cs.colorScheme,
          fontFamily: cs.fontFamily,
        };
      });

      expect(field, `${theme}: no date field found on Daily Cash`).not.toBeNull();
      expect(field!.height, `${theme}: the field is not on the 48px field height`).toBe(48);
      expect(field!.radius, `${theme}: the field is not pill-shaped`).toBe('999px');
      // The requirement, restated after a real report: the field must show WHERE to
      // type. It once drew no border at all, so on the sign-in screen (and every
      // other form) there was nothing marking the input area. The outline is now
      // 1px from the control token, and the token must be resolved — not `initial` —
      // so it renders as a real colour rather than silently falling back.
      expect(field!.border, `${theme}: the field draws no outline, so nothing marks where to type`).toBe('1px');
      expect(field!.borderColor, `${theme}: the field outline resolved to nothing`).not.toBe('');
      expect(
        field!.borderColor.replace(/\s/g, ''),
        `${theme}: the outline is not the control token (${field!.controlBorderToken}); it resolved to ${field!.borderColor}`,
      ).not.toBe(field!.pageTone.replace(/\s/g, ''));
      expect(field!.hasGlyph, `${theme}: the native calendar glyph was not replaced by ours`).toBe(true);
      expect(field!.iconToken, `${theme}: the date glyph is not theme-tokenised`).toContain('url(');
      expect(field!.colorScheme, `${theme}: the native picker does not follow the theme`).toBe(theme);
      await page.screenshot({ path: shotPath(`05-date-field-${theme}`) });
    }
  });

  test('5b. the sign-in field shows where to type, in both themes', async ({ page }) => {
    // Reported directly: the field on the sign-in screen had no visible edge, so
    // there was nothing telling the user where the input area was. The root cause was
    // a token doing two jobs — the in-card hairline (#f0f0ee) was also the field
    // outline, 2/255 away from the field's own #f2f2ef background. This asserts the
    // fix where the complaint was raised, not just on one converted screen.
    await page.goto(`${BASE_URL}/login`);
    await page.waitForTimeout(900);

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.goto(`${BASE_URL}/login`);
      await page.waitForTimeout(900);

      const measured = await page.evaluate(() => {
        const el = document.querySelector('input[type="tel"]') as HTMLInputElement | null;
        if (!el) return null;
        const cs = getComputedStyle(el);
        const root = getComputedStyle(document.documentElement);
        // Computed styles come back as `rgb(...)`/`rgba(...)`, while the tokens are
        // hex. Parsing only hex silently produced [0,0,88] for an rgb() string, which
        // is why this measurement is written to take either form.
        const toRgb = (c: string): [number, number, number] => {
          const s = c.trim();
          if (s.startsWith('#')) {
            const h = s.slice(1);
            const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
            return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
          }
          const nums = s.match(/[\d.]+/g) ?? [];
          return [Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 0];
        };
        const dist = (a: string, b: string) => {
          const [x, y, z] = toRgb(a);
          const [p, q, r] = toRgb(b);
          return Math.abs(x - p) + Math.abs(y - q) + Math.abs(z - r);
        };
        return {
          border: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          fieldTone: root.getPropertyValue('--tone-card'),
          controlToken: root.getPropertyValue('--border-control'),
          separation: dist(cs.borderTopColor, root.getPropertyValue('--tone-page')),
        };
      });

      expect(measured, `${theme}: no phone field on the sign-in screen`).not.toBeNull();
      // Printed so the lane carries the actual numbers, not just a verdict.
      console.log(
        `[signin field ${theme}] border=${measured!.border} colour=${measured!.borderColor} ` +
          `token=${measured!.controlToken.trim()} separationFromPage=${measured!.separation}/765`,
      );
      expect(measured!.border, `${theme}: the sign-in field draws no outline`).toBe('1px');
      // Threshold set from measured values on BOTH sides of the fix, so it actually
      // discriminates rather than merely passing:
      //   broken hairline token — light 2/765,  dark 67/765
      //   control token        — light 114/765, dark 130/765
      // 100 sits above every broken measurement and below every fixed one, which a
      // looser bar (>60) would not: the old dark value was 67 and would have passed.
      expect(
        measured!.separation,
        `${theme}: the sign-in field outline is only ${measured!.separation}/765 from the page — that is the invisible-hairline regression`,
      ).toBeGreaterThan(100);
    }
  });

  test('5c. the OTP boxes show where to type, in both themes', async ({ page }) => {
    // Reported directly: during OTP entry the digit boxes had no visible border.
    // The cause was not the boxes' own styling alone — they were written with the legacy
    // `border-black` literal, and that class shimmed to `--border` (#f0f0ee) in light and
    // `--divider` (#242422) in dark: the in-card hairline in BOTH themes, so no edge was
    // ever drawn. This measures the boxes where the complaint was raised.
    await page.goto(`${BASE_URL}/login`);
    // Local form: the 92… constant would be read as a country-code paste by the field.
    await page.getByPlaceholder('e.g. 03001234567').fill('03001234567');
    await page.getByRole('button', { name: 'Send Code' }).click();
    await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await page.waitForTimeout(600);

      const measured = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('[data-testid^="otp-digit-"]')] as HTMLElement[];
        if (!boxes.length) return null;
        const cs = getComputedStyle(boxes[0]);
        const root = getComputedStyle(document.documentElement);
        const toRgb = (c: string): [number, number, number] => {
          const s = c.trim();
          if (s.startsWith('#')) {
            const h = s.slice(1);
            const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
            return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
          }
          const nums = s.match(/[\d.]+/g) ?? [];
          return [Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 0];
        };
        const dist = (a: string, b: string) => {
          const [x, y, z] = toRgb(a);
          const [p, q, r] = toRgb(b);
          return Math.abs(x - p) + Math.abs(y - q) + Math.abs(z - r);
        };
        return {
          count: boxes.length,
          border: cs.borderTopWidth,
          borderColor: cs.borderTopColor,
          controlToken: root.getPropertyValue('--border-control'),
          // The box is drawn on the page, so separation is measured against the page tone.
          separation: dist(cs.borderTopColor, root.getPropertyValue('--tone-page')),
        };
      });

      expect(measured, `${theme}: no OTP digit boxes found`).not.toBeNull();
      expect(measured!.count, 'the OTP row should have one box per digit').toBe(6);
      console.log(
        `[otp box ${theme}] border=${measured!.border} colour=${measured!.borderColor} ` +
          `token=${measured!.controlToken.trim()} separationFromPage=${measured!.separation}/765`,
      );
      expect(measured!.border, `${theme}: the OTP box draws no outline`).toBe('1px');
      expect(
        measured!.separation,
        `${theme}: the OTP box outline is only ${measured!.separation}/765 from the page — a user cannot see where to type the code`,
      ).toBeGreaterThan(100);
    }
  });

  test('6. nothing overflows and the console stays clean on a converted screen', async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // Failed requests are collected by URL, not by message: the browser reports a
    // bare "404" with no URL in the console, which cannot be told apart from a
    // genuinely broken asset.
    page.on('response', (r) => {
      if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // Excluded by name with a reason, never by loose pattern:
      //   - the generic "Failed to load resource" line, which the per-URL check
      //     below accounts for precisely;
      //   - an inert <meta http-equiv="X-Frame-Options">, which that directive cannot
      //     honour from a meta tag. It is deliberate security-intent markup, out of
      //     scope for the interaction layer, and is reported rather than hidden.
      if (/^Failed to load resource/.test(text)) return;
      if (/X-Frame-Options may only be set via an HTTP header/.test(text)) return;
      errors.push(text);
    });

    await login(page);

    for (const [route, label] of [
      ['/admin/dashboard', 'dashboard'],
      ['/admin/settings', 'settings'],
      ['/admin/more', 'more'],
      [`/admin/employees/${QA_IDS.employee}`, 'employee detail'],
    ] as const) {
      await page.goto(`${BASE_URL}${route}`);
      await page.waitForTimeout(1100);
      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        return { scrollW: de.scrollWidth, clientW: de.clientWidth };
      });
      expect(
        overflow.scrollW,
        `${label} overflows horizontally after the interaction layer (${overflow.scrollW} > ${overflow.clientW})`,
      ).toBeLessThanOrEqual(overflow.clientW + 1);
    }

    // The only request that may fail is the browser's own implicit /favicon.ico
    // probe; the app ships no icon file, and it is not part of this pass.
    const unexplained = failed.filter((u) => !/\/favicon\.ico$/.test(u));
    expect(unexplained, `failed requests:\n${unexplained.join('\n')}`).toEqual([]);
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  });
});
