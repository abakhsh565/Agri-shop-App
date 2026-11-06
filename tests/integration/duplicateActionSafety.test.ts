/**
 * "One user intention = one business action" — for the money and inventory
 * actions a confirm button can submit twice.
 *
 * Reported by the product owner: "once I create a sale and double-click confirm,
 * it's created twice in the system but it is only one sale". create_sale was fixed
 * in 0134; this suite covers the rest of the same class, and it submits each action
 * the way the pages actually submit it (two calls at the same instant, sharing the
 * key the page holds for the attempt). Button state is deliberately not part of
 * the evidence — the database has to be the protection.
 *
 * Defects these tests were written against (all reproduced before fixing):
 *   - record_supplier_payment had no idempotency at all → two payments recorded
 *     and the payable reduced twice (0138)
 *   - void_sale read `is_voided` and then acted on it → two voids rows, two
 *     inventory movements, and a lost update on stock (0138)
 *   - adjust_stock had no idempotency at all → the adjustment applied twice (0139)
 *
 * Uses execRpcAsUser for every action (real JWT → PostgREST → RPC) and
 * execSqlAsAdmin only for verification reads.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execRpcAsUser, execSqlAsAdmin, roleIdByName } from '../setup/qa-client';
import { QA_IDS, setupAllFixtures, cleanupTestData } from '../setup/fixtures';

const TENANT = QA_IDS.shop;
const OWNER = QA_IDS.admin;
// This suite's own customer, and its own supplier company, for the rows it creates
// and then voids. The shared QA baseline (customerA, companyA) is cleaned up by
// every other suite that calls cleanupTestData()/cleanupFixtures(), which deletes
// ALL sales for those customers — including one this suite had just created, which
// surfaced as "Sale not found" on both halves of the concurrent void.
const CUSTOMER = 'c4000000-0000-0000-0000-0000000000c1';
const COMPANY = 'c4000000-0000-0000-0000-0000000000c2';
// ...and its own product + variant: cleanupTestData() deletes the inventory
// movements of the shared productA/productB, which removed this suite's adjustment
// movement mid-run (asserted count came back 0).
const PRODUCT = 'c4000000-0000-0000-0000-0000000000d1';
const VARIANT = 'c4000000-0000-0000-0000-0000000000d2';

/** RPC that must succeed, returning its result. */
async function rpc(name: string, params: Record<string, unknown>, userId = OWNER) {
  const { data, error } = await execRpcAsUser(userId, name, params);
  if (error) throw new Error(`${name}: ${error}`);
  return data;
}

/** RPC that is allowed to fail; used for both halves of a double submit. */
async function rpcMaybe(name: string, params: Record<string, unknown>, userId = OWNER) {
  return execRpcAsUser(userId, name, params);
}

const scalar = async (sql: string) => {
  const r = await execSqlAsAdmin(sql);
  return (r.rows?.[0] ?? {}) as Record<string, any>;
};

const payableOf = async () => Number((await scalar(`SELECT outstanding_payable FROM companies WHERE id = '${COMPANY}'`)).outstanding_payable);
const variantStock = async () => Number((await scalar(`SELECT stock_qty FROM product_variants WHERE id = '${VARIANT}'`)).stock_qty);
const setVariantStock = (qty: number) =>
  execSqlAsAdmin(`UPDATE product_variants SET stock_qty = ${qty} WHERE id = '${VARIANT}'`);

let saleIds: string[] = [];

async function makeSale(idempotencyKey: string) {
  const sale = await rpc('create_sale', {
    payload: {
      customerId: CUSTOMER,
      customerName: 'QA Dup-safe Customer',
      employeeId: OWNER,
      employeeName: 'QA Admin',
      paymentType: 'credit',
      paymentMethod: 'cash',
      amountPaid: 0,
      items: [{
        productId: PRODUCT, productName: 'QA Product A',
        variantId: VARIANT, variantName: '1kg',
        qty: 2, unitPrice: 500, unitSize: 1, baseUnit: 'piece',
      }],
      idempotencyKey,
    },
  });
  saleIds.push(sale.id);
  return sale.id as string;
}

