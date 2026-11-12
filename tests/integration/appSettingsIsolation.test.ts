/**
 * A shop's settings belong to that shop — `app_settings` after 0182.
 *
 * HOW THIS WAS FOUND. After 0181 closed the audit INSERT policy, the 0178/0180 question was
 * asked once more of the live catalog: *which policies are reachable by an authenticated
 * session but do not constrain the row to the caller's shop?* Two answers were left.
 * `permissions_select` is reference data with no `shop_id` — fine. `app_settings` was not:
 *
 *   * `app_settings_select` was `USING (true)`, and this table is per-shop configuration
 *     (`(shop_id, setting_key)` unique) — the stock-alert threshold/frequency the owner sets,
 *     plus `void_window_hours`, `expiry_warning_days` and `credit_limit_override_policy`;
 *   * `app_settings_insert`/`_update` were `app_is_admin()` with no shop predicate — the 0180
 *     shape — so an admin of one shop could write another shop's row.
 *
 * WHAT THE APP ACTUALLY USES (measured on QA, `backups/appsettings-probe.mjs`): all three
 * functions that touch the table are SECURITY DEFINER with `search_path` pinned —
 * `get_stock_alert_settings`, `set_stock_alert_settings`, `void_sale_v1`. No screen reads or
 * writes the table directly. That is why the client path can be closed without losing a
 * legitimate reader or writer — and the last test here proves the two RPCs still work.
 *
 * RED BEFORE 0182: [1] admin of shop A read shop B's setting (row returned), [2] its employee
 * did too, [3] admin of A updated B's threshold (value committed), [4] admin of A inserted a
 * row tagged shop B, [5] the catalog still showed a `USING (true)` policy. GREEN AFTER: all
 * six boundary assertions hold and the RPC pair keeps working.
 *
 * Self-contained: its own shop, users and rows; removes all of them (including the two keys
 * the RPC test writes). `scripts/clean-test-data.mjs` does NOT clear `app_settings`, so this
 * suite is the only thing that removes what it wrote.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, execRpcAsUser, insertAsUser, selectAsUser, updateAsUser } from '../setup/qa-client';
import { deleteFixtureUsers } from '../setup/fixtures';

const SHOP_A = '00000000-0000-0000-0000-000000000001';
// …a0a0 is free; …d0d0 belongs to variantIsolation, …e0e0 to tenantBoundarySweep,
// …f0f0 to auditIntegrity — the collision guard names the owner if this ever drifts.
const SHOP_B = '00000000-0000-0000-0000-00000000a0a0';
const ADMIN_A_ID = '10000000-0000-0000-0000-000000000001';
const EMPLOYEE_A_ID = '10000000-0000-0000-0000-000000000002';
const ADMIN_B_ID = 'd7000000-0000-0000-0000-00000000000b';
const EMPLOYEE_B_ID = 'd7000000-0000-0000-0000-0000000000b1';
const SET_A_ID = 'd7000000-0000-0000-0000-0000000000a1';
const SET_B_ID = 'd7000000-0000-0000-0000-0000000000b2';
/**
 * An employee of shop A who actually holds the permission the settings reader authorizes.
 *
 * `get_stock_alert_settings` has required `authorize_business_action('products.view', …)` since 0157
 * — a settings row is edited on the stock-alert screen, so a reader needs to see products. After
 * 0195 that helper resolves through `has_effective_permission` AND a non-null `current_branch_id()`,
 * and the seeded QA employee has a membership with `role_id = NULL` (the legacy `memberships.role`
 * enum, no template) and no branch scope. Measured: that employee has zero grants, so it is refused
 * for reasons that have nothing to do with app_settings isolation, and the assertion below was
 * really testing the fixture's shape. This employee is given the tenant's real role template and a
 * real branch instead of weakening the requirement the RPC declares.
 */
