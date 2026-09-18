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

async function q(sql) {
  const { data, error } = await c.rpc('run_sql', { sql_query: sql });
  if (error) return `ERROR: ${error.message}`;
  if (typeof data === 'string') { try { return JSON.parse(data); } catch { return data; } }
  return data;
}

async function rpc(name, payload) {
  const { data, error } = await c.rpc(name, { payload });
  if (error) throw new Error(`RPC ${name}: ${error.message}`);
  return data;
}

const SHOP = '00000000-0000-0000-0000-000000000001';
const OWNER = 'bfb26cc6-b32c-4d8f-a0b9-ac69caa1e483';

console.log('=== STEP 1: Create Company ===');
const company = await rpc('create_company', {
  name: 'E2E Test Pharma Ltd',
  contactPerson: 'Dr. Ali',
  phone: '03211234567',
  address: 'Lahore',
  userId: OWNER,
});
console.log('Company:', JSON.stringify(company));

console.log('\n=== STEP 2: Create Customer ===');
const customer = await rpc('create_customer', {
  name: 'E2E Test Farmer',
  phone: '0300' + Date.now().toString().slice(-7),
  address: 'Faisalabad',
  creditLimit: 50000,
  userId: OWNER,
});
console.log('Customer:', JSON.stringify(customer));

console.log('\n=== STEP 3: Create Product ===');
const product = await rpc('create_product', {
  name: 'E2E Test Insecticide',
  company: 'E2E Test Pharma Ltd',
  category: 'spray',
  baseUnit: 'liter',
  stockQty: 0,
  variants: [
    { name: '500ml', sellingPrice: 1200, costPrice: 800, unitSize: 1, qtyStep: 1, lowStockThreshold: 5, stockQty: 0 }
  ],
  userId: OWNER,
});
console.log('Product:', JSON.stringify(product));

// Get the variant ID
const variants = await q(`SELECT id, name, stock_qty, selling_price, cost_price FROM product_variants WHERE product_id = '${product.id}'`);
const variant = variants[0];
console.log('Variant:', JSON.stringify(variant));

console.log('\n=== STEP 4: Create Sale (credit) ===');
const sale = await rpc('create_sale', {
  customerId: customer.id,
  customerName: 'E2E Test Farmer',
  paymentType: 'credit',
  paymentMethod: 'cash',
  amountPaid: 1200,
  userId: OWNER,
  items: [{
    productId: product.id,
    productName: 'E2E Test Insecticide',
    variantId: variant.id,
    variantName: '500ml',
    qty: 2,
    unitPrice: 1200,
    unitSize: 1,
    baseUnit: 'liter',
  }],
  userId: OWNER,
});
console.log('Sale:', JSON.stringify(sale));

console.log('\n=== STEP 5: Verify Stock After Sale ===');
const stockAfterSale = await q(`SELECT stock_qty FROM product_variants WHERE id = '${variant.id}'`);
console.log('Stock after sale:', JSON.stringify(stockAfterSale));

console.log('\n=== STEP 6: Verify Customer Outstanding ===');
const custAfterSale = await q(`SELECT name, outstanding_balance, total_paid FROM customers WHERE id = '${customer.id}'`);
console.log('Customer after sale:', JSON.stringify(custAfterSale));

console.log('\n=== STEP 7: Record Customer Payment ===');
const payment = await rpc('record_customer_payment', {
  customerId: customer.id,
  amount: 1200,
  method: 'cash',
  notes: 'Full payment for sale',
  actorId: OWNER,
});
console.log('Payment:', JSON.stringify(payment));

console.log('\n=== STEP 8: Verify Customer After Payment ===');
const custAfterPay = await q(`SELECT name, outstanding_balance, total_paid FROM customers WHERE id = '${customer.id}'`);
console.log('Customer after payment:', JSON.stringify(custAfterPay));

console.log('\n=== STEP 9: Process Return ===');
const saleItems = await q(`SELECT id, variant_id, product_id, qty, unit_price FROM sale_items WHERE sale_id = '${sale.id}'`);
console.log('Sale items:', JSON.stringify(saleItems));

const ret = await rpc('process_return', {
  saleId: sale.id,
  customerId: customer.id,
  customerName: 'E2E Test Farmer',
  resolution: 'refund_cash',
  reason: 'Quality issue',
  items: [{
    saleItemId: saleItems[0].id,
    productId: product.id,
    productName: 'E2E Test Insecticide',
    variantId: variant.id,
    variantName: '500ml',
    qty: 1,
    unitPrice: 1200,
    restock: true,
  }],
});
console.log('Return:', JSON.stringify(ret));

console.log('\n=== STEP 10: Verify Stock After Return ===');
const stockAfterReturn = await q(`SELECT stock_qty FROM product_variants WHERE id = '${variant.id}'`);
console.log('Stock after return:', JSON.stringify(stockAfterReturn));

console.log('\n=== STEP 11: Verify Inventory Movements ===');
const movements = await q(`SELECT product_name, adjustment_type, qty_before, qty_change, qty_after FROM inventory_movements WHERE product_id = '${product.id}' ORDER BY created_at`);
console.log('Inventory movements:', JSON.stringify(movements));

console.log('\n=== STEP 12: Verify Financial State ===');
const finalCustomer = await q(`SELECT name, outstanding_balance, total_paid FROM customers WHERE id = '${customer.id}'`);
console.log('Final customer:', JSON.stringify(finalCustomer));

const companyAfter = await q(`SELECT name, outstanding_payable FROM companies WHERE id = '${company.id}'`);
console.log('Company:', JSON.stringify(companyAfter));

const productAfter = await q(`SELECT name, stock_qty FROM products WHERE id = '${product.id}'`);
console.log('Product:', JSON.stringify(productAfter));

console.log('\n=== STEP 13: Verify Sales History ===');
const sales = await q(`SELECT id, total_amount, amount_paid, outstanding_balance, payment_type FROM sales WHERE id = '${sale.id}'`);
console.log('Sale record:', JSON.stringify(sales));

const returns = await q(`SELECT return_number, total_refund, resolution FROM returns WHERE sale_id = '${sale.id}'`);
console.log('Return record:', JSON.stringify(returns));

console.log('\n=== VERIFICATION SUMMARY ===');
const stockOk = Number(stockAfterReturn[0]?.stock_qty) === 1; // started 0, sold 2, returned 1 = -1? No, variant started at 0 stock_qty in create
const outstanding = Number(finalCustomer[0]?.outstanding_balance);
const paid = Number(finalCustomer[0]?.total_paid);

console.log('Stock after sale+return:', Number(stockAfterSale[0]?.stock_qty), '->', Number(stockAfterReturn[0]?.stock_qty));
console.log('Customer outstanding:', outstanding);
console.log('Customer total_paid:', paid);
console.log('Company payable:', Number(companyAfter[0]?.outstanding_payable));

const allOk = outstanding === 0 && paid === 1200;
console.log('Financial integrity:', allOk ? 'PASS' : 'FAIL');
