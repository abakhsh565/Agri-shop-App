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
 * 2. THE BRANCH. `delete_branch` (0168) erases one branch completely, resolves its people
 *    (who keeps a login, who loses one) and refuses the main branch and the caller's only
 *    branch. It is reached from Settings in the app and had NO lane until this file, which
 *    is exactly the kind of RPC that rots silently.
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

// This suite's own fixture identities. Fresh UUIDs: two files must never share one, or one
// suite's cleanup deletes the other's rows mid-run (tests/unit/fixtureIdCollision.test.ts).
const ACTOR = '9c000000-0000-4000-8000-000000000001';
const MAIN_SHOP = '9c000000-0000-4000-8000-000000000002';
const SIDE_SHOP = '9c000000-0000-4000-8000-000000000003';
const MAIN_CUSTOMER = '9c000000-0000-4000-8000-000000000004';
const SIDE_CUSTOMER = '9c000000-0000-4000-8000-000000000005';
const SIDE_EMPLOYEE = '9c000000-0000-4000-8000-000000000006';

const ACTOR_PHONE = '923009630001';
const SIDE_EMPLOYEE_PHONE = '923009630002';
/** The number that registers, deletes itself, and registers again. Local spelling on purpose. */
const FRESH_PHONE_LOCAL = '03009630003';
const FRESH_PHONE_E164 = '923009630003';

/** The seeded QA owner, used only as the platform admin who approves a registration. */
const SEEDED_OWNER = '10000000-0000-0000-0000-000000000003';

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

async function cleanup() {
  // Shops first (they cascade), then identities, then the request rows by number — the
  // request row is the one this lane exists to prove is gone, so it is also cleaned here
  // in case a run aborted between the delete and the assertion.
  // A shop the registration flow created and a failed run left orphaned. `purge_shop_data`
  // erases the shop's records AND the shop row, which is the same erasure the product does.
  await sql(`SELECT public.purge_shop_data(id) FROM shops WHERE name LIKE 'QA Fresh Shop%'`).catch(() => undefined);
  // Rows a failed run can leave behind: the customer this lane puts inside the fresh
  // account's shop, matched by name and by the number (the phone carries its own unique
  // index, so a survivor would make the next run fail for the wrong reason).
  await sql(`DELETE FROM customers WHERE name LIKE 'QA Delete %' OR name = 'QA Fresh Customer'`).catch(() => undefined);
  await sql(`DELETE FROM customers WHERE phone LIKE '%9630003'`).catch(() => undefined);
  await sql(`DELETE FROM products WHERE name LIKE 'QA Fresh %'`).catch(() => undefined);
  await sql(`DELETE FROM memberships WHERE tenant_id IN ('${MAIN_SHOP}','${SIDE_SHOP}')`).catch(() => undefined);
  await sql(`DELETE FROM user_active_shops WHERE shop_id IN ('${MAIN_SHOP}','${SIDE_SHOP}')`).catch(() => undefined);
  // People BEFORE shops: `users.shop_id` references `shops(id)` with no cascade, so a shop cannot
  // be dropped while a profile still names it — the very FK the product's own deletion has to
  // sequence around, and doing it in the wrong order here left a QA shop behind after every run.
  for (const phone of TOUCHED_PHONES) {
    const digits = phone.replace(/\D/g, '');
    await sql(
      `DELETE FROM audit_events WHERE user_id IN (SELECT id FROM users WHERE phone LIKE '%${digits.slice(-10)}')`
    ).catch(() => undefined);
    await sql(`DELETE FROM users WHERE phone LIKE '%${digits.slice(-10)}'`).catch(() => undefined);
    await sql(
      `DELETE FROM shop_requests WHERE right(regexp_replace(owner_phone, '\\D', '', 'g'), 10) = '${digits.slice(-10)}'`
    ).catch(() => undefined);
  }
  await sql(`DELETE FROM shops WHERE id IN ('${MAIN_SHOP}','${SIDE_SHOP}')`).catch(() => undefined);
  await sql(
    `DELETE FROM auth.users WHERE email LIKE '%${FRESH_PHONE_E164}%' OR email LIKE '%${ACTOR_PHONE}%' OR email LIKE '%${SIDE_EMPLOYEE_PHONE}%'`
  ).catch(() => undefined);
}

