/**
 * The farmer-marketplace contract — is it actually the boundary it claims to be?
 *
 * The Owner side of the marketplace was built (0184, 0185) so a future Farmer App can connect to
 * a contract that already exists. The Farmer App does not exist, and this suite does not pretend
 * otherwise: it tests the OWNER side and the READ CONTRACT, over the same paths a consumer will
 * use — the anon key, PostgREST, real JWTs — against the real QA database.
 *
 * The questions this answers, none of which can be answered by reading the migration:
 *
 *   1. Does `anon` reach the curated view, and ONLY the curated view? A public catalogue is the
 *      intent of listing, so the allowlist is the security boundary. If `anon` can also read
 *      `products`, `product_variants`, `shops` or `inventory_movements`, the redaction below is
 *      decoration.
 *   2. Does the toggle mean what it says — off, archived, out of stock, or unlisted all remove
 *      the row from the contract?
 *   3. Is a branch outside the farmer's radius absent EVEN WHEN IT HAS THE PRODUCT? Distance is
 *      the searcher's: the owner sets a location and a switch, and the farmer decides how far to
 *      look (0187). Testing only one direction would let the rule pass while half wrong.
 *   4. Is the FARMER's radius the whole distance rule? A branch ~42 km away must be absent at a
 *      25 km search and present at 60 km with nothing on the owner side changed between the two
 *      — and the writer must take exactly the switch, with no distance argument left to pass.
 *   5. When the same product is available from several eligible branches, is the nearest first?
 *   6. Does the view still carry EXACTLY the allowlisted columns? Compared for equality, so a
 *      column added later fails here instead of quietly becoming public.
 *
 * Every fixture is created and removed by this file, and it runs as its own two branches
 * (Lahore and Multan) with the shared QA tenant untouched.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, execRpcAsUser, qaAnonClient } from '../setup/qa-client';

// ── The two branches of the example, as real shops rows ──────────────────────
// A "branch" in this schema IS a `shops` row: `get_my_branches()` returns `m.tenant_id` joined to
// `shops`, `shopStore` maps `r.shop_id` to the branch it shows, and `BranchEditSheet` writes the
// pin with `set_place(p_table => 'shops', p_id => branch.id)`. So the owner's Lahore and Multan
// branches are created the same way the app creates one.
const LAHORE_BRANCH = 'd8000000-0000-0000-0000-0000000000a0';
const MULTAN_BRANCH = 'd8000000-0000-0000-0000-0000000000b0';
const LAHORE_PRODUCT = 'd8000000-0000-0000-0000-0000000000a1';
const MULTAN_PRODUCT = 'd8000000-0000-0000-0000-0000000000b1';
const LAHORE_VARIANT = 'd8000000-0000-0000-0000-0000000000a2';
const MULTAN_VARIANT = 'd8000000-0000-0000-0000-0000000000b2';
// A second product that exists at BOTH branches, for the nearest-first question.
const SHARED_PRODUCT_L = 'd8000000-0000-0000-0000-0000000000c1';
const SHARED_VARIANT_L = 'd8000000-0000-0000-0000-0000000000c2';
const SHARED_PRODUCT_M = 'd8000000-0000-0000-0000-0000000000c3';
const SHARED_VARIANT_M = 'd8000000-0000-0000-0000-0000000000c4';

const TENANT = '00000000-0000-0000-0000-000000000001';
// The QA fixture owner, who is an active owner member of the shared tenant. Used to prove the
// owner-side RPC still requires authority; the branches below are pinned to this tenant so the
// fixture account's membership is real rather than invented.
const OWNER = '10000000-0000-0000-0000-000000000001';
const EMPLOYEE = '10000000-0000-0000-0000-000000000002';

const RUN = `MKT Contract ${Date.now()}`;
// Two real places ~42 km apart (Lahore and Sheikhupura). Close enough that BOTH can be eligible at
// once — which is what makes the nearest-first question answerable — and far enough that a small
// search radius excludes one of them.
const NEAR = { lat: 31.5204, lng: 74.3587 };
const FAR = { lat: 31.7131, lng: 73.9783 };
// ~320 km away. Outside every radius this contract allows (clamped to 200), so a search from here
// must see neither branch — the "outside the coverage" requirement, stated literally.
const ELSEWHERE = { lat: 30.1575, lng: 71.5249 };

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

/** The anon client is the marketplace identity: no sign-in, exactly the key the app ships. */
const anon = qaAnonClient;

