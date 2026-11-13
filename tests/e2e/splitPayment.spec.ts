/**
 * E2E Test: Split Payment Recording
 *
 * The app's Supabase client uses persistSession: false — no browser JWT.
 * RPCs use actorId from the Zustand store (injected via localStorage).
 * No Supabase Auth session injection needed.
 *
 * Uses the QA database (never production).
 */
import { test, expect } from './base';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  execSql,
  QA_IDS,
  cleanupFixtures,
  ownership,
  setupFixtures,
  trackOwned,
  injectAdminAuth,
} from './helpers';
import * as fs from 'fs';
import * as path from 'path';

// ─── Load QA env ────────────────────────────────────────────────────────────
function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.qa');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eqIdx = t.indexOf('=');
      if (eqIdx === -1) continue;
      if (!process.env[t.slice(0, eqIdx).trim()]) {
        process.env[t.slice(0, eqIdx).trim()] = t.slice(eqIdx + 1).trim();
      }
    }
  }
}
loadQaEnv();

const QA_URL = (process.env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '').trim();
const QA_SERVICE_ROLE = process.env.QA_SUPABASE_SERVICE_ROLE || '';
const BASE_URL = process.env.QA_APP_URL || 'http://localhost:5173';

const RUN = Date.now().toString(36);
const CUST_ID = randomUUID();
const CUST_PHONE = `923${RUN.slice(-8).padStart(8, '0')}`;
// The customer this lane opens is seeded owing this much, and the split below (5000 + 3000) is asserted
// against it. It was referenced but never defined, so the lane died in `beforeAll` with a ReferenceError
// before a single assertion ran. 20000 matches the sibling double-tap lane, which seeds the same way.
const INITIAL_BALANCE = 20000;
/** The employee created by the authorization test, so its Auth credential is removed in afterAll. */
let createdAuthUserId: string | null = null;

