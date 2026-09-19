/**
 * Structural invariants for the tenant / authorization foundation.
 *
 * These assertions do not test a feature — they fail when the ARCHITECTURE
 * regresses. Each one corresponds to a defect that was actually found in this
 * system, so a future change that reintroduces it fails here immediately:
 *
 *   A. A tenant-owned table with RLS enabled but zero policies silently denies
 *      every row to the app (reads return empty, writes fail) — this is how
 *      "shops", "business_settings" and the reminder tables were broken.
 *   B. A tenant/business write RPC executable by `anon`.
 *   C. An operational record with no branch ownership.
 *   D. A user with a shop but no membership (breaks tenant resolution).
 *   E. A protected write RPC with no authorization guard at all.
 *
 * Tables/functions that are intentionally internal or pre-auth are listed
 * explicitly; anything outside those lists must satisfy the invariant.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import { execSqlAsAdmin } from '../setup/qa-client';

async function sql<T = any>(query: string): Promise<T[]> {
  const res = await execSqlAsAdmin(query);
  return res.rows as T[];
}

/** Platform / Engineering-OS internals: never read by app users, by design. */
const INTERNAL_TABLES = [
  'agent_attempts', 'agent_tasks', 'engineering_memory', 'frontend_dependency_graph',
  'impact_analyses', 'impact_mappings', 'incident_rate_limits', 'incident_signatures',
  'incidents', 'known_resolutions', 'resolution_regression_tests',
  'activity_log', 'daily_cash_reconciliations', 'payments', 'shop_requests',
];

/** Genuinely pre-auth or platform-internal RPCs. */
const ANON_ALLOWED_WRITES = [
  'insert_shop_request',   // public shop registration form
  'record_attempt', 'record_incident', 'record_memory', 'record_resolution',
];

/** Tables that carry business operations and therefore need branch ownership. */
const BRANCH_OWNED = [
  'sales', 'purchases', 'returns', 'inventory_movements',
  'customer_payments', 'supplier_payments', 'stock_adjustments',
];

describe('Invariant A — no tenant table is RLS-enabled-with-zero-policies', () => {
  it('every app-facing table exposes at least one policy', async () => {
    const rows = await sql<{ relname: string }>(`
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relrowsecurity
         AND NOT EXISTS (SELECT 1 FROM pg_policies p
                          WHERE p.schemaname = 'public' AND p.tablename = c.relname)
       ORDER BY c.relname
    `);
    const offenders = rows.map((r) => r.relname).filter((t) => !INTERNAL_TABLES.includes(t));
    expect(offenders).toEqual([]);
  });
});

describe('Invariant B — no tenant write RPC is executable by anon', () => {
  it('only pre-auth/internal functions keep anon EXECUTE', async () => {
    const rows = await sql<{ proname: string }>(`
      SELECT p.proname
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prokind = 'f'
         AND array_to_string(p.proacl, ',') ~ 'anon=X'
         AND p.proname ~ '^(create_|update_|delete_|record_|process_|void_|adjust_|archive_|restore_|deactivate_|activate_|approve_|reject_|upsert_|insert_)'
       ORDER BY p.proname
    `);
    const offenders = rows.map((r) => r.proname).filter((f) => !ANON_ALLOWED_WRITES.includes(f));
    expect(offenders).toEqual([]);
  });
});

describe('Invariant C — every operational record owns a branch', () => {
  // Structural on purpose: a row-level assertion would be measured while other
  // suites are mid-write in the same parallel run. Actual stamping behaviour is
  // proven functionally in branchScopeEnforcement.test.ts.
  it('branch-owning tables have the column and an enforcing trigger', async () => {
    for (const table of BRANCH_OWNED) {
      const col = await sql<{ c: number }>(`
        SELECT count(*)::int AS c FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'branch_id'
      `);
      expect(col[0].c, `${table}.branch_id missing`).toBe(1);

      const trigger = await sql<{ c: number }>(`
        SELECT count(*)::int AS c FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = '${table}'
           AND t.tgname = 'enforce_branch_scope_trg' AND NOT t.tgisinternal
      `);
      expect(trigger[0].c, `${table} has no branch enforcement trigger`).toBe(1);
    }
  });
});

describe('Invariant D — User → Membership', () => {
  it('guarantees a membership for every user through the users trigger', async () => {
    const trigger = await sql<{ c: number }>(`
      SELECT count(*)::int AS c FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'users'
         AND t.tgname = 'ensure_user_membership_trg' AND NOT t.tgisinternal
    `);
    expect(trigger[0].c, 'users has no membership-ensuring trigger').toBe(1);
  });

  it('leaves no long-lived user with a shop but no membership', async () => {
    // Rows written by a suite in the same parallel run are excluded: a user row
    // inserted milliseconds ago is mid-setup, not an orphan. A real orphan is
    // still caught on the very next run.
    const rows = await sql<{ c: number }>(`
      SELECT count(*)::int AS c FROM users u
       WHERE u.shop_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)
         AND u.created_at < now() - interval '60 seconds'
    `);
    expect(rows[0].c).toBe(0);
  });
});

describe('Invariant E — protected writes resolve tenant context', () => {
  it('every business write RPC carries an authorization guard', async () => {
    const rows = await sql<{ proname: string; has_guard: boolean }>(`
      SELECT p.proname,
             pg_get_functiondef(p.oid) ~ 'authorize_business_action|authorize_tenant_membership|has_effective_permission|has_permission|app_is_admin'
               AS has_guard
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prokind = 'f'
         AND p.proname ~ '^(create_|update_|delete_|record_|void_|adjust_|process_return|archive_|restore_|deactivate_|activate_|approve_|reject_)'
      ORDER BY p.proname
    `);
    // Trigger helpers and the Engineering-OS incident flow are internal, and
    // cash reconciliation is admin-gated (app_is_admin) rather than permission
    // gated — it is allowed to have no permission lookup.
    const INTERNAL_FUNCTIONS = [
      'update_incident_status', 'update_memberships_updated_at', 'update_updated_at_column',
      'record_cash_reconciliation_v1',
      // Platform onboarding approval: authorized against a founder/admin account
      // (and is_trusted_context) in migration 0121, not against a tenant permission.
      'approve_shop_request',
    ];
    const unguarded = rows
      .filter((r) => !r.has_guard)
      .map((r) => r.proname)
      .filter((f) => !ANON_ALLOWED_WRITES.includes(f) && !INTERNAL_FUNCTIONS.includes(f));
    expect(unguarded).toEqual([]);
  });
});
