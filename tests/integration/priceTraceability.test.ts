/**
 * Price Traceability
 *
 * The owner's rule, pinned so a future migration cannot quietly break it:
 *
 *   1. The newest purchase price becomes the product's CURRENT buying price, and
 *      a selling price quoted on that delivery becomes the CURRENT selling price.
 *   2. A completed sale keeps the EXACT cost and selling price of its own moment.
 *      Re-pricing a product later must never recalculate an old sale.
 *   3. Every purchase keeps its own original buying price.
 *
 * Why this matters: without (2) the owner's reported profit for past sales would
 * silently change every time they update a price, and without (1) the price they
 * type on a delivery would be recorded and then ignored.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSqlAsAdmin, execRpcAsUser } from '../setup/qa-client';

const OWNER_PHONE = '923001234567';
const NAME = 'QA-PRICEGUARD';
const stamp = Date.now().toString().slice(-6);

let ownerId = '';
let variantId = '';
let purchase1Id = '';
let sale1Id = '';

const sql = async (q: string) => (await execSqlAsAdmin(q)).rows;
const num = (v: any) => Number(v);
const rpc = async (name: string, payload: Record<string, any>) => {
  const { data, error } = await execRpcAsUser(ownerId, name, { payload: JSON.stringify({ ...payload, userId: ownerId }) });
  if (error) throw new Error(`${name}: ${error}`);
  return data;
};
const variantRow = async () =>
  (await sql(`SELECT stock_qty, cost_price, selling_price FROM product_variants WHERE id = '${variantId}'`))[0];

async function clean() {
  const like = `'${NAME}%'`;
  const steps = [
    `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ${like}))`,
    `DELETE FROM sales WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE ${like})`,
    `DELETE FROM customers WHERE name LIKE ${like}`,
    `DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE company_id IN (SELECT id FROM companies WHERE name LIKE ${like}))`,
    `DELETE FROM purchases WHERE company_id IN (SELECT id FROM companies WHERE name LIKE ${like})`,
    `DELETE FROM inventory_movements WHERE product_id IN (SELECT id FROM products WHERE name LIKE ${like})`,
    `DELETE FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE name LIKE ${like})`,
    `DELETE FROM products WHERE name LIKE ${like}`,
    `DELETE FROM companies WHERE name LIKE ${like}`,
  ];
  for (const s of steps) await execSqlAsAdmin(s).catch((cleanupError) => { console.warn("[cleanup] suppressed failure", cleanupError); });
}

beforeAll(async () => {
  await clean();
  const [owner] = await sql(`SELECT id FROM users WHERE phone = '${OWNER_PHONE}' LIMIT 1`);
  ownerId = owner?.id;
  if (!ownerId) throw new Error('QA owner fixture missing');

  const company = await rpc('create_company', {
    name: `${NAME} Supplier`, contactPerson: 'QA', phone: `0304${stamp}`, address: 'QA',
  });
  // baseUnit is part of the product contract, not decoration: since 0158/0161 a product is
  // measured in kg or liter (src/lib/packSize.ts keeps `piece` for legacy rows only), and
  // create_product rejects anything else with INVALID_UNIT. This fixture sent `piece`, which is
  // why the whole file used to skip — the fixture was older than the contract.
  const product = await rpc('create_product', {
    name: `${NAME} Fertilizer`, company: `${NAME} Supplier`, category: 'fertilizer',
    baseUnit: 'kg', stockQty: 0, actorId: ownerId,
    variants: [{ name: 'bag', sellingPrice: 0, costPrice: 0, unitSize: 1, qtyStep: 1, lowStockThreshold: 5, stockQty: 0 }],
  });
  const [variant] = await sql(`SELECT id FROM product_variants WHERE product_id = '${product.id}'`);
  variantId = variant.id;

  // 50 @ 200 with a quoted selling price of 300 — the owner's own example.
  const purchase = await rpc('create_purchase', {
    companyId: company.id, companyName: `${NAME} Supplier`, paymentMethod: 'cash', amountPaid: 0,
    note: '', idempotencyKey: `${NAME}-p1-${stamp}`,
    items: [{ productId: product.id, productName: `${NAME} Fertilizer`, variantId, variantName: 'bag', qty: 50, costPrice: 200, sellingPrice: 300 }],
  });
  purchase1Id = purchase.id;

  const customer = await rpc('create_customer', {
    name: `${NAME} Customer`, phone: `0316${stamp}`, address: 'QA', creditLimit: 100000,
  });
  const sale = await rpc('create_sale', {
    customerId: customer.id, customerName: `${NAME} Customer`, employeeId: ownerId, employeeName: 'QA Price',
    paymentType: 'full', paymentMethod: 'cash', amountPaid: 6000,
    idempotencyKey: `${NAME}-s1-${stamp}`,
    items: [{ productId: product.id, productName: `${NAME} Fertilizer`, variantId, variantName: 'bag', qty: 20, unitPrice: 300, unitSize: 1, baseUnit: 'kg' }],
  });
  sale1Id = sale.id;
});

afterAll(async () => {
  await clean();
});

describe('a purchase sets the product current price', () => {
  it('makes the delivery price the product buying price', async () => {
    expect(num((await variantRow()).cost_price)).toBe(200);
  });

  it('makes a quoted selling price the product selling price', async () => {
    expect(num((await variantRow()).selling_price)).toBe(300);
  });

  it('still receives the stock', async () => {
    expect(num((await variantRow()).stock_qty)).toBe(30); // 50 bought − 20 sold
  });

  it('keeps the purchase line at its own original buying price', async () => {
    const [line] = await sql(`SELECT unit_price FROM purchase_items WHERE purchase_id = '${purchase1Id}'`);
    expect(num(line.unit_price)).toBe(200);
  });
});

describe('a completed sale keeps the prices it was made at', () => {
  it('records the selling price used', async () => {
    const [line] = await sql(`SELECT unit_price FROM sale_items WHERE sale_id = '${sale1Id}'`);
    expect(num(line.unit_price)).toBe(300);
  });

  it('records the cost used, so profit is 100/unit', async () => {
    const [line] = await sql(`SELECT qty, line_total, cogs_amount FROM sale_items WHERE sale_id = '${sale1Id}'`);
    expect(num(line.cogs_amount)).toBe(4000); // 20 × 200
    expect(num(line.line_total) - num(line.cogs_amount)).toBe(2000);
  });

  it('does NOT rewrite the sale when the product is re-priced later', async () => {
    await rpc('update_product', {
      id: (await sql(`SELECT product_id FROM product_variants WHERE id = '${variantId}'`))[0].product_id,
      name: `${NAME} Fertilizer`, company: `${NAME} Supplier`, category: 'fertilizer',
      baseUnit: 'kg', actorId: ownerId,
      variants: [{ id: variantId, name: 'bag', sellingPrice: 400, costPrice: 280, unitSize: 1, qtyStep: 1, lowStockThreshold: 5 }],
    });

    // The product moved on…
    const v = await variantRow();
    expect(num(v.selling_price)).toBe(400);
    expect(num(v.cost_price)).toBe(280);

    // …the completed sale did not.
    const [line] = await sql(`SELECT unit_price, cogs_amount, line_total FROM sale_items WHERE sale_id = '${sale1Id}'`);
    expect(num(line.unit_price)).toBe(300);
    expect(num(line.cogs_amount)).toBe(4000);
    expect(num(line.line_total)).toBe(6000);

    // …and the purchase history still shows what was actually paid.
    const [purchaseLine] = await sql(`SELECT unit_price FROM purchase_items WHERE purchase_id = '${purchase1Id}'`);
    expect(num(purchaseLine.unit_price)).toBe(200);

    // Editing the catalogue must never move stock.
    expect(num(v.stock_qty)).toBe(30);
  });
});
