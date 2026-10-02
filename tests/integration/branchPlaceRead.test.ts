/**
 * A branch carries its own pin, on the one read that may see it.
 *
 * THE BUG THIS LANE EXISTS FOR, found by exercising the branch-edit picker in a browser: opening
 * Edit on a branch the account was not currently working in always showed "Choose on the map",
 * even for a branch whose pin was in the database. The sheet read the place with
 * `select … from shops where id = …`, and `shops` has exactly one SELECT policy —
 * `id = current_shop_id()`. That policy is correct: you may read the shop you are working in and
 * no other. What made it a bug was the consequence: for any other branch the query came back as an
 * EMPTY ARRAY, not an error, so the screen silently reported "this branch has never been located"
 * about a branch that had a location.
 *
 * The fix is not to widen the policy — that would expose every column of every branch to fix one
 * display — but to read the place from `get_my_branches()`, the read that is allowed to answer
 * about every branch the caller belongs to, in the same call that already lists them.
 *
 * So this lane holds two facts:
 *
 *   1. the direct `shops` read really cannot see another branch (so the old code could not have
 *      worked, and a future screen must not try it again); and
 *   2. `get_my_branches()` returns the pin — coordinates, label, source and the address the map
 *      service gave — for a branch the caller is not standing in, and nothing about anybody else's.
 *
 * Self-contained: its own tenants, owners and shops, all removed after the run.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, selectAsUser } from '../setup/qa-client';

const OWNER = '9c000000-0000-4000-8000-0000000000b1';
const OTHER_OWNER = '9c000000-0000-4000-8000-0000000000b2';
/** The branch this account registered with — `users.shop_id`, which is what `current_shop_id()` answers. */
const HOME_SHOP = '9c000000-0000-4000-8000-0000000000b3';
/** The second branch: the account is a member of it, and is NOT standing in it. */
const OTHER_BRANCH = '9c000000-0000-4000-8000-0000000000b4';
const STRANGER_SHOP = '9c000000-0000-4000-8000-0000000000b5';

const OWNER_PHONE = '923009650001';
const OTHER_PHONE = '923009650002';

