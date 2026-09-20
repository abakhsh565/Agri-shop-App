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
import { execRpcAsUser, execSqlAsAdmin, qaAnonClient } from '../setup/qa-client';

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
  // Same reason as employeeAccessOverrides: the User→Membership trigger (0113)
  // fires on INSERT only, so a surviving owner row from an earlier run would
  // otherwise have no membership and every RPC would answer NOT_AUTHORIZED.
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES ('${OWNER}', '${TENANT}', 'owner', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET role = 'owner', status = 'active', updated_at = now()
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

/**
 * The membership role (owner/admin/employee) is an AUTHORIZATION input, not a
 * label: app_has_permission() returns true for 'owner' before reading a single
 * permission, and users.role = 'admin' satisfies the RLS policies that guard
 * writes to roles / role_permissions / user_permissions.
 *
 * It used to be supplied by the caller — create_employee read
 * payload->>'membershipRole' and the Add Employee screen derived it from the
 * selected role's DISPLAY NAME (name.includes("admin")). The four system roles
 * contain no "admin", so every fixture passed and the hole only opened for a
 * custom role an owner had named, e.g. "Branch Admin" — which then made that
 * employee's users.role = 'admin' and let them rewrite the tenant's RBAC model
 * through direct PostgREST. update_employee_access had the same field, one step
 * further: membershipRole = 'owner' promoted an employee to full ownership.
 *
 * Both are closed. These tests lock the closure by the fields that are actually
 * read during authorization, not by the RPC's return value.
 */
describe('Membership role is derived by the database, never supplied by the caller', () => {
  const BYPASS = PHONES[3];
  let bypassId = '';

  it('ignores a caller-supplied membership role instead of applying it', async () => {
    const created = await execRpcAsUser(OWNER, 'create_employee', {
      payload: {
        name: 'QA Role Escalation Probe',
        phone: BYPASS,
        membershipRole: 'admin', // the old frontend heuristic, replayed by hand
        roleId: ROLE_SALES_EMPLOYEE,
        branchScope: [branchId],
      },
    });
    expect(created.error).toBeNull();
    bypassId = created.data.id;
    expect(created.data.membershipRole, 'the caller still controls the membership role').toBe('employee');

    // The fields authorization actually reads.
    const rows = await sql(`
      SELECT u.role AS user_role, m.role AS membership_role
        FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE u.id = '${bypassId}'`);
    expect(rows.rows[0].user_role, 'a caller can still create an RLS-admin user').toBe('employee');
    expect(rows.rows[0].membership_role).toBe('employee');
  });

  it('refuses an explicit request for owner rather than silently downgrading it', async () => {
    const attempt = await execRpcAsUser(OWNER, 'create_employee', {
      payload: { name: 'QA Owner Probe', phone: '923009660777', membershipRole: 'owner' },
    });
    expect(attempt.error ?? '').toContain('INVALID_EMPLOYEE_ROLE');
    const rows = await sql(`SELECT count(*)::int AS c FROM users WHERE phone = '923009660777'`);
    expect(rows.rows[0].c, 'a refused request still created a user').toBe(0);
  });

  it('cannot be used to promote a working employee to owner or admin', async () => {
    expect(bypassId).toBeTruthy();
    for (const role of ['owner', 'admin']) {
      const attempt = await execRpcAsUser(OWNER, 'update_employee_access', {
        payload: { employeeId: bypassId, membershipRole: role },
      });
      expect(attempt.error ?? '', `promotion to ${role} was accepted`).toContain('INVALID_EMPLOYEE_ROLE');
    }
    const rows = await sql(`
      SELECT u.role AS user_role, m.role AS membership_role
        FROM users u JOIN memberships m ON m.user_id = u.id
       WHERE u.id = '${bypassId}'`);
    expect(rows.rows[0].user_role).toBe('employee');
    expect(rows.rows[0].membership_role).toBe('employee');

    // The legitimate part of the same editor still works, so the refusal is not a
    // blanket ban on the function.
    const legit = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: bypassId, membershipRole: 'employee', roleId: ROLE_SALES_EMPLOYEE, branchScope: [branchId] },
    });
    expect(legit.error).toBeNull();
  });
});

