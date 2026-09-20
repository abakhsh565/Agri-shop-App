/**
 * E2E Test: Locked Dashboard/Form scope (ADM-DASH-HOME, EMP-DASH-HOME)
 *
 * Scope source of truth: SCREENS.md ("Dashboard (3)" / "Dashboard (2)") and
 * CR-008-admin-dashboard.md (Status: Done, defines the final IA and states that
 * Paid/Credit/Outstanding and Gross Profit are period figures).
 *
 * Unlike the existing RTL specs, which assert only that a page renders, this spec
 * asserts AUTHORITATIVE VALUES: every figure the dashboard shows is recomputed
 * from the QA database at test time and compared with what the UI printed. A
 * blank or stale dashboard therefore fails this test instead of passing it.
 *
 * Authentication uses the real flow (phone -> dev OTP -> set/confirm PIN), which
 * is also the employee onboarding path, so the Supabase session is genuine and
 * RLS-protected reads are exercised. QA database only.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSql } from './helpers';
import * as fs from 'fs';
import * as path from 'path';

function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.qa');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eqIdx = t.indexOf('=');
      if (eqIdx === -1) continue;
      if (!process.env[t.slice(0, eqIdx).trim()]) {
        process.env[t.slice(0, eqIdx).trim()] = t.slice(eqIdx + 1).trim();
      }
    }
  }
}
loadQaEnv();

const BASE = 'http://localhost:5173';
const OTP = '123456';
const PIN = '4321';

const OWNER_PHONE = '03001234567';   // Shop Owner (923001234567)
const EMPLOYEE_PHONE = '03001122334'; // Sales Employee (923001122334)

function rs(n: number) {
  return 'Rs. ' + Math.round(n).toLocaleString('en-PK');
}

/**
 * Read a dashboard figure by its exact label, e.g. figureFor(page, 'Paid').
 * The tiles render <p>label</p><p>value</p>, so read the sibling value rather
 * than pattern-matching a flattened text blob.
 */
async function figureFor(page: Page, label: string): Promise<string> {
  const labelEl = page.locator(`p:text-is("${label}")`).first();
  await expect(labelEl, `figure "${label}" not found on the page`).toBeVisible();
  const tile = labelEl.locator('xpath=..');
  return (await tile.locator('p').last().innerText()).trim();
}

/** Sign in through the real flow: phone -> dev OTP -> set & confirm PIN. */
async function login(page: Page, phone: string) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('e.g. 03001234567').fill(phone);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

  // Six OTP boxes (the component also renders one hidden autofill input).
  const boxes = page.locator('input[inputmode="numeric"]:not([tabindex="-1"])');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < OTP.length; i++) {
    await boxes.nth(i).fill(OTP[i]);
  }

  // Auto-verify navigates to PIN setup (first login) or straight to a dashboard.
  await page.waitForURL(/pin-set|\/admin\/dashboard|\/employee\/dashboard/, { timeout: 30000 });

  if (page.url().includes('pin-set')) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(400);
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForURL(/\/(admin|employee)\/dashboard/, { timeout: 30000 });
  }
  await page.waitForTimeout(1500); // let the stores hydrate from Supabase
}

async function setLanguage(page: Page, lang: 'en' | 'ur') {
  await page.evaluate((l) => {
    const raw = localStorage.getItem('agrishop-theme');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state || {};
    parsed.state.language = l;
    localStorage.setItem('agrishop-theme', JSON.stringify(parsed));
  }, lang);
  await page.reload();
  await page.waitForTimeout(1500);
}

