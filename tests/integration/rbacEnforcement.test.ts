/**
 * RBAC Enforcement Regression Suite
 *
 * Proves, with a real JWT + PostgREST + database evidence, that:
 *   1. Every user with a shop has a membership (User → Membership invariant).
 *   2. Role defaults propagate to every employee assigned to the role.
 *   3. Employee overrides (add / deny) take precedence over role defaults and
 *      can be reset back to the role.
 *   4. Protected business RPCs reject callers without the required permission
 *      and accept them once the permission is granted (same shared layer).
 *   5. One tenant cannot read or modify another tenant's roles, business areas,
 *      employees, or memberships.
 *
 * Self-contained: creates its own owner + employees + roles and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  execRpcAsUser,
  execSqlAsAdmin,
  selectAsUser,
  ensureTenantBranch,
  setActiveBranchAsUser,
} from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-00000000b0b0';
const OWNER_A = 'c1000000-0000-0000-0000-00000000000a';
const OWNER_B = 'c1000000-0000-0000-0000-00000000000b';
const PHONE_A = '923009770001';
const PHONE_B = '923009770002';
const ROLE_NAME = `QA Enforcement ${Date.now()}`;

let roleId = '';
let empAhmed = '';
let empBilal = '';
let branchMain = '';
let branchWarehouse = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

// Resolve every identity this suite can create, by phone/name/id, so cleanup is
// independent of which step failed. audit_events.user_id is an FK to users — it
// must be cleared before the users rows or the delete is rejected.
const OWNER_AUDIT_CLEANUP = `
  DELETE FROM audit_events
  WHERE user_id IN (SELECT id FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}') OR phone IN ('923009770001','923009770002','923009770031','923009770032') OR name LIKE 'QA Enforce%')
     OR entity_id IN (SELECT id FROM users WHERE phone IN ('923009770001','923009770002','923009770031','923009770032') OR name LIKE 'QA Enforce%')
     OR details->>'name' LIKE 'QA Enforcement %'
`;

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
  await trySql('OWNER_AUDIT_CLEANUP', sql(OWNER_AUDIT_CLEANUP));
  await trySql('user_permissions', sql(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}') OR phone IN ('923009770001','923009770002','923009770031','923009770032') OR name LIKE 'QA Enforce%')`));
  // Order matters: rows that reference `users` (inventory movements record the
  // actor) and `roles` (memberships hold role_id) must be removed first.
  await trySql('inventory_movements', sql(`
    DELETE FROM inventory_movements
    WHERE created_by IN (SELECT id FROM users WHERE phone IN ('923009770001','923009770002','923009770031','923009770032') OR name LIKE 'QA Enforce%')
       OR product_id IN (SELECT id FROM products WHERE name = 'QA Enforce Product')
  `));
  await trySql('stock_adjustments', sql(`DELETE FROM stock_adjustments WHERE product_id IN (SELECT id FROM products WHERE name = 'QA Enforce Product')`));
  await trySql('product_variants', sql(`DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name = 'QA Enforce Product')`));
  await trySql('products', sql(`DELETE FROM products WHERE name = 'QA Enforce Product'`));
  await trySql('customers', sql(`DELETE FROM customers WHERE phone IN ('923009770088','923009770099')`));
  await trySql('users', sql(`
    DELETE FROM users
    WHERE id IN ('${OWNER_A}','${OWNER_B}')
       OR phone IN ('923009770001','923009770002','923009770031','923009770032')
       OR name LIKE 'QA Enforce%'
  `));
  await trySql('role_permissions', sql(`
    DELETE FROM role_permissions
    WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'QA Enforcement %' OR tenant_id = '${TENANT_B}')
  `));
  await trySql('roles', sql(`DELETE FROM roles WHERE name LIKE 'QA Enforcement %' OR tenant_id = '${TENANT_B}'`));
  await trySql('shops', sql(`DELETE FROM shops WHERE id = '${TENANT_B}'`));
}

beforeAll(async () => {
  await cleanup();

  // Two controlled tenants. Tenant A already exists; tenant B is created here.
  await sql(`
    INSERT INTO shops (id, name) VALUES ('${TENANT_B}', 'QA Tenant B')
    ON CONFLICT (id) DO NOTHING
  `);

  // Owners. The 0113 trigger creates their owner membership.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}', 'QA Enforcement Owner A', '${PHONE_A}', 'admin', true, true, '${TENANT_A}'),
      ('${OWNER_B}', 'QA Enforcement Owner B', '${PHONE_B}', 'admin', true, true, '${TENANT_B}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, is_original_owner = true, shop_id = EXCLUDED.shop_id
  `);

  const branches = await sql(
    `SELECT id, name FROM branches WHERE tenant_id = '${TENANT_A}' AND is_active = true ORDER BY is_default DESC, created_at`
  );
  branchMain = branches.rows[0]?.id;
  branchWarehouse = branches.rows[1]?.id ?? branchMain;
  expect(branchMain).toBeTruthy();

  // Tenant B was created as a bare shop row, so it has no branch to work in and 0188's
  // authorize_business_action refuses every action with "branch access denied" — a branch is not its
  // tenant, and a tenant with no branch cannot operate. Creating the default branch and selecting it,
  // through the app's own RPC, is what registration plus first branch selection does.
  const branchB = await ensureTenantBranch(TENANT_B, 'QA Tenant B Main');
  await setActiveBranchAsUser(OWNER_B, branchB);
  await setActiveBranchAsUser(OWNER_A, branchMain);
  throwIfCleanupFailed('rbacEnforcement beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('rbacEnforcement afterAll cleanup');
});

describe('RBAC enforcement — User → Membership invariant', () => {
  it('gives every user with a shop an active membership', async () => {
    const orphans = await sql(`
      SELECT count(*)::int AS c FROM users u
      WHERE u.shop_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
    `);
    expect(orphans.rows[0].c).toBe(0);

    const owner = await sql(
      `SELECT role, status FROM memberships WHERE user_id = '${OWNER_A}' AND tenant_id = '${TENANT_A}'`
    );
    expect(owner.rows[0]?.role).toBe('owner');
    expect(owner.rows[0]?.status).toBe('active');
  });

  it('gives the owner the full permission set implicitly', async () => {
    const perms = await execRpcAsUser(OWNER_A, 'get_my_permissions', {});
    expect(perms.error).toBeNull();
    const all = await sql(`SELECT count(*)::int AS c FROM permissions`);
    expect((perms.data as string[]).length).toBe(all.rows[0].c);
  });
});

describe('RBAC enforcement — role defaults propagate to employees', () => {
  it('creates a reusable role and two employees on it', async () => {
    const role = await execRpcAsUser(OWNER_A, 'create_role', {
      payload: {
        name: ROLE_NAME,
        description: 'QA enforcement role',
        permissions: ['sales.view', 'customers.view', 'products.view'],
      },
    });
    expect(role.error).toBeNull();
    roleId = role.data.id;

    const ahmed = await execRpcAsUser(OWNER_A, 'create_employee', {
      payload: {
        name: 'QA Enforce Ahmed',
        phone: '923009770031',
        membershipRole: 'employee',
        roleId,
        branchScope: [branchMain],
      },
    });
    expect(ahmed.error).toBeNull();
    empAhmed = ahmed.data.id;

    const bilal = await execRpcAsUser(OWNER_A, 'create_employee', {
      payload: {
        name: 'QA Enforce Bilal',
        phone: '923009770032',
        membershipRole: 'employee',
        roleId,
        branchScope: [branchMain],
      },
    });
    expect(bilal.error).toBeNull();
    empBilal = bilal.data.id;

    // Role defaults are NOT copied into user_permissions.
    const overrides = await sql(
      `SELECT count(*)::int AS c FROM user_permissions WHERE user_id IN ('${empAhmed}','${empBilal}')`
    );
    expect(overrides.rows[0].c).toBe(0);

    // Adding an employee ISSUES AN INVITATION. The membership is pending, so the
    // invitee holds no access at all until they complete onboarding — and a role
    // assignment alone must never be what grants it.
    const invited = await sql(
      `SELECT status FROM memberships WHERE user_id IN ('${empAhmed}','${empBilal}')`
    );
    expect(invited.rows.map((r) => r.status)).toEqual(['pending', 'pending']);
    const invitedPerms = await execRpcAsUser(empAhmed, 'get_my_permissions', {});
    expect(invitedPerms.data ?? []).toEqual([]);

    // Onboarding completes with the invitee's own verified sign-in.
    const onboard = await execRpcAsUser(empAhmed, 'complete_member_onboarding', {});
    expect(onboard.error).toBeNull();
    expect(onboard.data.activated).toBe(1);
    const onboardBilal = await execRpcAsUser(empBilal, 'complete_member_onboarding', {});
    expect(onboardBilal.error).toBeNull();
    const accepted = await sql(
      `SELECT status FROM memberships WHERE user_id IN ('${empAhmed}','${empBilal}')`
    );
    expect(accepted.rows.map((r) => r.status)).toEqual(['active', 'active']);

    // Onboarding is idempotent: a second call activates nothing (no double-login effect).
    const again = await execRpcAsUser(empAhmed, 'complete_member_onboarding', {});
    expect(again.error).toBeNull();
    expect(again.data.activated).toBe(0);
  });

  it('propagates an added permission to every employee on the role', async () => {
    const before = await execRpcAsUser(empAhmed, 'get_my_permissions', {});
    expect(before.data).not.toContain('inventory.adjust');

    const updated = await execRpcAsUser(OWNER_A, 'update_role', {
      payload: {
        roleId,
        permissions: ['sales.view', 'customers.view', 'products.view', 'inventory.adjust'],
      },
    });
    expect(updated.error).toBeNull();

    const ahmed = await execRpcAsUser(empAhmed, 'get_my_permissions', {});
    const bilal = await execRpcAsUser(empBilal, 'get_my_permissions', {});
    expect(ahmed.data).toContain('inventory.adjust');
    expect(bilal.data).toContain('inventory.adjust');
  });

  it('propagates a removed permission to every employee on the role', async () => {
    const updated = await execRpcAsUser(OWNER_A, 'update_role', {
      payload: { roleId, permissions: ['sales.view', 'customers.view', 'inventory.adjust'] },
    });
    expect(updated.error).toBeNull();

    const ahmed = await execRpcAsUser(empAhmed, 'get_my_permissions', {});
    const bilal = await execRpcAsUser(empBilal, 'get_my_permissions', {});
    expect(ahmed.data).not.toContain('products.view');
    expect(bilal.data).not.toContain('products.view');
  });
});

describe('RBAC enforcement — backend business authorization', () => {
  const MISSING_PRODUCT = '30000000-0000-0000-0000-0000000000ff';

  it('rejects a protected RPC when the permission is missing', async () => {
    // No employee role grants products.delete.
    const denied = await execRpcAsUser(empBilal, 'delete_product', { payload: { id: MISSING_PRODUCT } });
    expect(denied.error).toContain('NOT_AUTHORIZED');
    expect(denied.error).toContain('products.delete');
    expect(denied.error).not.toContain('PRODUCT_NOT_FOUND');
  });

  it('allows the same RPC once the role grants the permission', async () => {
    const granted = await execRpcAsUser(OWNER_A, 'update_role', {
      payload: {
        roleId,
        permissions: ['sales.view', 'customers.view', 'inventory.adjust', 'products.delete'],
      },
    });
    expect(granted.error).toBeNull();

    const allowed = await execRpcAsUser(empBilal, 'delete_product', { payload: { id: MISSING_PRODUCT } });
    // Authorization passed; only business validation can fail now.
    expect(allowed.error).toBeTruthy();
    expect(allowed.error).not.toContain('NOT_AUTHORIZED');
    expect(allowed.error).toContain('PRODUCT_NOT_FOUND');
  });

  it('lets an employee with inventory.adjust change real stock and records the movement', async () => {
    const created = await execRpcAsUser(OWNER_A, 'create_product', {
      payload: {
        name: 'QA Enforce Product',
        category: 'other',
        variants: [{ name: 'QA 1kg', sellingPrice: 100, costPrice: 80, stockQty: 10, unitSize: 1 }],
      },
    });
    expect(created.error).toBeNull();
    const productId = created.data.id as string;

    const variant = await sql(`SELECT id FROM product_variants WHERE product_id = '${productId}' LIMIT 1`);
    const variantId = variant.rows[0].id;

    const adjusted = await execRpcAsUser(empAhmed, 'adjust_stock', {
      payload: {
        productId,
        variantId,
        productName: 'QA Enforce Product',
        adjustmentType: 'add',
        qty: 5,
        reason: 'QA enforcement adjustment',
      },
    });
    expect(adjusted.error).toBeNull();

    const after = await sql(`SELECT stock_qty FROM product_variants WHERE id = '${variantId}'`);
    expect(Number(after.rows[0].stock_qty)).toBe(15);

    const movements = await sql(
      `SELECT movement_type, qty_change FROM inventory_movements WHERE product_id = '${productId}'`
    );
    expect(movements.rows.length).toBeGreaterThan(0);
    expect(movements.rows.some((m: any) => m.movement_type === 'adjustment')).toBe(true);
  });

  it('rejects cross-branch operations for a branch-scoped employee', async () => {
    if (branchWarehouse === branchMain) return; // single-branch environment

    const granted = await execRpcAsUser(OWNER_A, 'update_role', {
      payload: {
        roleId,
        permissions: ['sales.view', 'customers.view', 'inventory.adjust', 'products.delete', 'customers.create'],
      },
    });
    expect(granted.error).toBeNull();

    const denied = await execRpcAsUser(empAhmed, 'create_customer', {
      payload: { name: 'QA Branch Probe', phone: '923009770099', branchId: branchWarehouse },
    });
    expect(denied.error).toContain('branch access denied');
  });

  it('persists no rows for a rejected operation', async () => {
    const probe = await sql(`SELECT count(*)::int AS c FROM customers WHERE phone = '923009770099'`);
    expect(probe.rows[0].c).toBe(0);
  });
});

describe('RBAC enforcement — employee overrides and reset', () => {
  it('applies an explicit deny plus an explicit grant on top of the role', async () => {
    const updated = await execRpcAsUser(OWNER_A, 'update_employee_access', {
      payload: {
        employeeId: empAhmed,
        roleId,
        overrides: { 'sales.view': false, 'settings.view': true },
        branchScope: [branchMain],
      },
    });
    expect(updated.error).toBeNull();

    const access = await execRpcAsUser(OWNER_A, 'get_employee_access', { p_employee_id: empAhmed });
    expect(access.error).toBeNull();
    expect(access.data.defaults).toContain('sales.view');
    expect(access.data.effective).not.toContain('sales.view');
    expect(access.data.effective).toContain('settings.view');
    expect(access.data.overrides['sales.view']).toBe(false);
    expect(access.data.overrides['settings.view']).toBe(true);
  });

  it('resets the employee back to role defaults', async () => {
    const reset = await execRpcAsUser(OWNER_A, 'update_employee_access', {
      payload: { employeeId: empAhmed, resetOverrides: true },
    });
    expect(reset.error).toBeNull();

    const access = await execRpcAsUser(OWNER_A, 'get_employee_access', { p_employee_id: empAhmed });
    expect(access.data.effective).toContain('sales.view');
    expect(access.data.effective).not.toContain('settings.view');
    expect(Object.keys(access.data.overrides ?? {}).length).toBe(0);

    const rows = await sql(`SELECT count(*)::int AS c FROM user_permissions WHERE user_id = '${empAhmed}'`);
    expect(rows.rows[0].c).toBe(0);
  });

  it('changes the effective access when the employee is moved to another role', async () => {
    const otherRole = await execRpcAsUser(OWNER_A, 'create_role', {
      payload: { name: `${ROLE_NAME} alt`, permissions: ['reports.view'] },
    });
    expect(otherRole.error).toBeNull();

    const moved = await execRpcAsUser(OWNER_A, 'update_employee_access', {
      payload: { employeeId: empAhmed, roleId: otherRole.data.id },
    });
    expect(moved.error).toBeNull();

    const extraRoleId = otherRole.data.id as string;
    try {
      const access = await execRpcAsUser(OWNER_A, 'get_employee_access', { p_employee_id: empAhmed });
      expect(access.data.roleId).toBe(extraRoleId);
      expect(access.data.effective).toContain('reports.view');
      // Old role's permissions must not linger.
      expect(access.data.effective).not.toContain('sales.view');
      expect(access.data.effective).not.toContain('inventory.adjust');
    } finally {
      await execRpcAsUser(OWNER_A, 'update_employee_access', {
        payload: { employeeId: empAhmed, roleId },
      });
      await sql(`DELETE FROM role_permissions WHERE role_id = '${extraRoleId}'`);
      await sql(`DELETE FROM roles WHERE id = '${extraRoleId}'`);
    }
  });
});

describe('RBAC enforcement — tenant isolation', () => {
  it('assigns owner B to tenant B and keeps owner A in tenant A', async () => {
    const rows = await sql(`
      SELECT user_id, tenant_id, role FROM memberships
      WHERE user_id IN ('${OWNER_A}','${OWNER_B}') ORDER BY user_id
    `);
    const map = Object.fromEntries(rows.rows.map((r: any) => [r.user_id, r.tenant_id]));
    expect(map[OWNER_A]).toBe(TENANT_A);
    expect(map[OWNER_B]).toBe(TENANT_B);
  });

  it('prevents tenant B from reading tenant A employees or mutating them', async () => {
    const read = await execRpcAsUser(OWNER_B, 'get_employee_access', { p_employee_id: empAhmed });
    expect(read.error).toBeTruthy();
    expect(read.error).toMatch(/NOT_AUTHORIZED|NOT_FOUND/);

    const write = await execRpcAsUser(OWNER_B, 'update_employee_access', {
      payload: { employeeId: empAhmed, overrides: { 'sales.view': true } },
    });
    expect(write.error).toBeTruthy();
    expect(write.error).toMatch(/NOT_AUTHORIZED|NOT_FOUND/);

    // Tenant A employee is untouched.
    const perms = await sql(`SELECT count(*)::int AS c FROM user_permissions WHERE user_id = '${empAhmed}'`);
    expect(perms.rows[0].c).toBe(0);
  });

  it('does not expose tenant A roles or business areas to tenant B through RLS', async () => {
    const created = await execRpcAsUser(OWNER_B, 'create_role', {
      payload: { name: 'QA Tenant B Role', permissions: ['sales.view'] },
    });
    expect(created.error).toBeNull();
    const tenantBRoleId = created.data.id as string;

    try {
      const bRoles = await selectAsUser(OWNER_B, 'roles', 'id,tenant_id');
      expect(bRoles.error).toBeNull();
      expect(bRoles.data!.every((r: any) => r.tenant_id === TENANT_B)).toBe(true);
      expect(bRoles.data!.some((r: any) => r.tenant_id === TENANT_A)).toBe(false);

      const aRoles = await selectAsUser(OWNER_A, 'roles', 'id,tenant_id');
      expect(aRoles.error).toBeNull();
      expect(aRoles.data!.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
      expect(aRoles.data!.some((r: any) => r.id === tenantBRoleId)).toBe(false);

      const aAreas = await selectAsUser(OWNER_A, 'business_areas', 'id,tenant_id');
      expect(aAreas.error).toBeNull();
      expect(aAreas.data!.every((r: any) => r.tenant_id === TENANT_A)).toBe(true);
    } finally {
      await sql(`DELETE FROM role_permissions WHERE role_id = '${tenantBRoleId}'`);
      await sql(`DELETE FROM roles WHERE id = '${tenantBRoleId}'`);
    }
  });

  it('rejects an employee from executing a business RPC in another tenant', async () => {
    const denied = await execRpcAsUser(OWNER_B, 'create_customer', {
      payload: { name: 'Cross Tenant Probe', phone: '923009770088', shopId: TENANT_A },
    });
    // Tenant B resolves its own tenant; the A tenant id can never be accepted.
    const created = denied.error === null;
    if (created) {
      const row = await sql(`SELECT shop_id FROM customers WHERE phone = '923009770088'`);
      expect(row.rows[0]?.shop_id).toBe(TENANT_B);
      await sql(`DELETE FROM customers WHERE phone = '923009770088'`);
    } else {
      expect(denied.error).toMatch(/NOT_AUTHORIZED|NOT_AUTHENTICATED/);
    }
  });
});
