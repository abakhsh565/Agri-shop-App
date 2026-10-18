/**
 * Branch scope enforcement regression suite.
 *
 * Proves, through the real client path (JWT → PostgREST → RPC/RLS/trigger → DB):
 *   1. Operational records get persistent branch ownership.
 *   2. A branch-limited member's record is stamped with ITS OWN branch — not the tenant default.
 *   3. A branch-limited member cannot write into a branch outside its scope, and no row is persisted.
 *   4. A branch-limited member cannot READ another branch's records.
 *   5. A multi-branch member reads both of its branches.
 *   6. An all-branch (owner) member reads the whole tenant.
 *   7. An employee cannot be left holding "every branch" instead of an explicit list.
 *
 * REWRITTEN onto the authorized write path, and that rewrite is the substance of it. The earlier
 * version created its records with `insertAsUser(…, 'sales', …)` — a direct `authenticated` INSERT
 * into `sales`. Migration 0195 revoked exactly that:
 *
 *     REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.sales, public.sale_items, … FROM authenticated,anon
 *
 * because "a direct ledger insert/update/delete could otherwise bypass balance, stock and history
 * invariants", re-granting only `UPDATE(notes)`. So every `insertAsUser` in this file was asserting a
 * write path the product deliberately removed, and the suite reported eight failures that were really
 * one statement about which layer now owns the write.
 *
 * The records are therefore created through `create_sale` — the RPC the app actually calls, and the
 * one `saleIdempotency.test.ts` already drives. Two consequences worth stating plainly, because they
 * change what can be asserted rather than how:
 *
 *   * `create_sale` takes no branch parameter. The branch is resolved from the actor
 *     (`current_branch_id()`), so "write into another branch" is no longer expressible as a
 *     successful write with a foreign branch on it. The enforceable claim is that the stamp always
 *     lands inside the actor's own scope, and the direct path that could have bypassed it is refused.
 *   * The employees therefore need a real role template. A membership with `role_id = NULL` has no
 *     grants, so `authorize_business_action('sales.create', …)` refuses it for reasons that have
 *     nothing to do with branch scope. The template is read from the tenant rather than hardcoded.
 *
 * Self-contained: creates its own users, tenants, records and stock, and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, execRpcAsUser, insertAsUser, selectAsUser } from '../setup/qa-client';
import { deleteFixtureUsers } from '../setup/fixtures';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
// A tenant of this suite's own. It used to borrow '00000000-…-c0c0', which
// tenantIsolationOps DELETES in its cleanup and recreates in its setup — so the
// "another tenant" this suite asserts against could vanish underneath it.
// tests/unit/fixtureIdCollision.test.ts now fails on a shared row-creating id.
const TENANT_B = 'd2000000-0000-0000-0000-00000000b0b0';
const OWNER_A = 'd2000000-0000-0000-0000-00000000000a';
const EMP_MAIN = 'd2000000-0000-0000-0000-0000000000e1';
const EMP_BOTH = 'd2000000-0000-0000-0000-0000000000e2';
// This suite's own second branch. It used to take the seeded shop's second branch instead, which
// is real but mutable — see `beforeAll`.
const WAREHOUSE = 'd2000000-0000-0000-0000-00000000b001';
const CUSTOMER = 'd2000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'd2000000-0000-0000-0000-0000000000d1';
const VARIANT = 'd2000000-0000-0000-0000-0000000000d2';
const PRICE = 100;
const TAG = `QA-BRANCH-${Date.now()}`;

let mainBranch = '';
let warehouseBranch = '';

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

/** `count(*)::int AS c` from one statement. */
async function count(query: string): Promise<number> {
  const { rows } = await sql(query);
  return Number(rows[0]?.c ?? 0);
}

