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
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { setupAllFixtures, cleanupTestData, QA_IDS } from '../setup/fixtures';
import { recordEvidence, printReport, clearEvidence } from '../setup/evidence';

// Use the admin user from fixtures for RPC calls
const ADMIN_ID = QA_IDS.admin;

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Credit Request Integration', () => {
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
    let rejectRequestId: string;

    it('should create and reject a credit request', async () => {
      // Create
      const created = await execRpcAsUser(ADMIN_ID, 'create_credit_limit_request', {
        payload: {
          customer_id: QA_IDS.customerB,
          customer_name: 'QA Customer B',
          requested_by: 'QA Employee',
          current_limit: 25000,
          requested_limit: 50000,
          reason: 'Reject test',
        },
      });
      rejectRequestId = created.data.id;

      // Reject
      const result = await execRpcAsUser(ADMIN_ID, 'reject_credit_limit_request', {
        p_request_id: rejectRequestId,
        p_reviewed_by: 'QA Admin',
        p_rejection_reason: 'Insufficient justification',
      });

      expect(result.error).toBeNull();
      expect(result.data.status).toBe('rejected');

      // Verify customer limit NOT changed
      const cust = await execSqlAsAdmin(
        `SELECT credit_limit FROM customers WHERE id = '${QA_IDS.customerB}'`
      );
      expect(parseFloat(cust.rows[0].credit_limit)).toBe(25000);

      recordEvidence(
        'Credit request rejected, customer limit unchanged',
        'status=rejected, credit_limit=25000 (unchanged)',
        `status=${result.data.status}, limit=${cust.rows[0].credit_limit}`,
        'reject_credit_limit_request RPC + SELECT customers',
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
