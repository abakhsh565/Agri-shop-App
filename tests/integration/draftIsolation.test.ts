/**
 * Draft QA Data Isolation Proof
 *
 * Proves two drafts' test data are independently isolated in the shared QA DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSqlAsAdmin } from '../setup/qa-client';

const CO_A = '00000000-0000-0000-0000-aabbccdd0010';
const CO_B = '00000000-0000-0000-0000-bbccddee0010';
const CUST_A = '00000000-0000-0000-0000-aabbccdd0001';
const CUST_B = '00000000-0000-0000-0000-bbccddee0002';
const PROD_A = '00000000-0000-0000-0000-aabbccdd0003';
const PROD_B = '00000000-0000-0000-0000-bbccddee0004';

const SHOP = '00000000-0000-0000-0000-000000000001';

async function q(sql: string) {
  return execSqlAsAdmin(sql);
}

describe('Draft QA Data Isolation', () => {
  beforeAll(async () => {
    // Clean
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
  });

  afterAll(async () => {
    await q(`DELETE FROM products WHERE id IN ('${PROD_A}','${PROD_B}')`);
    await q(`DELETE FROM companies WHERE id IN ('${CO_A}','${CO_B}')`);
    await q(`DELETE FROM customers WHERE id IN ('${CUST_A}','${CUST_B}')`);
  });

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

  it('Draft A cleanup: removes A customer+product+company, B survives', async () => {
    await q(`DELETE FROM products WHERE id = '${PROD_A}'`);
    await q(`DELETE FROM companies WHERE id = '${CO_A}'`);
    await q(`DELETE FROM customers WHERE id = '${CUST_A}'`);

    // A gone
    expect((await q(`SELECT id FROM customers WHERE id = '${CUST_A}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM products WHERE id = '${PROD_A}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM companies WHERE id = '${CO_A}'`)).rows.length).toBe(0);

    // B alive
    const custB = await q(`SELECT name FROM customers WHERE id = '${CUST_B}'`);
    expect(custB.rows.length).toBe(1);
    expect(custB.rows[0].name).toContain('[draft-b]');

    const prodB = await q(`SELECT stock_qty FROM products WHERE id = '${PROD_B}'`);
    expect(prodB.rows.length).toBe(1);
    expect(Number(prodB.rows[0].stock_qty)).toBe(200);
  });

  it('Draft B cleanup: removes all B data', async () => {
    await q(`DELETE FROM products WHERE id = '${PROD_B}'`);
    await q(`DELETE FROM companies WHERE id = '${CO_B}'`);
    await q(`DELETE FROM customers WHERE id = '${CUST_B}'`);

    expect((await q(`SELECT id FROM customers WHERE id = '${CUST_B}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM products WHERE id = '${PROD_B}'`)).rows.length).toBe(0);
    expect((await q(`SELECT id FROM companies WHERE id = '${CO_B}'`)).rows.length).toBe(0);
  });

  it('QA baseline clean: no draft data remains', async () => {
    const rC = await q(`SELECT count(*) as cnt FROM customers WHERE id IN ('${CUST_A}','${CUST_B}')`);
    expect(Number(rC.rows[0].cnt)).toBe(0);
    const rP = await q(`SELECT count(*) as cnt FROM products WHERE id IN ('${PROD_A}','${PROD_B}')`);
    expect(Number(rP.rows[0].cnt)).toBe(0);
    const rCo = await q(`SELECT count(*) as cnt FROM companies WHERE id IN ('${CO_A}','${CO_B}')`);
    expect(Number(rCo.rows[0].cnt)).toBe(0);
  });
});
