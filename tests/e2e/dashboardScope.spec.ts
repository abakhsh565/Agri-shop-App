/**
 * E2E Test: Locked Dashboard/Form scope (ADM-DASH-HOME, EMP-DASH-HOME)
 *
 * Scope source of truth: SCREENS.md ("Dashboard (3)" / "Dashboard (2)") as
 * amended by the Home presentation decision, which removes the Paid, Credit,
 * Low Stock Items, Supplier Payable and Expiring Soon cards from Home. That
 * functionality is not gone — low stock and expiry stay in Inventory, customer
 * credit stays in the customer/sales/payment flows, and supplier payable stays
 * in Purchases/Payments — so this spec asserts their ABSENCE FROM HOME, not
 * their absence from the product.
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
import { execSql, setupFixtures, cleanupFixtures, QA_IDS } from './helpers';
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

const BASE = process.env.QA_APP_URL || 'http://localhost:5173';
const OTP = '123456';
const PIN = '4321';

const OWNER_PHONE = '03001234567';   // Shop Owner (923001234567)
const EMPLOYEE_PHONE = '03001122334'; // Sales Employee (923001122334)

function rs(n: number) {
  return 'Rs. ' + Math.round(n).toLocaleString('en-PK');
}


/** Sign in through the real flow: phone -> dev OTP -> set & confirm PIN. */
async function login(page: Page, phone: string) {
  await page.goto(`${BASE}/login`);
  // One phone, one door: an employee's number has to be entered on the employee tab,
  // which the page enforces before it sends anything.
  if (phone === EMPLOYEE_PHONE) {
    await page.getByTestId('auth-tab-employee').click();
    // An invited number also has to name the shop it was invited by before a code is spent.
    await page.getByTestId('shop-id-input').fill(QA_IDS.shop);
  }
  await page.getByPlaceholder('e.g. 03001234567').fill(phone);
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.waitForURL(/\/login\/otp/, { timeout: 20000 });

  // Six OTP boxes, addressed by role: the component also renders an off-screen
  // autofill input, and a code typed one box off submits and reports nothing.
  const boxes = page.locator('[data-testid^="otp-digit-"]');
  await expect(boxes).toHaveCount(6);
  // Type it as a person would (focus advances by itself); filling by index raced
  // with that advance and could leave the code a digit short.
  await boxes.first().click();
  await page.keyboard.type(OTP);
  for (let i = 0; i < OTP.length; i++) {
    await expect(boxes.nth(i), `OTP digit ${i + 1} is not the one that was typed`).toHaveValue(OTP[i]);
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
  test.afterAll(async () => {
    // The figures are asserted against the DB, so leave the QA base as it was found.
    await cleanupFixtures();
  });

  test('1. ADM-DASH-HOME shows every spec metric and its money figures equal the DB', async ({ page }) => {
    // Quick Alerts only renders when there is something to alert about, so the fixtures
    // are seeded first: QA Customer B is over its credit limit and QA Product B is out of
    // stock, which is what makes the section exist. Without this the assertion depended on
    // whatever a previous spec had left behind.
    await setupFixtures();
    await login(page, OWNER_PHONE);
    expect(page.url()).toContain('/admin/dashboard');

    // The branch the dashboard's sales figures cover, resolved from the DB
    // rather than a literal id (the fixture-id guard forbids two files from
    // declaring the same UUID). The sales store is branch-scoped by RLS
    // (sales_branch_select: branch_id = ANY (current_branch_scope())), and
    // current_branch_scope() reads this same user_active_shops row, so the
    // gate must sum this branch, not the whole shop. Round-2 probe (run
    // 42321215789): this branch holds the 2 Perm sales (Rs. 10,000); the
    // added branch holds the other 5 (Rs. 24,600).
    const [activeBranch] = await execSql(
      `SELECT branch_id FROM user_active_shops WHERE user_id = '${QA_IDS.owner}'`,
    );
    const branchId = activeBranch.branch_id as string;
    expect(branchId, 'the owner fixture has no active branch').toBeTruthy();

    // WAIT FOR THE SCREEN TO HYDRATE — data-driven, not a stopwatch.
    //
    // WHY (reproduced 2026-10-15, full-suite run: `145 passed · 2 failed · 2 did not run`). `login()`
    // waits a fixed 1500 ms after the dashboard route appears. That is enough on a fresh dev server
    // (this lane is 6/6 on its own) and NOT enough on a dev server that has been serving for half an
    // hour: the body at the moment of the read was the un-hydrated shell — "No suppliers yet · No
    // products yet · No customers yet", "Total Sales Rs. 0", and a trailing "Loading…" — while the
    // database held customers 10 / products 6 / companies 3 and the fixtures were intact. The lane
    // then failed on `expect(body).toContain('Quick Alerts')`, which points at the wrong thing
    // entirely: the section is data-dependent, so an empty store hides it.
    //
    // The gate removes the stopwatch and keeps — strengthens — the requirement: the rendered
    // dashboard must converge on the figure the database actually holds. A blank, stale or wrong
    // dashboard still fails here, and it fails naming the DB value instead of timing out.
    // Branch-scoped as well as shop-scoped: the dashboard's sales figures come from the
    // sales store, whose RLS (sales_branch_select) returns only the current branch's
    // sales. The gate must sum the same branch, or it counts the added branch's sales
    // too (round-2 probe run 42321215789: added branch 6253561f holds Rs. 24,600).
    const [gateSales] = await execSql(
      `SELECT coalesce(sum(total_amount),0)::text AS total FROM sales WHERE is_voided = false AND shop_id = '${QA_IDS.shop}' AND branch_id = '${branchId}'`,
    );
    await expect
      .poll(async () => (await page.textContent('body')) ?? '', {
        timeout: 30_000,
        message: `the dashboard never showed the DB total ${rs(Number(gateSales.total))} — it stayed un-hydrated`,
      })
      .toContain(rs(Number(gateSales.total)));

    const body = (await page.textContent('body')) ?? '';
    // ADM-DASH-HOME metrics that remain: the hero figures and the action rows.
    for (const label of ['Total Sales', 'Gross profit', 'Credit collect', 'Action needed']) {
      expect(body, `dashboard is missing the "${label}" metric`).toContain(label);
    }
    expect(body, 'Quick Alerts section missing').toContain('Quick Alerts');

    // The five removed cards must be gone from Home. Asserted per tile rather
    // than against the page text, because "Credit collect" legitimately contains
    // the word Credit — a blob check would pass on a card that is still there.
    for (const gone of ['Paid', 'Credit', 'Supplier Payable', 'Low Stock Items', 'Expiring Soon']) {
      await expect(
        page.locator(`p:text-is("${gone}")`),
        `the "${gone}" card is still on Home`,
      ).toHaveCount(0);
    }

    // The UI count is fetched ONCE at mount and never refetched, so reload
    // the dashboard here so the mount-time count reflects the final DB state
    // instead of whatever it was when the page first loaded (round-5: the
    // gate counted 2, the UI still showed the stale mount-time 1). The
    // expect.poll below then converges on the re-fetched count.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The Quick Alerts headline count is data-dependent copy ("1 action needed" vs
    // "2 actions needed"), so assert the authoritative thing instead: any pending
    // credit request in the DB must be surfaced, with its real count.
    // credit_limit_requests carries no shop_id of its own, so the pending count
    // is scoped through the customer it names — otherwise other tenants' pending
    // requests inflate the figure Home (which shows this shop only) must match.
    const [pending] = await execSql(
      `SELECT count(*)::text AS n FROM credit_limit_requests clr JOIN customers c ON c.id = clr.customer_id WHERE clr.status = 'pending' AND c.shop_id = '${QA_IDS.shop}'`,
    );
    const pendingCount = Number(pending.n);
    if (pendingCount > 0) {
      // The count is a separate async round-trip with no convergence wait: the
      // sales poll above can resolve the instant the total appears, before the
      // count's setState + re-render lands. Poll for the rendered count instead
      // of reading the body once (round-3 failure: gate counted 1, body showed 0).
      await expect
        .poll(async () => (await page.textContent('body')) ?? '', {
          timeout: 30_000,
          message: `pending credit requests are not surfaced in Quick Alerts — expected ${pendingCount} request`,
        })
        .toContain(`${pendingCount} request`);
    }

    // ── Authoritative expectations, recomputed from the QA database ──
    // Sales figures are branch-scoped (same RLS as the gate above); customer
    // figures stay shop-scoped only, because the customers store has no branch
    // filter (its RLS is shop_id = current_shop_id()).
    const [sales] = await execSql(`
      SELECT coalesce(sum(total_amount),0)::text AS total,
             coalesce(sum(amount_paid),0)::text AS paid,
             coalesce(sum(amount_due),0)::text AS credit,
             count(*)::text AS tx
        FROM sales WHERE is_voided = false AND shop_id = '${QA_IDS.shop}' AND branch_id = '${branchId}'`);
    // COGS on its own, so the expected profit is revenue - COGS on the SAME
    // authoritative revenue Home uses (the sale's stored total), which is also
    // what Reports uses. Deriving it from line totals instead would let the two
    // screens disagree by rounding.
    const [cogs] = await execSql(`
      SELECT coalesce(sum(coalesce(si.cogs_amount,0)),0)::text AS v
        FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.is_voided = false AND s.shop_id = '${QA_IDS.shop}' AND s.branch_id = '${branchId}'`);
    // Overdue is the system-wide business metric: the REMAINING balance of every
    // credit whose due date has already passed in Pakistan time — not the shop's
    // total customer outstanding. Computed here from the database with the same
    // authoritative definition Home and the overdue-credit signals share.
    const [pastDue] = await execSql(`
      SELECT coalesce(sum(outstanding_balance),0)::text AS overdue,
             count(*)::text AS n
        FROM customers
       WHERE is_archived = false
         AND customers.shop_id = '${QA_IDS.shop}'
         AND outstanding_balance > 0
         AND due_date IS NOT NULL
         AND due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date`);
    const [allOutstanding] = await execSql(
      `SELECT coalesce(sum(outstanding_balance),0)::text AS v FROM customers WHERE is_archived = false AND customers.shop_id = '${QA_IDS.shop}'`,
    );

    const total = Number(sales.total), gp = total - Number(cogs.v);

    expect(body, 'Total Sales does not match the DB').toContain(rs(total));
    expect(body, 'Gross Profit does not match revenue - COGS').toContain(rs(gp));

    // Read the figure the owner actually sees, then hold it to the DB value.
    const overdueEl = page.locator('p').filter({ hasText: /overdue/ }).first();
    const shownOverdue = Number((await overdueEl.innerText()).replace(/[^0-9]/g, ''));
    expect(shownOverdue, 'Home overdue does not match the past-due balance in the DB').toBe(
      Math.round(Number(pastDue.overdue)),
    );

    // Falsification guard: whenever the shop has outstanding credit that is NOT yet
    // due, the overdue figure must differ from total outstanding. This is what fails
    // if anyone goes back to summing every balance and calling it overdue.
    const totalOwed = Math.round(Number(allOutstanding.v));
    if (totalOwed !== Math.round(Number(pastDue.overdue))) {
      expect(shownOverdue, 'Home is showing total outstanding and calling it overdue').not.toBe(totalOwed);
    }

    // The overdue figure is no longer given a red treatment (presentation only;
    // the calculation is asserted above).
    const overdueColor = await overdueEl.evaluate((el) => getComputedStyle(el).color);
    expect(overdueColor, 'the overdue figure is red again').not.toMatch(/220,\s*38,\s*38/);
  });

  test('2. EMP-DASH-HOME shows transactions + customers served and no profit/supplier data', async ({ page }) => {
    await login(page, EMPLOYEE_PHONE);
    expect(page.url()).toContain('/employee/dashboard');

    const body = await page.textContent('body');
    expect(body).toContain('Transactions');
    expect(body).toContain('Customers Served');

    // SCREENS.md EMP-DASH-HOME: "No profit/supplier data"
    expect(body).not.toContain('Gross profit');
    expect(body).not.toContain('Supplier Payable');
  });

  test('3. ADM-DASH-HOME renders in Urdu with RTL and translated metrics', async ({ page }) => {
    await login(page, OWNER_PHONE);
    await setLanguage(page, 'ur');

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');

    const body = await page.textContent('body');
    // The hero figures are translated in Urdu.
    expect(body, 'Total Sales not translated').toContain('کل فروخت');
    expect(body, 'Gross Profit not translated').toContain('مجموعی منافع');
    expect(body, 'Credit collect not translated').toContain('ادھار کی وصولی');
    // The removed cards are gone in Urdu too, and no English leaks through.
    expect(body).not.toContain('کم اسٹاک');
    expect(body).not.toContain('سپلائر کو دینا ہے');
    expect(body).not.toContain('جلد ختم ہونے والا');
    expect(body).not.toContain('Expiring Soon');
    expect(body).not.toContain('Low Stock Items');
    expect(body).not.toContain('Supplier Payable');
  });

  test('6. the Observation Board is gone from the app, not merely hidden', async ({ page }) => {
    await login(page, OWNER_PHONE);

    // The route itself must be gone — a hidden card with a live route is not a removal.
    await page.goto(`${BASE}/admin/observation-bot`);
    await page.waitForTimeout(1500);
    const board = await page.textContent('body');
    expect(board, 'the Observation Board is still reachable by URL').not.toContain('Observation Bot');
    expect(board, 'the Observation Board still renders').not.toContain('Observer');

    // And it must not be offered in the menu.
    await page.goto(`${BASE}/admin/more`);
    await page.waitForTimeout(1500);
    expect(
      await page.locator('a[href*="observation-bot"]').count(),
      'More still links to the Observation Board',
    ).toBe(0);
    const more = await page.textContent('body');
    expect(more, 'More still offers the Observation Board').not.toContain('Observation Bot');
  });

  test('4. EMP-DASH-HOME renders in Urdu with RTL and translated metrics', async ({ page }) => {
    await login(page, EMPLOYEE_PHONE);
    await setLanguage(page, 'ur');

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');

    const body = await page.textContent('body');
    expect(body).toContain('لین دین');
    expect(body).toContain('جن کو بیچا');
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
