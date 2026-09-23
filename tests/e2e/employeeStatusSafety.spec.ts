/**
 * E2E: taking an employee's access away — and giving it back — fires exactly once.
 *
 * REPORTED BY THE PRODUCT OWNER, twice, in different places: "once I create a sale and
 * double-click confirm, it's created twice in the system but it is only one sale… this
 * kind of issues as well". The sale, the void, the supplier payment and the stock
 * adjustment were all fixed. Deactivating an employee was not, and it is the most
 * consequential of the family: it revokes someone's ability to sign in.
 *
 * The guard on that confirmation used React STATE (`statusBusy`). React batches, so
 * two clicks dispatched in the same task both read the pre-render value `false` and
 * both reach the RPC. The database then refuses the second one with
 * ALREADY_DEACTIVATED, so the owner is shown an ERROR immediately after an action that
 * actually succeeded — the exact misinformation fixed on the void dialog.
 *
 * The two clicks are dispatched in ONE JavaScript task on purpose: that is the only
 * faithful reproduction of a double tap. Two awaited Playwright clicks are not — the
 * browser re-renders and disables the button in between, and the bug disappears. The
 * assertion is on the number of RPCs that actually left the browser and on the
 * database, never on button state. The spec also refuses to run if the button is
 * already disabled before the second tap, so it cannot pass by proving nothing.
 *
 * Also covered: the confirmation says what it does (and "are you sure?" is gone),
 * Cancel sends nothing at all, the state survives a reload, and deactivating does not
 * erase the employee's history — their past sale stays attributed to them.
 *
 * QA database only; everything this spec creates is deleted again.
 */
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { QA_IDS, execSql, setupFixtures, cleanupFixtures, injectAdminAuth } from './helpers';

const BASE_URL = 'http://localhost:5173';
const EMP = QA_IDS.employee;
const EMP_NAME = 'QA Employee';

// A sale attributed to this employee, standing in for their work history.
const HIST_SALE_ID = randomUUID();
const HIST_SALE_NUMBER = `QA-STATUS-${Date.now().toString(36).toUpperCase()}`;

// ── database helpers ────────────────────────────────────────────────────────

async function setActiveState(active: boolean) {
  await execSql(
    `UPDATE users SET is_active = ${active}, deactivated_at = ${active ? 'NULL' : 'now()'}
     WHERE id = '${EMP}'`
  );
  await execSql(
    `UPDATE memberships SET status = '${active ? 'active' : 'suspended'}', updated_at = now()
     WHERE user_id = '${EMP}'`
  );
}

async function readState() {
  const rows = await execSql(`
    SELECT u.is_active, u.deactivated_at, m.status AS membership_status
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.tenant_id = u.shop_id
    WHERE u.id = '${EMP}'
  `);
  return rows[0];
}

async function auditCount(action: string) {
  const rows = await execSql(
    `SELECT count(*)::int AS n FROM audit_events WHERE entity_id = '${EMP}' AND action = '${action}'`
  );
  return Number(rows[0].n);
}

async function historySaleExists() {
  const rows = await execSql(
    `SELECT count(*)::int AS n FROM sales WHERE id = '${HIST_SALE_ID}' AND employee_id = '${EMP}'`
  );
  return Number(rows[0].n) === 1;
}

// ── browser helpers ─────────────────────────────────────────────────────────

/** Every RPC call the page makes to `name`, from now on. */
function trackRpc(page: Page, name: string) {
  const hits: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(`/rpc/${name}`)) hits.push(req.url());
  });
  return hits;
}

/** The toast surface, read without Playwright's auto-wait (most reads are empty). */
function toastText(page: Page) {
  return page
    .evaluate(() => {
      const el = document.querySelector('div.fixed[style*="--tabbar-height"]');
      return el ? (el as HTMLElement).innerText : '';
    })
    .catch(() => '');
}

/** Sample the toast surface for a while: a toast that appears and self-dismisses
 *  would pass a single check at the end, which is exactly the weaker mistake. */
async function collectToasts(page: Page, ms = 6000) {
  let seen = '';
  for (let waited = 0; waited < ms; waited += 100) {
    seen += `\n${await toastText(page)}`;
    await page.waitForTimeout(100);
  }
  return seen;
}

/**
 * Click the same button twice in ONE task — a real double tap — and insist both clicks
 * genuinely land. If the button were already disabled, the second tap never reaches the
 * handler and the test would pass while proving nothing.
 */
async function doubleTap(page: Page, exactLabel: string) {
  return page.evaluate((label) => {
    const rx = new RegExp(`^${label}$`, 'i');
    const btns = Array.from(document.querySelectorAll('button')).filter((b) =>
      rx.test((b.textContent || '').trim())
    ) as HTMLButtonElement[];
    const btn = btns[btns.length - 1];
    if (!btn) throw new Error(`confirm button not found: ${label}`);
    if (btn.disabled) {
      throw new Error('the confirm button was already disabled — the second tap never lands');
    }
    btn.click();
    btn.click();
    return true;
  }, exactLabel);
}

