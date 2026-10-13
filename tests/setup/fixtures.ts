/**
 * QA Test Fixtures
 *
 * Creates controlled test data with deterministic IDs.
 * Every fixture has setup, cleanup, and verification.
 * Never leaves QA records behind.
 *
 * Uses execSqlAsAdmin which now routes through direct PG connection,
 * bypassing PgBouncer pooler visibility issues.
 */

import { execSqlAsAdmin, qaServiceClient } from './qa-client';

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
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, role = EXCLUDED.role, is_active = EXCLUDED.is_active;
  `);
}

export async function setupCustomers() {
  // No DELETE before the insert. Deleting first opened a window in which a
  // parallel suite that shares these fixtures saw CUSTOMER_NOT_FOUND; the
  // upsert below already resets every value that matters, so re-seeding is
  // atomic for concurrent readers.
  await execSqlAsAdmin(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES
      ('${QA_IDS.customerA}', 'QA Customer A', '923001111111', 50000, 30000, 80000, 50000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerB}', 'QA Customer B', '923002222222', 25000, 26000, 40000, 14000, '${QA_IDS.shop}', 'QA'),
      ('${QA_IDS.customerC}', 'QA Customer C', '923003333333', 10000, 0, 15000, 15000, '${QA_IDS.shop}', 'QA')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, credit_limit = EXCLUDED.credit_limit,
      outstanding_balance = EXCLUDED.outstanding_balance, total_purchases = EXCLUDED.total_purchases,
      total_paid = EXCLUDED.total_paid;
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

/** Setup all fixtures and wait for PostgREST pooler visibility */
export async function setupAllFixtures() {
  await setupUsers();
  await setupCompanies();
  await setupCustomers();
  await setupProducts();
  // Wait for PostgREST pooler to see the new data
  await waitForPostgRESTVisibility();
}

/**
 * Wait for PostgREST to see critical fixture records.
 * Direct PG commits are immediate, but PostgREST pooler may delay.
 * Poll via PostgREST until customerC is visible.
 */
async function waitForPostgRESTVisibility(maxRetries = 10, delayMs = 300): Promise<void> {
  // Use advisory lock as synchronization barrier: forces all PostgREST connections
  // to commit pending transactions before proceeding
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await qaServiceClient.rpc('run_sql', { sql_query: 'SELECT pg_advisory_lock(42)' });
      await qaServiceClient.rpc('run_sql', { sql_query: 'SELECT pg_advisory_unlock(42)' });
      break;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  // Also poll for visibility as a safety net
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { data, error } = await qaServiceClient
        .from('customers')
        .select('id')
        .eq('id', QA_IDS.customerC)
        .single();
      if (data && !error) return;
    } catch { /* not visible yet */ }
    await new Promise(r => setTimeout(r, delayMs));
  }
}

// ─── Cleanup Functions ───────────────────────────────────────────────────

export async function cleanupTestData() {
  const customerIds = `('${QA_IDS.customerA}', '${QA_IDS.customerB}', '${QA_IDS.customerC}')`;

  const childDeletes = [
    `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customerIds})`,
    `DELETE FROM sales WHERE customer_id IN ${customerIds}`,
    `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id IN ${customerIds})`,
    `DELETE FROM returns WHERE customer_id IN ${customerIds}`,
    `DELETE FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${customerIds})`,
    `DELETE FROM customer_payments WHERE customer_id IN ${customerIds}`,
    `DELETE FROM credit_limit_requests WHERE customer_id IN ${customerIds}`,
    `DELETE FROM inventory_movements WHERE product_id IN ('${QA_IDS.productA}', '${QA_IDS.productB}')`,
    // Reminder rows must be scoped to the fixtures this helper owns. Unscoped
    // whole-table deletes wiped a *parallel* suite's reminder config mid-test:
    // tenantIsolationOps then failed with "insert or update on table
    // reminder_occurrences violates foreign key constraint
    // reminder_occurrences_config_id_fkey", intermittently, ~1 run in 3.
    `DELETE FROM reminder_logs WHERE config_id IN (SELECT id FROM reminder_configs WHERE customer_id IN ${customerIds})`,
    `DELETE FROM reminder_occurrences WHERE customer_id IN ${customerIds}`,
    `DELETE FROM reminder_configs WHERE customer_id IN ${customerIds}`,
  ];

  for (const sql of childDeletes) {
    try { await execSqlAsAdmin(sql); } catch { /* ignore */ }
  }

  // The seeded identities (users, customers, products, company) are a SHARED
  // baseline: several suites seed them through setupAllFixtures() and run in
  // parallel in the same QA database. Deleting them here made a finishing suite
  // wipe fixtures another suite was still using, which surfaced as unrelated
  // failures such as CUSTOMER_NOT_FOUND. Only transactional children are
  // removed, so suites stay isolated without destroying the shared baseline.
}

/**
 * Remove fixture users the way the product removes people.
 *
 * WHY THIS EXISTS. `audit_events.user_id` is a plain NO ACTION foreign key, and migrations 0189/0192
 * gave the system several new audit writers. A fixture user who has done anything audited therefore
 * cannot be deleted — and because a multi-row `DELETE … WHERE id IN (…)` is atomic, ONE blocked row
 * leaves EVERY user in the list behind. The error then vanished into a `.catch(() => undefined)`, so
 * the shared QA database quietly accumulated undeletable users and `rbacInvariants` invariant D
 * ("no long-lived user with a shop but no membership") was failing against residue rather than a
 * schema property. Measured on QA 2026-10-13: two users from exactly that path, with four
 * `location_updated` audit rows and zero memberships between them.
 *
 * The order below is not invented — it is `delete_my_account()`'s own order, which already clears
 * every referencing column and row before it touches `users`. That is what account deletion does, so
 * it is what a fixture should leave behind too: no blocking row, and no invented attribution.
 *
 * The read-back matters as much as the delete. This helper throws rather than reporting success over
 * a user that is still there, because that silence is what hid the problem.
 *
 * It deliberately does not pretend to cover every NO ACTION reference (`sales.employee_id`,
 * `voids.voided_by`, `stock_adjustments`, …): a fixture that owns a transaction owns that row's
 * removal, and the read-back names the survivors when it does not.
 */
export async function deleteFixtureUsers(userIds: string[]): Promise<void> {
  if (!userIds.length) return;
  const list = userIds.map((id) => `'${id}'`).join(', ');
  const statements = [
    `UPDATE returns SET processed_by = NULL WHERE processed_by IN (${list})`,
    `UPDATE inventory_movements SET created_by = NULL WHERE created_by IN (${list})`,
    `UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by IN (${list})`,
    `UPDATE user_permissions SET granted_by = NULL WHERE granted_by IN (${list})`,
    `UPDATE users SET created_by = NULL WHERE created_by IN (${list})`,
    `DELETE FROM audit_events WHERE user_id IN (${list})`,
    `DELETE FROM activity_log WHERE user_id IN (${list})`,
    `DELETE FROM branch_responsibility WHERE user_id IN (${list})`,
    `DELETE FROM user_permissions WHERE user_id IN (${list})`,
    `DELETE FROM memberships WHERE user_id IN (${list})`,
    `DELETE FROM user_active_shops WHERE user_id IN (${list})`,
    `DELETE FROM users WHERE id IN (${list})`,
  ];
  for (const statement of statements) await execSqlAsAdmin(statement);

  const left = await execSqlAsAdmin(`SELECT count(*)::int AS n FROM users WHERE id IN (${list})`);
  const remaining = Number(left.rows?.[0]?.n ?? 0);
  if (remaining > 0) {
    throw new Error(
      `[QA FIXTURE] ${remaining} fixture user(s) survived deletion: ${userIds.join(', ')}. ` +
        'A foreign key is blocking them — find it rather than widening this helper.',
    );
  }
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