async function viewRows() {
  const { data, error } = await anon.from('marketplace_listings').select('*');
  if (error) throw new Error('view read failed: ' + error.message);
  return data ?? [];
}

async function search(lat: number, lng: number, radiusKm = 25) {
  const { data, error } = await anon.rpc('search_marketplace', {
    p_latitude: lat,
    p_longitude: lng,
    p_radius_km: radiusKm,
  });
  if (error) throw new Error('search failed: ' + error.message);
  return data ?? [];
}

/** Is this listing visible in the contract at all? */
async function listed(variantId: string): Promise<boolean> {
  return (await viewRows()).some((r: any) => r.listing_id === variantId);
}

async function setListed(productId: string, listedFlag: boolean) {
  await sql(
    `UPDATE products SET marketplace_listed = ${listedFlag},
       marketplace_listed_at = CASE WHEN ${listedFlag} THEN now() ELSE NULL END
     WHERE id = '${productId}'`,
  );
}

async function setStock(variantId: string, qty: number) {
  await sql(`UPDATE product_variants SET stock_qty = ${qty} WHERE id = '${variantId}'`);
}

async function setBranchMarketplace(branchId: string, enabled: boolean) {
  // The switch is the owner's whole marketplace decision since 0187: there is no distance column
  // to set, and no radius argument anywhere on the owner side.
  await sql(`UPDATE shops SET marketplace_enabled = ${enabled} WHERE id = '${branchId}'`);
}

async function cleanup() {
  await sql(`DELETE FROM product_variants WHERE id IN ('${LAHORE_VARIANT}','${MULTAN_VARIANT}','${SHARED_VARIANT_L}','${SHARED_VARIANT_M}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM products WHERE id IN ('${LAHORE_PRODUCT}','${MULTAN_PRODUCT}','${SHARED_PRODUCT_L}','${SHARED_PRODUCT_M}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM shops WHERE id IN ('${LAHORE_BRANCH}','${MULTAN_BRANCH}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

async function createBranch(id: string, name: string, place: { lat: number; lng: number }, enabled: boolean) {
  await sql(`
    INSERT INTO shops (id, name, latitude, longitude, location_label, location_source, marketplace_enabled)
    VALUES ('${id}', '${name}', ${place.lat}, ${place.lng}, '${RUN}', 'qa-fixture', ${enabled})
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude, marketplace_enabled = EXCLUDED.marketplace_enabled
  `);
}

async function createProduct(productId: string, branchId: string, name: string, listedFlag: boolean) {
  await sql(`
    INSERT INTO products (id, name, category, shop_id, is_active, base_unit, marketplace_listed, marketplace_listed_at)
    VALUES ('${productId}', '${name}', 'seed', '${branchId}', true, 'kg', ${listedFlag},
            CASE WHEN ${listedFlag} THEN now() ELSE NULL END)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true,
      marketplace_listed = EXCLUDED.marketplace_listed,
      marketplace_listed_at = CASE WHEN EXCLUDED.marketplace_listed THEN now() ELSE NULL END
  `);
}

async function createVariant(variantId: string, productId: string, price: number, stock: number, active = true) {
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty, is_active)
    VALUES ('${variantId}', '${productId}', '50kg bag', ${price}, 3100, 50, 5, ${stock}, ${active})
    ON CONFLICT (id) DO UPDATE SET selling_price = ${price}, cost_price = 3100, stock_qty = ${stock}, is_active = ${active}
  `);
}

