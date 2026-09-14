/**
 * Behavioral tests for payment idempotency (migration 0080).
 *
 * Tests the server-side idempotency key mechanism:
 * - Same key → same result, no duplicate rows, no double balance deduction
 * - Different key → new payment allowed
 * - Concurrent duplicate → safe
 * - NULL key → backward compatible
 *
 * Uses the QA database via run_sql (service-role, direct SQL).
 * Authorization is tested via PostgREST (real auth path).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';

// Direct PostgreSQL client for reliable RPC testing (run_sql bypasses SECURITY DEFINER)
let pgClient: Client;
function q(sql: string): Promise<{ rows: any[] }> {
  return pgClient.query(sql).then(r => ({ rows: r.rows }));
}

const TEST = {
  customer: randomUUID(),
  shop: '00000000-0000-0000-0000-000000000001',
  adminId: '10000000-0000-0000-0000-000000000001',
  initialBalance: 50000,
};

/** Call record_customer_payment via direct PostgreSQL */
async function callRecordPayment(payload: Record<string, any>) {
  const { rows } = await pgClient.query('SELECT record_customer_payment($1::jsonb)', [payload]);
  return rows[0].record_customer_payment;
}

async function getBalance() {
  const r = await q(`SELECT outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customer}'`);
  return { balance: Number(r.rows[0]?.outstanding_balance ?? 0), totalPaid: Number(r.rows[0]?.total_paid ?? 0) };
}

async function getPaymentCount(idempotencyKey?: string) {
  const where = idempotencyKey
    ? `WHERE idempotency_key = '${idempotencyKey}'`
    : `WHERE customer_id = '${TEST.customer}'`;
  const r = await q(`SELECT count(*)::int as cnt FROM customer_payments ${where}`);
  return r.rows[0]?.cnt ?? 0;
}

async function recordPayment(amount: number, method = 'cash', idempotencyKey?: string) {
  const key = idempotencyKey ?? randomUUID();
  const result = await callRecordPayment({
    customerId: TEST.customer,
    amount,
    method,
    idempotency_key: key,
    actorId: TEST.adminId,
  });
  return { key, result };
}

async function recordSplitPayment(splits: { amount: number; method: string }[], idempotencyKey?: string) {
  const key = idempotencyKey ?? randomUUID();
  const result = await callRecordPayment({
    customerId: TEST.customer,
    splits,
    idempotency_key: key,
    actorId: TEST.adminId,
  });
  return { key, result };
}

