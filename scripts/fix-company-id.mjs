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

const sql = "ALTER TABLE products ALTER COLUMN company_id DROP NOT NULL";
console.log('Running:', sql);
const { data, error } = await c.rpc('run_sql', { sql_query: sql });
console.log('Result:', data, error);

// Verify
const { data: d2 } = await c.rpc('run_sql', { sql_query: "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'company_id'" });
console.log('After fix:', d2);
