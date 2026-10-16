/**
 * Security matrix — one tenant, four personas, four consequential RPCs.
 *
 * WHY THIS EXISTS. The staging checklist's §3 recorded, in its own words, that
 * "the per-role backend matrix was never run (workstream item 3 = BLOCKED)". What existed was
 * pairwise: `securityAudit` and `employeePermissions` compare an admin fixture with an employee
 * fixture, and `rbacEnforcement` proves grants/denials reach ONE role's members. Nothing measured
 * Owner, Admin, Manager and Employee side by side on the SAME actions in the SAME tenant, so
 * "a manager may, an employee may not" was never a measured statement.
 *
 * WHAT IT ASSERTS, and the layer each assertion is about:
 *   1. Per-role RPC authorization, one action at a time, all four personas:
 *        customers.create  → everyone (it is the shop-floor permission)
 *        sales.void        → owner/admin/manager, refused for the employee
 *        inventory.adjust  → owner only
 *        employees.manage  → owner only
 *      A refusal is asserted as the guard's own message (`NOT_AUTHORIZED: missing permission
 *      <code>`), and an ALLOW is asserted as the ABSENCE of that message — the call must fail
 *      later, on business validation, which is what makes "allowed" mean "authorization passed"
 *      rather than "nothing happened". Every payload is chosen so an authorized caller mutates
 *      nothing: the tests are about who may pass the guard, not about writing rows.
 *   2. `membership role = 'admin'` is not an implicit permission set. The owner short-circuits to
 *      every code (0195); an admin must not. Proven with an admin whose role holds one unrelated
 *      permission: it is refused customers.create exactly like an employee.
 *   3. Direct API/RPC bypass. As `anon`, as an authenticated employee writing a money ledger
 *      straight into PostgREST, and as an employee granting itself a permission through
 *      user_permissions. Each is refused, and the permission count is re-measured afterwards so
 *      a refusal that still wrote cannot pass.
 *   4. Sensitive fields (cost/margin, customer, supplier) behind a read gate. A signed-in member
 *      with no `customers.view`/`companies.view` reads ZERO rows from `customers` and `companies`
 *      while the owner reads real rows, and the same member reads zero `product_variants` rows
 *      (0179 narrowed that table to admins). The RPC layer is checked too: an owner may not name
 *      another tenant's customer, supplier or product — `guard_operational_request` refuses it.
 *   5. A write addressed to another branch is refused for a branch-scoped member and accepted for
 *      the owner, with the branch being worked in deciding which sales a member may read.
 *
 * Self-contained: creates its own personas and roles in the existing QA tenant and removes them.
 * Production is never touched (`tests/setup/env-guard.ts` refuses any other project).
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { randomUUID } from 'crypto';
import {
  execRpcAsUser,
  execSqlAsAdmin,
  insertAsUser,
  selectAsUser,
  ensureTenantBranch,
  setActiveBranchAsUser,
  setMembershipBranchScope,
  qaAnonClient,
} from '../setup/qa-client';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OWNER = 'fe200000-0000-0000-0000-00000000000a';
const ADMIN = 'fe200000-0000-0000-0000-00000000000b';
const MANAGER = 'fe200000-0000-0000-0000-00000000000c';
const EMPLOYEE = 'fe200000-0000-0000-0000-00000000000d';
/** An admin whose role holds one unrelated permission: admin ≠ owner, measured. */
const ADMIN_NO_RIGHTS = 'fe200000-0000-0000-0000-00000000000e';

const PHONE = {
  owner: '923009990001',
  admin: '923009990002',
  manager: '923009990003',
  employee: '923009990004',
  adminNoRights: '923009990005',
};

const RUN = `QA SecurityMatrix ${Date.now()}`;
const ROLE_PREFIX = 'QA Security Matrix';

let roleAdmin = '';
let roleManager = '';
let roleEmployee = '';
let roleNoRights = '';
let branchMain = '';
let branchWarehouse = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