beforeAll(async () => {
  await setupAllFixtures();

  // 0113 guarantees a membership for every user, but it fires on INSERT only, so a
  // fixture re-inserted with ON CONFLICT DO UPDATE (as setupUsers does) keeps its
  // old membership. Assert it here, exactly as the other authorized suites do —
  // as an admin on the Store Manager template, never as owner: 0280 allows one
  // active owner per shop and the fixture shop's owner is Khalid Khan.
  const storeManagerRoleId = await roleIdByName(TENANT, 'Store Manager');
  await execSqlAsAdmin(`
    INSERT INTO memberships (user_id, tenant_id, role, role_id, status)
    VALUES ('${OWNER}', '${TENANT}', 'admin', '${storeManagerRoleId}', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'admin', role_id = '${storeManagerRoleId}', status = 'active', updated_at = now()
  `);
  await execSqlAsAdmin(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${PRODUCT}', 'QA Dup-safe Product', 'spray', 'piece', 100, '${TENANT}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true
  `);
  await execSqlAsAdmin(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${VARIANT}', '${PRODUCT}', 'QA Variant', 500, 300, 1, 1, 5, 100, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 100, is_active = true
  `);
  await execSqlAsAdmin(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUSTOMER}', 'QA Dup-safe Customer', '923009771001', 50000, 0, 0, 0, '${TENANT}', 'QA')
    ON CONFLICT (id) DO UPDATE SET outstanding_balance = 0, total_purchases = 0, total_paid = 0
  `);
  await execSqlAsAdmin(`
    INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
    VALUES ('${COMPANY}', 'QA Dup-safe Supplier', 15000, 50000, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET outstanding_payable = 15000
  `);
  await setVariantStock(100);
  throwIfCleanupFailed('duplicateActionSafety beforeAll cleanup');
});

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

afterAll(async () => {
  await execSqlAsAdmin(`DELETE FROM supplier_payments WHERE company_id = '${COMPANY}'`);
  await trySql('customer_payments', execSqlAsAdmin(`DELETE FROM customer_payments WHERE customer_id = '${CUSTOMER}'`));

  // THIS SUITE'S OWN SALES, children before parents — and the reason the baseline read `sales: 5,
  // declared 2` on 2026-10-14.
  //
  // `cleanupTestData()` only covers the SHARED fixtures (customerA/B/C), so nothing here removed the
  // sale test 4 records for this suite's OWN customer, and the customer delete below was wrapped in
  // a swallowed catch — it failed on `sales.customer_id` (NO ACTION) and said nothing. One
  // voided sale, its line and its void were left behind per run: three of them in QA, each with
  // `total_amount = 1000.00` and the reason 'QA duplicate-safety void'. Deleted by this suite's own
  // customer id, which no other file uses (`grep` over tests/ finds this file and the residue
  // criteria only), so it cannot reach a sibling lane's rows.
  await execSqlAsAdmin(`DELETE FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')`);
  await execSqlAsAdmin(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')`);
  await execSqlAsAdmin(`DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id = '${CUSTOMER}')`);
  await trySql('returns', execSqlAsAdmin(`DELETE FROM returns WHERE customer_id = '${CUSTOMER}'`));
  await trySql('payments', execSqlAsAdmin(`DELETE FROM payments WHERE customer_id = '${CUSTOMER}'`));
  await trySql('credit_limit_requests', execSqlAsAdmin(`DELETE FROM credit_limit_requests WHERE customer_id = '${CUSTOMER}'`));
  await execSqlAsAdmin(`DELETE FROM sales WHERE customer_id = '${CUSTOMER}'`);
  await execSqlAsAdmin(`DELETE FROM customers WHERE id = '${CUSTOMER}'`);
  await trySql('companies', execSqlAsAdmin(`DELETE FROM companies WHERE id = '${COMPANY}'`));
  await trySql('inventory_movements', execSqlAsAdmin(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`));
  await trySql('stock_adjustments', execSqlAsAdmin(`DELETE FROM stock_adjustments WHERE product_id = '${PRODUCT}'`));
  await trySql('product_variants', execSqlAsAdmin(`DELETE FROM product_variants WHERE id = '${VARIANT}'`));
  await trySql('products', execSqlAsAdmin(`DELETE FROM products WHERE id = '${PRODUCT}'`));
  await execSqlAsAdmin(`DELETE FROM stock_adjustments WHERE idempotency_key LIKE 'qa-dupsafe-%'`);
  // Removes this suite's sales, voids, returns and movements for the shared
  // fixtures, without touching the baseline the other suites rely on.
  await cleanupTestData();
  await execSqlAsAdmin(`UPDATE companies SET outstanding_payable = 15000 WHERE id = '${COMPANY}'`);
  await setVariantStock(100);

  // Read the result back rather than assume it: the three rows this suite used to leave behind were
  // invisible precisely because the deletes above were fire-and-forget. A survivor fails the run and
  // names itself, which is how the next such gap gets found in seconds instead of in a baseline diff.
  const leftOver = await execSqlAsAdmin(
    `SELECT (SELECT count(*)::int FROM sales WHERE customer_id = '${CUSTOMER}') AS sales,
            (SELECT count(*)::int FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')) AS voids,
            (SELECT count(*)::int FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')) AS sale_items,
            (SELECT count(*)::int FROM customers WHERE id = '${CUSTOMER}') AS customers`,
  );
  const row = (leftOver.rows?.[0] ?? {}) as Record<string, unknown>;
  const survivors = Object.entries(row).filter(([, n]) => Number(n) > 0);
  if (survivors.length) {
    throw new Error(
      `[QA FIXTURE] duplicateActionSafety left ${survivors.map(([t, n]) => `${t}=${n}`).join(', ')} behind ` +
        '— find the reference rather than widening a `.catch`.',
    );
  }
  throwIfCleanupFailed('duplicateActionSafety afterAll cleanup');
});

describe('Duplicate action safety', () => {
  it('1. supplier payment: two simultaneous confirms with one key pay once', async () => {
    const before = await payableOf();
    const key = `qa-dupsafe-supp-${randomUUID()}`;
    const payload = () => ({
      companyId: COMPANY, amount: 500, method: 'cash',
      notes: 'QA duplicate-safety supplier payment', actorId: OWNER, idempotencyKey: key,
    });

    const [a, b] = await Promise.all([
      rpcMaybe('record_supplier_payment', { payload: payload() }),
      rpcMaybe('record_supplier_payment', { payload: payload() }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const rows = await scalar(`SELECT count(*)::int AS n FROM supplier_payments WHERE idempotency_key = '${key}'`);
    expect(Number(rows.n)).toBe(1);
    expect(await payableOf()).toBe(before - 500);
  });

  it('2. supplier payment: a retry after the fact returns the same payment, not a second one', async () => {
    const before = await payableOf();
    const key = `qa-dupsafe-retry-${randomUUID()}`;
    const payload = {
      companyId: COMPANY, amount: 250, method: 'cash',
      notes: 'QA duplicate-safety supplier retry', actorId: OWNER, idempotencyKey: key,
    };

    const first = await rpc('record_supplier_payment', { payload });
    const retry = await rpc('record_supplier_payment', { payload });

    expect(retry.id).toBe(first.id);
    expect(retry.idempotent).toBe(true);
    const rows = await scalar(`SELECT count(*)::int AS n FROM supplier_payments WHERE idempotency_key = '${key}'`);
    expect(Number(rows.n)).toBe(1);
    expect(await payableOf()).toBe(before - 250);
  });

  it('3. supplier payment without a key still records normally (backward compatible)', async () => {
    const before = await payableOf();
    const result = await rpc('record_supplier_payment', {
      payload: { companyId: COMPANY, amount: 100, method: 'cash', notes: 'QA duplicate-safety no key', actorId: OWNER },
    });
    expect(result.id).toBeTruthy();
    expect(await payableOf()).toBe(before - 100);
  });

  it('4. void: two simultaneous voids of one sale void once and restore stock once', async () => {
    const saleId = await makeSale(`qa-dupsafe-void-${randomUUID()}`);
    const before = await variantStock();

    const [a, b] = await Promise.all([
      rpcMaybe('void_sale', { p_sale_id: saleId, p_reason: 'QA duplicate-safety void', p_voided_by: OWNER }),
      rpcMaybe('void_sale', { p_sale_id: saleId, p_reason: 'QA duplicate-safety void', p_voided_by: OWNER }),
    ]);

    // Exactly one of the two is refused — voiding a voided sale is still an error.
    // The errors travel with the assertion: a bare count cannot be told apart from
    // a shared-fixture race (which shows up as NOT_AUTHORIZED on BOTH calls).
    const errors = [a.error, b.error];
    const refused = errors.filter((e) => e !== null);
    expect(refused.length, `expected one refusal, got: ${JSON.stringify(errors)}`).toBe(1);
    expect(refused[0]).toMatch(/already voided/i);

    const voids = await scalar(`SELECT count(*)::int AS n FROM voids WHERE sale_id = '${saleId}'`);
    const movements = await scalar(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE reference_id = '${saleId}' AND movement_type = 'void'`
    );
    expect(Number(voids.n)).toBe(1);
    expect(Number(movements.n)).toBe(1);
    expect(await variantStock()).toBe(before + 2);
  });

  it('5. stock adjustment: two simultaneous confirms with one key adjust once', async () => {
    const before = await variantStock();
    const key = `qa-dupsafe-adjust-${randomUUID()}`;
    const payload = () => ({
      variantId: VARIANT, productId: PRODUCT, productName: 'QA Product A',
      adjustmentType: 'add', qty: 5, reason: 'QA duplicate-safety adjust', actorId: OWNER, idempotencyKey: key,
    });

    const [a, b] = await Promise.all([
      rpcMaybe('adjust_stock', { payload: payload() }),
      rpcMaybe('adjust_stock', { payload: payload() }),
    ]);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();

    const movements = await scalar(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE reference_type = 'adjustment' AND reference_id IN (SELECT id FROM stock_adjustments WHERE idempotency_key = '${key}')`
    );
    expect(Number(movements.n)).toBe(1);
    expect(await variantStock()).toBe(before + 5);
  });

  it('6. stock adjustment: a retry returns the recorded adjustment', async () => {
    const key = `qa-dupsafe-adjust-retry-${randomUUID()}`;
    const before = await variantStock();
    const payload = {
      variantId: VARIANT, productId: PRODUCT, productName: 'QA Product A',
      adjustmentType: 'add', qty: 3, reason: 'QA duplicate-safety adjust retry', actorId: OWNER, idempotencyKey: key,
    };

    const first = await rpc('adjust_stock', { payload });
    const retry = await rpc('adjust_stock', { payload });

    expect(retry.id).toBe(first.id);
    expect(retry.idempotent).toBe(true);
    expect(await variantStock()).toBe(before + 3);
  });

  it('7. stock adjustment without a key still applies (backward compatible)', async () => {
    const before = await variantStock();
    const result = await rpc('adjust_stock', {
      payload: {
        variantId: VARIANT, productId: PRODUCT, productName: 'QA Product A',
        adjustmentType: 'add', qty: 1, reason: 'QA duplicate-safety no key', actorId: OWNER,
      },
    });
    expect(result.id).toBeTruthy();
    expect(await variantStock()).toBe(before + 1);
  });
});
