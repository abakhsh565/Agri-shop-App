/**
 * Capture evidence that a REAL login lands on a working home screen.
 *
 * WHY A SCRIPT AND NOT A SPEC: the preview webview's raster capture is broken in
 * this environment (no frames composited), and a new .spec.ts would join the e2e
 * lanes and the feature-registry guard's test surface. This runs the same real
 * login flow (phone -> demo OTP -> PIN) against the already-running QA-mode Vite
 * server and writes PNGs to .freebuff/.
 *
 * Usage: node scripts/dev/capture-home.mjs [phone]
 */
import { chromium } from '@playwright/test';
import * as fs from 'fs';

const BASE = process.env.APP_BASE_URL || 'http://localhost:5173';
const OUT = '.freebuff';
const PHONE = process.argv[2] || '03001234567'; // QA fixture owner
const OTP = '123456';
const PIN = '4321';

function log(...args) { console.log('[capture-home]', ...args); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') log('console.error:', m.text().slice(0, 200)); });

try {
  fs.mkdirSync(OUT, { recursive: true });

  // Start clean so the authenticated route guard does not skip the flow.
  await page.goto(`${BASE}/login`);
  await page.evaluate(() => {
    localStorage.removeItem('agri_auth');
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
  });
  await page.goto(`${BASE}/login`);

  await page.getByPlaceholder('e.g. 03001234567').fill(PHONE);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });
  log('otp screen reached');

  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await boxes.first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="otp-digit-"]').length === 6,
    undefined,
    { timeout: 15000 },
  );
  log('otp boxes:', await boxes.count());
  await boxes.first().click();
  await page.keyboard.type(OTP); // keystrokes, not fill: each digit auto-advances
  await page.waitForURL(/account-ready|pin-set|pin\/?$|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });
  log('after otp:', page.url());

  if (page.url().includes('account-ready')) {
    await page.getByTestId('account-ready-pin').click();
    await page.waitForURL(/pin-set/, { timeout: 30000 });
  }
  if (page.url().includes('pin-set')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(600);
    const done = page.getByTestId('pin-done-open');
    if (await done.count()) await done.click();
    await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  }
  if (page.url().includes('/login/pin')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  }
  log('dashboard url:', page.url());

  // The home screen must actually render its data, not a shell or an access notice.
  await page.getByText('Total Sales').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200); // stores hydrate from Supabase
  const noAccess = await page.getByTestId('no-shop-notice').count();
  if (noAccess) throw new Error('no-shop-notice is present: branch context did NOT resolve');
  const header = await page.locator('header, [data-testid="dashboard-switch-shop"]').first().innerText();
  log('header:', header.replace(/\n/g, ' | '));

  await page.screenshot({ path: `${OUT}/home-screen-working.png` });
  await page.screenshot({ path: `${OUT}/home-screen-working-full.png`, fullPage: true });
  log('screenshots written');

  // Owner flow: the branch list must show the real branches now that QA has 0188-0195.
  await page.getByTestId('dashboard-switch-shop').click();
  await page.waitForTimeout(2500); // branches load via get_my_branches
  const sheetText = await page.locator('body').innerText();
  const branches = ['Main', 'Warehouse'].filter((n) => sheetText.includes(n));
  log('branches visible in switcher:', branches.length ? branches.join(', ') : '(none found)');
  await page.screenshot({ path: `${OUT}/branch-switcher.png` });
  await page.screenshot({ path: `${OUT}/branch-switcher-full.png`, fullPage: true });

  log('DONE');
} catch (err) {
  await page.screenshot({ path: `${OUT}/home-capture-failure.png` }).catch(() => {});
  console.error('[capture-home] FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
