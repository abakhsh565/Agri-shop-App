import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import {
  cleanupFixtures, ensureAuthSession, loginViaUi, setupFixtures, QA_IDS,
} from '../e2e/helpers';

/**
 * Captures the education media FROM THE REAL APP.
 *
 *   • workflow step frames — the actual UI, driven through each real workflow in Urdu, with
 *     the narration burned in as a caption strip (Urdu, RTL). One frame per teaching step,
 *     with the exact time that step is held. `scripts/dev/record-tutorial.mjs` turns those
 *     frames into the shipped `.webm` using Chrome's own encoder, because this machine has
 *     no ffmpeg (Playwright's bundled copy is not installed and cannot be downloaded here).
 *   • intro screenshots — the real screens the pre-login introduction shows, light + dark.
 *
 * Output lands in `public/` (videos + screenshots) and `.freebuff/frames/` (raw frames):
 *   npx playwright test --config=playwright.media.config.ts
 *   node scripts/dev/record-tutorial.mjs
 */

const OWNER_PHONE = '03009999999';
const CUSTOMER_NAME = 'QA Customer A';
const PRODUCT_NAME = 'QA Product A';
const SUPPLIER_NAME = 'QA Supplier A';

const FRAMES = '.freebuff/frames';
const IMAGES = 'public/education';

fs.mkdirSync(IMAGES, { recursive: true });

/** Persist the app's own preferences, then reload into them. */
async function setPrefs(page: Page, lang: 'ur' | 'en', theme: 'light' | 'dark') {
  await page.evaluate(({ l, t }) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...(parsed.state ?? {}), language: l, theme: t };
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, { l: lang, t: theme });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * The caption strip a tutorial narrates with: a fixed bar at the top of the frame.
 *
 * Top, not bottom: the app's bottom navigation is the thing several steps point at, and a
 * bar over it would hide the very control being taught. It survives React re-renders
 * (re-attached by an observer) because the app replaces large parts of the DOM between steps.
 */
async function withCaptions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __cap?: (t: string) => void };
    const mount = () => {
      let el = document.getElementById('__cap');
      if (!el && document.body) {
        el = document.createElement('div');
        el.id = '__cap';
        el.setAttribute('data-tut-caption', '1');
        el.style.cssText = [
          'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
          // Visual only. Without this the strip swallows taps on whatever the app
          // renders at the top of the page — which is exactly where several of the
          // controls being taught live (the reports period chips, for one).
          'pointer-events:none',
          'min-height:92px', 'padding:12px 16px', 'box-sizing:border-box',
          'background:rgba(10,10,9,0.94)', 'color:#ffffff',
          'font-size:15px', 'line-height:1.7', 'direction:rtl', 'text-align:right',
          'font-family:Inter,system-ui,sans-serif', 'box-shadow:0 6px 18px rgba(0,0,0,.35)',
        ].join(';');
        document.body.appendChild(el);
      }
      return el;
    };
    w.__cap = (text: string) => { const el = mount(); if (el) el.textContent = text; };
    new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
  });
}

/** One recorded take: the state of the real app for `hold` ms, shipped with its caption. */
class Take {
  readonly dir: string;
  private n = 0;
  private readonly timeline: { file: string; hold: number }[] = [];

