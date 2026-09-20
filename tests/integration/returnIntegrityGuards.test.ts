/**
 * Return Integrity Guards Regression Suite
 *
 * Migration 0112 rewrote process_return to add the RBAC gate and follow the
 * variant-stock schema, and silently dropped every return rule with it: a
 * return could be made on a voided sale, for more than was sold, repeatedly
 * (double refund + double restock, even though the client sends an
 * idempotency_key), without a reason, and the refund amount was taken from a
 * caller-supplied unit price. 0130 restores them.
 *
 * These tests prove the rules BEHAVIOURALLY through the real RPC — each one
 * asserts both the rejection and that no row was written, because "it threw"
 * is not evidence that nothing was refunded.
 *
 * Business rules: BUSINESS-RULES.md §8 (Returns Rules).
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OWNER = 'c3000000-0000-0000-0000-000000000001';
const PHONE = '923009550001';

const CUSTOMER = 'c3000000-0000-0000-0000-00000000c001';
const PRODUCT = 'c3000000-0000-0000-0000-00000000d001';
const VARIANT = 'c3000000-0000-0000-0000-00000000e001';
const SALE = 'c3000000-0000-0000-0000-00000000a001';
const SALE_ITEM = 'c3000000-0000-0000-0000-00000000b001';
const SALE_VOIDED = 'c3000000-0000-0000-0000-00000000a002';
const SALE_ITEM_VOIDED = 'c3000000-0000-0000-0000-00000000b002';
const SALE_OTHER = 'c3000000-0000-0000-0000-00000000a003';

const SOLD_QTY = 10;
const SALE_PRICE = 100;

async function sql(query: string) {
  return execSqlAsAdmin(query);
}

async function returnRowCount(): Promise<number> {
  const r = await sql(`SELECT count(*)::int c FROM returns WHERE shop_id = '${TENANT}'`);
  return r.rows[0].c;
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    saleId: SALE,
    customerId: CUSTOMER,
    customerName: 'QA Return Customer',
    resolution: 'refund_cash',
    reason: 'QA damaged goods',
    items: [
      { saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 2, unitPrice: SALE_PRICE, restock: true },
    ],
    ...overrides,
  };
}

async function cleanup() {
  await sql(`DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM returns WHERE shop_id = '${TENANT}')`).catch(() => undefined);
  await sql(`DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE shop_id = '${TENANT}')`).catch(() => undefined);
  await sql(`DELETE FROM returns WHERE shop_id = '${TENANT}'`).catch(() => undefined);
  await sql(`DELETE FROM sale_items WHERE sale_id IN ('${SALE}','${SALE_VOIDED}','${SALE_OTHER}')`).catch(() => undefined);
  await sql(`DELETE FROM inventory_movements WHERE reference_id IN ('${SALE}','${SALE_VOIDED}','${SALE_OTHER}') OR product_id = '${PRODUCT}'`).catch(() => undefined);
  await sql(`DELETE FROM sales WHERE id IN ('${SALE}','${SALE_VOIDED}','${SALE_OTHER}')`).catch(() => undefined);
  await sql(`DELETE FROM product_variants WHERE id = '${VARIANT}'`).catch(() => undefined);
  await sql(`DELETE FROM products WHERE id = '${PRODUCT}'`).catch(() => undefined);
  await sql(`DELETE FROM customers WHERE id = '${CUSTOMER}'`).catch(() => undefined);
  await sql(`DELETE FROM users WHERE phone = '${PHONE}'`).catch(() => undefined);
}

beforeAll(async () => {
  await cleanup();

  await sql(`
    INSERT INTO users (id, name, phone, role, is_original_owner, is_active, shop_id)
    VALUES ('${OWNER}', 'QA Return Owner', '${PHONE}', 'admin', true, true, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET is_active = true, is_original_owner = true, shop_id = EXCLUDED.shop_id
  `);
  await sql(`
    INSERT INTO customers (id, name, phone, credit_limit, outstanding_balance, total_purchases, total_paid, shop_id, created_by)
    VALUES ('${CUSTOMER}', 'QA Return Customer', '923009550101', 100000, 0, 0, 0, '${TENANT}', 'QA')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO products (id, name, category, stock_qty, shop_id)
    VALUES ('${PRODUCT}', 'QA Return Product', 'seed', 100, '${TENANT}')
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, low_stock_threshold, stock_qty)
    VALUES ('${VARIANT}', '${PRODUCT}', '10kg', ${SALE_PRICE}, 60, 10, 5, 100)
    ON CONFLICT (id) DO NOTHING
  `);

  // A completed sale, its voided sibling, and an unrelated sale for the
  // "does this line belong to this sale" rule.
  await sql(`
    INSERT INTO sales (id, sale_number, employee_id, customer_id, customer_name_snapshot, total_amount, amount_paid, amount_due, payment_type, status, is_voided, shop_id, created_at)
    VALUES
      ('${SALE}',        'QA-RET-1', '${OWNER}', '${CUSTOMER}', 'QA Return Customer', ${SOLD_QTY * SALE_PRICE}, ${SOLD_QTY * SALE_PRICE}, 0,    'full', 'completed', false, '${TENANT}', now()),
      ('${SALE_VOIDED}', 'QA-RET-2', '${OWNER}', '${CUSTOMER}', 'QA Return Customer', 500, 500, 0, 'full', 'completed', true,  '${TENANT}', now()),
      ('${SALE_OTHER}',  'QA-RET-3', '${OWNER}', '${CUSTOMER}', 'QA Return Customer', 500, 500, 0, 'full', 'completed', false, '${TENANT}', now())
    ON CONFLICT (id) DO NOTHING
  `);
  await sql(`
    INSERT INTO sale_items (id, sale_id, product_id, product_name, variant_id, variant_name, qty, unit_price, unit_size, line_total)
    VALUES
      ('${SALE_ITEM}',        '${SALE}',        '${PRODUCT}', 'QA Return Product', '${VARIANT}', '10kg', ${SOLD_QTY}, ${SALE_PRICE}, 10, ${SOLD_QTY * SALE_PRICE}),
      ('${SALE_ITEM_VOIDED}', '${SALE_VOIDED}', '${PRODUCT}', 'QA Return Product', '${VARIANT}', '10kg', 5, ${SALE_PRICE}, 10, 500)
    ON CONFLICT (id) DO NOTHING
  `);
});

afterAll(async () => {
  await cleanup();
});

describe('Return integrity guards — restored and enforced by the database', () => {
  it('rejects a return on a voided sale, and writes nothing', async () => {
    const before = await returnRowCount();
    const r = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ saleId: SALE_VOIDED, items: [{ saleItemId: SALE_ITEM_VOIDED, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 1, unitPrice: SALE_PRICE, restock: true }] }),
    });
    expect(r.error).toMatch(/SALE_VOIDED/i);
    expect(await returnRowCount()).toBe(before);
  });

  it('rejects a return quantity above the sold quantity, and writes nothing', async () => {
    const before = await returnRowCount();
    const r = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ items: [{ saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: SOLD_QTY + 1, unitPrice: SALE_PRICE, restock: true }] }),
    });
    expect(r.error).toMatch(/EXCESS_RETURN/i);
    expect(await returnRowCount()).toBe(before);
  });

  it('rejects a line that belongs to a different sale', async () => {
    const before = await returnRowCount();
    const r = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ saleId: SALE_OTHER, items: [{ saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 1, unitPrice: SALE_PRICE, restock: true }] }),
    });
    expect(r.error).toMatch(/ITEM_NOT_OWNED/i);
    expect(await returnRowCount()).toBe(before);
  });

  it('rejects a refund priced above the sale line, and requires a reason', async () => {
    const before = await returnRowCount();

    const inflated = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ items: [{ saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 1, unitPrice: SALE_PRICE * 10, restock: true }] }),
    });
    expect(inflated.error).toMatch(/REFUND_EXCEEDS_SALE_PRICE/i);

    const noReason = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ reason: '' }),
    });
    expect(noReason.error).toMatch(/REASON_REQUIRED/i);

    expect(await returnRowCount()).toBe(before);
  });

  it('accepts a valid return, returns snake_case keys, and is idempotent per key', async () => {
    const key = `qa-ret-${Date.now()}`;
    const first = await execRpcAsUser(OWNER, 'process_return', {
      payload: { ...payload(), idempotency_key: key },
    });
    expect(first.error).toBeNull();
    // src/lib/db.ts maps data.return_number / data.total_refund.
    expect(first.data.return_number).toBeTruthy();
    expect(Number(first.data.total_refund)).toBe(2 * SALE_PRICE);
    expect(first.data.total_refund, 'the refund must not be NULL').not.toBeNull();

    // The stored row and the customer balance must agree with the response —
    // a NULL here used to propagate silently into outstanding_balance.
    const stored = await sql(`SELECT total_refund FROM returns WHERE id = '${first.data.id}'`);
    expect(Number(stored.rows[0].total_refund)).toBe(2 * SALE_PRICE);
    const bal = await sql(`SELECT outstanding_balance FROM customers WHERE id = '${CUSTOMER}'`);
    expect(bal.rows[0].outstanding_balance).not.toBeNull();

    const afterFirst = await returnRowCount();

    // A retry (double submit, or a retry after a timeout) must NOT refund again.
    const retry = await execRpcAsUser(OWNER, 'process_return', {
      payload: { ...payload(), idempotency_key: key },
    });
    expect(retry.error).toBeNull();
    expect(retry.data.id).toBe(first.data.id);
    expect(retry.data.idempotent).toBe(true);
    expect(await returnRowCount()).toBe(afterFirst);
    // A retry must report the ORIGINAL refund, not a NULL from the lookup path.
    expect(Number(retry.data.total_refund)).toBe(2 * SALE_PRICE);
  });

  it('accumulates repeated returns against the same sale line', async () => {
    // 2 already returned in the previous test; 8 is the last permitted remainder.
    const ok = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ items: [{ saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 8, unitPrice: SALE_PRICE, restock: true }] }),
    });
    expect(ok.error).toBeNull();

    const tooMany = await execRpcAsUser(OWNER, 'process_return', {
      payload: payload({ items: [{ saleItemId: SALE_ITEM, productId: PRODUCT, productName: 'QA Return Product', variantId: VARIANT, variantName: '10kg', qty: 1, unitPrice: SALE_PRICE, restock: true }] }),
    });
    expect(tooMany.error).toMatch(/EXCESS_RETURN/i);

    const total = await sql(`
      SELECT COALESCE(SUM(ri.qty_to_return), 0)::int c
      FROM return_items ri JOIN returns r ON r.id = ri.return_id
      WHERE ri.sale_item_id = '${SALE_ITEM}' AND r.sale_id = '${SALE}'
    `);
    expect(total.rows[0].c).toBe(SOLD_QTY);
  });
});
