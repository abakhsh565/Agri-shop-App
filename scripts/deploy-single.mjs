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
const sql = readFileSync(process.argv[2], 'utf8');

// Strip leading comment lines (starting with --)
const cleanSql = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();

const { data, error } = await c.rpc('run_sql', { sql_query: cleanSql });
if (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}
console.log('Result:', data);
