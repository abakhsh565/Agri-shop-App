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
import { execRpcAsUser, execSqlAsAdmin, roleIdByName, updateAsUser } from '../setup/qa-client';
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
  // ON CONFLICT DO UPDATE keeps its old membership. Assert it, as the other authorized suites do —
  // as an admin on the Store Manager template, never as owner: 0280 allows one
  // active owner per shop and the fixture shop's owner is Khalid Khan.
  const storeManagerRoleId = await roleIdByName(TENANT, 'Store Manager');
  await execSqlAsAdmin(`
    INSERT INTO memberships (user_id, tenant_id, role, role_id, status)
    VALUES ('${OWNER}', '${TENANT}', 'admin', '${storeManagerRoleId}', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'admin', role_id = '${storeManagerRoleId}', status = 'active', updated_at = now()
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
  throwIfCleanupFailed('saleIdempotency beforeAll cleanup');
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
  await trySql('sale_submissions', execSqlAsAdmin(`DELETE FROM sale_submissions WHERE idempotency_key LIKE 'qa-saleidem-%'`));
  await trySql('sale_items', execSqlAsAdmin(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = '${CUSTOMER}')`));
  await trySql('sales', execSqlAsAdmin(`DELETE FROM sales WHERE customer_id = '${CUSTOMER}'`));
  await trySql('inventory_movements', execSqlAsAdmin(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`));
  await trySql('stock_adjustments', execSqlAsAdmin(`DELETE FROM stock_adjustments WHERE product_id = '${PRODUCT}'`));
  await trySql('product_variants', execSqlAsAdmin(`DELETE FROM product_variants WHERE id = '${VARIANT}'`));
  await trySql('products', execSqlAsAdmin(`DELETE FROM products WHERE id = '${PRODUCT}'`));
  await trySql('customers', execSqlAsAdmin(`DELETE FROM customers WHERE id = '${CUSTOMER}'`));
  await cleanupTestData();
  throwIfCleanupFailed('saleIdempotency afterAll cleanup');
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

/**
 * The sale note write path — one column, named twice, once wrongly.
 *
 * WHY THIS FILE HOLDS IT. The release commit `a6698ebe` updated the sale note with
 * `.from("sales").update({ note })`. The column is **`notes`**, and migration 0195 grants exactly
 * `UPDATE(notes) ON public.sales` — so the release build's note save addressed a column that does not
 * exist, in both `salesStore.updateNote` and the offline queue's `update_note` replay. The correction
 * landed only in uncommitted work. A source-text assertion would not have caught it and cannot keep it
 * caught, because the failure is between the client and the database. So the assertions below drive the
 * real PostgREST path with the real JWT and read the row back, and they pin the schema fact that made
 * the defect possible.
 *
 * The narrowness assertion is deliberate too: 0195 re-granted one column, and a note editor that could
 * alter totals, actors or branch ownership would be a privilege escalation dressed as a convenience.
 */
describe('the sale note write path', () => {
  let saleId = '';

  it('5. the column is `notes`, and the retired name does not exist', async () => {
    const cols = await execSqlAsAdmin(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sales'
         AND column_name IN ('note', 'notes')
    `);
    const names = (cols.rows ?? []).map((r: any) => String(r.column_name)).sort();
    expect(
      names,
      '`a6698ebe` wrote sales.note; if a future rename ever reintroduces that name this fails here',
    ).toEqual(['notes']);
  });

  it('6. the app’s own payload writes the note and the database holds it', async () => {
    const created = await rpc('create_sale', payload(`qa-saleidem-note-${randomUUID()}`));
    saleId = String(created.id);

    // Exactly what `salesStore.updateNote` sends: `.from("sales").update({ notes: note }).eq("id", saleId)`.
    const note = `QA sale note ${Date.now()}`;
    const written = await updateAsUser(OWNER, 'sales', { notes: note }, { id: saleId });
    expect(written.error, `the notes write was refused: ${written.error}`).toBeNull();
    expect(
      written.data?.length,
      'an UPDATE RLS refuses matches zero rows instead of erroring, so the row count is the proof',
    ).toBe(1);

    const stored = await scalar(`SELECT notes FROM sales WHERE id = '${saleId}'`);
    expect(stored.notes, 'the note must be readable back from the column the grant names').toBe(note);
  });

  it('7. the retired column name is still refused, so the old defect cannot pass silently', async () => {
    const before = await scalar(`SELECT notes FROM sales WHERE id = '${saleId}'`);
    const wrong = await updateAsUser(OWNER, 'sales', { note: 'written through the retired name' }, { id: saleId });
    expect(
      wrong.error,
      'PostgREST must refuse a body naming a column that does not exist — silence here is the old bug',
    ).toBeTruthy();
    const after = await scalar(`SELECT notes FROM sales WHERE id = '${saleId}'`);
    expect(after.notes, 'the refused write must not have changed anything').toBe(before.notes);
  });

  it('8. the granted update stays narrow — another column on the same row is refused', async () => {
    const before = await scalar(`SELECT total_amount FROM sales WHERE id = '${saleId}'`);
    const widened = await updateAsUser(OWNER, 'sales', { total_amount: 1 }, { id: saleId });
    expect(
      widened.error ?? '',
      '0195 granted one column; a totals column must still be refused',
    ).toMatch(/permission denied|not authorized/i);
    const after = await scalar(`SELECT total_amount FROM sales WHERE id = '${saleId}'`);
    expect(after.total_amount, 'the refused widened write must not have changed the total').toBe(before.total_amount);
  });
});
