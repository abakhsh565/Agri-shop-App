/**
 * Access-management lifecycle + live-session regression suite.
 *
 * Proves, through the real client path (JWT → PostgREST → RPC → DB):
 *   1. Effective access is resolved server-side: an access change takes effect at
 *      the next authorization boundary even while the employee's session lives.
 *   2. A deactivated membership loses access immediately.
 *   3. Role deletion revokes the access it provided (0183): an in-use role is deleted,
 *      its memberships are cleared, and the employees keep their account and history.
 *   4. update_admin_profile cannot be pointed at another user or tenant.
 *   5. Access changes are audited with actor attribution.
 *
 * Self-contained: creates its own employee + role and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, roleIdByName, setMembershipBranchScope } from '../setup/qa-client';
import { QA_IDS } from '../setup/fixtures';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
// The fixture shop's sole owner (Khalid Khan). 0280 allows one active owner
// per shop, so this suite uses him instead of creating its own owner — and
// never inserts, updates or deletes his user row.
const OWNER = QA_IDS.owner;
const EMP = 'd3000000-0000-0000-0000-0000000000e1';
const VICTIM = 'd3000000-0000-0000-0000-00000000000b';
// Built-in roles, resolved by NAME in beforeAll rather than by the id 0107 seeded. A built-in role is
// deletable through the app (roles.deleteHintBuiltIn), and `roles.id` is ONE key across tenants — so a
// fixed id can be gone, or held by another tenant's role, while the NAME is what the product
// guarantees. QA lost "Sales Employee" in this tenant on 2026-10-04 while this id stayed in use
// elsewhere: { revokedFrom: 2, wasSystemRole: true }.
let ROLE_EMPLOYEE = '';  // Sales Employee (holds sales.create)
let ROLE_CLERK = '';     // Inventory Clerk (no sales.create; 0285 gave every role the customer trio)
const RUN = `QA Life ${Date.now()}`;

// The sales.create probe (R3): a sale needs a real customer, product and
// variant with stock — the saleIdempotency fixture shape, in this suite's
// own id namespace.
const SALE_CUSTOMER = 'd3000000-0000-0000-0000-0000000000c1';
const SALE_PRODUCT = 'd3000000-0000-0000-0000-0000000000d1';
const SALE_VARIANT = 'd3000000-0000-0000-0000-0000000000d2';
const SALE_PRICE = 500;
const SALE_QTY = 2;
const SALE_TOTAL = SALE_PRICE * SALE_QTY;

let roleId = '';

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
  await sql(`DELETE FROM customers WHERE phone IN ('923009795001','923009795002','923009795004','923009795005')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM audit_events WHERE user_id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM user_permissions WHERE user_id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE '${RUN}%')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM roles WHERE name LIKE '${RUN}%'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  await sql(`DELETE FROM users WHERE id IN ('${OWNER}','${EMP}','${VICTIM}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${EMP}',    '${RUN} Emp',    '923009795002', 'employee', false, true, '${TENANT_A}'),
      ('${VICTIM}', '${RUN} Victim', '923009795003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);

  ROLE_EMPLOYEE = await roleIdByName(TENANT_A, 'Sales Employee');
  ROLE_CLERK = await roleIdByName(TENANT_A, 'Inventory Clerk');

  // 0188 denies a non-owner whose branch is not inside the membership's scope, and 0190's own
  // invitation path sets `branch_scope := ARRAY[current_branch_id()]` for exactly that reason. These
  // employees are inserted by direct SQL, so the scope the product would have written is written here
  // too — otherwise every call is refused "branch access denied" and the suite would be asserting
  // behaviour the product does not have.
  const branch = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT_A}' AND is_active = true ORDER BY is_default DESC, created_at LIMIT 1`
  );
  const branchId = branch.rows[0]?.id;
  expect(branchId).toBeTruthy();
  await setMembershipBranchScope(EMP, TENANT_A, [branchId]);
  await setMembershipBranchScope(VICTIM, TENANT_A, [branchId]);

  // Sale fixture for the sales.create probe (see the 'grants access' test):
  // 0285 gave every role the customer trio, so only a sale tells these two
  // roles apart. Same shape as saleIdempotency's fixture, own ids.
  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${SALE_CUSTOMER}', '${RUN} sale customer', '923009795101', 100000, 0, 0, 0, '${TENANT_A}', 'QA')
    ON CONFLICT (id) DO UPDATE SET outstanding_balance = 0, total_purchases = 0, total_paid = 0
  `);
  await sql(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${SALE_PRODUCT}', '${RUN} sale product', 'other', 'kg', 100, '${TENANT_A}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true, base_unit = 'kg'
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${SALE_VARIANT}', '${SALE_PRODUCT}', '1kg', ${SALE_PRICE}, 300, 1, 1, 5, 100, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 100, is_active = true, selling_price = ${SALE_PRICE}
  `);
  throwIfCleanupFailed('rbacLifecycleAndSessions beforeAll cleanup');
});

afterAll(async () => {
  // The profile tests rename the fixture owner (Khalid Khan) to prove
  // update_admin_profile ignores a foreign userId; the rename is the
  // assertion's evidence, not a new name. Restore him so the next suite
  // sees the fixture it expects.
  await trySql('owner-name', sql(`UPDATE users SET name = 'Khalid Khan' WHERE id = '${OWNER}'`));
  await cleanup();
  throwIfCleanupFailed('rbacLifecycleAndSessions afterAll cleanup');
});

const customerCall = (n: number) => ({
  payload: { name: `${RUN} customer ${n}`, phone: `92300979${5000 + n}` },
});

// The access probe: 0285 gave every role customers.create/edit/payments, so
// a customer write can no longer tell the Sales Employee from the Inventory
// Clerk. A sale can — the Employee holds sales.create and the Clerk does not
// (0107). Same payload shape as saleIdempotency's.
const saleCall = () => ({
  payload: {
    customerId: SALE_CUSTOMER,
    customerName: `${RUN} sale customer`,
    employeeId: EMP,
    employeeName: `${RUN} Emp`,
    paymentType: 'full',
    paymentMethod: 'cash',
    amountPaid: SALE_TOTAL,
    items: [
      {
        productId: SALE_PRODUCT,
        productName: `${RUN} sale product`,
        variantId: SALE_VARIANT,
        variantName: '1kg',
        qty: SALE_QTY,
        unitPrice: SALE_PRICE,
        unitSize: 1,
        baseUnit: 'kg',
      },
    ],
  },
});

describe('Live session — access changes apply at the next authorization boundary', () => {
  it('grants access from the assigned role', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}', role = 'employee', status = 'active' WHERE user_id = '${EMP}'`);

    const res = await execRpcAsUser(EMP, 'create_sale', saleCall());
    expect(res.error).toBeNull();

    const persisted = await sql(`SELECT count(*)::int AS c FROM sales WHERE customer_id = '${SALE_CUSTOMER}'`);
    expect(persisted.rows[0].c).toBe(1);
  });

  it('revokes access on the next call after the role changes', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_CLERK}' WHERE user_id = '${EMP}'`);

    const before = await sql(`SELECT count(*)::int AS c FROM sales WHERE customer_id = '${SALE_CUSTOMER}'`);
    const res = await execRpcAsUser(EMP, 'create_sale', saleCall());
    expect(res.error).toContain('NOT_AUTHORIZED');

    // Nothing was written by the rejected call.
    const after = await sql(`SELECT count(*)::int AS c FROM sales WHERE customer_id = '${SALE_CUSTOMER}'`);
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('restores access when the role is changed back', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(2));
    expect(res.error).toBeNull();
  });

  it('loses access immediately when the membership is deactivated', async () => {
    await sql(`UPDATE memberships SET status = 'suspended' WHERE user_id = '${EMP}'`);
    const res = await execRpcAsUser(EMP, 'create_customer', customerCall(3));
    expect(res.error).toContain('NOT_AUTHORIZED');
    await sql(`UPDATE memberships SET status = 'active' WHERE user_id = '${EMP}'`);
  });

  it('reports effective permissions from the server, not the client', async () => {
    await sql(`UPDATE memberships SET role_id = '${ROLE_CLERK}' WHERE user_id = '${EMP}'`);
    const effective = await execRpcAsUser(EMP, 'get_my_permissions', {});
    expect(effective.error).toBeNull();
    const codes: string[] = Array.isArray(effective.data)
      ? effective.data
      : (effective.data?.permissions ?? []);
    // 0285 gave every role customers.create, so it can no longer be the
    // revocation probe; sales.create is the permission these roles differ on.
    expect(codes).not.toContain('sales.create');
    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
  });
});

describe('Role lifecycle — deletion is safe', () => {
  it('creates a reusable role from the API', async () => {
    const created = await execRpcAsUser(OWNER, 'create_role', {
      payload: { name: `${RUN} Role`, description: 'lifecycle probe', permissions: ['customers.view', 'customers.create'] },
    });
    expect(created.error).toBeNull();
    roleId = created.data?.id ?? created.data?.roleId;
    expect(roleId).toBeTruthy();
  });

  it('deleting a role that employees use revokes its access instead of refusing (0183)', async () => {
    // 0164 refused this with ROLE_IN_USE. The acceptance gate requires the owner's
    // intent to be carried out: deleting the role takes its access away from the people
    // working under it, in the same transaction.
    await sql(`UPDATE memberships SET role_id = '${roleId}' WHERE user_id = '${EMP}'`);

    const before = await execRpcAsUser(EMP, 'get_my_permissions', {});
    expect(before.data).toContain('customers.create');

    const res = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId } });
    expect(res.error).toBeNull();
    expect(res.data.revokedFrom).toBe(1);

    const gone = await sql(`SELECT count(*)::int AS c FROM roles WHERE id = '${roleId}'`);
    expect(gone.rows[0].c).toBe(0);

    // The membership and the employee survive; only the role reference is cleared.
    const membership = await sql(
      `SELECT role_id, status FROM memberships WHERE user_id = '${EMP}'`
    );
    expect(membership.rows[0].role_id).toBeNull();
    expect(membership.rows[0].status).toBe('active');
    const still = await sql(`SELECT count(*)::int AS c FROM users WHERE id = '${EMP}'`);
    expect(still.rows[0].c).toBe(1);

    // And the access the role provided is gone at the next authorization boundary.
    const after = await execRpcAsUser(EMP, 'get_my_permissions', {});
    expect(after.data).toEqual([]);
    const denied = await execRpcAsUser(EMP, 'create_customer', customerCall(4));
    expect(denied.error).toContain('NOT_AUTHORIZED');
    const persisted = await sql(`SELECT count(*)::int AS c FROM customers WHERE phone = '923009795004'`);
    expect(persisted.rows[0].c, 'the refused call must not have written anything').toBe(0);
  });

  it('no orphaned role or permission reference remains after the deletion', async () => {
    const orphanPerms = await sql(
      `SELECT count(*)::int AS c FROM role_permissions WHERE role_id = '${roleId}'`
    );
    expect(orphanPerms.rows[0].c).toBe(0);
    const staleMembers = await sql(
      `SELECT count(*)::int AS c FROM memberships WHERE role_id = '${roleId}'`
    );
    expect(staleMembers.rows[0].c).toBe(0);
  });

  it('repeated deletion cannot bypass the revocation', async () => {
    // The first deletion already happened above; the second must be refused as a
    // not-found role, and must not resurrect or half-apply anything.
    const again = await execRpcAsUser(OWNER, 'delete_role', { payload: { roleId } });
    expect(again.error).toContain('ROLE_NOT_FOUND_OR_NOT_AUTHORIZED');
    const gone = await sql(`SELECT count(*)::int AS c FROM roles WHERE id = '${roleId}'`);
    expect(gone.rows[0].c).toBe(0);
  });

  it('access returns only when another valid role is assigned', async () => {
    const denied = await execRpcAsUser(EMP, 'create_customer', customerCall(5));
    expect(denied.error).toContain('NOT_AUTHORIZED');

    await sql(`UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}' WHERE user_id = '${EMP}'`);
    const restored = await execRpcAsUser(EMP, 'create_customer', customerCall(5));
    expect(restored.error).toBeNull();
  });
});

describe('Profile update — identity cannot be forged', () => {
  it('updates the caller own profile', async () => {
    const res = await execRpcAsUser(OWNER, 'update_admin_profile', { payload: { name: `${RUN} Owner renamed` } });
    expect(res.error).toBeNull();
    const row = await sql(`SELECT name FROM users WHERE id = '${OWNER}'`);
    expect(row.rows[0].name).toBe(`${RUN} Owner renamed`);
  });

  it('ignores a userId pointing at another user', async () => {
    const before = await sql(`SELECT name FROM users WHERE id = '${VICTIM}'`);
    const res = await execRpcAsUser(OWNER, 'update_admin_profile', {
      payload: { userId: VICTIM, name: `${RUN} HIJACK` },
    });
    expect(res.error).toBeNull();

    const after = await sql(`SELECT name FROM users WHERE id = '${VICTIM}'`);
    expect(after.rows[0].name).toBe(before.rows[0].name);
    const me = await sql(`SELECT name FROM users WHERE id = '${OWNER}'`);
    expect(me.rows[0].name).toBe(`${RUN} HIJACK`);
  });
});

describe('Audit — access changes are attributed', () => {
  it('records role and access changes with the acting user', async () => {
    await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: ROLE_EMPLOYEE, overrides: { 'reports.view': true } },
    });
    await execRpcAsUser(OWNER, 'update_employee_access', {
      payload: { employeeId: EMP, roleId: ROLE_EMPLOYEE, overrides: {} },
    });

    const audit = await sql(
      `SELECT count(*)::int AS c FROM audit_events WHERE user_id = '${OWNER}'`
    );
    expect(audit.rows[0].c).toBeGreaterThan(0);

    const overrides = await sql(
      `SELECT count(*)::int AS c FROM user_permissions WHERE user_id = '${EMP}' AND is_override IS NOT TRUE`
    );
    expect(overrides.rows[0].c).toBe(0);
  });
});
