/**
 * QA Test Fixtures
 *
 * Creates controlled test data with deterministic IDs.
 * Every fixture has setup, cleanup, and verification.
 * Never leaves QA records behind.
 */

import { execSql } from './qa-client';

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
  await execSql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', true, true, '${QA_IDS.shop}'),
      ('${QA_IDS.employee}', 'QA Employee', '923008888888', 'employee', false, true, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;
  `);
}

export async function setupCustomers() {
  // Delete any existing customers with our test phone numbers (handles unique phone constraint)
  await execSql(`DELETE FROM customers WHERE phone IN ('923001111111', '923002222222', '923003333333')`);
  await execSql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${QA_IDS.customerA}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerB}', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerC}', 'QA Customer C', '923003333333', 10000, 0, 15000, 15000, '${QA_IDS.shop}', 'QA')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);
}

export async function setupProducts() {
  await execSql(`
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
  await execSql(`
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
  const tables = [
    'reminder_logs', 'reminder_occurrences', 'reminder_configs',
    'credit_limit_requests', 'return_items', 'returns',
    'sale_items', 'sales', 'customer_payments', 'payments',
    'supplier_payments', 'inventory_movements', 'stock_adjustments',
    'purchase_items', 'purchases', 'audit_events', 'activity_log',
    'customer_crops', 'notifications', 'voids',
  ];

  for (const table of tables) {
    try {
      await execSql(`DELETE FROM ${table}`);
    } catch { /* ignore */ }
  }

  try {
    await execSql(`DELETE FROM customers WHERE id IN ('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')`);
    await execSql(`DELETE FROM product_variants WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM products WHERE id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM companies WHERE id IN ('${QA_IDS.companyA}')`);
    await execSql(`DELETE FROM users WHERE id IN ('${QA_IDS.admin}', '${QA_IDS.employee}')`);
  } catch { /* ignore */ }
}

// ─── Verification Functions ──────────────────────────────────────────────

export async function getTableCount(table: string): Promise<number> {
  const result = await execSql(`SELECT count(*) as n FROM ${table}`);
  return parseInt(result.rows[0].n);
}

export async function getTableRow(table: string, where: string): Promise<Record<string, any> | null> {
  const result = await execSql(`SELECT * FROM ${table} WHERE ${where} LIMIT 1`);
  return result.rows[0] || null;
}
