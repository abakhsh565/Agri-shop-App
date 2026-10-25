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
import { FIXTURE_SQL, QA_FIXTURE_IDS } from './qa-fixtures';
import { planOwnedTransactionCleanup, runCleanupStatements, type OwnedTransactionScope } from './ownedCleanup';

// ─── Deterministic Test IDs ──────────────────────────────────────────────

/**
 * The eleven shared ids — declared once in `./qa-fixtures`, re-exported so the many suites that
 * import `QA_IDS` from here keep working against the same rows the Playwright seeder writes.
 */
export const QA_IDS = QA_FIXTURE_IDS;

// ─── Setup Functions ─────────────────────────────────────────────────────
//
// The VALUES are not restated here. `./qa-fixtures` holds them once, and derives the INSERT column
// list and the conflict-update list from them — which is what closes the measured drift: this file
// used to restore customer balances but only product NAMES, while the E2E seeder restored product
// stock but only customer names. Reseeding must restore every shared column both suites read.

export async function setupUsers() {
  await execSqlAsAdmin(FIXTURE_SQL.users);
}

export async function setupCustomers() {
  // No DELETE before the insert. Deleting first opened a window in which a
  // parallel suite that shares these fixtures saw CUSTOMER_NOT_FOUND; the
  // upsert already resets every declared value, so re-seeding is atomic for
  // concurrent readers.
  await execSqlAsAdmin(FIXTURE_SQL.customers);
}

export async function setupProducts() {
  // One call for both statements, exactly as before: the variants reference the products above.
  await execSqlAsAdmin(FIXTURE_SQL.productsAndVariants);
}

export async function setupCompanies() {
  await execSqlAsAdmin(FIXTURE_SQL.companies);
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

/**
 * Remove the transactions of the rows this suite OWNS — and nothing else.
 *
 * Phase-3 exit criterion EC2: cleanup may remove only data it can prove it created. The version this
 * replaces deleted every sale, return, void, payment, credit request and movement of the SHARED
 * baseline customers (customerA/B/C) and products (productA/B), so any suite calling it could wipe a
 * sibling file’s row mid-assertion — and several did, which is why the integration suite had to be
 * pinned to one file at a time. Passing ids makes a call’s blast radius its own rows, which is what
 * makes cleanup correct under ANY scheduling, serial included.
 *
 * The refusal happens before a single statement is built: a shared baseline id, an empty scope or a
 * non-uuid value throws in `./ownedCleanup`, which is where the rule and its reasoning live. Failures
 * here are reported rather than swallowed — a cleanup that reports clean while dirty is the defect
 * this pair exists to stop, and `deleteFixtureUsers` below already refuses to lie the same way.
 */
export async function cleanupOwnedTransactions(scope: OwnedTransactionScope): Promise<void> {
  // The failure collection lives in `./ownedCleanup` so the E2E lanes can use the same one; this is
  // the integration side's executor.
  await runCleanupStatements(execSqlAsAdmin, planOwnedTransactionCleanup(scope), 'owned transaction cleanup');
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
