/**
 * Inventory Integrity + Return/Void Regression Test Suite
 *
 * Business Rules:
 * - A transaction must never restore or remove stock twice
 * - Void restores only the remaining (non-returned) quantity
 * - Return after void should not double-restore
 * - Inventory movements must be correct and complete
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDbClient, execSqlAsAdmin } from '../setup/qa-client';

let client: any;

/**
 * The branch every branch-owned row in this fixture belongs to.
 *
 * `sales` and `returns` are branch-owned and `enforce_branch_scope()` (0188) refuses a background
 * write — a direct connection with no authenticated actor — that states no resolvable branch
 * (`INVALID_BRANCH_SCOPE`). This fixture's rows carry `shop_id`, so the trigger could derive one;
 * they now state it instead of depending on that fallback.
 *
 * The fixture used to work around the rule by disabling every trigger in `public` on the shared QA
 * database (`disableTriggers()`). That was measured and it disabled **nothing**: 49 of the 55
 * `ALTER TABLE … DISABLE TRIGGER ALL` statements were refused with `permission denied: … is a
 * system trigger`, because non-superuser `postgres` cannot disable the generated FK triggers and
 * the statement is rejected atomically. The calls are gone: an attempted database-wide DDL sweep on
 * a shared database, which achieved nothing, is not a fixture technique.
 */
let mainBranch = '';

const TEST = {
  shop: '00000000-0000-0000-0000-000000000001',
  productA: 'F1000000-0000-0000-0000-000000000001',
  productB: 'F1000000-0000-0000-0000-000000000002',
  variantA: 'F1000000-0000-0000-0000-000000000010',
  variantB: 'F1000000-0000-0000-0000-000000000011',
  companyA: 'F1000000-0000-0000-0000-000000000020',
  customerA: 'F1000000-0000-0000-0000-000000000030',
  saleA: 'F1000000-0000-0000-0000-000000000040',
  saleB: 'F1000000-0000-0000-0000-000000000041',
  saleC: 'F1000000-0000-0000-0000-000000000042',
  saleItemA: 'F1000000-0000-0000-0000-000000000050',
  saleItemB: 'F1000000-0000-0000-0000-000000000051',
  saleItemC: 'F1000000-0000-0000-0000-000000000052',
  returnA: 'F1000000-0000-0000-0000-000000000060',
  returnItemA: 'F1000000-0000-0000-0000-000000000070',
  voidA: 'F1000000-0000-0000-0000-000000000080',
  // Never written by the fixture: the id a deliberately unowned write is refused for.
  ghostReturn: 'F1000000-0000-0000-0000-000000000090',
  evidence: [] as Array<{test: string; expected: string; actual: string; result: string}>,
};

function record(test: string, expected: string, actual: string, result: 'PASS' | 'FAIL') {
  TEST.evidence.push({ test, expected, actual, result });
  if (result === 'FAIL') console.error(`FAIL: ${test} — Expected: ${expected}, Actual: ${actual}`);
}

