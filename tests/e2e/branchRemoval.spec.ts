/**
 * E2E: removing a branch, in a real browser against the real database.
 *
 * WHY THIS LANE EXISTS
 *   This was the one leg the security pass could not close, and the only `BLOCKED` row left in the
 *   staging checklist. `branchFlowCorrections` covers the same flow with a mocked transport — UI
 *   contract only — and the server rules are proven live elsewhere, but nothing drove the actual
 *   screen against the actual database: the confirmation a person reads, the reason the confirm
 *   button waits for, and what the branch table holds afterwards.
 *
 * WHAT IT PROVES
 *   · the archive action is offered only where it belongs — absent on the tenant's main branch;
 *   · the confirmation states the real consequence (archiving keeps the history; it does not delete
 *     the business), and the confirm button REFUSES to proceed without a reason;
 *   · pressing it archives the branch: `branches.is_active = false`, the row still exists, the
 *     tenant's main branch and its business rows are untouched;
 *   · an employee never gets that surface at all.
 *
 * WHAT IT DELIBERATELY DOES NOT REPEAT
 *   The RPC-level rules are already measured live: `tests/integration/accountDeletion.test.ts`
 *   (refusal while staff are scoped → `BRANCH_HAS_STAFF`; success → `history_preserved` and the
 *   fallback branch; the main branch → `MAIN_BRANCH`) and `rbacInvariants` (the write is
 *   owner-gated). This lane asserts the browser surface and the resulting row, and does not
 *   re-litigate those.
 *
 * Everything it writes is inside the app-registered isolated tenant. Each test removes its own
 * branch and reads back that it is gone. QA database only.
 */
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execSql, loginViaUi, settle, cleanupFixtures, WRITE_TENANT } from './helpers';

const BASE = process.env.QA_APP_URL || 'http://localhost:5173';
const TENANT = WRITE_TENANT.id;
const OWNER = WRITE_TENANT.owner;
const EMPLOYEE = WRITE_TENANT.employee;

/** The confirmation copy, read from the product's own strings rather than paraphrased here. */
const ARCHIVE_TITLE = (branch: string) => `Archive ${branch}?`;
const ARCHIVE_BODY =
  'This branch stops accepting new work. Its sales, payments, stock history and activity stay unchanged.';
const ARCHIVED_TOAST = 'Branch archived. Its history is preserved.';

async function defaultBranch(): Promise<string> {
  const [row] = await execSql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_default AND is_active LIMIT 1`,
  );
  expect(row?.id, 'the isolated tenant has no default active branch').toBeTruthy();
  return String(row.id);
}

async function createBranch(name: string): Promise<string> {
  const id = randomUUID();
  await execSql(
    `INSERT INTO branches (id, tenant_id, name, is_default, is_active)
     VALUES ('${id}', '${TENANT}', '${name}', false, true)`,
  );
  const [row] = await execSql(`SELECT id, is_active FROM branches WHERE id = '${id}'`);
  expect(row?.id, 'the test branch was not created, so the assertions below would prove nothing').toBe(id);
  return id;
}

/** Remove this lane's own branch by id and READ BACK that it is gone. */
async function removeBranch(id: string): Promise<void> {
  await execSql(`DELETE FROM branches WHERE id = '${id}'`).catch(() => undefined);
  const [left] = await execSql(`SELECT count(*)::int AS n FROM branches WHERE id = '${id}'`);
  expect(Number(left?.n ?? -1), `the lane's branch ${id} survived its own cleanup`).toBe(0);
}

async function branchIsActive(id: string): Promise<boolean> {
  const [row] = await execSql(`SELECT is_active FROM branches WHERE id = '${id}'`);
  return Boolean(row?.is_active);
}

