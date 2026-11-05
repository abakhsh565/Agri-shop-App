/**
 * A branch carries its own pin, on the one read that may see it.
 *
 * THE BUG THIS LANE EXISTS FOR, found by exercising the branch-edit picker in a browser: opening
 * Edit on a branch the account was not currently working in always showed "Choose on the map",
 * even for a branch whose pin was in the database. The sheet read the place with
 * `select … from shops where id = …`, and `shops` has exactly one SELECT policy —
 * `id = current_shop_id()`. That policy is correct: you may read the shop you are working in and
 * no other. What made it a bug was the consequence: for any other store the query came back as an
 * EMPTY ARRAY, not an error, so the screen silently reported "this branch has never been located"
 * about a branch that had a location.
 *
 * The fix is not to widen the policy — that would expose every column of every tenant to fix one
 * display — but to read the place from `get_my_branches()`, the read that is allowed to answer
 * about every branch the caller belongs to, in the same call that already lists them.
 *
 * REWRITTEN for the post-0188 model, and the rewrite is the point of this lane's second life. The
 * earlier version modelled "another branch" as a second *tenant* and asserted on a `shop_id` field:
 * it inserted two rows into `shops`, made the owner a member of both, and called
 * `set_place(p_table => 'shops', p_id => <shop>)`. `0188` made the distinction real —
 * `get_my_branches()` returns BRANCHES (`branch_id`, `tenant_id`, …) of the tenant being worked in,
 * and a pin is written to the `branches` row through `set_place(p_table => 'branches', …)`, which is
 * what `BranchEditor` actually calls. So this file now creates one tenant with two branches and a
 * second tenant that must stay invisible, which is the contract the product has.
 *
 * So the lane holds three facts:
 *
 *   1. `get_my_branches()` returns the pin — coordinates, label, source and the address the map
 *      service gave — for a branch the caller is not standing in, and reports `is_current` so the
 *      screen can tell the working branch from a sibling;
 *   2. a branch that was never pinned reports null rather than 0/0, which is a point in the Atlantic;
 *   3. the direct `shops` read still cannot see another tenant, and nothing about a branch the
 *      caller is not a member of is returned or writable — the URL is not an authority.
 *
 * Self-contained: its own tenants, owners and branches, all removed after the run.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, selectAsUser } from '../setup/qa-client';
import { deleteFixtureUsers } from '../setup/fixtures';

const OWNER = '9c000000-0000-4000-8000-0000000000b1';
const OTHER_OWNER = '9c000000-0000-4000-8000-0000000000b2';
/** The account's tenant, and the branch it is working in (`users.shop_id`, what `current_shop_id()` answers). */
const HOME_TENANT = '9c000000-0000-4000-8000-0000000000b3';
const MAIN_BRANCH = '9c000000-0000-4000-8000-0000000000b8';
/** The same tenant's second branch: the account belongs to it, and is NOT standing in it. */
const SECOND_BRANCH = '9c000000-0000-4000-8000-0000000000b4';
/** Somebody else's tenant, and the branch inside it. */
const STRANGER_TENANT = '9c000000-0000-4000-8000-0000000000b5';
const STRANGER_BRANCH = '9c000000-0000-4000-8000-0000000000b6';

const OWNER_PHONE = '923009650001';
const OTHER_PHONE = '923009650002';

/** Multan — inside Pakistan, and the coordinates a real Nominatim hit returns for Ghanta Ghar. */
const MULTAN = { lat: 30.1988297, lng: 71.4679573 };

async function sql(query: string) {
  return execSqlAsAdmin(query);
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
  await trySql('branches', sql(`DELETE FROM branches WHERE tenant_id IN ('${HOME_TENANT}','${STRANGER_TENANT}')`));
  await trySql('memberships', sql(`DELETE FROM memberships WHERE tenant_id IN ('${HOME_TENANT}','${STRANGER_TENANT}')`));
  // Through the shared helper, not a bare DELETE: `set_place` writes a `location_updated` audit row
  // and `audit_events.user_id` is NO ACTION, so a bare delete is silently blocked and the users
  // survive. `placeLocation` is where that leak was measured; this is the same fix.
  await deleteFixtureUsers([OWNER, OTHER_OWNER]);
  await trySql('shops', sql(`DELETE FROM shops WHERE id IN ('${HOME_TENANT}','${STRANGER_TENANT}')`));
  // The auth identities these fixtures signed in with, for the same reason every other lane does
  // it: an app user deleted without its auth row leaves a login nothing can use, and the app's
  // credential address is derived from the phone, so a stray holder blocks the next run.
  await trySql('auth.users', sql(`DELETE FROM auth.users a WHERE a.email LIKE 'user-92300965%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`));
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO shops (id, name) VALUES
      ('${HOME_TENANT}', 'QA Branch Place Home'),
      ('${STRANGER_TENANT}', 'QA Branch Place Stranger')
  `);
  // Two branches of ONE tenant. `is_default` decides which one the account is working in, so the
  // sibling below is genuinely not the current branch rather than merely named as if it were not.
  await sql(`
    INSERT INTO branches (id, tenant_id, name, is_active, is_default) VALUES
      ('${MAIN_BRANCH}', '${HOME_TENANT}', 'QA Place Main', true, true),
      ('${SECOND_BRANCH}', '${HOME_TENANT}', 'QA Place Second', true, false),
      ('${STRANGER_BRANCH}', '${STRANGER_TENANT}', 'QA Place Stranger Branch', true, true)
  `);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES
      ('${OWNER}', 'QA Branch Place Owner', '${OWNER_PHONE}', 'admin', true, true, '${HOME_TENANT}'),
      ('${OTHER_OWNER}', 'QA Branch Place Stranger', '${OTHER_PHONE}', 'admin', true, true, '${STRANGER_TENANT}')
  `);
  // The membership row that makes both branches the account's at all, and the reason it is `owner`:
  // `get_my_branches()` admits a non-owner only to branches in its explicit `branch_scope`, so a
  // member left on the legacy `admin` role with a NULL scope would see an empty list — and every
  // assertion below would then be about the fixture rather than about the read.
  await sql(`UPDATE memberships SET role = 'owner', status = 'active' WHERE user_id IN ('${OWNER}','${OTHER_OWNER}')`);

  // Both owners must be able to sign in, or every assertion below would be about authentication
  // rather than about the rule it exists to test.
  expect((await execRpcAsUser(OWNER, 'get_my_permissions', {})).error).toBeNull();
  expect((await execRpcAsUser(OTHER_OWNER, 'get_my_permissions', {})).error).toBeNull();
  throwIfCleanupFailed('branchPlaceRead beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('branchPlaceRead afterAll cleanup');
});

