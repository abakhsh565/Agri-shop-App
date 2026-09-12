/**
 * QA Test Fixtures
 *
 * Creates controlled test data with deterministic IDs.
 * Every fixture has setup, cleanup, and verification.
 * Never leaves QA records behind.
 */

import { execSqlAsAdmin, execSql } from './qa-client';

// ─── Deterministic Test IDs ──────────────────────────────────────────────

export const QA_IDS = {
  shop: '00000000-0000-0000-0000-000000000001',
  admin: '10000000-0000-0000-0000-000000000001',
  employee: '10000000-0000-0000-0000-000000000002',
  customerA: '20000000-0000-0000-0000-000000000001',
  customerB: '20000000-0000-0000-0000-000000000002',
  customerC: '20000000-0000-0000-0000-000000000003',
  productA: '30000000-0000-0000-0000-000000000001',
  productB: '30000000-0000-0000-0000-000000000002',
  variantA: '40000000-0000-0000-0000-000000000001',
  variantB: '40000000-0000-0000-0000-000000000002',
  companyA: '50000000-0000-0000-0000-000000000001',
} as const;

// ─── Setup Functions ─────────────────────────────────────────────────────

export async function setupUsers() {
  await execSqlAsAdmin(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', true, true, '${QA_IDS.shop}'),
      ('${QA_IDS.employee}', 'QA Employee', '923008888888', 'employee', false, true, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;
  `);
}

export async function setupCustomers() {
  // Delete any FK-referencing records first, then customers with our test phone numbers
  await execSqlAsAdmin(`DELETE FROM credit_limit_requests WHERE customer_id IN (SELECT id FROM customers WHERE phone IN ('923001111111', '923002222222', '923003333333'))`);
  await execSqlAsAdmin(`DELETE FROM customers WHERE phone IN ('923001111111', '923002222222', '923003333333')`);
  await execSqlAsAdmin(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${QA_IDS.customerA}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerB}', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerC}', 'QA Customer C', '923003333333', 10000, 0, 15000, 15000, '${QA_IDS.shop}', 'QA')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
}

export async function setupProducts() {
  await execSqlAsAdmin(`
    INSERT INTO products (id, name, company_id, category, stock_qty, shop_id)
    VALUES
      ('${QA_IDS.productA}', 'QA Product A', '${QA_IDS.companyA}', 'seed', 100, '${QA_IDS.shop}'),
      ('${QA_IDS.productB}', 'QA Product B', '${QA_IDS.companyA}', 'fertilizer', 0, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
    VALUES
      ('${QA_IDS.variantA}', '${QA_IDS.productA}', '1kg', 500, 300, 1, 10, 100),
      ('${QA_IDS.variantB}', '${QA_IDS.productB}', '5kg', 2000, 1500, 5, 5, 0)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
}

export async function setupCompanies() {
  await execSqlAsAdmin(`
    INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
    VALUES
      ('${QA_IDS.companyA}', 'QA Supplier A', 15000, 50000, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
}

/** Setup all fixtures */
export async function setupAllFixtures() {
  await setupUsers();
  await setupCompanies();
  await setupCustomers();
  await setupProducts();
}

// ─── Cleanup Functions ───────────────────────────────────────────────────

export async function cleanupTestData() {
  // Only delete QA fixture data — not all data in the table
  const customerIds = `('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')`;
  const userIds = `('${QA_IDS.admin}', '${QA_IDS.employee}')`;

  // Delete child records that reference QA customers/products/users
  const childDeletes = [
    `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customerIds})`,
    `DELETE FROM sales WHERE customer_id IN ${customerIds}`,
    `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id IN ${customerIds})`,
    `DELETE FROM returns WHERE customer_id IN ${customerIds}`,
    `DELETE FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customerIds})`,
    `DELETE FROM customer_payments WHERE customer_id IN ${customerIds}`,
    `DELETE FROM credit_limit_requests WHERE customer_id IN ${customerIds}`,
    `DELETE FROM inventory_movements WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`,
    `DELETE FROM reminder_logs`,
    `DELETE FROM reminder_occurrences`,
    `DELETE FROM reminder_configs`,
  ];

  for (const sql of childDeletes) {
    try { await execSqlAsAdmin(sql); } catch { /* ignore */ }
  }

  // Delete parent records
  try { await execSqlAsAdmin(`DELETE FROM product_variants WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`); } catch {}
  try { await execSqlAsAdmin(`DELETE FROM products WHERE id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`); } catch {}
  try { await execSqlAsAdmin(`DELETE FROM companies WHERE id IN ('${QA_IDS.companyA}')`); } catch {}
  try { await execSqlAsAdmin(`DELETE FROM customers WHERE id IN ${customerIds}`); } catch {}
  try { await execSqlAsAdmin(`DELETE FROM users WHERE id IN ${userIds}`); } catch {}
}

// ─── Verification Functions ──────────────────────────────────────────────

export async function getTableCount(table: string): Promise<number> {
  const result = await execSqlAsAdmin(`SELECT count(*) as n FROM ${table}`);
  return parseInt(result.rows[0].n);
}

export async function getTableRow(table: string, where: string): Promise<Record<string, any> | null> {
  const result = await execSqlAsAdmin(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`);
  return result.rows[0] || null;
}
