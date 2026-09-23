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

console.log('=== PRODUCTS (stock_qty) ===');
const { data: prods } = await c.from('products').select('id, name, stock_qty, is_active');
console.log(JSON.stringify(prods, null, 2));

console.log('\n=== PRODUCT VARIANTS (stock_qty) ===');
const { data: variants } = await c.from('product_variants').select('id, product_id, name, stock_qty, is_active');
console.log(JSON.stringify(variants, null, 2));

console.log('\n=== SALES ===');
const { data: sales } = await c.from('sales').select('id, total_amount, amount_paid, amount_due, is_voided');
console.log(JSON.stringify(sales, null, 2));

console.log('\n=== SALES ITEMS ===');
const { data: si } = await c.from('sale_items').select('id, sale_id, product_id, variant_id, qty, unit_price, line_total');
console.log(JSON.stringify(si, null, 2));

console.log('\n=== RETURNS ===');
const { data: rets } = await c.from('returns').select('*');
console.log(JSON.stringify(rets, null, 2));

console.log('\n=== CUSTOMER PAYMENTS ===');
const { data: cp } = await c.from('customer_payments').select('*');
console.log(JSON.stringify(cp, null, 2));

console.log('\n=== CUSTOMERS ===');
const { data: custs } = await c.from('customers').select('id, name, outstanding_balance, total_paid');
console.log(JSON.stringify(custs, null, 2));
