/**
 * Access-management lifecycle + live-session regression suite.
 *
 * Proves, through the real client path (JWT → PostgREST → RPC → DB):
 *   1. Effective access is resolved server-side: an access change takes effect at
 *      the next authorization boundary even while the employee's session lives.
 *   2. A deactivated membership loses access immediately.
 *   3. Role deletion is safe: system roles and in-use roles are refused.
 *   4. update_admin_profile cannot be pointed at another user or tenant.
 *   5. Access changes are audited with actor attribution.
 *
 * Self-contained: creates its own employee + role and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const OWNER = 'd3000000-0000-0000-0000-00000000000a';
const EMP = 'd3000000-0000-0000-0000-0000000000e1';
const VICTIM = 'd3000000-0000-0000-0000-00000000000b';
const ROLE_EMPLOYEE = 'a0000000-0000-0000-0000-000000000001'; // Sales Employee (has customers.create)
const ROLE_CLERK = 'a0000000-0000-0000-0000-000000000004';    // Inventory Clerk (no customers.create)
const RUN = `QA Life ${Date.now()}`;

let roleId = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function cleanup() {
  await sql(`DELETE FROM customers WHERE phone IN ('923009795001','923009795002')`).catch(() => undefined);
  await sql(`DELETE FROM audit_events WHERE user_id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch(() => undefined);
  await sql(`DELETE FROM user_permissions WHERE user_id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch(() => undefined);
  await sql(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE '${RUN}%')`).catch(() => undefined);
  await sql(`DELETE FROM roles WHERE name LIKE '${RUN}%'`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch(() => undefined);
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER}',  '${RUN} Owner',  '923009795001', 'admin',    true,  true, '${TENANT_A}'),
      ('${EMP}',    '${RUN} Emp',    '923009795002', 'employee', false, true, '${TENANT_A}'),
      ('${VICTIM}', '${RUN} Victim', '923009795003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanup();
});

const customerCall = (n: number) => ({
  payload: { name: `${RUN} customer ${n}`, phone: `92300979${5000 + n}` },
});

describe('Live session — access changes apply at the next authorization boundary', () => {
  it('grants access from the assigned role', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}', role = 'employee', status = 'active' WHERE user_id = '${EMP}'`);

    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(1));
    expect(res.error).toBeNull();

    const persisted = await sql(`SELECT count(*)::int AS c FROM customers WHERE phone = '923009795001'`);
    expect(persisted.rows[0].c).toBe(1);
  });

  it('revokes access on the next call after the role changes', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_CLERK}' WHERE user_id = '${EMP}'`);

    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(2));
    expect(res.error).toContain('NOT_AUTHORIZED');

    // Nothing was written by the rejected call.
    const persisted = await sql(`SELECT count(*)::int AS c FROM customers WHERE phone = '923009795002'`);
    expect(persisted.rows[0].c).toBe(0);
  });

  it('restores access when the role is changed back', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(2));
    expect(res.error).toBeNull();
  });

  it('loses access immediately when the membership is deactivated', async () => {
    await sql(`UPDATE memberships SET status = 'suspended' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(3));
    expect(res.error).toContain('NOT_AUTHORIZED');
    await sql(`UPDATE memberships SET status = 'active' WHERE user_id = '${EMP}'`);
  });

  it('reports effective permissions from the server, not the client', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_CLERK}' WHERE user_id = '${EMP}'`);
    const effective = await execRpcAsUser(EMP, 'get_my_permissions', {});
    expect(effective.error).toBeNull();
    const codes: string[] = Array.isArray(effective.data)
      ? effective.data
      : (effective.data?.permissions ?? []);
    expect(codes).not.toContain('customers.create');
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
  });
});

describe('Role lifecycle — deletion is safe', () => {
  it('creates a reusable role from the API', async () => {
    const created = await execRpcAsUser(OWNER, 'create_role', {
      payload: { name: `${RUN} Role`, description: 'lifecycle probe', permissions: ['customers.view', 'customers.create'] },
    });
    expect(created.error).toBeNull();
    roleId = created.data?.id ?? created.data?.roleId;
    expect(roleId).toBeTruthy();
  });

  it('refuses to delete a role that employees still use', async () => {
    await sql(`UPDATE memberships SET role_id = '${roleId}' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId } });
    expect(res.error).toContain('ROLE_IN_USE');
  });

  it('refuses to delete a built-in role that someone is assigned to', async () => {
    // What protects a role is ASSIGNMENT, not provenance (0164): a built-in role with nobody
    // on it can be removed and the screen offers it, while one that somebody works under —
    // this one — is refused by the same rule as any custom role. The old rule refused every
    // system role outright, which is why a shop that never used a built-in role could only be
    // told "this one comes with the app".
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId: ROLE_EMPLOYEE } });
    expect(res.error).toContain('ROLE_IN_USE');
  });

  it('deletes the role once it is no longer in use', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId } });
    expect(res.error).toBeNull();
    const gone = await sql(`SELECT count(*)::int AS c FROM roles WHERE id = '${roleId}'`);
    expect(gone.rows[0].c).toBe(0);
  });
});

describe('Profile update — identity cannot be forged', () => {
  it('updates the caller own profile', async () => {
    const res = await execRpcAsUser(OWNER, 'update_admin_profile', { payload: { name: `${RUN} Owner renamed` } });
    expect(res.error).toBeNull();
    const row = await sql(`SELECT name FROM users WHERE id = '${OWNER}'`);
    expect(row.rows[0].name).toBe(`${RUN} Owner renamed`);
  });

  it('ignores a userId pointing at another user', async () => {
    const before = await sql(`SELECT name FROM users WHERE id = '${VICTIM}'`);
    const res = await execRpcAsUser(OWNER, 'update_admin_profile', {
      payload: { userId: VICTIM, name: `${RUN} HIJACK` },
    });
    expect(res.error).toBeNull();

    const after = await sql(`SELECT name FROM users WHERE id = '${VICTIM}'`);
    expect(after.rows[0].name).toBe(before.rows[0].name);
    const me = await sql(`SELECT name FROM users WHERE id = '${OWNER}'`);
    expect(me.rows[0].name).toBe(`${RUN} HIJACK`);
  });
});

describe('Audit — access changes are attributed', () => {
  it('records role and access changes with the acting user', async () => {
    await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: ROLE_EMPLOYEE, overrides: { 'reports.view': true } },
    });
    await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: ROLE_EMPLOYEE, overrides: {} },
    });

    const audit = await sql(
      `SELECT count(*)::int AS c FROM audit_events WHERE user_id = '${OWNER}'`
    );
    expect(audit.rows[0].c).toBeGreaterThan(0);

    const overrides = await sql(
      `SELECT count(*)::int AS c FROM user_permissions WHERE user_id = '${EMP}' AND is_override IS NOT TRUE`
    );
    expect(overrides.rows[0].c).toBe(0);
  });
});
