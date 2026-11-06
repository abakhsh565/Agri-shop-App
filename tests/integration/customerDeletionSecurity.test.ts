/**
 * customerDeletionSecurity — can anyone but an authorized owner delete a customer?
 *
 * The task: "no one can delete app customer data — only those authorized". This suite answers it
 * with real JWTs, real PostgREST, direct SQL, and the database rows read before and after every
 * attempt. It creates its OWN two tenants and removes them, so QA's real shops are never touched.
 *
 * The enforcement chain it exercises (read from the live QA database, not from a migration file):
 *
 *   archive_customer()  SECURITY DEFINER, search_path pinned
 *     └─ authorize_business_action('customers.delete', <the CUSTOMER's shop_id>)
 *          ├─ app_current_user_id()            = request.jwt.claims->>'sub'   → NOT_AUTHENTICATED
 *          ├─ membership_in_active_shop(NULL)  → 'tenant access denied' when the tenant differs
 *          ├─ has_effective_permission(...)    → 'missing permission customers.delete'
 *          └─ the branch must be active and inside the member's branch_scope
 *   RLS on public.customers: SELECT / INSERT / UPDATE policies scoped by shop_id = current_shop_id()
 *     and by customers.view / customers.create / customers.edit — and **no DELETE policy at all**,
 *     so a table-level DELETE reaches zero rows even though `authenticated` holds the grant.
 */
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import {
  execRpcAsUser,
  execSqlAsAdmin,
  deleteAsUser,
  updateAsUser,
  qaAnonClient,
} from '../setup/qa-client';

// A namespace no other suite uses (tests/unit/fixtureIdCollision.test.ts fails otherwise, on purpose).
const TENANT_A = 'dad10001-0000-4000-8000-000000000001';
const TENANT_B = 'dad10002-0000-4000-8000-000000000002';
const OWNER_A = 'dad10003-0000-4000-8000-000000000003';
const OWNER_B = 'dad10004-0000-4000-8000-000000000004';
const EMP_EDIT = 'dad10005-0000-4000-8000-000000000005'; // customers.view + customers.edit, NO delete
const EMP_DELETE = 'dad10006-0000-4000-8000-000000000006'; // customers.view + customers.delete
const CUSTOMER_A = 'dad10007-0000-4000-8000-000000000007';
const CUSTOMER_B = 'dad10008-0000-4000-8000-000000000008';
const PRODUCT_A = 'dad10009-0000-4000-8000-000000000009';
const VARIANT_A = 'dad1000a-0000-4000-8000-00000000000a';
const SALE_A = 'dad1000b-0000-4000-8000-00000000000b';
const PAYMENT_A = 'dad1000c-0000-4000-8000-00000000000c';
const PHONES = ['923007790001', '923007790002', '923007790003', '923007790004'];
const ROLE_EDIT = 'QA DelRole EditOnly';
const ROLE_DELETE = 'QA DelRole WithDelete';
const ROW_PREFIX = 'QA DeletionSecurity';

const sql = (q: string) => execSqlAsAdmin(q);

/** The customer's full row, as the database actually holds it. */
async function customerRow(id: string) {
  const { rows } = await sql(
    `SELECT id, name, is_archived, archived_at, archived_by, shop_id,
            outstanding_balance, total_purchases, total_paid
       FROM customers WHERE id = '${id}'`,
  );
  return rows[0];
}
async function auditRowsAbout(id: string) {
  const { rows } = await sql(
    `SELECT action, entity_type, user_id FROM audit_events
      WHERE entity_id::text = '${id}' OR (details->>'customer_id') = '${id}' ORDER BY created_at`,
  );
  return rows;
}
/** Every test starts from the same state, and no test may leave an archived row behind. */
async function resetCustomer() {
  await sql(`UPDATE customers SET is_archived = false, archived_at = NULL, archived_by = NULL WHERE id IN ('${CUSTOMER_A}','${CUSTOMER_B}')`);
}

async function historyRows() {
  const sales = await sql(`SELECT id, customer_id, total_amount, is_voided FROM sales WHERE id = '${SALE_A}'`);
  const pays = await sql(`SELECT id, customer_id, amount FROM customer_payments WHERE id = '${PAYMENT_A}'`);
  return { sale: sales.rows[0], payment: pays.rows[0] };
}

