/**
 * E2E: deleting an assigned role revokes the access it gave — described before, judged after.
 *
 * The rule changed with migration 0183. It used to refuse (`ROLE_IN_USE`) and leave the
 * access in place; now the owner's intent is carried out: the role is deleted and the
 * employees working under it lose exactly the access it provided, while keeping their
 * account, their membership and their history.
 *
 * What this spec proves, each with evidence:
 *   - the destructive confirmation explains the consequence. The delete row is offered for
 *     an in-use role, and both the row and the dialog name how many employees will lose the
 *     access — not a generic "are you sure?".
 *   - after confirming, the role is gone from the database and every membership that
 *     pointed at it is cleared, with no orphaned role_permissions row.
 *   - the employee and their history survive.
 *   - the revocation is not bypassable from a signed-in client: the browser's own session
 *     is pointed straight at `delete_role` and, because the role no longer exists, the
 *     repeated attempt is refused rather than reviving it.
 *
 * QA database only; the throwaway role and its assignment are removed again.
 */
import { test, expect } from '@playwright/test';
import {
  QA_IDS,
  execSql,
  setupFixtures,
  cleanupFixtures,
  ownership,
  snapshotIds,
  trackOwned,
  injectOwnerAuth,
} from './helpers';

const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';
const ROLE_ID = 'bbbb0000-0000-4000-8000-000000000001';
const ROLE_NAME = `QA In Use Role ${Date.now().toString(36).toUpperCase()}`;
/** The employee the role is assigned to; a second one makes the count worth naming. */
const EMPLOYEE_2 = 'bbbb0000-0000-4000-8000-0000000000e2';
const EMPLOYEE_2_PHONE = '923009740002';

async function memberCount(): Promise<number> {
  const rows = await execSql(
    `SELECT count(*)::int AS n FROM memberships WHERE role_id = '${ROLE_ID}' AND status = 'active'`
  );
  return Number(rows[0].n);
}

async function roleExists(): Promise<boolean> {
  const rows = await execSql(`SELECT count(*)::int AS n FROM roles WHERE id = '${ROLE_ID}'`);
  return Number(rows[0].n) === 1;
}

