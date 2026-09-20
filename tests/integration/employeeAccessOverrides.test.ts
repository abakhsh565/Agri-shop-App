/**
 * Employee access model regression suite
 *
 * The database is authoritative (0108 `get_effective_permissions`):
 *
 *     effective = (role defaults ∪ granted overrides) ∖ denied overrides
 *
 * This suite proves, with a real JWT → PostgREST → RPC → database path, the three
 * properties the owner-facing screens depend on:
 *
 *   1. Exceptions can be written with the employee (create_employee `overrides`),
 *      so customizing somebody never requires a second call.
 *   2. A change of role keeps the employee's exceptions: a role supplies defaults,
 *      it does not erase what the owner decided for this person. (The screens used
 *      to discard them — see the engineering memory entry — so this is the rule,
 *      not the UI's assumption.)
 *   3. Grants and denials both reach AUTHORIZATION, not just the screen, and
 *      resetting to "role access only" clears every exception.
 *
 * Self-contained: creates its own owner + employee and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OWNER = 'c3000000-0000-0000-0000-000000000001';
const ROLE_SALES_EMPLOYEE = 'a0000000-0000-0000-0000-000000000001';
const ROLE_STORE_MANAGER = 'a0000000-0000-0000-0000-000000000003';
const EMP_PHONE = '923009670001';

let branchId = '';
let employeeId = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function cleanup() {
  await sql(`
    DELETE FROM audit_events
    WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')
       OR entity_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')
  `).catch(() => undefined);
  await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE phone = '${EMP_PHONE}'`).catch(() => undefined);
}

async function overridesInDb(): Promise<{ code: string; is_granted: boolean }[]> {
  const r = await sql(`
    SELECT p.code, up.is_granted
      FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
     WHERE up.user_id = '${employeeId}' AND up.is_override = true
     ORDER BY p.code`);
  return r.rows as { code: string; is_granted: boolean }[];
}

/** What the database actually grants this employee right now. */
async function myPermissions(): Promise<string[]> {
  const r = await execRpcAsUser(employeeId, 'get_my_permissions', {});
  expect(r.error).toBeNull();
  return r.data as string[];
}

async function roleDefaults(roleId: string): Promise<string[]> {
  const r = await sql(`
    SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = '${roleId}'`);
  return r.rows.map((x: { code: string }) => x.code);
}

beforeAll(async () => {
  await cleanup();
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${OWNER}', 'QA Override Owner', '923009670099', 'admin', true, true, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, is_original_owner = true, shop_id = EXCLUDED.shop_id
  `);
  const b = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_active = true ORDER BY is_default DESC, created_at LIMIT 1`
  );
  branchId = b.rows[0]?.id;
  expect(branchId).toBeTruthy();
});

afterAll(async () => {
  await cleanup();
  await sql(`DELETE FROM audit_events WHERE user_id = '${OWNER}'`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE id = '${OWNER}'`).catch(() => undefined);
});

describe('Employee access = role defaults + this employee\'s exceptions', () => {
  it('writes the exceptions with the employee, skipping codes that do not exist', async () => {
    const created = await execRpcAsUser(OWNER, 'create_employee', {
      payload: {
        name: 'QA Override Employee',
        phone: EMP_PHONE,
        roleId: ROLE_SALES_EMPLOYEE,
        branchScope: [branchId],
        overrides: { 'companies.view': true, 'sales.create': false, 'not.a.real.code': true },
      },
    });
    expect(created.error).toBeNull();
    employeeId = created.data.id;
    // The unknown code is skipped rather than failing the whole creation.
    expect(created.data.overrides).toBe(2);

    const rows = await overridesInDb();
    expect(rows).toEqual([
      { code: 'companies.view', is_granted: true },
      { code: 'sales.create', is_granted: false },
    ]);

    // The invitation is still an invitation: holding exceptions grants nothing yet.
    expect(created.data.membershipStatus).toBe('pending');
    expect(await execRpcAsUser(employeeId, 'get_my_permissions', {})).toMatchObject({ data: [] });
  });

  it('applies both the grant and the denial to authorization once they are active', async () => {
    await execRpcAsUser(employeeId, 'complete_member_onboarding', {});
    const perms = await myPermissions();
    const defaults = await roleDefaults(ROLE_SALES_EMPLOYEE);

    // Granted exception: not part of the role, present anyway.
    expect(defaults).not.toContain('companies.view');
    expect(perms).toContain('companies.view');
    // Denied exception: part of the role, honestly removed for this employee.
    expect(defaults).toContain('sales.create');
    expect(perms).not.toContain('sales.create');
    // Everything else is untouched role access.
    expect(perms).toContain('sales.view');
    expect(perms).toContain('customers.view');
  });

  it('keeps the employee\'s exceptions when the role changes', async () => {
    const moved = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId, roleId: ROLE_STORE_MANAGER },
    });
    expect(moved.error).toBeNull();

    // The stored exceptions are still there — a role change is not a reset.
    expect(await overridesInDb()).toEqual([
      { code: 'companies.view', is_granted: true },
      { code: 'sales.create', is_granted: false },
    ]);

    // And the effective access is the NEW role's defaults with those exceptions.
    const perms = await myPermissions();
    const storeDefaults = await roleDefaults(ROLE_STORE_MANAGER);
    expect(perms).toContain('reports.view');   // came with the new role
    expect(storeDefaults).toContain('sales.create');
    expect(perms).not.toContain('sales.create'); // the old denial still means something
    expect(perms).toContain('companies.view');   // the old grant still applies
  });

  it('reset to role access only clears every exception', async () => {
    const reset = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId, roleId: ROLE_STORE_MANAGER, resetOverrides: true },
    });
    expect(reset.error).toBeNull();
    expect(await overridesInDb()).toEqual([]);

    const perms = await myPermissions();
    const storeDefaults = await roleDefaults(ROLE_STORE_MANAGER);
    expect([...perms].sort()).toEqual([...storeDefaults].sort());
  });
});
