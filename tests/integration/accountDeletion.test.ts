/**
 * Deleting a number (or a branch) really does leave nothing behind.
 *
 * THE OWNER'S REPORT, which this lane is the answer to:
 *
 *   "if I have deleted the number you have to clear all the data once a number or even
 *    branch is deleted, so if a user again creates an account he will start as a fresh
 *    new user — nothing will show from the previous version."
 *
 * Two halves, because the owner named two things.
 *
 * 1. THE NUMBER. `delete_my_account` (0147) already erased the profile, the membership, the
 *    auth row and — for an owner — the shop and everything in it. What it did NOT erase was
 *    the number's own row in `shop_requests`, and that row is guarded by
 *
 *        CREATE UNIQUE INDEX idx_shop_requests_phone ON shop_requests(owner_phone)
 *
 *    so the number could never register again: the insert collided with a request about a
 *    shop that no longer existed. The data was gone and the doorway was nailed shut. 0170
 *    removes the caller's own request rows, matched on the last ten digits, because the
 *    request may hold the local spelling (`0300…`) while the profile holds the E.164 one
 *    (`92300…`) — the same number written two ways.
 *
 * 2. THE BRANCH. This half used to call `delete_branch` (0168) — one transaction that erased a
 *    branch, resolved its people and refused the main branch. 0191 retired that endpoint for
 *    clients (`REVOKE ALL … FROM PUBLIC, anon, authenticated`, with the comment "The legacy
 *    endpoint erases a TENANT and accounts. It is not a branch API.") and replaced what the app
 *    offers with `archive_operating_branch`. A fixture that keeps calling a revoked RPC measures
 *    nothing, so this half now proves the surviving contract instead: a branch with people in it
 *    cannot be archived until they are moved (`BRANCH_HAS_STAFF`), archiving then hides the branch
 *    and keeps its history, the default branch is still refused, and the other branch — and the
 *    tenant's own records — are untouched. The erasure half of the owner's report is the account
 *    deletion below, which still ends with nothing left behind.
 *
 * WHY IT GOES THROUGH THE REAL RPCs. `insert_shop_request` and `approve_shop_request` are
 * the app's own registration path, so this lane proves the user journey — register, be
 * approved, delete the account, register the same number again — rather than proving that
 * hand-written SQL can be undone by hand-written SQL.
 *
 * Self-contained: creates its own tenants and identities and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

// This suite's own fixture identities. Fresh UUIDs: two files must never share one, or one
// suite's cleanup deletes the other's rows mid-run (tests/unit/fixtureIdCollision.test.ts).
const ACTOR = '9c000000-0000-4000-8000-000000000001';
const MAIN_SHOP = '9c000000-0000-4000-8000-000000000002';
const MAIN_CUSTOMER = '9c000000-0000-4000-8000-000000000004';
const SIDE_EMPLOYEE = '9c000000-0000-4000-8000-000000000006';
/** The two branches inside the one shop: what 0188 settled, a branch is not its own tenant. */
const MAIN_BRANCH = '9c000000-0000-4000-8000-000000000007';
const SIDE_BRANCH = '9c000000-0000-4000-8000-000000000008';

const ACTOR_PHONE = '923009630001';
const SIDE_EMPLOYEE_PHONE = '923009630002';
/** The number that registers, deletes itself, and registers again. Local spelling on purpose. */
const FRESH_PHONE_LOCAL = '03009630003';
const FRESH_PHONE_E164 = '923009630003';

/** The seeded QA owner, used only as the platform admin who approves a registration. */
const SEEDED_OWNER = QA_IDS.owner;

const TOUCHED_PHONES = [ACTOR_PHONE, SIDE_EMPLOYEE_PHONE, FRESH_PHONE_E164, FRESH_PHONE_LOCAL];