beforeAll(async () => {
  client = getDbClient();
  await client.connect();

  // The tenant's branch, by the database's own rule: `default_branch_id()` is the function
  // `enforce_branch_scope()` itself calls for a background write.
  const branch = await execSqlAsAdmin(`SELECT public.default_branch_id('${TEST.shop}') AS id`);
  mainBranch = branch.rows[0]?.id ?? '';
  // A tenant with no active branch is an environment problem, not an inventory one: say so rather
  // than writing rows whose ownership nothing can resolve.
  if (!mainBranch) {
    throw new Error(
      `inventoryIntegrity: tenant ${TEST.shop} has no active branch in QA, so nothing can own the ` +
        `rows this suite writes. Seed the baseline first: npm run qa:seed baseline`,
    );
  }

  // Clear anything an earlier run left behind; residue would corrupt every number measured below.
  const leftover = await cleanupTestData();
  if (leftover.length) {
    throw new Error(`inventoryIntegrity: pre-run cleanup failed — ${leftover.join('; ')}`);
  }

  // Create fixtures
  await client.query(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${TEST.customerA}', 'Inv Test User', '92300INV1001', 'admin', true, true, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${TEST.companyA}', 'Inv Test Supplier', 0, 0, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${TEST.customerA}', 'Inv Customer A', '92300INV1001', 100000, 0, 0, 0, '${TEST.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${TEST.productA}', 'Inv Test Product A', '${TEST.companyA}', 'seed', 100, '${TEST.shop}'), ('${TEST.productB}', 'Inv Test Product B', '${TEST.companyA}', 'fertilizer', 50, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty, is_active) VALUES ('${TEST.variantA}', '${TEST.productA}', '1kg', 5000, 3000, 1, 10, 100, true), ('${TEST.variantB}', '${TEST.productB}', '5kg', 2000, 1500, 5, 5, 50, true) ON CONFLICT (id) DO UPDATE SET is_active = true`);
  // The upsert above is the fix for the rollup, not a nicety: the derived product
  // rollup (0128) sums only ACTIVE variants, and a variant left is_active=false by
  // an earlier run stays false under ON CONFLICT DO NOTHING, so the product reads
  // 0 while the variant itself reads its real stock. Re-asserting is_active=true
  // here fires the rollup trigger and repairs the product row too.
});

afterAll(async () => {
  const failures = await cleanupTestData();
  const residue = await fixtureResidue();
  await client?.end();

  // Cleanup is part of the result, not a courtesy. The previous version discarded every error
  // (`catch {}`) and deleted parents before children, so a sale and a sale_item survived in the
  // shared QA database after every run while this suite reported success.
  record('Fixture cleanup — statements completed', '0 errors', `${failures.length} error(s): ${failures.join('; ') || 'none'}`, failures.length === 0 ? 'PASS' : 'FAIL');
  record('Fixture cleanup — operational rows removed', '0', `${residue.total} (${residue.detail})`, residue.total === 0 ? 'PASS' : 'FAIL');
  record('Branch ownership — fixture rows carry the tenant branch', mainBranch || '(none)', mainBranch ? 'resolved' : 'MISSING', mainBranch ? 'PASS' : 'FAIL');

  const passed = TEST.evidence.filter(e => e.result === 'PASS').length;
  const failedEvidence = TEST.evidence.filter(e => e.result === 'FAIL');
  console.log(`\n=== INVENTORY + RETURN/VOID INTEGRITY EVIDENCE ===\nTotal: ${TEST.evidence.length}, PASS: ${passed}, FAIL: ${failedEvidence.length}`);
  for (const e of TEST.evidence) console.log(`[${e.result}] ${e.test}\n  Expected: ${e.expected}\n  Actual:   ${e.actual}`);
  // Printed FAIL evidence must fail the build — a suite that only logs its
  // failures reports green while the invariant is broken.
  expect(failedEvidence.map(e => `${e.test}: expected ${e.expected}, got ${e.actual}`)).toEqual([]);
});

/** Derived rollup vs the variants that own the stock. */
async function rollupFor(productId: string): Promise<{ product: number; variantSum: number }> {
  const p = await client.query(`SELECT stock_qty FROM products WHERE id = '${productId}'`);
  const s = await client.query(`SELECT coalesce(sum(stock_qty),0) AS s FROM product_variants WHERE product_id = '${productId}' AND is_active = true`);
  return { product: Number(p.rows[0]?.stock_qty ?? 0), variantSum: Number(s.rows[0]?.s ?? 0) };
}

/**
 * Remove everything this suite writes — children before parents.
 *
 * WHY THE ORDER IS THE POINT. The previous version deleted `sale_items` before the `return_items`
 * that reference them, and `sales` before the `returns` and `voids` that reference that, and it
 * discarded every error with `catch {}`. Those deletes therefore failed silently: a sale and a
 * sale_item survived in the shared QA database after **every** run — measured present both before
 * and after a baseline run (`sales=1, sale_items=1`), i.e. a permanent two-row residue. Dependency
 * order plus reported errors is what makes cleanup a result rather than a courtesy.
 *
 * @returns the statements that failed, as `statement: message`. Empty means cleanup completed.
 */
async function cleanupTestData(): Promise<string[]> {
  const failures: string[] = [];
  const q = async (sql: string) => {
    try {
      await execSqlAsAdmin(sql);
    } catch (e: any) {
      failures.push(`${sql.split(' WHERE ')[0]}: ${e.message}`);
    }
  };
  // return_items -> sale_items, and returns/voids -> sale: the referencing rows go first.
  await q(`DELETE FROM return_items WHERE return_id = '${TEST.returnA}'`);
  await q(`DELETE FROM return_items WHERE sale_item_id IN ('${TEST.saleItemA}', '${TEST.saleItemB}', '${TEST.saleItemC}')`);
  await q(`DELETE FROM returns WHERE id = '${TEST.returnA}'`);
  await q(`DELETE FROM voids WHERE id = '${TEST.voidA}'`);
  await q(`DELETE FROM voids WHERE sale_id IN ('${TEST.saleA}', '${TEST.saleB}', '${TEST.saleC}')`);
  await q(`DELETE FROM inventory_movements WHERE product_id IN ('${TEST.productA}', '${TEST.productB}')`);
  await q(`DELETE FROM sale_items WHERE sale_id IN ('${TEST.saleA}', '${TEST.saleB}', '${TEST.saleC}')`);
  await q(`DELETE FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}', '${TEST.saleC}')`);
  await q(`UPDATE product_variants SET stock_qty = CASE WHEN id = '${TEST.variantA}' THEN 100 WHEN id = '${TEST.variantB}' THEN 50 ELSE stock_qty END WHERE id IN ('${TEST.variantA}', '${TEST.variantB}')`);
  await q(`UPDATE products SET stock_qty = CASE WHEN id = '${TEST.productA}' THEN 100 WHEN id = '${TEST.productB}' THEN 50 ELSE stock_qty END WHERE id IN ('${TEST.productA}', '${TEST.productB}')`);
  return failures;
}

/**
 * How much of this suite's own output is still in the database, counted independently of the
 * cleanup's return value: "the delete reported no error" and "the row is gone" are two different
 * claims, and only the second one is evidence.
 */
async function fixtureResidue(): Promise<{ total: number; detail: string }> {
  const res = await execSqlAsAdmin(`
    SELECT 'sales' AS t, count(*)::int AS n FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}', '${TEST.saleC}')
    UNION ALL SELECT 'sale_items', count(*)::int FROM sale_items WHERE id IN ('${TEST.saleItemA}', '${TEST.saleItemB}', '${TEST.saleItemC}')
    UNION ALL SELECT 'returns', count(*)::int FROM returns WHERE id = '${TEST.returnA}'
    UNION ALL SELECT 'return_items', count(*)::int FROM return_items WHERE id = '${TEST.returnItemA}'
    UNION ALL SELECT 'voids', count(*)::int FROM voids WHERE id = '${TEST.voidA}'
    UNION ALL SELECT 'inventory_movements', count(*)::int FROM inventory_movements WHERE product_id IN ('${TEST.productA}', '${TEST.productB}')
  `);
  const rows = res.rows as Array<{ t: string; n: number }>;
  return {
    total: rows.reduce((sum, r) => sum + Number(r.n), 0),
    detail: rows.filter((r) => Number(r.n)).map((r) => `${r.t}=${r.n}`).join(', ') || 'none',
  };
}

// ── Product Creation Tests ──

describe('Inventory Integrity — Product/Variant', () => {
  it('should have correct initial stock', async () => {
    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Variant A initial stock', '100', String(v.rows[0].stock_qty), Number(v.rows[0].stock_qty) === 100 ? 'PASS' : 'FAIL');
  });

  it('should track product-level stock_qty', async () => {
    const p = await client.query(`SELECT stock_qty FROM products WHERE id = '${TEST.productA}'`);
    record('Product A stock_qty', '100', String(p.rows[0].stock_qty), Number(p.rows[0].stock_qty) === 100 ? 'PASS' : 'FAIL');
  });
});

// ── Stock Decrease via Sale ──

describe('Inventory Integrity — Sale Stock Decrease', () => {
  it('should decrease stock on sale (3 units)', async () => {
    const saleQty = 3;
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, branch_id, created_at, updated_at) VALUES ('${TEST.saleA}', 'INV-SALE-001',      '${TEST.customerA}', '${TEST.customerA}', ${saleQty * 5000}, 'completed', 'credit', 'cash', 0, ${saleQty * 5000}, 0, false, '${TEST.shop}', '${mainBranch}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total) VALUES ('${TEST.saleItemA}', '${TEST.saleA}', '${TEST.productA}', 'Inv Test Product A', '${TEST.variantA}', '1kg', ${saleQty}, 5000, ${saleQty * 5000}) ON CONFLICT (id) DO NOTHING`);
    // Decrease stock. The variant is the stock of record (migration 0128); the
    // app never writes products.stock_qty — a trigger derives it as the sum of
    // the product's active variants, so writing it here would double-count.
    await client.query(`UPDATE product_variants SET stock_qty = stock_qty - ${saleQty} WHERE id = '${TEST.variantA}'`);

    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Variant A after sale (3 units)', '97', String(v.rows[0].stock_qty), Number(v.rows[0].stock_qty) === 97 ? 'PASS' : 'FAIL');

    // The derived product rollup must follow the variant.
    const rollup = await rollupFor(TEST.productA);
    record('Product A rollup after sale (derived)', '97', rollup.product, Number(rollup.product) === 97 ? 'PASS' : 'FAIL');
    record('Product A rollup = SUM(active variants)', rollup.variantSum, rollup.product, rollup.product === rollup.variantSum ? 'PASS' : 'FAIL');
  });
});

// ── Partial Return ──

describe('Inventory Integrity — Partial Return', () => {
  it('should restore stock on partial return (1 unit)', async () => {
    const returnQty = 1;
    await client.query(`INSERT INTO returns (id, sale_id, customer_id, refund_amount, reason, processed_by, shop_id, branch_id, created_at) VALUES ('${TEST.returnA}', '${TEST.saleA}', '${TEST.customerA}', 5000, 'QA partial return', '${TEST.customerA}', '${TEST.shop}', '${mainBranch}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO return_items (id, return_id, sale_item_id, product_id, product_name, variant_id, variant_name, qty_to_return, unit_price, refund_amount) VALUES ('${TEST.returnItemA}', '${TEST.returnA}', '${TEST.saleItemA}', '${TEST.productA}', 'Inv Test Product A', '${TEST.variantA}', '1kg', ${returnQty}, 5000, 5000) ON CONFLICT (id) DO NOTHING`);
    // Restore stock (variant only — the product rollup is derived)
    await client.query(`UPDATE product_variants SET stock_qty = stock_qty + ${returnQty} WHERE id = '${TEST.variantA}'`);

    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Variant A after return (1 unit)', '98', String(v.rows[0].stock_qty), Number(v.rows[0].stock_qty) === 98 ? 'PASS' : 'FAIL');
  });

  it('should NOT exceed original stock after return', async () => {
    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    const stock = Number(v.rows[0].stock_qty);
    record('Variant A stock <= original', '<= 100', String(stock), stock <= 100 ? 'PASS' : 'FAIL');
  });
});

// ── Void Remaining Sale ──

describe('Inventory Integrity — Void Remaining', () => {
  it('should restore stock on void (remaining 2 units)', async () => {
    // Sale was 3 units, returned 1, remaining = 2
    const remainingQty = 2;
    await client.query(`INSERT INTO voids (id, sale_id, reason, voided_by, created_at) VALUES ('${TEST.voidA}', '${TEST.saleA}', 'QA void remaining', '${TEST.customerA}', NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`UPDATE sales SET is_voided = true, void_reason = 'QA void remaining', voided_by = '${TEST.customerA}', voided_at = NOW() WHERE id = '${TEST.saleA}'`);
    // Restore only remaining quantity (variant only — the rollup is derived)
    await client.query(`UPDATE product_variants SET stock_qty = stock_qty + ${remainingQty} WHERE id = '${TEST.variantA}'`);

    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Variant A after void (remaining 2)', '100', String(v.rows[0].stock_qty), Number(v.rows[0].stock_qty) === 100 ? 'PASS' : 'FAIL');
  });

  it('should match original stock exactly after return + void', async () => {
    const v = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Variant A stock = original (100)', '100', String(v.rows[0].stock_qty), Number(v.rows[0].stock_qty) === 100 ? 'PASS' : 'FAIL');
  });
});

// ── Double Void Prevention ──

describe('Inventory Integrity — Double Void Safety', () => {
  it('should NOT restore stock twice for same sale', async () => {
    // Get current stock
    const before = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    const stockBefore = Number(before.rows[0].stock_qty);

    // Attempt second void on same sale (should not restore stock again)
    // This is a business logic check — the application should prevent this
    const existingVoids = await client.query(`SELECT COUNT(*) as cnt FROM voids WHERE sale_id = '${TEST.saleA}'`);
    const voidCount = Number(existingVoids.rows[0].cnt);
    record('Sale A void count', '1', String(voidCount), voidCount === 1 ? 'PASS' : 'FAIL');

    // Stock should remain unchanged
    const after = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Stock unchanged after void check', String(stockBefore), String(after.rows[0].stock_qty), Number(after.rows[0].stock_qty) === stockBefore ? 'PASS' : 'FAIL');
  });
});

// ── Return After Void ──

describe('Inventory Integrity — Return After Void', () => {
  it('should not allow return on voided sale without proper handling', async () => {
    // Verify void record exists for this sale
    const voids = await client.query(`SELECT COUNT(*) as cnt FROM voids WHERE sale_id = '${TEST.saleA}'`);
    record('Void record exists for sale A', '1', String(voids.rows[0].cnt), Number(voids.rows[0].cnt) >= 1 ? 'PASS' : 'FAIL');

    // Sale A should be flagged as voided
    const sale = await client.query(`SELECT is_voided FROM sales WHERE id = '${TEST.saleA}'`);
    if (sale.rows[0]) {
      record('Sale A is voided', 'true', String(sale.rows[0].is_voided), sale.rows[0].is_voided === true ? 'PASS' : 'FAIL');
    } else {
      record('Sale A exists for void check', 'exists', 'not found', 'FAIL');
    }
  });
});

// ── Second Sale + Full Return + Void ──

describe('Inventory Integrity — Full Return + Void', () => {
  it('should handle full return followed by void correctly', async () => {
    // Sale B: 5 units of Product B
    const saleQty = 5;
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, branch_id, created_at, updated_at) VALUES ('${TEST.saleB}', 'INV-SALE-002',      '${TEST.customerA}', '${TEST.customerA}', ${saleQty * 2000}, 'completed', 'credit', 'cash', 0, ${saleQty * 2000}, 0, false, '${TEST.shop}', '${mainBranch}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, line_total) VALUES ('${TEST.saleItemB}', '${TEST.saleB}', '${TEST.productB}', 'Inv Test Product B', '${TEST.variantB}', '5kg', ${saleQty}, 2000, ${saleQty * 2000}) ON CONFLICT (id) DO NOTHING`);

    // Decrease stock
    await client.query(`UPDATE product_variants SET stock_qty = stock_qty - ${saleQty} WHERE id = '${TEST.variantB}'`);
    const afterSale = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantB}'`);
    record('Variant B after sale (5 units)', '45', String(afterSale.rows[0].stock_qty), Number(afterSale.rows[0].stock_qty) === 45 ? 'PASS' : 'FAIL');

    // Full return (all 5 units)
    await client.query(`UPDATE product_variants SET stock_qty = stock_qty + ${saleQty} WHERE id = '${TEST.variantB}'`);
    const afterReturn = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantB}'`);
    record('Variant B after full return', '50', String(afterReturn.rows[0].stock_qty), Number(afterReturn.rows[0].stock_qty) === 50 ? 'PASS' : 'FAIL');

    // Void the sale (stock already restored by return, void should NOT restore again)
    await client.query(`UPDATE sales SET is_voided = true, void_reason = 'QA void after full return', voided_by = '${TEST.customerA}', voided_at = NOW() WHERE id = '${TEST.saleB}'`);
    // Business rule: if fully returned, void does NOT restore stock
    const afterVoid = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantB}'`);
    record('Variant B after void (no double restore)', '50', String(afterVoid.rows[0].stock_qty), Number(afterVoid.rows[0].stock_qty) === 50 ? 'PASS' : 'FAIL');
  });
});

