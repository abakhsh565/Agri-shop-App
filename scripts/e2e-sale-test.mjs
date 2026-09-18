import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const lines = readFileSync('.env.qa', 'utf8').split('\n');
const env = {};
for (const l of lines) {
  if (l.includes('=')) {
    const k = l.split('=')[0].trim();
    const v = l.split('=').slice(1).join('=').trim();
    env[k] = v;
  }
}

const c = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE);
const OWNER = 'bfb26cc6-b32c-4d8f-a0b9-ac69caa1e483';

async function q(sql) {
  const { data, error } = await c.rpc('run_sql', { sql_query: sql });
  if (error) throw new Error(`SQL: ${error.message}`);
  if (typeof data === 'string') { try { return JSON.parse(data); } catch { return data; } }
  return data;
}

async function rpc(name, payload) {
  const { data, error } = await c.rpc(name, { payload });
  if (error) throw new Error(`RPC ${name}: ${error.message}`);
  return data;
}

// Get test data IDs
const customers = await q("SELECT id, name, phone FROM customers ORDER BY created_at");
const variants = await q("SELECT pv.id, pv.name, pv.stock_qty, pv.selling_price, pv.cost_price, p.name as product FROM product_variants pv JOIN products p ON p.id = pv.product_id ORDER BY p.name, pv.name");
const companies = await q("SELECT id, name FROM companies ORDER BY created_at");

console.log('=== TEST DATA ===');
console.log('Customers:', customers.map(c => `${c.name} (${c.id.slice(0,8)})`).join(', '));
console.log('Variants:', variants.map(v => `${v.product}/${v.name} qty=${v.stock_qty} price=${v.selling_price}`).join(', '));
console.log('Companies:', companies.map(c => c.name).join(', '));

const CU1 = customers[0].id; // Ahmed Khan
const V500ml = variants.find(v => v.name === '500ml').id;
const V1L = variants.find(v => v.name === '1L').id;
const V50kg = variants.find(v => v.name === '50kg bag').id;
const V10kg = variants.find(v => v.name === '10kg pack').id;
const CO1 = companies[0].id; // Syngenta
const CO2 = companies[1].id; // Bayer

// ═══════════════════════════════════════════════════
// TEST 1: CREDIT SALE — 2 items
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 1: CREDIT SALE (2 items) ===');
const prKarate = variants.find(v=>v.name==='500ml').product;
const prWheat = variants.find(v=>v.name==='10kg pack').product;
const prIds = await q(`SELECT id, name FROM products`);
const PR_KARATE = prIds.find(p=>p.name==='Karate Insecticide').id;
const PR_WHEAT = prIds.find(p=>p.name==='Wheat Seed (Super)').id;
const PR_NPK = prIds.find(p=>p.name==='NPK Fertilizer').id;

const sale1 = await rpc('create_sale', {
  customerId: CU1,
  customerName: 'Ahmed Khan',
  paymentType: 'credit',
  paymentMethod: 'cash',
  amountPaid: 1200,
  items: [
    { productId: PR_KARATE, productName: 'Karate Insecticide', variantId: V500ml, variantName: '500ml', qty: 3, unitPrice: 1200, unitSize: 1, baseUnit: 'liter' },
    { productId: PR_WHEAT, productName: 'Wheat Seed (Super)', variantId: V10kg, variantName: '10kg pack', qty: 2, unitPrice: 1800, unitSize: 10, baseUnit: 'kg' },
  ],
  userId: OWNER,
});
console.log('Sale1:', JSON.stringify(sale1));
// Expected: total = 3*1200 + 2*1800 = 3600 + 3600 = 7200, paid=1200, outstanding=6000

const custAfterSale = await q(`SELECT name, outstanding_balance, total_paid, total_purchases FROM customers WHERE id = '${CU1}'`);
console.log('Customer after sale:', JSON.stringify(custAfterSale[0]));

const stockAfterSale = await q(`SELECT pv.name, pv.stock_qty FROM product_variants pv WHERE pv.id IN ('${V500ml}','${V10kg}') ORDER BY pv.name`);
console.log('Stock after sale:', JSON.stringify(stockAfterSale));
// Expected: 500ml: 10-3=7, 10kg: 15-2=13

const saleRecord = await q(`SELECT sale_number, total_amount, amount_paid, amount_due, payment_type, status FROM sales WHERE id = '${sale1.id}'`);
console.log('Sale record:', JSON.stringify(saleRecord[0]));

const saleItems = await q(`SELECT product_name, variant_name, qty, unit_price, line_total FROM sale_items WHERE sale_id = '${sale1.id}'`);
console.log('Sale items:', JSON.stringify(saleItems));

// ═══════════════════════════════════════════════════
// TEST 2: FULL PAYMENT
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 2: FULL PAYMENT (6000) ===');
const pay1 = await rpc('record_customer_payment', {
  customerId: CU1, amount: 6000, method: 'cash', notes: 'Full payment for sale 1', actorId: OWNER,
});
console.log('Payment:', JSON.stringify(pay1));

const custAfterPay = await q(`SELECT name, outstanding_balance, total_paid FROM customers WHERE id = '${CU1}'`);
console.log('Customer after payment:', JSON.stringify(custAfterPay[0]));
// Expected: outstanding=0, total_paid=6000+1200=7200

