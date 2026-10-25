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
import { test, expect } from './base';
import type { Page } from '@playwright/test';
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

/** A count as the Settings overview prints it: whole, grouped, no currency prefix. */
function figure(n: number) {
  return Math.round(n).toLocaleString('en-PK');
}

/**
 * A rupee amount as the Settings overview prints it: compact K / M, at most two decimals,
 * trailing zeros dropped — the same rule as `formatAmount` in ShopOverviewCard. Written out here
 * so the assertion does not import the implementation it is testing.
 */
function compact(n: number) {
  const amount = Math.round(n);
  const abs = Math.abs(amount);
  const trim = (v: number) => v.toFixed(2).replace(/0+$/, '').replace(/[.]$/, '');
  if (abs >= 1_000_000) return `${trim(amount / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(amount / 1_000)}K`;
  return String(amount);
}

/**
 * The shop's only active branch, or NULL when it has more than one.
 *
 * An operational row that predates branch stamping has no branch_id. 0237 attributes such a
 * row to a branch only when there is exactly one it could belong to; this is the same rule,
 * expressed once for the three helpers below.
 */
function onlyBranchCte(): string {
  return `only_branch AS (
      SELECT (array_agg(b.id))[1] AS id
        FROM branches b
       WHERE b.tenant_id = '${QA_IDS.shop}' AND b.is_active
      HAVING count(*) = 1
    )`;
}

/**
 * A branch's stock value, the way migration 0237 computes it.
 *
 * Deliberately a second implementation: the assertion must not ask the function under test what
 * the answer is. It reads this branch's own net movements from the ledger and values them at
 * today's cost, never below zero — and adds no business-wide remainder. A variant with no
 * movement anywhere was never branch-stamped, so its whole shelf sits on the shop's default
 * branch; that is the one case 0237 attributes stock without a ledger row, and this mirrors it.
 */
async function branchInventoryValue(branchId: string): Promise<number> {
  const [row] = await execSql(`
    WITH ${onlyBranchCte()}, def AS (
      SELECT b.id FROM branches b
       WHERE b.tenant_id = '${QA_IDS.shop}' AND b.is_active
       ORDER BY b.is_default DESC, b.created_at, b.id LIMIT 1
    ), net AS (
      SELECT m.variant_id, sum(m.qty_change) AS qty
        FROM inventory_movements m
        LEFT JOIN only_branch ob ON true
       WHERE m.branch_id = '${branchId}'
          OR (m.branch_id IS NULL AND ob.id = '${branchId}')
       GROUP BY m.variant_id
    ), legacy AS (
      SELECT v.id AS variant_id, v.stock_qty AS qty
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
       WHERE p.shop_id = '${QA_IDS.shop}' AND p.is_active AND v.is_active
         AND v.stock_qty > 0
         AND (SELECT id FROM def) = '${branchId}'
         AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.variant_id = v.id)
    ), every AS (
      SELECT * FROM net UNION ALL SELECT * FROM legacy
    )
    SELECT coalesce(sum(n.qty * pv.cost_price)
             FILTER (WHERE n.qty > 0 AND pv.cost_price > 0), 0)::text AS value
      FROM every n
      JOIN product_variants pv ON pv.id = n.variant_id
      JOIN products p ON p.id = pv.product_id
     WHERE p.is_active AND pv.is_active AND p.shop_id = '${QA_IDS.shop}'`);
  return Number(row.value);
}

/**
 * A branch's receivables, the way migration 0237 computes it: billed there, collected there,
 * never negative. Money recorded at another branch does not enter this one's figure, and a
 * customer balance the ledgers cannot place is not invented on main.
 */
async function branchCreditOutstanding(branchId: string): Promise<number> {
  const [row] = await execSql(`
    WITH ${onlyBranchCte()}
    SELECT greatest(
      coalesce((SELECT sum(s.amount_due) FROM sales s
                 LEFT JOIN only_branch ob ON true
                 WHERE s.shop_id = '${QA_IDS.shop}' AND s.is_voided = false
                   AND (s.branch_id = '${branchId}'
                        OR (s.branch_id IS NULL AND ob.id = '${branchId}'))), 0)
      - coalesce((SELECT sum(cp.amount) FROM customer_payments cp
                    JOIN customers c ON c.id = cp.customer_id
                    LEFT JOIN only_branch ob ON true
                   WHERE c.shop_id = '${QA_IDS.shop}' AND c.is_archived = false
                     AND (cp.branch_id = '${branchId}'
                          OR (cp.branch_id IS NULL AND ob.id = '${branchId}'))), 0), 0)::text AS value`);
  return Number(row.value);
}