/** The guard's own refusal text, so a denial is asserted as the guard wrote it. */
const missingPermission = (code: string) => `missing permission ${code}`;

/** The four personas, matched to the ids the matrix acts as. */
const personas = (): Array<[string, string]> => [
  ['owner', OWNER],
  ['admin', ADMIN],
  ['manager', MANAGER],
  ['employee', EMPLOYEE],
];

/** An authorized call fails LATER (business validation); a refused one fails AT the guard. */
const expectAllowed = (error: string | null, code: string, who: string, action: string) => {
  expect(error, `${who} was refused ${action} as if unentitled`).not.toContain(missingPermission(code));
};
const expectDenied = (error: string | null, code: string, who: string, action: string) => {
  expect(error ?? '', `${who} was NOT refused ${action}`).toContain(missingPermission(code));
};

/**
 * Every identity and role this suite can create, resolved by id/phone/name so cleanup is
 * independent of which step failed. `audit_events.user_id` is an FK to `users` and
 * `memberships.role_id` an FK to `roles`, so both ledgers must be cleared before their parents.
 */
async function cleanup() {
  const users = `'${OWNER}','${ADMIN}','${MANAGER}','${EMPLOYEE}','${ADMIN_NO_RIGHTS}'`;
  const phones = Object.values(PHONE).map((p) => `'${p}'`).join(',');
  const roles = `name LIKE '${ROLE_PREFIX} %'`;

  const statements = [
    `DELETE FROM audit_events
       WHERE user_id IN (${users})
          OR entity_id IN (${users})
          OR entity_id IN (SELECT id FROM roles WHERE ${roles})
          OR details->>'name' LIKE 'QA SecurityMatrix %'`,
    `DELETE FROM user_permissions WHERE user_id IN (${users})`,
    `DELETE FROM memberships WHERE user_id IN (${users})`,
    `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE ${roles})`,
    `DELETE FROM roles WHERE ${roles}`,
    `DELETE FROM users WHERE id IN (${users}) OR phone IN (${phones})`,
  ];

  const failures: string[] = [];
  for (const statement of statements) {
    try {
      const result: any = await sql(statement);
      if (result?.error) failures.push(`${statement.slice(0, 48)}… → ${String(result.error.message ?? result.error)}`);
    } catch (error) {
      failures.push(`${statement.slice(0, 48)}… → ${String(error)}`);
    }
  }
  expect(failures, `cleanup left rows behind: ${failures.join(' | ')}`).toEqual([]);
}

