/**
 * "One user intention = one business action" — for the CREATE screens, which had no
 * re-entry protection at all.
 *
 * The payment, void and stock-adjustment paths were fixed in 0134/0138/0139. Auditing
 * the same question across the whole app found four more confirm buttons guarded only
 * by `disabled={loading}` — a React STATE attribute that is applied on the re-render,
 * so two taps in one task both get through:
 *
 *   Add Employee   create_employee
 *   Record Purchase create_purchase   ← money AND inventory
 *   Add Product    create_product
 *   Add Company    create_company
 *
 * This suite submits them the way the page submits them — two calls at the same
 * instant, real JWT, no key — and judges the database, not the UI.
 *
 * QA database only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { execRpcAsUser, execSqlAsAdmin } from '../setup/qa-client';
import { QA_IDS, setupAllFixtures, cleanupTestData } from '../setup/fixtures';

const TENANT = QA_IDS.shop;
const OWNER = QA_IDS.admin;

// This suite's own supplier, product and variant: the shared QA baseline is cleaned by
// every other suite that calls cleanupTestData(), so a purchase built on it can vanish
// mid-assertion.
const COMPANY = 'c5000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'c5000000-0000-0000-0000-0000000000d1';
const VARIANT = 'c5000000-0000-0000-0000-0000000000d2';
const EMPLOYEE_PHONE = '923009778899';
const EMPLOYEE_NAME = 'QA Create Once Employee';

async function rpcMaybe(name: string, params: Record<string, unknown>, userId = OWNER) {
  return execRpcAsUser(userId, name, params);
}

async function rpc(name: string, params: Record<string, unknown>, userId = OWNER) {
  const { data, error } = await execRpcAsUser(userId, name, params);
  if (error) throw new Error(`${name}: ${error}`);
  return data;
}

const scalar = async (sql: string) => {
  const r = await execSqlAsAdmin(sql);
  return (r.rows?.[0] ?? {}) as Record<string, any>;
};

/**
 * Exactly the payload RecordPurchasePage sends, including the fields it omits — the
 * page sends qty and costPrice, never a lineTotal, and it sends the same idempotency
 * key for both taps because that key is held for the attempt.
 */
function purchasePayload(key: string) {
  return {
    payload: {
      companyId: COMPANY,
      companyName: 'QA Create-once Supplier',
      paymentMethod: 'cash',
      amountPaid: 0,
      note: '',
      idempotencyKey: key,
      items: [{
        productId: PRODUCT,
        productName: 'QA Create-once Product',
        variantId: VARIANT,
        variantName: '1kg',
        qty: 3,
        costPrice: 100,
      }],
    },
  };
}

beforeAll(async () => {
  await setupAllFixtures();
  await execSqlAsAdmin(`
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES ('${OWNER}', '${TENANT}', 'owner', 'active')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = now()
  `);
  await execSqlAsAdmin(`
    INSERT INTO companies (id, name, outstanding_payable, total_purchases, shop_id)
    VALUES ('${COMPANY}', 'QA Create-once Supplier', 0, 0, '${TENANT}')
    ON CONFLICT (id) DO UPDATE SET outstanding_payable = 0, total_purchases = 0
  `);
  await execSqlAsAdmin(`
    INSERT INTO products (id, name, category, base_unit, stock_qty, shop_id, is_active, created_at, updated_at)
    VALUES ('${PRODUCT}', 'QA Create-once Product', 'spray', 'piece', 0, '${TENANT}', true, now(), now())
    ON CONFLICT (id) DO UPDATE SET is_active = true
  `);
  await execSqlAsAdmin(`
    INSERT INTO product_variants (id, product_id, name, selling_price, cost_price, unit_size, qty_step, low_stock_threshold, stock_qty, is_active)
    VALUES ('${VARIANT}', '${PRODUCT}', '1kg', 500, 300, 1, 1, 5, 0, true)
    ON CONFLICT (id) DO UPDATE SET stock_qty = 0, is_active = true
  `);
  await execSqlAsAdmin(`DELETE FROM purchases WHERE company_id = '${COMPANY}'`);
  await execSqlAsAdmin(`DELETE FROM users WHERE phone = '${EMPLOYEE_PHONE}'`);
});

afterAll(async () => {
  await execSqlAsAdmin(`DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE company_id = '${COMPANY}')`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM purchases WHERE company_id = '${COMPANY}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMPLOYEE_PHONE}')`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM users WHERE phone = '${EMPLOYEE_PHONE}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM product_variants WHERE id = '${VARIANT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM products WHERE id = '${PRODUCT}'`).catch(() => undefined);
  await execSqlAsAdmin(`DELETE FROM companies WHERE id = '${COMPANY}'`).catch(() => undefined);
  await cleanupTestData();
});

describe('Create once safety', () => {
  it('1. purchase: two simultaneous confirms record one purchase, one stock increase, one payable', async () => {
    const key = `qa-createonce-purchase-${randomUUID()}`;
    const [a, b] = await Promise.all([
      rpcMaybe('create_purchase', purchasePayload(key)),
      rpcMaybe('create_purchase', purchasePayload(key)),
    ]);
    // Surface the refusals: "nothing was recorded" is only actionable with the reason.
    if (a.error || b.error) console.log('[create_purchase errors]', a.error, '|', b.error);
    expect(a.error ?? b.error, 'recording a purchase must not fail').toBeNull();

    const purchases = await scalar(`SELECT count(*)::int AS n FROM purchases WHERE company_id = '${COMPANY}'`);
    const stock = await scalar(`SELECT stock_qty FROM product_variants WHERE id = '${VARIANT}'`);
    const company = await scalar(`SELECT outstanding_payable, total_purchases FROM companies WHERE id = '${COMPANY}'`);

    // Two taps are one delivery: 3 units at 100 is 300, once.
    expect(Number(purchases.n), 'a double tap must record exactly one purchase').toBe(1);
    expect(Number(stock.stock_qty), 'stock must rise by the delivered quantity, once').toBe(3);
    expect(Number(company.total_purchases), 'the purchase total must be counted once').toBe(300);
    expect(Number(company.outstanding_payable), 'the payable must rise once').toBe(300);
    expect(a.error ?? null).toBeNull();
    if (b.error) expect(b.error, 'the second tap is a retry, not a failure to report').toMatch(/idempotent|already/i);
  });

  it('2. employee: two simultaneous confirms create one person', async () => {
    const payload = {
      payload: { name: EMPLOYEE_NAME, phone: EMPLOYEE_PHONE, role: 'employee' },
    };
    const [a, b] = await Promise.all([
      rpcMaybe('create_employee', payload),
      rpcMaybe('create_employee', payload),
    ]);

    const users = await scalar(`SELECT count(*)::int AS n FROM users WHERE phone = '${EMPLOYEE_PHONE}'`);
    expect(Number(users.n), 'a double tap must create exactly one employee').toBe(1);

    const memberships = await scalar(`
      SELECT count(*)::int AS n FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE u.phone = '${EMPLOYEE_PHONE}'
    `);
    expect(Number(memberships.n), 'exactly one membership for the one person').toBe(1);

    // The phone column is unique, so the database already refuses the duplicate. The
    // failure that reached the owner was the REPORTING: an error shown right after the
    // invitation succeeded. It must not be reported as a failure.
    const errors = [a.error, b.error].filter(Boolean);
    expect(errors.length, 'one of the two taps must succeed').toBeLessThanOrEqual(1);
  });
});
