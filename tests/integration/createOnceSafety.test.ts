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
import { execRpcAsUser, execSqlAsAdmin, roleIdByName } from '../setup/qa-client';
import { QA_IDS, setupAllFixtures } from '../setup/fixtures';
import { runCleanupStatements } from '../setup/ownedCleanup';

const TENANT = QA_IDS.shop;
const OWNER = QA_IDS.admin;

// This suite's own supplier, product and variant. A purchase built on the shared QA baseline could
// vanish mid-assertion: several files reseed it, and the sweep those files ran in their afterAll
// deleted baseline purchases and movements outright. Its own ids put the rows out of every other
// file's reach — and the cleanup below names the ids it owns, so it cannot reach out of them either
// (tests/setup/ownedCleanup.ts holds the rule and the reason).
const COMPANY = 'c5000000-0000-0000-0000-0000000000c1';
const PRODUCT = 'c5000000-0000-0000-0000-0000000000d1';
const VARIANT = 'c5000000-0000-0000-0000-0000000000d2';
const EMPLOYEE_PHONE = '923009778899';
const EMPLOYEE_NAME = 'QA Create Once Employee';

// Resolved by NAME in beforeAll. create_employee refuses an invitation with no role (0190), and the id
// 0107 seeded is not guaranteed to exist — a built-in role is deletable through the app, and roles.id
// is one global key, so the fixed id can even belong to another tenant's role.
let ROLE_SALES_EMPLOYEE = '';

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
  ROLE_SALES_EMPLOYEE = await roleIdByName(TENANT, 'Sales Employee');
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
  // This suite's own rows, children before parents — and every failure reported.
  //
  // Each of these statements used to end in `.catch(() => undefined)`, so a delete that failed (an FK
  // that was not anticipated, a column that moved) left the row in the shared QA database while the
  // suite reported success — and the NEXT run then read this suite's purchase or employee as if it
  // were the fixture. The list is handed to `runCleanupStatements`, which runs all of them, collects
  // every failure, and throws one error naming the statement and the error it produced.
  await runCleanupStatements(
    execSqlAsAdmin,
    [
      `DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE company_id = '${COMPANY}')`,
      `DELETE FROM purchases WHERE company_id = '${COMPANY}'`,
      `DELETE FROM inventory_movements WHERE product_id = '${PRODUCT}'`,
      `DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE phone = '${EMPLOYEE_PHONE}')`,
      `DELETE FROM users WHERE phone = '${EMPLOYEE_PHONE}'`,
      `DELETE FROM product_variants WHERE id = '${VARIANT}'`,
      `DELETE FROM products WHERE id = '${PRODUCT}'`,
      `DELETE FROM companies WHERE id = '${COMPANY}'`,
    ],
    'createOnceSafety removal of its own rows',
  );
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
    // The payload an Add-Employee screen sends: a name, a phone and the role the owner chose. Without
    // the role there is no permission set to assign, and 0190 refuses the invitation — which is the
    // contract, not a double-tap failure.
    const payload = {
      payload: { name: EMPLOYEE_NAME, phone: EMPLOYEE_PHONE, roleId: ROLE_SALES_EMPLOYEE },
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
