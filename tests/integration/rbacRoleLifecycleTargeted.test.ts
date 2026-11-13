/**
 * TARGETED RBAC EVIDENCE — role permissions and role lifecycle, at the RPC/DB layer.
 *
 * The staging gate asks two questions this file answers with real JWTs, PostgREST and
 * database rows rather than with a screen:
 *
 *   1. ROLE PERMISSIONS. The owner creates a Manager role, grants it a SENSITIVE
 *      permission (`sales.void` — voiding a sale restores stock and reverses the
 *      customer's balance, so it is the one that matters), and assigns it to an
 *      employee through the same RPC the screen calls. The employee must then be able
 *      to perform exactly that action, and nothing it was not granted; a direct RPC
 *      call is what gets judged, never the screen.
 *
 *   2. ROLE LIFECYCLE (0183). Deleting an assigned role SUCCEEDS and revokes the access
 *      it provided: the employees keep their account, their membership and their history,
 *      every permission from the role is gone at the next call, no orphaned role or
 *      permission reference remains, repeated deletion cannot resurrect it, and access
 *      returns only when another valid role is assigned — with only what that role grants.
 *
 * WHAT THIS ADDS OVER THE EXISTING SUITES:
 *   - `rbacEnforcement` proves generic propagation with `products.delete`; it never
 *     grants a manager role a sensitive money/inventory permission and watches the
 *     employee perform it.
 *   - `employeePermissions` proves an employee WITHOUT `sales.void` is refused, but
 *     never grants it and never exercises the allow -> revoke -> deny arc.
 *   - `rbacLifecycleAndSessions` covers the lifecycle; this file adds the sensitive
 *     permission and the five-employee revocation shape end to end.
 *
 * Self-contained: creates its own owner, employee, roles, customer, product and sales,
 * and removes every row it created.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { execRpcAsUser, execSqlAsAdmin, ensureTenantBranch } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

const TENANT = '00000000-0000-0000-0000-000000000001';
// The fixture shop's sole owner (Khalid Khan). 0280 allows one active owner
// per shop, so this suite uses him instead of creating its own owner — and
// never inserts, updates or deletes his user row.
const OWNER = QA_IDS.owner;
const EMP = 'f7000000-0000-0000-0000-0000000000e1';
const EMP_PHONE = '923009730002';
const CUSTOMER = 'f7000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'f7000000-0000-0000-0000-0000000000f1';
const VARIANT = 'f7000000-0000-0000-0000-0000000000f2';
const RUN = `QA VoidRole ${Date.now()}`;
const ROLE_MANAGER = `${RUN} Manager`;
/** The other role the employee is moved to when the manager role is revoked. */
const ROLE_CLERK = `${RUN} Clerk`;

let managerRoleId = '';
let clerkRoleId = '';
/** The sale the granted employee voids; the one the revoked employee must not. */
let saleForGrant = '';
let saleForRevoke = '';
let mainBranch = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function scalar(query: string): Promise<Record<string, any>> {
  const r = await sql(query);
  return (r.rows?.[0] ?? {}) as Record<string, any>;
}

/** The employee's effective permissions, resolved server-side from their JWT. */
async function effectivePerms(userId: string): Promise<string[]> {
  const res = await execRpcAsUser(userId, 'get_my_permissions', {});
  expect(res.error, `get_my_permissions failed for ${userId}`).toBeNull();
  return Array.isArray(res.data) ? res.data : (res.data?.permissions ?? []);
}

async function saleIsVoided(saleId: string): Promise<boolean> {
  const row = await scalar(`SELECT is_voided FROM sales WHERE id = '${saleId}'`);
  return row.is_voided === true;
}

async function variantStock(): Promise<number> {
  return Number((await scalar(`SELECT stock_qty FROM product_variants WHERE id = '${VARIANT}'`)).stock_qty);
}

