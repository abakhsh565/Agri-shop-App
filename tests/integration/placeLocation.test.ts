/**
 * A location is a point, it is picked rather than typed, and it is in Pakistan.
 *
 * THE OWNER'S REQUIREMENT: "this location is not input, it is the location the user can select
 * from the map. User cannot manually enter the location — this location will be saved only via
 * the selected map location."
 *
 * The screen honours that by never offering a text field for it (src/components/ui/LocationField).
 * A screen is not a boundary, so the rule is also held where the row is written:
 *
 *   1. `set_place()` will only write `customers`, `branches` or `shops` — a whitelist, because it
 *      writes coordinates and the only way to be sure it never writes them somewhere unexpected
 *      is to name what it may touch.
 *   2. It refuses a point outside Pakistan's bounding box, and so do the tables themselves.
 *   3. It refuses a row that is not the caller's, even with the right permission.
 *   4. Half a coordinate cannot be stored at all: latitude without longitude is worse than no
 *      location, because it reads as one on screen and cannot be drawn.
 *
 * The map service's own answer is what the app trusts for the country (Nominatim reports
 * `country_code`); the database holds the part that must be true regardless of what any service
 * said — the point is inside this country's box.
 *
 * Self-contained: its own tenant, owner, customer and branch, all removed after the run.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { deleteFixtureUsers } from '../setup/fixtures';

const OWNER = '9c000000-0000-4000-8000-0000000000a1';
const OTHER_OWNER = '9c000000-0000-4000-8000-0000000000a2';
const SHOP = '9c000000-0000-4000-8000-0000000000a3';
const OTHER_SHOP = '9c000000-0000-4000-8000-0000000000a4';
const BRANCH = '9c000000-0000-4000-8000-0000000000a5';
const OTHER_BRANCH = '9c000000-0000-4000-8000-0000000000a6';
const CUSTOMER = '9c000000-0000-4000-8000-0000000000a7';
const OTHER_CUSTOMER = '9c000000-0000-4000-8000-0000000000a8';

const OWNER_PHONE = '923009640001';
const OTHER_PHONE = '923009640002';

/** Lahore — inside Pakistan, and the coordinates a real search returns for it. */
const LAHORE = { lat: 31.5204, lng: 74.3587 };
/** Dubai — the answer that must not be storable, however it arrived. */
const DUBAI = { lat: 25.2048, lng: 55.2708 };

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function count(query: string): Promise<number> {
  const { rows } = await sql(query);
  return rows[0]?.c ?? 0;
}

async function cleanup() {
  await sql(`DELETE FROM customers WHERE id IN ('${CUSTOMER}','${OTHER_CUSTOMER}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM branches WHERE tenant_id IN ('${SHOP}','${OTHER_SHOP}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM memberships WHERE tenant_id IN ('${SHOP}','${OTHER_SHOP}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  // Not a bare `DELETE FROM users`. `set_place` writes a `location_updated` audit row and
  // `audit_events.user_id` is NO ACTION, so the two owners were undeletable — and because one
  // blocked row makes the whole multi-row DELETE fail, BOTH stayed in the shared QA database and
  // were the entire cause of `rbacInvariants` invariant D's `expected 2 to be +0`. The helper
  // clears what account deletion clears, then proves the users are gone instead of assuming it.
  await deleteFixtureUsers([OWNER, OTHER_OWNER]);
  await sql(`DELETE FROM shops WHERE id IN ('${SHOP}','${OTHER_SHOP}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM shop_requests WHERE owner_phone LIKE '%9640001'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  // The auth identities these fixtures signed in with. An app user deleted without its auth row
  // leaves a login behind that nothing can use and every later run has to work around (the app's
  // own credential address is derived from the phone, so a stray holder blocks it) — the same
  // rule the QA baseline reset applies.
  await sql(
    `DELETE FROM auth.users a WHERE (a.email LIKE 'user-9230096400%' OR a.email LIKE 'user-92300964%') AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`
  ).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO shops (id, name) VALUES ('${SHOP}', 'QA Place Shop'), ('${OTHER_SHOP}', 'QA Place Other')
  `);
  await sql(`
    INSERT INTO branches (id, tenant_id, name, is_active) VALUES
      ('${BRANCH}', '${SHOP}', 'QA Place Branch', true),
      ('${OTHER_BRANCH}', '${OTHER_SHOP}', 'QA Place Other Branch', true)
  `);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES
      ('${OWNER}', 'QA Place Owner', '${OWNER_PHONE}', 'admin', true, true, '${SHOP}'),
      ('${OTHER_OWNER}', 'QA Place Other Owner', '${OTHER_PHONE}', 'admin', true, true, '${OTHER_SHOP}')
  `);
  await sql(`UPDATE memberships SET role = 'owner', status = 'active' WHERE user_id IN ('${OWNER}','${OTHER_OWNER}')`);
  await sql(`
    INSERT INTO customers (id, name, shop_id) VALUES
      ('${CUSTOMER}', 'QA Place Customer', '${SHOP}'),
      ('${OTHER_CUSTOMER}', 'QA Place Other Customer', '${OTHER_SHOP}')
  `);

  // Both owners must be able to sign in, or the refusals below would be about authentication
  // rather than about the rule they exist to test.
  expect((await execRpcAsUser(OWNER, 'get_my_permissions', {})).error).toBeNull();
  expect((await execRpcAsUser(OTHER_OWNER, 'get_my_permissions', {})).error).toBeNull();
});

