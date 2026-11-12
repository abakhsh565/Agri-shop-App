/**
 * Split Payment Recording — Behavioral Tests
 *
 * Tests schema, RPC logic, grouping, and balance correctness.
 *
 * All RPC calls go through the real authenticated path (execRpcAsUser → Supabase Auth JWT →
 * PostgREST → the SECURITY DEFINER function), the same way paymentIdempotency.test.ts does.
 *
 * This suite used to call record_customer_payment over a raw SQL connection and hand it a
 * fabricated `actorId` inside the payload. Migration 0112 removed caller-supplied actor trust on
 * purpose — the actor is derived from the JWT (`auth.uid()` / `app_current_user_id()`) — so on a
 * raw connection the function correctly answers NOT_AUTHENTICATED and every assertion here failed
 * with "expected +0 to be 1". The call path was stale, not the contract: production traffic has
 * always gone through the authenticated RPC, and so should the test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execRpcAsUser, execSqlAsAdmin } from "../setup/qa-client";

const TEST = {
  shop: "00000000-0000-0000-0000-000000000001",
  customerA: "aa000000-0000-0000-0000-0000000000a1",
  customerB: "aa000000-0000-0000-0000-0000000000b1",
  // The QA fixture admin the other authenticated-path suites use (paymentIdempotency).
  // getAuthClient() self-heals its auth credential from users.phone, so it needs a real phone.
  adminUser: "10000000-0000-0000-0000-000000000001",
  adminPhone: "923009999999",
};

async function q(sql: string) { return execSqlAsAdmin(sql); }

/**
 * Call record_customer_payment as the fixture admin, through the real JWT path.
 *
 * `actorId` is still sent for payload compatibility, but the server ignores it: identity comes
 * from the JWT, which is the whole point of 0112.
 */
async function recordPayment(payload: Record<string, unknown>) {
  const { data, error } = await execRpcAsUser(TEST.adminUser, "record_customer_payment", {
    payload: { ...payload, actorId: payload.actorId ?? TEST.adminUser },
  });
  if (error) throw new Error(error);
  if (data && typeof data === "object" && "error" in data && (data as any).error) {
    throw new Error(String((data as any).error));
  }
  return data;
}

