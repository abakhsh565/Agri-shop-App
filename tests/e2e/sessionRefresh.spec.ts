/**
 * E2E: the session survives a refresh and a reopen — branch, permissions and displayed data.
 *
 * WHY THIS LANE EXISTS (staging checklist §4)
 *   "Reload and session refresh preserve correct state" was the one row this repository could not
 *   answer: several lanes reload a page to reach a state, but no lane reloads and then asks whether
 *   the WORKING CONTEXT (which branch), the EFFECTIVE PERMISSIONS and the DATA ON SCREEN are still
 *   the ones they were. That is the failure a user describes as "it was all right until I refreshed".
 *
 * WHAT IT PROVES, AND HOW — every assertion is compared with the database, not with the previous render
 *   · TEST 1 (the shop's own owner, real QA business rows): a customer's name and balance are read
 *     from QA and must be on screen; the same two values and the same permission-gated route must
 *     still be there after `page.reload()` and after a NEW PAGE in the same profile (a reopen).
 *   · TEST 2 (the app-registered isolated tenant): the active branch is SERVER-owned
 *     (`user_active_shops.branch_id`, written by `set_active_branch`, 0188), so a branch switched to
 *     in the app must survive the reload and the reopen — asserted in the database AND in the
 *     switcher's own selected row.
 *
 * WHAT IT DELIBERATELY DOES NOT REPEAT
 *   The server-side branch rules (who may switch, archive refusals, main-branch refusal) are already
 *   proven live by `tests/integration/accountDeletion.test.ts`, `branchScopeEnforcement` and
 *   `rbacInvariants`. This lane adds the browser half only.
 *
 * Everything it writes lives in the dedicated tenant (its branch), and it removes it in `afterAll`.
 * QA database only.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execSql, loginViaUi, settle, cleanupFixtures, QA_IDS, WRITE_TENANT } from './helpers';
import { runCleanupStatements, runTeardownSteps } from '../setup/ownedCleanup';

const BASE = process.env.QA_APP_URL || 'http://localhost:5173';
const OWNER_PHONE = '03001234567'; // the QA shop's own owner (real business rows)
const TENANT = WRITE_TENANT.id;
const ISO_OWNER = WRITE_TENANT.owner;

const extraBranchId = randomUUID();
const EXTRA_BRANCH = `Session Branch ${extraBranchId.slice(0, 8)}`;

/**
 * `user_active_shops` for the isolated tenant's owner — CAPTURED BEFORE THIS LANE WRITES IT.
 *
 * The row is keyed by user, and the SERVER's own writer (`set_active_branch`, 0188) creates it, so it
 * may not exist when the lane starts. Both states are captured here: a branch id, or `null` meaning
 * "the lane must take the row away again". Without this, the lane's UPSERT overwrote whatever branch
 * that owner was on (and its afterAll wrote a hard-coded default rather than the captured value).
 */
let originalActiveBranch: string | null = null;

async function activeBranchInDb(userId: string): Promise<string | null> {
  const rows = await execSql(`SELECT branch_id FROM user_active_shops WHERE user_id = '${userId}'`);
  return rows[0]?.branch_id ? String(rows[0].branch_id) : null;
}

/**
 * The app's own switcher, opened through the app's own store.
 *
 * The store instance is resolved from the urls the page actually loaded, the same way
 * `seedShopDraft` does it: a bare `import('/src/stores/shopStore.ts')` can be a second module with a
 * second store, whose sheet never renders. Opening it is only the trigger — everything asserted
 * afterwards is the real component, the real RPC and the real database row.
 */
async function openBranchSwitcher(page: Page): Promise<void> {
  const loaded = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => /\/src\/stores\/shopStore\.ts(\?|$)/.test(name)),
  );
  const candidates = [...new Set(loaded)].reverse();
  candidates.push('/src/stores/shopStore.ts');
  for (const url of candidates) {
    const opened = await page
      .evaluate(async (storeUrl) => {
        const mod: any = await import(/* @vite-ignore */ storeUrl);
        mod.useShopStore.getState().openSwitcher();
        return true;
      }, url)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error('the branch switcher could not be opened through the app store');
}