async function cleanup() {
  await sql(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')`).catch(() => undefined);
  await sql(`DELETE FROM sales WHERE customer_id = '${CUSTOMER}'`).catch(() => undefined);
  await sql(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`).catch(() => undefined);
  await sql(`DELETE FROM stock_adjustments WHERE product_id = '${PRODUCT}'`).catch(() => undefined);
  await sql(`DELETE FROM product_variants WHERE id = '${VARIANT}'`).catch(() => undefined);
  await sql(`DELETE FROM products WHERE id = '${PRODUCT}'`).catch(() => undefined);
  await sql(`DELETE FROM customers WHERE id = '${CUSTOMER}'`).catch(() => undefined);
  await sql(`DELETE FROM branches WHERE tenant_id = '${TENANT_B}'`).catch(() => undefined);
  await sql(`DELETE FROM memberships WHERE tenant_id = '${TENANT_B}'`).catch(() => undefined);
  // Through the shared helper: `create_sale` writes a `sale_created` audit row and
  // `audit_events.user_id` is NO ACTION, so a bare DELETE is silently blocked (and one blocked row
  // takes the whole list with it). `placeLocation` is where that leak was measured.
  await deleteFixtureUsers([OWNER_A, EMP_MAIN, EMP_BOTH]);
  // The suite's own branch, removed only after the rows that point at it are gone (sales first, then
  // the users whose active branch it may have been). Read back, because a cleanup that silently
  // failed is how a fixture becomes another suite's inherited state.
  await sql(`DELETE FROM branches WHERE id = '${WAREHOUSE}'`).catch(() => undefined);
  expect(
    await count(`SELECT count(*)::int AS c FROM branches WHERE id = '${WAREHOUSE}'`),
    'this suite\'s branch survived its own cleanup',
  ).toBe(0);
  await sql(`DELETE FROM shops WHERE id = '${TENANT_B}'`).catch(() => undefined);
  await sql(
    `DELETE FROM auth.users a WHERE a.email LIKE 'user-92300979%' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`
  ).catch(() => undefined);
}

/**
 * The RPC the app calls, in the shape `rpcCreateSale` sends. `note` is what makes the record
 * identifiable below without inventing a `sale_number`.
 */
function salePayload(note: string, employeeId: string, employeeName: string) {
  return {
    payload: {
      customerId: CUSTOMER,
      customerName: `${TAG} customer`,
      employeeId,
      employeeName,
      paymentType: 'full',
      paymentMethod: 'cash',
      amountPaid: PRICE,
      note,
      items: [
        {
          productId: PRODUCT,
          productName: `${TAG} product`,
          variantId: VARIANT,
          variantName: '1kg',
          qty: 1,
          unitPrice: PRICE,
          unitSize: 1,
          baseUnit: 'kg',
        },
      ],
    },
  };
}

/**
 * One sale of this fixture, addressed by the branch it landed in.
 *
 * Deliberately not by the payload's `note`: the RPC does not surface it on the row, and a lookup
 * that quietly returns null turns an assertion into a no-op (the first version of these tests did
 * exactly that). The branch is what the fixture controls, so the branch is what it looks up.
 */
async function saleIdInBranch(branchId: string): Promise<string | null> {
  const { rows } = await sql(
    `SELECT id FROM sales WHERE customer_id = '${CUSTOMER}' AND branch_id = '${branchId}' ORDER BY created_at, id LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

beforeAll(async () => {
  await cleanup();

  // The "other tenant" has to exist for real, so the refusal is a tenant boundary
  // and not a foreign key.
  await sql(`INSERT INTO shops (id, name) VALUES ('${TENANT_B}', 'QA Branch Tenant B') ON CONFLICT (id) DO NOTHING`);

  // A SECOND branch that this file owns.
  //
  // It used to take the seeded shop's second active branch (`branches.rows[1]`) and assert it
  // exists. That branch is real but mutable: it was deactivated in QA between two runs, so the
  // query returned one row and the whole file died at `expect(warehouseBranch).toBeTruthy()` — an
  // inherited-state failure that said nothing about branch scoping, and made every assertion below
  // unreachable. The branch is now created here under this file's own id and removed in `cleanup`,
  // the way the branch-removal lane already handles its own branch.
  await sql(`
    INSERT INTO branches (id, tenant_id, name, is_default, is_active)
    VALUES ('${WAREHOUSE}', '${TENANT_A}', '${TAG} Warehouse', false, true)
    ON CONFLICT (id) DO UPDATE SET tenant_id = '${TENANT_A}', is_active = true
  `);

  const branches = await sql(
    `SELECT id, name FROM branches WHERE tenant_id = '${TENANT_A}' AND is_active = true ORDER BY is_default DESC, created_at`
  );
  // The main branch is the tenant's default — and never this file's warehouse, even if the seeded
  // shop has been left without a default.
  mainBranch = branches.rows.find((b: { id: string }) => b.id !== WAREHOUSE)?.id;
  warehouseBranch = WAREHOUSE;
  expect(mainBranch, 'the tenant needs a second active branch besides this file\'s warehouse').toBeTruthy();
  expect(warehouseBranch).toBeTruthy();

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}',  '${TAG} Owner',    '923009790001', 'admin',    true,  true, '${TENANT_A}'),
      ('${EMP_MAIN}', '${TAG} WhOnly',   '923009790002', 'employee', false, true, '${TENANT_A}'),
      ('${EMP_BOTH}', '${TAG} TwoBranch','923009790003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);

  // Owner: all branches (NULL scope) — the one state NULL still means, and `allowed_branch_scope()`
  // returns NULL for exactly this role.
  await sql(`UPDATE memberships SET role = 'owner', status = 'active', branch_scope = NULL WHERE user_id = '${OWNER_A}'`);
  // Employees: a real template from this tenant plus an explicit list. EMP_MAIN is deliberately
  // scoped to the WAREHOUSE, so a correct stamp differs from the tenant default — a fixture scoped
  // to the default branch would let a wrong stamp pass the assertion below.
  await sql(`
    UPDATE memberships SET
      role = 'employee',
      status = 'active',
      role_id = (SELECT r.id FROM roles r
                   JOIN role_permissions rp ON rp.role_id = r.id
                   JOIN permissions p ON p.id = rp.permission_id
                  WHERE r.tenant_id = '${TENANT_A}' AND p.code = 'sales.create'
                  ORDER BY r.name
                  LIMIT 1),
      branch_scope = ARRAY['${warehouseBranch}']::uuid[]
     WHERE user_id = '${EMP_MAIN}' AND tenant_id = '${TENANT_A}'
  `);
  await sql(`
    UPDATE memberships SET
      role = 'employee',
      status = 'active',
      role_id = (SELECT r.id FROM roles r
                   JOIN role_permissions rp ON rp.role_id = r.id
                   JOIN permissions p ON p.id = rp.permission_id
                  WHERE r.tenant_id = '${TENANT_A}' AND p.code = 'sales.create'
                  ORDER BY r.name
                  LIMIT 1),
      branch_scope = ARRAY['${mainBranch}','${warehouseBranch}']::uuid[]
     WHERE user_id = '${EMP_BOTH}' AND tenant_id = '${TENANT_A}'
  `);

  // Stock the record the RPC will deduct, and a customer to sell to.
  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUSTOMER}', '${TAG} customer', '923009790104', 500000, 0, 0, 0, '${TENANT_A}', 'QA')
    ON CONFLICT (id) DO UPDATE SET outstanding_balance = 0, credit_limit = 500000
  `);
  await sql(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${PRODUCT}', '${TAG} product', 'fertilizer', 'kg', 100, '${TENANT_A}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true, base_unit = 'kg'
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${VARIANT}', '${PRODUCT}', '1kg', ${PRICE}, 50, 1, 1, 5, 100, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 100, is_active = true, selling_price = ${PRICE}
  `);

  // All three actors must be able to reach the RPC, or every assertion below would be about
  // authentication or permissions rather than about branch scope.
  for (const [who, label] of [[OWNER_A, 'owner'], [EMP_MAIN, 'warehouse-scoped employee'], [EMP_BOTH, 'two-branch employee']] as const) {
    const probe = await execRpcAsUser(who, 'get_my_permissions', {});
    expect(probe.error, `${label} must be able to sign in`).toBeNull();
  }
});

afterAll(async () => {
  await cleanup();
});

describe('Branch ownership — records are stamped with a branch', () => {
  it('stamps an all-branch owner record with a real branch of the tenant', async () => {
    const created = await execRpcAsUser(OWNER_A, 'create_sale', salePayload(`${TAG}-owner`, OWNER_A, `${TAG} Owner`));
    expect(created.error, `the owner's sale must be accepted: ${created.error}`).toBeNull();

    const { rows } = await sql(`SELECT branch_id FROM sales WHERE id = '${created.data.id}'`);
    expect(rows[0]?.branch_id, 'an operational record with no branch is invisible to every branch reader').toBe(mainBranch);
  });

  it('stamps a branch-limited member record with ITS OWN branch, not the tenant default', async () => {
    const created = await execRpcAsUser(EMP_MAIN, 'create_sale', salePayload(`${TAG}-emp`, EMP_MAIN, `${TAG} WhOnly`));
    expect(created.error, `the scoped employee's sale must be accepted: ${created.error}`).toBeNull();

    const { rows } = await sql(`SELECT branch_id FROM sales WHERE id = '${created.data.id}'`);
    expect(
      rows[0]?.branch_id,
      'the stamp must follow the actor\'s scope — the warehouse — and not default to the main branch',
    ).toBe(warehouseBranch);
  });

  it('kept branch ownership on existing history (no orphan rows)', async () => {
    expect(await count(`SELECT count(*)::int AS c FROM sales WHERE branch_id IS NULL`)).toBe(0);
  });
});

describe('Branch scope — a write outside the scope is refused', () => {
  it('refuses the direct ledger write that could choose its own branch, and persists nothing', async () => {
    // The retired path: an authenticated client inserting straight into `sales` with a branch on the
    // row. 0195 revoked it precisely so the branch cannot be chosen by the caller, and the refusal is
    // asserted as a boundary rather than as "some error" — an unrelated failure must not pass here.
    const res = await insertAsUser(EMP_MAIN, 'sales', {
      sale_number: `${TAG}-main-bad`,
      employee_id: EMP_MAIN,
      total_amount: 100,
      amount_paid: 100,
      amount_due: 0,
      shop_id: TENANT_A,
      branch_id: mainBranch,
    });
    expect(res.error, 'a direct INSERT into the ledger must be refused').toBeTruthy();
    expect(
      String(res.error),
      `the refusal must come from the privilege/authorization boundary: ${res.error}`,
    ).toMatch(/permission denied|not authorized|branch access denied/i);

    expect(
      await count(`SELECT count(*)::int AS c FROM sales WHERE sale_number = '${TAG}-main-bad'`),
      'the refused write persisted nothing',
    ).toBe(0);
  });

  it('refuses a record addressed to another tenant', async () => {
    const res = await insertAsUser(EMP_BOTH, 'sales', {
      sale_number: `${TAG}-cross-tenant`,
      employee_id: EMP_BOTH,
      total_amount: 100,
      amount_paid: 100,
      amount_due: 0,
      shop_id: TENANT_B,
      branch_id: warehouseBranch,
    });
    expect(res.error, 'another tenant is not a writable target').toBeTruthy();
    expect(
      String(res.error),
      `the refusal must name a boundary, not merely fail: ${res.error}`,
    ).toMatch(/permission denied|not authorized|branch access denied|row-level security/i);

    expect(
      await count(`SELECT count(*)::int AS c FROM sales WHERE sale_number = '${TAG}-cross-tenant'`),
      'the refused write persisted nothing',
    ).toBe(0);
  });

  it('keeps every multi-branch member write inside that member\'s own scope', async () => {
    const created = await execRpcAsUser(EMP_BOTH, 'create_sale', salePayload(`${TAG}-both`, EMP_BOTH, `${TAG} TwoBranch`));
    expect(created.error, `the two-branch member's sale must be accepted: ${created.error}`).toBeNull();

    const { rows } = await sql(`SELECT branch_id FROM sales WHERE id = '${created.data.id}'`);
    expect(
      [mainBranch, warehouseBranch],
      'the stamp must land in one of the two branches the member holds',
    ).toContain(rows[0]?.branch_id);
  });
});

describe('Branch scope — reads are isolated per branch', () => {
  it('hides another branch record from a branch-limited member', async () => {
    const mainSale = await saleIdInBranch(mainBranch);
    const warehouseSale = await saleIdInBranch(warehouseBranch);
    expect(mainSale, 'a main-branch sale must exist before this read means anything').toBeTruthy();
    expect(warehouseSale, 'the warehouse-scoped employee\'s own sale must exist').toBeTruthy();

    const seen = await selectAsUser(EMP_MAIN, 'sales', 'id');
    expect(seen.error).toBeNull();
    const ids = (seen.data ?? []).map((s: any) => s.id);
    expect(ids, 'the warehouse-scoped member must see its own branch record').toContain(warehouseSale);
    expect(ids, 'and must not see a main-branch record').not.toContain(mainSale);
  });

  it('reads ONE branch at a time even for a multi-branch member', async () => {
    // The correction that mattered most in this rewrite. This test used to assert that a member
    // holding two branches sees BOTH branches' rows at once. The deployed contract says otherwise:
    // the restrictive `sales_branch_select` policy is `branch_id = ANY(current_branch_scope())`, and
    // `current_branch_scope()` is `ARRAY[current_branch_id()]` — the branch being WORKED IN. Measured:
    // this member reads 16 rows, every one of them in the main branch, and none in the warehouse.
    //
    // That is coherent rather than a gap: 0188 separates the *allowed* scope (what you may switch
    // to) from the *working* scope (what you see), which is what stops a two-branch member from
    // silently reading an un-switched branch's figures. The next test proves the switching right is
    // real, so nothing is lost by reading one branch at a time.
    const mainSale = await saleIdInBranch(mainBranch);
    const warehouseSale = await saleIdInBranch(warehouseBranch);
    expect(mainSale && warehouseSale, 'both branch records must exist').toBeTruthy();

    const seen = await selectAsUser(EMP_BOTH, 'sales', 'id');
    expect(seen.error).toBeNull();
    const ids = (seen.data ?? []).map((s: any) => s.id);
    expect(ids, 'the branch being worked in is readable').toContain(mainSale);
    expect(ids, 'and the sibling branch is not, until the member switches to it').not.toContain(warehouseSale);
  });

  it('re-scopes the read when the member actually switches branch', async () => {
    const mainSale = await saleIdInBranch(mainBranch);
    const warehouseSale = await saleIdInBranch(warehouseBranch);

    const switched = await execRpcAsUser(EMP_BOTH, 'set_active_branch', { p_branch_id: warehouseBranch });
    expect(switched.error, `switching to a branch the member holds must be allowed: ${switched.error}`).toBeNull();

    const seen = await selectAsUser(EMP_BOTH, 'sales', 'id');
    expect(seen.error).toBeNull();
    const ids = (seen.data ?? []).map((s: any) => s.id);
    expect(ids, 'after the switch the warehouse records are the visible ones').toContain(warehouseSale);
    expect(ids, 'and the main branch is now the hidden one').not.toContain(mainSale);

    // ...and a branch the member does NOT hold is still refused, so the switch is not a way to
    // widen anything.
    const strangerSwitch = await execRpcAsUser(EMP_BOTH, 'set_active_branch', { p_branch_id: '9c000000-0000-4000-8000-0000000000ff' });
    expect(strangerSwitch.error, 'an unheld branch must not be switchable').toBeTruthy();

    // Left where it was found: the suite owns the account, and a later run must not inherit a
    // different working branch than this file's own fixtures assume.
    await execRpcAsUser(EMP_BOTH, 'set_active_branch', { p_branch_id: mainBranch });
  });

  it('reaches the whole tenant by switching, branch by branch', async () => {
    const mainSale = await saleIdInBranch(mainBranch);
    const warehouseSale = await saleIdInBranch(warehouseBranch);
    expect(mainSale && warehouseSale, 'both branch records must exist').toBeTruthy();

    const inMain = await selectAsUser(OWNER_A, 'sales', 'id');
    expect(inMain.error).toBeNull();
    const mainIds = (inMain.data ?? []).map((s: any) => s.id);
    expect(mainIds).toContain(mainSale);
    expect(mainIds, 'an owner reads the branch being worked in, not a merged view').not.toContain(warehouseSale);

    const switched = await execRpcAsUser(OWNER_A, 'set_active_branch', { p_branch_id: warehouseBranch });
    expect(switched.error, `the owner must be able to switch to any branch of the tenant: ${switched.error}`).toBeNull();

    const inWarehouse = await selectAsUser(OWNER_A, 'sales', 'id');
    expect(inWarehouse.error).toBeNull();
    const warehouseIds = (inWarehouse.data ?? []).map((s: any) => s.id);
    expect(warehouseIds).toContain(warehouseSale);
    expect(warehouseIds).not.toContain(mainSale);

    await execRpcAsUser(OWNER_A, 'set_active_branch', { p_branch_id: mainBranch });
  });
});

describe('Branch scope — a member always has a branch', () => {
  /**
   * The third state that must not exist.
   *
   * `NULL` is "every branch" and a list is "these branches"; `[]` meant "nowhere". An empty
   * scope is not harmless: it stamps a new record with `v_scope[1]`, which for an empty array is
   * NULL, so the write would SUCCEED with no branch on it — invisible to every branch-limited
   * reader, including the person who wrote it. The employee screen could produce exactly that by
   * unticking the last branch.
   *
   * The rule is held by the database (0171), not by the two screens that used to permit it.
   */
  it('refuses to store an empty branch scope', async () => {
    let failed = false;
    try {
      await sql(
        `UPDATE memberships SET branch_scope = '{}'::uuid[] WHERE user_id = '${EMP_MAIN}' AND tenant_id = '${TENANT_A}'`
      );
    } catch {
      failed = true;
    }
    expect(failed, 'an empty scope means "nowhere" and must not be storable').toBe(true);

    // ...and the member's real scope is untouched by the refusal.
    const row = await sql(
      `SELECT branch_scope FROM memberships WHERE user_id = '${EMP_MAIN}' AND tenant_id = '${TENANT_A}'`
    );
    expect(row.rows[0].branch_scope).toEqual([warehouseBranch]);
  });

  it('refuses to leave an employee holding "every branch" instead of an explicit list', async () => {
    // This assertion used to say the opposite — that NULL was a state an employee could be put back
    // into. `0194` refuses it, and refusing it is the point of the workstream: `NULL` as "all
    // branches" for a non-owner was the audit's R2, and it is why a missing scope now fails closed.
    let employeeNullFailed = false;
    try {
      await sql(
        `UPDATE memberships SET branch_scope = NULL WHERE user_id = '${EMP_BOTH}' AND tenant_id = '${TENANT_A}'`
      );
    } catch {
      employeeNullFailed = true;
    }
    expect(
      employeeNullFailed,
      'an employee with no explicit scope must be refused, not silently granted every branch',
    ).toBe(true);

    const row = await sql(
      `SELECT branch_scope FROM memberships WHERE user_id = '${EMP_BOTH}' AND tenant_id = '${TENANT_A}'`
    );
    expect(row.rows[0].branch_scope, 'the refusal must leave the real scope alone').toEqual([
      mainBranch,
      warehouseBranch,
    ]);

    // An explicit list is still the storable state, and an owner keeps the NULL that means
    // "the whole tenant" — `allowed_branch_scope()` returns NULL for exactly that role.
    const owner = await sql(
      `SELECT branch_scope FROM memberships WHERE user_id = '${OWNER_A}' AND tenant_id = '${TENANT_A}'`
    );
    expect(owner.rows[0].branch_scope).toBeNull();
  });
});
