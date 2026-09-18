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

// Check process_return
const fn = await q("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'process_return' LIMIT 1");
console.log('process_return:', fn);

// Check create_purchase
const fn2 = await q("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'create_purchase' LIMIT 1");
console.log('create_purchase:', fn2);