describe("Split Payment Recording", () => {
  beforeAll(async () => {
    // Ensure the fixture admin exists (and keeps its phone, which the auth session is derived from)
    await execSqlAsAdmin(`
      INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
      VALUES ('${TEST.adminUser}', 'QA Admin', '${TEST.adminPhone}', 'admin', true, true, '${TEST.shop}')
      ON CONFLICT (id) DO UPDATE SET role = 'admin', is_active = true, phone = '${TEST.adminPhone}'
    `);

    // Create test customers
    await execSqlAsAdmin(`DELETE FROM customer_payments WHERE customer_id IN ('${TEST.customerA}', '${TEST.customerB}')`);
    await execSqlAsAdmin(`DELETE FROM customers WHERE id IN ('${TEST.customerA}', '${TEST.customerB}')`);
    await execSqlAsAdmin(`
      INSERT INTO customers (id, name, phone, outstanding_balance, credit_limit, total_purchases, total_paid, shop_id, created_by, created_at)
      VALUES
        ('${TEST.customerA}', 'Split Test A', '0300SPLIT101', 10000, 50000, 10000, 0, '${TEST.shop}', '${TEST.adminUser}', now()),
        ('${TEST.customerB}', 'Split Test B', '0300SPLIT102', 25000, 50000, 25000, 0, '${TEST.shop}', '${TEST.adminUser}', now())
    `);
  });

  afterAll(async () => {
    await execSqlAsAdmin(`DELETE FROM customer_payments WHERE customer_id IN ('${TEST.customerA}', '${TEST.customerB}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
    await execSqlAsAdmin(`DELETE FROM customers WHERE id IN ('${TEST.customerA}', '${TEST.customerB}')`).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
  });

  describe("Schema", () => {
    it("should have payment_group_id and split_index columns", async () => {
      const r = await q(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'customer_payments'
        AND column_name IN ('payment_group_id', 'split_index')
        ORDER BY column_name
      `);
      const cols = r.rows.map((x: any) => x.column_name);
      expect(cols).toContain("payment_group_id");
      expect(cols).toContain("split_index");
    });

    it("should have index on payment_group_id", async () => {
      const r = await q(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'customer_payments' AND indexname LIKE '%group%'
      `);
      expect(r.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Single Payment (Backward Compatibility)", () => {
    it("should record a single payment with amount+method", async () => {
      const before = await q(`SELECT outstanding_balance FROM customers WHERE id = '${TEST.customerA}'`);
      const bal = Number(before.rows[0].outstanding_balance);

      const result = await recordPayment({
        customerId: TEST.customerA,
        amount: 500,
        method: "cash",
        notes: "single payment test",
      });
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("balanceAfter");
      expect(result.balanceAfter).toBe(bal - 500);
    });

    it("should have payment_group_id = id for single payments", async () => {
      const r = await q(`
        SELECT id, payment_group_id, split_index FROM customer_payments
        WHERE customer_id = '${TEST.customerA}' AND notes = 'single payment test'
        ORDER BY created_at DESC LIMIT 1
      `);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].payment_group_id).toBe(r.rows[0].id);
      expect(r.rows[0].split_index).toBe(0);
    });
  });

  describe("Split Payment", () => {
    it("should record a split payment across two methods", async () => {
      const before = await q(`SELECT outstanding_balance FROM customers WHERE id = '${TEST.customerB}'`);
      const bal = Number(before.rows[0].outstanding_balance);

      const result = await recordPayment({
        customerId: TEST.customerB,
        splits: [
          { amount: 5000, method: "cash" },
          { amount: 3000, method: "bank_transfer" },
        ],
        notes: "split payment test",
      });

      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("balanceAfter");
      expect(result).toHaveProperty("splitCount", 2);
      expect(result).toHaveProperty("totalAmount", 8000);
      expect(result.balanceAfter).toBe(bal - 8000);
    });

    it("should create two rows with same payment_group_id", async () => {
      const r = await q(`
        SELECT payment_group_id, split_index, amount, method FROM customer_payments
        WHERE customer_id = '${TEST.customerB}' AND notes = 'split payment test'
        ORDER BY split_index
      `);
      expect(r.rows.length).toBe(2);
      expect(r.rows[0].payment_group_id).toBe(r.rows[1].payment_group_id);
      expect(r.rows[0].split_index).toBe(0);
      expect(r.rows[1].split_index).toBe(1);
      expect(Number(r.rows[0].amount)).toBe(5000);
      expect(Number(r.rows[1].amount)).toBe(3000);
      expect(r.rows[0].method).toBe("cash");
      expect(r.rows[1].method).toBe("bank_transfer");
    });

    it("should record same balance_after on all split rows", async () => {
      const r = await q(`
        SELECT balance_after FROM customer_payments
        WHERE customer_id = '${TEST.customerB}' AND notes = 'split payment test'
      `);
      const bals = r.rows.map((x: any) => Number(x.balance_after));
      expect(new Set(bals).size).toBe(1);
    });
  });

  describe("Three-Way Split", () => {
    it("should record a three-way split", async () => {
      const result = await recordPayment({
        customerId: TEST.customerB,
        splits: [
          { amount: 2000, method: "cash" },
          { amount: 1000, method: "bank_transfer" },
          { amount: 1000, method: "cash" },
        ],
        notes: "three-way split test",
      });
      expect(result.splitCount).toBe(3);
      expect(result.totalAmount).toBe(4000);
    });

    it("should create three rows for three-way split", async () => {
      const r = await q(`
        SELECT payment_group_id, split_index FROM customer_payments
        WHERE customer_id = '${TEST.customerB}' AND notes = 'three-way split test'
        ORDER BY split_index
      `);
      expect(r.rows.length).toBe(3);
      const groupIds = r.rows.map((x: any) => x.payment_group_id);
      expect(new Set(groupIds).size).toBe(1);
      expect(r.rows[0].split_index).toBe(0);
      expect(r.rows[1].split_index).toBe(1);
      expect(r.rows[2].split_index).toBe(2);
    });
  });

  describe("Validation", () => {
    it("should reject split with zero amount (balance unchanged)", async () => {
      const before = await q(`SELECT outstanding_balance FROM customers WHERE id = '${TEST.customerA}'`);
      const bal = Number(before.rows[0].outstanding_balance);
      try {
        await recordPayment({ customerId: TEST.customerA, splits: [{ amount: 0, method: "cash" }] });
      } catch { /* expected — run_sql may or may not propagate */ }
      const after = await q(`SELECT outstanding_balance FROM customers WHERE id = '${TEST.customerA}'`);
      expect(Number(after.rows[0].outstanding_balance)).toBe(bal);
    });

    it("should reject payment for non-existent customer (no rows created)", async () => {
      const fakeId = "00000000-0000-0000-0000-999999999999";
      const before = await q(`SELECT count(*)::int as cnt FROM customer_payments WHERE customer_id = '${fakeId}'`);
      const cnt = before.rows[0].cnt;
      try {
        await recordPayment({ customerId: fakeId, amount: 100, method: "cash" });
      } catch { /* expected */ }
      const after = await q(`SELECT count(*)::int as cnt FROM customer_payments WHERE customer_id = '${fakeId}'`);
      expect(after.rows[0].cnt).toBe(cnt);
    });
  });

  describe("Backward Compatibility", () => {
    it("should still work with old-style amount+method payload", async () => {
      const before = await q(`SELECT outstanding_balance FROM customers WHERE id = '${TEST.customerA}'`);
      const bal = Number(before.rows[0].outstanding_balance);

      const result = await recordPayment({
        customerId: TEST.customerA,
        amount: 200,
        method: "bank_transfer",
        notes: "backward compat test",
      });
      expect(result).toHaveProperty("id");
      expect(result.balanceAfter).toBe(bal - 200);
    });
  });
});