  constructor(name: string) {
    this.dir = `${FRAMES}/${name}`;
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Show the caption, hold the frame, then keep the frame as the step's evidence. */
  async frame(page: Page, caption: string, hold = 1600) {
    this.n += 1;
    await page.evaluate((t) => (window as unknown as { __cap?: (s: string) => void }).__cap?.(t), caption);
    await page.waitForTimeout(120);
    await page.waitForTimeout(Math.max(0, hold - 120));
    const file = `${String(this.n).padStart(2, '0')}.png`;
    await page.screenshot({ path: `${this.dir}/${file}` });
    this.timeline.push({ file, hold });
  }

  /** Write the pace beside the frames so the encoder holds each one for its narration. */
  close() {
    fs.writeFileSync(`${this.dir}/timeline.json`, JSON.stringify(this.timeline, null, 2));
    return this.timeline.length;
  }
}

/**
 * Tap the first real control whose text contains one of the candidates.
 *
 * Scoped to controls on purpose: the caption bar is a plain div, so it can never be
 * mistaken for the button a step means to press.
 */
function control(page: Page, text: string) {
  return page
    .locator(`button:has-text("${text}"), a:has-text("${text}"), [role="button"]:has-text("${text}")`)
    .first();
}

/** Every control on screen, with its real state — what a failed step gets reported with. */
async function describeControls(page: Page): Promise<string> {
  return page.evaluate(() => Array.from(document.querySelectorAll('button, a, [role="button"]'))
    .map((n) => `${(n.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)}${(n as HTMLButtonElement).disabled ? '[disabled]' : ''}`)
    .filter(Boolean)
    .join(' | '));
}

/**
 * Tap the first real control whose text contains one of the candidates.
 *
 * Scoped to controls on purpose: the caption bar is a plain div, so it can never be
 * mistaken for the button a step means to press. A control that is present but *disabled* is
 * waited for rather than clicked blindly, and if the step still cannot be done the error
 * names the exact state of every control on screen — so the next run explains itself instead
 * of needing another probe.
 */
async function tap(page: Page, candidates: string[], what: string) {
  for (const text of candidates) {
    const el = control(page, text);
    if (await el.count()) {
      try {
        await el.waitFor({ state: 'visible', timeout: 4000 });
        await el.click({ timeout: 15000 });
        await page.waitForTimeout(900);
        return;
      } catch { /* try the next candidate */ }
    }
  }
  throw new Error(`could not tap ${what} (tried: ${candidates.join(' | ')})\non screen: ${await describeControls(page)}`);
}

/**
 * Type an amount into the field the screen has just rendered, then wait until the screen
 * agrees it can be submitted.
 *
 * Both waits are the point: these forms load their subject asynchronously, so the field does
 * not exist during the first moments after the tap that opened them, and the submit button
 * stays disabled until the amount reaches the form's state. Filling "the first number box"
 * without waiting produced a recording that silently stopped one step short of a saved
 * payment — a wrong tutorial, not a slow one.
 */
async function fillAmount(page: Page, value: string, submit: string[]) {
  const field = page.locator('input[type="number"], input[inputmode="numeric"]').first();
  await field.waitFor({ state: 'visible', timeout: 15000 });
  await field.click({ timeout: 8000 }).catch(() => {});
  await field.fill(value);
  await field.blur().catch(() => {});
  for (const text of submit) {
    const button = control(page, text);
    if (await button.count()) {
      await button.evaluate((n) => {
        const el = n as HTMLButtonElement;
        if (!el.disabled) return;
        return new Promise<void>((resolve) => {
          const obs = new MutationObserver(() => { if (!el.disabled) { obs.disconnect(); resolve(); } });
          obs.observe(el, { attributes: true });
          setTimeout(() => { obs.disconnect(); resolve(); }, 12000);
        });
      });
      break;
    }
  }
  await page.waitForTimeout(600);
}

test.describe('education media — workflow tutorial frames', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await ensureAuthSession(OWNER_PHONE);
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('new sale, end to end', async ({ page }) => {
    const take = new Take('new-sale');
    await withCaptions(page);
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'ur', 'light');

    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');
    await take.frame(page, 'یہ آپ کا ہوم ہے۔ آج کی فروخت، ادھار اور سٹاک یہیں نظر آتا ہے۔', 2400);
    await take.frame(page, 'نئی فروخت شروع کرنے کے لیے یہ بٹن دبائیں۔', 1400);
    await tap(page, ['نئی فروخت', 'New Sale'], 'the New Sale button');
    await take.frame(page, 'پہلے گاہک چنیں۔ اگر نیا گاہک ہے تو اسی جگہ سے شامل کریں۔', 2200);

    await tap(page, [CUSTOMER_NAME], 'the customer');
    await take.frame(page, 'اب وہ سامان چنیں جو گاہک لے رہا ہے۔', 1600);
    await tap(page, [PRODUCT_NAME], 'the product');
    await take.frame(page, 'یہاں آپ نے کون سا پیک بیچنا ہے وہ چنیں — مثلاً 1kg۔', 1800);

    await tap(page, ['1kg', '1 kg'], 'the variant');
    await take.frame(page, 'کارٹ میں ڈالیں، پھر مقدار لکھیں۔', 1600);
    await tap(page, ['کارٹ میں ڈالیں', 'Add to Cart'], 'Add to Cart');
    await take.frame(page, 'یہ کارٹ ہے: سامان، مقدار اور کل رقم۔', 2000);
    await take.frame(page, 'نیچے ادائیگی کی قسم ہے — پوری رقم یا جزوی / ادھار۔', 2200);

    await take.frame(page, 'اب "فروخت مکمل کریں" دبائیں۔', 1600);
    await tap(page, ['فروخت مکمل کریں', 'Complete Sale'], 'Complete Sale');
    await take.frame(page, 'فروخت محفوظ ہو گئی۔ اسٹاک خود کم ہو گیا اور گاہک کے کھاتے میں رقم لکھی گئی۔', 2800);

    console.log(`[media] new-sale: ${take.close()} frames`);
  });

