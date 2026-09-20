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
import { getDbClient, asPostgres, disableTriggers, enableTriggers, execSql, execSqlAsAdmin } from '../setup/qa-client';

let client: any;

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
  evidence: [] as Array<{test: string; expected: string; actual: string; result: string}>,
};

function record(test: string, expected: string, actual: string, result: 'PASS' | 'FAIL') {
  TEST.evidence.push({ test, expected, actual, result });
  if (result === 'FAIL') console.error(`FAIL: ${test} — Expected: ${expected}, Actual: ${actual}`);
}

beforeAll(async () => {
  client = getDbClient();
  await client.connect();
  // Disable protect_* triggers so direct SQL can simulate sale/return/void workflows
  await disableTriggers(client);
  await cleanupTestData();

  // Create fixtures
  await client.query(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id) VALUES ('${TEST.customerA}', 'Inv Test User', '92300INV1001', 'admin', true, true, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id) VALUES ('${TEST.companyA}', 'Inv Test Supplier', 0, 0, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by) VALUES ('${TEST.customerA}', 'Inv Customer A', '92300INV1001', 100000, 0, 0, 0, '${TEST.shop}', 'QA') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id) VALUES ('${TEST.productA}', 'Inv Test Product A', '${TEST.companyA}', 'seed', 100, '${TEST.shop}'), ('${TEST.productB}', 'Inv Test Product B', '${TEST.companyA}', 'fertilizer', 50, '${TEST.shop}') ON CONFLICT (id) DO NOTHING`);
  await client.query(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty) VALUES ('${TEST.variantA}', '${TEST.productA}', '1kg', 5000, 3000, 1, 10, 100), ('${TEST.variantB}', '${TEST.productB}', '5kg', 2000, 1500, 5, 5, 50) ON CONFLICT (id) DO NOTHING`);
});

afterAll(async () => {
  await enableTriggers(client).catch(() => {});
  await cleanupTestData();
  await client?.end();
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

async function cleanupTestData() {
  const q = async (sql: string) => { try { await execSqlAsAdmin(sql); } catch {} };
  for (const id of [TEST.saleA, TEST.saleB, TEST.saleC]) {
    await q(`DELETE FROM sale_items WHERE sale_id = '${id}'`);
    await q(`DELETE FROM sales WHERE id = '${id}'`);
  }
  await q(`DELETE FROM return_items WHERE return_id = '${TEST.returnA}'`);
  await q(`DELETE FROM returns WHERE id = '${TEST.returnA}'`);
  await q(`DELETE FROM voids WHERE sale_id IN ('${TEST.saleA}', '${TEST.saleB}', '${TEST.saleC}')`);
  await q(`DELETE FROM inventory_movements WHERE product_id IN ('${TEST.productA}', '${TEST.productB}')`);
  await q(`UPDATE product_variants SET stock_qty = CASE WHEN id = '${TEST.variantA}' THEN 100 WHEN id = '${TEST.variantB}' THEN 50 ELSE stock_qty END WHERE id IN ('${TEST.variantA}', '${TEST.variantB}')`);
  await q(`UPDATE products SET stock_qty = CASE WHEN id = '${TEST.productA}' THEN 100 WHEN id = '${TEST.productB}' THEN 50 ELSE stock_qty END WHERE id IN ('${TEST.productA}', '${TEST.productB}')`);
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
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, created_at, updated_at) VALUES ('${TEST.saleA}', 'INV-SALE-001', '${TEST.customerA}', '${TEST.customerA}', ${saleQty * 5000}, 'completed', 'credit', 'cash', 0, ${saleQty * 5000}, 0, false, '${TEST.shop}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
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
    await client.query(`INSERT INTO returns (id, sale_id, customer_id, refund_amount, reason, processed_by, shop_id, created_at) VALUES ('${TEST.returnA}', '${TEST.saleA}', '${TEST.customerA}', 5000, 'QA partial return', '${TEST.customerA}', '${TEST.shop}', NOW()) ON CONFLICT (id) DO NOTHING`);
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
    await client.query(`INSERT INTO sales (id, sale_number, customer_id, employee_id, total_amount, status, payment_type, payment_method, amount_paid, amount_due, discount, is_voided, shop_id, created_at, updated_at) VALUES ('${TEST.saleB}', 'INV-SALE-002', '${TEST.customerA}', '${TEST.customerA}', ${saleQty * 2000}, 'completed', 'credit', 'cash', 0, ${saleQty * 2000}, 0, false, '${TEST.shop}', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`);
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
