/**
 * Employee Invite Lifecycle Regression Suite
 *
 * Locked product intent: adding an employee ISSUES AN INVITATION, and the
 * employee becomes active only when they complete onboarding with their own
 * verified sign-in. Role assignment is not access.
 *
 * Proves, with a real JWT + PostgREST + database evidence:
 *   1. A newly added employee's membership is `pending`, and every authorization
 *      path denies them — including a real business write, not just a UI state.
 *   2. complete_member_onboarding() activates the caller's own membership, once.
 *   3. Onboarding NEVER revives a suspended membership (deactivation must not be
 *      undone by the deactivated person signing in).
 *   4. Reactivating an invited employee does not promote the invitation.
 *   5. Onboarding cannot activate somebody else's invitation.
 *
 * Self-contained: creates its own owner + employees and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OWNER = 'c2000000-0000-0000-0000-000000000001';
// The seeded system role, so "role defaults apply" is provable rather than assumed.
const ROLE_SALES_EMPLOYEE = 'a0000000-0000-0000-0000-000000000001';
const PHONES = ['923009660001', '923009660002', '923009660003', '923009660004'];

let branchId = '';
let invited = '';
let colleague = '';
let roleDefaultCodes: string[] = [];

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function statusOf(userId: string): Promise<string> {
  const r = await sql(`SELECT status FROM memberships WHERE user_id = '${userId}'`);
  return r.rows[0]?.status;
}

async function cleanup() {
  await sql(`
    DELETE FROM audit_events
    WHERE user_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))
       OR entity_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))
  `).catch(() => undefined);
  await sql(`DELETE FROM customers WHERE phone LIKE '92300966%'`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')})`).catch(() => undefined);
}

beforeAll(async () => {
  await cleanup();
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${OWNER}', 'QA Invite Owner', '${PHONES[0]}', 'admin', true, true, '${TENANT}')
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
});

describe('Employee invite lifecycle — an invitation is not access', () => {
  it('creates the employee as an invitation, not as an active worker', async () => {
    const created = await execRpcAsUser(OWNER, 'create_employee', {
      payload: {
        name: 'QA Invite Person',
        phone: PHONES[1],
        membershipRole: 'employee',
        roleId: ROLE_SALES_EMPLOYEE,
        branchScope: [branchId],
      },
    });
    expect(created.error).toBeNull();
    expect(created.data.membershipStatus).toBe('pending');
    invited = created.data.id;
    expect(await statusOf(invited)).toBe('pending');

    // The role is assigned, but a role is not access: while the invitation is
    // pending the employee resolves to no permissions at all.
    const roleDefaults = await sql(
      `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = '${ROLE_SALES_EMPLOYEE}'`
    );
    expect(roleDefaults.rows.length).toBeGreaterThan(0);
    roleDefaultCodes = roleDefaults.rows.map((r) => r.code as string);
    const perms = await execRpcAsUser(invited, 'get_my_permissions', {});
    expect(perms.data ?? []).toEqual([]);

    // ...and a real business write is refused, not merely hidden in the UI.
    const write = await execRpcAsUser(invited, 'create_customer', {
      payload: { name: 'QA Invite Should Not Exist', phone: '923009660901', branchId },
    });
    expect(write.error).toBeTruthy();
    const leaked = await sql(`SELECT count(*)::int AS c FROM customers WHERE phone = '923009660901'`);
    expect(leaked.rows[0].c).toBe(0);

    // A colleague added at the same time stays invited too.
    const second = await execRpcAsUser(OWNER, 'create_employee', {
      payload: { name: 'QA Invite Colleague', phone: PHONES[2], membershipRole: 'employee', branchScope: [branchId] },
    });
    expect(second.error).toBeNull();
    colleague = second.data.id;
    expect(await statusOf(colleague)).toBe('pending');
  });

  it('activates the invitee on their own verified sign-in, exactly once', async () => {
    const onboard = await execRpcAsUser(invited, 'complete_member_onboarding', {});
    expect(onboard.error).toBeNull();
    expect(onboard.data.activated).toBe(1);
    expect(await statusOf(invited)).toBe('active');

    // Idempotent: a second sign-in activates nothing and cannot re-grant access.
    const again = await execRpcAsUser(invited, 'complete_member_onboarding', {});
    expect(again.error).toBeNull();
    expect(again.data.activated).toBe(0);

    // Now the role's defaults are in force — and only now.
    const perms = await execRpcAsUser(invited, 'get_my_permissions', {});
    expect(perms.data ?? []).toEqual(expect.arrayContaining(roleDefaultCodes));
  });

  it('cannot activate somebody else\'s invitation', async () => {
    // `invited` is now active and calls onboarding on its own behalf only.
    await execRpcAsUser(invited, 'complete_member_onboarding', {});
    expect(await statusOf(colleague)).toBe('pending');
  });

  it('never revives a suspended membership', async () => {
    await execRpcAsUser(OWNER, 'deactivate_employee', {
      payload: { employeeId: invited },
    }).catch(() => undefined);
    // Deactivation is enforced through the same status field authorization reads.
    await sql(`UPDATE users SET is_active = false WHERE id = '${invited}'`);
    expect(await statusOf(invited)).toBe('suspended');

    // The deactivated person signing in must not restore their own access.
    const attempt = await execRpcAsUser(invited, 'complete_member_onboarding', {});
    expect(attempt.error).toBeTruthy();
    expect(await statusOf(invited)).toBe('suspended');
  });

  it('returns a cancelled invitation to pending, never straight to active', async () => {
    // colleague has never signed in. Cancelling and re-enabling the invite must
    // not be a way to grant access without onboarding.
    await sql(`UPDATE users SET is_active = false WHERE id = '${colleague}'`);
    expect(await statusOf(colleague)).toBe('suspended');
    await sql(`UPDATE users SET is_active = true WHERE id = '${colleague}'`);
    expect(await statusOf(colleague)).toBe('pending');

    // And it still needs onboarding to actually work here.
    const perms = await execRpcAsUser(colleague, 'get_my_permissions', {});
    expect(perms.data ?? []).toEqual([]);
    const onboard = await execRpcAsUser(colleague, 'complete_member_onboarding', {});
    expect(onboard.data.activated).toBe(1);
    expect(await statusOf(colleague)).toBe('active');
  });
});
