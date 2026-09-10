/**
 * E2E Test Helpers
 *
 * Provides auth injection, QA DB setup/teardown, and evidence collection
 * for Playwright browser tests.
 */

import { type Page, type TestInfo } from '@playwright/test';

// QA DB credentials (matches tests/setup/qa-client.ts)
const QA_URL = 'https://bpybjrjenwccowvtrevu.supabase.co';
const QA_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4OTAyNjU3MiwiZXhwIjoyMTA0NjAyNTcyfQ.QHa62c7sOzuQCj3fiyIPDXNhk0C1wox-FVcBfA3SJnY';
const QA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjY1NzIsImV4cCI6MjEwNDYwMjU3Mn0.nHzYWdjmZ_TEp_2mzqeinCNoXeLvVdvOETgvJXxldS0';

const QA_DB_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';
const QA_DB_USER = 'postgres.bpybjrjenwccowvtrevu';
const QA_DB_PASS = 'LptUWZQm4TZrRksv4nAtFUHk3YG6rO';

/** Test user IDs */
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

/**
 * Execute raw SQL against the QA database via HTTP API.
 * Uses the REST approach — direct SQL via pg client.
 */
export async function execSql(sql: string): Promise<any[]> {
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: `postgresql://${QA_DB_USER}:${QA_DB_PASS}@${QA_DB_HOST}:6543/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const result = await client.query(sql);
    return result.rows;
  } finally {
    await client.end();
  }
}

/** Execute SQL via Supabase REST (anon client, respects RLS) */
export async function supabaseAnon(sql: string): Promise<any> {
  const resp = await fetch(`${QA_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': QA_ANON_KEY,
      'Authorization': `Bearer ${QA_ANON_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });
  return resp.json();
}

/** Inject admin auth state into the page's localStorage */
export async function injectAdminAuth(page: Page) {
  const adminUser = {
    id: QA_IDS.admin,
    name: 'QA Admin',
    phone: '923009999999',
    role: 'admin',
    isOriginalOwner: true,
    pin: '1234',
    isActive: true,
    firstLoginAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
    deactivatedAt: null,
    deactivatedBy: null,
    createdAt: new Date().toISOString(),
    createdBy: null,
  };

  await page.evaluate((user) => {
    // Set Zustand persist auth state
    localStorage.setItem('agri_auth', JSON.stringify({
      state: { user },
      version: 0,
    }));
    // Clear any signal suppression state
    localStorage.removeItem('signal_suppression');
    localStorage.removeItem('signal_reviewed');
  }, adminUser);
}

/** Setup QA test fixtures via direct DB */
export async function setupFixtures() {
  await execSql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', true, true, '${QA_IDS.shop}'),
      ('${QA_IDS.employee}', 'QA Employee', '923008888888', 'employee', false, true, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;
  `);

  await execSql(`
    INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
    VALUES ('${QA_IDS.companyA}', 'QA Supplier A', 15000, 50000, '${QA_IDS.shop}')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);

  await execSql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${QA_IDS.customerA}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerB}', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerC}', 'QA Customer C', '923003333333', 10000, 0, 15000, 15000, '${QA_IDS.shop}', 'QA')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
  `);

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

/** Cleanup all QA test data */
export async function cleanupFixtures() {
  const tables = [
    'reminder_logs', 'reminder_occurrences', 'reminder_configs',
    'credit_limit_requests', 'return_items', 'returns',
    'sale_items', 'sales', 'customer_payments', 'payments',
    'supplier_payments', 'inventory_movements', 'stock_adjustments',
    'purchase_items', 'purchases', 'audit_events', 'activity_log',
    'customer_crops', 'notifications', 'voids',
  ];

  for (const table of tables) {
    try { await execSql(`DELETE FROM ${table}`); } catch { /* skip */ }
  }

  try {
    await execSql(`DELETE FROM customers WHERE id IN ('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')`);
    await execSql(`DELETE FROM product_variants WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM products WHERE id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`);
    await execSql(`DELETE FROM companies WHERE id IN ('${QA_IDS.companyA}')`);
    await execSql(`DELETE FROM users WHERE id IN ('${QA_IDS.admin}', '${QA_IDS.employee}')`);
  } catch { /* skip */ }
}

/** Record a test result for the evidence report */
export interface TestEvidence {
  name: string;
  expected: string;
  actual: string;
  result: 'PASS' | 'FAIL' | 'UNTESTED';
  source: string;
  timestamp: string;
}

export function recordEvidence(name: string, expected: string, actual: string, result: 'PASS' | 'FAIL' | 'UNTESTED', source: string): TestEvidence {
  return { name, expected, actual, result, source, timestamp: new Date().toISOString() };
}

/** Write evidence report */
export function writeEvidenceReport(evidence: TestEvidence[], testInfo: TestInfo) {
  const passed = evidence.filter(e => e.result === 'PASS').length;
  const failed = evidence.filter(e => e.result === 'FAIL').length;
  const untested = evidence.filter(e => e.result === 'UNTESTED').length;

  const report = `
=== E2E TEST EVIDENCE REPORT ===
Test: ${testInfo.title}
File: ${testInfo.file}
Duration: ${testInfo.duration}ms
Environment: QA Database (bpybjrjenwccowvtrevu)
Timestamp: ${new Date().toISOString()}

Results: ${passed} PASS, ${failed} FAIL, ${untested} UNTESTED (of ${evidence.length})

${evidence.map(e => `[${e.result}] ${e.name}\n  Expected: ${e.expected}\n  Actual:   ${e.actual}\n  Source:   ${e.source}`).join('\n\n')}
`;

  console.log(report);
}