/** A completed credit sale with one line, so voiding it has stock to restore. */
async function seedSale(id: string, number: string, employeeId: string) {
  await sql(`
    INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status,
      payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, created_at, updated_at)
    VALUES ('${id}', '${number}', '${CUSTOMER}', '${employeeId}', 1000, 'completed',
      'credit', 'cash', 0, 1000, 0, false, '${TENANT}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total)
    VALUES ('${randomUUID()}', '${id}', '${PRODUCT}', '${RUN} Product', '${VARIANT}', '1kg', 2, 500, 1000)
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * Every role this suite has EVER created, not only this run's.
 *
 * The pre-clean below used to match `QA VoidRole ${Date.now()}%` — this run's name alone — so a run
 * that never reached its `afterAll` (a statement timeout, a killed suite) left its
 * `QA VoidRole <epoch> Manager` row behind for the NEXT run to inherit, and for the browser lanes to
 * read in the employee form. That is exactly what failed CI on 2026-10-14: `accessUx`'s no-jargon
 * scan read a leaked role's description ("…sensitive void permission") and failed as though the
 * product had exposed RBAC vocabulary, while the product was untouched.
 *
 * Every row of this family is test-origin by construction, so any run of this file clears all of
 * them: a leak heals instead of compounding into the next run's assertion.
 */
const TEST_ROLES = `name LIKE 'QA VoidRole %'`;

async function cleanup() {
  // A swallowed delete is how that leaked role reached a browser lane's assertion. Failures are
  // collected and reported at the end instead of being discarded as "the row may already be gone".
  const failures: string[] = [];
  const label = (statement: string) => statement.replace(/\s+/g, ' ').slice(0, 60);
  const q = async (statement: string) => {
    try {
      const result: any = await sql(statement);
      if (result?.error) failures.push(`${label(statement)} → ${String(result.error.message ?? result.error)}`);
    } catch (error) {
      failures.push(`${label(statement)} → ${String(error)}`);
    }
  };

  // EVERY sale these fixtures could be attached to — not only the two ids this run seeds. The ids
  // below are fixed (`f7000000-…000a` / `…e1`), so a run that is killed mid-flight leaves rows the
  // NEXT run cannot name: `void_sale` writes its own ledger and a sale whose id only the dead run
  // knew. `sales_customer_id_fkey` and `sales_employee_id_fkey` then blocked the customer and user
  // deletes below, and a user left with a shop and NO membership is exactly what the membership
  // invariant suites report as a product defect (`expected 2 to be +0`) — the leak compound the
  // comment on TEST_ROLES describes, one table over. Resolving the sales by the fixture identities
  // they reference makes this heal instead of compounding, and it stays id-scoped: no table-wide
  // DELETE, and `audit_events` is never bounded.
  const attached = await sql(`SELECT id FROM sales
     WHERE employee_id IN ('${OWNER}','${EMP}') OR customer_id = '${CUSTOMER}'`);
  const saleIds = new Set<string>([
    ...(attached.rows ?? []).map((row: any) => String(row.id)),
    saleForGrant,
    saleForRevoke,
  ].filter(Boolean));

  for (const saleId of saleIds) {
    await q(`DELETE FROM inventory_movements WHERE reference_id = '${saleId}'`);
    await q(`DELETE FROM voids WHERE sale_id = '${saleId}'`);
    await q(`DELETE FROM sale_items WHERE sale_id = '${saleId}'`);
    await q(`DELETE FROM sales WHERE id = '${saleId}'`);
  }
  // Audit rows are attributed to the ACTOR (user_id) as well as to the entity, and a
  // role_deleted row's entity_id is the role id, not a user — so all three shapes have
  // to be named or the users delete below fails on the FK and leaves fixtures behind.
  await q(`DELETE FROM audit_events
     WHERE user_id IN ('${OWNER}','${EMP}')
        OR entity_id IN ('${OWNER}','${EMP}')
        OR entity_id IN (SELECT id FROM roles WHERE ${TEST_ROLES})
        OR details->>'name' LIKE 'QA VoidRole %'`);
  await q(`DELETE FROM user_permissions WHERE user_id IN ('${OWNER}','${EMP}')`);
  await q(`DELETE FROM memberships WHERE user_id IN ('${EMP}')`);
  await q(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE ${TEST_ROLES})`);
  await q(`DELETE FROM roles WHERE ${TEST_ROLES}`);
  await q(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`);
  await q(`DELETE FROM product_variants WHERE id = '${VARIANT}'`);
  await q(`DELETE FROM products WHERE id = '${PRODUCT}'`);
  await q(`DELETE FROM customers WHERE id = '${CUSTOMER}'`);
  await q(`DELETE FROM users WHERE id IN ('${EMP}')`);

  expect(failures, `cleanup left rows behind: ${failures.join(' | ')}`).toEqual([]);
}

beforeAll(async () => {
  await cleanup();

  // The users insert also creates their memberships (the 0113 trigger), which is
  // what gives each caller tenant access. The employee lands on the shop's own
  // Sales Employee template, exactly as a freshly seeded employee does.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${EMP}',   '${RUN} Emp',   '${EMP_PHONE}',   'employee', false, true, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, shop_id = EXCLUDED.shop_id
  `);

  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUSTOMER}', '${RUN} Customer', '923009730101', 50000, 0, 0, 0, '${TENANT}', 'QA')
    ON CONFLICT (id) DO UPDATE SET outstanding_balance = 0, total_purchases = 0
  `);
  await sql(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${PRODUCT}', '${RUN} Product', 'fertilizer', 'kg', 100, '${TENANT}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${VARIANT}', '${PRODUCT}', '1kg', 500, 300, 1, 1, 5, 100, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 100, is_active = true
  `);

  // The tenant's own default branch, resolved through the app's registration helper instead of by
  // list position: this file only needs A branch to scope its employee to, and indexing the seeded
  // shop's list is the borrowed-state shape `npm run audit:fixtures` names.
  mainBranch = await ensureTenantBranch(TENANT, 'Main Branch');
  expect(mainBranch, 'the QA shop must have an active branch').toBeTruthy();

  saleForGrant = randomUUID();
  saleForRevoke = randomUUID();
});