test.describe('Employee status safety', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`DELETE FROM audit_events WHERE entity_id = '${EMP}'`);
    await execSql(`
      INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status,
        payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, created_at, updated_at)
      VALUES ('${HIST_SALE_ID}', '${HIST_SALE_NUMBER}', '${QA_IDS.customerA}', '${EMP}', 1500, 'completed',
        'full', 'cash', 1500, 0, 0, false, '${QA_IDS.shop}', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
  });

  test.afterAll(async () => {
    await execSql(`DELETE FROM sale_items WHERE sale_id = '${HIST_SALE_ID}'`).catch(() => {});
    await execSql(`DELETE FROM sales WHERE id = '${HIST_SALE_ID}'`).catch(() => {});
    await execSql(`DELETE FROM audit_events WHERE entity_id = '${EMP}'`).catch(() => {});
    await setActiveState(true).catch(() => {});
    await cleanupFixtures();
  });

  test('deactivating: a double tap revokes access once and reports success, not failure', async ({ page }) => {
    await setActiveState(true);
    await injectAdminAuth(page);

    const deactivations = trackRpc(page, 'deactivate_employee_v1');
    const activations = trackRpc(page, 'activate_employee_v1');

    await page.goto(`${BASE_URL}/admin/employees/${EMP}`);
    await page.waitForLoadState('networkidle');

    // The copy pass renamed this action to the shop owner's own words; the label the
    // button carries is the requirement, so the locator follows it.
    await page.getByRole('button', { name: /^turn off this employee's account$/i }).first().click();

    // The dialog has to name the employee and state the consequence — not ask a
    // generic "are you sure?" that tells the owner nothing.
    await expect(page.getByText(`Turn off ${EMP_NAME}'s account?`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/no longer be able to sign in/i)).toBeVisible();
    await expect(page.getByText(/stay on record/i)).toBeVisible();
    await expect(page.getByText(/are you sure/i)).toHaveCount(0);

    await doubleTap(page, "Turn off this employee's account");

    const toasts = await collectToasts(page);

    // The confirmation the owner reads, in the words the copy pass gave it: "{name}'s
    // account is off — past sales are safe". Asserting the old machine word ("deactivated")
    // would pass on copy the user has explicitly moved away from.
    expect(toasts, 'control: the success toast must be observed, or this check proves nothing')
      .toMatch(/account is off/i);
    expect(
      /did not work|already (deactivated|off)/i.test(toasts),
      'the second tap must not report a failure after the deactivation already succeeded'
    ).toBe(false);

    expect(deactivations.length, 'control: the tap must actually reach the backend').toBeGreaterThan(0);
    expect(deactivations.length, 'a double tap must send exactly one deactivation').toBe(1);
    expect(activations.length, 'deactivating must never activate').toBe(0);

    const state = await readState();
    expect(state.is_active).toBe(false);
    expect(state.deactivated_at).not.toBeNull();
    expect(state.membership_status).toBe('suspended');

    expect(await auditCount('employee_deactivated'), 'one action = one audit entry').toBe(1);

    // Offboarding revokes access; it never erases what the employee did.
    expect(await historySaleExists(), 'the employee’s past sale must survive deactivation').toBe(true);

    // ...and it survives a reload, because it was the database that changed.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /^turn the account back on$/i }).first())
      .toBeVisible({ timeout: 15000 });
  });

  test('reactivating: a double tap restores access once and keeps the history intact', async ({ page }) => {
    await setActiveState(false);
    // A record of the earlier deactivation, which reactivation must not rewrite.
    await execSql(`
      INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
      VALUES ('${QA_IDS.admin}', 'employee_deactivated', 'user', '${EMP}', '{"name":"${EMP_NAME}"}'::jsonb)
    `);

    // What is already on the books before we touch anything. Reactivation must add a
    // record and leave these alone — so this is captured rather than hardcoded, which
    // would only ever hold for one test order.
    const deactivationsOnRecord = await auditCount('employee_deactivated');
    const activationsOnRecord = await auditCount('employee_activated');

    await injectAdminAuth(page);

    const deactivations = trackRpc(page, 'deactivate_employee_v1');
    const activations = trackRpc(page, 'activate_employee_v1');

    await page.goto(`${BASE_URL}/admin/employees/${EMP}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^turn the account back on$/i }).first().click();

    await expect(page.getByText(`Turn access back on for ${EMP_NAME}?`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/current role and access/i)).toBeVisible();

    await doubleTap(page, 'Turn the account back on');

    const toasts = await collectToasts(page);

    // "{name} can sign in again" — the owner-facing wording, not the old machine word.
    expect(toasts, 'control: the success toast must be observed').toMatch(/can sign in again/i);
    expect(
      /did not work|already (active|on)/i.test(toasts),
      'the second tap must not report a failure after the reactivation already succeeded'
    ).toBe(false);

    expect(activations.length, 'a double tap must send exactly one reactivation').toBe(1);
    expect(deactivations.length, 'reactivating must never deactivate').toBe(0);

    const state = await readState();
    expect(state.is_active).toBe(true);
    expect(state.deactivated_at).toBeNull();
    expect(state.membership_status).toBe('active');

    expect(
      await auditCount('employee_activated'),
      'one reactivation = one new audit entry'
    ).toBe(activationsOnRecord + 1);
    expect(
      await auditCount('employee_deactivated'),
      'reactivation must not erase the deactivations already on record'
    ).toBe(deactivationsOnRecord);
    expect(deactivationsOnRecord, 'control: there must be a deactivation on record to preserve')
      .toBeGreaterThan(0);
    expect(await historySaleExists()).toBe(true);
  });

  test('cancel closes the confirmation and sends absolutely nothing', async ({ page }) => {
    await setActiveState(true);
    await injectAdminAuth(page);

    const deactivations = trackRpc(page, 'deactivate_employee_v1');

    await page.goto(`${BASE_URL}/admin/employees/${EMP}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /^turn off this employee's account$/i }).first().click();
    await expect(page.getByText(`Turn off ${EMP_NAME}'s account?`)).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /^cancel$/i }).last().click();

    await expect(page.getByText(`Turn off ${EMP_NAME}'s account?`)).toHaveCount(0);
    await page.waitForTimeout(1500);

    expect(deactivations.length, 'cancelling must not call the backend').toBe(0);
    const state = await readState();
    expect(state.is_active, 'cancelling must leave the employee active').toBe(true);
    expect(state.membership_status).toBe('active');
  });
});
