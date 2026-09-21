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
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { QA_IDS, setupAllFixtures, cleanupTestData } from '../setup/fixtures';

const TENANT = QA_IDS.shop;
const OWNER = QA_IDS.admin;
const CUSTOMER = QA_IDS.customerA;
const COMPANY = QA_IDS.companyA;
const PRODUCT = QA_IDS.productA;
const VARIANT = QA_IDS.variantA;

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
      customerName: 'QA Customer A',
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
  // old membership. Assert it here, exactly as the other authorized suites do.
  await execSqlAsAdmin(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES ('${OWNER}', '${TENANT}', 'owner', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now()
  `);
  await execSqlAsAdmin(`UPDATE companies SET outstanding_payable = 15000 WHERE id = '${COMPANY}'`);
  await setVariantStock(100);
});

afterAll(async () => {
  await execSqlAsAdmin(`DELETE FROM supplier_payments WHERE company_id = '${COMPANY}'`);
  await execSqlAsAdmin(`DELETE FROM stock_adjustments WHERE idempotency_key LIKE 'qa-dupsafe-%'`);
  // Removes this suite's sales, voids, returns and movements for the shared
  // fixtures, without touching the baseline the other suites rely on.
  await cleanupTestData();
  await execSqlAsAdmin(`UPDATE companies SET outstanding_payable = 15000 WHERE id = '${COMPANY}'`);
  await setVariantStock(100);
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
    const refused = [a, b].filter((r) => r.error !== null);
    expect(refused.length).toBe(1);
    expect(refused[0].error).toMatch(/already voided/i);

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
