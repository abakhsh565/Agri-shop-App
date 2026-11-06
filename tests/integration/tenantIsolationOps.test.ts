/**
 * Tenant isolation + reminder authorization regression suite.
 *
 * Proves, through the REAL client path (JWT → PostgREST → RLS/RPC → DB):
 *   1. A tenant can read its own `shops` row (it was silently invisible before
 *      migration 0115 because RLS was on with zero policies).
 *   2. A tenant can persist reminder configuration/occurrences, and every row is
 *      stamped with the caller's tenant.
 *   3. `upsert_reminder_occurrence` requires the `alerts.manage` permission and
 *      keeps its idempotency key tenant-scoped.
 *   4. RLS rejects a write that carries ANOTHER tenant's id.
 *   5. Read isolation holds: tenant B sees none of tenant A's rows.
 *
 * Self-contained: creates its own two tenants + users and removes them.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, insertAsUser, selectAsUser, setMembershipBranchScope } from '../setup/qa-client';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-00000000c0c0';
const OWNER_A = 'd1000000-0000-0000-0000-00000000000a';
const OWNER_B = 'd1000000-0000-0000-0000-00000000000b';
const EMP_A = 'd1000000-0000-0000-0000-0000000000e1';
const ROLE_EMPLOYEE = 'a0000000-0000-0000-0000-000000000001'; // Sales Employee: no alerts.manage
// This suite's OWN fixtures. It must not depend on a customer/config seeded by
// another suite, and it must not wipe the live tenant's reminder configuration.
const CFG_A = 'd1000000-0000-0000-0000-0000000000c1';
const CUST_A = 'd1000000-0000-0000-0000-0000000000d1';
const RUN = `QA Iso ${Date.now()}`;

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

/**
 * Cleanup that REPORTS instead of swallowing — the customerDeletionSecurity /
 * employeeInviteLifecycle pattern. This suite shares the QA database with the
 * other integration files, so a silent catch here would leave rows in place
 * and the next suite would fail deep inside a test with an authorization error
 * that is really leftover state. Failures are collected and the caller throws
 * with their names (throwIfCleanupFailed, wired in beforeAll/afterAll).
 */
const cleanupFailures: string[] = [];
async function trySql(label: string, p: Promise<unknown>): Promise<void> {
  try {
    await p;
  } catch (error) {
    cleanupFailures.push(`${label}: ${(error as Error).message}`);
  }
}
function throwIfCleanupFailed(context: string): void {
  if (cleanupFailures.length) {
    throw new Error(
      `${context}: cleanup failed — ${cleanupFailures.join(' | ')}. ` +
        `Leftover rows from this suite's namespace will contaminate the next run; fix the leak here rather than re-running.`,
    );
  }
}

async function cleanup() {
  await trySql('reminder_occurrences', sql(`DELETE FROM reminder_occurrences WHERE config_id IN ('${CFG_A}') OR shop_id = '${TENANT_B}'`));
  // Only this suite's configuration — never the live tenant's own rows.
  await trySql('reminder_configs', sql(`DELETE FROM reminder_configs WHERE id = '${CFG_A}' OR name LIKE '${RUN}%' OR shop_id = '${TENANT_B}'`));
  await trySql('reminder_logs', sql(`DELETE FROM reminder_logs WHERE shop_id = '${TENANT_B}'`));
  await trySql('audit_events', sql(`DELETE FROM audit_events WHERE user_id IN ('${OWNER_A}','${OWNER_B}','${EMP_A}')`));
  await trySql('customers', sql(`DELETE FROM customers WHERE id = '${CUST_A}'`));
  await trySql('users', sql(`DELETE FROM users WHERE id IN ('${OWNER_A}','${OWNER_B}','${EMP_A}')`));
  await trySql('shops', sql(`DELETE FROM shops WHERE id = '${TENANT_B}'`));
}

