import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { acceptInvitationAsUser, execRpcAsUser, execSqlAsAdmin, qaServiceClient } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

const tenant = '00000000-0000-0000-0000-000000000001';
/**
 * This file's tenant-admin identity is the fixture shop's sole owner
 * (Khalid Khan). 0280 allows one active owner per shop, so the file uses
 * him instead of seeding its own admin — and never inserts, updates or
 * deletes his user row.
 */
const admin = QA_IDS.owner;
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
  // The caller is the fixture shop's owner, whose owner membership already
  // exists — that is what gives him tenant access. The Supabase Auth
  // credential is provisioned on demand by execRpcAsUser.
  // Best-effort by design: the employee row may not have an auth identity yet
  // (the credential is provisioned on demand by execRpcAsUser), so a missing
  // identity here is not a failure — the password is set when the credential
  // is created.
  try {
    await qaServiceClient.auth.admin.updateUserById(employee, { password: `QA-test-${employee}-2024!` });
  } catch {
    /* best-effort: no auth identity exists for this employee yet */
  }
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
  throwIfCleanupFailed('rbacFoundation beforeAll cleanup');
});

/**
 * Cleanup that REPORTS instead of swallowing — the customerDeletionSecurity /
 * employeeInviteLifecycle pattern. This suite shares the QA database with the
 * other integration files, so a silent catch here would leave rows in place
 * and the next suite would fail deep inside a test with an authorization error
 * that is really leftover state. Failures are collected and the caller throws
 * with their names (throwIfCleanupFailed, wired in beforeAll/afterAll).
 */
const cleanupFailures: string[] = [];
async function trySql(label: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (error) {
    cleanupFailures.push(`${label}: ${(error as Error).message}`);
  }
}
function throwIfCleanupFailed(context: string): void {
  if (cleanupFailures.length) {
    throw new Error(
      `${context}: cleanup failed — ${cleanupFailures.join(' | ')}. ` +
        `Leftover rows from this suite's namespace will contaminate the next run; fix the leak here rather than re-running.`,
    );
  }
}

afterAll(async () => {
  await sql(`DELETE FROM audit_events WHERE entity_id IN ('${employee}') OR details->>'name'='${roleName}'`);
  await sql(`DELETE FROM user_permissions WHERE user_id='${employee}'`);
  await sql(`DELETE FROM memberships WHERE user_id='${employee}'`);
  if (roleId) {
    await sql(`DELETE FROM role_permissions WHERE role_id='${roleId}'`);
    await sql(`DELETE FROM roles WHERE id='${roleId}'`);
  }
  await sql(`DELETE FROM users WHERE id='${employee}'`);
  // This file's own rows, removed and read back: a cleanup that silently failed is what made the
  // NEXT run fail with a duplicate phone.
  await trySql('customers', sql(`DELETE FROM customers WHERE phone='${DENIED_CUSTOMER_PHONE}'`));
  await trySql('branches', sql(`DELETE FROM branches WHERE id='${WAREHOUSE}'`));
  const { rows: left } = await sql(
    `SELECT (SELECT count(*) FROM customers WHERE phone='${DENIED_CUSTOMER_PHONE}')
          + (SELECT count(*) FROM branches WHERE id='${WAREHOUSE}') AS n`
  );
  expect(Number(left[0]?.n ?? -1), 'this suite\'s own rows survived its cleanup').toBe(0);
  throwIfCleanupFailed('rbacFoundation afterAll cleanup');
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
    // 0285 grants every role customers.create/edit/payments at insert time (and
    // create_role dedupes the requested customers.create), so the stored set is
    // the two requested codes plus the two trigger-added customer codes.
    expect(roleRows.rows[0].count).toBe(4);
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

    // The invite is accepted by the employee's own verified sign-in (0286:
    // complete_member_onboarding() is a no-op; accept_my_invitation() is the acceptance).
    await acceptInvitationAsUser(employee);
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
      payload: { employeeId: employee, roleId, overrides: { 'sales.create': false }, branchScope: [mainBranch] },
    });
    expect(updated.error).toBeNull();
    const effective = await execRpcAsUser(employee, 'get_my_permissions', {});
    expect(effective.error).toBeNull();
    expect(effective.data).not.toContain('sales.create');
    expect(effective.data).toContain('customers.create');
  });
});