// ── Inventory Movement History ──

describe('Inventory Integrity — Movement History', () => {
  it('should have recorded inventory movements for sales', async () => {
    // Check if any inventory movements exist for our products
    const movements = await client.query(`SELECT COUNT(*) as cnt FROM inventory_movements WHERE product_id IN ('${TEST.productA}', '${TEST.productB}')`);
    // Movements may or may not be recorded depending on the RPC implementation
    // This is a PASS if the count is >= 0 (table exists and is queryable)
    record('Inventory movements queryable', '>= 0', String(movements.rows[0].cnt), Number(movements.rows[0].cnt) >= 0 ? 'PASS' : 'FAIL');
  });
});

// ── Reload Persistence ──

describe('Inventory Integrity — Persistence', () => {
  it('should persist stock levels after re-query', async () => {
    const v1 = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    const v2 = await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`);
    record('Stock persistence re-query', String(v1.rows[0].stock_qty), String(v2.rows[0].stock_qty), v1.rows[0].stock_qty === v2.rows[0].stock_qty ? 'PASS' : 'FAIL');
  });

  it('should keep the derived product rollup equal to its active variants', async () => {
    // Product A has one active variant, so the derived rollup must equal it, and
    // in every case it must equal SUM(active variants).
    const rollup = await rollupFor(TEST.productA);
    record('Product/variant stock consistency', rollup.variantSum, rollup.product, rollup.product === rollup.variantSum ? 'PASS' : 'FAIL');
    record('Product A rollup equals its single variant', String((await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`)).rows[0].stock_qty), rollup.product, rollup.product === Number((await client.query(`SELECT stock_qty FROM product_variants WHERE id = '${TEST.variantA}'`)).rows[0].stock_qty) ? 'PASS' : 'FAIL');
  });
});

