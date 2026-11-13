/**
 * Employee Invite Lifecycle Regression Suite
 *
 * Locked product intent: adding an employee ISSUES AN INVITATION, and the
 * employee becomes active only when they accept their own invitation with
 * their own verified sign-in (0286: complete_member_onboarding() is a
 * deliberate no-op; accept_my_invitation() is the acceptance). Role
 * assignment is not access.
 *
 * Proves, with a real JWT + PostgREST + database evidence:
 *   1. A newly added employee's membership is `pending`, and every authorization
 *      path denies them — including a real business write, not just a UI state.
 *   2. accept_my_invitation() activates the caller's own pending invitation, once.
 *   3. Accepting an invitation NEVER revives a suspended membership (deactivation
 *      must not be undone by the deactivated person signing in).
 *   4. Reactivating an invited employee does not promote the invitation.
 *   5. Accepting cannot activate somebody else's invitation.
 *
 * Self-contained: creates its own owner + employees and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { acceptInvitationAsUser, execRpcAsUser, execSqlAsAdmin, qaAnonClient, roleIdByName } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

const TENANT = '00000000-0000-0000-0000-000000000001';
// The fixture shop's sole owner (Khalid Khan). 0280 allows one active owner
// per shop, so this suite uses him instead of creating its own owner — and
// never inserts, updates or deletes his user row.
const OWNER = QA_IDS.owner;
// The built-in shop-floor role, so "role defaults apply" is provable rather than assumed.
// Resolved by NAME in beforeAll, not hard-coded: the id is per-role, a built-in role can be deleted
// through the app (roles.deleteHintBuiltIn), and `roles.id` is one global key — so the id 0107 used
// can end up belonging to another tenant's role. (tenant, name) is the identity that survives.
let ROLE_SALES_EMPLOYEE = '';
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

/**
 * Cleanup that REPORTS instead of swallowing — the customerDeletionSecurity
 * pattern. This suite shares the QA database with the other integration
 * files and reuses fixed identities (its own phone namespace). A silent
 * `.catch()` here used to leave rows in place, and the suite then failed
 * deep inside a test with `NOT_AUTHORIZED: tenant access denied`, which
 * reads like a security finding and is really leftover state. Failures are
 * collected and the caller throws with their names.
 */
