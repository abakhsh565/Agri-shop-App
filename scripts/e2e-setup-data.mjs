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

// REFUSAL, AND WHY IT IS HERE. This script TRUNCATEs fourteen business tables. Until now its only
// protection was that it read `.env.qa` — implicit, and an implicit protection is not one: whatever
// that file happened to hold was the target. A script that can destroy rows must refuse a target it
// was not meant for, in code (docs/PRODUCTION_DATA_POLICY.md, enforced by
// tests/unit/productionDataPolicy.test.ts).
const QA_PROJECT_REF = 'bpybjrjenwccowvtrevu';
const projectRef = String(env.QA_SUPABASE_URL || '').match(/^https:\/\/([a-z]{20})\.supabase\.co/)?.[1] ?? '';
if (projectRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: QA_SUPABASE_URL points at "${projectRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(1);
}

const c = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE);
const SHOP = '00000000-0000-0000-0000-000000000001';
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

// Clean slate
const tables = ['return_items','returns','sale_items','sales','stock_adjustments','inventory_movements','customer_payments','product_variants','products','customers','companies','purchases','purchase_items','supplier_payments'];
for (const t of tables) await q(`TRUNCATE TABLE ${t} CASCADE`);
console.log('✓ Clean slate');

// 1. Companies
const co1 = await rpc('create_company', { name: 'Syngenta Pakistan', contactPerson: 'Ali Khan', phone: '03211234567', address: 'Lahore', userId: OWNER });
const co2 = await rpc('create_company', { name: 'Bayer CropScience', contactPerson: 'Sara Ahmed', phone: '03217654321', address: 'Karachi', userId: OWNER });
console.log('✓ Companies:', co1.name, co2.name);

// 2. Customers
const cu1 = await rpc('create_customer', { name: 'Ahmed Khan', phone: '03001112222', address: 'Faisalabad', creditLimit: 100000, userId: OWNER });
const cu2 = await rpc('create_customer', { name: 'Fatima Bibi', phone: '03003334444', address: 'Multan', creditLimit: 50000, userId: OWNER });
const cu3 = await rpc('create_customer', { name: 'Usman Ali', phone: '03005556666', address: 'Sahiwal', userId: OWNER });
console.log('✓ Customers:', cu1.name, cu2.name, cu3.name);

// 3. Products with variants and stock
const pr1 = await rpc('create_product', { name: 'Karate Insecticide', company: 'Syngenta Pakistan', category: 'spray', baseUnit: 'liter', stockQty: 0, variants: [{ name: '500ml', sellingPrice: 1200, costPrice: 800, unitSize: 1, qtyStep: 1, lowStockThreshold: 5, stockQty: 0 }, { name: '1L', sellingPrice: 2200, costPrice: 1500, unitSize: 2, qtyStep: 1, lowStockThreshold: 3, stockQty: 0 }], userId: OWNER });
const pr2 = await rpc('create_product', { name: 'NPK Fertilizer', company: 'Bayer CropScience', category: 'fertilizer', baseUnit: 'kg', stockQty: 0, variants: [{ name: '50kg bag', sellingPrice: 3500, costPrice: 2800, unitSize: 50, qtyStep: 1, lowStockThreshold: 2, stockQty: 0 }], userId: OWNER });
const pr3 = await rpc('create_product', { name: 'Wheat Seed (Super)', company: 'Syngenta Pakistan', category: 'seed', baseUnit: 'kg', stockQty: 0, variants: [{ name: '10kg pack', sellingPrice: 1800, costPrice: 1400, unitSize: 10, qtyStep: 1, lowStockThreshold: 5, stockQty: 0 }], userId: OWNER });
console.log('✓ Products:', pr1.name, pr2.name, pr3.name);

// Get variant IDs
const v1 = (await q(`SELECT id, name FROM product_variants WHERE product_id = '${pr1.id}' ORDER BY name`));
const v2 = (await q(`SELECT id, name FROM product_variants WHERE product_id = '${pr2.id}'`));
const v3 = (await q(`SELECT id, name FROM product_variants WHERE product_id = '${pr3.id}'`));
console.log('✓ Variants:', v1.map(v=>v.name).join(', '), v2[0].name, v3[0].name);

// 4. Stock products via purchase
const pur1 = await rpc('create_purchase', {
  companyId: co1.id, companyName: 'Syngenta Pakistan', paymentMethod: 'cash', amountPaid: 15000, userId: OWNER,
  items: [
    { productId: pr1.id, productName: 'Karate Insecticide', variantId: v1[0].id, variantName: '500ml', qty: 20, costPrice: 800, unitSize: 1, baseUnit: 'liter', lineTotal: 16000 },
    { productId: pr1.id, productName: 'Karate Insecticide', variantId: v1[1].id, variantName: '1L', qty: 10, costPrice: 1500, unitSize: 2, baseUnit: 'liter', lineTotal: 15000 },
    { productId: pr3.id, productName: 'Wheat Seed (Super)', variantId: v3[0].id, variantName: '10kg pack', qty: 15, costPrice: 1400, unitSize: 10, baseUnit: 'kg', lineTotal: 21000 },
  ]
});
console.log('✓ Purchase 1:', pur1.purchaseNumber, 'total:', pur1.totalAmount);

const pur2 = await rpc('create_purchase', {
  companyId: co2.id, companyName: 'Bayer CropScience', paymentMethod: 'bank_transfer', amountPaid: 14000, userId: OWNER,
  items: [
    { productId: pr2.id, productName: 'NPK Fertilizer', variantId: v2[0].id, variantName: '50kg bag', qty: 10, costPrice: 2800, unitSize: 50, baseUnit: 'kg', lineTotal: 28000 },
  ]
});
console.log('✓ Purchase 2:', pur2.purchaseNumber, 'total:', pur2.totalAmount);

// Verify stock
const stockCheck = await q(`SELECT pv.name, pv.stock_qty, p.name as product FROM product_variants pv JOIN products p ON p.id = pv.product_id ORDER BY p.name, pv.name`);
console.log('✓ Stock after purchases:', JSON.stringify(stockCheck));

// Output IDs for browser tests
console.log('\n=== IDS FOR BROWSER TESTS ===');
console.log(`CUSTOMER_1=${cu1.id}`);
console.log(`CUSTOMER_2=${cu2.id}`);
console.log(`CUSTOMER_3=${cu3.id}`);
console.log(`PRODUCT_1=${pr1.id}`);
console.log(`VARIANT_1_500ml=${v1[0].id}`);
console.log(`VARIANT_1_1L=${v1[1].id}`);
console.log(`PRODUCT_2=${pr2.id}`);
console.log(`VARIANT_2=${v2[0].id}`);
console.log(`PRODUCT_3=${pr3.id}`);
console.log(`VARIANT_3=${v3[0].id}`);
console.log(`COMPANY_1=${co1.id}`);
console.log(`COMPANY_2=${co2.id}`);
console.log(`PURCHASE_1=${pur1.id}`);
console.log(`PURCHASE_2=${pur2.id}`);