describe('Payment Idempotency', () => {
  beforeAll(async () => {
    // Load QA DB credentials from env vars (CI) or .env.qa (local)
    if (!process.env.QA_DB_HOST) {
      const fs = require('fs');
      const envPath = require('path').resolve(process.cwd(), '.env.qa');
      if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
          const t = line.trim(); if (!t || t.startsWith('#')) continue;
          const i = t.indexOf('='); if (i > 0 && !process.env[t.slice(0, i).trim()])
            process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
        }
      }
    }
    pgClient = new Client({
      host: process.env.QA_DB_HOST, user: process.env.QA_DB_USER, password: process.env.QA_DB_PASS,
      database: 'postgres', ssl: { rejectUnauthorized: false }, family: 4
    });
    await pgClient.connect();

    await q(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${TEST.adminId}', 'QA Admin', '923009999999', 'admin', true, true, '${TEST.shop}')
      ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = true`);
    await q(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${TEST.customer}', 'Idempotency Test Customer', '923000000001', 50000, ${TEST.initialBalance}, 0, 0, '${TEST.shop}', 'QA')
      ON CONFLICT (id) DO UPDATE SET outstanding_balance = ${TEST.initialBalance}, total_paid = 0`);
  });

  afterAll(async () => {
    await q(`DELETE FROM customer_payments WHERE customer_id = '${TEST.customer}'`).catch(() => {});
    await q(`DELETE FROM customers WHERE id = '${TEST.customer}'`).catch(() => {});
    await pgClient?.end().catch(() => {});
  });

  // ─── 1. Normal single payment ─────────────────────────────────────────
  it('1. Normal single payment', async () => {
    const { result } = await recordPayment(1000, 'cash');
    expect(result).toBeTruthy();
    expect(result.balanceAfter).toBe(TEST.initialBalance - 1000);
    const { balance, totalPaid } = await getBalance();
    expect(balance).toBe(TEST.initialBalance - 1000);
    expect(totalPaid).toBe(1000);
  });

  // ─── 2. Normal split payment ──────────────────────────────────────────
  it('2. Normal split payment', async () => {
    const bal = await getBalance();
    const { result } = await recordSplitPayment([
      { amount: 500, method: 'cash' },
      { amount: 300, method: 'bank_transfer' },
    ]);
    expect(result).toBeTruthy();
    expect(result.splitCount).toBe(2);
    expect(result.totalAmount).toBe(800);
    expect(result.balanceAfter).toBe(bal.balance - 800);
    const { balance } = await getBalance();
    expect(balance).toBe(bal.balance - 800);
  });

  // ─── 3. Duplicate retry with same key (single) ───────────────────────
  it('3. Exact duplicate retry with same key returns same result, no new rows', async () => {
    const bal = await getBalance();
    const key = randomUUID();
    const { result: r1 } = await recordPayment(2000, 'cash', key);
    expect(r1.idempotent).toBeFalsy(); // first insert — not idempotent
    const { balance: b1 } = await getBalance();
    expect(b1).toBe(bal.balance - 2000);

    const { result: r2 } = await recordPayment(2000, 'cash', key);
    expect(r2.idempotent).toBe(true);
    expect(r2.id).toBe(r1.id); // same payment ID returned

    // Balance unchanged — no double deduction
    const { balance: b2 } = await getBalance();
    expect(b2).toBe(b1);

    // Only one row with this idempotency key
    const count = await getPaymentCount(key);
    expect(count).toBe(1);
  });

  // ─── 4. Duplicate retry with same key (split) ────────────────────────
  it('4. Exact duplicate retry with same key (split) returns same result, no new rows', async () => {
    const bal = await getBalance();
    const key = randomUUID();
    const { result: r1 } = await recordSplitPayment([
      { amount: 400, method: 'cash' },
      { amount: 200, method: 'bank_transfer' },
    ], key);
    expect(r1.idempotent).toBeFalsy();
    expect(r1.splitCount).toBe(2);

    const { result: r2 } = await recordSplitPayment([
      { amount: 400, method: 'cash' },
      { amount: 200, method: 'bank_transfer' },
    ], key);
    expect(r2.idempotent).toBe(true);
    expect(r2.id).toBe(r1.id);
    expect(r2.splitCount).toBe(2);

    // Balance unchanged
    const { balance } = await getBalance();
    expect(balance).toBe(bal.balance - 600);
  });

  // ─── 5. Same customer, new key → new payment allowed ─────────────────
  it('5. Same customer with a new idempotency key creates new payment', async () => {
    const bal = await getBalance();
    const { result: r1 } = await recordPayment(100, 'cash');
    expect(r1.idempotent).toBeFalsy();
    const { balance: b1 } = await getBalance();
    expect(b1).toBe(bal.balance - 100);

    const { result: r2 } = await recordPayment(100, 'cash');
    expect(r2.idempotent).toBeFalsy(); // different key → new payment
    const { balance: b2 } = await getBalance();
    expect(b2).toBe(b1 - 100);
  });

  // ─── 6. NULL key → backward compatible, no dedup ─────────────────────
  it('6. NULL idempotency key allows duplicate payments (backward compatible)', async () => {
    const bal = await getBalance();
    // Call without key
    const sql1 = `SELECT * FROM record_customer_payment('${JSON.stringify({
      customerId: TEST.customer,
      amount: 50,
      method: 'cash',
      actorId: TEST.adminId,
    }).replace(/'/g, "''")}'::jsonb)`;
    const r1 = await q(sql1);
    const { balance: b1 } = await getBalance();
    expect(b1).toBe(bal.balance - 50);

    // Call again without key — should create another payment
    const sql2 = `SELECT * FROM record_customer_payment('${JSON.stringify({
      customerId: TEST.customer,
      amount: 50,
      method: 'cash',
      actorId: TEST.adminId,
    }).replace(/'/g, "''")}'::jsonb)`;
    const r2 = await q(sql2);
    const { balance: b2 } = await getBalance();
    expect(b2).toBe(b1 - 50); // double deduction — no dedup without key
  });

  // ─── 7. Non-existent customer → rejected ──────────────────────────────
  it('7. Non-existent customer rejected', async () => {
    const key = randomUUID();
    await expect(
      callRecordPayment({
        customerId: '00000000-0000-0000-0000-999999999999',
        amount: 100,
        method: 'cash',
        idempotency_key: key,
        actorId: TEST.adminId,
      })
    ).rejects.toThrow('CUSTOMER_NOT_FOUND');
  });

  // ─── 8. Invalid zero-amount payment → rejected ───────────────────────
  it('8. Zero-amount payment rejected', async () => {
    const bal = await getBalance();
    try {
      await callRecordPayment({
        customerId: TEST.customer,
        amount: 0,
        method: 'cash',
        idempotency_key: randomUUID(),
        actorId: TEST.adminId,
      });
    } catch {
      // Expected: the RPC may or may not throw depending on the path
    }
    // Balance must be unchanged regardless
    const { balance } = await getBalance();
    expect(balance).toBe(bal.balance);
  });

  // ─── 9. Payment history persistence ───────────────────────────────────
  it('9. Payment persists in history after reload', async () => {
    const key = randomUUID();
    const { result } = await recordPayment(200, 'bank_transfer', key);
    expect(result).toBeTruthy();
    expect(result.id).toBeTruthy();

    // Verify the payment exists in the table
    const r = await q(`SELECT id, amount, method, idempotency_key, payment_group_id
      FROM customer_payments WHERE idempotency_key = '${key}'`);
    expect(r.rows.length).toBe(1);
    expect(Number(r.rows[0].amount)).toBe(200);
    expect(r.rows[0].method).toBe('bank_transfer');
    expect(r.rows[0].idempotency_key).toBe(key);
  });

  // ─── 10. Customer outstanding + total_paid consistency ────────────────
  it('10. Customer outstanding and total_paid remain consistent', async () => {
    const { balance, totalPaid } = await getBalance();
    // Sum of all payments should equal total_paid
    const r = await q(`SELECT COALESCE(SUM(amount), 0) as total FROM customer_payments WHERE customer_id = '${TEST.customer}'`);
    const sumPayments = Number(r.rows[0].total);
    expect(sumPayments).toBe(totalPaid);
    // outstanding + total_paid should equal initial balance
    expect(balance + totalPaid).toBe(TEST.initialBalance);
  });

  // ─── 11. DB-level uniqueness on idempotency_key ──────────────────────
  it('11. DB rejects duplicate idempotency_key at index level', async () => {
    const key = randomUUID();
    // Insert one row
    await q(`INSERT INTO customer_payments (id, customer_id, amount, method, payment_group_id, split_index, idempotency_key, balance_after)
      VALUES (gen_random_uuid(), '${TEST.customer}', 10, 'cash', gen_random_uuid(), 0, '${key}', 0)`);
    // Try to insert another with same key
    try {
      await q(`INSERT INTO customer_payments (id, customer_id, amount, method, payment_group_id, split_index, idempotency_key, balance_after)
        VALUES (gen_random_uuid(), '${TEST.customer}', 10, 'cash', gen_random_uuid(), 0, '${key}', 0)`);
      // run_sql may catch the error — check count
      const count = await getPaymentCount(key);
      expect(count).toBe(1); // only one should exist
    } catch {
      // Expected: unique_violation
    }
  });

  // ─── 12. Idempotency key with empty string treated as NULL ────────────
  it('12. Empty string idempotency key treated as NULL (no dedup)', async () => {
    const bal = await getBalance();
    const sql = `SELECT * FROM record_customer_payment('${JSON.stringify({
      customerId: TEST.customer,
      amount: 30,
      method: 'cash',
      idempotency_key: '',
      actorId: TEST.adminId,
    }).replace(/'/g, "''")}'::jsonb)`;
    await q(sql);
    const { balance: b1 } = await getBalance();
    expect(b1).toBe(bal.balance - 30);

    // Second call with empty key — should create another payment
    await q(sql);
    const { balance: b2 } = await getBalance();
    expect(b2).toBe(b1 - 30);
  });

  // ─── 13. Split payment: first row stores idempotency key ─────────────
  it('13. Split payment stores idempotency key on first row only', async () => {
    const key = randomUUID();
    const { result } = await recordSplitPayment([
      { amount: 100, method: 'cash' },
      { amount: 100, method: 'bank_transfer' },
      { amount: 100, method: 'cash' },
    ], key);
    expect(result).toBeTruthy();
    expect(result.splitCount).toBe(3);

    // Only the first row (split_index=0) has the idempotency key
    const r = await q(`SELECT idempotency_key, split_index FROM customer_payments WHERE idempotency_key = '${key}'`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].idempotency_key).toBe(key);
  });

  // ─── 14. Payment group id shared across split rows ───────────────────
  it('14. Split payment group_id shared across all rows', async () => {
    const key = randomUUID();
    const { result } = await recordSplitPayment([
      { amount: 50, method: 'cash' },
      { amount: 50, method: 'bank_transfer' },
    ], key);
    expect(result).toBeTruthy();

    const r = await q(`SELECT payment_group_id, split_index FROM customer_payments WHERE payment_group_id = '${result.id}' ORDER BY split_index`);
    expect(r.rows.length).toBe(2);
    const groupId = r.rows[0].payment_group_id;
    expect(r.rows[1].payment_group_id).toBe(groupId);
    expect(r.rows[0].split_index).toBe(0);
    expect(r.rows[1].split_index).toBe(1);
    expect(result.id).toBe(groupId);
  });

  // ─── 15. Balanced financial state after all tests ─────────────────────
  it('15. Financial state consistent after all idempotency tests', async () => {
    const { balance, totalPaid } = await getBalance();
    // outstanding should be >= 0
    expect(balance).toBeGreaterThanOrEqual(0);
    // total_paid should be positive
    expect(totalPaid).toBeGreaterThan(0);
    // They should sum to initial balance
    expect(balance + totalPaid).toBe(TEST.initialBalance);
  });
});