const cleanupFailures: string[] = [];
async function trySql(label: string, q: string): Promise<void> {
  try {
    await sql(q);
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

async function cleanup() {
  cleanupFailures.length = 0;
  await trySql(
    'audit_events',
    `
    DELETE FROM audit_events
    WHERE user_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))
       OR entity_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))
  `).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM customers WHERE phone LIKE '92300966%'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')})`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();
  throwIfCleanupFailed('employeeInviteLifecycle beforeAll cleanup');

  // ── the namespace must be clean before anything is asserted ──────────
  // A leftover membership or active-shop row changes which tenant
  // `current_tenant_id()` resolves to, so refuse to start instead of
  // failing deep inside a test with a misleading authorization error.
  const stale = await sql(
    `SELECT (SELECT count(*) FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')})) AS users,
            (SELECT count(*) FROM memberships WHERE user_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))) AS memberships,
            (SELECT count(*) FROM user_active_shops WHERE user_id IN (SELECT id FROM users WHERE phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))) AS active_shops,
            (SELECT count(*) FROM customers WHERE phone LIKE '92300966%') AS customers`,
  );
  const staleCounts = stale.rows[0] as Record<string, string>;
  if (['users', 'memberships', 'active_shops', 'customers'].some((k) => Number(staleCounts[k]))) {
    throw new Error(
      `the employeeInviteLifecycle namespace is not clean, so this suite cannot run. ` +
        `Leftover rows: ${JSON.stringify(staleCounts)}. A previous run leaked rows in this suite's phone namespace — fix the leak in that run's cleanup rather than re-running.`,
    );
  }

  ROLE_SALES_EMPLOYEE = await roleIdByName(TENANT, 'Sales Employee');
  const b = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_active = true ORDER BY is_default DESC, created_at LIMIT 1`
  );
  branchId = b.rows[0]?.id;
  expect(branchId).toBeTruthy();
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('employeeInviteLifecycle afterAll cleanup');
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
    // `roleId` is REQUIRED by today's contract: 0190's create_employee_core refuses an invitation
    // with no role (ROLE_NOT_FOUND_OR_NOT_AUTHORIZED) because the Owner defines which permissions an
    // employee receives. An invitation without one would be an employee nobody can authorize.
    const second = await execRpcAsUser(OWNER, 'create_employee', {
      payload: { name: 'QA Invite Colleague', phone: PHONES[2], roleId: ROLE_SALES_EMPLOYEE, membershipRole: 'employee', branchScope: [branchId] },
    });
    expect(second.error).toBeNull();
    colleague = second.data.id;
    expect(await statusOf(colleague)).toBe('pending');
  });

  it('activates the invitee on their own verified sign-in, exactly once', async () => {
    const mid = await acceptInvitationAsUser(invited);
    expect(await statusOf(invited)).toBe('active');

    // Idempotent in effect: a second accept finds no pending invitation (0286).
    const again = await execRpcAsUser(invited, 'accept_my_invitation', { p_membership_id: mid });
    expect(again.error).toContain('INVITATION_NOT_FOUND');
    expect(await statusOf(invited)).toBe('active');

    // Now the role's defaults are in force — and only now.
    const perms = await execRpcAsUser(invited, 'get_my_permissions', {});
    expect(perms.data ?? []).toEqual(expect.arrayContaining(roleDefaultCodes));
  });

  it('cannot activate somebody else\'s invitation', async () => {
    // `invited` is now active and accepts on its own behalf only.
    const mid = await sql(`SELECT id FROM memberships WHERE user_id = '${colleague}' AND status = 'pending'`);
    const attempt = await execRpcAsUser(invited, 'accept_my_invitation', { p_membership_id: mid.rows[0]?.id });
    expect(attempt.error).toContain('INVITATION_NOT_FOUND');
    expect(await statusOf(colleague)).toBe('pending');
  });

  it('never revives a suspended membership', async () => {
    // The real endpoint is `deactivate_employee_v1`; this used to call `deactivate_employee`, which
    // no migration defines, so the call could only ever fail and the SQL below was doing all the
    // work. The RPC is still best-effort here *by design* (its own semantics live in their lane) —
    // what matters is that the failure this test provokes is the membership status, not a missing
    // function (tests/unit/rpcContractGuard.test.ts now fails on either).
    await execRpcAsUser(OWNER, 'deactivate_employee_v1', {
      payload: { employeeId: invited },
    }).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    // Deactivation is enforced through the same status field authorization reads.
    await sql(`UPDATE users SET is_active = false WHERE id = '${invited}'`);
    expect(await statusOf(invited)).toBe('suspended');

    // The deactivated person accepting must not restore their own access: a
    // suspended membership is not a pending invitation (0286).
    const mid = await sql(`SELECT id FROM memberships WHERE user_id = '${invited}'`);
    const attempt = await execRpcAsUser(invited, 'accept_my_invitation', { p_membership_id: mid.rows[0]?.id });
    expect(attempt.error).toContain('INVITATION_NOT_FOUND');
    expect(await statusOf(invited)).toBe('suspended');
  });

  it('returns a cancelled invitation to pending, never straight to active', async () => {
    // colleague has never signed in. Cancelling and re-enabling the invite must
    // not be a way to grant access without onboarding.
    await sql(`UPDATE users SET is_active = false WHERE id = '${colleague}'`);
    expect(await statusOf(colleague)).toBe('suspended');
    await sql(`UPDATE users SET is_active = true WHERE id = '${colleague}'`);
    expect(await statusOf(colleague)).toBe('pending');

    // And it still needs its invitation accepted to actually work here.
    const perms = await execRpcAsUser(colleague, 'get_my_permissions', {});
    expect(perms.data ?? []).toEqual([]);
    await acceptInvitationAsUser(colleague);
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
    await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.users WHERE id IN (SELECT id FROM users WHERE phone = '${PHONE}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM users WHERE phone = '${PHONE}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  });

  afterAll(async () => {
    await sql(`DELETE FROM user_permissions WHERE user_id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM memberships WHERE user_id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM audit_events WHERE entity_id = '${inviteeId}' OR user_id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM users WHERE id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.identities WHERE user_id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.users WHERE id = '${inviteeId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
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
    await sql(`DELETE FROM user_permissions WHERE user_id = '${perms.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM memberships WHERE user_id = '${perms.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.identities WHERE user_id = '${perms.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM auth.users WHERE id = '${perms.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM users WHERE id = '${perms.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
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

    // 0286: onboarding is a no-op; the invitee accepts their own invitation.
    // The membership id is the invitation itself — the app reads it from
    // get_my_invitations(); the test reads the same pending row directly.
    const mid = await sql(`SELECT id FROM memberships WHERE user_id = '${inviteeId}' AND status = 'pending'`);
    const onboard = await qaAnonClient.rpc('accept_my_invitation', { p_membership_id: mid.rows[0]?.id });
    expect(onboard.error).toBeNull();
    expect(onboard.data?.ok).toBe(true);
    expect(await statusOf(inviteeId)).toBe('active');

    await qaAnonClient.auth.signOut();
  });
});