beforeAll(async () => {
  await cleanup();

  await sql(`INSERT INTO shops (id, name) VALUES ('${TENANT_B}', '${RUN} Tenant B') ON CONFLICT (id) DO NOTHING`);

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${OWNER_A}', '${RUN} Owner A', '923009780001', 'admin',  false, true, '${TENANT_A}'),
      ('${OWNER_B}', '${RUN} Owner B', '923009780002', 'admin',  true, true, '${TENANT_B}'),
      ('${EMP_A}',   '${RUN} Employee A', '923009780003', 'employee', false, true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);

  // Employee membership carries the role that lacks alerts.manage.
  await sql(`
    UPDATE memberships SET role_id = '${ROLE_EMPLOYEE}', role = 'employee', status = 'active'
     WHERE user_id = '${EMP_A}'
  `);
  await sql(`DELETE FROM user_permissions WHERE user_id = '${EMP_A}'`);

  // The wave-1 demotion left these admins with a NULL branch_scope, and 0188
  // refuses a non-owner every branch-scoped call when no branch is in scope.
  // Scope both memberships to the tenant's active branches (OWNER_B is a true
  // owner and exempt).
  const branches = await sql(
    `SELECT id FROM branches WHERE tenant_id = '${TENANT_A}' AND is_active = true ORDER BY is_default DESC, created_at`
  );
  const branchIds = branches.rows.map((r: { id: string }) => r.id);
  await setMembershipBranchScope(OWNER_A, TENANT_A, branchIds);
  await setMembershipBranchScope(EMP_A, TENANT_A, branchIds);

  // Deterministic fixtures for the reminder tests below (idempotent).
  await sql(`
    INSERT INTO reminder_configs (id, name, type, anchor, offset_days, repeat_mode, channel, is_active, shop_id)
    VALUES ('${CFG_A}', '${RUN} config base', 'credit', 'due_date', 0, 'once', 'sms', true, '${TENANT_A}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUST_A}', '${RUN} Customer A', '923009780010', 100000, 0, 0, 0, '${TENANT_A}', 'QA')
    ON CONFLICT (id) DO NOTHING
  `);
  throwIfCleanupFailed('tenantIsolationOps beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('tenantIsolationOps afterAll cleanup');
});

describe('Tenant isolation — tenant-scoped reads', () => {
  it('lets a tenant read its own shop row', async () => {
    const own = await selectAsUser(OWNER_A, 'shops');
    expect(own.error).toBeNull();
    expect((own.data ?? []).map((s: any) => s.id)).toContain(TENANT_A);
  });

  it('does not expose another tenant shop row', async () => {
    const seen = await selectAsUser(OWNER_A, 'shops');
    expect((seen.data ?? []).map((s: any) => s.id)).not.toContain(TENANT_B);
  });

  it('scopes reminder occurrences to the caller tenant', async () => {
    const a = await selectAsUser(OWNER_A, 'reminder_occurrences');
    const b = await selectAsUser(OWNER_B, 'reminder_occurrences');
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect((b.data ?? []).length).toBe(0);
  });
});

describe('Reminder configuration — tenant-owned and writable', () => {
  it('stamps a directly inserted config with the caller tenant', async () => {
    const res = await insertAsUser(OWNER_A, 'reminder_configs', {
      name: `${RUN} config`,
      type: 'credit',
      anchor: 'due_date',
      channel: 'sms',
      is_active: true,
    });
    expect(res.error).toBeNull();
    expect(res.data?.[0]?.shop_id).toBe(TENANT_A);
  });

  it('rejects a config written with another tenant id', async () => {
    const res = await insertAsUser(OWNER_A, 'reminder_configs', {
      name: `${RUN} cross tenant`,
      type: 'credit',
      anchor: 'due_date',
      channel: 'sms',
      is_active: true,
      shop_id: TENANT_B,
    });
    expect(res.error).not.toBeNull();
    expect(res.error).toMatch(/row-level security/i);

    const leaked = await sql(`SELECT count(*)::int AS c FROM reminder_configs WHERE name = '${RUN} cross tenant'`);
    expect(leaked.rows[0].c).toBe(0);
  });
});

describe('Reminder occurrence RPC — authorization and tenant scoping', () => {
  it('lets an owner with alerts.manage create an occurrence for its own tenant', async () => {
    // Seeded by beforeAll — this suite owns these rows instead of borrowing them.
    const config = await sql(`SELECT id FROM reminder_configs WHERE id = '${CFG_A}'`);
    expect(config.rows[0]?.id, 'config fixture must exist').toBe(CFG_A);
    const customer = await sql(`SELECT id FROM customers WHERE id = '${CUST_A}'`);
    expect(customer.rows[0]?.id, 'customer fixture must exist').toBe(CUST_A);

    const res = await execRpcAsUser(OWNER_A, 'upsert_reminder_occurrence', {
      payload: {
        config_id: CFG_A,
        customer_id: CUST_A,
        occurrence_key: `qa-key-${Date.now()}`,
        occurrence_number: 1,
        stage: 'first',
        crop_name: 'Wheat',
        tone: 'polite',
        scheduled_date: new Date().toISOString().slice(0, 10),
        status: 'scheduled',
      },
    });
    expect(res.error).toBeNull();

    const stored = await sql(
      `SELECT shop_id, occurrence_number, stage, tone FROM reminder_occurrences WHERE occurrence_key IS NOT NULL AND shop_id = '${TENANT_A}' ORDER BY created_at DESC LIMIT 1`
    );
    expect(stored.rows[0]?.shop_id).toBe(TENANT_A);
    expect(stored.rows[0]?.occurrence_number).toBe(1);
    expect(stored.rows[0]?.tone).toBe('polite');
  });

  it('rejects the same call from a member without alerts.manage', async () => {
    const res = await execRpcAsUser(EMP_A, 'upsert_reminder_occurrence', {
      payload: {
        customer_id: CUST_A,
        occurrence_key: `qa-denied-${Date.now()}`,
        occurrence_number: 1,
        status: 'scheduled',
      },
    });
    expect(res.error).toContain('NOT_AUTHORIZED');
  });

  it('does not return another tenant occurrence for the same key', async () => {
    const key = `qa-shared-${Date.now()}`;
    const created = await execRpcAsUser(OWNER_A, 'upsert_reminder_occurrence', {
      payload: {
        config_id: CFG_A,
        customer_id: CUST_A,
        occurrence_key: key,
        occurrence_number: 1,
        scheduled_date: new Date().toISOString().slice(0, 10),
        status: 'scheduled',
      },
    });
    expect(created.error).toBeNull();

    await sql(`INSERT INTO reminder_configs (name, type, anchor, channel, is_active, shop_id) VALUES ('${RUN} b config','credit','due_date','sms',true,'${TENANT_B}')`);

    const res = await selectAsUser(OWNER_B, 'reminder_occurrences', '*', { occurrence_key: key });
    expect(res.error).toBeNull();
    expect((res.data ?? []).length).toBe(0);
  });

  it('rejects a reminder occurrence referencing another tenant customer', async () => {
    // CUST_A belongs to tenant A; owner B must never be able to use it. The
    // fixture is guaranteed above, so this test can never silently skip.
    const res = await execRpcAsUser(OWNER_B, 'upsert_reminder_occurrence', {
      payload: {
        customer_id: CUST_A,
        occurrence_key: `qa-foreign-${Date.now()}`,
        occurrence_number: 1,
        status: 'scheduled',
      },
    });
    expect(res.error).toContain('NOT_AUTHORIZED');
  });
});