afterAll(async () => {
  await cleanup();
});

describe('Locations are points in Pakistan, and only theirs', () => {
  it('stores a point the map service returned', async () => {
    const saved = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'customers',
      p_id: CUSTOMER,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
      p_label: 'Main Bazaar',
      p_address: 'Main Bazaar, Lahore, Punjab, Pakistan',
      p_source: 'openstreetmap',
    });
    expect(saved.error).toBeNull();
    expect(saved.data?.ok).toBe(true);

    const row = await sql(
      `SELECT latitude, longitude, location_label, location_source, address FROM customers WHERE id = '${CUSTOMER}'`
    );
    expect(Number(row.rows[0].latitude)).toBeCloseTo(LAHORE.lat, 4);
    expect(Number(row.rows[0].longitude)).toBeCloseTo(LAHORE.lng, 4);
    expect(row.rows[0].location_label).toBe('Main Bazaar');
    expect(row.rows[0].location_source).toBe('openstreetmap');
    // The address stored is the one the service gave, not one typed into a field.
    expect(row.rows[0].address).toBe('Main Bazaar, Lahore, Punjab, Pakistan');
  });

  it('refuses a point outside Pakistan', async () => {
    const refused = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'customers',
      p_id: CUSTOMER,
      p_latitude: DUBAI.lat,
      p_longitude: DUBAI.lng,
      p_label: 'Dubai',
      p_source: 'openstreetmap',
    });
    expect(refused.error).toBeTruthy();

    // The real location is untouched — a refused write changed nothing.
    const row = await sql(`SELECT latitude, longitude FROM customers WHERE id = '${CUSTOMER}'`);
    expect(Number(row.rows[0].latitude)).toBeCloseTo(LAHORE.lat, 4);
  });

  it('refuses the table rows a caller does not belong to', async () => {
    const refused = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'customers',
      p_id: OTHER_CUSTOMER,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
      p_label: 'Not mine',
    });
    expect(refused.error).toBeTruthy();
    expect(await count(`SELECT count(*)::int AS c FROM customers WHERE id = '${OTHER_CUSTOMER}' AND latitude IS NOT NULL`)).toBe(0);
  });

  it('refuses a table that has no place at all', async () => {
    const refused = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'users',
      p_id: OWNER,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
    });
    expect(refused.error).toBeTruthy();
  });

  it('refuses half a coordinate, at the RPC and at the table', async () => {
    const viaRpc = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'customers',
      p_id: CUSTOMER,
      p_latitude: LAHORE.lat,
      p_longitude: null,
    });
    expect(viaRpc.error).toBeTruthy();

    // And directly, because a future writer may not use the RPC. A latitude with no longitude
    // reads as a location on screen and cannot be drawn on a map.
    let tableRefused = false;
    try {
      await sql(`UPDATE customers SET latitude = ${LAHORE.lat}, longitude = NULL WHERE id = '${CUSTOMER}'`);
    } catch {
      tableRefused = true;
    }
    expect(tableRefused).toBe(true);
  });

  it('pins a branch, which is a setting rather than a customer edit', async () => {
    const saved = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: BRANCH,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
      p_label: 'Model Town Branch',
      p_source: 'openstreetmap',
      // The address the service gave for this point. It is deliberately something a later clear
      // must leave alone (asserted below), so it is set here rather than left empty.
      p_address: 'Model Town Branch Road, Lahore',
    });
    expect(saved.error).toBeNull();

    const row = await sql(`SELECT latitude, longitude, location_label FROM branches WHERE id = '${BRANCH}'`);
    expect(Number(row.rows[0].latitude)).toBeCloseTo(LAHORE.lat, 4);
    expect(row.rows[0].location_label).toBe('Model Town Branch');

    // Another tenant's branch is not reachable by id: authority over a branch is not authority
    // over a branch of somebody else's shop.
    const crossTenant = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: OTHER_BRANCH,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
    });
    expect(crossTenant.error).toBeTruthy();
    expect(await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${OTHER_BRANCH}' AND latitude IS NOT NULL`)).toBe(0);
  });

  it('clears a pin when both coordinates are sent as nothing, and only the pin', async () => {
    // The picker has a clear control, and the branch sheet saves the name and the pin with one
    // button. Writing nothing when the field was emptied made that control a lie: the sheet said
    // "saved" while the row kept the old point.
    const cleared = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: BRANCH,
      p_latitude: null,
      p_longitude: null,
    });
    expect(cleared.error).toBeNull();
    expect(cleared.data?.cleared).toBe(true);

    const row = await sql(
      `SELECT latitude, longitude, location_label, location_source, address FROM branches WHERE id = '${BRANCH}'`
    );
    expect(row.rows[0].latitude).toBeNull();
    expect(row.rows[0].longitude).toBeNull();
    expect(row.rows[0].location_label).toBeNull();
    expect(row.rows[0].location_source).toBeNull();
    // The address is NOT part of the pin: it predates it, and on a customer it is the row's own
    // words. Clearing a point must not rewrite a value the point did not write.
    expect(row.rows[0].address).toBe('Model Town Branch Road, Lahore');

    // A cleared row can be pinned again — clearing is an edit, not a lock.
    const again = await execRpcAsUser(OWNER, 'set_place', {
      p_table: 'branches',
      p_id: BRANCH,
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
      p_label: 'Model Town Branch',
    });
    expect(again.error).toBeNull();
    expect(again.data?.cleared).toBe(false);
  });

  it('carries the place with a new customer, and with a registration', async () => {
    const created = await execRpcAsUser(OWNER, 'create_customer', {
      payload: {
        name: 'QA Place New Customer',
        phone: '923009640099',
        shopId: SHOP,
        branchId: BRANCH,
        latitude: LAHORE.lat,
        longitude: LAHORE.lng,
        locationLabel: 'Ferozepur Road',
        locationSource: 'openstreetmap',
      },
    });
    expect(created.error).toBeNull();
    const newId = created.data?.id as string;
    const row = await sql(`SELECT latitude, location_label FROM customers WHERE id = '${newId}'`);
    expect(Number(row.rows[0].latitude)).toBeCloseTo(LAHORE.lat, 4);
    expect(row.rows[0].location_label).toBe('Ferozepur Road');

    // The registration form is the only place a place is written before sign-in, so it is the
    // only one that cannot go through set_place — the table's own box is what holds it there.
    await sql(`DELETE FROM shop_requests WHERE owner_phone = '${OWNER_PHONE}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    const request = await execRpcAsUser(OWNER, 'insert_shop_request', {
      p_owner_name: 'QA Place Applicant',
      p_owner_phone: OWNER_PHONE,
      p_phone: OWNER_PHONE,
      p_shop_name: 'QA Place Applicant Shop',
      p_latitude: LAHORE.lat,
      p_longitude: LAHORE.lng,
      p_location_label: 'Gulberg',
      p_location_source: 'openstreetmap',
    });
    expect(request.error).toBeNull();
    expect(request.data?.success).toBe(true);

    const stored = await sql(`SELECT latitude, location_label FROM shop_requests WHERE id = '${request.data.id}'`);
    expect(Number(stored.rows[0].latitude)).toBeCloseTo(LAHORE.lat, 4);
    expect(stored.rows[0].location_label).toBe('Gulberg');

    // A registration that names a point outside the country is refused by the table itself.
    let refused = false;
    try {
      await sql(
        `UPDATE shop_requests SET latitude = ${DUBAI.lat}, longitude = ${DUBAI.lng} WHERE id = '${request.data.id}'`
      );
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);

    await sql(`DELETE FROM customers WHERE id = '${newId}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await sql(`DELETE FROM shop_requests WHERE id = '${request.data.id}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  });
});