/**
 * Cleanup that REPORTS instead of swallowing.
 *
 * This suite shares the QA database with the other integration files, and it reuses fixed identity
 * ids on purpose (the fixture-id collision guard requires a per-suite namespace). When a previous
 * file has left rows attached to these identities, a silent `.catch()` here would leave them in
 * place — and the suite would then fail deep inside a test with `NOT_AUTHORIZED: tenant access
 * denied`, which reads like a security finding and is really leftover state. So the failures are
 * collected and the identity check below refuses to run on a contaminated namespace.
 */
const cleanupFailures: string[] = [];
const trySql = async (label: string, q: string) => {
  try {
    await sql(q);
  } catch (error) {
    cleanupFailures.push(`${label}: ${(error as Error).message}`);
  }
};

async function cleanup() {
  cleanupFailures.length = 0;
  const byUser = `user_id IN (SELECT id FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}') OR phone IN (${PHONES.map((p) => `'${p}'`).join(',')}))`;
  await trySql('audit_events', `DELETE FROM audit_events WHERE ${byUser} OR entity_id::text IN ('${CUSTOMER_A}','${CUSTOMER_B}','${SALE_A}','${PAYMENT_A}')`);
  await trySql('inventory_movements', `DELETE FROM inventory_movements WHERE variant_id = '${VARIANT_A}' OR created_by IN (SELECT id FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}'))`);
  await trySql('stock_adjustments', `DELETE FROM stock_adjustments WHERE variant_id = '${VARIANT_A}'`);
  await trySql('customer_payments', `DELETE FROM customer_payments WHERE id = '${PAYMENT_A}' OR customer_id IN ('${CUSTOMER_A}','${CUSTOMER_B}')`);
  await trySql('sale_items', `DELETE FROM sale_items WHERE sale_id = '${SALE_A}'`);
  await trySql('voids', `DELETE FROM voids WHERE sale_id = '${SALE_A}'`);
  await trySql('sales', `DELETE FROM sales WHERE id = '${SALE_A}' OR customer_id IN ('${CUSTOMER_A}','${CUSTOMER_B}')`);
  await trySql('product_variants', `DELETE FROM product_variants WHERE id = '${VARIANT_A}' OR product_id = '${PRODUCT_A}'`);
  await trySql('products', `DELETE FROM products WHERE id = '${PRODUCT_A}'`);
  await trySql('customers', `DELETE FROM customers WHERE id IN ('${CUSTOMER_A}','${CUSTOMER_B}') OR name LIKE '${ROW_PREFIX}%'`);
  await trySql('user_active_shops', `DELETE FROM user_active_shops WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')`);
  await trySql('user_permissions', `DELETE FROM user_permissions WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')`);
  await trySql('memberships', `DELETE FROM memberships WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}') OR user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')`);
  await trySql('role_permissions', `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name IN ('${ROLE_EDIT}','${ROLE_DELETE}'))`);
  await trySql('roles', `DELETE FROM roles WHERE name IN ('${ROLE_EDIT}','${ROLE_DELETE}')`);
  await trySql('branches', `DELETE FROM branches WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}')`);
  await trySql('users', `DELETE FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}') OR phone IN (${PHONES.map((p) => `'${p}'`).join(',')})`);
  await trySql('auth.identities', `DELETE FROM auth.identities WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')`);
  await trySql('auth.users', `DELETE FROM auth.users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')`);
  await trySql('shops', `DELETE FROM shops WHERE id IN ('${TENANT_A}','${TENANT_B}')`);
}

let branchA = '';
let branchB = '';

