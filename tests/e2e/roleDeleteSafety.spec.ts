/**
 * E2E: deleting a role fires exactly once, and reports the truth about what happened.
 *
 * The same defect fixed on the employee confirmation and the void dialog lived here
 * too: the guard was React state (`deleting`). React batches, so two clicks dispatched
 * in one task both read the pre-render value `false`, both reach `delete_role`, and the
 * second is refused with ROLE_NOT_FOUND_OR_NOT_AUTHORIZED — so the owner is shown an
 * ERROR immediately after the deletion that actually succeeded.
 *
 * Two clicks in ONE task, one RPC expected, judged on the database. The spec refuses to
 * run if the button is already disabled, so it cannot pass by proving nothing.
 *
 * QA database only; the throwaway role is deleted again.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  ownership,
  trackOwned,
  injectOwnerAuth,
} from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const ROLE_ID = 'aaaa0000-0000-4000-8000-000000000001';
const ROLE_NAME = `QA Throwaway Role ${Date.now().toString(36).toUpperCase()}`;

async function roleExists() {
  const rows = await execSql(`SELECT count(*)::int AS n FROM roles WHERE id = '${ROLE_ID}'`);
  return Number(rows[0].n) === 1;
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

async function collectToasts(page: Page, ms = 6000) {
  let seen = '';
  for (let waited = 0; waited < ms; waited += 100) {
    seen += `\n${await toastText(page)}`;
    await page.waitForTimeout(100);
  }
  return seen;
}

test.describe('Role delete safety', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`
      INSERT INTO roles (id, tenant_id, name, description, is_system)
      VALUES ('${ROLE_ID}', '${QA_IDS.shop}', '${ROLE_NAME}', 'QA throwaway role', false)
      ON CONFLICT (id) DO NOTHING
    `);
    // OWNED: the throwaway role, by the explicit id this lane created it with.
    await trackOwned(ownership(), 'roles', ROLE_ID);
  });

  test.afterAll(async () => {
    // The two inline deletes (role_permissions, then roles) are replaced by the registry, which
    // emits the same pair in FK order and raises a failure instead of swallowing one. In the
    // passing case the app has already deleted the role, so these statements match nothing.
    await cleanupFixtures();
  });

  test('a double tap deletes the role once and does not report a failure', async ({ page }) => {
    await injectOwnerAuth(page);

    const deletions: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/rpc/delete_role')) deletions.push(req.url());
    });

    await page.goto(`${BASE_URL}/admin/settings/roles`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(ROLE_NAME).first()).toBeVisible({ timeout: 15000 });

    // Removing a role is a row of its own at the foot of that role's editor sheet now —
    // not an icon in the row, which was a target you only found if you already knew it was
    // there. So the flow is: open the role, then press its delete row.
    await page.getByTestId(`role-${ROLE_ID}`).click();
    await expect(page.getByTestId('role-delete-row'), 'the role editor has no delete row').toBeVisible({ timeout: 10000 });
    await page.getByTestId('role-delete-row').click();

    await expect(page.getByText('Delete this role?')).toBeVisible({ timeout: 10000 });
    // Read through the row that carries it: the same sentence also appears in the sheet's body,
    // so matching the page by text resolves to two elements and would fail on strictness rather
    // than on the fact being asserted.
    await expect(
      page.getByTestId('role-delete-row'),
      'the delete row does not say why this role can go',
    ).toContainText(new RegExp(`No employee is using ${ROLE_NAME}`, 'i'));

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(
        (b) => (b.textContent || '').trim().toLowerCase() === 'delete role'
      ) as HTMLButtonElement[];
      const btn = btns[btns.length - 1];
      if (!btn) throw new Error('delete confirm button not found');
      if (btn.disabled) throw new Error('the confirm button was already disabled — the second tap never lands');
      btn.click();
      btn.click();
    });

    const toasts = await collectToasts(page);

    expect(toasts, 'control: the success toast must be observed, or this check proves nothing')
      .toContain('Role deleted');
    expect(
      /did not work|not found|not authorized/i.test(toasts),
      'the second tap must not report a failure after the deletion already succeeded'
    ).toBe(false);

    expect(deletions.length, 'control: the tap must actually reach the backend').toBeGreaterThan(0);
    expect(deletions.length, 'a double tap must send exactly one delete').toBe(1);

    expect(await roleExists(), 'the role must be gone from the database').toBe(false);
  });
});