// ═══════════════════════════════════════════════════
// TEST 3: CASH SALE (fully paid)
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 3: CASH SALE (fully paid, multi-item) ===');
const sale2 = await rpc('create_sale', {
  customerId: CU1,
  customerName: 'Ahmed Khan',
  paymentType: 'full',
  paymentMethod: 'cash',
  amountPaid: 5400,
  items: [
    { productId: PR_KARATE, productName: 'Karate Insecticide', variantId: V1L, variantName: '1L', qty: 1, unitPrice: 2200, unitSize: 2, baseUnit: 'liter' },
    { productId: PR_NPK, productName: 'NPK Fertilizer', variantId: V50kg, variantName: '50kg bag', qty: 1, unitPrice: 3500, unitSize: 50, baseUnit: 'kg' },
  ],
  userId: OWNER,
});
console.log('Sale2:', JSON.stringify(sale2));
// Expected: total = 2200 + 3500 = 5700, paid=5400, outstanding=300

// ═══════════════════════════════════════════════════
// TEST 4: PARTIAL RETURN
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 4: PARTIAL RETURN on Sale 1 (return 1 of 3 Karate 500ml) ===');
const sale1Items = await q(`SELECT id, product_name, variant_name, qty, unit_price FROM sale_items WHERE sale_id = '${sale1.id}'`);
const karateItem = sale1Items.find(i => i.variant_name === '500ml');
console.log('Sale1 item to return:', JSON.stringify(karateItem));

const ret1 = await rpc('process_return', {
  saleId: sale1.id,
  customerId: CU1,
  customerName: 'Ahmed Khan',
  resolution: 'refund_cash',
  reason: 'Damaged product',
  items: [{ saleItemId: karateItem.id, productId: PR_KARATE, productName: 'Karate Insecticide', variantId: V500ml, variantName: '500ml', qty: 1, unitPrice: 1200, restock: true }],
});
console.log('Return:', JSON.stringify(ret1));
// Expected: refund = 1*1200 = 1200

const stockAfterReturn = await q(`SELECT pv.name, pv.stock_qty FROM product_variants pv WHERE pv.id IN ('${V500ml}','${V1L}','${V50kg}','${V10kg}') ORDER BY pv.name`);
console.log('Stock after return:', JSON.stringify(stockAfterReturn));

const custAfterReturn = await q(`SELECT name, outstanding_balance, total_paid FROM customers WHERE id = '${CU1}'`);
console.log('Customer after return:', JSON.stringify(custAfterReturn[0]));

// ═══════════════════════════════════════════════════
// TEST 5: PAYMENT REMAINDER
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 5: PAY REMAINDER on Sale 2 ===');
const pay2 = await rpc('record_customer_payment', {
  customerId: CU1, amount: 300, method: 'cash', notes: 'Remaining for sale 2', actorId: OWNER,
});
console.log('Payment:', JSON.stringify(pay2));

// ═══════════════════════════════════════════════════
// TEST 6: SUPPLIER PAYMENT
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 6: SUPPLIER PAYMENT ===');
const coAfterPurchase = await q(`SELECT name, outstanding_payable FROM companies WHERE id = '${CO1}'`);
console.log('Company before payment:', JSON.stringify(coAfterPurchase[0]));

// ═══════════════════════════════════════════════════
// TEST 7: VOID SALE
// ═══════════════════════════════════════════════════
console.log('\n=== TEST 7: VOID SALE 2 ===');
const { data: voidResult, error: voidErr } = await c.rpc('void_sale', { p_sale_id: sale2.id, p_reason: 'Customer changed mind', p_voided_by: OWNER });
if (voidErr) throw new Error(`RPC void_sale: ${voidErr.message}`);
console.log('Void:', JSON.stringify(voidResult));

const sale2After = await q(`SELECT sale_number, is_voided, status FROM sales WHERE id = '${sale2.id}'`);
console.log('Sale2 after void:', JSON.stringify(sale2After[0]));

// ═══════════════════════════════════════════════════
// FINAL STATE
// ═══════════════════════════════════════════════════
console.log('\n=== FINAL STATE ===');
const finalCust = await q(`SELECT name, outstanding_balance, total_paid, total_purchases FROM customers WHERE id = '${CU1}'`);
console.log('Final customer:', JSON.stringify(finalCust[0]));

const allSales = await q(`SELECT sale_number, total_amount, amount_paid, amount_due, payment_type, is_voided, status FROM sales ORDER BY created_at`);
console.log('All sales:', JSON.stringify(allSales));

const allPayments = await q(`SELECT amount, method, notes FROM customer_payments ORDER BY created_at`);
console.log('All payments:', JSON.stringify(allPayments));

const allReturns = await q(`SELECT return_number, total_refund, resolution, reason FROM returns ORDER BY created_at`);
console.log('All returns:', JSON.stringify(allReturns));

const finalStock = await q(`SELECT pv.name, p.name as product, pv.stock_qty FROM product_variants pv JOIN products p ON p.id = pv.product_id ORDER BY p.name, pv.name`);
console.log('Final stock:', JSON.stringify(finalStock));

const movements = await q(`SELECT movement_type, qty_change, reference_type FROM inventory_movements ORDER BY created_at`);
console.log('Inventory movements:', JSON.stringify(movements));

console.log('\n=== VERIFICATION ===');
// Ahmed Khan: outstanding should be 0 (all paid), total_paid should be 7200+300+300=7800
console.log('Customer outstanding:', Number(finalCust[0].outstanding_balance), '(expected 0)');
console.log('Customer total_paid:', Number(finalCust[0].total_paid), '(expected 7800)');
console.log('Sales count:', allSales.length, '(expected 2, one voided)');
console.log('Returns count:', allReturns.length, '(expected 1)');
console.log('Payments count:', allPayments.length, '(expected 3)');