const EMPLOYEE_A_WITH_STOCK_ROLE = 'd7000000-0000-0000-0000-0000000000a2';
const STOCK_ROLE_PHONE = '923009840003';
const KEY_OWN = 'qa_appsettings_own';
const KEY_OTHER = 'qa_appsettings_other';
const KEY_FORGED = 'qa_appsettings_forged';
const RUN = `QA Settings ${Date.now()}`;

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function cleanup() {
  // By key and by id, never by table: the seeded shop's own rows are only removed if this
  // suite wrote them (the RPC test does — QA's baseline has none, verified by recount).
  await sql(`
    DELETE FROM app_settings
     WHERE id IN ('${SET_A_ID}','${SET_B_ID}')
        OR (shop_id IN ('${SHOP_A}','${SHOP_B}') AND setting_key LIKE 'qa_appsettings%')
        OR (shop_id = '${SHOP_A}' AND setting_key IN ('low_stock_threshold_default','stock_alert_frequency'))
  `).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  // Through the shared helper: these users may carry audit rows (`audit_events.user_id` is NO ACTION)
  // and one blocked row would leave the whole list behind. `placeLocation` is where that leak was
  // measured and fixed; this is the same fix applied where the same shape occurs.
  await deleteFixtureUsers([ADMIN_B_ID, EMPLOYEE_B_ID, EMPLOYEE_A_WITH_STOCK_ROLE]);
  await sql(`DELETE FROM shops WHERE id = '${SHOP_B}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();
  await sql(`INSERT INTO shops (id, name) VALUES ('${SHOP_B}', '${RUN}') ON CONFLICT (id) DO NOTHING`);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${ADMIN_B_ID}',    '${RUN} admin B',    '923009840001', 'admin',    true, true, '${SHOP_B}'),
      ('${EMPLOYEE_B_ID}', '${RUN} employee B', '923009840002', 'employee', false, true, '${SHOP_B}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${EMPLOYEE_A_WITH_STOCK_ROLE}', '${RUN} stock employee', '${STOCK_ROLE_PHONE}', 'employee', false, true, '${SHOP_A}')
    ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone, is_active = true
  `);
  // The template and the branch are read from this tenant rather than hardcoded: an employee of
  // shop A, holding shop A's real stock-permission role, scoped to shop A's real default branch.
  await sql(`
    UPDATE memberships SET
      role = 'employee',
      status = 'active',
      role_id = (SELECT r.id FROM roles r
                   JOIN role_permissions rp ON rp.role_id = r.id
                   JOIN permissions p ON p.id = rp.permission_id
                  WHERE r.tenant_id = '${SHOP_A}' AND p.code = 'products.view'
                  ORDER BY r.name
                  LIMIT 1),
      branch_scope = ARRAY(SELECT b.id FROM branches b
                            WHERE b.tenant_id = '${SHOP_A}' AND b.is_active
                            ORDER BY b.is_default DESC, b.created_at
                            LIMIT 1)
     WHERE user_id = '${EMPLOYEE_A_WITH_STOCK_ROLE}' AND tenant_id = '${SHOP_A}'
  `);
  await sql(`
    INSERT INTO app_settings (id, shop_id, setting_key, setting_value, description)
    VALUES
      ('${SET_A_ID}', '${SHOP_A}', '${KEY_OWN}',   '11', '${RUN} own'),
      ('${SET_B_ID}', '${SHOP_B}', '${KEY_OTHER}', '77', '${RUN} other')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanup();
});

describe('app_settings isolation — configuration belongs to one shop', () => {
  it('the fixture is real: the shop B setting exists and both shops have a user', async () => {
    const settings = await sql(`
      SELECT id, shop_id, setting_value FROM app_settings WHERE id IN ('${SET_A_ID}','${SET_B_ID}')
    `);
    expect(settings.rows.map((r: any) => `${r.id}:${r.shop_id}`).sort()).toEqual(
      [`${SET_A_ID}:${SHOP_A}`, `${SET_B_ID}:${SHOP_B}`].sort(),
    );
    const shop = await sql(`SELECT 1 FROM shops WHERE id = '${SHOP_B}'`);
    expect(shop.rows.length, 'shop B was not created — later assertions would be vacuous').toBe(1);
  });

  it('an admin of another shop cannot read this shop’s setting', async () => {
    const seen = await selectAsUser(ADMIN_A_ID, 'app_settings', '*', { id: SET_B_ID });
    expect((seen.data ?? []).length, 'shop A’s admin read shop B’s setting').toBe(0);
  });

  it('an employee of another shop cannot read this shop’s setting', async () => {
    const seen = await selectAsUser(EMPLOYEE_A_ID, 'app_settings', '*', { id: SET_B_ID });
    expect((seen.data ?? []).length, 'shop A’s employee read shop B’s setting').toBe(0);
  });

  it('an admin of another shop cannot update this shop’s setting', async () => {
    const updated = await updateAsUser(ADMIN_A_ID, 'app_settings', { setting_value: '1' }, { id: SET_B_ID });
    const readback = await sql(`SELECT setting_value FROM app_settings WHERE id = '${SET_B_ID}'`);
    const value = readback.rows[0]?.setting_value;
    // Restore for a repeated run even if the boundary was breached, so the red is never a
    // silent second-order failure of the fixture.
    await sql(`UPDATE app_settings SET setting_value = '77' WHERE id = '${SET_B_ID}'`);
    expect(
      (updated.data ?? []).length,
      `a cross-tenant update matched a row (error: ${updated.error ?? 'none'})`,
    ).toBe(0);
    expect(value, 'shop B’s setting value was rewritten by shop A’s admin').toBe('77');
  });

  it('an admin of another shop cannot insert a setting tagged as this shop’s', async () => {
    const { error } = await insertAsUser(ADMIN_A_ID, 'app_settings', {
      shop_id: SHOP_B, setting_key: KEY_FORGED, setting_value: '1', description: RUN,
    });
    const written = await sql(`SELECT 1 FROM app_settings WHERE shop_id = '${SHOP_B}' AND setting_key = '${KEY_FORGED}'`);
    expect(written.rows.length, 'a cross-tenant setting row was written').toBe(0);
    // The refusal has to be the boundary, not a missing FK or an incidental constraint —
    // shop B exists and the key is new, so nothing else could have refused it.
    expect(
      error ?? '',
      'the insert must be refused by RLS, not by an unrelated constraint',
    ).toMatch(/row-level security|permission denied|violates/i);
  });

  it('no app_settings policy accepts anything the caller sends, and every one is shop-scoped', async () => {
    const rls = await sql(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_settings'::regclass`);
    expect(rls.rows[0]?.relrowsecurity, 'RLS is not enabled — the policies would be decoration').toBe(true);

    const policies = await sql(`
      SELECT policyname, cmd, coalesce(qual,'') AS q, coalesce(with_check,'') AS c
        FROM pg_policies WHERE schemaname = 'public' AND tablename = 'app_settings'
    `);
    expect(policies.rows.length, 'the three (select/insert/update) policies should exist').toBe(3);

    const permissive = policies.rows.filter((r: any) => r.q === 'true' || r.c === 'true');
    expect(
      permissive.map((r: any) => r.policyname),
      'a policy still accepts anything the caller sends',
    ).toEqual([]);

    const unscoped = policies.rows.filter(
      (r: any) => !`${r.q} ${r.c}`.includes('current_shop_id'),
    );
    expect(
      unscoped.map((r: any) => `${r.policyname}(${r.cmd})`),
      'a policy on a per-shop table does not constrain the row to the caller’s shop',
    ).toEqual([]);
  });

  it('the shop’s own people still read its settings', async () => {
    const asAdmin = await selectAsUser(ADMIN_A_ID, 'app_settings', '*', { id: SET_A_ID });
    expect((asAdmin.data ?? []).length, 'the admin cannot read the shop’s own setting').toBe(1);
    const asEmployee = await selectAsUser(EMPLOYEE_A_ID, 'app_settings', '*', { id: SET_A_ID });
    expect((asEmployee.data ?? []).length, 'the employee cannot read the shop’s own setting').toBe(1);
  });

  it('an employee still cannot write the shop’s settings', async () => {
    const { error } = await insertAsUser(EMPLOYEE_A_ID, 'app_settings', {
      shop_id: SHOP_A, setting_key: 'qa_appsettings_employee', setting_value: '1',
    });
    const written = await sql(`SELECT 1 FROM app_settings WHERE shop_id = '${SHOP_A}' AND setting_key = 'qa_appsettings_employee'`);
    expect(written.rows.length, 'an employee wrote the shop’s configuration').toBe(0);
    expect(error ?? '', 'the write must be refused').toMatch(/row-level security|permission denied|violates/i);
  });

  it('the legitimate RPC writer and reader keep working, for admin and employee', async () => {
    // The app never touches the table directly; these two RPCs are the real path.
    const wrote = await execRpcAsUser(ADMIN_A_ID, 'set_stock_alert_settings', {
      payload: { threshold: 13, frequency: 'daily' },
    });
    expect(wrote.error, `the authorised writer was refused: ${wrote.error}`).toBeNull();

    const stored = await sql(`
      SELECT setting_value FROM app_settings
       WHERE shop_id = '${SHOP_A}' AND setting_key = 'low_stock_threshold_default'
    `);
    expect(stored.rows[0]?.setting_value, 'the RPC did not persist the value').toBe('13');

    const asAdmin = await execRpcAsUser(ADMIN_A_ID, 'get_stock_alert_settings', { payload: {} });
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.data).toMatchObject({ threshold: 13, frequency: 'daily' });

    const asEmployee = await execRpcAsUser(EMPLOYEE_A_WITH_STOCK_ROLE, 'get_stock_alert_settings', { payload: {} });
    expect(asEmployee.error, `the employee reader was refused: ${asEmployee.error}`).toBeNull();
    expect(asEmployee.data).toMatchObject({ threshold: 13, frequency: 'daily' });
  });
});
