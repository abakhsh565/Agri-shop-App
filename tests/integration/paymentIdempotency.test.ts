/**
 * Behavioral tests for payment idempotency (migration 0080).
 *
 * Tests the server-side idempotency key mechanism:
 * - Same key → same result, no duplicate rows, no double balance deduction
 * - Different key → new payment allowed
 * - Concurrent duplicate → safe
 * - NULL key → backward compatible
 *
 * Uses execRpcAsUser for all RPC calls (real JWT auth path — production-like).
 * Uses execSqlAsAdmin for data verification reads (direct PG for immediate visibility).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';

/**
 * Cleanup that REPORTS instead of swallowing — the employeeInviteLifecycle pattern. The hooks here
 * called `throwIfCleanupFailed`, which was never defined, so the suite died on a ReferenceError
 * before its first assertion.
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

const TEST = {
  customer: randomUUID(),
  shop: '00000000-0000-0000-0000-000000000001',
  adminId: '10000000-0000-0000-0000-000000000001',
  initialBalance: 50000,
};

/**
 * Per-run fixture phone, derived from the random customer id.
 *
 * customers.phone is UNIQUE (migrations 0017/0046), but the fixture used to
 * pair a FIXED phone ('923000000001') with a randomUUID() id, and the INSERT
 * only declared ON CONFLICT (id) — so a leftover customer row holding that
 * phone (e.g. from a timed-out run whose afterAll cleanup never ran) made
 * every later run fail at suite setup with customers_phone_unique. Deriving
 * the phone from the per-run id makes the leftover row harmless: no run ever
 * reuses another run's phone. The 92399… namespace is reserved for this
 * suite — no other integration file uses it — so it can never collide with
 * another suite's fixed fixture phone either.
 */
const TEST_CUSTOMER_PHONE =
  '92399' + TEST.customer.replace(/[^0-9]/g, '').slice(0, 7).padStart(7, '0');

/** Call record_customer_payment via Supabase Auth RPC (real JWT path) */
async function callRecordPayment(payload: Record<string, any>) {
  const { data, error } = await execRpcAsUser(TEST.adminId, 'record_customer_payment', { payload });
  if (error) throw new Error(error);
  return data;
}

async function getBalance() {
  const r = await execSqlAsAdmin(
    `SELECT outstanding_balance, total_paid FROM customers WHERE id = '${TEST.customer}'`
  );
  const row = r.rows?.[0] ?? {};
  return { balance: Number(row.outstanding_balance ?? 0), totalPaid: Number(row.total_paid ?? 0) };
}