/** Multan — inside Pakistan, and the coordinates a real Nominatim hit returns for Ghanta Ghar. */
const MULTAN = { lat: 30.1988297, lng: 71.4679573 };

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function cleanup() {
  await sql(`DELETE FROM branches WHERE tenant_id IN ('${HOME_SHOP}','${OTHER_BRANCH}','${STRANGER_SHOP}')`).catch(() => undefined);
  await sql(`DELETE FROM memberships WHERE tenant_id IN ('${HOME_SHOP}','${OTHER_BRANCH}','${STRANGER_SHOP}')`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE id IN ('${OWNER}','${OTHER_OWNER}')`).catch(() => undefined);
  await sql(`DELETE FROM shops WHERE id IN ('${HOME_SHOP}','${OTHER_BRANCH}','${STRANGER_SHOP}')`).catch(() => undefined);
  // The auth identities these fixtures signed in with, for the same reason every other lane does
  // it: an app user deleted without its auth row leaves a login nothing can use, and the app's
  // credential address is derived from the phone, so a stray holder blocks the next run.
  await sql(
    `DELETE FROM auth.users a WHERE a.email LIKE 'user-92300965%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`
  ).catch(() => undefined);
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO shops (id, name) VALUES
      ('${HOME_SHOP}', 'QA Branch Place Home'),
      ('${OTHER_BRANCH}', 'QA Branch Place Second'),
      ('${STRANGER_SHOP}', 'QA Branch Place Stranger')
  `);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES
      ('${OWNER}', 'QA Branch Place Owner', '${OWNER_PHONE}', 'admin', true, true, '${HOME_SHOP}'),
      ('${OTHER_OWNER}', 'QA Branch Place Stranger', '${OTHER_PHONE}', 'admin', true, true, '${STRANGER_SHOP}')
  `);
  // The membership row that makes the second branch the account's at all. Written explicitly
  // rather than assumed: this lane is about reading a branch the caller belongs to and is not
  // standing in, so that membership has to exist before anything else is measured.
  await sql(`UPDATE memberships SET role = 'owner', status = 'active' WHERE user_id IN ('${OWNER}','${OTHER_OWNER}')`);
  await sql(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    SELECT '${OWNER}', '${OTHER_BRANCH}', 'owner', 'active'
    WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = '${OWNER}' AND tenant_id = '${OTHER_BRANCH}')
  `);

  // Both owners must be able to sign in, or every assertion below would be about authentication
  // rather than about the rule it exists to test.
  expect((await execRpcAsUser(OWNER, 'get_my_permissions', {})).error).toBeNull();
  expect((await execRpcAsUser(OTHER_OWNER, 'get_my_permissions', {})).error).toBeNull();
});

afterAll(async () => {
  await cleanup();
});

describe('The pin travels with the branch, on the read that may see it', () => {
  it('pins the branch the account is not working in', async () => {
    const saved = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'shops',
      p_id: OTHER_BRANCH,
      p_latitude: MULTAN.lat,
      p_longitude: MULTAN.lng,
      p_label: 'Ghanta Ghar (Clock Tower)',
      p_address: 'Ghanta Ghar (Clock Tower), Multan, Punjab, Pakistan',
      p_source: 'openstreetmap',
    });
    // Writing a setting on another branch of the same account is allowed — `set_place` checks
    // membership of the row's tenant, not of the shop being worked in.
    expect(saved.error).toBeNull();
    expect(saved.data?.ok).toBe(true);
  });

  it('returns it with the branch, so the edit sheet never has to ask `shops`', async () => {
    const { data, error } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    expect(error).toBeNull();

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const second = rows.find((r) => r.shop_id === OTHER_BRANCH);
    expect(second).toBeTruthy();
    expect(Number(second!.latitude)).toBeCloseTo(MULTAN.lat, 4);
    expect(Number(second!.longitude)).toBeCloseTo(MULTAN.lng, 4);
    expect(second!.location_label).toBe('Ghanta Ghar (Clock Tower)');
    expect(second!.location_source).toBe('openstreetmap');
    // The address is the one the map service returned, carried along with the point.
    expect(second!.address).toBe('Ghanta Ghar (Clock Tower), Multan, Punjab, Pakistan');
    // And the branch is genuinely NOT the one being worked in — which is the whole point.
    expect(second!.is_current).toBe(false);
  });

  it('reports a branch that was never pinned as null rather than as a point', async () => {
    const { data } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    const home = ((data ?? []) as Array<Record<string, unknown>>).find((r) => r.shop_id === HOME_SHOP);
    expect(home).toBeTruthy();
    // A branch that has never been located has no coordinates and no label. The app reads this as
    // "choose on the map", which is the truth; 0/0 would be a point in the Atlantic.
    expect(home!.latitude).toBeNull();
    expect(home!.longitude).toBeNull();
    expect(home!.location_label).toBeNull();
    expect(home!.location_source).toBeNull();
  });

  it('cannot be read from `shops` directly — which is why the list carries it', async () => {
    // The current branch: readable, as the policy intends.
    const mine = await selectAsUser(OWNER, 'shops', 'id, latitude, longitude', { id: HOME_SHOP });
    expect(mine.error).toBeNull();
    expect(mine.data?.length).toBe(1);

    // Any other branch: an empty result, NOT an error. This is the shape that made a screen say
    // "no location" about a pinned branch, and it is asserted so that nobody re-derives the direct
    // read believing it failed loudly.
    const theirs = await selectAsUser(OWNER, 'shops', 'id, latitude, longitude', { id: OTHER_BRANCH });
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it('says nothing about a branch the caller is not a member of', async () => {
    const { data } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    const ids = ((data ?? []) as Array<Record<string, unknown>>).map((r) => r.shop_id);
    expect(ids).toContain(HOME_SHOP);
    expect(ids).toContain(OTHER_BRANCH);
    expect(ids).not.toContain(STRANGER_SHOP);

    // And the stranger's branch cannot be pinned by guessing its id — the URL is not an authority.
    const refused = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'shops',
      p_id: STRANGER_SHOP,
      p_latitude: MULTAN.lat,
      p_longitude: MULTAN.lng,
      p_label: 'Not mine',
    });
    expect(refused.error).toBeTruthy();

    // The stranger's owner sees their own branch, and only theirs.
    const { data: strangerRows } = await execRpcAsUser(OTHER_OWNER, 'get_my_branches', {});
    const strangerIds = ((strangerRows ?? []) as Array<Record<string, unknown>>).map((r) => r.shop_id);
    expect(strangerIds).toEqual([STRANGER_SHOP]);
  });
});