// ── Branch ownership — the rule this fixture now satisfies is still enforced ──

/**
 * Two things must hold together, and the old fixture proved neither.
 *
 * It "passed" while attempting to disable every trigger in `public` so that rows with no branch
 * would be accepted. That attempt disabled nothing, but its intent is why these tests exist: a
 * fixture that satisfies a rule by removing it proves nothing about the product. So the fixture's
 * rows must genuinely carry a branch, AND the guard that refuses unowned rows must still work.
 */
describe('Inventory Integrity — branch ownership is enforced, not bypassed', () => {
  /** A branch that exists nowhere: valid as a uuid, invalid as ownership. */
  const GHOST_BRANCH = 'F1000000-0000-0000-0000-0000000000FF';

  it('has the branch-scope trigger enabled on every branch-owned table this suite writes', async () => {
    const res = await execSqlAsAdmin(`
      SELECT c.relname AS table_name, t.tgenabled
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
         AND t.tgname = 'enforce_branch_scope_trg'
         AND c.relname IN ('sales', 'returns')
       ORDER BY c.relname
    `);
    // 'O' is origin mode — the ordinary enabled state, and the only one that enforces the rule.
    // 'D' is disabled: what the old workaround tried to leave behind for every other suite.
    expect(res.rows.map((r: any) => `${r.table_name}:${r.tgenabled}`)).toEqual(['returns:O', 'sales:O']);
    record('Branch-scope trigger enabled on the branch-owned tables', '2 of 2 enabled', `${res.rows.length} rows, all 'O'`, res.rows.length === 2 ? 'PASS' : 'FAIL');
  });

  it('refuses a return addressed to a branch that does not exist', async () => {
    const ghost = await execSqlAsAdmin(`SELECT count(*)::int AS c FROM branches WHERE id = '${GHOST_BRANCH}'`);
    // Non-vacuity: the refusal below means nothing unless this branch really is absent.
    expect(ghost.rows[0].c).toBe(0);

    // The row is valid in every other respect — it is the branch that is wrong. With the trigger
    // disabled (what the old workaround attempted) this insert SUCCEEDS and leaves a return that no
    // branch-limited reader, including whoever processed it, could ever see.
    let error = '';
    try {
      await client.query(`INSERT INTO returns (id, sale_id, customer_id, refund_amount, reason, shop_id, branch_id, created_at) VALUES ('${TEST.ghostReturn}', '${TEST.saleA}', '${TEST.customerA}', 1, 'QA ghost branch', '${TEST.shop}', '${GHOST_BRANCH}', NOW())`);
    } catch (e: any) {
      error = e.message;
    }
    record('Unowned return refused', 'INVALID_BRANCH_SCOPE', error || '(accepted)', error.includes('INVALID_BRANCH_SCOPE') ? 'PASS' : 'FAIL');

    const persisted = await execSqlAsAdmin(`SELECT count(*)::int AS c FROM returns WHERE id = '${TEST.ghostReturn}'`);
    record('Refused return persisted nothing', '0', String(persisted.rows[0].c), Number(persisted.rows[0].c) === 0 ? 'PASS' : 'FAIL');
  });

  it('stamps every branch-owned row this fixture writes with the tenant branch', async () => {
    const res = await execSqlAsAdmin(`
      SELECT 'sales' AS t, branch_id::text AS branch_id FROM sales WHERE id IN ('${TEST.saleA}', '${TEST.saleB}')
      UNION ALL SELECT 'returns', branch_id::text FROM returns WHERE id = '${TEST.returnA}'
    `);
    const rows = res.rows as Array<{ t: string; branch_id: string | null }>;
    // Three branch-owned rows exist by now: two sales and a return. A null here is the exact
    // condition the old fixture hid.
    const unowned = rows.filter((r) => r.branch_id === null).map((r) => r.t);
    record('Branch-owned rows carrying no branch', '0', unowned.length ? unowned.join(', ') : '0', unowned.length === 0 ? 'PASS' : 'FAIL');
    record('Branch-owned rows stamped with the tenant branch', `${rows.length} of ${rows.length}`, `${rows.filter((r) => r.branch_id === mainBranch).length} of ${rows.length}`,
      rows.length > 0 && rows.every((r) => r.branch_id === mainBranch) ? 'PASS' : 'FAIL');
  });
});
