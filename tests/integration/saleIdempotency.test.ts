/**
 * One confirm = one sale — the database is the authority.
 *
 * WHY THIS FILE EXISTS NOW
 *   Migration 0134 closed the owner's report ("once I create a sale and double-click confirm,
 *   it's created twice in the system but it is only one sale") with a `sale_submissions` ledger
 *   keyed by (shop_id, idempotency_key), a wrapper that claims the key atomically with
 *   `INSERT … ON CONFLICT DO NOTHING`, and the real implementation renamed to
 *   `create_sale_unchecked` with EXECUTE revoked from clients. The migration's own closing
 *   comment says the proof lives in `tests/integration/saleIdempotency.test.ts` — that file did
 *   not exist. The UI ref guard is asserted in `tests/unit/reentrancyGuard.test.ts`, but a
 *   database guarantee that nothing exercised is a guarantee in a comment.
 *
 * WHAT THIS PROVES, at the RPC layer a browser actually reaches:
 *   1. two simultaneous confirms with one key create ONE sale, deduct stock ONCE, and raise the
 *      customer's purchase total ONCE (or the loser is refused with DUPLICATE_SUBMISSION while
 *      the winner's sale is still in flight — also not a duplicate);
 *   2. a retry AFTER the first attempt succeeded returns that same sale (`duplicate: true`)
 *      instead of creating a second — this is the lost-answer/timeout path;
 *   3. a call WITHOUT a key still behaves exactly as before (scripts and tests depend on it);
 *   4. `create_sale_unchecked` is not reachable from an authenticated client, so the guard
 *      cannot be bypassed by naming the other function.
 *
 * QA database only; the suite uses its own customer/product/variant so a neighbour's cleanup
 * cannot delete the rows it is asserting on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { QA_IDS, setupAllFixtures, cleanupTestData } from '../setup/fixtures';

const TENANT = QA_IDS.shop;
const OWNER = QA_IDS.admin;

// Own UUID prefix: `fixtureIdCollision.test.ts` refuses two test files declaring the same id,
// and `d1000000-…` belongs to tenantIsolationOps.test.ts.
const CUSTOMER = 'd9000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'd9000000-0000-0000-0000-0000000000d1';
const VARIANT = 'd9000000-0000-0000-0000-0000000000d2';
const PRICE = 500;
const QTY = 2;
const TOTAL = PRICE * QTY;

async function rpcMaybe(name: string, params: Record<string, unknown>, userId = OWNER) {
  return execRpcAsUser(userId, name, params);
}

async function rpc(name: string, params: Record<string, unknown>, userId = OWNER) {
  const { data, error } = await execRpcAsUser(userId, name, params);
  if (error) throw new Error(`${name}: ${error}`);
  return data;
}

const scalar = async (sql: string) => {
  const r = await execSqlAsAdmin(sql);
  return (r.rows?.[0] ?? {}) as Record<string, any>;
};

const saleCount = async () => Number((await scalar(`SELECT count(*)::int AS n FROM sales WHERE customer_id = '${CUSTOMER}'`)).n);
const stock = async () => Number((await scalar(`SELECT stock_qty FROM product_variants WHERE id = '${VARIANT}'`)).stock_qty);
const purchases = async () => Number((await scalar(`SELECT total_purchases FROM customers WHERE id = '${CUSTOMER}'`)).total_purchases);

function payload(key?: string) {
  return {
    payload: {
      customerId: CUSTOMER,
      customerName: 'QA SaleIdem Customer',
      employeeId: OWNER,
      employeeName: 'QA Admin',
      paymentType: 'full',
      paymentMethod: 'cash',
      amountPaid: TOTAL,
      items: [
        {
          productId: PRODUCT,
          productName: 'QA SaleIdem Product',
          variantId: VARIANT,
          variantName: '1kg',
          qty: QTY,
          unitPrice: PRICE,
          unitSize: 1,
          baseUnit: 'kg',
        },
      ],
      ...(key ? { idempotencyKey: key } : {}),
    },
  };
}

beforeAll(async () => {
  await setupAllFixtures();

  // 0113 guarantees a membership for every user, but only on INSERT; a fixture re-inserted with
  // ON CONFLICT DO UPDATE keeps its old membership. Assert it, as the other authorized suites do.
  await execSqlAsAdmin(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES ('${OWNER}', '${TENANT}', 'owner', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now()
  `);
  await execSqlAsAdmin(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUSTOMER}', 'QA SaleIdem Customer', '923009771101', 50000, 0, 0, 0, '${TENANT}', 'QA')
    ON CONFLICT (id) DO UPDATE SET outstanding_balance = 0, total_purchases = 0, total_paid = 0
  `);
  await execSqlAsAdmin(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${PRODUCT}', 'QA SaleIdem Product', 'fertilizer', 'kg', 100, '${TENANT}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true, base_unit = 'kg'
  `);
  await execSqlAsAdmin(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${VARIANT}', '${PRODUCT}', '1kg', ${PRICE}, 300, 1, 1, 5, 100, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 100, is_active = true, selling_price = ${PRICE}
  `);
});

afterAll(async () => {
  await execSqlAsAdmin(`DELETE FROM sale_submissions WHERE idempotency_key LIKE 'qa-saleidem-%'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM sales WHERE customer_id = '${CUSTOMER}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM stock_adjustments WHERE product_id = '${PRODUCT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM product_variants WHERE id = '${VARIANT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM products WHERE id = '${PRODUCT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM customers WHERE id = '${CUSTOMER}'`).catch(() => undefined);
  await cleanupTestData();
});

describe('sale idempotency', () => {
  let firstSaleId = '';
  let key = '';

  it('1. two simultaneous confirms with one key create exactly one sale', async () => {
    key = `qa-saleidem-${randomUUID()}`;

    const [a, b] = await Promise.all([rpcMaybe('create_sale', payload(key)), rpcMaybe('create_sale', payload(key))]);

    const failures = [a, b].filter((r) => r.error);
    const successes = [a, b].filter((r) => !r.error);
    expect(successes.length, 'at least one confirm must succeed').toBeGreaterThanOrEqual(1);
    // The loser is allowed exactly one refusal: the key was claimed but its sale was still in
    // flight. Anything else (NOT_AUTHORIZED, INSUFFICIENT_STOCK, …) is a real failure.
    for (const failure of failures) {
      expect(String(failure.error)).toContain('DUPLICATE_SUBMISSION');
    }
    if (successes.length === 2) {
      expect(successes[0].data.id, 'both confirms must resolve to the same sale').toBe(successes[1].data.id);
    }
    firstSaleId = String(successes[0].data.id);

    expect(await saleCount(), 'one intention, one sale').toBe(1);
    expect(await stock(), 'stock deducted once').toBe(100 - QTY);
    expect(await purchases(), 'customer purchase total raised once').toBe(TOTAL);

    const ledger = await scalar(
      `SELECT count(*)::int AS n, max(sale_id::text) AS sale_id FROM sale_submissions WHERE shop_id = '${TENANT}' AND idempotency_key = '${key}'`,
    );
    expect(Number(ledger.n)).toBe(1);
    expect(ledger.sale_id).toBe(firstSaleId);
  });

  it('2. a retry after success returns the same sale instead of creating a second', async () => {
    const retry = await rpc('create_sale', payload(key));
    expect(retry.id).toBe(firstSaleId);
    expect(retry.duplicate).toBe(true);

    expect(await saleCount()).toBe(1);
    expect(await stock()).toBe(100 - QTY);
    expect(await purchases()).toBe(TOTAL);
  });

  it('3. a call without a key still records a sale normally (backward compatible)', async () => {
    const unkeyed = await rpc('create_sale', payload());
    expect(unkeyed.id).toBeTruthy();
    expect(unkeyed.id).not.toBe(firstSaleId);

    expect(await saleCount()).toBe(2);
    expect(await stock()).toBe(100 - QTY * 2);
    expect(await purchases()).toBe(TOTAL * 2);
  });

  it('4. the unchecked implementation is not reachable from an authenticated client', async () => {
    const bypass = await rpcMaybe('create_sale_unchecked', payload(`qa-saleidem-bypass-${randomUUID()}`));
    expect(bypass.error, 'naming the inner function must not be a way around the guard').toBeTruthy();
    expect(String(bypass.error)).toMatch(/permission denied|not authorized/i);
    expect(await saleCount(), 'the refused call created nothing').toBe(2);
  });
});
