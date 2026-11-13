/**
 * Employee access model regression suite
 *
 * The database is authoritative (0108 `get_effective_permissions`, 0277 deny-only):
 *
 *     effective = role defaults ∖ denied overrides
 *
 * An employee-level override can only DENY a permission the assigned role
 * holds; it can never grant one (0277 `employee_overrides_restrict_only`).
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
 *   3. Denials reach AUTHORIZATION, not just the screen, and
 *      resetting to "role access only" clears every exception.
 *
 * Self-contained: creates its own owner + employee and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { acceptInvitationAsUser, execRpcAsUser, execSqlAsAdmin, checkAuthAsUser, roleIdByName } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

const TENANT = '00000000-0000-0000-0000-000000000001';
// The fixture shop's sole owner (Khalid Khan). 0280 allows one active owner
// per shop, so this suite uses him instead of creating its own owner — and
// never inserts, updates or deletes his user row.
const OWNER = QA_IDS.owner;
// Built-in roles, resolved by NAME in beforeAll. Hard-coding `a0000000-…-0001` assumed a global id
// that a built-in role keeps forever; it does not. The role can be deleted through the app, and
// `roles.id` is ONE key across tenants, so the id 0107 seeded for this tenant can be held by another
// tenant's role (observed in QA on 2026-10-04: role_deleted a0000000-…-0001, { revokedFrom: 2 }).
let ROLE_SALES_EMPLOYEE = '';
let ROLE_STORE_MANAGER = '';
const EMP_PHONE = '923009670001';

let branchId = '';
let employeeId = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

/**
 * create_employee, with the failure explained.
 *
 * `NOT_AUTHORIZED: tenant access denied` means "the caller has no active
 * membership", and when it appeared intermittently under parallel load it could
 * not be told apart from a genuine product refusal: the message names neither the
 * caller the database saw nor the membership row it judged. This helper captures
 * both at the moment of refusal, so an intermittent failure arrives with its own
 * evidence instead of a guess.
 */
async function createEmployee(payload: Record<string, unknown>) {
  const r = await execRpcAsUser(OWNER, 'create_employee', { payload });
  if (r.error) {
    const [who, user, membership] = await Promise.all([
      checkAuthAsUser(OWNER).catch((e) => ({ error: String(e) })),
      sql(`SELECT id, phone, shop_id, is_active FROM users WHERE id = '${OWNER}'`).catch(() => null),
      sql(`SELECT user_id, tenant_id, role, status FROM memberships WHERE user_id = '${OWNER}'`).catch(() => null),
    ]);
    throw new Error(
      `create_employee refused: ${r.error} :: jwt-sub=${JSON.stringify(who)} ` +
      `user-row=${JSON.stringify(user?.rows ?? [])} membership=${JSON.stringify(membership?.rows ?? [])}`
    );
  }
  return r;
}

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

async function cleanup() {
  await trySql('audit_events', sql(`
    DELETE FROM audit_events
    WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')
       OR entity_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')
  `).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMP_PHONE}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE phone = '${EMP_PHONE}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
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
  ROLE_SALES_EMPLOYEE = await roleIdByName(TENANT, 'Sales Employee');
  ROLE_STORE_MANAGER = await roleIdByName(TENANT, 'Store Manager');
  const b = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_active = true ORDER BY is_default DESC, created_at LIMIT 1`
  );
  branchId = b.rows[0]?.id;
  expect(branchId).toBeTruthy();

  // Assert the precondition THROUGH the API this suite will be authorized by.
  // Without this, a harness write that has not become visible to PostgREST yet
  // shows up as NOT_AUTHORIZED on the first create_employee — a test-infrastructure
  // race reporting itself as the product refusing an owner, which is exactly how it
  // was misread before. It failed intermittently under parallel load.
  const membership = await sql(
    `SELECT m.status, m.tenant_id FROM memberships m WHERE m.user_id = '${OWNER}'`
  );
  expect(
    membership.rows[0]?.status,
    'the suite owner must have an ACTIVE membership before any authorized RPC runs'
  ).toBe('active');
  const perms = await execRpcAsUser(OWNER, 'get_my_permissions', {});
  expect(perms.error, 'the owner must be authorized through the real JWT path').toBeNull();
  throwIfCleanupFailed('employeeAccessOverrides beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  await sql(`DELETE FROM audit_events WHERE user_id = '${OWNER}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE id = '${OWNER}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
});

describe('Employee access = role defaults + this employee\'s exceptions', () => {
  it('writes the exceptions with the employee, skipping codes that do not exist', async () => {
    const created = await createEmployee({
      name: 'QA Override Employee',
      phone: EMP_PHONE,
      roleId: ROLE_SALES_EMPLOYEE,
      branchScope: [branchId],
      overrides: { 'sales.create': false, 'not.a.real.code': true },
    });
    expect(created.error).toBeNull();
    employeeId = created.data.id;
    // The unknown code is skipped rather than failing the whole creation.
    // Only the denial is stored: 0277 allows no granted override at all.
    expect(created.data.overrides).toBe(1);

    const rows = await overridesInDb();
    expect(rows).toEqual([
      { code: 'sales.create', is_granted: false },
    ]);

    // The invitation is still an invitation: holding exceptions grants nothing yet.
    expect(created.data.membershipStatus).toBe('pending');
    expect(await execRpcAsUser(employeeId, 'get_my_permissions', {})).toMatchObject({ data: [] });
  });

  it('applies the denial to authorization once they are active', async () => {
    await acceptInvitationAsUser(employeeId);
    const perms = await myPermissions();
    const defaults = await roleDefaults(ROLE_SALES_EMPLOYEE);

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
      { code: 'sales.create', is_granted: false },
    ]);

    // And the effective access is the NEW role's defaults with those exceptions.
    const perms = await myPermissions();
    const storeDefaults = await roleDefaults(ROLE_STORE_MANAGER);
    expect(perms).toContain('reports.view');   // came with the new role
    expect(storeDefaults).toContain('sales.create');
    expect(perms).not.toContain('sales.create'); // the old denial still means something
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