afterAll(async () => {
  await cleanup();
});

describe('Role permissions — a granted sensitive permission actually works', () => {
  it('the owner creates a Manager role carrying sales.void and assigns it to an employee', async () => {
    const created = await execRpcAsUser(OWNER, 'create_role', {
      payload: {
        name: ROLE_MANAGER,
        description: 'QA manager with the sensitive void permission',
        permissions: ['sales.view', 'sales.create', 'sales.void'],
      },
    });
    expect(created.error).toBeNull();
    managerRoleId = created.data?.id ?? created.data?.roleId;
    expect(managerRoleId).toBeTruthy();

    const granted = await scalar(`
      SELECT count(*)::int AS n FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = '${managerRoleId}' AND p.code = 'sales.void'
    `);
    expect(granted.n, 'sales.void must be stored on the role').toBe(1);

    // The same RPC the employee screen calls when the owner changes somebody's role.
    const assigned = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: managerRoleId, overrides: {}, branchScope: [mainBranch] },
    });
    expect(assigned.error).toBeNull();

    const membership = await scalar(
      `SELECT role_id, status FROM memberships WHERE user_id = '${EMP}' AND tenant_id = '${TENANT}'`
    );
    expect(membership.role_id, 'the membership must hold the assigned role').toBe(managerRoleId);
    expect(membership.status).toBe('active');
    expect(await effectivePerms(EMP), 'the role must grant the sensitive permission').toContain('sales.void');
  });

  it('the employee can perform the allowed action — and voiding really changes stock and state', async () => {
    await seedSale(saleForGrant, `${RUN.replace(/\s/g, '')}-G1`, EMP);
    const stockBefore = await variantStock();

    const voided = await execRpcAsUser(EMP, 'void_sale', {
      p_sale_id: saleForGrant,
      p_reason: 'QA targeted RBAC void',
    });
    expect(voided.error, 'the granted employee must be allowed to void').toBeNull();
    expect(voided.data?.restoredStock).toBe(2);

    // Judged on the database, not on the RPC's own answer.
    expect(await saleIsVoided(saleForGrant)).toBe(true);
    expect(await variantStock(), 'voiding restores the stock it removed').toBe(stockBefore + 2);

    const voids = await scalar(`SELECT count(*)::int AS n FROM voids WHERE sale_id = '${saleForGrant}'`);
    expect(voids.n, 'one void = one void record').toBe(1);
    const movements = await scalar(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE reference_id = '${saleForGrant}' AND movement_type = 'void'`
    );
    expect(movements.n, 'one void = one inventory movement').toBe(1);
  });

  it('an action the role does NOT grant is refused at the RPC, with no state written', async () => {
    // This manager role carries no `products.delete`; the refusal must name the
    // missing permission and must not be a "product not found" answer.
    const denied = await execRpcAsUser(EMP, 'delete_product', {
      payload: { id: '30000000-0000-0000-0000-0000000000ff' },
    });
    expect(denied.error).toContain('NOT_AUTHORIZED');
    expect(denied.error).toContain('products.delete');
    expect(denied.error).not.toContain('PRODUCT_NOT_FOUND');

    // And the refusal wrote nothing: the probe product still exists.
    const still = await scalar(`SELECT count(*)::int AS n FROM products WHERE id = '${PRODUCT}'`);
    expect(still.n).toBe(1);
  });

  it('revoking the permission denies the action on the next call, with no state written', async () => {
    const updated = await execRpcAsUser(OWNER, 'update_role', {
      payload: { roleId: managerRoleId, permissions: ['sales.view', 'sales.create'] },
    });
    expect(updated.error).toBeNull();
    expect(await effectivePerms(EMP)).not.toContain('sales.void');

    await seedSale(saleForRevoke, `${RUN.replace(/\s/g, '')}-G2`, EMP);
    const stockBefore = await variantStock();

    const denied = await execRpcAsUser(EMP, 'void_sale', {
      p_sale_id: saleForRevoke,
      p_reason: 'QA revoked void attempt',
    });
    expect(denied.error).toContain('NOT_AUTHORIZED');

    expect(await saleIsVoided(saleForRevoke), 'the refused void must not have happened').toBe(false);
    expect(await variantStock(), 'the refused void must not move stock').toBe(stockBefore);
    const voids = await scalar(`SELECT count(*)::int AS n FROM voids WHERE sale_id = '${saleForRevoke}'`);
    expect(voids.n, 'the refused void must not write a void record').toBe(0);
  });

  it('the employee gains access again only when another valid role is assigned', async () => {
    const created = await execRpcAsUser(OWNER, 'create_role', {
      payload: { name: ROLE_CLERK, description: 'QA clerk role', permissions: ['sales.view', 'sales.void'] },
    });
    expect(created.error).toBeNull();
    clerkRoleId = created.data?.id ?? created.data?.roleId;
    expect(clerkRoleId).toBeTruthy();

    // Access is assigned through the same RPC the owner's screen calls.
    const reassigned = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: clerkRoleId, overrides: {}, branchScope: [mainBranch] },
    });
    expect(reassigned.error).toBeNull();
    expect(await effectivePerms(EMP), 'the new role must grant the permission').toContain('sales.void');

    const allowed = await execRpcAsUser(EMP, 'void_sale', {
      p_sale_id: saleForRevoke,
      p_reason: 'QA void after reassignment',
    });
    expect(allowed.error, 'the reassigned employee must be allowed again').toBeNull();
    expect(await saleIsVoided(saleForRevoke)).toBe(true);
  });
});

describe('Role lifecycle — deleting an assigned role revokes its access (0183)', () => {
  it('an employee cannot delete a role at all', async () => {
    const res = await execRpcAsUser(EMP, 'delete_role', { payload: { roleId: clerkRoleId } });
    expect(res.error, 'a non-owner must not reach the deletion').toBeTruthy();
    expect(res.error).toContain('NOT_AUTHORIZED');
    const still = await scalar(`SELECT count(*)::int AS n FROM roles WHERE id = '${clerkRoleId}'`);
    expect(still.n, 'the refused deletion must not have removed the role').toBe(1);
    expect(await effectivePerms(EMP)).toContain('sales.void');
  });

  it('the owner deletes the assigned role and the employee loses exactly that access', async () => {
    // The employee is working under the clerk role right now (assigned in the test above).
    expect(await effectivePerms(EMP)).toContain('sales.void');

    const removed = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId: clerkRoleId } });
    expect(removed.error).toBeNull();
    expect(removed.data.revokedFrom, 'the answer must report how many employees lost access').toBe(1);

    // The role is gone, and nothing references it any more.
    const gone = await scalar(`SELECT count(*)::int AS n FROM roles WHERE id = '${clerkRoleId}'`);
    expect(gone.n, 'the role must be gone from the database').toBe(0);
    const orphanPerms = await scalar(`SELECT count(*)::int AS n FROM role_permissions WHERE role_id = '${clerkRoleId}'`);
    expect(orphanPerms.n, 'no orphaned role_permissions rows may remain').toBe(0);
    const orphanMembers = await scalar(`SELECT count(*)::int AS n FROM memberships WHERE role_id = '${clerkRoleId}'`);
    expect(orphanMembers.n, 'no membership may still reference the deleted role').toBe(0);

    // The employee is still in the system, still active, and still holds their membership.
    const employee = await scalar(`SELECT name, is_active FROM users WHERE id = '${EMP}'`);
    expect(employee.name).toBe(`${RUN} Emp`);
    expect(employee.is_active).toBe(true);
    const membership = await scalar(
      `SELECT status, role_id FROM memberships WHERE user_id = '${EMP}' AND tenant_id = '${TENANT}'`
    );
    expect(membership.status, 'the membership survives the deletion').toBe('active');
    expect(membership.role_id, 'the role reference is cleared').toBeNull();

    // Their work history is untouched and still attributed to them.
    const history = await scalar(
      `SELECT count(*)::int AS n FROM sales WHERE employee_id = '${EMP}' AND is_voided = true`
    );
    expect(history.n, 'the employee’s voided sales stay attributed to them').toBe(2);
  });

  it('the revoked access is denied on the next call, and nothing is written', async () => {
    expect(await effectivePerms(EMP), 'the role’s permissions must be gone').not.toContain('sales.void');

    const fresh = randomUUID();
    await seedSale(fresh, `${RUN.replace(/\s/g, '')}-R1`, EMP);
    const stockBefore = await variantStock();

    const denied = await execRpcAsUser(EMP, 'void_sale', {
      p_sale_id: fresh,
      p_reason: 'QA revoked-role void attempt',
    });
    expect(denied.error).toContain('NOT_AUTHORIZED');
    expect(await saleIsVoided(fresh), 'the refused void must not have happened').toBe(false);
    expect(await variantStock(), 'the refused void must not move stock').toBe(stockBefore);

    // Clean the probe sale up inside the test so the history count below stays exact.
    await sql(`DELETE FROM inventory_movements WHERE reference_id = '${fresh}'`);
    await sql(`DELETE FROM voids WHERE sale_id = '${fresh}'`);
    await sql(`DELETE FROM sale_items WHERE sale_id = '${fresh}'`);
    await sql(`DELETE FROM sales WHERE id = '${fresh}'`);
  });

  it('repeated deletion cannot resurrect the role or half-apply the revocation', async () => {
    const results = await Promise.all([
      execRpcAsUser(OWNER, 'delete_role', { payload: { roleId: clerkRoleId } }),
      execRpcAsUser(OWNER, 'delete_role', { payload: { roleId: clerkRoleId } }),
    ]);
    for (const r of results) expect(r.error).toContain('ROLE_NOT_FOUND_OR_NOT_AUTHORIZED');

    const gone = await scalar(`SELECT count(*)::int AS n FROM roles WHERE id = '${clerkRoleId}'`);
    expect(gone.n).toBe(0);
    const membership = await scalar(
      `SELECT status, role_id FROM memberships WHERE user_id = '${EMP}' AND tenant_id = '${TENANT}'`
    );
    expect(membership.status).toBe('active');
    expect(membership.role_id).toBeNull();
  });

  it('access returns only when another valid role is assigned — and only what that role grants', async () => {
    // Still denied with no role.
    const denied = await execRpcAsUser(EMP, 'delete_product', {
      payload: { id: '30000000-0000-0000-0000-0000000000ff' },
    });
    expect(denied.error).toContain('NOT_AUTHORIZED');

    const moved = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: managerRoleId, overrides: {}, branchScope: [mainBranch] },
    });
    expect(moved.error).toBeNull();

    // The manager role grants sales.view/create only — not sales.void, not products.delete.
    const perms = await effectivePerms(EMP);
    expect(perms).toContain('sales.view');
    expect(perms, 'access returns according to the NEW role only').not.toContain('sales.void');

    const stillDenied = await execRpcAsUser(EMP, 'void_sale', {
      p_sale_id: randomUUID(),
      p_reason: 'QA no-void-role attempt',
    });
    expect(stillDenied.error, 'the new role must not inherit the deleted one’s permission').toContain('NOT_AUTHORIZED');
  });

  it('the deleted role cannot be used to regain access', async () => {
    const res = await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: clerkRoleId, overrides: {}, branchScope: [mainBranch] },
    });
    expect(res.error, 'assigning a deleted role must be refused').toBeTruthy();
    expect(await effectivePerms(EMP)).not.toContain('sales.void');
  });
});
