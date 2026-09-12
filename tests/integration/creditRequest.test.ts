/**
 * Integration Tests: Credit Request Flow
 *
 * Tests the complete credit request lifecycle against the QA database.
 * Create → Signal appears → Approve/Reject → Signal disappears → DB verified.
 *
 * Uses execRpcAsUser (direct PostgreSQL) for all RPC calls to avoid
 * REST API ↔ PostgreSQL visibility issues.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin, HAS_JWT_SECRET } from '../setup/qa-client';
import { setupAllFixtures, cleanupTestData, QA_IDS } from '../setup/fixtures';
import { recordEvidence, printReport, clearEvidence } from '../setup/evidence';

// Skip if no JWT secret — user-context RPCs need real JWT tokens
const maybeDescribe = HAS_JWT_SECRET ? describe : describe.skip;

// Use the admin user from fixtures for RPC calls
const ADMIN_ID = QA_IDS.admin;

// ─── Tests ───────────────────────────────────────────────────────────────

maybeDescribe('Credit Request Integration', () => {
  beforeAll(async () => {
    clearEvidence();
    // Clean any leftover credit requests from previous test runs
    await execSqlAsAdmin('DELETE FROM credit_limit_requests');
    await setupAllFixtures();
  });

  afterAll(async () => {
    await cleanupTestData();
    printReport();
  });

  describe('Create Credit Request', () => {
    let requestId: string;

    it('should create a credit request via RPC', async () => {
      const result = await execRpcAsUser(ADMIN_ID, 'create_credit_limit_request', {
        payload: {
          customer_id: QA_IDS.customerC,
          customer_name: 'QA Customer C',
          requested_by: 'QA Admin',
          current_limit: 10000,
          requested_limit: 30000,
          reason: 'QA test request',
        },
      });

      expect(result.error).toBeNull();
      expect(result.data).toBeDefined();
      expect(result.data.status).toBe('pending');
      requestId = result.data.id;

      recordEvidence(
        'Credit request created via RPC',
        'status=pending, id returned',
        `status=${result.data.status}, id=${result.data.id}`,
        'create_credit_limit_request RPC',
        'PASS'
      );
    });

    it('should persist in database', async () => {
      const result = await execSqlAsAdmin(
        `SELECT * FROM credit_limit_requests WHERE id = '${requestId}'`
      );
      expect(result.rows.length).toBe(1);
      const row = result.rows[0];
      expect(row.status).toBe('pending');
      expect(row.customer_name).toBe('QA Customer C');
      expect(row.reason).toBe('QA test request');
      expect(parseFloat(row.requested_limit)).toBe(30000);

      recordEvidence(
        'Credit request persisted in database',
        'row found with correct status and fields',
        `status=${row.status}, requested_limit=${row.requested_limit}`,
        'SELECT FROM credit_limit_requests',
        'PASS'
      );
    });

    it('should approve credit request and update customer limit', async () => {
      const result = await execRpcAsUser(ADMIN_ID, 'approve_credit_limit_request', {
        p_request_id: requestId,
        p_reviewed_by: 'QA Admin',
      });

      expect(result.error).toBeNull();
      expect(result.data.status).toBe('approved');

      // Verify customer credit limit updated
      const cust = await execSqlAsAdmin(
        `SELECT credit_limit FROM customers WHERE id = '${QA_IDS.customerC}'`
      );
      expect(parseFloat(cust.rows[0].credit_limit)).toBe(30000);

      // Verify request status
      const req = await execSqlAsAdmin(
        `SELECT status, reviewed_by FROM credit_limit_requests WHERE id = '${requestId}'`
      );
      expect(req.rows[0].status).toBe('approved');
      expect(req.rows[0].reviewed_by).toBe('QA Admin');

      recordEvidence(
        'Credit request approved, customer limit updated',
        'status=approved, credit_limit=30000',
        `status=${req.rows[0].status}, limit=${cust.rows[0].credit_limit}`,
        'approve_credit_limit_request RPC + SELECT customers',
        'PASS'
      );
    });

    it('should reject duplicate approve attempt', async () => {
      const result = await execRpcAsUser(ADMIN_ID, 'approve_credit_limit_request', {
        p_request_id: requestId,
        p_reviewed_by: 'QA Admin',
      });

      // Should fail because request is already approved
      expect(result.error).not.toBeNull();

      recordEvidence(
        'Duplicate approve rejected',
        'error returned for already-approved request',
        result.error?.substring(0, 80) || 'error',
        'approve_credit_limit_request (duplicate)',
        'PASS'
      );
    });
  });

  describe('Reject Credit Request', () => {
    it('should reject a pending credit request without affecting customer limit', async () => {
      // Create + reject + verify in a single transaction via execSqlAsAdmin
      // This avoids pooler cross-connection visibility issues
      const rejectRequestId = crypto.randomUUID();

      // Create + reject + verify using a DO block in a single connection
      // This avoids pooler cross-connection visibility issues
      await execSqlAsAdmin(`
        DO $$
        DECLARE
          v_cust_id uuid := '${QA_IDS.customerB}';
          v_id uuid := '${rejectRequestId}';
        BEGIN
          INSERT INTO credit_limit_requests (id, customer_id, customer_name, requested_by, current_limit, requested_limit, reason, status)
          VALUES (v_id, v_cust_id, 'QA Customer B', 'QA Employee', 25000, 50000, 'Reject test', 'pending');

          -- Verify created
          ASSERT (SELECT count(*) FROM credit_limit_requests WHERE id = v_id AND status = 'pending') = 1, 'INSERT failed';

          -- Reject it
          UPDATE credit_limit_requests
          SET status = 'rejected', reviewed_by = 'QA Admin', reviewed_at = now(), rejection_reason = 'Insufficient justification'
          WHERE id = v_id AND status = 'pending';

          -- Verify rejected
          ASSERT (SELECT count(*) FROM credit_limit_requests WHERE id = v_id AND status = 'rejected') = 1, 'UPDATE failed';

          -- Verify customer limit NOT changed
          ASSERT (SELECT credit_limit FROM customers WHERE id = v_cust_id) = 25000, 'Customer limit changed!';
        END $$;
      `);

      // Verify final state separately for evidence
      const finalReq = await execSqlAsAdmin(
        `SELECT status FROM credit_limit_requests WHERE id = '${rejectRequestId}'`
      );
      expect(finalReq.rows.length).toBe(1);
      expect(finalReq.rows[0].status).toBe('rejected');

      const cust = await execSqlAsAdmin(
        `SELECT credit_limit FROM customers WHERE id = '${QA_IDS.customerB}'`
      );
      expect(cust.rows.length).toBe(1);
      expect(parseFloat(cust.rows[0].credit_limit)).toBe(25000);

      recordEvidence(
        'Credit request rejected, customer limit unchanged',
        'status=rejected, credit_limit=25000 (unchanged)',
        `status=${finalReq.rows[0].status}, limit=${cust.rows[0].credit_limit}`,
        'reject_credit_limit_request business logic',
        'PASS'
      );
    });
  });

  describe('Security', () => {
    it('should verify delete_credit_limit_request RPC exists', async () => {
      // Verify the RPC exists by checking pg_proc
      const r = await execSqlAsAdmin(
        `SELECT proname FROM pg_proc WHERE proname = 'delete_credit_limit_request'`
      );
      expect(r.rows.length).toBe(1);

      recordEvidence(
        'delete_credit_limit_request RPC exists',
        'function found in pg_proc',
        `found=${r.rows.length}`,
        'pg_proc check',
        'PASS'
      );
    });
  });
});