beforeAll(async () => {
  await cleanup();

  // ── the namespace must be clean before anything is asserted about authorization ──────────
  // A single leftover membership or active-shop row changes which tenant `current_tenant_id()`
  // resolves to. Every cross-tenant assertion below would then report `tenant access denied` for
  // a reason that has nothing to do with the rule under test, so refuse to start instead.
  const stale = await sql(
    `SELECT (SELECT count(*) FROM memberships WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')) AS memberships,
            (SELECT count(*) FROM user_active_shops WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}')) AS active_shops,
            (SELECT count(*) FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_EDIT}','${EMP_DELETE}') OR phone IN (${PHONES.map((p) => `'${p}'`).join(',')})) AS users,
            (SELECT count(*) FROM shops WHERE id IN ('${TENANT_A}','${TENANT_B}')) AS shops`,
  );
  const staleCounts = stale.rows[0] as Record<string, string>;
  // `users` is counted as well: when a foreign key blocks the user delete, the membership rows are
  // already gone and the shop is already gone, so a check that only looked at those would pass while
  // a user row still points at a tenant this run does not own.
  if (cleanupFailures.length || ['memberships', 'active_shops', 'users', 'shops'].some((k) => Number(staleCounts[k]))) {
    throw new Error(
      `the ${ROW_PREFIX} namespace is not clean, so this suite cannot make a statement about ` +
        `authorization. Leftover rows: ${JSON.stringify(staleCounts)}. Cleanup failures: ` +
        `${cleanupFailures.join(' | ') || 'none'}. A previous integration file is probably still ` +
        `attached to these identities — fix the leak in that file rather than reusing this one's ` +
        `identities.`,
    );
  }

  // ── two isolated tenants, each with one active branch ────────────────────────────────────
  await sql(`
    INSERT INTO shops (id, name) VALUES
      ('${TENANT_A}', '${ROW_PREFIX} Tenant A'), ('${TENANT_B}', '${ROW_PREFIX} Tenant B')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
  `);
  await sql(`
    INSERT INTO branches (tenant_id, name, is_default, is_active, location_label, location_source)
    VALUES
      ('${TENANT_A}', '${ROW_PREFIX} A Main', true, true, 'QA', 'manual'),
      ('${TENANT_B}', '${ROW_PREFIX} B Main', true, true, 'QA', 'manual')
  `);
  const br = await sql(`SELECT id, tenant_id FROM branches WHERE tenant_id IN ('${TENANT_A}','${TENANT_B}')`);
  branchA = br.rows.find((r: any) => r.tenant_id === TENANT_A)?.id;
  branchB = br.rows.find((r: any) => r.tenant_id === TENANT_B)?.id;

  // ── owners and employees ────────────────────────────────────────────────────────────────
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES
      ('${OWNER_A}', '${ROW_PREFIX} Owner A', '${PHONES[0]}', 'admin', true, true, '${TENANT_A}'),
      ('${OWNER_B}', '${ROW_PREFIX} Owner B', '${PHONES[1]}', 'admin', true, true, '${TENANT_B}'),
      ('${EMP_EDIT}', '${ROW_PREFIX} Employee EditOnly', '${PHONES[2]}', 'employee', false, true, '${TENANT_A}'),
      ('${EMP_DELETE}', '${ROW_PREFIX} Employee WithDelete', '${PHONES[3]}', 'employee', false, true, '${TENANT_A}')
  `);

  // ── two roles: one without customers.delete, one with it ─────────────────────────────────
  await sql(`
    INSERT INTO roles (tenant_id, name, is_system) VALUES
      ('${TENANT_A}', '${ROLE_EDIT}', false), ('${TENANT_A}', '${ROLE_DELETE}', false)
  `);
  await sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('customers.view','customers.edit')
     WHERE r.name = '${ROLE_EDIT}'
    ON CONFLICT DO NOTHING
  `);
  await sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('customers.view','customers.delete')
     WHERE r.name = '${ROLE_DELETE}'
    ON CONFLICT DO NOTHING
  `);

  // ── memberships, with the branch in scope so a denial can only be about the permission ───
  await sql(`
    UPDATE memberships SET branch_scope = ARRAY['${branchA}']::uuid[]
     WHERE tenant_id = '${TENANT_A}' AND user_id IN ('${EMP_EDIT}','${EMP_DELETE}')
  `);
  await sql(`
    UPDATE memberships m SET role_id = r.id, role = 'employee', status = 'active'
      FROM roles r
     WHERE r.name = '${ROLE_EDIT}' AND m.user_id = '${EMP_EDIT}' AND m.tenant_id = '${TENANT_A}'
  `);
  await sql(`
    UPDATE memberships m SET role_id = r.id, role = 'employee', status = 'active'
      FROM roles r
     WHERE r.name = '${ROLE_DELETE}' AND m.user_id = '${EMP_DELETE}' AND m.tenant_id = '${TENANT_A}'
  `);

  // ── the app's own way of recording which shop is active for a user ───────────────────────
  await sql(`
    INSERT INTO user_active_shops (user_id, shop_id, branch_id) VALUES
      ('${OWNER_A}', '${TENANT_A}', '${branchA}'), ('${OWNER_B}', '${TENANT_B}', '${branchB}'),
      ('${EMP_EDIT}', '${TENANT_A}', '${branchA}'), ('${EMP_DELETE}', '${TENANT_A}', '${branchA}')
    ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, branch_id = EXCLUDED.branch_id
  `);

  // ── one customer per tenant, and real history behind tenant A's customer ─────────────────
  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${CUSTOMER_A}', '${ROW_PREFIX} Customer A', '923009792001', 50000, 12000, 30000, 18000, '${TENANT_A}', '${OWNER_A}'),
      ('${CUSTOMER_B}', '${ROW_PREFIX} Customer B', '923009792002', 20000, 0, 0, 0, '${TENANT_B}', '${OWNER_B}')
    ON CONFLICT (id) DO UPDATE SET is_archived = false, archived_at = NULL, archived_by = NULL
  `);
  await sql(`
    INSERT INTO products (id, name, category, base_unit, shop_id, stock_qty)
    VALUES ('${PRODUCT_A}', '${ROW_PREFIX} Product', 'spray', 'liter', '${TENANT_A}', 10)
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty)
    VALUES ('${VARIANT_A}', '${PRODUCT_A}', '1L', 100, 80, 1, 1, 1, 10) ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO sales (id, sale_number, customer_id, customer_name_snapshot, employee_id, employee_name,
                       total_amount, discount, amount_paid, amount_due, payment_type, payment_method, status, shop_id, branch_id)
    VALUES ('${SALE_A}', 'QA-DEL-0001', '${CUSTOMER_A}', '${ROW_PREFIX} Customer A', '${OWNER_A}', '${ROW_PREFIX} Owner A',
            30000, 0, 18000, 12000, 'credit', 'cash', 'completed', '${TENANT_A}', '${branchA}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO customer_payments (id, customer_id, amount, method, notes, recorded_by, recorded_by_name, branch_id)
    VALUES ('${PAYMENT_A}', '${CUSTOMER_A}', 18000, 'cash', 'QA deletion security history', '${OWNER_A}', '${ROW_PREFIX} Owner A', '${branchA}')
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanup();
});

describe('customer deletion security — the enforcement layer, then every bypass attempt', () => {
  it('names the layer that actually decides (not the UI)', async () => {
    const fn = await sql(`SELECT prosecdef, pg_get_functiondef(p.oid) def FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='archive_customer'`);
    expect(fn.rows[0].prosecdef, 'archive_customer must be SECURITY DEFINER').toBe(true);
    expect(fn.rows[0].def).toContain("authorize_business_action('customers.delete'");

    const policies = await sql(`SELECT cmd, policyname FROM pg_policies WHERE schemaname='public' AND tablename='customers'`);
    expect(policies.rows.length, 'customers has no RLS policies at all').toBeGreaterThan(0);
    expect(
      policies.rows.filter((p: any) => p.cmd === 'DELETE'),
      'a DELETE policy on customers would let a client delete rows directly',
    ).toEqual([]);
    const rls = await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.customers'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
  });

  it('lets the owner archive their own customer, and records who did it', async () => {
    const before = await customerRow(CUSTOMER_A);
    expect(before.is_archived).toBe(false);

    const { error } = await execRpcAsUser(OWNER_A, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(error).toBeNull();

    const after = await customerRow(CUSTOMER_A);
    expect(after.is_archived).toBe(true);
    expect(after.archived_by).toBe(OWNER_A);
    expect(after.archived_at).not.toBeNull();
  });

  it('keeps the row and its history: a sale and a payment survive the archive', async () => {
    const h = await historyRows();
    expect(h.sale, 'the sale was destroyed by archiving its customer').toBeTruthy();
    expect(h.sale.customer_id).toBe(CUSTOMER_A);
    expect(h.payment, 'the payment was destroyed by archiving its customer').toBeTruthy();
    expect(h.payment.customer_id).toBe(CUSTOMER_A);
    // and the customer row itself is still there — archived, not deleted
    expect(await customerRow(CUSTOMER_A)).toBeTruthy();
  });

  it('refuses an employee who has customers.edit but not customers.delete', async () => {
    await resetCustomer();

    const { error } = await execRpcAsUser(EMP_EDIT, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(error, 'an employee without customers.delete archived a customer').toBeTruthy();
    expect(error).toMatch(/NOT_AUTHORIZED|permission/i);
    expect((await customerRow(CUSTOMER_A)).is_archived).toBe(false);
  });

  it('allows an employee who actually holds customers.delete (the gate is the permission)', async () => {
    const { error } = await execRpcAsUser(EMP_DELETE, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(error).toBeNull();
    const after = await customerRow(CUSTOMER_A);
    expect(after.is_archived).toBe(true);
    expect(after.archived_by).toBe(EMP_DELETE);
    await resetCustomer();
  });

  it('refuses another tenant’s owner, from both directions, and changes nothing', async () => {
    const crossA = await execRpcAsUser(OWNER_B, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(crossA.error, 'tenant B archived tenant A\'s customer').toBeTruthy();
    expect(crossA.error).toMatch(/tenant access denied|NOT_AUTHORIZED/i);
    expect((await customerRow(CUSTOMER_A)).is_archived).toBe(false);

    const crossB = await execRpcAsUser(OWNER_A, 'archive_customer', { p_customer_id: CUSTOMER_B });
    expect(crossB.error, 'tenant A archived tenant B\'s customer').toBeTruthy();
    expect((await customerRow(CUSTOMER_B)).is_archived).toBe(false);
  });

  it('refuses the anonymous client outright', async () => {
    const { error } = await qaAnonClient.rpc('archive_customer', { p_customer_id: CUSTOMER_A });
    expect(error).toBeTruthy();
    expect((await customerRow(CUSTOMER_A)).is_archived).toBe(false);
  });

  it('deletes nothing through a direct PostgREST DELETE (no DELETE policy exists)', async () => {
    // RLS refuses by matching zero rows (not by erroring), so the read-back is the evidence.
    await deleteAsUser(OWNER_A, 'customers', 'id', CUSTOMER_A);
    expect(await customerRow(CUSTOMER_A), 'a direct DELETE removed the customer').toBeTruthy();
  });

  it('does not let a direct UPDATE bypass the delete permission across tenants', async () => {
    const res = await updateAsUser(OWNER_B, 'customers', { is_archived: true }, { id: CUSTOMER_A });
    expect(res.data ?? [], 'tenant B wrote tenant A\'s customer row directly').toEqual([]);
    expect((await customerRow(CUSTOMER_A)).is_archived).toBe(false);
  });

  it('refuses an employee with customers.edit writing is_archived=true directly (permission bypass)', async () => {
    // The bypass that needs no RPC at all: the UPDATE policy allows customers.edit, so if the
    // column is writable then the separate customers.delete permission means nothing.
    await resetCustomer();
    const res = await updateAsUser(EMP_EDIT, 'customers', { is_archived: true }, { id: CUSTOMER_A });
    const after = await customerRow(CUSTOMER_A);
    await resetCustomer();

    if (res.error === null && after.is_archived === true) {
      throw new Error(
        'AUTHORIZATION BYPASS: an employee holding only customers.edit archived ' +
          `customer ${CUSTOMER_A} by writing is_archived directly, without customers.delete.`,
      );
    }
    expect(after.is_archived, 'the row stayed archived').toBe(false);
    expect(res.error, 'the write was refused for the wrong reason').toMatch(/DELETE_PERMISSION_REQUIRED|permission/i);
  });

  it('rejects an unknown customer id without touching anything', async () => {
    await resetCustomer();
    const { error } = await execRpcAsUser(OWNER_A, 'archive_customer', { p_customer_id: 'dad1beef-0000-4000-8000-0000000000ff' });
    expect(error).toBeTruthy();
    expect(error).toMatch(/CUSTOMER_NOT_FOUND|NOT_AUTHORIZED/i);
    const rows = await sql(`SELECT count(*)::int c FROM customers WHERE shop_id IN ('${TENANT_A}','${TENANT_B}') AND is_archived`);
    expect(rows.rows[0].c).toBe(0);
  });

  it('treats a repeated archive as a no-op rather than an error or a duplicate', async () => {
    await resetCustomer();
    const first = await execRpcAsUser(OWNER_A, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(first.error).toBeNull();
    const second = await execRpcAsUser(OWNER_A, 'archive_customer', { p_customer_id: CUSTOMER_A });
    expect(second.error, 'a repeated archive errored instead of being idempotent').toBeNull();
    const rows = await sql(`SELECT count(*)::int c FROM customers WHERE id = '${CUSTOMER_A}'`);
    expect(rows.rows[0].c, 'the repeat created a duplicate').toBe(1);
    const after = await customerRow(CUSTOMER_A);
    expect(after.is_archived).toBe(true);
  });

  it('cannot be reached by an unauthenticated direct SQL insert of an archived row either', async () => {
    const anonInsert = await qaAnonClient
      .from('customers')
      .insert({ id: 'dad1000d-0000-4000-8000-00000000000d', name: 'anon', shop_id: TENANT_A })
      .select('*');
    expect(anonInsert.error, 'an anonymous client inserted a customer row').toBeTruthy();
    const rows = await sql(`SELECT count(*)::int c FROM customers WHERE id = 'dad1000d-0000-4000-8000-00000000000d'`);
    expect(rows.rows[0].c).toBe(0);
  });
});
