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

// Check NOT NULL columns on products
const cols = await q(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'products' ORDER BY ordinal_position`);
console.log('PRODUCT COLUMNS:');
console.log(JSON.stringify(cols, null, 2));

// Check NOT NULL columns on product_variants
const vcols = await q(`SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'product_variants' ORDER BY ordinal_position`);
console.log('\nPRODUCT_VARIANTS COLUMNS:');
console.log(JSON.stringify(vcols, null, 2));