/**
 * An invitation must be USABLE by the person who receives it.
 *
 * THE DEFECT THIS LOCKS (found by manual QA, invisible to this suite)
 *   app_current_user_id() reads the JWT `sub`, so an employee's Supabase Auth
 *   identity must have id = users.id. Only `scripts/provision-auth-sessions.mjs`
 *   ever created one, so a freshly invited employee could open the invite link,
 *   receive a code, type it — and land on "we could not open the app for this
 *   number yet". Migration 0135 provisions the identity as part of the invitation.
 *
 * WHY THIS FILE COULD NOT CATCH IT BEFORE: execRpcAsUser() calls getAuthClient(),
 * which CREATES a missing credential so the test can act as the user. The harness
 * supplied exactly what the product did not, so every assertion stayed green while
 * the real flow was impossible. These assertions therefore read auth.users
 * directly, after create_employee and BEFORE any test-side sign-in, and then prove
 * the credential works through a plain client that provisions nothing.
 */
describe('An invitation is usable: the invitee can actually sign in', () => {
  const PHONE = '923009660005';
  let inviteeId = '';

  beforeAll(async () => {
    await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch(() => undefined);
    await sql(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch(() => undefined);
    await sql(`DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch(() => undefined);
    await sql(`DELETE FROM auth.users WHERE id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch(() => undefined);
    await sql(`DELETE FROM users WHERE phone = '${PHONE}'`).catch(() => undefined);
  });

  afterAll(async () => {
    await sql(`DELETE FROM user_permissions WHERE user_id = '${inviteeId}'`).catch(() => undefined);
    await sql(`DELETE FROM memberships WHERE user_id = '${inviteeId}'`).catch(() => undefined);
    await sql(`DELETE FROM audit_events WHERE entity_id = '${inviteeId}' OR user_id = '${inviteeId}'`).catch(() => undefined);
    await sql(`DELETE FROM users WHERE id = '${inviteeId}'`).catch(() => undefined);
    await sql(`DELETE FROM auth.identities WHERE user_id = '${inviteeId}'`).catch(() => undefined);
    await sql(`DELETE FROM auth.users WHERE id = '${inviteeId}'`).catch(() => undefined);
  });

  it('creates the login with the employee, so the invite can be accepted', async () => {
    const created = await execRpcAsUser(OWNER, 'create_employee', {
      payload: { name: 'QA Usable Invite', phone: PHONE, roleId: ROLE_SALES_EMPLOYEE, branchScope: [branchId] },
    });
    expect(created.error).toBeNull();
    inviteeId = created.data.id;

    // No test-side provisioning has run for this user at this point.
    const auth = await sql(
      `SELECT id::text, email FROM auth.users WHERE id = '${inviteeId}'`
    );
    expect(auth.rows.length, 'inviting an employee did not create their login').toBe(1);
    // The exact credential the app derives from the phone (src/lib/auth.ts).
    expect(auth.rows[0].email).toBe('user-923009660005@agrishop.auth.local');
    const identity = await sql(
      `SELECT count(*)::int AS n FROM auth.identities WHERE user_id = '${inviteeId}'`
    );
    expect(identity.rows[0].n, 'login exists but has no provider identity').toBe(1);

    // Still an invitation: having a login is not having access.
    expect(await statusOf(inviteeId)).toBe('pending');
    const perms = await execRpcAsUser(OWNER, 'create_employee', {
      payload: { name: 'QA Usable Invite 2', phone: '923009660006', roleId: ROLE_SALES_EMPLOYEE },
    });
    expect(perms.error).toBeNull();
    await sql(`DELETE FROM user_permissions WHERE user_id = '${perms.data.id}'`).catch(() => undefined);
    await sql(`DELETE FROM memberships WHERE user_id = '${perms.data.id}'`).catch(() => undefined);
    await sql(`DELETE FROM auth.identities WHERE user_id = '${perms.data.id}'`).catch(() => undefined);
    await sql(`DELETE FROM auth.users WHERE id = '${perms.data.id}'`).catch(() => undefined);
    await sql(`DELETE FROM users WHERE id = '${perms.data.id}'`).catch(() => undefined);
  });

  it('accepts the invitation with the app\'s own credential and no help from the tests', async () => {
    expect(inviteeId).toBeTruthy();

    // qaAnonClient signs in exactly as the browser does — no credential minting.
    const signIn = await qaAnonClient.auth.signInWithPassword({
      email: 'user-923009660005@agrishop.auth.local',
      password: 'AgriShop-923009660005-2026!',
    });
    expect(signIn.error, `the invitee cannot sign in: ${signIn.error?.message}`).toBeNull();
    // The identity is the app user: authorization resolves for them, not for a stranger.
    expect(signIn.data.user?.id).toBe(inviteeId);

    const onboard = await qaAnonClient.rpc('complete_member_onboarding');
    expect(onboard.error).toBeNull();
    expect(onboard.data.activated).toBe(1);
    expect(await statusOf(inviteeId)).toBe('active');

    await qaAnonClient.auth.signOut();
  });
});