/**
 * How many people work at a branch, the way migration 0237 computes it.
 *
 * Written out here rather than taken from the function under test: active, non-owner members
 * the roster ties to this branch — an explicit scope entry or an explicit per-branch role row
 * (the map 0233 introduced). Owners are not "employees": the team screen tags them Owner, and
 * counting them at every branch inflated a two-owner shop by two on every branch. Nobody is
 * moved onto a branch to make the shop's roster add up; a member scoped nowhere counts nowhere.
 * Suspended and invited accounts are not counted.
 */
async function branchStaffCount(branchId: string): Promise<number> {
  const [row] = await execSql(`
    SELECT count(DISTINCT m.user_id)::int::text AS value
      FROM memberships m
     WHERE m.tenant_id = '${QA_IDS.shop}' AND m.status = 'active' AND m.role <> 'owner'
       AND ('${branchId}' = ANY(COALESCE(m.branch_scope, '{}'::uuid[]))
            OR EXISTS (SELECT 1 FROM membership_branch_roles mbr
                        WHERE mbr.membership_id = m.id
                          AND mbr.branch_id = '${branchId}'))`);
  return Number(row.value);
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

/**
 * One of the app's live zustand stores, read in the page's own module graph.
 *
 * `page.evaluate` sees the same module instances the app renders from: after an HMR update the
 * dev server serves the module under a `?t=` url, so the newest url the page has already
 * fetched is preferred, with the plain path as the fallback for a cold module map. Returns
 * undefined while no candidate can be reached, so callers poll instead of guessing at a wait.
 */
async function readStoreState(page: Page, storeName: string, modulePath: string): Promise<any | undefined> {
  return page.evaluate(
    async ({ storeName, modulePath }) => {
      const loaded = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes(modulePath));
      const candidates = [...new Set(loaded)].reverse();
      candidates.push(modulePath);
      for (const url of candidates) {
        try {
          const mod: any = await import(/* @vite-ignore */ url);
          const store = mod[storeName];
          if (store && typeof store.getState === 'function') return store.getState();
        } catch {
          // Not the app's instance — the next candidate may be.
        }
      }
      return undefined;
    },
    { storeName, modulePath },
  );
}

/**
 * Switch the working branch the way the header's branch sheet does — through the store's own
 * action, so the real `set_active_branch` RPC runs rather than a mocked one.
 */
async function switchBranchInApp(page: Page, branchId: string): Promise<any> {
  return page.evaluate(
    async ({ branchId }) => {
      const loaded = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('/src/stores/shopStore.ts'));
      const candidates = [...new Set(loaded)].reverse();
      candidates.push('/src/stores/shopStore.ts');
      for (const url of candidates) {
        try {
          const mod: any = await import(/* @vite-ignore */ url);
          const store = mod.useShopStore;
          if (store && typeof store.getState === 'function') {
            return await store.getState().switchBranch(branchId);
          }
        } catch {
          // Not the app's instance — the next candidate may be.
        }
      }
      return { ok: false, code: 'store_unreachable' };
    },
    { branchId },
  );
}

/**
 * The branch Home is actually working in — read from the running app, never re-derived.
 *
 * `activeBranchId` comes from `get_my_branches()`, whose `is_current` column is
 * `(b.id = current_branch_id())` in the database, and that same function backs the
 * RESTRICTIVE `sales_branch_select` policy on `sales`. So this value is exactly the branch
 * whose sales the dashboard can read and sum, and reading it here cannot drift from the
 * database's precedence (selected branch → default → oldest) the way a second SQL copy of
 * that rule would.
 *
 * A shop with no current branch is handled explicitly: the RLS scope is then empty, the
 * dashboard legitimately shows zero sales, and this spec — which asserts figures — has no
 * valid expectation to hold it to, so it fails here by name instead of inventing a fallback.
 */
async function readActiveBranch(page: Page): Promise<string> {
  let branchId: string | null | undefined;
  await expect
    .poll(
      async () => {
        const state = await readStoreState(page, 'useShopStore', '/src/stores/shopStore.ts');
        branchId = state?.branchesLoaded ? (state.activeBranchId ?? null) : undefined;
        return branchId;
      },
      {
        timeout: 20_000,
        message:
          'the shop store never finished loading branches, so which branch Home is showing cannot be known',
      },
    )
    .not.toBeUndefined();

  if (!branchId) {
    throw new Error(
      'the shop store resolved no current branch: the database branch scope is empty, so RLS denies every sales row and Home can only show zero sales. This spec asserts figures and needs a shop with an active branch.',
    );
  }
  return branchId;
}