describe('The pin travels with the branch, on the read that may see it', () => {
  it('pins the branch the account is not working in', async () => {
    const saved = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: SECOND_BRANCH,
      p_latitude: MULTAN.lat,
      p_longitude: MULTAN.lng,
      p_label: 'Ghanta Ghar (Clock Tower)',
      p_address: 'Ghanta Ghar (Clock Tower), Multan, Punjab, Pakistan',
      p_source: 'openstreetmap',
    });
    // Pinning a sibling branch of the account's own tenant is allowed. The rule this asserts is
    // tenant membership, not standing in the branch — a branch of somebody else's tenant is refused
    // further down.
    expect(saved.error, `a sibling branch of the caller's own tenant must be pinnable: ${saved.error}`).toBeNull();
    expect(saved.data?.ok).toBe(true);
  });

  it('returns it with the branch, so the edit sheet never has to ask `shops`', async () => {
    const { data, error } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    expect(error).toBeNull();

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const second = rows.find((r) => r.branch_id === SECOND_BRANCH);
    expect(second, 'the sibling branch must be in the caller\'s own list').toBeTruthy();
    expect(second!.tenant_id, 'the branch must name its tenant, not masquerade as one').toBe(HOME_TENANT);
    expect(Number(second!.latitude)).toBeCloseTo(MULTAN.lat, 4);
    expect(Number(second!.longitude)).toBeCloseTo(MULTAN.lng, 4);
    expect(second!.location_label).toBe('Ghanta Ghar (Clock Tower)');
    expect(second!.location_source).toBe('openstreetmap');
    // The address is the one the map service returned, carried along with the point.
    expect(second!.address).toBe('Ghanta Ghar (Clock Tower), Multan, Punjab, Pakistan');
    // And the branch is genuinely NOT the one being worked in — which is the whole point.
    expect(second!.is_current).toBe(false);
    expect(second!.is_main).toBe(false);
  });

  it('reports a branch that was never pinned as null rather than as a point', async () => {
    const { data } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const home = rows.find((r) => r.branch_id === MAIN_BRANCH);
    expect(home, 'the branch the account is working in must be listed').toBeTruthy();
    // A branch that has never been located has no coordinates and no label. The app reads this as
    // "choose on the map", which is the truth; 0/0 would be a point in the Atlantic.
    expect(home!.latitude).toBeNull();
    expect(home!.longitude).toBeNull();
    expect(home!.location_label).toBeNull();
    expect(home!.location_source).toBeNull();
    // The un-pinned branch IS the working one, and the read has to say so — that is what lets the
    // screen distinguish "you are here and it is not pinned" from "you are not here".
    expect(home!.is_current).toBe(true);
    expect(home!.is_main).toBe(true);
  });

  it('cannot be read from `shops` directly — which is why the list carries it', async () => {
    // The working tenant: readable, as the policy intends.
    const mine = await selectAsUser(OWNER, 'shops', 'id', { id: HOME_TENANT });
    expect(mine.error).toBeNull();
    expect(mine.data?.length).toBe(1);

    // Any other tenant: an empty result, NOT an error. This is the shape that made a screen say
    // "no location" about a pinned branch, and it is asserted so that nobody re-derives the direct
    // read believing it failed loudly. `shops` holds tenants, so the sibling branch is not a `shops`
    // read at all — which is exactly why the branch list has to carry its own pin.
    const theirs = await selectAsUser(OWNER, 'shops', 'id', { id: STRANGER_TENANT });
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  it('says nothing about a branch the caller is not a member of', async () => {
    const { data } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    const ids = ((data ?? []) as Array<Record<string, unknown>>).map((r) => r.branch_id);
    expect(ids).toContain(MAIN_BRANCH);
    expect(ids).toContain(SECOND_BRANCH);
    expect(ids).not.toContain(STRANGER_BRANCH);

    // And the stranger's branch cannot be pinned by guessing its id — the URL is not an authority.
    const refused = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: STRANGER_BRANCH,
      p_latitude: MULTAN.lat,
      p_longitude: MULTAN.lng,
      p_label: 'Not mine',
    });
    expect(refused.error, 'another tenant\'s branch must not be writable by id').toBeTruthy();
    const strangerPin = await sql(
      `SELECT count(*)::int AS c FROM branches WHERE id = '${STRANGER_BRANCH}' AND latitude IS NOT NULL`
    );
    expect(strangerPin.rows[0].c, 'the refused write persisted nothing').toBe(0);

    // The stranger's owner sees their own branch, and only theirs.
    const { data: strangerRows } = await execRpcAsUser(OTHER_OWNER, 'get_my_branches', {});
    const strangerIds = ((strangerRows ?? []) as Array<Record<string, unknown>>).map((r) => r.branch_id);
    expect(strangerIds).toEqual([STRANGER_BRANCH]);
  });
});