beforeAll(async () => {
  await cleanup();

  // The owner's two branches, both listing. No distance is set on either: since 0187 the only
  // distance in play is the one the searcher passes to `search_marketplace`.
  await createBranch(LAHORE_BRANCH, `${RUN} Near branch`, NEAR, true);
  await createBranch(MULTAN_BRANCH, `${RUN} Far branch`, FAR, true);

  // One product unique to each branch, and one that both branches carry.
  await createProduct(LAHORE_PRODUCT, LAHORE_BRANCH, `${RUN} Wheat Seed Near`, true);
  await createProduct(MULTAN_PRODUCT, MULTAN_BRANCH, `${RUN} Wheat Seed Far`, true);
  await createProduct(SHARED_PRODUCT_L, LAHORE_BRANCH, `${RUN} Shared Fertilizer`, true);
  await createProduct(SHARED_PRODUCT_M, MULTAN_BRANCH, `${RUN} Shared Fertilizer`, true);

  await createVariant(LAHORE_VARIANT, LAHORE_PRODUCT, 4500, 20);
  await createVariant(MULTAN_VARIANT, MULTAN_PRODUCT, 4400, 15);
  await createVariant(SHARED_VARIANT_L, SHARED_PRODUCT_L, 5000, 10);
  await createVariant(SHARED_VARIANT_M, SHARED_PRODUCT_M, 5100, 10);
}, 120_000);

afterAll(async () => {
  await cleanup();
}, 120_000);

describe('the marketplace contract is the only public door', () => {
  it('anon reads the curated view', async () => {
    const rows = await viewRows();
    expect(Array.isArray(rows)).toBe(true);
  });

  it('anon cannot read any base table the contract is built from', async () => {
    // The whole point of the allowlist: if any of these succeeds, the redaction is decoration.
    for (const table of ['products', 'product_variants', 'shops', 'inventory_movements']) {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(error, `${table} must not be readable by anon`).toBeTruthy();
      expect(data ?? []).toEqual([]);
    }
  });

  it('anon cannot flip a branch marketplace switch', async () => {
    const { error } = await anon.rpc('set_marketplace_settings', {
      p_shop_id: TENANT,
      p_enabled: true,
    });
    expect(error).toBeTruthy();
    // And the branch is unchanged by the attempt.
    const [row] = (await sql(`SELECT marketplace_enabled FROM shops WHERE id = '${LAHORE_BRANCH}'`)).rows;
    expect(row.marketplace_enabled).toBe(true);
  });

  it('anon cannot write to the contract', async () => {
    const { error } = await anon.from('marketplace_listings').insert({ branch_name: 'forged' });
    expect(error).toBeTruthy();
  });

  it('the view carries exactly the allowlisted columns', async () => {
    // EQUALITY, not a subset: a column added to the view later must fail this test rather than
    // silently become public. This is the assertion that catches a leak arriving by edit.
    const ALLOWLIST = [
      'availability', 'base_unit', 'branch_address', 'branch_id', 'branch_latitude',
      'branch_location_label', 'branch_longitude', 'branch_name', 'category', 'image_url',
      'listed_at', 'listing_id', 'product_id', 'product_name', 'qty_step', 'selling_price',
      'unit_size', 'updated_at', 'variant_id', 'variant_label',
    ].sort();

    const rows = await viewRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(ALLOWLIST);
  });

  it('the contract never carries cost, stock count, threshold, supplier, code or owner fields', async () => {
    const forbidden = [
      'cost_price', 'low_stock_threshold', 'stock_qty', 'company_id', 'barcode', 'sku',
      'batch_id', 'expiry_date', 'owner_id', 'join_code', 'phone', 'created_by',
    ];
    const rows = await viewRows();
    const keys = Object.keys(rows[0] ?? {});
    for (const f of forbidden) expect(keys).not.toContain(f);
  });
});