beforeAll(async () => {
  await cleanup();

  // The branches the tenant works in. `ensureTenantBranch` is the app's own registration path;
  // a tenant with no branch cannot operate at all (0188), so this is setup, not a shortcut.
  branchMain = await ensureTenantBranch(TENANT, 'Main Branch');
  const branches = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT}' AND is_active = true ORDER BY is_default DESC, created_at`
  );
  branchWarehouse = branches.rows[1]?.id ?? branchMain;

  // Personas. The 0113 trigger gives each one its membership; role and scope are set below the way
  // the product's own invitation path writes them, because a membership with no scope is refused
  // everything (0188) and that is not the state being measured.
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER}',          '${RUN} Owner',           '${PHONE.owner}',         'admin',    true,  true, '${TENANT}'),
      ('${ADMIN}',          '${RUN} Admin',           '${PHONE.admin}',         'admin',    false, true, '${TENANT}'),
      ('${MANAGER}',        '${RUN} Manager',         '${PHONE.manager}',       'employee', false, true, '${TENANT}'),
      ('${EMPLOYEE}',       '${RUN} Employee',        '${PHONE.employee}',      'employee', false, true, '${TENANT}'),
      ('${ADMIN_NO_RIGHTS}','${RUN} AdminNoRights',   '${PHONE.adminNoRights}', 'admin',    false, true, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, shop_id = EXCLUDED.shop_id
  `);

  await setActiveBranchAsUser(OWNER, branchMain);

  // Four roles, each an explicit permission set. Deliberately NOT the seeded templates: the
  // matrix has to say which permission produces which answer, and 0111 later adds
  // employees.manage/settings to the seeded Store Manager, which would blur the admin row.
  const made = await execRpcAsUser(OWNER, 'create_role', {
    payload: {
      name: `${ROLE_PREFIX} Admin`,
      description: 'QA matrix admin: sales + customers, no inventory, no employee management',
      permissions: ['customers.view', 'customers.create', 'sales.view', 'sales.void', 'products.view'],
    },
  });
  expect(made.error, `admin role: ${made.error}`).toBeNull();
  roleAdmin = made.data.id as string;

  const manager = await execRpcAsUser(OWNER, 'create_role', {
    payload: {
      name: `${ROLE_PREFIX} Manager`,
      description: 'QA matrix manager: the sales counter plus void, no inventory, no employee management',
      permissions: [
        'customers.view', 'customers.create', 'sales.view', 'sales.create', 'sales.void',
        'products.view', 'inventory.view', 'returns.view',
      ],
    },
  });
  expect(manager.error, `manager role: ${manager.error}`).toBeNull();
  roleManager = manager.data.id as string;

  const employee = await execRpcAsUser(OWNER, 'create_role', {
    payload: {
      name: `${ROLE_PREFIX} Employee`,
      description: 'QA matrix employee: the shop floor, nothing consequential',
      permissions: ['customers.view', 'customers.create', 'sales.view', 'sales.create', 'products.view', 'inventory.view'],
    },
  });
  expect(employee.error, `employee role: ${employee.error}`).toBeNull();
  roleEmployee = employee.data.id as string;

  const noRights = await execRpcAsUser(OWNER, 'create_role', {
    payload: {
      name: `${ROLE_PREFIX} AdminNoRights`,
      description: 'QA matrix admin with one unrelated permission, to prove admin is not the owner',
      permissions: ['reports.view'],
    },
  });
  expect(noRights.error, `no-rights admin role: ${noRights.error}`).toBeNull();
  roleNoRights = noRights.data.id as string;

  const assignments: Array<[string, string]> = [
    [ADMIN, roleAdmin],
    [MANAGER, roleManager],
    [EMPLOYEE, roleEmployee],
    [ADMIN_NO_RIGHTS, roleNoRights],
  ];
  for (const [userId, roleId] of assignments) {
    await sql(`UPDATE memberships SET role_id = '${roleId}', status = 'active' WHERE user_id = '${userId}'`);
    await setMembershipBranchScope(userId, TENANT, [branchMain]);
    await setActiveBranchAsUser(userId, branchMain);
  }

  // The fixture is real: every persona resolves to the branch being worked in. Without this a
  // refusal below could be "no branch at all" rather than the permission guard, which is the
  // vacuity this matrix must not have.
  for (const userId of [OWNER, ADMIN, MANAGER, EMPLOYEE, ADMIN_NO_RIGHTS]) {
    const row = await sql(
      `SELECT (SELECT count(*)::int FROM user_active_shops WHERE user_id = '${userId}' AND branch_id = '${branchMain}') AS shops,
              (SELECT count(*)::int FROM memberships WHERE user_id = '${userId}' AND status = 'active') AS memberships`
    );
    expect(row.rows[0], `${userId} has no active shop/branch context`).toEqual({ shops: 1, memberships: 1 });
  }
});

afterAll(async () => {
  await cleanup();
});

describe('Security matrix — per-role RPC authorization', () => {
  it('customers.create is the shop-floor permission: owner, admin, manager and employee all pass the guard', async () => {
    for (const [who, userId] of personas()) {
      // The latitude is deliberately not a number, so an authorized caller is stopped by the
      // INSERT's own cast and no customer row is created. Authorization runs before that.
      const result = await execRpcAsUser(userId, 'create_customer', {
        payload: { name: `${RUN} probe`, latitude: 'not-a-number' },
      });
      expect(result.error, `${who} was authorized but produced no error at all`).toBeTruthy();
      expect(result.error, `${who} failed for a reason other than the invalid latitude: ${result.error}`)
        .toContain('double precision');
      expectAllowed(result.error, 'customers.create', who, 'create_customer');
    }
  });

  it('sales.void: owner, admin and manager pass the guard; the employee is refused with sales.void', async () => {
    const saleId = randomUUID();
    for (const [who, userId] of personas()) {
      const result = await execRpcAsUser(userId, 'void_sale', {
        p_sale_id: saleId,
        p_reason: 'QA security matrix',
        p_voided_by: userId,
      });
      expect(result.error, `${who} produced no error for a sale that does not exist`).toBeTruthy();
      if (who === 'employee') {
        expectDenied(result.error, 'sales.void', who, 'void_sale');
        // The refusal is the permission guard, not the record-branch check: an employee must not be
        // able to tell whether the sale exists.
        expect(result.error, 'the employee reached the record lookup').not.toContain('record branch');
      } else {
        expectAllowed(result.error, 'sales.void', who, 'void_sale');
        expect(result.error, `${who} did not reach the record-branch check: ${result.error}`)
          .toContain('record branch access denied');
      }
    }
  });

  it('inventory.adjust: only the owner passes the guard', async () => {
    for (const [who, userId] of personas()) {
      const result = await execRpcAsUser(userId, 'adjust_stock', {
        payload: {
          productId: randomUUID(),
          variantId: randomUUID(),
          productName: `${RUN} probe`,
          adjustmentType: 'adjustment',
          qty: 1,
          reason: 'QA security matrix',
        },
      });
      expect(result.error, `${who} produced no error`).toBeTruthy();
      if (who === 'owner') {
        expectAllowed(result.error, 'inventory.adjust', who, 'adjust_stock');
        expect(result.error, `the owner did not reach the product check: ${result.error}`)
          .toContain('product access denied');
      } else {
        expectDenied(result.error, 'inventory.adjust', who, 'adjust_stock');
      }
    }
  });

  it('employees.manage: only the owner passes the guard', async () => {
    for (const [who, userId] of personas()) {
      const result = await execRpcAsUser(userId, 'deactivate_employee_v1', {
        payload: { employeeId: randomUUID() },
      });
      expect(result.error, `${who} produced no error`).toBeTruthy();
      if (who === 'owner') {
        expectAllowed(result.error, 'employees.manage', who, 'deactivate_employee_v1');
        expect(result.error, `the owner did not reach the lookup: ${result.error}`).toContain('EMPLOYEE_NOT_FOUND');
      } else {
        expectDenied(result.error, 'employees.manage', who, 'deactivate_employee_v1');
      }
    }
  });

  it('a permission the role does not carry is refused even when the code is a real one', async () => {
    // products.delete is a real permission, held by nobody in this matrix. A refusal that named no
    // code, or a different one, would still be a refusal — but not evidence about this permission.
    for (const [who, userId] of personas()) {
      if (who === 'owner') continue;
      const result = await execRpcAsUser(userId, 'delete_product', { payload: { id: randomUUID() } });
      expect(result.error, `${who} produced no error`).toBeTruthy();
      expectDenied(result.error, 'products.delete', who, 'delete_product');
    }
  });
});

describe('Security matrix — every consequential RPC the ledger guards is represented', () => {
  // 0192 guards seven reachable consequential RPCs. Four already have rows above (create_sale,
  // void_sale, adjust_stock, record_supplier_payment). These three are the rest, each refused for the
  // employee with the exact code its guard raises — which is what
  // `tests/unit/securityMatrixCoverage.test.ts` reads when it fails on a new consequential RPC that
  // reached the ledger without a row here.
  it('create_purchase is refused for an employee with purchases.create', async () => {
    const denied = await execRpcAsUser(EMPLOYEE, 'create_purchase', {
      payload: { idempotencyKey: `${RUN}-purchase` },
    });
    expect(denied.error, 'an employee reached create_purchase').toBeTruthy();
    expectDenied(denied.error, 'purchases.create', 'employee', 'create_purchase');
  });

  it('process_return is refused for an employee with returns.create', async () => {
    const denied = await execRpcAsUser(EMPLOYEE, 'process_return', {
      payload: { saleId: randomUUID(), reason: 'QA security matrix', items: [] },
    });
    expect(denied.error, 'an employee reached process_return').toBeTruthy();
    expectDenied(denied.error, 'returns.create', 'employee', 'process_return');
  });

  it('record_customer_payment is refused for an employee with customers.payments', async () => {
    const denied = await execRpcAsUser(EMPLOYEE, 'record_customer_payment', {
      payload: { customerId: randomUUID(), amount: 1, method: 'cash' },
    });
    expect(denied.error, 'an employee reached record_customer_payment').toBeTruthy();
    expectDenied(denied.error, 'customers.payments', 'employee', 'record_customer_payment');
  });

  it('create_sale is refused for a member that does not hold sales.create', async () => {
    // The seventh guarded RPC. It is reached as the owner in the sensitive-field block above (which
    // is the parent check, not the permission); this row asserts the permission refusal itself.
    const denied = await execRpcAsUser(ADMIN_NO_RIGHTS, 'create_sale', {
      payload: {
        customerId: randomUUID(),
        employeeId: ADMIN_NO_RIGHTS,
        paymentType: 'cash',
        paymentMethod: 'cash',
        amountPaid: 0,
        items: [],
      },
    });
    expect(denied.error, 'a member without sales.create reached create_sale').toBeTruthy();
    expectDenied(denied.error, 'sales.create', 'admin (no rights)', 'create_sale');
  });
});

describe('Security matrix — admin is a role, not the owner', () => {
  it('an admin whose role holds one unrelated permission cannot create a customer', async () => {
    // 0195: "Owner is the only implicit permission set." If membership role `admin` short-circuited
    // the way `owner` does, this call would pass the guard and fail later — it must fail AT the guard.
    const result = await execRpcAsUser(ADMIN_NO_RIGHTS, 'create_customer', {
      payload: { name: `${RUN} admin probe`, latitude: 'not-a-number' },
    });
    expect(result.error).toBeTruthy();
    expectDenied(result.error, 'customers.create', 'admin (no rights)', 'create_customer');

    // ...while the owner, who is the implicit full set, is not refused that way.
    const owner = await execRpcAsUser(OWNER, 'create_customer', {
      payload: { name: `${RUN} owner probe`, latitude: 'not-a-number' },
    });
    expectAllowed(owner.error, 'customers.create', 'owner', 'create_customer');

    // And the two sets are measurably different, so the assertion is not resting on one call.
    const adminPerms = await execRpcAsUser(ADMIN_NO_RIGHTS, 'get_my_permissions', {});
    expect(adminPerms.error).toBeNull();
    expect(adminPerms.data).toEqual(['reports.view']);

    const ownerPerms = await execRpcAsUser(OWNER, 'get_my_permissions', {});
    expect(ownerPerms.error).toBeNull();
    expect((ownerPerms.data as string[]).length).toBeGreaterThan(20);
  });
});

describe('Security matrix — direct API/RPC bypass', () => {
  it('an anonymous client cannot call a business RPC', async () => {
    const { data, error } = await qaAnonClient.rpc('create_customer', {
      payload: { name: `${RUN} anon probe` },
    });
    expect(data ?? null).toBeNull();
    expect(error, 'an anonymous caller reached create_customer').toBeTruthy();
  });

  it('an anonymous client reads zero customer and supplier rows', async () => {
    const customers = await qaAnonClient.from('customers').select('id');
    const companies = await qaAnonClient.from('companies').select('id');
    expect((customers.data ?? []).length, 'anon read customer rows').toBe(0);
    expect((companies.data ?? []).length, 'anon read supplier rows').toBe(0);
  });

  it('an employee cannot write a money ledger directly through PostgREST', async () => {
    // 0195 revoked INSERT/UPDATE/DELETE on the ledgers from `authenticated`: the atomic RPCs are the
    // only path, so balance/stock/history invariants cannot be bypassed by a direct write.
    const direct = await insertAsUser(EMPLOYEE, 'customer_payments', {
      customer_id: randomUUID(),
      amount: 1,
      method: 'cash',
    });
    expect(direct.error, 'an employee wrote customer_payments directly').toBeTruthy();

    const sale = await insertAsUser(EMPLOYEE, 'sales', {
      sale_number: `${RUN}-direct`,
      customer_id: randomUUID(),
      employee_id: EMPLOYEE,
      total_amount: 1,
    });
    expect(sale.error, 'an employee wrote a sale row directly').toBeTruthy();
  });

  it('an employee cannot grant itself a permission through user_permissions', async () => {
    const permission = await sql(`SELECT id FROM permissions WHERE code = 'inventory.adjust'`);
    const permissionId = permission.rows[0]?.id as string;
    expect(permissionId, 'the permission catalogue is missing inventory.adjust').toBeTruthy();

    const escalation = await insertAsUser(EMPLOYEE, 'user_permissions', {
      user_id: EMPLOYEE,
      permission_id: permissionId,
      is_override: true,
      is_granted: true,
    });
    expect(escalation.error, 'an employee granted itself a permission directly').toBeTruthy();

    // The refusal must not have written: re-measure the effective set AND the row count.
    const after = await execRpcAsUser(EMPLOYEE, 'get_my_permissions', {});
    expect(after.error).toBeNull();
    expect(after.data, 'the escalation landed despite the refusal').not.toContain('inventory.adjust');

    const rows = await sql(
      `SELECT count(*)::int AS c FROM user_permissions WHERE user_id = '${EMPLOYEE}' AND permission_id = '${permissionId}'`
    );
    expect(rows.rows[0].c, 'a user_permissions row exists for an employee override').toBe(0);
  });
});

describe('Security matrix — sensitive fields behind the read gate', () => {
  it('cost/margin: a member without rights reads no product_variants row, while the owner reads real ones', async () => {
    const denied = await selectAsUser(ADMIN_NO_RIGHTS, 'product_variants', 'id,cost_price');
    expect(denied.error, `the read gate returned an error instead of nothing: ${denied.error}`).toBeNull();
    expect((denied.data ?? []).length, 'a member with no products.view read variant cost data').toBe(0);

    // The control that makes the absence above a refusal rather than an empty tenant.
    const owner = await selectAsUser(OWNER, 'product_variants', 'id,cost_price');
    expect(owner.error).toBeNull();
    const rows = owner.data ?? [];
    expect(rows.length, 'the owner sees no variant either: the absence above proved nothing').toBeGreaterThan(0);
    expect(rows.some((r: any) => r.cost_price !== null && r.cost_price !== undefined)).toBe(true);
  });

  it('customer and supplier records: zero rows without customers.view/companies.view, real rows with them', async () => {
    for (const [table, control] of [['customers', 'customers.view'], ['companies', 'companies.view']] as const) {
      const denied = await selectAsUser(ADMIN_NO_RIGHTS, table, 'id');
      expect(denied.error, `${table}: the gate returned an error instead of nothing: ${denied.error}`).toBeNull();
      expect((denied.data ?? []).length, `${table} was readable without ${control}`).toBe(0);

      const owner = await selectAsUser(OWNER, table, 'id');
      expect(owner.error).toBeNull();
      expect(
        (owner.data ?? []).length,
        `${table}: the owner sees no row either, so the absence above proved nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it('the RPC layer refuses another tenant’s customer, supplier and product by id', async () => {
    // A random id is a foreign record as far as this tenant is concerned. `guard_operational_request`
    // must refuse it at the parent check — the owner passes authorization, so this is the guard being
    // reached, not the permission being missing.
    const customer = await execRpcAsUser(OWNER, 'create_sale', {
      payload: {
        customerId: randomUUID(),
        employeeId: OWNER,
        paymentType: 'cash',
        paymentMethod: 'cash',
        amountPaid: 0,
        items: [],
      },
    });
    expect(customer.error, 'a sale was accepted for an unknown customer').toBeTruthy();
    expect(customer.error).toContain('customer access denied');
    expectAllowed(customer.error, 'sales.create', 'owner', 'create_sale');

    const supplier = await execRpcAsUser(OWNER, 'record_supplier_payment', {
      payload: { companyId: randomUUID(), amount: 10, method: 'cash' },
    });
    expect(supplier.error, 'a supplier payment was accepted for an unknown supplier').toBeTruthy();
    expect(supplier.error).toContain('supplier access denied');
    expectAllowed(supplier.error, 'payments.supplier', 'owner', 'record_supplier_payment');

    const product = await execRpcAsUser(OWNER, 'adjust_stock', {
      payload: {
        productId: randomUUID(),
        variantId: randomUUID(),
        adjustmentType: 'adjustment',
        qty: 1,
        reason: 'QA security matrix',
      },
    });
    expect(product.error, 'a stock adjustment was accepted for an unknown product').toBeTruthy();
    expect(product.error).toContain('product access denied');
  });
});