/** Ids created by the registration flow itself, handed from one step to the next. */
let freshUserId = '';
let freshShopId = '';
let freshShopRequestId = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function count(query: string): Promise<number> {
  const { rows } = await sql(query);
  return rows[0]?.c ?? 0;
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
  // Shops first (they cascade), then identities, then the request rows by number — the
  // request row is the one this lane exists to prove is gone, so it is also cleaned here
  // in case a run aborted between the delete and the assertion.
  // A shop the registration flow created and a failed run left orphaned. `purge_shop_data`
  // erases the shop's records AND the shop row, which is the same erasure the product does.
  await trySql('select', sql(`SELECT public.purge_shop_data(id) FROM shops WHERE name LIKE 'QA Fresh Shop%'`));
  // Rows a failed run can leave behind: the customer this lane puts inside the fresh
  // account's shop, matched by name and by the number (the phone carries its own unique
  // index, so a survivor would make the next run fail for the wrong reason).
  await trySql('customers', sql(`DELETE FROM customers WHERE name LIKE 'QA Delete %' OR name = 'QA Fresh Customer'`));
  await trySql('customers-2', sql(`DELETE FROM customers WHERE phone LIKE '%9630003'`));
  await trySql('products', sql(`DELETE FROM products WHERE name LIKE 'QA Fresh %'`));
  await trySql('memberships', sql(`DELETE FROM memberships WHERE tenant_id = '${MAIN_SHOP}'`));
  await trySql('user_active_shops', sql(`DELETE FROM user_active_shops WHERE shop_id = '${MAIN_SHOP}'`));
  // People BEFORE shops: `users.shop_id` references `shops(id)` with no cascade, so a shop cannot
  // be dropped while a profile still names it — the very FK the product's own deletion has to
  // sequence around, and doing it in the wrong order here left a QA shop behind after every run.
  for (const phone of TOUCHED_PHONES) {
    const digits = phone.replace(/\D/g, '');
    await trySql('audit_events', sql(`DELETE FROM audit_events WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '%${digits.slice(-10)}')`));
    await trySql('users', sql(`DELETE FROM users WHERE phone LIKE '%${digits.slice(-10)}'`));
    await trySql('shop_requests', sql(`DELETE FROM shop_requests WHERE right(regexp_replace(owner_phone, '\\D', '', 'g'), 10) = '${digits.slice(-10)}'`));
  }
  await trySql('shops', sql(`DELETE FROM shops WHERE id = '${MAIN_SHOP}'`));
  await trySql('auth.users', sql(`DELETE FROM auth.users WHERE email LIKE '%${FRESH_PHONE_E164}%' OR email LIKE '%${ACTOR_PHONE}%' OR email LIKE '%${SIDE_EMPLOYEE_PHONE}%'`));
}

