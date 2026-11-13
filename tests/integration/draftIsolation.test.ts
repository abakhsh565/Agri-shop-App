/**
 * Draft QA Data Isolation Proof
 *
 * Proves two drafts' test data are independently isolated in the shared QA DB.
 * Tests both cleanup isolation AND operational isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSqlAsAdmin } from '../setup/qa-client';

const CO_A = '00000000-0000-0000-0000-aabbccdd0010';
const CO_B = '00000000-0000-0000-0000-bbccddee0010';
const CUST_A = '00000000-0000-0000-0000-aabbccdd0001';
const CUST_B = '00000000-0000-0000-0000-bbccddee0002';
const PROD_A = '00000000-0000-0000-0000-aabbccdd0003';
const PROD_B = '00000000-0000-0000-0000-bbccddee0004';
const VAR_A = '00000000-0000-0000-0000-aabbccdd0005';
const VAR_B = '00000000-0000-0000-0000-bbccddee0006';

const SHOP = '00000000-0000-0000-0000-000000000001';

async function q(sql: string) {
  return execSqlAsAdmin(sql);
}

describe('Draft QA Data Isolation', () => {
  beforeAll(async () => {
    // Clean — FK-safe order
    for (const t of ['sale_items', 'sales', 'inventory_movements', 'stock_adjustments']) {
      await q(`DELETE FROM ${t} WHERE product_id IN ('${PROD_A}','${PROD_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    }
    await q(`DELETE FROM product_variants WHERE id IN ('${VAR_A}','${VAR_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await q(`DELETE FROM products WHERE id IN ('${PROD_A}','${PROD_B}')`);
    await q(`DELETE FROM companies WHERE id IN ('${CO_A}','${CO_B}')`);
    await q(`DELETE FROM customers WHERE id IN ('${CUST_A}','${CUST_B}')`);

    // Create companies for each draft
    await q(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
      VALUES ('${CO_A}', '[draft-a] Supplier', 0, 0, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
    await q(`INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
      VALUES ('${CO_B}', '[draft-b] Supplier', 0, 0, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);

    // Create customers
    await q(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${CUST_A}', '[draft-a] Customer', '92300000001', 10000, 0, 0, 0, '${SHOP}', 'QA')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
    await q(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${CUST_B}', '[draft-b] Customer', '92300000002', 20000, 0, 0, 0, '${SHOP}', 'QA')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);

    // Create products
    await q(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
      VALUES ('${PROD_A}', '[draft-a] Product', '${CO_A}', 'seed', 100, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true`);
    await q(`INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
      VALUES ('${PROD_B}', '[draft-b] Product', '${CO_B}', 'seed', 200, '${SHOP}')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true`);

    // Create product variants
    await q(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
      VALUES ('${VAR_A}', '${PROD_A}', '1kg', 5000, 3000, 1, 10, 100)
      ON CONFLICT (id) DO UPDATE SET stock_qty = EXCLUDED.stock_qty`);
    await q(`INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
      VALUES ('${VAR_B}', '${PROD_B}', '1kg', 8000, 5000, 1, 10, 200)
      ON CONFLICT (id) DO UPDATE SET stock_qty = EXCLUDED.stock_qty`);
      throwIfCleanupFailed('Draft QA Data Isolation beforeAll cleanup');
});

  afterAll(async () => {
    for (const t of ['sale_items', 'sales', 'inventory_movements', 'stock_adjustments']) {
      await q(`DELETE FROM ${t} WHERE product_id IN ('${PROD_A}','${PROD_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    }
    await q(`DELETE FROM product_variants WHERE id IN ('${VAR_A}','${VAR_B}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await q(`DELETE FROM products WHERE id IN ('${PROD_A}','${PROD_B}')`);
    await q(`DELETE FROM companies WHERE id IN ('${CO_A}','${CO_B}')`);
    await q(`DELETE FROM customers WHERE id IN ('${CUST_A}','${CUST_B}')`);
      throwIfCleanupFailed('Draft QA Data Isolation afterAll cleanup');
});

  // ─── PART 1: Basic existence (shared QA DB, both drafts coexist) ───

  it('Draft A customer exists with [draft-a] prefix', async () => {
    const r = await q(`SELECT name FROM customers WHERE id = '${CUST_A}'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].name).toContain('[draft-a]');
  });

  it('Draft B customer exists with [draft-b] prefix', async () => {
    const r = await q(`SELECT name FROM customers WHERE id = '${CUST_B}'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].name).toContain('[draft-b]');
  });

  it('Draft A product has stock_qty=100', async () => {
    const r = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_A}'`);
    expect(r.rows.length).toBe(1);
    expect(Number(r.rows[0].stock_qty)).toBe(100);
  });

  it('Draft B product has stock_qty=200', async () => {
    const r = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_B}'`);
    expect(r.rows.length).toBe(1);
    expect(Number(r.rows[0].stock_qty)).toBe(200);
  });

  // ─── PART 2: Operational isolation — mutations don't cross ───

  it('Draft A modifies its customer — Draft B is unaffected', async () => {
    // Draft A updates its customer credit limit
    await q(`UPDATE customers SET credit_limit = 99999 WHERE id = '${CUST_A}'`);

    // Draft A reads its own update
    const rA = await q(`SELECT credit_limit FROM customers WHERE id = '${CUST_A}'`);
    expect(Number(rA.rows[0].credit_limit)).toBe(99999);

    // Draft B customer is unaffected
    const rB = await q(`SELECT credit_limit FROM customers WHERE id = '${CUST_B}'`);
    expect(Number(rB.rows[0].credit_limit)).toBe(20000);
  });

  it('Draft B modifies its product stock — Draft A is unaffected', async () => {
    // Draft B updates its product stock
    await q(`UPDATE products SET stock_qty = 999 WHERE id = '${PROD_B}'`);

    // Draft B reads its own update
    const rB = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_B}'`);
    expect(Number(rB.rows[0].stock_qty)).toBe(999);

    // Draft A product is unaffected
    const rA = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_A}'`);
    expect(Number(rA.rows[0].stock_qty)).toBe(100);
  });

  it('Draft A modifies its variant — Draft B variant is unaffected', async () => {
    await q(`UPDATE product_variants SET stock_qty = 50 WHERE id = '${VAR_A}'`);

    const rA = await q(`SELECT stock_qty FROM product_variants WHERE id = '${VAR_A}'`);
    expect(Number(rA.rows[0].stock_qty)).toBe(50);

    const rB = await q(`SELECT stock_qty FROM product_variants WHERE id = '${VAR_B}'`);
    expect(Number(rB.rows[0].stock_qty)).toBe(200);
  });

  // ─── PART 3: Cross-query isolation — Draft A cannot see Draft B data ───

  it('Draft A query by [draft-a] prefix returns only A records', async () => {
    const r = await q(`SELECT id, name FROM customers WHERE name LIKE '[draft-a]%'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(CUST_A);
  });

  it('Draft B query by [draft-b] prefix returns only B records', async () => {
    const r = await q(`SELECT id, name FROM customers WHERE name LIKE '[draft-b]%'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].id).toBe(CUST_B);
  });

  it('Draft A prefix query never returns B records', async () => {
    const r = await q(`SELECT name FROM customers WHERE name LIKE '[draft-a]%'`);
    for (const row of r.rows) {
      expect(row.name).not.toContain('[draft-b]');
    }
  });

  // ─── PART 4: Cleanup isolation — removing one draft leaves the other intact ───

  it('Draft A cleanup: removes A customer+product+company+variant, B survives', async () => {
    for (const t of ['sale_items', 'sales', 'inventory_movements', 'stock_adjustments']) {
      await q(`DELETE FROM ${t} WHERE product_id = '${PROD_A}'`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    }
    await trySql('cleanup-3', q(`DELETE FROM sales WHERE customer_id = '${CUST_A}'`));
    await q(`DELETE FROM product_variants WHERE id = '${VAR_A}'`);
    await q(`DELETE FROM products WHERE id = '${PROD_A}'`);
    await q(`DELETE FROM companies WHERE id = '${CO_A}'`);
    await q(`DELETE FROM customers WHERE id = '${CUST_A}'`);

    // A gone
    expect((await q(`SELECT id FROM customers WHERE id = '${CUST_A}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM products WHERE id = '${PROD_A}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM companies WHERE id = '${CO_A}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM product_variants WHERE id = '${VAR_A}'`)).rows.length).toBe(0);

    // B alive
    const custB = await q(`SELECT name, credit_limit FROM customers WHERE id = '${CUST_B}'`);
    expect(custB.rows.length).toBe(1);
    expect(custB.rows[0].name).toContain('[draft-b]');
    expect(Number(custB.rows[0].credit_limit)).toBe(20000);

    const prodB = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_B}'`);
    expect(prodB.rows.length).toBe(1);
    expect(Number(prodB.rows[0].stock_qty)).toBe(999);

    const varB = await q(`SELECT stock_qty FROM product_variants WHERE id = '${VAR_B}'`);
    expect(varB.rows.length).toBe(1);
    expect(Number(varB.rows[0].stock_qty)).toBe(200);
  });

  it('Draft B cleanup: removes all B data', async () => {
    await q(`DELETE FROM product_variants WHERE id = '${VAR_B}'`);
    await q(`DELETE FROM products WHERE id = '${PROD_B}'`);
    await q(`DELETE FROM companies WHERE id = '${CO_B}'`);
    await q(`DELETE FROM customers WHERE id = '${CUST_B}'`);

    expect((await q(`SELECT id FROM customers WHERE id = '${CUST_B}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM products WHERE id = '${PROD_B}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM companies WHERE id = '${CO_B}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM product_variants WHERE id = '${VAR_B}'`)).rows.length).toBe(0);
  });

  it('QA baseline clean: no draft data remains', async () => {
    const rC = await q(`SELECT count(*) as cnt FROM customers WHERE id IN ('${CUST_A}','${CUST_B}')`);
    expect(Number(rC.rows[0].cnt)).toBe(0);
    const rP = await q(`SELECT count(*) as cnt FROM products WHERE id IN ('${PROD_A}','${PROD_B}')`);
    expect(Number(rP.rows[0].cnt)).toBe(0);
    const rCo = await q(`SELECT count(*) as cnt FROM companies WHERE id IN ('${CO_A}','${CO_B}')`);
    expect(Number(rCo.rows[0].cnt)).toBe(0);
    const rV = await q(`SELECT count(*) as cnt FROM product_variants WHERE id IN ('${VAR_A}','${VAR_B}')`);
    expect(Number(rV.rows[0].cnt)).toBe(0);
  });
});
