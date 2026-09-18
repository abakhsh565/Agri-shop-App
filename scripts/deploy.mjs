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

async function runStatements(sql) {
  // Split by semicolons but handle $$ delimiters
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  for (const stmt of statements) {
    const { data, error } = await c.rpc('run_sql', { sql_query: stmt });
    if (error) {
      console.error(`ERROR in: ${stmt.substring(0, 80)}...`);
      console.error(`  ${error.message}`);
    } else {
      console.log(`OK: ${stmt.substring(0, 80)}...`);
    }
  }
}

await runStatements(sql);
console.log('Done');
