import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, qaServiceClient } from '../setup/qa-client';

const tenant = '00000000-0000-0000-0000-000000000001';
const admin = 'e1000000-0000-0000-0000-000000000001';
let employee = 'b1080000-0000-0000-0000-000000000001';
const roleName = `QA RBAC ${Date.now()}`;
let roleId = '';
let mainBranch = '';
let warehouseBranch = '';

async function sql(query: string) { return execSqlAsAdmin(query); }

beforeAll(async () => {
  await qaServiceClient.auth.admin.updateUserById(admin, { password: `QA-test-${admin}-2024!` });
  await qaServiceClient.auth.admin.updateUserById(employee, { password: `QA-test-${employee}-2024!` }).catch(() => undefined);
  await sql(`DELETE FROM audit_events WHERE entity_id IN ('${employee}') OR details->>'name'='QA RBAC Employee'`);
  await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE id='${employee}' OR phone='923008880001')`);
  await sql(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE id='${employee}' OR phone='923008880001')`);
  await sql(`DELETE FROM users WHERE id='${employee}' OR phone='923008880001'`);
  const branches = await sql(`SELECT id,name FROM branches WHERE tenant_id='${tenant}' AND is_active=true ORDER BY is_default DESC, created_at`);
  mainBranch = branches.rows[0]?.id;
  warehouseBranch = branches.rows[1]?.id ?? mainBranch;
  expect(mainBranch).toBeTruthy();
});

afterAll(async () => {
  await sql(`DELETE FROM audit_events WHERE entity_id IN ('${employee}') OR details->>'name'='${roleName}'`);
  await sql(`DELETE FROM user_permissions WHERE user_id='${employee}'`);
  await sql(`DELETE FROM memberships WHERE user_id='${employee}'`);
  if (roleId) {
    await sql(`DELETE FROM role_permissions WHERE role_id='${roleId}'`);
    await sql(`DELETE FROM roles WHERE id='${roleId}'`);
  }
  await sql(`DELETE FROM users WHERE id='${employee}'`);
});

describe('Authoritative RBAC foundation', () => {
  it('creates a reusable role and exposes its configured defaults', async () => {
    const created = await execRpcAsUser(admin, 'create_role', {
      payload: { name: roleName, description: 'QA role', permissions: ['sales.create', 'customers.create'] },
    });
    expect(created.error).toBeNull();
    roleId = created.data.id;

    const access = await execRpcAsUser(admin, 'get_employee_access', { p_employee_id: admin });
    // Owner access inspection is valid; role defaults are empty for owner.
    expect(access.error).toBeNull();
    const roleRows = await sql(`SELECT count(*)::int AS count FROM role_permissions WHERE role_id='${roleId}'`);
    expect(roleRows.rows[0].count).toBe(2);
  });

  it('creates an employee linked to the role without copying defaults', async () => {
    const created = await execRpcAsUser(admin, 'create_employee', {
      payload: { name: 'QA RBAC Employee', phone: '923008880001', membershipRole: 'employee', roleId, branchScope: [mainBranch] },
    });
    expect(created.error).toBeNull();
    employee = created.data.id;
    const rows = await sql(`SELECT m.role_id,m.branch_scope,(SELECT count(*) FROM user_permissions up WHERE up.user_id='${employee}')::int AS overrides FROM memberships m WHERE m.user_id='${employee}'`);
    expect(rows.rows[0].role_id).toBe(roleId);
    expect(rows.rows[0].branch_scope).toContain(mainBranch);
    expect(rows.rows[0].overrides).toBe(0);
  });

  it('resolves role defaults and enforces branch scope through an authenticated RPC', async () => {
    const effective = await execRpcAsUser(employee, 'get_my_permissions', {});
    expect(effective.error).toBeNull();
    expect(effective.data).toEqual(expect.arrayContaining(['sales.create', 'customers.create']));

    const denied = await execRpcAsUser(employee, 'create_customer', {
      payload: { name: 'Should Be Rejected', phone: '923008880099', branchId: warehouseBranch, userId: employee },
    });
    if (warehouseBranch !== mainBranch) expect(denied.error).toMatch(/branch access denied/i);
    else expect(denied.error).toBeNull();
  });

  it('applies an explicit deny override without destroying role inheritance', async () => {
    const updated = await execRpcAsUser(admin, 'update_employee_access', {
      payload: { employeeId: employee, roleId, overrides: { 'sales.create': false, 'inventory.view': true }, branchScope: [mainBranch] },
    });
    expect(updated.error).toBeNull();
    const effective = await execRpcAsUser(employee, 'get_my_permissions', {});
    expect(effective.error).toBeNull();
    expect(effective.data).not.toContain('sales.create');
    expect(effective.data).toContain('customers.create');
    expect(effective.data).toContain('inventory.view');
  });
});