beforeAll(async () => {
  await cleanup();

  // ── The branch that will be deleted, and the one that must survive ────────────
  await sql(`
    INSERT INTO shops (id, name) VALUES
      ('${MAIN_SHOP}', 'QA Delete Main'),
      ('${SIDE_SHOP}', 'QA Delete Side')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO branches (tenant_id, name, is_default, is_active) VALUES
      ('${MAIN_SHOP}', 'QA Delete Main - Main', true,  true),
      ('${SIDE_SHOP}', 'QA Delete Side - Main', true,  true)
  `);

  // The actor's home is MAIN_SHOP; they are also an admin of SIDE_SHOP. That is what makes
  // SIDE_SHOP a *branch* they may delete rather than their own account.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${ACTOR}', 'QA Delete Actor', '${ACTOR_PHONE}', 'admin', true, true, '${MAIN_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status) VALUES
      ('${ACTOR}', '${MAIN_SHOP}', 'owner', 'active'),
      ('${ACTOR}', '${SIDE_SHOP}', 'admin', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'
  `);

  // Someone who works ONLY in the side branch: their login must not outlive it.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${SIDE_EMPLOYEE}', 'QA Delete Side Employee', '${SIDE_EMPLOYEE_PHONE}', 'employee', false, true, '${SIDE_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES ('${SIDE_EMPLOYEE}', '${SIDE_SHOP}', 'employee', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET status = 'active'
  `);

  // Records in both branches, so "erased" and "kept" are distinguishable.
  await sql(`
    INSERT INTO customers (id, name, shop_id) VALUES
      ('${MAIN_CUSTOMER}', 'QA Delete Main Customer', '${MAIN_SHOP}'),
      ('${SIDE_CUSTOMER}', 'QA Delete Side Customer', '${SIDE_SHOP}')
    ON CONFLICT (id) DO NOTHING
  `);

  // The actor must be able to sign in for the RPCs below to authorize anything.
  const signingIn = await execRpcAsUser(ACTOR, 'get_my_permissions', {});
  expect(signingIn.error).toBeNull();
});

afterAll(async () => {
  await cleanup();
});

describe('Deleting a branch erases that branch and nothing else', () => {
  it('removes the branch, its records and the logins that only worked there', async () => {
    // The branch really is populated before the delete, or the assertions below would pass
    // on an empty database for the wrong reason.
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE shop_id = '${SIDE_SHOP}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(1);

    const result = await execRpcAsUser(ACTOR, 'delete_branch', {
      p_shop_id: SIDE_SHOP,
      p_reason: 'QA lane',
    });
    expect(result.error).toBeNull();
    expect(result.data?.success).toBe(true);
    // What the caller is told, counted inside the deleting transaction.
    expect(result.data?.erased?.customers).toBe(1);
    expect(result.data?.employees_removed).toBe(1);
    expect(result.data?.employees_kept).toBe(0);

    // The branch, its records, its membership and its branch row are gone...
    expect(await count(`SELECT count(*)::int AS c FROM shops WHERE id = '${SIDE_SHOP}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE tenant_id = '${SIDE_SHOP}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE shop_id = '${SIDE_SHOP}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE tenant_id = '${SIDE_SHOP}'`)).toBe(0);
    // ...and so is the login that only ever worked there, credential included.
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS c FROM auth.users WHERE id = '${SIDE_EMPLOYEE}'`)).toBe(0);

    // The branch that was NOT deleted is untouched, and the actor still belongs to it.
    expect(await count(`SELECT count(*)::int AS c FROM shops WHERE id = '${MAIN_SHOP}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE id = '${MAIN_CUSTOMER}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM users WHERE id = '${ACTOR}'`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS c FROM memberships WHERE user_id = '${ACTOR}' AND tenant_id = '${MAIN_SHOP}'`)).toBe(1);
  });

  it('refuses to delete the branch the account itself lives in', async () => {
    const result = await execRpcAsUser(ACTOR, 'delete_branch', { p_shop_id: MAIN_SHOP });
    expect(result.error).toMatch(/MAIN_BRANCH/);
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
