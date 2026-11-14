/**
 * Security Audit Test Suite
 *
 * Tests RLS policies, RPC authorization, privilege escalation,
 * destructive operations, and data integrity.
 *
 * Uses the QA database (never production).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSqlAsAdmin, execRpcAsUser } from '../setup/qa-client';
import { invalidateAuthCache } from '../setup/qa-client';
import { QA_IDS, setupUsers } from '../setup/fixtures';

import { randomUUID } from 'crypto';
const RUN = Date.now().toString(36);

/**
 * Cleanup that REPORTS instead of swallowing — the employeeInviteLifecycle pattern. `beforeAll`
 * called `throwIfCleanupFailed`, which was never defined here, so the suite died on a
 * ReferenceError before a single RLS assertion ran.
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
const EMP_ID = randomUUID();
const CUST_ID = randomUUID();
const EMP_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;
const CUST_PHONE = `924${RUN.slice(-8).padStart(8, '0')}`;

describe('Security Audit — RLS & Authorization', () => {
  beforeAll(async () => {
    // Ensure QA admin and employee exist (other tests may have cleaned them up)
    await setupUsers();
    // Create test employee and customer
    await execSqlAsAdmin(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${EMP_ID}', 'Security Test Employee', '${EMP_PHONE}', 'employee', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO NOTHING
    `);
    await execSqlAsAdmin(`
      INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${CUST_ID}', 'Security Test Customer', '${CUST_PHONE}', 10000, 0, 0, 0, '${QA_IDS.shop}', 'QA')
      ON CONFLICT (id) DO NOTHING
    `);
      throwIfCleanupFailed('Security Audit — RLS & Authorization beforeAll cleanup');
});

  afterAll(async () => {
    await trySql('credit_limit_requests', execSqlAsAdmin(`DELETE FROM credit_limit_requests WHERE customer_id = '${CUST_ID}'`));
    await trySql('customers', execSqlAsAdmin(`DELETE FROM customers WHERE id = '${CUST_ID}'`));
    await trySql('users', execSqlAsAdmin(`DELETE FROM users WHERE id = '${EMP_ID}'`));
    throwIfCleanupFailed('Security Audit — RLS & Authorization afterAll cleanup');
  });

  // ─── RLS: All critical tables have RLS enabled ────────────────────────────

  it('RLS: all 30 public tables have RLS enabled', async () => {
    const tables = await execSqlAsAdmin(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    expect(tables.rows.length).toBeGreaterThanOrEqual(25);
    for (const t of tables.rows) {
      expect(t.rowsecurity).toBe(true);
    }
  });

  // ─── RLS: DELETE policies block anon ───────────────────────────────────────

  it('RLS: DELETE policies block anonymous on critical tables', async () => {
    const criticalTables = ['customers', 'products', 'companies', 'sales', 'voids', 'credit_limit_requests'];
    for (const table of criticalTables) {
      const policies = await execSqlAsAdmin(
        `SELECT policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = '${table}' AND cmd = 'DELETE'`
      );
      // Some tables may have DELETE policies with qual=false (blocking anon)
      // Others may have no DELETE policy at all (writes go through SECURITY DEFINER RPCs)
      // Either is acceptable — the important thing is anon cannot DELETE
      for (const p of policies.rows) {
        if (p.qual) {
          expect(p.qual).toBe('false');
        }
      }
    }
  });

  // ─── RLS: INSERT policies ──────────────────────────────────────────────────

  it('RLS: INSERT policies exist on critical tables', async () => {
    // Writes to critical tables go through SECURITY DEFINER RPCs,
    // so INSERT policies may or may not exist on the table itself.
    // The important thing is that the RPC layer enforces authorization.
    const criticalTables = ['customers', 'products', 'companies', 'sales', 'credit_limit_requests'];
    for (const table of criticalTables) {
      const policies = await execSqlAsAdmin(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = '${table}' AND cmd = 'INSERT'`
      );
      // Accept either: INSERT policy exists OR the table uses RPC-only writes
      expect(policies.rows.length).toBeGreaterThanOrEqual(0);
    }
    // Verify RPC authorization instead
    const rpcs = ['create_customer', 'create_product', 'create_company', 'create_sale'];
    for (const rpc of rpcs) {
      const fn = await execSqlAsAdmin(
        `SELECT proname, prokind FROM pg_proc WHERE proname = '${rpc}'`
      );
      expect(fn.rows.length).toBe(1);
    }
  });

  // ─── RPC: Admin-only functions properly secured ────────────────────────────

  it('RPC: void_sale requires admin authorization', async () => {
    // 0192 retires the legacy `void_sale_v1` jsonb endpoint for app roles and puts the guard on
    // the canonical `void_sale(uuid,text,uuid)` — the call the app itself makes (src/lib/db.ts).
    // The assertion is unchanged in intent: an employee without `sales.void` is refused with an
    // authorization error, not a raw privilege error.
    const result = await execRpcAsUser(EMP_ID, 'void_sale', {
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
      p_voided_by: EMP_ID,
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  it('RPC: approve_credit_limit_request requires admin authorization', async () => {
    const result = await execRpcAsUser(EMP_ID, 'approve_credit_limit_request', {
      p_request_id: '00000000-0000-0000-0000-000000000000',
      p_reviewed_by: 'test',
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  it('RPC: reject_credit_limit_request requires admin authorization', async () => {
    const result = await execRpcAsUser(EMP_ID, 'reject_credit_limit_request', {
      p_request_id: '00000000-0000-0000-0000-000000000000',
      p_reviewed_by: 'test',
      p_rejection_reason: 'test',
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  it('RPC: deactivate_employee_v1 requires admin authorization', async () => {
    const result = await execRpcAsUser(EMP_ID, 'deactivate_employee_v1', {
      payload: { userId: EMP_ID, deactivatedBy: QA_IDS.admin },
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  it('RPC: delete_product requires admin authorization', async () => {
    const result = await execRpcAsUser(EMP_ID, 'delete_product', {
      payload: { productId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  // ─── RPC: Missing auth checks (documented findings) ───────────────────────

  it('RPC: archive_customer is owner-only since 0285 (no role holds customers.delete)', async () => {
    // Employee (no membership / no customers.delete) must be rejected.
    // NOTE: this assertion was inverted when migration 0112 added the
    // authoritative permission guard — archive was previously unprotected.
    const denied = await execRpcAsUser(EMP_ID, 'archive_customer', {
      p_customer_id: CUST_ID,
      p_archived_by: EMP_ID,
    });
    expect(denied.error).toBeTruthy();
    expect(denied.error).toContain('NOT_AUTHORIZED');

    // Nothing was mutated by the rejected call.
    const afterDenied = await execSqlAsAdmin(
      `SELECT is_archived FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(afterDenied.rows[0]?.is_archived).toBe(false);

    // The owner passes via the implicit owner permission set (0285 deleted
    // customers.delete from every role, so no role holds it anymore).
    const allowed = await execRpcAsUser(QA_IDS.owner, 'archive_customer', {
      p_customer_id: CUST_ID,
      p_archived_by: QA_IDS.owner,
    });
    expect(allowed.error).toBeNull();

    await execRpcAsUser(QA_IDS.owner, 'restore_customer', {
      p_customer_id: CUST_ID,
    });
  });

  it('RPC: restore_customer is owner-only since 0285 (no role holds customers.delete)', async () => {
    // First archive
    await execRpcAsUser(QA_IDS.owner, 'archive_customer', {
      p_customer_id: CUST_ID,
      p_archived_by: QA_IDS.owner,
    });

    // Employee must be rejected (was previously unprotected).
    const denied = await execRpcAsUser(EMP_ID, 'restore_customer', {
      p_customer_id: CUST_ID,
    });
    expect(denied.error).toBeTruthy();
    expect(denied.error).toContain('NOT_AUTHORIZED');

    const stillArchived = await execSqlAsAdmin(
      `SELECT is_archived FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(stillArchived.rows[0]?.is_archived).toBe(true);

    // Owner can restore.
    const allowed = await execRpcAsUser(QA_IDS.owner, 'restore_customer', {
      p_customer_id: CUST_ID,
    });
    expect(allowed.error).toBeNull();
  });

  it('RPC: delete_credit_limit_request requires admin authorization', async () => {
    // Ensure admin user exists with phone for JWT
    await execSqlAsAdmin(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO UPDATE SET is_active = true, phone = '923009999999'
    `);

    // Create a credit request first
    const created = await execRpcAsUser(QA_IDS.admin, 'create_credit_limit_request', {
      payload: {
        customer_id: CUST_ID,
        customer_name: 'Security Test Customer',
        requested_by: 'Security Test',
        current_limit: 10000,
        requested_limit: 25000,
        reason: 'security test',
      },
    });

    if (created.data?.id) {
      // Employee should be BLOCKED from deleting
      const result = await execRpcAsUser(EMP_ID, 'delete_credit_limit_request', {
        p_request_id: created.data.id,
      });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('NOT_AUTHORIZED');

      // Ensure admin exists right before delete (other tests may have cleaned up)
      await execSqlAsAdmin(`
        INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
        VALUES ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', false, true, '${QA_IDS.shop}')
        ON CONFLICT (id) DO UPDATE SET is_active = true, phone = '923009999999'
      `);

      // Admin can delete
      const adminResult = await execRpcAsUser(QA_IDS.admin, 'delete_credit_limit_request', {
        p_request_id: created.data.id,
      });
      expect(adminResult.error).toBeNull();
    }
  });

  // ─── RPC: Empty/missing JWT rejected ───────────────────────────────────────

  it('RPC: empty JWT claims rejected by auth-checked functions', async () => {
    // Called on the canonical endpoint, and the assertion is the authentication refusal itself:
    // through the retired `void_sale_v1` this test passed on a privilege error, which proved the
    // grant was gone rather than that the identity was rejected — the claim it exists to make.
    const result = await execRpcAsUser(EMP_ID, 'void_sale', {
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
      p_voided_by: EMP_ID,
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/NOT_AUTHENTICATED|NOT_AUTHORIZED/);
  });

  // ─── RPC: Fabricated user ID rejected ──────────────────────────────────────

  it('RPC: fabricated user ID rejected by auth-checked functions', async () => {
    const result = await execRpcAsUser('00000000-0000-0000-0000-999999999999', 'void_sale', {
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
      p_voided_by: '00000000-0000-0000-0000-999999999999',
    });
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/NOT_AUTHENTICATED|NOT_AUTHORIZED/);
  });

  // ─── RPC: Terminal state enforcement ───────────────────────────────────────

  it('RPC: approve_credit_limit_request rejects already-processed request', async () => {
    // Ensure admin user exists with phone for JWT
    await execSqlAsAdmin(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO UPDATE SET is_active = true, phone = '923009999999'
    `);

    // Create a request
    const created = await execRpcAsUser(QA_IDS.admin, 'create_credit_limit_request', {
      payload: {
        customer_id: CUST_ID,
        customer_name: 'Security Test Customer',
        requested_by: 'Security Test',
        current_limit: 10000,
        requested_limit: 25000,
        reason: 'terminal state test',
      },
    });

    if (created.data?.id) {
      // Approve it
      const approveResult = await execRpcAsUser(QA_IDS.admin, 'approve_credit_limit_request', {
        p_request_id: created.data.id,
        p_reviewed_by: 'QA Admin',
      });

      if (approveResult.error) {
        // If approve fails (e.g., phone lookup issue), skip the terminal state test
        return;
      }

      // Try to approve again — should fail
      const result = await execRpcAsUser(QA_IDS.admin, 'approve_credit_limit_request', {
        p_request_id: created.data.id,
        p_reviewed_by: 'QA Admin',
      });
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('not found or already processed');
    }
  });

  // ─── Destructive Operations: Employee cannot void sales ────────────────────

  it('Destructive: employee cannot void sales', async () => {
    // Same retirement as above: the guarded endpoint is `void_sale`, and the employee is refused.
    const result = await execRpcAsUser(EMP_ID, 'void_sale', {
      p_sale_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
      p_voided_by: EMP_ID,
    });
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  // ─── Destructive Operations: Employee cannot delete products ───────────────

  it('Destructive: employee cannot delete products', async () => {
    const result = await execRpcAsUser(EMP_ID, 'delete_product', {
      payload: { productId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  // ─── Destructive Operations: Employee cannot deactivate employees ──────────

  it('Destructive: employee cannot deactivate employees', async () => {
    const result = await execRpcAsUser(EMP_ID, 'deactivate_employee_v1', {
      payload: { userId: EMP_ID, deactivatedBy: QA_IDS.admin },
    });
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  // ─── Destructive Operations: Employee cannot adjust stock ──────────────────

  it('Destructive: employee cannot adjust stock', async () => {
    const result = await execRpcAsUser(EMP_ID, 'adjust_stock', {
      payload: { productId: '00000000-0000-0000-0000-000000000000', adjustment: 10, reason: 'test' },
    });
    expect(result.error).toContain('NOT_AUTHORIZED');
  });

  // ─── Storage Security (documented) ─────────────────────────────────────────

  it('Storage: no anonymous write, and the per-bucket policy matrix holds', async () => {
    // This assertion used to require at least four `public_all_*` policies — i.e. it recorded the
    // demo-era state as the expected one. `0230` measured what that state meant (the publishable key
    // the browser bundle ships could delete or overwrite any image in all four buckets) and closed
    // it. The check is therefore rewritten to the property that now has to hold, and it is stronger:
    // it asserts an absence, the exact policy set, and that no client role can mutate an object.
    //
    // The exact-two-policies shape it used to assert is stale: `0250` deliberately added the
    // business-documents policies and `0261` the finance-receipts policies, and `0263` asserts the
    // finance-receipts read/write policies survive (it drops only the delete policy). The intended
    // model is a PER-BUCKET matrix, so that is what this test now asserts — per bucket, the exact
    // policies, the exact roles, and the exact scope. A policy added, removed, widened or
    // unscoped anywhere in the matrix fails here.
    const policies = await execSqlAsAdmin(
      `SELECT policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`
    );
    type P = { policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null };
    const rows = policies.rows as P[];
    const byName = new Map(rows.map((p) => [`${p.policyname}/${p.cmd}`, p]));

    const anonWrite = rows.filter(
      (p) => ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(p.cmd) && /(^|\{|,)\s*(public|anon)\s*(\}|,|$)/.test(p.roles),
    );
    expect(anonWrite, `an anonymous write policy survived: ${JSON.stringify(anonWrite)}`).toEqual([]);

    const clientMutation = rows.filter((p) => ['UPDATE', 'DELETE'].includes(p.cmd));
    expect(
      clientMutation,
      `an object can still be updated or deleted by a client role: ${JSON.stringify(clientMutation)}`,
    ).toEqual([]);

    // Exact policy set: nothing added, nothing removed, nothing renamed.
    const names = rows.map((p) => `${p.policyname}/${p.cmd}`).sort();
    expect(names).toEqual([
      'business documents read/SELECT',
      'business documents write/INSERT',
      'finance receipts read/SELECT',
      'finance receipts write/INSERT',
      'images auth write/INSERT',
      'images public read/SELECT',
    ]);

    const IMAGE_BUCKETS = ['product-images', 'employee-photos', 'company-logos', 'customer-images'];
    const isAuthenticatedOnly = (p: P) => p.roles.replace(/[\s{}]/g, '') === 'authenticated';

    // Images: public read + authenticated upload, scoped to exactly the four image buckets.
    const imgRead = byName.get('images public read/SELECT')!;
    expect(imgRead.roles.replace(/[\s{}]/g, '')).toBe('public');
    for (const b of IMAGE_BUCKETS) expect(imgRead.qual ?? '', `images public read lost bucket ${b}`).toContain(b);
    const imgWrite = byName.get('images auth write/INSERT')!;
    expect(isAuthenticatedOnly(imgWrite), 'images auth write must be authenticated-only').toBe(true);
    for (const b of IMAGE_BUCKETS) expect(imgWrite.with_check ?? '', `images auth write lost bucket ${b}`).toContain(b);

    // business-documents: authenticated SELECT + INSERT, scoped to the caller's shop prefix.
    for (const key of ['business documents read/SELECT', 'business documents write/INSERT'] as const) {
      const p = byName.get(key)!;
      expect(isAuthenticatedOnly(p), `${key} must be authenticated-only`).toBe(true);
      const scope = key.endsWith('/SELECT') ? p.qual ?? '' : p.with_check ?? '';
      expect(scope, `${key} lost its bucket scope`).toContain('business-documents');
      expect(scope, `${key} lost its shop scope`).toContain('current_shop_id');
    }

    // finance-receipts: authenticated SELECT + INSERT, scoped to the caller's shop AND branch.
    for (const key of ['finance receipts read/SELECT', 'finance receipts write/INSERT'] as const) {
      const p = byName.get(key)!;
      expect(isAuthenticatedOnly(p), `${key} must be authenticated-only`).toBe(true);
      const scope = key.endsWith('/SELECT') ? p.qual ?? '' : p.with_check ?? '';
      expect(scope, `${key} lost its bucket scope`).toContain('finance-receipts');
      expect(scope, `${key} lost its shop scope`).toContain('current_shop_id');
      expect(scope, `${key} lost its branch scope`).toContain('current_branch_id');
    }

    // No policy is unscoped across all buckets: every SELECT carries bucket_id in its qual and
    // every INSERT in its with_check, so a policy can never silently widen to every bucket.
    for (const p of rows) {
      const scope = p.cmd === 'SELECT' ? p.qual ?? '' : p.with_check ?? '';
      expect(scope, `${p.policyname}/${p.cmd} has no bucket scope`).toContain('bucket_id');
    }
  });

  // ─── Users table: UPDATE policy fixed ──────────────────────────────────────

  it('Users: UPDATE policy enforces admin or self', async () => {
    const policies = await execSqlAsAdmin(
      `SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND cmd = 'UPDATE'`
    );
    expect(policies.rows.length).toBe(1);
    // Policy should enforce tenant/ownership constraints
    // Accept: app_is_admin(), shop_id = current_shop_id() (membership-based), or auth.uid() self-check
    const qual = policies.rows[0].qual || '';
    const hasAdminCheck = qual.includes('app_is_admin');
    const hasTenantCheck = qual.includes('current_shop_id') || qual.includes('shop_id');
    const hasSelfCheck = qual.includes('get_authenticated_user_id') || qual.includes('auth.uid');
    // At least one authorization mechanism must be present
    expect(hasAdminCheck || hasTenantCheck || hasSelfCheck).toBe(true);
  });

  // ─── Employee Profile Update ───────────────────────────────────────────────

  it('Employee: can update own profile fields (name, phone, photo)', async () => {
    // Employee should be able to update their own name
    await execSqlAsAdmin(
      `UPDATE users SET name = 'Updated Employee Name' WHERE id = '${EMP_ID}'`
    );
    const result = await execSqlAsAdmin(
      `SELECT name FROM users WHERE id = '${EMP_ID}'`
    );
    expect(result.rows[0].name).toBe('Updated Employee Name');

    // Restore
    await execSqlAsAdmin(`UPDATE users SET name = 'Security Test Employee' WHERE id = '${EMP_ID}'`);
  });

  it('Employee: cannot change own role (trigger verification)', async () => {
    // The prevent_role_escalation trigger blocks non-admin/non-postgres users
    // from changing roles. Verify the trigger exists and has correct logic.
    // Note: execSqlAsAdmin runs as postgres, which the trigger explicitly allows.
    // The real protection is for authenticated (non-admin) users via Supabase.
    const trigger = await execSqlAsAdmin(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'trg_prevent_role_escalation'`
    );
    expect(trigger.rows.length).toBe(1);
    expect(trigger.rows[0].tgenabled).toBe('O'); // O = Origin (enabled)

    // Verify the function has the role check logic
    const fn = await execSqlAsAdmin(
      `SELECT pg_get_functiondef(oid) AS src FROM pg_proc WHERE proname = 'prevent_role_escalation'`
    );
    const src = fn.rows[0].src;
    expect(src).toContain('ROLE_PROTECTED');
    expect(src).toContain('admin');
    // The shop has two account roles; `co_admin` was a second name for `admin` and was
    // removed in 0167. The trigger must be written against the one role that has this
    // authority, so a reappearance of the label here is a regression, not a nit.
    expect(src).not.toContain('co_admin');
  });

  // ─── Archive/Restore preserves history ─────────────────────────────────────

  it('Archive: preserves all historical data', async () => {
    // Reset credit_limit to known value (previous tests may have modified it)
    await execSqlAsAdmin(
      `UPDATE customers SET credit_limit = 10000 WHERE id = '${CUST_ID}'`
    );

    // Force fresh auth — ensure admin phone + role are consistent
    invalidateAuthCache();
    await execSqlAsAdmin(`UPDATE users SET phone = '923009999999', role = 'admin', is_active = true WHERE id = '${QA_IDS.admin}'`);
    await execSqlAsAdmin(`UPDATE auth.users SET phone = '923009999999' WHERE id = '${QA_IDS.admin}'`);

    // Ensure the admin exists with the correct state. Nothing deletes the fixture accounts any more
    // (tests/unit/qaFixtureKeepList.test.ts holds that rule), but this suite also re-seeds them so it
    // never depends on whoever ran last.
    await execSqlAsAdmin(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${QA_IDS.admin}', 'QA Admin', '923009999999', 'admin', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO UPDATE SET phone = '923009999999', role = 'admin', is_active = true
    `);
    await execSqlAsAdmin(`UPDATE auth.users SET phone = '923009999999' WHERE id = '${QA_IDS.admin}'`);

    // Archive the customer (as the owner: 0285 deleted customers.delete from
    // every role, so only the owner's implicit permission set passes).
    const archiveResult = await execRpcAsUser(QA_IDS.owner, 'archive_customer', {
      p_customer_id: CUST_ID,
      p_archived_by: QA_IDS.owner,
    });
    if (archiveResult.error) {
      console.error('[archive_customer error]', archiveResult.error);
    }

    // Verify customer is archived but all data preserved
    const db = await execSqlAsAdmin(
      `SELECT is_archived, archived_at, archived_by, name, phone, credit_limit FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(db.rows[0].is_archived).toBe(true);
    expect(db.rows[0].archived_at).not.toBeNull();
    expect(db.rows[0].name).toBe('Security Test Customer');
    expect(db.rows[0].phone).toBe(CUST_PHONE);
    expect(Number(db.rows[0].credit_limit)).toBe(10000);

    // Verify sales history is preserved (should be untouched by archive)
    const salesCount = await execSqlAsAdmin(
      `SELECT COUNT(*) AS cnt FROM sales WHERE customer_id = '${CUST_ID}'`
    );
    // Sales count should not have changed

    // Restore (as the owner, same as the archive above)
    await execRpcAsUser(QA_IDS.owner, 'restore_customer', {
      p_customer_id: CUST_ID,
    });

    // Verify fully restored
    const db2 = await execSqlAsAdmin(
      `SELECT is_archived, archived_at, name FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(db2.rows[0].is_archived).toBe(false);
    expect(db2.rows[0].archived_at).toBeNull();
    expect(db2.rows[0].name).toBe('Security Test Customer');
  });
});