test.describe('Role deletion — assigned role revokes its access', () => {
  /** The employees' own roles before this spec borrowed them, restored in afterAll. */
  let previousRoleId: string | null = null;
  let previousRoleId2: string | null = null;

  test.beforeAll(async () => {
    await setupFixtures();

    const before = await execSql(
      `SELECT user_id, role_id FROM memberships WHERE user_id = '${QA_IDS.employee}' AND tenant_id = '${QA_IDS.shop}'`
    );
    previousRoleId = (before[0]?.role_id as string | null) ?? null;

    // A second employee on the role, so the confirmation's count is a real number rather
    // than the single-employee case that a hardcoded "1" could satisfy by accident.
    await execSql(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${EMPLOYEE_2}', 'QA Employee Two', '${EMPLOYEE_2_PHONE}', 'employee', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO UPDATE SET is_active = true
    `);
    // OWNED: the second employee is created by this run, so its row (and the membership and
    // permission rows that hang off it) is registered by id and removed by cleanupFixtures.
    await trackOwned(ownership(), 'users', EMPLOYEE_2);
    const second = await execSql(
      `SELECT role_id FROM memberships WHERE user_id = '${EMPLOYEE_2}' AND tenant_id = '${QA_IDS.shop}'`
    );
    previousRoleId2 = (second[0]?.role_id as string | null) ?? null;

    // A throwaway role, assigned to both employees — the state the rule is about.
    await execSql(`
      INSERT INTO roles (id, tenant_id, name, description, is_system)
      VALUES ('${ROLE_ID}', '${QA_IDS.shop}', '${ROLE_NAME}', 'QA in-use role', false)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `);
    // OWNED: the throwaway role, by its explicit id.
    await trackOwned(ownership(), 'roles', ROLE_ID);
    await execSql(`
      UPDATE memberships SET role_id = '${ROLE_ID}', status = 'active', updated_at = now()
      WHERE user_id IN ('${QA_IDS.employee}', '${EMPLOYEE_2}') AND tenant_id = '${QA_IDS.shop}'
    `);
  });

  test.afterAll(async () => {
    // Restore each employee's OWN role. Matched by USER, not by `role_id = ROLE_ID`:
    // the deletion this spec performs sets role_id to NULL, so a restore keyed on the
    // throwaway role would match nothing and leave the shared QA Employee fixture
    // without any role — which silently breaks every later lane that reads their
    // permissions (it did: appSettingsIsolation's employee reader).
    await execSql(`
      UPDATE memberships SET role_id = ${previousRoleId ? `'${previousRoleId}'` : 'NULL'}, updated_at = now()
      WHERE user_id = '${QA_IDS.employee}' AND tenant_id = '${QA_IDS.shop}'
    `).catch(() => {});
    await execSql(`
      UPDATE memberships SET role_id = ${previousRoleId2 ? `'${previousRoleId2}'` : 'NULL'}, updated_at = now()
      WHERE user_id = '${EMPLOYEE_2}' AND tenant_id = '${QA_IDS.shop}'
    `).catch(() => {});

    // CLEANUP IS OWNERSHIP-BASED NOW. The five deletes that used to run here (role_permissions,
    // roles, memberships, audit_events, users — all by the throwaway ids this lane fixed itself)
    // are replaced by the registry: cleanupFixtures deletes exactly the ids registered above, in
    // FK order (role_permissions → roles, memberships/user_permissions → users). The audit rows
    // that point at the employee THIS run created are claimed through that exact foreign key —
    // never through a time window, which would sweep another lane's history.
    await trackOwned(
      ownership(),
      'audit_events',
      await snapshotIds(`SELECT id FROM audit_events WHERE entity_id = '${EMPLOYEE_2}'`),
    );
    await cleanupFixtures();
  });

  test('the confirmation names the employees who lose the access, and confirming revokes it', async ({ page }) => {
    // Control: the role really is assigned to two active employees, or this proves nothing.
    expect(await memberCount(), 'the fixture role must be assigned to two active employees').toBe(2);
    expect(await roleExists()).toBe(true);

    await injectOwnerAuth(page);

    await page.goto(`${BASE_URL}/admin/settings/roles`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(ROLE_NAME).first()).toBeVisible({ timeout: 15000 });

    await page.getByTestId(`role-${ROLE_ID}`).click();
    const deleteRow = page.getByTestId('role-delete-row');
    await expect(deleteRow, 'the role editor has no delete row').toBeVisible({ timeout: 10000 });

    // The consequence is on the row itself, and the control is usable: the owner is told
    // what will happen rather than stopped from doing it.
    await expect(
      deleteRow,
      'the delete row does not say that the employees lose this access'
    ).toContainText(/2 employees will lose this access/i);
    await expect(deleteRow, 'the delete row must be offered for an in-use role').toBeEnabled();
    await expect(deleteRow, 'the row offers a generic confirmation instead of the consequence')
      .not.toContainText(/are you sure/i);

    await deleteRow.click();

    // The dialog repeats the consequence in the destructive step, naming the count.
    const dialogText = await page.getByText(/employees use this role/i).last().innerText();
    expect(dialogText, 'the confirmation does not name how many employees lose access').toMatch(/2 employees use this role/i);
    expect(dialogText, 'the confirmation does not say the access is removed').toMatch(/removes the access/i);
    expect(dialogText, 'the confirmation does not say the account and history survive').toMatch(/keep their account and their history/i);

    await page.getByRole('button', { name: /^delete role$/i }).last().click();

    // The database is the judge: role gone, references cleared, employees intact.
    await expect.poll(async () => roleExists(), { timeout: 15000 }).toBe(false);
    await expect.poll(async () => memberCount(), { timeout: 15000 }).toBe(0);

    const orphans = await execSql(
      `SELECT count(*)::int AS n FROM role_permissions WHERE role_id = '${ROLE_ID}'`
    );
    expect(Number(orphans[0].n), 'no orphaned role_permissions rows may remain').toBe(0);

    const employees = await execSql(`
      SELECT u.name, u.is_active, m.status AS membership_status, m.role_id
      FROM users u JOIN memberships m ON m.user_id = u.id AND m.tenant_id = u.shop_id
      WHERE u.id IN ('${QA_IDS.employee}', '${EMPLOYEE_2}')
      ORDER BY u.name
    `);
    expect(employees.length, 'both employees must still be in the system').toBe(2);
    for (const row of employees) {
      expect(row.is_active, 'the employee must not be deactivated by the role deletion').toBe(true);
      expect(row.membership_status, 'the membership must survive').toBe('active');
      expect(row.role_id, 'the role reference must be cleared').toBeNull();
    }
  });

  test('a repeated deletion from a signed-in client cannot revive the role', async ({ page }) => {
    await injectOwnerAuth(page);

    // The bypass attempt: the browser's own session calls the RPC directly, for a role
    // that no longer exists. It must be refused, not silently recreate or half-apply.
    const session = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      if (!key) return null;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token ?? parsed?.currentSession?.access_token ?? null;
      return token ? { token } : null;
    });
    expect(session, 'the injected admin session must expose a JWT, or this check proves nothing').toBeTruthy();

    const url = process.env.QA_SUPABASE_URL ?? '';
    const anonKey = process.env.QA_SUPABASE_ANON_KEY ?? '';
    expect(url && anonKey, 'the QA project URL and anon key must be available for the direct-RPC check').toBeTruthy();

    const direct = await fetch(`${url}/rest/v1/rpc/delete_role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${session!.token}`,
      },
      body: JSON.stringify({ payload: { roleId: ROLE_ID } }),
    });
    const body = await direct.text();
    expect(body, 'the repeated deletion must be refused as a missing role').toContain('ROLE_NOT_FOUND_OR_NOT_AUTHORIZED');

    // And nothing came back: the role is still gone and no membership points at it.
    expect(await roleExists(), 'the refused deletion must not have recreated the role').toBe(false);
    expect(await memberCount()).toBe(0);
  });
});
