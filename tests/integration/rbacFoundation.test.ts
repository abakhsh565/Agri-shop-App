import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, qaServiceClient } from '../setup/qa-client';

const tenant = '00000000-0000-0000-0000-000000000001';
/**
 * This file owns its tenant-admin identity.
 *
 * It previously borrowed `e1000000-…0001`, which `employeePermissions.test.ts`
 * seeds AND deletes in its own afterAll. On a clean database — or whenever that
 * suite had not yet seeded it — every assertion here failed with
 * "NOT_AUTHORIZED: tenant access denied", so the file only passed by run order.
 * Seeding a private admin removes the cross-file coupling entirely.
 */
const admin = 'b1080000-0000-0000-0000-0000000000a1';
const adminPhone = '923008880002';
/**
 * This file's own second branch, and its own customer phone.
 *
 * Both used to be borrowed from the seeded shop. `branches.rows[1]` fell back to the MAIN branch
 * when the seeded shop had only one active branch, which quietly turned the branch-denial
 * assertion into a success assertion — and that success created the customer below. The next run
 * then failed with `DUPLICATE_CUSTOMER_PHONE`, a failure caused entirely by the previous run of
 * the same file. The branch is now created here and the customer is removed in both ends of the
 * run, so the file is repeatable instead of order-dependent.
 */
const WAREHOUSE = 'b1080000-0000-0000-0000-00000000b001';
const DENIED_CUSTOMER_PHONE = '923008880099';
let employee = 'b1080000-0000-0000-0000-000000000001';
const roleName = `QA RBAC ${Date.now()}`;
let roleId = '';
let mainBranch = '';
let warehouseBranch = '';

async function sql(query: string) { return execSqlAsAdmin(query); }

beforeAll(async () => {
  // The users insert also creates the owner membership (ensure_user_membership
  // trigger), which is what gives this caller tenant access. The Supabase Auth
  // credential is provisioned on demand by execRpcAsUser.
  await sql(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${admin}', 'QA RBAC Admin', '${adminPhone}', 'admin', true, true, '${tenant}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, role = 'admin', shop_id = EXCLUDED.shop_id`);
  await qaServiceClient.auth.admin.updateUserById(employee, { password: `QA-test-${employee}-2024!` }).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM audit_events WHERE entity_id IN ('${employee}') OR details->>'name'='QA RBAC Employee'`);
  await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE id='${employee}' OR phone='923008880001')`);
  await sql(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE id='${employee}' OR phone='923008880001')`);
  await sql(`DELETE FROM users WHERE id='${employee}' OR phone='923008880001'`);
  // Whatever a previous run of this file created, removed before this one starts.
  await sql(`DELETE FROM customers WHERE phone='${DENIED_CUSTOMER_PHONE}'`);
  // A second branch this file owns, so the denial assertion always has somewhere else to point.
  await sql(`
    INSERT INTO branches (id, tenant_id, name, is_default, is_active)
    VALUES ('${WAREHOUSE}', '${tenant}', '${roleName} warehouse', false, true)
    ON CONFLICT (id) DO UPDATE SET tenant_id = '${tenant}', is_active = true
  `);
  const branches = await sql(`SELECT id,name FROM branches WHERE tenant_id='${tenant}' AND is_active=true ORDER BY is_default DESC, created_at`);
  mainBranch = branches.rows.find((b: { id: string }) => b.id !== WAREHOUSE)?.id;
  warehouseBranch = WAREHOUSE;
  expect(mainBranch, 'the seeded tenant needs a branch besides this file\'s warehouse').toBeTruthy();
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
  // Remove the identity this file seeded (users delete cascades the membership).
  await sql(`DELETE FROM user_permissions WHERE user_id='${admin}'`);
  await sql(`DELETE FROM memberships WHERE user_id='${admin}'`);
  await sql(`DELETE FROM users WHERE id='${admin}'`);
  // This file's own rows, removed and read back: a cleanup that silently failed is what made the
  // NEXT run fail with a duplicate phone.
  await sql(`DELETE FROM customers WHERE phone='${DENIED_CUSTOMER_PHONE}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM branches WHERE id='${WAREHOUSE}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  const { rows: left } = await sql(
    `SELECT (SELECT count(*) FROM customers WHERE phone='${DENIED_CUSTOMER_PHONE}')
          + (SELECT count(*) FROM branches WHERE id='${WAREHOUSE}') AS n`
  );
  expect(Number(left[0]?.n ?? -1), 'this suite\'s own rows survived its cleanup').toBe(0);
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
    const rows = await sql(`SELECT m.role_id,m.branch_scope,m.status,(SELECT count(*) FROM user_permissions up WHERE up.user_id='${employee}')::int AS overrides FROM memberships m WHERE m.user_id='${employee}'`);
    expect(rows.rows[0].role_id).toBe(roleId);
    expect(rows.rows[0].branch_scope).toContain(mainBranch);
    expect(rows.rows[0].overrides).toBe(0);
    // A newly added employee is INVITED, not working: role assignment is not access.
    expect(rows.rows[0].status).toBe('pending');

    // The invite is accepted by the employee's own first verified sign-in.
    const onboard = await execRpcAsUser(employee, 'complete_member_onboarding', {});
    expect(onboard.error).toBeNull();
    expect(onboard.data.activated).toBe(1);
    const after = await sql(`SELECT status FROM memberships WHERE user_id='${employee}'`);
    expect(after.rows[0].status).toBe('active');
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