beforeAll(async () => {
  await cleanup();

  // ── One shop with two branches: the one that will be archived, and the one that survives ──
  await sql(`
    INSERT INTO shops (id, name) VALUES ('${MAIN_SHOP}', 'QA Delete Main')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO branches (id, tenant_id, name, is_default, is_active) VALUES
      ('${MAIN_BRANCH}', '${MAIN_SHOP}', 'QA Delete Main - Main', true,  true),
      ('${SIDE_BRANCH}', '${MAIN_SHOP}', 'QA Delete Side - Main', false, true)
    ON CONFLICT (id) DO UPDATE SET is_active = true, is_default = EXCLUDED.is_default
  `);

  // The actor owns MAIN_SHOP and is working in the side branch, which is what archive has to
  // resolve: the row that names the archived branch is the one it reassigns to the fallback.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${ACTOR}', 'QA Delete Actor', '${ACTOR_PHONE}', 'admin', true, true, '${MAIN_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status) VALUES
      ('${ACTOR}', '${MAIN_SHOP}', 'owner', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
  `);
  await sql(`
    INSERT INTO user_active_shops (user_id, shop_id, branch_id, updated_at)
    VALUES ('${ACTOR}', '${MAIN_SHOP}', '${SIDE_BRANCH}', now())
    ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, branch_id = EXCLUDED.branch_id
  `);

  // Someone who works ONLY in the side branch. 0191 refuses to archive a branch that still has
  // people scoped to it (BRANCH_HAS_STAFF) rather than silently losing their login or rewriting
  // their scope — the case below walks that refusal and then the move that clears it.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${SIDE_EMPLOYEE}', 'QA Delete Side Employee', '${SIDE_EMPLOYEE_PHONE}', 'employee', false, true, '${MAIN_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope)
    VALUES ('${SIDE_EMPLOYEE}', '${MAIN_SHOP}', 'employee', 'active', ARRAY['${SIDE_BRANCH}']::uuid[])
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active', branch_scope = EXCLUDED.branch_scope
  `);

  // A record at the tenant level, which archiving a branch must not touch (0188: products and
  // customers are tenant-owned, so a branch owns no customer of its own).
  await sql(`
    INSERT INTO customers (id, name, shop_id) VALUES ('${MAIN_CUSTOMER}', 'QA Delete Main Customer', '${MAIN_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);

  // The actor must be able to sign in for the RPCs below to authorize anything.
  const signingIn = await execRpcAsUser(ACTOR, 'get_my_permissions', {});
  expect(signingIn.error).toBeNull();
  throwIfCleanupFailed('accountDeletion beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('accountDeletion afterAll cleanup');
});

describe('Archiving a branch hides it, keeps its history and never decides a login silently', () => {
  it('refuses while somebody is still scoped to it, and names why', async () => {
    // The fixture really is populated, or the refusal below would pass for the wrong reason.
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${SIDE_BRANCH}' AND is_active`)).toBe(1);

    const refused = await execRpcAsUser(ACTOR, 'archive_operating_branch', {
      p_branch_id: SIDE_BRANCH,
      p_reason: 'QA lane',
    });
    expect(refused.error).toMatch(/BRANCH_HAS_STAFF/);
    // Nothing moved while it was refused.
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${SIDE_BRANCH}' AND is_active`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(1);
  });

  it('archives it once its people have somewhere to work, leaving the other branch untouched', async () => {
    // Moving the person is the step 0191 requires instead of rewriting a scope behind their back
    // ("No silent lost login or scope rewrite. Reassign people explicitly first").
    await sql(`
      UPDATE memberships SET branch_scope = ARRAY['${MAIN_BRANCH}']::uuid[]
      WHERE user_id = '${SIDE_EMPLOYEE}' AND tenant_id = '${MAIN_SHOP}'
    `);

    const archived = await execRpcAsUser(ACTOR, 'archive_operating_branch', {
      p_branch_id: SIDE_BRANCH,
      p_reason: 'QA lane',
    });
    expect(archived.error).toBeNull();
    expect(archived.data?.success).toBe(true);
    expect(archived.data?.history_preserved).toBe(true);
    // The fallback is the surviving branch of the same shop, and the working-context row follows it.
    expect(archived.data?.fallback_branch_id).toBe(MAIN_BRANCH);
    expect(await count(`SELECT count(*)::int AS c FROM user_active_shops WHERE user_id = '${ACTOR}' AND branch_id = '${MAIN_BRANCH}'`)).toBe(1);

    // The branch is hidden, and its whole self is still there: archiving preserves the business
    // (0191 performs no DELETE; it sets `is_active = false` and records `historyPreserved`).
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${SIDE_BRANCH}' AND is_active`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${SIDE_BRANCH}'`)).toBe(1);

    // The person keeps their login — that is the point of the refusal above.
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE user_id = '${SIDE_EMPLOYEE}' AND tenant_id = '${MAIN_SHOP}' AND status = 'active'`)).toBe(1);

    // The branch that was NOT archived is untouched, and so is the tenant's own record.
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${MAIN_BRANCH}' AND is_active`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM shops WHERE id = '${MAIN_SHOP}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE id = '${MAIN_CUSTOMER}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${ACTOR}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE user_id = '${ACTOR}' AND tenant_id = '${MAIN_SHOP}'`)).toBe(1);
  });

  it('refuses to archive the branch the account itself lives in', async () => {
    const result = await execRpcAsUser(ACTOR, 'archive_operating_branch', {
      p_branch_id: MAIN_BRANCH,
      p_reason: 'QA lane',
    });
    // The same refusal 0168's delete_branch raised, kept by 0191 (`IF v_branch.is_default THEN RAISE MAIN_BRANCH`).
    expect(result.error).toMatch(/MAIN_BRANCH/);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${MAIN_BRANCH}' AND is_active`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM shops WHERE id = '${MAIN_SHOP}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE id = '${MAIN_CUSTOMER}'`)).toBe(1);
  });
});

describe('Deleting a number lets the same number start again', () => {
  it('creates a real account through the registration path the app itself uses', async () => {
    const request = await execRpcAsUser(SEEDED_OWNER, 'insert_shop_request', {
      p_owner_name: 'QA Fresh Start',
      p_owner_phone: FRESH_PHONE_LOCAL,
      p_phone: FRESH_PHONE_LOCAL,
      p_shop_name: 'QA Fresh Shop',
    });
    expect(request.error).toBeNull();
    expect(request.data?.success).toBe(true);
    freshShopRequestId = request.data.id;

    const approved = await execRpcAsUser(SEEDED_OWNER, 'approve_shop_request', {
      request_id: freshShopRequestId,
      admin_id: SEEDED_OWNER,
    });
    expect(approved.error).toBeNull();
    expect(approved.data?.success).toBe(true);
    freshShopId = approved.data.shop_id;
    freshUserId = approved.data.user_id;
    expect(freshShopId).toBeTruthy();
    expect(freshUserId).toBeTruthy();

    // A shop created through approval carries its own branch, and the new owner is active in it.
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE tenant_id = '${freshShopId}'`)).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE user_id = '${freshUserId}' AND tenant_id = '${freshShopId}' AND status = 'active'`)).toBe(1);

    // The account is real enough to do work: a customer in its own shop.
    await sql(`INSERT INTO customers (name, phone, shop_id) VALUES ('QA Fresh Customer', '${FRESH_PHONE_E164}', '${freshShopId}')`);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE shop_id = '${freshShopId}'`)).toBe(1);
  });

  it('erases everything the number owned, including its registration request', async () => {
    // The number can sign in — it is an account, not a request.
    const before = await execRpcAsUser(freshUserId, 'get_my_permissions', {});
    expect(before.error).toBeNull();

    const deleted = await execRpcAsUser(freshUserId, 'delete_my_account', {});
    expect(deleted.error).toBeNull();
    expect(deleted.data?.ok).toBe(true);
    // It reports what it removed, so a silent no-op cannot look like a success.
    expect(deleted.data?.requests).toBe(1);

    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${freshUserId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM auth.users WHERE id = '${freshUserId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE user_id = '${freshUserId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM shops WHERE id = '${freshShopId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE tenant_id = '${freshShopId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE shop_id = '${freshShopId}'`)).toBe(0);

    // THE POINT OF 0170. The request row is matched on the number's last ten digits, so the
    // local spelling it was stored with is found by the E.164 spelling on the profile.
    expect(await count(
      `SELECT count(*)::int AS c FROM shop_requests WHERE right(regexp_replace(owner_phone, '\\D', '', 'g'), 10) = '${FRESH_PHONE_E164.slice(-10)}'`
    )).toBe(0);
  });

  it('lets the same number register, be approved and start with nothing', async () => {
    // The registration the blocked number could never complete: same phone, same unique index.
    const again = await execRpcAsUser(SEEDED_OWNER, 'insert_shop_request', {
      p_owner_name: 'QA Fresh Start',
      p_owner_phone: FRESH_PHONE_LOCAL,
      p_phone: FRESH_PHONE_LOCAL,
      p_shop_name: 'QA Fresh Shop Again',
    });
    expect(again.error).toBeNull();
    expect(again.data?.success).toBe(true);

    const approved = await execRpcAsUser(SEEDED_OWNER, 'approve_shop_request', {
      request_id: again.data.id,
      admin_id: SEEDED_OWNER,
    });
    expect(approved.error).toBeNull();
    expect(approved.data?.success).toBe(true);

    const newShopId = approved.data.shop_id;
    const newUserId = approved.data.user_id;
    expect(newShopId).not.toBe(freshShopId);
    expect(newUserId).not.toBe(freshUserId);

    // A genuinely fresh account: its own shop, its own branch, and not one row of the old one.
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE shop_id = '${newShopId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM products WHERE shop_id = '${newShopId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM sales WHERE shop_id = '${newShopId}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE tenant_id = '${newShopId}'`)).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE phone = '${FRESH_PHONE_E164}'`)).toBe(0);

    // And it is signable-in and authorized, not just a row.
    const perms = await execRpcAsUser(newUserId, 'get_my_permissions', {});
    expect(perms.error).toBeNull();
    expect(Array.isArray(perms.data)).toBe(true);
    expect((perms.data as unknown[]).length).toBeGreaterThan(0);

    // Leave the environment as it was found.
    const removed = await execRpcAsUser(newUserId, 'delete_my_account', {});
    expect(removed.error).toBeNull();
  });
});