describe('Security matrix — the branch being worked in decides what is writable and readable', () => {
  it('a write addressed to another branch is refused for a branch-scoped member and accepted for the owner', async () => {
    if (branchWarehouse === branchMain) return; // a single-branch tenant cannot show a contrast

    const refused = await execRpcAsUser(MANAGER, 'create_customer', {
      payload: { name: `${RUN} warehouse probe`, branchId: branchWarehouse, latitude: 'not-a-number' },
    });
    expect(refused.error, 'a branch-scoped manager wrote into a branch they do not hold').toBeTruthy();
    expect(refused.error).toContain('branch access denied');

    // The owner holds every branch, so the same call is refused for a different reason (the probe's
    // latitude) — proof the refusal above was the branch scope and not the payload.
    const owner = await execRpcAsUser(OWNER, 'create_customer', {
      payload: { name: `${RUN} warehouse probe`, branchId: branchWarehouse, latitude: 'not-a-number' },
    });
    expect(owner.error, `the owner was branch-refused: ${owner.error}`).not.toContain('branch access denied');
    expect(owner.error).toContain('double precision');
  });

  it('a member who holds one branch reads that branch and not the sibling branch', async () => {
    const seen = await selectAsUser(MANAGER, 'sales', 'id,branch_id');
    expect(seen.error, `the manager could not read sales at all: ${seen.error}`).toBeNull();
    const rows = seen.data ?? [];
    // Non-vacuity lives in the sibling assertion below: `branchScopeEnforcement` plants a sale in
    // each branch and proves one is visible and the other is not. Here the guarantee asserted is the
    // invariant those rows must obey — never more than the branch being worked in.
    expect(rows.every((r: any) => r.branch_id === branchMain), 'a member read a row outside the branch being worked in').toBe(true);

    // The same read for a member with no sales.view is refused at the gate, so the read above was a
    // permission-based read and not an unfiltered one.
    const denied = await selectAsUser(ADMIN_NO_RIGHTS, 'sales', 'id');
    expect(denied.error, `expected no error or a permission error, got: ${denied.error}`).toBeNull();
    expect((denied.data ?? []).length, 'sales were readable without sales.view').toBe(0);
  });
});