test.describe('Branch removal — live browser workflow', () => {
  test.afterAll(async () => {
    await cleanupFixtures();
  });

  test('the owner archives a branch: confirmation, a reason the button insists on, and the row that results', async ({
    page,
  }) => {
    const main = await defaultBranch();
    const name = `Removal Branch ${randomUUID().slice(0, 8)}`;
    const branchId = await createBranch(name);

    try {
      await loginViaUi(page, OWNER.phone);

      // ── the main branch offers no way to remove it (the server refusal is proven elsewhere) ─────
      await page.goto(`${BASE}/admin/settings/branches/${main}`);
      await settle(page);
      await expect(
        page.getByTestId(`branch-delete-action-${main}`),
        'the main branch offers an archive action, which would strand the business',
      ).toHaveCount(0);

      // ── the branch this test created does offer it ─────────────────────────────────────────────
      await page.goto(`${BASE}/admin/settings/branches/${branchId}`);
      await settle(page);
      const action = page.getByTestId(`branch-delete-action-${branchId}`);
      await expect(action, 'the archive action is missing on a non-main branch the owner owns').toBeVisible({
        timeout: 20000,
      });
      await action.click();

      // ── the confirmation says what actually happens, and does not sit until a reason is given ──
      await expect(page.getByText(ARCHIVE_TITLE(name)), 'the confirmation does not name the branch').toBeVisible();
      await expect(page.getByText(ARCHIVE_BODY, { exact: false }), 'the consequence is not stated').toBeVisible();
      const submit = page.getByTestId('confirm-submit');
      await expect(submit, 'the confirm button was armed before a reason was given').toBeDisabled();
      // The reason field, by its own testid: the shared Input renders a bare <input> with no
      // `type` attribute, so a `input[type="text"]` selector matches nothing at all.
      await page.getByTestId('branch-archive-reason').fill(`QA lane: archiving ${name}`);
      await expect(submit, 'a reason did not arm the confirm button').toBeEnabled();
      await submit.click();

      // ── the product says what happened ────────────────────────────────────────────────────────
      await expect(page.getByText(ARCHIVED_TOAST, { exact: false }), 'no success confirmation appeared').toBeVisible(
        { timeout: 20000 },
      );

      // ── the database says the same thing ──────────────────────────────────────────────────────
      expect(await branchIsActive(branchId), 'the branch is still active after the archive').toBe(false);
      const [row] = await execSql(`SELECT count(*)::int AS n FROM branches WHERE id = '${branchId}'`);
      expect(Number(row.n), 'archiving DELETED the branch row; it must preserve the business').toBe(1);
      expect(await branchIsActive(main), 'the main branch was affected by archiving another one').toBe(true);
      const [shop] = await execSql(`SELECT count(*)::int AS n FROM shops WHERE id = '${TENANT}'`);
      expect(Number(shop.n), 'the business itself is gone').toBe(1);
    } finally {
      await removeBranch(branchId);
    }
  });

  test('an employee is never offered the archive surface, and changes nothing', async ({ page }) => {
    const main = await defaultBranch();
    const name = `Removal Branch ${randomUUID().slice(0, 8)}`;
    const branchId = await createBranch(name);

    try {
      await loginViaUi(page, EMPLOYEE.phone, 'employee', TENANT);
      await settle(page);

      // The management route is guarded by `settings.view`, which the employee's role does not carry:
      // whichever way the app answers (bounce or blank), the action must not exist for them.
      await page.goto(`${BASE}/admin/settings/branches/${branchId}`).catch(() => undefined);
      await page.waitForTimeout(2000);
      await expect(
        page.getByTestId(`branch-delete-action-${branchId}`),
        'an employee was shown the branch archive action',
      ).toHaveCount(0);

      // And nothing moved: the branch is still active, and the tenant's main branch is untouched.
      expect(await branchIsActive(branchId), 'an employee action archived a branch').toBe(true);
      expect(await branchIsActive(main), 'the main branch changed during the employee test').toBe(true);
    } finally {
      await removeBranch(branchId);
    }
  });
});