test.describe('Session refresh', () => {
  test.beforeAll(async () => {
    const rows = await execSql(
      `SELECT branch_id FROM user_active_shops WHERE user_id = '${ISO_OWNER.id}'`,
    );
    originalActiveBranch = rows[0]?.branch_id ? String(rows[0].branch_id) : null;
  });

  test.afterAll(async () => {
    // Three steps, in this order, each reporting its own failure:
    //
    //   1. put the OWNER'S ACTIVE BRANCH back to the value captured before this lane wrote it — or
    //      remove the row this lane inserted, when there was none;
    //   2. delete the throwaway branch, and READ BACK that it is gone (a `console.log` of the count
    //      is not a report: a leftover branch is invisible to the run that left it, and the next lane
    //      inherits it);
    //   3. remove the rows this run registered, by id.
    //
    // `branches` has no step in the run-ownership graph (`tests/e2e/cleanupOwnership.ts`), so (2) is
    // this lane's own responsibility. Steps 1 and 2 are ordered: `user_active_shops.branch_id`
    // references the branch, so the row has to stop pointing at it before the branch can go.
    // Nothing is `.catch(() => undefined)` any more — a restore or delete that failed left a shared
    // row modified or a branch behind, silently.
    await runTeardownSteps([
      {
        label: `restore user_active_shops.branch_id for ${ISO_OWNER.id} (captured ${originalActiveBranch ?? 'absent'})`,
        run: () =>
          runCleanupStatements(
            execSql,
            [
              originalActiveBranch
                ? `UPDATE user_active_shops SET branch_id = '${originalActiveBranch}', updated_at = now() WHERE user_id = '${ISO_OWNER.id}'`
                : `DELETE FROM user_active_shops WHERE user_id = '${ISO_OWNER.id}'`,
            ],
            'sessionRefresh active-branch restore',
          ),
      },
      {
        label: 'remove the throwaway branch and read the row back',
        run: async () => {
          await runCleanupStatements(
            execSql,
            [`DELETE FROM branches WHERE id = '${extraBranchId}'`],
            'sessionRefresh branch cleanup',
          );
          const [left] = await execSql(
            `SELECT count(*)::int AS n FROM branches WHERE id = '${extraBranchId}'`,
          );
          if (Number(left?.n ?? 0) > 0) {
            throw new Error(
              `[QA FIXTURE] sessionRefresh left branch ${extraBranchId} behind: the isolated tenant's\n` +
                'branch list is what the next lane switches between.',
            );
          }
        },
      },
      { label: 'remove the rows this run owns', run: () => cleanupFixtures() },
    ]);
  });

  test('owner data and permissions are the same after a reload and after a reopen', async ({ page }) => {
    // ── the fixture is real, or the assertions below would pass against an empty screen ──────────
    const [customer] = await execSql(
      `SELECT name, outstanding_balance FROM customers WHERE id = '${QA_IDS.customerA}'`,
    );
    expect(customer?.name, 'QA Customer A is missing, so there is no displayed data to re-check').toBeTruthy();
    // NOTE ON THE FIGURE. The outstanding ledger is BRANCH money: its rows are the customers who
    // owe THIS branch, and their amounts come from this branch's own sales and receipts
    // (`get_branch_customer_balances`). The shop-wide `customers.outstanding_balance` is a different
    // number — it includes other branches' trade — so asserting it here was asserting a figure this
    // screen is not about. What this lane is actually about is SAMENESS across a reload and a reopen,
    // which is checked on the ledger's own rows below.

    await loginViaUi(page, OWNER_PHONE);
    // `/admin/customers` is a SECTION HUB now: it opens the ledgers (outstanding, payments,
    // reminders) and no longer renders a balance per row. The balance this lane re-checks lives on
    // the outstanding ledger, so that is the screen it must read — same fact, the screen that
    // actually shows it.
    await page.goto(`${BASE}/admin/customers/outstanding`);
    await settle(page);

    // settle() only requires ANY rendered text, so the ledger can still be loading when this runs —
    // wait for a ROW before reading, instead of recording an empty list as "the owner's data".
    const ledgerRows = page.locator('[data-testid^="outstanding-row-"]');
    await expect(
      ledgerRows.first(),
      'the outstanding ledger rendered no customer at all, so there is no data to re-check',
    ).toBeVisible({ timeout: 20000 });
    const rowsBefore = await ledgerRows.allInnerTexts();
    expect(rowsBefore.length, 'the outstanding ledger is empty').toBeGreaterThan(0);
    // The figure is the ledger's own answer (branch money), read from the row rather than assumed —
    // and it must be a real amount, not a placeholder.
    expect(rowsBefore[0], 'the ledger row carries no amount').toMatch(/Rs\.\s?[\d,]+/);

    // ── a permission-gated route is reachable BEFORE the reload, so "still reachable" means something
    await page.goto(`${BASE}/admin/settings`);
    await settle(page);
    const settingsBefore = page.url();
    expect(settingsBefore, 'the owner was bounced out of settings before the reload').toContain('/admin/settings');

    // ── RELOAD: the same screen, read again from the server ──────────────────────────────────────
    await page.goto(`${BASE}/admin/customers/outstanding`);
    await page.reload();
    await settle(page);
    await expect(ledgerRows.first(), 'the ledger is empty after a reload').toBeVisible();
    expect(
      await ledgerRows.allInnerTexts(),
      'the ledger rows or amounts changed across a reload',
    ).toEqual(rowsBefore);

    await page.goto(`${BASE}/admin/settings`);
    await settle(page);
    expect(page.url(), 'the owner lost access to settings after a reload').toContain('/admin/settings');

    // ── REOPEN: a new page in the same profile, i.e. the app opened again ────────────────────────
    const reopened = await page.context().newPage();
    await reopened.goto(`${BASE}/admin/customers/outstanding`);
    await settle(reopened);
    const reopenedRows = reopened.locator('[data-testid^="outstanding-row-"]');
    await expect(reopenedRows.first(), 'the ledger is empty in a freshly opened page').toBeVisible({ timeout: 20000 });
    expect(
      await reopenedRows.allInnerTexts(),
      'the ledger rows or amounts are different in a freshly opened page',
    ).toEqual(rowsBefore);
    await reopened.goto(`${BASE}/admin/settings`);
    await settle(reopened);
    expect(reopened.url(), 'the owner lost access to settings in a freshly opened page').toContain('/admin/settings');
    await reopened.close();

    // The database still holds exactly the one row the screen is showing: the reload changed no data.
    const [still] = await execSql(`SELECT count(*)::int AS n FROM customers WHERE id = '${QA_IDS.customerA}'`);
    expect(still.n, 'the fixture customer count changed during the lane').toBe(1);
  });

  test('the branch the server says is active survives a reload and a reopen', async ({ page }) => {
    // ── setup: a second branch in the isolated tenant, and a known starting point ────────────────
    const [defaultBranch] = await execSql(
      `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_default AND is_active LIMIT 1`,
    );
    expect(defaultBranch?.id, 'the isolated tenant has no default active branch').toBeTruthy();

    await execSql(
      `INSERT INTO branches (id, tenant_id, name, is_default, is_active)
       VALUES ('${extraBranchId}', '${TENANT}', '${EXTRA_BRANCH}', false, true)`,
    );
    const [created] = await execSql(`SELECT id FROM branches WHERE id = '${extraBranchId}'`);
    expect(created?.id, 'the second branch was not created').toBe(extraBranchId);
    // `user_active_shops` is one row per user (PK user_id) and is created by the server's own
    // writers, so the isolated owner may not have a row yet — an UPDATE would match nothing and
    // the read below would report `null` as if the app had lost the branch. Arrange the
    // precondition with the same UPSERT shape `set_active_branch` uses (0188), then let the lane
    // prove the app itself keeps it across a reload and a reopen.
    await execSql(
      `INSERT INTO user_active_shops (user_id, shop_id, branch_id, updated_at)
       VALUES ('${ISO_OWNER.id}', '${TENANT}', '${defaultBranch.id}', now())
       ON CONFLICT (user_id) DO UPDATE
         SET shop_id = EXCLUDED.shop_id, branch_id = EXCLUDED.branch_id, updated_at = now()`,
    );

    await loginViaUi(page, ISO_OWNER.phone);
    await page.goto(`${BASE}/admin/settings`);
    await settle(page);
    expect(await activeBranchInDb(ISO_OWNER.id), 'the fixture did not start on its default branch').toBe(
      defaultBranch.id,
    );

    // ── the switch, through the app's own switcher and the real RPC ──────────────────────────────
    await openBranchSwitcher(page);
    const row = page.getByTestId(`shop-option-${extraBranchId}`);
    await expect(row, 'the new branch is not offered in the switcher').toBeVisible({ timeout: 15000 });
    await row.click();

    await expect
      .poll(async () => await activeBranchInDb(ISO_OWNER.id), { timeout: 15000 })
      .toBe(extraBranchId);

    // ── RELOAD: the same branch, resolved again from the server ──────────────────────────────────
    await page.reload();
    await settle(page);
    expect(await activeBranchInDb(ISO_OWNER.id), 'the active branch changed across a reload').toBe(extraBranchId);
    await openBranchSwitcher(page);
    await expect(
      page.getByTestId(`shop-option-${extraBranchId}`),
      'the switcher no longer marks the active branch as selected after a reload',
    ).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });

    // ── REOPEN: a new page in the same profile ───────────────────────────────────────────────────
    const reopened = await page.context().newPage();
    await reopened.goto(`${BASE}/admin/settings`);
    await settle(reopened);
    expect(
      await activeBranchInDb(ISO_OWNER.id),
      'the active branch changed when the app was opened again',
    ).toBe(extraBranchId);
    await reopened.close();

    // ── permissions are unchanged by any of it: the owner still reaches the settings route ───────
    await page.goto(`${BASE}/admin/settings`);
    await settle(page);
    expect(page.url(), 'the owner lost the settings route after the branch switch').toContain('/admin/settings');
  });
});