/**
 * The fallback half of the COGS reading lives in the products store: a line whose snapshot is
 * NULL is priced from the ACTIVE variant's current cost, and until that store is ready the
 * screen itself cannot know those lines — the three-state classification below would then be
 * read from a half-loaded app. Wait for it, bounded, before judging the figure.
 */
async function waitForProductsReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await readStoreState(page, 'useProductsStore', '/src/stores/productsStore.ts');
        return state?.ready === true;
      },
      {
        timeout: 20_000,
        message: 'the products store never became ready, so a line without a cost snapshot cannot be priced',
      },
    )
    .toBe(true);
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
    //
    // THE AGGREGATE CARRIES THE SCREEN'S OWN SCOPE — shop AND branch — because `execSql` runs
    // as the service role and bypasses RLS entirely. Home reads `useSalesStore().sales`, an
    // unfiltered `select` narrowed by RLS to the caller's shop and to the single branch the
    // RESTRICTIVE `sales_branch_select` policy allows; `activeBranchId`, read above, is the
    // value that policy's `current_branch_id()` resolves to. Without these two predicates the
    // gate compares the hero figure against every tenant's — and every branch's — sales, so
    // the moment another shop (or a concurrent lane's tenant, or the shop's other branch)
    // holds a live sale the dashboard can never show that total and the test reports
    // "stayed un-hydrated": the wrong diagnosis. Observed 2026-10-14 and 2026-10-16.
    const activeBranch = await readActiveBranch(page);
    const [gateSales] = await execSql(
      `SELECT coalesce(sum(total_amount),0)::text AS total FROM sales
        WHERE is_voided = false
          AND shop_id = '${QA_IDS.shop}'
          AND branch_id = '${activeBranch}'`,
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

    // Shop overview moved to Settings on 2026-10-25, and all three of its figures follow the branch
    // the account is working in (0233 for the branch model, 0237 for the three figures), so it must not sit on
    // Home, whose figures follow the date pill. Asserted as gone from Home first, then read off
    // Settings against the branch's own ledger — never inferred from the labels.
    await expect(
      page.getByTestId('shop-overview'),
      'the branch overview is still on Home; it belongs to Settings',
    ).toHaveCount(0);
    await page.goto(`${BASE}/admin/settings`);
    await expect(page.getByTestId('shop-overview')).toBeVisible();
    // RE-READ THE BRANCH HERE. A full navigation re-resolves the working branch from the server,
    // so the branch captured on Home two navigations ago is not necessarily the branch this page
    // shows — observed 2026-10-25: Home read "Malik agro", Settings rendered "Default Shop - Main",
    // and the assertion below then compared the card against the wrong branch's ledger. The figures
    // are still checked against the database, not against the screen.
    const settingsBranch = await readActiveBranch(page);
    // The staff figure is the branch's, by the same rule `get_my_branches()` uses (0237): the
    // shop's active, non-owner members the roster ties to this branch — explicit scope or an
    // explicit per-branch role row. Nothing is carried onto main to make the roster add up, and
    // owners are not employees. Two branches that both scope the same person each count them:
    // the card answers "how many people work here", not how many the business employs.
    // Suspended and invited accounts are not counted.
    const activeEmployees = await branchStaffCount(settingsBranch);
    // Stock and credit are the branch's own, read from the ledgers it stamped (0237). No
    // business-wide remainder is added to any branch; only a variant with no movement anywhere
    // is placed whole on the default branch, because the ledger never saw where it went.
    const inventoryValue = await branchInventoryValue(settingsBranch);
    const creditValue = await branchCreditOutstanding(settingsBranch);
    // The card no longer captions itself with the branch name (owner's correction, 2026-10-25);
    // the values are what prove it is speaking for `settingsBranch`, and each is expected from
    // that branch's own rows, not from whatever the previous branch happened to hold.
    await expect(page.getByTestId('shop-overview-inventory')).toContainText(compact(inventoryValue));
    await expect(page.getByTestId('shop-overview-employees')).toHaveText(figure(activeEmployees));
    await expect(page.getByTestId('shop-overview-credit')).toHaveText(compact(creditValue));
    await expect(page.getByTestId('shop-overview-invite')).toBeVisible();

    // BACK TO HOME. Everything below is about the dashboard — the removed cards, Quick Alerts
    // and the hero figures — and this test left it to read Settings. Without this the
    // `home-gross-profit` assertion below looked for a Home test id on the Settings page and
    // failed as "element not found", naming the wrong thing entirely (observed 2026-10-25).
    // Hydration starts again on the remount, so the same data gate is re-applied instead of
    // trusting a stopwatch.
    await page.goto(`${BASE}/admin/dashboard`);
    await expect
      .poll(async () => (await page.textContent('body')) ?? '', {
        timeout: 30_000,
        message: `the dashboard did not come back with the DB total ${rs(Number(gateSales.total))}`,
      })
      .toContain(rs(Number(gateSales.total)));

    // The five removed cards must be gone from Home. Asserted per tile rather
    // than against the page text, because "Credit collect" legitimately contains
    // the word Credit — a blob check would pass on a card that is still there.
    for (const gone of ['Paid', 'Credit', 'Supplier Payable', 'Low Stock Items', 'Expiring Soon']) {
      await expect(
        page.locator(`p:text-is("${gone}")`),
        `the "${gone}" card is still on Home`,
      ).toHaveCount(0);
    }

    // The Quick Alerts headline count is data-dependent copy ("1 action needed" vs
    // "2 actions needed"), so assert the authoritative thing instead: any pending
    // credit request in the DB must be surfaced, with its real count.
    // The RLS policy on `credit_limit_requests` scopes a row through its customer's shop
    // (0115), so the app's count is this shop's pending requests; an unscoped service-role
    // count mixes every tenant in and can demand a number Home must not show.
    const [pending] = await execSql(`
      SELECT count(*)::text AS n
        FROM credit_limit_requests r
       WHERE r.status = 'pending'
         AND EXISTS (SELECT 1 FROM customers c
                      WHERE c.id = r.customer_id AND c.shop_id = '${QA_IDS.shop}')`);
    const pendingCount = Number(pending.n);
    if (pendingCount > 0) {
      expect(body, 'pending credit requests are not surfaced in Quick Alerts').toContain(`${pendingCount} request`);
    }

    // ── Authoritative expectations, recomputed from the QA database ──
    // Same scope as the screen: one shop, one branch. Only the figures Home actually prints
    // are read here — Home prints Total Sales and Gross Profit from this sale set, while
    // "Credit collect" is a sum of `customer_payments` (src/lib/money.ts), not a column of
    // `sales`, so a paid/credit aggregate would be a different quantity wearing the same name.
    // (The unused paid, credit and transaction columns were removed for that reason.)
    const [sales] = await execSql(`
      SELECT coalesce(sum(total_amount),0)::text AS total
        FROM sales
       WHERE is_voided = false
         AND shop_id = '${QA_IDS.shop}'
         AND branch_id = '${activeBranch}'`);
    // COGS covers exactly the sales the revenue above covers, and it reads each line the way
    // the screen reads it (src/lib/profit.ts `lineCogs`): a recorded snapshot is used when it
    // is above zero, a NULL snapshot alone falls back to the ACTIVE variant's current cost,
    // and everything else is UNKNOWN — never zero. The old `coalesce(cogs_amount, 0)` turned an
    // unrecorded cost into a free item, exactly the flattering arithmetic migration 0159 and
    // profit.ts exist to forbid. Revenue and COGS stay in separate statements: joining
    // `sale_items` into the revenue query would multiply every sale by its line count.
    const [cogs] = await execSql(`
      WITH line_cogs AS (
        SELECT CASE
                 WHEN si.cogs_amount IS NOT NULL THEN NULLIF(si.cogs_amount, 0)
                 WHEN pv.cost_price > 0 AND p.is_active AND pv.is_active
                   THEN pv.cost_price * si.qty
                 ELSE NULL
               END AS cogs
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          LEFT JOIN product_variants pv ON pv.id = si.variant_id
          LEFT JOIN products p ON p.id = pv.product_id
         WHERE s.is_voided = false
           AND s.shop_id = '${QA_IDS.shop}'
           AND s.branch_id = '${activeBranch}'
      )
      SELECT count(*)::text AS lines,
             count(*) FILTER (WHERE cogs IS NULL)::text AS unknown_lines,
             coalesce(sum(cogs),0)::text AS cogs_known
        FROM line_cogs`);
    // Overdue is the shop-wide business metric: the REMAINING balance of every credit whose
    // due date has already passed in Pakistan time — every customer of this shop, not one
    // customer's outstanding and not other tenants' customers. `customers` has no branch
    // column in the branch-scope policy (0212), so its RLS scope is the shop, and the
    // predicate itself is `isCreditOverdue` (src/lib/signalEngine.ts) written in SQL.
    const [pastDue] = await execSql(`
      SELECT coalesce(sum(outstanding_balance),0)::text AS overdue,
             count(*)::text AS n
        FROM customers
       WHERE shop_id = '${QA_IDS.shop}'
         AND is_archived = false
         AND outstanding_balance > 0
         AND due_date IS NOT NULL
         AND due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Karachi')::date`);
    const [allOutstanding] = await execSql(
      `SELECT coalesce(sum(outstanding_balance),0)::text AS v FROM customers
        WHERE is_archived = false AND shop_id = '${QA_IDS.shop}'`,
    );

    const total = Number(sales.total);
    const cogsKnown = Number(cogs.cogs_known);
    const unknownLines = Number(cogs.unknown_lines);
    const pricedLines = Number(cogs.lines);

    expect(body, 'Total Sales does not match the DB').toContain(rs(total));

    // Gross Profit is deliberately three-state (src/lib/profit.ts `profitDisplay`): exact when
    // every line has a usable cost, "≥" when some do not, and "—" when none does. Assert the
    // state the data justifies — the figure the screen is allowed to show — instead of
    // re-adding the unknown lines as zero.
    const grossProfit = page.getByTestId('home-gross-profit');
    await waitForProductsReady(page);
    if (unknownLines === 0) {
      await expect(
        grossProfit,
        'Gross Profit does not match revenue minus the recorded line costs',
      ).toHaveText(rs(total - cogsKnown));
    } else if (unknownLines === pricedLines) {
      await expect(
        grossProfit,
        'no line has a known cost, so Home must show no profit figure at all',
      ).toHaveText('—');
    } else {
      await expect(
        grossProfit,
        'Gross Profit must be labelled as a floor while some line costs are unknown',
      ).toHaveText(`≥ ${rs(total - cogsKnown)}`);
    }

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
    // The overview is not on Home any more, so its Urdu labels are checked where it now lives.
    expect(body).not.toContain('ملازم کو مدعو کریں اور رسائی مقرر کریں');
    await page.goto(`${BASE}/admin/settings`);
    const settingsBody = await page.textContent('body');
    expect(settingsBody, 'the overview lost its Urdu invitation line').toContain('ملازم کو مدعو کریں اور رسائی مقرر کریں');
    expect(settingsBody, 'the overview lost its Urdu credit label').toContain('کل ادھار');
    await expect(
      page.getByTestId('shop-overview-invite'),
      'the Invite button is not translated',
    ).toHaveText('مدعو کریں');
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

  test('7. the Settings overview follows the branch the account switches into', async ({ page }) => {
    // The owner's actual complaint: the three figures did not change when the branch did. This
    // switches through the app's own action (the real RPC), then reads the card against the
    // second branch's ledger — so a card that still reports the first branch fails by name and
    // by number, not by inference.
    await login(page, OWNER_PHONE);
    await page.goto(`${BASE}/admin/settings`);
    await expect(page.getByTestId('shop-overview')).toBeVisible();

    const first = await readActiveBranch(page);
    const others = await execSql(`
      SELECT id, name FROM branches
       WHERE tenant_id = '${QA_IDS.shop}' AND is_active AND id <> '${first}'
       ORDER BY is_default, created_at, id LIMIT 1`);
    if (others.length === 0) {
      test.skip(true, 'the QA shop has one branch, so there is no second branch to switch into');
      return;
    }
    const other = others[0] as { id: string; name: string };

    try {
      const switched = await switchBranchInApp(page, other.id);
      expect(switched?.ok, `the app refused the branch switch: ${switched?.code ?? 'unknown'}`).toBe(true);

      await page.goto(`${BASE}/admin/settings`);
      // The switch is proven by the figures moving to `other`'s ledger, not by a caption: the
      // card no longer repeats the branch name.
      await expect(page.getByTestId('shop-overview-inventory'))
        .toContainText(compact(await branchInventoryValue(other.id)));
      await expect(page.getByTestId('shop-overview-credit'))
        .toHaveText(compact(await branchCreditOutstanding(other.id)));
      const staff = await branchStaffCount(other.id);
      await expect(page.getByTestId('shop-overview-employees')).toHaveText(figure(staff));
    } finally {
      // Leave the QA account in the branch it was found in.
      await switchBranchInApp(page, first);
    }
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