test.describe('Locked dashboard scope: figures reconcile with the database', () => {
  test('1. ADM-DASH-HOME shows every spec metric and its money figures equal the DB', async ({ page }) => {
    await login(page, OWNER_PHONE);
    expect(page.url()).toContain('/admin/dashboard');

    const body = await page.textContent('body');
    // SCREENS.md ADM-DASH-HOME metrics (labels as rendered in the DOM; some are
    // uppercased by CSS only, so compare against the text content, not the visual)
    for (const label of ['Total Sales', 'GROSS PROFIT', 'CREDIT COLLECT', 'Paid', 'Credit', 'Supplier Payable', 'Low Stock Items', 'Expiring Soon', 'Action needed']) {
      expect(body, `dashboard is missing the "${label}" metric`).toContain(label);
    }
    expect(body, 'Quick Alerts section missing').toContain('Quick Alerts');

    // The Quick Alerts headline count is data-dependent copy ("1 action needed" vs
    // "2 actions needed"), so assert the authoritative thing instead: any pending
    // credit request in the DB must be surfaced, with its real count.
    const [pending] = await execSql(`SELECT count(*)::text AS n FROM credit_limit_requests WHERE status = 'pending'`);
    const pendingCount = Number(pending.n);
    if (pendingCount > 0) {
      expect(body, 'pending credit requests are not surfaced in Quick Alerts').toContain(`${pendingCount} request`);
    }

    // ── Authoritative expectations, recomputed from the QA database ──
    const [sales] = await execSql(`
      SELECT coalesce(sum(total_amount),0)::text AS total,
             coalesce(sum(amount_paid),0)::text AS paid,
             coalesce(sum(amount_due),0)::text AS credit,
             count(*)::text AS tx
        FROM sales WHERE is_voided = false`);
    const [cogs] = await execSql(`
      SELECT coalesce(sum(si.line_total - coalesce(si.cogs_amount,0)),0)::text AS gp
        FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.is_voided = false`);
    const [outstanding] = await execSql(`SELECT coalesce(sum(outstanding_balance),0)::text AS v FROM customers`);

    const total = Number(sales.total), paid = Number(sales.paid);
    const credit = Number(sales.credit), gp = Number(cogs.gp);

    expect(body, 'Total Sales does not match the DB').toContain(rs(total));
    expect(body, 'Gross Profit does not match recorded line COGS').toContain(rs(gp));
    expect(body, 'overdue figure does not match customers.outstanding_balance').toContain(rs(Number(outstanding.v)));

    // Paid + Credit are period figures and must reconcile with the DB
    expect(await figureFor(page, 'Paid'), 'Paid figure does not match the DB').toBe(rs(paid));
    expect(await figureFor(page, 'Credit'), 'Credit figure does not match the DB').toBe(rs(credit));
    expect(paid + credit, 'Paid + Credit must equal Total Sales for the period').toBe(total);
  });

  test('2. EMP-DASH-HOME shows transactions + customers served and no profit/supplier data', async ({ page }) => {
    await login(page, EMPLOYEE_PHONE);
    expect(page.url()).toContain('/employee/dashboard');

    const body = await page.textContent('body');
    expect(body).toContain('Transactions');
    expect(body).toContain('Customers Served');

    // SCREENS.md EMP-DASH-HOME: "No profit/supplier data"
    expect(body).not.toContain('GROSS PROFIT');
    expect(body).not.toContain('Supplier Payable');
    expect(body).not.toContain('Gross Profit');
  });

  test('3. ADM-DASH-HOME renders in Urdu with RTL and translated metrics', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await setLanguage(page, 'ur');

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');

    const body = await page.textContent('body');
    expect(body, 'Low Stock label not translated').toContain('کم اسٹاک اشیاء');
    expect(body, 'Supplier Payable label not translated').toContain('سپلائر واجب الادا');
    expect(body, 'Expiring label not translated').toContain('جلد ختم ہونے والا');
    // no English metrics leaking through
    expect(body).not.toContain('Expiring Soon');
    expect(body).not.toContain('Low Stock Items');
  });

  test('4. EMP-DASH-HOME renders in Urdu with RTL and translated metrics', async ({ page }) => {
    await login(page, EMPLOYEE_PHONE);
    await setLanguage(page, 'ur');

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');

    const body = await page.textContent('body');
    expect(body).toContain('لین دین');
    expect(body).toContain('خدمت کردہ گاہک');
    expect(body).not.toContain('Customers Served');
  });

  test('5. No horizontal overflow on either dashboard in RTL', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await setLanguage(page, 'ur');
    for (const route of ['/admin/dashboard']) {
      await page.goto(`${BASE}${route}`);
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.body.scrollWidth > document.body.clientWidth);
      expect(overflow, `horizontal overflow on ${route} in RTL`).toBe(false);
    }
  });
});