  test('collecting a payment', async ({ page }) => {
    const take = new Take('collect-payment');
    await withCaptions(page);
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'ur', 'light');

    await page.goto('/admin/customers');
    await page.waitForLoadState('networkidle');
    await take.frame(page, 'گاہک کا کھاتہ دیکھنے کے لیے اس کے نام پر دبائیں۔', 2000);
    await tap(page, [CUSTOMER_NAME], 'the customer');
    await take.frame(page, 'یہاں لکھا ہے کہ اس سے کتنی رقم لینی باقی ہے۔', 2400);
    await take.frame(page, 'وصولی درج کرنے کے لیے یہ بٹن دبائیں۔', 1600);

    await tap(page, ['ادائیگی لکھیں', 'Record Payment'], 'Record Payment');
    await take.frame(page, 'جو رقم ملی ہے وہ یہاں لکھیں۔', 1800);
    await fillAmount(page, '5000', ['ادائیگی کی تصدیق کریں', 'Confirm Payment']);
    await take.frame(page, 'نیچے نقد یا بینک — جیسے پیسے آئے ہیں وہ چنیں۔', 2000);
    await take.frame(page, 'اب "ادائیگی کی تصدیق کریں" دبائیں۔', 1600);
    await tap(page, ['ادائیگی کی تصدیق کریں', 'Confirm Payment'], 'Confirm Payment');
    await take.frame(page, 'دیکھیں — باقی رقم کم ہو گئی۔ ہر وصولی کا ریکارڈ اسی کھاتے میں رہتا ہے۔', 2600);

    console.log(`[media] collect-payment: ${take.close()} frames`);
  });

  test('reading the reports', async ({ page }) => {
    const take = new Take('reports');
    await withCaptions(page);
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'ur', 'light');

    await page.goto('/admin/reports');
    await page.waitForLoadState('networkidle');
    await take.frame(page, 'رپورٹس میں آپ کے دھندے کا سارا حساب ہے۔', 2400);
    await take.frame(page, 'اوپر سے وقت چنیں — آج، اس ہفتے یا اس مہینے کا حساب۔', 2000);

    await tap(page, ['اس ہفتے', 'This Week'], 'a period chip');
    await take.frame(page, 'یہاں کل فروخت، نقدی اور ادھار نظر آتا ہے۔', 2400);
    await take.frame(page, 'نیچے سامان کی لاگت اور منافع ہے — یعنی کتنا خرچ ہوا اور کتنا نفع رہا۔', 2600);
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    await take.frame(page, 'سب سے اہم بات: نفع دیکھ کر طے کریں کون سا سامان چل رہا ہے اور کون سا نہیں۔', 2800);

    console.log(`[media] reports: ${take.close()} frames`);
  });

  test('bringing stock in through a purchase', async ({ page }) => {
    const take = new Take('stock-in');
    await withCaptions(page);
    await loginViaUi(page, OWNER_PHONE);
    await setPrefs(page, 'ur', 'light');

    await page.goto('/admin/purchases');
    await page.waitForLoadState('networkidle');
    await take.frame(page, 'جب دکان میں مال آئے تو وہ یہاں درج کریں۔', 2400);
    await take.frame(page, 'خرید لکھنے کے لیے یہ بٹن دبائیں۔', 1600);

    await tap(page, ['خریداری لکھیں', 'Record Stock Purchase'], 'the record-purchase action');
    await take.frame(page, 'سپلائر والے خانے پر دبائیں — مال کس سے آیا۔', 2000);
    await tap(page, ['سپلائر چنیں', 'Select supplier'], 'the supplier field');
    await take.frame(page, 'فہرست میں سے سپلائر چنیں۔', 2000);
    await tap(page, [SUPPLIER_NAME], 'the supplier option');
    await take.frame(page, 'اب پروڈکٹ کا خانہ کھولیں اور سامان چنیں۔', 2200);
    await tap(page, ['Select product', 'پروڈکٹ'], 'the product field');
    await tap(page, [PRODUCT_NAME], 'the product option');
    await take.frame(page, 'پیک چنیں (مثلاً 1kg) اور مقدار لکھیں۔', 2400);
    await tap(page, ['1kg', '1 kg'], 'the variant');
    await fillAmount(page, '10', ['محفوظ کریں اور اسٹاک میں ڈالیں', 'Save']);
    await take.frame(page, 'محفوظ کرنے سے اسٹاک بڑھ جاتا ہے اور خرید سپلائر کے کھاتے میں لکھی جاتی ہے۔', 2800);
    await tap(page, ['محفوظ کریں اور اسٹاک میں ڈالیں', 'Save'], 'Save purchase');
    await take.frame(page, 'خرید محفوظ ہو گئی۔ یہی رقم اب سپلائر کو دینی ہے۔', 2600);

    console.log(`[media] stock-in: ${take.close()} frames`);
  });
});

test.describe('education media — intro screenshots', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await ensureAuthSession(OWNER_PHONE);
  });

  test.afterAll(async () => {
    await cleanupFixtures();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`real screens in ${theme}`, async ({ page }) => {
      await loginViaUi(page, OWNER_PHONE);
      await setPrefs(page, 'ur', theme);

      await page.goto('/admin/dashboard');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${IMAGES}/intro-sell-${theme}.png` });

      await page.goto(`/admin/customers/${QA_IDS.customerA}`);
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${IMAGES}/intro-udhaar-${theme}.png` });

      await page.goto('/admin/reports');
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `${IMAGES}/intro-profit-${theme}.png` });
    });
  }

  test('the pre-login introduction itself', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('agrishop-intro-seen'));
    await page.goto('/welcome');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('intro-title')).toBeVisible();
    await page.screenshot({ path: `${IMAGES}/intro-screen.png` });
  });
});
