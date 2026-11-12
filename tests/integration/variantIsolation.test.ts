/**
 * Variant isolation — is `product_variants` actually scoped to the caller's shop?
 *
 * This suite exists because a read-only schema probe of the QA database found:
 *
 *   * `product_variants_select` was `USING (true)` for `authenticated` — the only
 *     business table in the schema with a literal-true SELECT policy;
 *   * `product_variants` carries **no `shop_id` column at all** — it is reached
 *     through `product_id → products.shop_id`;
 *   * `products_select` is `(shop_id = current_shop_id())`, so the tenant boundary
 *     exists one join away and is only as strong as the policy on the child table;
 *   * `cost_price` lives on this table, and `productsStore` reads the
 *     `product_variants_public` view for non-admins — but that view did not exist
 *     in the database at all, so the employee path had no cost_price redaction.
 *
 * A policy of `true` is not automatically a hole: every legitimate read is filtered
 * by the caller's own query. The question this suite answers is what the DATABASE
 * does when the client does not filter — i.e. whether a cross-tenant read succeeds
 * through the real JWT → PostgREST → RLS path. That is the layer the rule
 * "enforced at the correct layer" is about, and it is not answerable by reading the
 * app's code.
 *
 * Fixed by migration 0178 (tenant boundary on every policy) and 0179 (the employee
 * projection without `cost_price`, base table admin-only). Self-contained: creates
 * its own two tenants + products + variants and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, insertAsUser, selectAsUser, updateAsUser } from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-00000000d0d0';
const OWNER_A = 'd4000000-0000-0000-0000-00000000000a';
const OWNER_B = 'd4000000-0000-0000-0000-00000000000b';
const EMP_A = 'd4000000-0000-0000-0000-0000000000e1';
const ROLE_EMPLOYEE = 'a0000000-0000-0000-0000-000000000001';
const PRODUCT_A = 'd4000000-0000-0000-0000-0000000000a1';
const PRODUCT_B = 'd4000000-0000-0000-0000-0000000000b1';
const VARIANT_A = 'd4000000-0000-0000-0000-0000000000a2';
const VARIANT_B = 'd4000000-0000-0000-0000-0000000000b2';
const INJECTED = 'd4000000-0000-0000-0000-0000000000bb';
const COST_A = 1234.5678;
const COST_B = 4321.8765;
const RUN = `QA Variant Iso ${Date.now()}`;

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function variantB(): Promise<any> {
  const r = await sql(`SELECT stock_qty, selling_price, cost_price FROM product_variants WHERE id = '${VARIANT_B}'`);
  return r.rows[0];
}

async function cleanup() {
  await sql(`DELETE FROM product_variants WHERE id IN ('${VARIANT_A}','${VARIANT_B}','${INJECTED}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM products WHERE id IN ('${PRODUCT_A}','${PRODUCT_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM user_permissions WHERE user_id = '${EMP_A}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_A}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM shops WHERE id = '${TENANT_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();

  await sql(`INSERT INTO shops (id, name) VALUES ('${TENANT_B}', '${RUN}') ON CONFLICT (id) DO NOTHING`);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}', '${RUN} A', '923009820001', 'admin', true, true, '${TENANT_A}'),
      ('${OWNER_B}', '${RUN} B', '923009820002', 'admin', true, true, '${TENANT_B}'),
      ('${EMP_A}',   '${RUN} employee A', '923009820003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}', role = 'employee', status = 'active'
     WHERE user_id = '${EMP_A}'
  `);
  await sql(`
    INSERT INTO products (id, name, category, shop_id, is_active)
    VALUES
      ('${PRODUCT_A}', '${RUN} product A', 'other', '${TENANT_A}', true),
      ('${PRODUCT_B}', '${RUN} product B', 'other', '${TENANT_B}', true)
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
    VALUES
      ('${VARIANT_A}', '${PRODUCT_A}', '1kg', 500, ${COST_A}, 1, 10, 100),
      ('${VARIANT_B}', '${PRODUCT_B}', '1kg', 700, ${COST_B}, 1, 10, 100)
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanup();
});

describe('variant isolation — is the child table scoped to the caller shop', () => {
  it('the fixture is real: both variants exist and carry cost data', async () => {
    const rows = await sql(
      `SELECT id, cost_price FROM product_variants WHERE id IN ('${VARIANT_A}','${VARIANT_B}')`,
    );
    expect(rows.rows.length, 'both variants must exist for this suite to prove anything').toBe(2);
  });

  it('tenant A can still read its own variant', async () => {
    const seen = await selectAsUser(OWNER_A, 'product_variants', '*', { id: VARIANT_A });
    expect((seen.data ?? []).length, 'the isolation must not break the tenant own read').toBe(1);
  });

  it('tenant A cannot read tenant B variant by id', async () => {
    const seen = await selectAsUser(OWNER_A, 'product_variants', '*', { id: VARIANT_B });
    expect((seen.data ?? []).length, 'a targeted cross-tenant read succeeded').toBe(0);
  });

  it('cost_price is not exposed to a tenant that does not own the variant', async () => {
    const seen = await selectAsUser(OWNER_A, 'product_variants', 'id, cost_price', { id: VARIANT_B });
    expect((seen.data ?? []).length).toBe(0);
  });

  it('an employee cannot read cost_price from the base table', async () => {
    // 0179 narrowed the base table's SELECT to the owning shop's admins. The employee path is
    // `product_variants_public`, which is what the store already tries first.
    const seen = await selectAsUser(EMP_A, 'product_variants', 'id, cost_price', { id: VARIANT_A });
    expect((seen.data ?? []).length, 'an employee read the base table').toBe(0);
  });

  it('an employee sees the sellable fields from the projection, without cost', async () => {
    // The projection the store reads for non-admins. `cost_price` must not be a column of it,
    // and the row must still be there or employees cannot sell.
    const seen = await selectAsUser(EMP_A, 'product_variants_public', '*', { id: VARIANT_A });
    expect(seen.error).toBeNull();
    const rows = seen.data ?? [];
    expect(rows.length, 'the employee projection returned no sellable unit').toBe(1);
    expect(Object.keys(rows[0] ?? {})).not.toContain('cost_price');
  });

  it('a cross-tenant UPDATE cannot change the other shop’s stock or price', async () => {
    const before = await variantB();
    // Through PostgREST with the tenant A JWT: RLS on UPDATE is `app_is_admin()`, which is
    // tenant-blind — `app_is_admin()` answers "is an admin", not "is an admin of THIS row".
    const { error } = await updateAsUser(
      OWNER_A, 'product_variants', { stock_qty: 1, selling_price: 1 }, { id: VARIANT_B },
    );
    const after = await variantB();
    expect(
      { stock: after.stock_qty, price: after.selling_price },
      `cross-tenant write ${error ? `was refused (${error})` : 'SUCCEEDED'} — tenant B stock/price must be untouched`,
    ).toEqual({ stock: before.stock_qty, price: before.selling_price });
  });

  it('a cross-tenant INSERT cannot attach a variant to the other shop’s product', async () => {
    await sql(`DELETE FROM product_variants WHERE id = '${INJECTED}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await insertAsUser(OWNER_A, 'product_variants', {
      id: INJECTED, product_id: PRODUCT_B, name: 'injected', selling_price: 1, cost_price: 1,
      unit_size: 1, low_stock_threshold: 1, stock_qty: 0,
    });
    const rows = await sql(`SELECT id FROM product_variants WHERE id = '${INJECTED}'`);
    await sql(`DELETE FROM product_variants WHERE id = '${INJECTED}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    expect(rows.rows.length, 'a variant was written onto another shop’s product').toBe(0);
  });
});
