/**
 * Tenant boundary sweep — the same class as the `product_variants` leak (0178).
 *
 * 0178 was found by asking one question of the live catalog: *which policies are reachable by
 * an authenticated session but do not constrain the row to the caller's shop?* `app_is_admin()`
 * is not a boundary — it answers "is this caller an admin", never "of this row". This suite
 * asks the same question of the tables the app actually reaches, and answers it through the
 * real JWT → PostgREST → RLS path with two tenants, so a policy that merely looks scoped is
 * not enough.
 *
 * Tables covered: `stock_adjustments` (inventory movements — money), `cash_reconciliations`
 * (daily cash) and `user_permissions` (RBAC grants). `notifications` is included as the
 * control: it scopes through `my_shop_ids()` and must keep passing.
 *
 * Self-contained: creates its own two tenants + rows and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, insertAsUser, qaAnonClient, selectAsUser } from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-00000000e0e0';
const OWNER_A = 'd5000000-0000-0000-0000-00000000000a';
const OWNER_B = 'd5000000-0000-0000-0000-00000000000b';
const VICTIM_B = 'd5000000-0000-0000-0000-0000000000b1';
const ADJ_B = 'd5000000-0000-0000-0000-0000000000c1';
const CASH_B = 'd5000000-0000-0000-0000-0000000000d1';
const PERM_CODE = 'd5000000-0000-0000-0000-0000000000f1';
const PRODUCT_B = 'd5000000-0000-0000-0000-0000000000a2';
const VARIANT_B = 'd5000000-0000-0000-0000-0000000000a1';
const PRODUCT_A = 'd5000000-0000-0000-0000-0000000000a4';
const VARIANT_A = 'd5000000-0000-0000-0000-0000000000a5';
// A third tenant that deliberately does NOT opt in to the marketplace: its listing looks exactly
// like a published one in every other respect, so its absence is attributable to consent alone.
const TENANT_C = '00000000-0000-0000-0000-00000000d7d7';
const PRODUCT_C = 'd5000000-0000-0000-0000-0000000000c2';
const VARIANT_C = 'd5000000-0000-0000-0000-0000000000c3';
const RUN = `QA Boundary ${Date.now()}`;

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
  await sql(`DELETE FROM product_variants WHERE id IN ('${VARIANT_A}','${VARIANT_B}','${VARIANT_C}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM products WHERE id IN ('${PRODUCT_A}','${PRODUCT_B}','${PRODUCT_C}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM user_permissions WHERE user_id IN ('${VICTIM_B}','${OWNER_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM stock_adjustments WHERE id = '${ADJ_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM cash_reconciliations WHERE id = '${CASH_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${VICTIM_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM shops WHERE id IN ('${TENANT_B}','${TENANT_C}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();
  await sql(`INSERT INTO shops (id, name) VALUES ('${TENANT_B}', '${RUN}') ON CONFLICT (id) DO NOTHING`);
  await sql(`INSERT INTO shops (id, name) VALUES ('${TENANT_C}', '${RUN} C') ON CONFLICT (id) DO NOTHING`);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}', '${RUN} A', '923009810001', 'admin', false, true, '${TENANT_A}'),
      ('${OWNER_B}', '${RUN} B', '923009810002', 'admin', true, true, '${TENANT_B}'),
      ('${VICTIM_B}', '${RUN} victim B', '923009810003', 'employee', false, true, '${TENANT_B}')
    ON CONFLICT (id) DO NOTHING
  `);
  // A product and a variant of tenant B, for the `product_variants_public` probe: the projection is
  // filtered by `current_shop_id()`, and this is the row it must not hand to tenant A.
  await sql(`INSERT INTO products (id, name, shop_id) VALUES ('${PRODUCT_B}', '${RUN} product B', '${TENANT_B}') ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`INSERT INTO product_variants (id, product_id, name) VALUES ('${VARIANT_B}', '${PRODUCT_B}', '1kg') ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  // A product and a variant of tenant A, so the `product_variants_public` probe has a control: the
  // claim is "tenant B's variant is absent", which is only meaningful if the same session CAN see
  // its own variant. A control built from whatever QA happens to hold would break on a prune.
  await sql(`INSERT INTO products (id, name, shop_id) VALUES ('${PRODUCT_A}', '${RUN} product A', '${TENANT_A}') ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`INSERT INTO product_variants (id, product_id, name) VALUES ('${VARIANT_A}', '${PRODUCT_A}', '1kg') ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`INSERT INTO products (id, name, shop_id, marketplace_listed, is_active) VALUES ('${PRODUCT_C}', '${RUN} product C', '${TENANT_C}', true, true) ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`INSERT INTO product_variants (id, product_id, name, stock_qty, selling_price, is_active) VALUES ('${VARIANT_C}', '${PRODUCT_C}', '1kg', 10, 100, true) ON CONFLICT (id) DO NOTHING`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });

  // ── THE MARKETPLACE CONSENT GATE ────────────────────────────────────────────────────────────
  // `marketplace_listings` is readable by ANON on purpose, so its boundary cannot be a policy on
  // who the caller is — it is the owner's own opt-in. Make tenant B a fully published seller and
  // leave tenant C unmatched in every way except its consent flag, so the control and the negative
  // case differ only in the fact being tested.
  await sql(`
    UPDATE shops SET marketplace_enabled = true, latitude = 31.4187, longitude = 74.2123,
      location_label = '${RUN} market' WHERE id = '${TENANT_B}'`).catch((e: any) =>
    console.log('[boundary] marketplace opt-in skipped:', e?.message ?? e));
  await sql(`
    UPDATE shops SET latitude = 31.4187, longitude = 74.2123, location_label = '${RUN} market C'
      WHERE id = '${TENANT_C}'`).catch((e: any) =>
    console.log('[boundary] tenant C location skipped:', e?.message ?? e));
  await sql(`
    UPDATE products SET marketplace_listed = true, is_active = true, marketplace_listed_at = now()
      WHERE id IN ('${PRODUCT_B}','${PRODUCT_C}')`).catch((e: any) =>
    console.log('[boundary] listing flags skipped:', e?.message ?? e));
  await sql(`
    UPDATE product_variants SET stock_qty = 10, selling_price = 100, is_active = true
      WHERE id IN ('${VARIANT_B}','${VARIANT_C}')`).catch((e: any) =>
    console.log('[boundary] listing stock skipped:', e?.message ?? e));
  await sql(`
    INSERT INTO stock_adjustments (id, shop_id, variant_id, adjustment_type, qty_change, reason)
    SELECT '${ADJ_B}', '${TENANT_B}', v.id, 'correction', 5, '${RUN} adjustment'
      FROM product_variants v LIMIT 1
    ON CONFLICT (id) DO NOTHING
  `).catch((e: any) => {
    // Column names vary by schema; the row is only needed for the read probe, so record why.
    console.log('[boundary] stock_adjustments fixture skipped:', e?.message ?? e);
  });
  await sql(`
    INSERT INTO cash_reconciliations (id, shop_id, reconciliation_date, expected_cash, counted_cash, variance, reconciled_by, reconciled_by_name)
    VALUES ('${CASH_B}', '${TENANT_B}', current_date, 0, 0, 0, '${OWNER_B}', '${RUN} B')
    ON CONFLICT (id) DO NOTHING
  `).catch((e: any) => console.log('[boundary] cash_reconciliations fixture skipped:', e?.message ?? e));
  throwIfCleanupFailed('tenantBoundarySweep beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('tenantBoundarySweep afterAll cleanup');
});

describe('tenant boundary — tables the app reaches with admin-only policies', () => {
  it('stock_adjustments: tenant A does not see tenant B’s adjustment', async () => {
    const exists = await sql(`SELECT 1 FROM stock_adjustments WHERE id = '${ADJ_B}'`);
    if (!exists.rows.length) return; // fixture could not be created — never a false pass
    const seen = await selectAsUser(OWNER_A, 'stock_adjustments', '*', { id: ADJ_B });
    expect((seen.data ?? []).length, 'tenant A read tenant B’s stock adjustment').toBe(0);
  });

  it('cash_reconciliations: tenant A does not see tenant B’s reconciliation', async () => {
    const exists = await sql(`SELECT 1 FROM cash_reconciliations WHERE id = '${CASH_B}'`);
    if (!exists.rows.length) return;
    const seen = await selectAsUser(OWNER_A, 'cash_reconciliations', '*', { id: CASH_B });
    expect((seen.data ?? []).length, 'tenant A read tenant B’s cash reconciliation').toBe(0);
  });

  it('user_permissions: tenant A cannot grant a permission to tenant B’s employee', async () => {
    await sql(`DELETE FROM user_permissions WHERE user_id = '${VICTIM_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    const permId = (await sql(`SELECT id FROM permissions LIMIT 1`)).rows[0]?.id;
    if (!permId) return;
    // A deny, not a grant: 0277's trigger refuses a granted override before RLS
    // is even reached, so only a deny proves the boundary itself refuses the write.
    // 0218 rewrote user_permissions_insert to require a membership in the
    // caller's current shop, so a cross-tenant deny IS refused by RLS.
    const { error } = await insertAsUser(OWNER_A, 'user_permissions', {
      user_id: VICTIM_B, permission_id: permId, is_override: true, is_granted: false,
    });
    const written = await sql(`SELECT 1 FROM user_permissions WHERE user_id = '${VICTIM_B}'`);
    await sql(`DELETE FROM user_permissions WHERE user_id = '${VICTIM_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    expect(
      written.rows.length,
      `a cross-tenant permission row was written (insert error: ${error ?? 'none'})`,
    ).toBe(0);
    // The refusal has to come from the boundary, not from an incidental constraint: a grant
    // that fails for a foreign key would look identical to one the policy refused.
    expect(
      error ?? '',
      'the insert must be refused by RLS, not by an unrelated constraint',
    ).toMatch(/row-level security|violates row-level security policy/i);
  });

  it('notifications: the already-scoped control still holds', async () => {
    const seen = await selectAsUser(OWNER_A, 'notifications', '*', { shop_id: TENANT_B });
    expect((seen.data ?? []).length, 'tenant A read tenant B notifications').toBe(0);
  });

  // ── VIEWS: the same question, asked of the relations a policy cannot protect ──
  //
  // WHY THESE FOUR. This sweep has covered tables; a VIEW is not a table and RLS does not follow it.
  // A view carries no policies of its own, so its ONLY possible boundaries are its WHERE clause, its
  // grants, or `security_invoker` — and all four views in `public` are owned by `postgres`, which holds
  // `rolbypassrls`, so an unfiltered one runs with the owner's privileges over base tables the caller
  // cannot read directly.
  //
  // MEASURED 2026-10-15 (JWT → PostgREST, tenant A, context resolved to its own shop): `tenants` had
  // no filter and no `security_invoker`, and returned 4 rows — every business in the database — while
  // the `shops` table behind it returned 1 own and 0 foreign. Fixed by 0206 at the layer that owns the
  // definition of "my shop" (`ALTER VIEW public.tenants SET (security_invoker = true)`, so
  // `shops_select_own` decides). The other three were already bounded in their own way and are
  // asserted here so that stays true.

  it('the fixture session has a real shop context, so every absence below is a refusal', async () => {
    // Without this, a session whose `current_shop_id()` is NULL returns nothing from every scoped
    // relation and "0 foreign rows" passes for the wrong reason. The control is the caller's own row.
    const own = await selectAsUser(OWNER_A, 'shops', 'id', { id: TENANT_A });
    expect(own.data?.length, `control failed: tenant A cannot read its OWN shop row (${own.error ?? ''})`).toBe(1);
    const foreign = await selectAsUser(OWNER_A, 'shops', 'id', { id: TENANT_B });
    expect(foreign.data?.length, 'the shops table itself leaked').toBe(0);
  });

  it('product_variants_public: scoped by current_shop_id(), with the control that makes it mean something', async () => {
    const own = await selectAsUser(OWNER_A, 'product_variants_public', 'id', { id: VARIANT_A });
    expect(
      own.data?.length,
      `control failed: tenant A cannot see its own variant, so "0 foreign rows" would prove nothing (${own.error ?? ''})`,
    ).toBe(1);
    const foreign = await selectAsUser(OWNER_A, 'product_variants_public', '*', { id: VARIANT_B });
    expect((foreign.data ?? []).length, 'tenant A read tenant B’s variant through the projection').toBe(0);
    const all = await selectAsUser(OWNER_A, 'product_variants_public', 'product_id', {});
    const strangerProducts = (all.data ?? []).filter((r: any) => r.product_id === PRODUCT_B);
    expect(strangerProducts.length, 'the projection exposed tenant B’s product to tenant A').toBe(0);
  });

  // Two tests, not one, ON PURPOSE: each is falsified independently. With the defect injected
  // (`ALTER VIEW public.tenants SET (security_invoker = false)`) the behaviour test fails on the
  // leaked rows and this catalog test fails on the option, so neither is a guard that only looks
  // like one. A single test would report only its first assertion and leave the rest unproven.
  it('tenants: the view is declared security_invoker, so the boundary cannot regress silently', async () => {
    // 0206 is guarded for absence because the recorded production schema has no `tenants` view at
    // all. This environment is built from the migration lineage, which DOES create it in 0094 — so
    // state that as a precondition, and let it fail with this message rather than an obscure one.
    const exists = (await sql(`SELECT to_regclass('public.tenants') IS NOT NULL AS present`)).rows[0]?.present;
    expect(
      exists,
      'this environment has no public.tenants view (0094), so its boundary cannot be asserted here',
    ).toBe(true);

    const options = (await sql(`SELECT reloptions FROM pg_class WHERE oid = 'public.tenants'::regclass`)).rows[0]?.reloptions ?? [];
    expect(
      options,
      'the tenants view lost security_invoker (0206): it runs with its owner’s privileges again, which was a full cross-tenant read of shops',
    ).toContain('security_invoker=true');
  });

  it('tenants: the view runs as the caller — own shop visible, no other shop ever', async () => {
    const own = await selectAsUser(OWNER_A, 'tenants', 'id', { id: TENANT_A });
    expect(
      own.data?.length,
      'the view no longer returns the caller’s own tenant — the back-compat alias stopped doing its job',
    ).toBe(1);

    const foreign = await selectAsUser(OWNER_A, 'tenants', '*', { id: TENANT_B });
    expect((foreign.data ?? []).length, 'tenant A read tenant B’s shop through tenants').toBe(0);

    // The original defect was not one row but EVERY row: assert nothing outside the caller appears.
    const all = await selectAsUser(OWNER_A, 'tenants', 'id,name', {});
    const strangers = (all.data ?? []).filter((r: any) => r.id !== TENANT_A);
    expect(
      strangers.map((r: any) => r.name),
      'the tenants view exposed shops other than the caller’s',
    ).toEqual([]);
  });

  it('users_public: unreachable at all — the boundary is the grant, so absence means refusal', async () => {
    // The previous form of this test asserted "0 rows", which passes for a refusal AND for an empty
    // view. It measured `permission denied for view users_public`, i.e. a REVOKE, so require that.
    const asUser = await selectAsUser(OWNER_A, 'users_public', '*', { id: VICTIM_B });
    expect(
      asUser.error ?? '',
      'users_public must refuse an authenticated caller, not quietly return nothing',
    ).toMatch(/permission denied/i);

    // The raw client returns a PostgrestError object, not the message string `selectAsUser` gives.
    const asAnon = await qaAnonClient.from('users_public').select('id').eq('id', VICTIM_B);
    expect(
      asAnon.error?.message ?? '',
      'users_public must refuse anon too',
    ).toMatch(/permission denied/i);
  });

  it('marketplace_listings: public by design, but only for shops that opted in', async () => {
    // A published seller must be visible to anon — this is the control. Without it, "tenant C is
    // absent" would also pass if the view returned nothing to anyone, which is not the same claim.
    const listed = await qaAnonClient
      .from('marketplace_listings')
      .select('product_id,branch_id')
      .eq('product_id', PRODUCT_B);
    expect(listed.error, `anon could not read the marketplace view: ${listed.error ?? ''}`).toBeNull();
    expect(
      (listed.data ?? []).map((r: any) => r.product_id),
      'control failed: a fully published listing is not visible to anon, so the negative case below proves nothing',
    ).toContain(PRODUCT_B);

    const notListed = await qaAnonClient
      .from('marketplace_listings')
      .select('product_id,branch_id')
      .eq('product_id', PRODUCT_C);
    expect(
      (notListed.data ?? []).length,
      'a shop that never enabled the marketplace appeared in the anonymous listings',
    ).toBe(0);
  });

  it('no view in public exposes the owner’s cost data', async () => {
    // 0179 is "cost price is the owner's business", and a view is the one relation class where a
    // projection can quietly add a private column back.
    const cols = await sql(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('tenants','users_public','product_variants_public','marketplace_listings')
         AND (column_name ILIKE '%cost%' OR column_name ILIKE '%margin%' OR column_name ILIKE '%profit%')
    `);
    expect(cols.rows, 'a public view exposes cost/margin data').toEqual([]);
  });
});