describe('the listing switch means what it says', () => {
  it('a listed product at a listed branch appears', async () => {
    expect(await listed(LAHORE_VARIANT)).toBe(true);
  });

  it('unlisting the product removes it', async () => {
    await setListed(LAHORE_PRODUCT, false);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await setListed(LAHORE_PRODUCT, true);
    expect(await listed(LAHORE_VARIANT)).toBe(true);
  });

  it('turning the branch switch off removes everything that branch lists', async () => {
    await setBranchMarketplace(LAHORE_BRANCH, false);
    const rows = await viewRows();
    expect(rows.some((r: any) => r.branch_id === LAHORE_BRANCH)).toBe(false);
    // The other branch is untouched: one branch switching off is not a shop-wide change.
    expect(rows.some((r: any) => r.branch_id === MULTAN_BRANCH)).toBe(true);
    await setBranchMarketplace(LAHORE_BRANCH, true);
  });

  it('archiving the product removes it, through the same path delete_product uses', async () => {
    await sql(`UPDATE products SET is_active = false WHERE id = '${LAHORE_PRODUCT}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await sql(`UPDATE products SET is_active = true WHERE id = '${LAHORE_PRODUCT}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(true);
  });

  it('a pack with nothing on the shelf is not offered', async () => {
    await setStock(LAHORE_VARIANT, 0);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await setStock(LAHORE_VARIANT, 20);
    expect(await listed(LAHORE_VARIANT)).toBe(true);
  });

  it('an inactive pack is not offered', async () => {
    await sql(`UPDATE product_variants SET is_active = false WHERE id = '${LAHORE_VARIANT}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await sql(`UPDATE product_variants SET is_active = true WHERE id = '${LAHORE_VARIANT}'`);
  });

  it('a branch that has no location cannot appear', async () => {
    // Distance cannot be measured from a place that was never pinned, so such a branch is
    // excluded rather than shown to everyone or to no one by accident.
    await sql(`UPDATE shops SET latitude = NULL, longitude = NULL WHERE id = '${LAHORE_BRANCH}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await sql(`UPDATE shops SET latitude = ${NEAR.lat}, longitude = ${NEAR.lng} WHERE id = '${LAHORE_BRANCH}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(true);
  });

  it('a listing with no price is not offered', async () => {
    await sql(`UPDATE product_variants SET selling_price = 0 WHERE id = '${LAHORE_VARIANT}'`);
    expect(await listed(LAHORE_VARIANT)).toBe(false);
    await sql(`UPDATE product_variants SET selling_price = 4500 WHERE id = '${LAHORE_VARIANT}'`);
  });
});

describe('a farmer only sees branches that can actually reach them', () => {
  it('a search from far away sees neither branch', async () => {
    const rows = await search(ELSEWHERE.lat, ELSEWHERE.lng, 200);
    expect(rows.some((r: any) => r.branch_id === LAHORE_BRANCH)).toBe(false);
    expect(rows.some((r: any) => r.branch_id === MULTAN_BRANCH)).toBe(false);
  });

  it('a search at a branch sees that branch', async () => {
    const rows = await search(NEAR.lat, NEAR.lng, 1);
    expect(rows.some((r: any) => r.branch_id === LAHORE_BRANCH)).toBe(true);
  });

  it('a branch outside the coverage is absent EVEN THOUGH it has the product in stock', async () => {
    // The requirement, stated literally. The near branch has its product listed and 20 in stock;
    // from a point that cannot reach it, it must not appear.
    const [stock] = (await sql(`SELECT stock_qty FROM product_variants WHERE id = '${LAHORE_VARIANT}'`)).rows;
    expect(Number(stock.stock_qty)).toBeGreaterThan(0);
    const rows = await search(ELSEWHERE.lat, ELSEWHERE.lng, 200);
    expect(rows.some((r: any) => r.listing_id === LAHORE_VARIANT)).toBe(false);
  });

  it("the farmer's radius is the only distance rule, in both directions", async () => {
    // The far branch is ~42 km from the searcher. At the farmer's 25 km it must be out; at the
    // farmer's 60 km it must be in — with no owner-side setting touched between the two calls.
    // That is the 0187 correction stated as a test: the branch has no coverage to negotiate.
    const narrow = await search(NEAR.lat, NEAR.lng, 25);
    expect(narrow.some((r: any) => r.branch_id === MULTAN_BRANCH)).toBe(false);
    expect(narrow.some((r: any) => r.branch_id === LAHORE_BRANCH)).toBe(true);
    const widened = await search(NEAR.lat, NEAR.lng, 60);
    expect(widened.some((r: any) => r.branch_id === MULTAN_BRANCH)).toBe(true);
  });

  it('a point outside Pakistan is refused, so the search is not a general geo oracle', async () => {
    const { error } = await anon.rpc('search_marketplace', { p_latitude: 40.7128, p_longitude: -74.006 });
    expect(error).toBeTruthy();
    expect(String(error?.message)).toContain('not in Pakistan');
  });

  it('an unknown category is refused rather than answered as "nothing found"', async () => {
    const { error } = await anon.rpc('search_marketplace', {
      p_latitude: NEAR.lat,
      p_longitude: NEAR.lng,
      p_radius_km: 25,
      p_category: 'not_a_category',
    });
    expect(error).toBeTruthy();
    expect(String(error?.message)).toContain('unknown category');
  });
});

describe('the same product at several branches comes back nearest first', () => {
  it('orders by distance, and keeps one row per branch', async () => {
    // Both branches carry "Shared Fertilizer". From the near branch's own point the near row must
    // come first; from the far branch's point the far row must. Both are returned — collapsing is
    // the consumer's choice, and the contract keeps the option.
    const fromNear = await search(NEAR.lat, NEAR.lng, 60);
    const sharedNear = fromNear.filter((r: any) => r.product_name === `${RUN} Shared Fertilizer`);
    expect(sharedNear.length).toBe(2);
    expect(sharedNear[0].branch_id).toBe(LAHORE_BRANCH);
    expect(Number(sharedNear[0].distance_km)).toBeLessThan(Number(sharedNear[1].distance_km));

    const fromFar = await search(FAR.lat, FAR.lng, 60);
    const sharedFar = fromFar.filter((r: any) => r.product_name === `${RUN} Shared Fertilizer`);
    expect(sharedFar.length).toBe(2);
    expect(sharedFar[0].branch_id).toBe(MULTAN_BRANCH);
    expect(Number(sharedFar[0].distance_km)).toBeLessThan(Number(sharedFar[1].distance_km));
  });

  it('reports distance as a number the caller can check', async () => {
    const rows = await search(NEAR.lat, NEAR.lng, 25);
    const own = rows.find((r: any) => r.branch_id === LAHORE_BRANCH);
    expect(own).toBeTruthy();
    expect(Number(own.distance_km)).toBeLessThan(1); // searched from the branch's own point
  });
});

/**
 * The owner-side authority tests run against the shared QA tenant, because that is the branch the
 * fixture owner is actually a member of — inventing a membership would test a fixture rather than
 * the rule. Its location is saved and restored around these tests, since the shared branch has
 * never been pinned and must be left that way.
 */
describe('the owner side still requires authority', () => {
  const TENANT_LOCATION = { lat: 31.4187, lng: 73.0791 }; // Faisalabad

  beforeAll(async () => {
    await sql(
      `UPDATE shops SET latitude = ${TENANT_LOCATION.lat}, longitude = ${TENANT_LOCATION.lng},
         location_label = '${RUN} authority fixture', location_source = 'qa-fixture'
       WHERE id = '${TENANT}'`,
    );
  });

  afterAll(async () => {
    // Restored exactly: the shared QA branch had no pin before this suite, and it has none after.
    // There is no radius to restore — 0187 dropped the column.
    await sql(
      `UPDATE shops SET latitude = NULL, longitude = NULL, location_label = NULL,
         location_source = NULL, marketplace_enabled = false
       WHERE id = '${TENANT}'`,
    );
  });

  it('an owner can set the switch', async () => {
    const { data, error } = await execRpcAsUser(OWNER, 'set_marketplace_settings', {
      p_shop_id: TENANT,
      p_enabled: true,
    });
    expect(error).toBeNull();
    expect(data?.marketplace_enabled).toBe(true);
    // The writer decides a switch and nothing else: the answer carries no distance because there
    // is no distance an owner can set.
    expect('marketplace_radius_km' in (data ?? {})).toBe(false);
  });

  it('the Branches read carries the switch and no distance', async () => {
    // The screen reads its state from `get_my_branches()`, so the correction has to be visible
    // there too: the switch is present, and a radius column is gone rather than merely hidden.
    //
    // The read was reshaped by 0188: it returns a row per BRANCH (`branch_id`, `tenant_id`) for the
    // shop the account is working in, not the pre-0188 row per SHOP (`shop_id`) across every
    // membership. Looking for `shop_id` therefore found nothing while the data was all there — the
    // suite was asserting a field name the contract had removed, which `marketplaceContractGuard`
    // cannot see because it reads the migration, not the live return shape.
    const { data, error } = await execRpcAsUser(OWNER, 'get_my_branches', {});
    expect(error).toBeNull();
    const row = (data ?? []).find((b: any) => b.tenant_id === TENANT);
    expect(row, 'the shared QA branch must be one of the owner memberships').toBeTruthy();
    expect('marketplace_enabled' in row).toBe(true);
    expect('marketplace_radius_km' in row).toBe(false);
    // The switch the owner just set is what this read carries, per branch.
    expect(row.marketplace_enabled).toBe(true);
  });

  it('an employee cannot', async () => {
    const { error } = await execRpcAsUser(EMPLOYEE, 'set_marketplace_settings', {
      p_shop_id: TENANT,
      p_enabled: true,
    });
    expect(error).toBeTruthy();
    expect(String(error)).toContain('NOT_AUTHORIZED');
  });

  it('the three-argument writer no longer exists, so a stale caller cannot pass a distance', async () => {
    // 0187 replaced `set_marketplace_settings(uuid, boolean, numeric)` with the two-argument
    // form. A caller still sending a distance must fail loudly rather than have it ignored.
    const { error } = await execRpcAsUser(OWNER, 'set_marketplace_settings', {
      p_shop_id: TENANT,
      p_enabled: true,
      p_radius_km: 40,
    });
    expect(error).toBeTruthy();
  });

  it('listing a branch that has no location is refused, not accepted-and-ignored', async () => {
    // A branch with no pin cannot be measured against any radius, so accepting the switch would
    // tell the owner they had listed when they could never appear.
    //
    // The switch is deliberately left ON from the previous test, and its value is compared before
    // and after: the refusal must leave the row exactly as it was, which is a stronger statement
    // than "it ends up false".
    const [before] = (await sql(`SELECT marketplace_enabled FROM shops WHERE id = '${TENANT}'`)).rows;

    try {
      await sql(`UPDATE shops SET latitude = NULL, longitude = NULL WHERE id = '${TENANT}'`);
      const { error } = await execRpcAsUser(OWNER, 'set_marketplace_settings', {
        p_shop_id: TENANT,
        p_enabled: true,
      });
      expect(error).toBeTruthy();
      expect(String(error)).toContain('no location');

      const [after] = (await sql(`SELECT marketplace_enabled FROM shops WHERE id = '${TENANT}'`)).rows;
      expect(after.marketplace_enabled).toBe(before.marketplace_enabled);
    } finally {
      // Restored unconditionally, so a failed assertion here cannot leave the shared branch
      // unpinned for the tests that follow — which is exactly how this test broke its neighbours
      // the first time it ran.
      await sql(
        `UPDATE shops SET latitude = ${TENANT_LOCATION.lat}, longitude = ${TENANT_LOCATION.lng} WHERE id = '${TENANT}'`,
      );
    }
  });

  it('turning the switch off is a decision of its own, and there is nothing else to keep', async () => {
    // 0187: the switch is the whole owner-side decision. It is set on, reported on, set off and
    // reported off — and no stored distance appears in either answer, because none exists.
    const on = await execRpcAsUser(OWNER, 'set_marketplace_settings', { p_shop_id: TENANT, p_enabled: true });
    expect(on.error).toBeNull();
    expect(on.data?.marketplace_enabled).toBe(true);
    expect('marketplace_radius_km' in (on.data ?? {})).toBe(false);

    const off = await execRpcAsUser(OWNER, 'set_marketplace_settings', { p_shop_id: TENANT, p_enabled: false });
    expect(off.error).toBeNull();
    expect(off.data?.marketplace_enabled).toBe(false);
    expect('marketplace_radius_km' in (off.data ?? {})).toBe(false);
  });
});
