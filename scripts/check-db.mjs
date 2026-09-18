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
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { return data; }
  }
  return data;
}

console.log('=== COMPANIES ===');
console.log(JSON.stringify(await q('SELECT id, name, shop_id FROM companies'), null, 2));

console.log('\n=== CUSTOMERS ===');
console.log(JSON.stringify(await q('SELECT id, name, shop_id FROM customers WHERE is_archived = false'), null, 2));

console.log('\n=== PRODUCTS ===');
console.log(JSON.stringify(await q('SELECT id, name, shop_id FROM products WHERE is_active = true'), null, 2));

console.log('\n=== MEMBERSHIPS ===');
console.log(JSON.stringify(await q('SELECT id, user_id, tenant_id, role, status FROM memberships'), null, 2));

console.log('\n=== AUTH USERS ===');
console.log(JSON.stringify(await q('SELECT id, email, phone FROM auth.users'), null, 2));

console.log('\n=== USERS ===');
console.log(JSON.stringify(await q('SELECT id, name, phone, role, shop_id FROM users'), null, 2));