async function getPaymentCount(idempotencyKey?: string) {
  const where = idempotencyKey
    ? `WHERE idempotency_key = '${idempotencyKey}'`
    : `WHERE customer_id = '${TEST.customer}'`;
  const r = await execSqlAsAdmin(`SELECT count(*)::int as cnt FROM customer_payments ${where}`);
  return Number(r.rows?.[0]?.cnt ?? 0);
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
    await execSqlAsAdmin(`INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${TEST.adminId}', 'QA Admin', '923009999999', 'admin', true, true, '${TEST.shop}')
      ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = true`);
    await execSqlAsAdmin(`INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${TEST.customer}', 'Idempotency Test Customer', '${TEST_CUSTOMER_PHONE}', 50000, ${TEST.initialBalance}, 0, 0, '${TEST.shop}', 'QA')
      ON CONFLICT (id) DO UPDATE SET outstanding_balance = ${TEST.initialBalance}, total_paid = 0`);
      throwIfCleanupFailed('Payment Idempotency beforeAll cleanup');
});

  afterAll(async () => {
    await trySql('customer_payments', execSqlAsAdmin(`DELETE FROM customer_payments WHERE customer_id = '${TEST.customer}'`));
    await trySql('customers', execSqlAsAdmin(`DELETE FROM customers WHERE id = '${TEST.customer}'`));
    throwIfCleanupFailed('Payment Idempotency afterAll cleanup');
  });

  it('1. Normal single payment', async () => {
    const { result } = await recordPayment(1000, 'cash');
    expect(result).toBeTruthy();
    expect(result.balanceAfter).toBe(TEST.initialBalance - 1000);
    const { balance, totalPaid } = await getBalance();
    expect(balance).toBe(TEST.initialBalance - 1000);
    expect(totalPaid).toBe(1000);
  });

  it('2. Normal split payment', async () => {
    const { result } = await recordSplitPayment([
      { amount: 500, method: 'cash' },
      { amount: 300, method: 'bank_transfer' },
    ]);
    expect(result).toBeTruthy();
    const { balance } = await getBalance();
    expect(balance).toBe(TEST.initialBalance - 1000 - 800);
  });

  it('3. Duplicate retry with same idempotency key returns same result', async () => {
    const key = randomUUID();
    const first = await recordPayment(2000, 'cash', key);
    expect(first.result).toBeTruthy();
    expect(first.result.idempotent).toBeFalsy();
    const balanceAfterFirst = (await getBalance()).balance;
    const second = await recordPayment(2000, 'cash', key);
    expect(second.result).toBeTruthy();
    expect(second.result.idempotent).toBe(true);
    const balanceAfterSecond = (await getBalance()).balance;
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
    const count = await getPaymentCount(key);
    expect(count).toBe(1);
  });

  it('4. New idempotency key creates new payment', async () => {
    const balanceBefore = (await getBalance()).balance;
    const { result } = await recordPayment(500, 'cash');
    expect(result).toBeTruthy();
    expect(result.idempotent).toBeFalsy();
    const balanceAfter = (await getBalance()).balance;
    expect(balanceAfter).toBe(balanceBefore - 500);
  });

  it('5. Same customer with new key allows another payment', async () => {
    const balanceBefore = (await getBalance()).balance;
    const { result } = await recordPayment(250, 'bank_transfer');
    expect(result).toBeTruthy();
    const balanceAfter = (await getBalance()).balance;
    expect(balanceAfter).toBe(balanceBefore - 250);
  });

  it('6. NULL idempotency key allows payment (backward compatible)', async () => {
    const balanceBefore = (await getBalance()).balance;
    const result = await callRecordPayment({
      customerId: TEST.customer,
      amount: 100,
      method: 'cash',
      idempotency_key: null,
      actorId: TEST.adminId,
    });
    expect(result).toBeTruthy();
    const balanceAfter = (await getBalance()).balance;
    expect(balanceAfter).toBe(balanceBefore - 100);
  });

  it('7. Zero amount payment rejected', async () => {
    const balanceBefore = (await getBalance()).balance;
    const result = await callRecordPayment({
      customerId: TEST.customer,
      amount: 0,
      method: 'cash',
      idempotency_key: randomUUID(),
      actorId: TEST.adminId,
    });
    if (result && !result.error) {
      expect(result.balanceAfter ?? balanceBefore).toBe(balanceBefore);
    }
    const balanceAfter = (await getBalance()).balance;
    expect(balanceAfter).toBe(balanceBefore);
  });

  it('8. Negative amount: balance changes correctly', async () => {
    const balanceBefore = (await getBalance()).balance;
    try {
      await callRecordPayment({
        customerId: TEST.customer,
        amount: -100,
        method: 'cash',
        idempotency_key: randomUUID(),
        actorId: TEST.adminId,
      });
    } catch { /* RPC may reject */ }
    const balanceAfter = (await getBalance()).balance;
    // Balance should not change if rejected, or change by +100 if processed (negative = credit)
    const diff = balanceAfter - balanceBefore;
    expect(diff === 0 || diff === 100).toBe(true);
  });

  it('9. Non-existent customer rejected', async () => {
    // Held in a variable so the assertion can prove nothing was recorded for THIS id.
    const unknownCustomerId = randomUUID();
    let result: any;
    try {
      result = await callRecordPayment({
        customerId: unknownCustomerId,
        amount: 100,
        method: 'cash',
        idempotency_key: randomUUID(),
        actorId: TEST.adminId,
      });
    } catch (e: any) {
      // Migration 0192 runs the operational context checks BEFORE the payment function, so an
      // unknown id is refused by the guard: the inner CUSTOMER_NOT_FOUND is no longer reachable.
      // The requirement this case exists for is that the call is REFUSED, and that is what is
      // asserted. Accepting either message is not a relaxed assertion but the current contract;
      // the count below is what makes it non-vacuous — a refusal that still recorded a payment
      // would fail here.
      expect(e.message).toMatch(/CUSTOMER_NOT_FOUND|NOT_AUTHORIZED: (customer|tenant) access denied/);
      const { rows } = await execSqlAsAdmin(
        `SELECT count(*)::int AS n FROM customer_payments WHERE customer_id = '${unknownCustomerId}'`,
      );
      expect(rows[0].n, 'a refused payment must not be recorded').toBe(0);
      return;
    }
    expect(result?.error || !result).toBeTruthy();
  });

  it('10. All payments visible in history', async () => {
    const r = await execSqlAsAdmin(
      `SELECT count(*)::int as cnt FROM customer_payments WHERE customer_id = '${TEST.customer}'`
    );
    const count = Number(r.rows?.[0]?.cnt ?? 0);
    expect(count).toBeGreaterThanOrEqual(7);
  });

  it('11. Total paid in customer record matches sum of payments', async () => {
    const custR = await execSqlAsAdmin(`SELECT total_paid FROM customers WHERE id = '${TEST.customer}'`);
    const totalPaidCustomer = Number(custR.rows?.[0]?.total_paid ?? 0);
    const payR = await execSqlAsAdmin(`SELECT COALESCE(SUM(amount), 0)::numeric as total FROM customer_payments WHERE customer_id = '${TEST.customer}'`);
    const totalPayments = Number(payR.rows?.[0]?.total ?? 0);
    expect(totalPaidCustomer).toBeCloseTo(totalPayments, 0);
  });

  it('12. Concurrent duplicate submissions are safe', async () => {
    const key = randomUUID();
    const balanceBefore = (await getBalance()).balance;
    const results = await Promise.all([
      callRecordPayment({ customerId: TEST.customer, amount: 150, method: 'cash', idempotency_key: key, actorId: TEST.adminId }),
      callRecordPayment({ customerId: TEST.customer, amount: 150, method: 'cash', idempotency_key: key, actorId: TEST.adminId }),
      callRecordPayment({ customerId: TEST.customer, amount: 150, method: 'cash', idempotency_key: key, actorId: TEST.adminId }),
    ]);
    const idempotentCount = results.filter(r => r?.idempotent === true).length;
    const newCount = results.filter(r => r && !r.idempotent && r.balanceAfter !== undefined).length;
    expect(newCount).toBe(1);
    expect(idempotentCount).toBe(2);
    const balanceAfter = (await getBalance()).balance;
    expect(balanceAfter).toBe(balanceBefore - 150);
    const count = await getPaymentCount(key);
    expect(count).toBe(1);
  });

  it('13. Split payment idempotency — same key returns same result', async () => {
    const key = randomUUID();
    const balanceBefore = (await getBalance()).balance;
    const first = await recordSplitPayment([
      { amount: 200, method: 'cash' },
      { amount: 100, method: 'bank_transfer' },
    ], key);
    expect(first.result).toBeTruthy();
    const balanceAfterFirst = (await getBalance()).balance;
    expect(balanceAfterFirst).toBe(balanceBefore - 300);
    const second = await recordSplitPayment([
      { amount: 200, method: 'cash' },
      { amount: 100, method: 'bank_transfer' },
    ], key);
    expect(second.result?.idempotent).toBe(true);
    const balanceAfterSecond = (await getBalance()).balance;
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });

  it('14. Only one row per idempotency key in DB', async () => {
    const key = randomUUID();
    await recordPayment(50, 'cash', key);
    await recordPayment(50, 'cash', key);
    await recordPayment(50, 'cash', key);
    const count = await getPaymentCount(key);
    expect(count).toBe(1);
  });

  it('15. Payment amount is correct in DB row', async () => {
    const key = randomUUID();
    await recordPayment(777, 'bank_transfer', key);
    const r = await execSqlAsAdmin(`SELECT amount FROM customer_payments WHERE idempotency_key = '${key}'`);
    expect(r.rows?.length).toBe(1);
    expect(Number(r.rows?.[0]?.amount)).toBe(777);
  });
});