test.describe('Split Payment Recording', () => {
  test.beforeAll(async () => {
    await setupFixtures();
    await execSql(`
      INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
      VALUES ('${CUST_ID}', 'Split Pay Customer', '${CUST_PHONE}', 50000, ${INITIAL_BALANCE}, ${INITIAL_BALANCE}, 0, '${QA_IDS.shop}', 'QA')
      ON CONFLICT (id) DO NOTHING
    `);
    // OWNED: this run's own customer, by the id it generated. Its payments are removed through
    // `customer_payments.customer_id`, so they never have to be deleted table-wide here.
    await trackOwned(ownership(), 'customers', CUST_ID);
  });

  test.afterAll(async () => {
    // The two deletes that used to run here (payments by customer, then the customer) were scoped
    // to this lane already; they now go through the registry, in FK order, with failures raised
    // instead of swallowed.
    await cleanupFixtures();
    // The public row is gone; its Supabase Auth credential is not a table cleanup can register,
    // so it is removed by the id this run created — after the referencing row, never before.
    if (createdAuthUserId && QA_URL && QA_SERVICE_ROLE) {
      await createClient(QA_URL, QA_SERVICE_ROLE).auth.admin.deleteUser(createdAuthUserId);
    }
  });

  test('Split payment: full lifecycle from UI to DB', async ({ page }) => {
    // ─── Step 1: Inject admin auth + navigate ─────────────────────────
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await injectAdminAuth(page);

    // Navigate to customer list (triggers Zustand store bootstrap)
    await page.goto(`${BASE_URL}/employee/customers`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Split Pay Customer').first().waitFor({ timeout: 15000 });

    // ─── Step 2: Navigate to record payment ──────────────────────────
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}/record-payment`);
    await page.waitForLoadState('networkidle');
    await page.locator('text=Outstanding').first().waitFor({ timeout: 10000 });

    // ─── Step 3: Enable split payment ────────────────────────────────
    const splitToggle = page.locator('text=Split Payment').first();
    await expect(splitToggle).toBeVisible();
    await splitToggle.click();
    await page.waitForTimeout(500);

    // ─── Step 4: Enter split amounts ─────────────────────────────────
    const amountInputs = page.locator('input[type="number"]');
    await expect(amountInputs.nth(0)).toBeVisible();
    await amountInputs.nth(0).fill('5000');
    await amountInputs.nth(1).fill('3000');

    // ─── Step 5: Verify total ────────────────────────────────────────
    await expect(page.locator('text=8,000').first()).toBeVisible();

    // ─── Step 6: Submit ──────────────────────────────────────────────
    const confirmBtn = page.locator('button').filter({ hasText: /Confirm/ });
    await confirmBtn.click();

    // Wait for RPC call + potential navigation
    await page.waitForTimeout(5000);

    // ─── Step 7: Verify DB state ─────────────────────────────────────
    const custAfter = await execSql(
      `SELECT outstanding_balance, total_paid FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(Number(custAfter[0].outstanding_balance)).toBe(INITIAL_BALANCE - 8000);
    expect(Number(custAfter[0].total_paid)).toBe(8000);

    // ─── Step 8: Verify payment rows ─────────────────────────────────
    const payments = await execSql(
      `SELECT amount, method, payment_group_id, split_index, balance_after
       FROM customer_payments WHERE customer_id = '${CUST_ID}'
       ORDER BY split_index`
    );
    expect(payments.length).toBe(2);
    expect(Number(payments[0].amount)).toBe(5000);
    expect(payments[0].method).toBe('cash');
    expect(Number(payments[1].amount)).toBe(3000);
    expect(payments[1].method).toBe('bank_transfer');
    expect(payments[0].payment_group_id).toBe(payments[1].payment_group_id);

    // ─── Step 9: Reload and verify persistence ──────────────────────
    await page.reload();
    await page.waitForLoadState('networkidle');
    const custReload = await execSql(
      `SELECT outstanding_balance FROM customers WHERE id = '${CUST_ID}'`
    );
    expect(Number(custReload[0].outstanding_balance)).toBe(INITIAL_BALANCE - 8000);

    // ─── Step 10: Navigate to payment history ────────────────────────
    await page.goto(`${BASE_URL}/employee/customers/${CUST_ID}/payments`);
    await page.waitForLoadState('networkidle');
    const historyPayments = await execSql(
      `SELECT count(*)::int as cnt FROM customer_payments WHERE customer_id = '${CUST_ID}'`
    );
    expect(historyPayments[0].cnt).toBe(2);
  });

  test('Authorization: employee cannot record payment via RPC', async () => {
    // Verify RPC authorization using PostgREST (the real auth path).
    const empId = randomUUID();
    await execSql(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${empId}', 'E2E Employee', '92300E2E${RUN.slice(-6)}', 'employee', false, true, '${QA_IDS.shop}')
      ON CONFLICT (id) DO NOTHING
    `);
    // OWNED: the employee this run creates, by its explicit id (memberships follow the user key).
    await trackOwned(ownership(), 'users', empId);

    // Create auth user for employee
    const svcClient = createClient(QA_URL, QA_SERVICE_ROLE);
    const empEmail = `qa-emp-${RUN}@test.local`;
    const empPassword = `QA-emp-${RUN}!`;
    const { error: empCreateErr } = await svcClient.auth.admin.createUser({
      id: empId, email: empEmail, password: empPassword, email_confirm: true,
    });
    if (empCreateErr && !empCreateErr.message?.includes('already been registered')) {
      console.warn('Emp auth create warning:', empCreateErr.message);
    }
    createdAuthUserId = empId;

    // Sign in as employee via PostgREST
    const anonClient = createClient(QA_URL, process.env.QA_SUPABASE_ANON_KEY || '');
    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email: empEmail, password: empPassword,
    });
    expect(signInErr).toBeNull();
    expect(signInData?.session).toBeTruthy();

    // Try to record payment — should be blocked
    const { error } = await anonClient.rpc('record_customer_payment', {
      payload: { customerId: CUST_ID, amount: 100, method: 'cash', actorId: empId }
    });
    expect(error).toBeTruthy();
    expect(error!.message).toContain('NOT_AUTHORIZED');

    // Verify no payment was created
    const payments = await execSql(
      `SELECT count(*)::int as cnt FROM customer_payments WHERE customer_id = '${CUST_ID}'`
    );
    expect(payments[0].cnt).toBe(2);
  });
});
