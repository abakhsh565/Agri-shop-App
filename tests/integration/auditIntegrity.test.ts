/**
 * Audit history integrity — `audit_events` is a record of what the system DID, so the only
 * legitimate writer is the business logic that does it.
 *
 * HOW THIS WAS FOUND. The whole-app gate closed a cross-tenant leak class in policy predicates
 * (0178/0180). The same question was then asked of the history tables, and `audit_events` was
 * the one table in the schema whose INSERT policy was the literal `true` for `authenticated`.
 * Its SELECT policy was `app_is_admin()` — a role check with no shop predicate, on a table that
 * has no `shop_id` column at all (attribution is `user_id → users.shop_id`).
 *
 * WHAT IS TRUE TODAY, measured on QA 2026-10-02 (`backups/audit-probe3.mjs`):
 *
 *   * the trusted writer is a family of ~34 SECURITY DEFINER RPCs (`void_sale`, `process_return`,
 *     `adjust_stock`, `delete_role`, `record_customer_payment`, …) which insert their audit row
 *     inside the same transaction as the business change, with attribution they derive themselves;
 *   * `authenticated` and `anon` hold **no INSERT privilege** on the table, so a direct
 *     PostgREST insert is refused by the grant layer before RLS is consulted. The forgery is
 *     therefore NOT reachable from a client today — the policy was the only thing that would
 *     still say yes, which is exactly why it is the wrong thing to rely on;
 *   * the SELECT policy is the same shape as the leaks 0178/0180 fixed: `app_is_admin()` with no
 *     shop predicate.
 *
 * The assertions below are written to hold for the *boundary*, not for one mechanism: the insert
 * must be refused (by RLS, by privilege, or both) and the policy itself must not be permissive,
 * so adding a grant later cannot silently reopen forgery.
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSqlAsAdmin, insertAsUser, selectAsUser } from '../setup/qa-client';

const SHOP_A = '00000000-0000-0000-0000-000000000001';
const SHOP_B = '00000000-0000-0000-0000-00000000f0f0';
// The client path is addressed by USER ID (a JWT is minted from it); the seeded admin is the
// one the e2e suite also signs in as, so the two layers agree on who is acting.
const ADMIN_A = '10000000-0000-0000-0000-000000000001';
const ADMIN_B = '923009830001';
const ACTOR_B = '923009830002';
const ADMIN_B_ID = 'd6000000-0000-0000-0000-00000000000b';
const ACTOR_B_ID = 'd6000000-0000-0000-0000-0000000000b1';
const ADMIN_A_ID = '10000000-0000-0000-0000-000000000001';
const RUN = `QA Audit ${Date.now()}`;

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
  await trySql('audit_events', sql(`DELETE FROM audit_events WHERE action LIKE '${RUN}%'`));
  await trySql('users', sql(`DELETE FROM users WHERE id IN ('${ADMIN_B_ID}','${ACTOR_B_ID}')`));
  await trySql('shops', sql(`DELETE FROM shops WHERE id = '${SHOP_B}'`));
}

beforeAll(async () => {
  await cleanup();
  await sql(`INSERT INTO shops (id, name) VALUES ('${SHOP_B}', '${RUN}') ON CONFLICT (id) DO NOTHING`);
  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES
      ('${ADMIN_B_ID}', '${RUN} admin B', '${ADMIN_B}', 'admin',    true, true, '${SHOP_B}'),
      ('${ACTOR_B_ID}', '${RUN} actor B', '${ACTOR_B}', 'employee', false, true, '${SHOP_B}')
    ON CONFLICT (id) DO NOTHING
  `);
  // Two audit rows written the way the trusted RPCs write them (service role = the RPCs' owner),
  // one attributed to a shop-B actor and one to the seeded shop-A admin.
  //
  // The tenant is part of the row, not decoration. `audit_events_select` is
  // `has_effective_permission('activity.view') AND tenant_id = current_shop_id() AND (…)`, so a row
  // inserted WITHOUT `tenant_id` is invisible to the very admin the next assertion is about — and
  // `NULL = current_shop_id()` is never true. That, not a missing permission, is what made this file
  // red. The branch is the tenant's real default branch rather than a hardcoded id, and the shop-B
  // row deliberately has none: it is the negative control, and it must be excluded on `tenant_id`.
  await sql(`
    INSERT INTO audit_events (user_id, action, entity_type, details, tenant_id, branch_id)
    SELECT '${ACTOR_B_ID}'::uuid, '${RUN} shop B event', 'product', '{"note":"B"}'::jsonb, '${SHOP_B}'::uuid, NULL
    UNION ALL
    SELECT '${ADMIN_A_ID}'::uuid, '${RUN} shop A event', 'product', '{"note":"A"}'::jsonb, '${SHOP_A}'::uuid,
           (SELECT b.id FROM branches b
             WHERE b.tenant_id = '${SHOP_A}' AND b.is_active
             ORDER BY b.is_default DESC, b.created_at, b.id
             LIMIT 1)
  `);
  throwIfCleanupFailed('auditIntegrity beforeAll cleanup');
});

afterAll(async () => {
  await cleanup();
  throwIfCleanupFailed('auditIntegrity afterAll cleanup');
});

describe('audit history integrity', () => {
  it('the fixture is real: both audit rows exist', async () => {
    const r = await sql(`SELECT count(*) n FROM audit_events WHERE action LIKE '${RUN}%'`);
    expect(Number(r.rows[0]?.n)).toBe(2);
  });

  it('no INSERT policy on the table is permissive', async () => {
    // The boundary must not depend on a missing grant. A `WITH CHECK (true)` INSERT policy is
    // the exact shape that made `product_variants` readable across shops.
    const open = await sql(`
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'audit_events' AND cmd = 'INSERT'
         AND (with_check IS NULL OR with_check = 'true')
    `);
    expect(
      open.rows.map((r: any) => r.policyname),
      'an INSERT policy on audit_events still accepts anything the caller sends',
    ).toEqual([]);
  });

  it('a client cannot insert an audit row at all', async () => {
    const { error } = await insertAsUser(ADMIN_A, 'audit_events', {
      user_id: ADMIN_A_ID, action: `${RUN} forged client row`, entity_type: 'product',
    });
    const written = await sql(`SELECT 1 FROM audit_events WHERE action = '${RUN} forged client row'`);
    expect(written.rows.length, 'a client wrote an audit row').toBe(0);
    // Either gate is acceptable — RLS or privilege — but one of them must have said no.
    expect(
      error ?? '',
      'the insert must be refused by a database boundary, not merely fail to appear',
    ).toMatch(/row-level security|permission denied|violates/i);
  });

  it('a client cannot forge another actor’s audit row', async () => {
    const { error } = await insertAsUser(ADMIN_A, 'audit_events', {
      user_id: ACTOR_B_ID, action: `${RUN} forged actor`, entity_type: 'product',
    });
    const written = await sql(`SELECT 1 FROM audit_events WHERE action = '${RUN} forged actor'`);
    expect(written.rows.length, 'a client forged another actor’s audit row').toBe(0);
    expect(error ?? '').toMatch(/row-level security|permission denied|violates/i);
  });

  it('an admin does not read another shop’s audit history', async () => {
    const seen = await selectAsUser(ADMIN_A, 'audit_events', '*');
    const actions = (seen.data ?? []).map((r: any) => r.action);
    expect(actions, 'another shop’s audit history was readable').not.toContain(`${RUN} shop B event`);
  });

  it('an admin still reads their own shop’s audit history', async () => {
    const seen = await selectAsUser(ADMIN_A, 'audit_events', '*');
    expect(seen.error).toBeNull();
    expect(
      (seen.data ?? []).map((r: any) => r.action),
      'the scoping must not hide the shop’s own history',
    ).toContain(`${RUN} shop A event`);
  });
});
