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
const sql = readFileSync('supabase/migrations/0104_create_employee_rpc.sql', 'utf8');

// Split by semicolons but handle $$ blocks
const stmts = [];
let current = '';
let inDollar = false;
for (const line of sql.split('\n')) {
  if (line.includes('$$')) {
    inDollar = !inDollar;
  }
  current += line + '\n';
  if (line.trim().endsWith(';') && !inDollar) {
    stmts.push(current.trim());
    current = '';
  }
}
if (current.trim()) stmts.push(current.trim());

let ok = 0;
let fail = 0;
for (const stmt of stmts) {
  if (!stmt || stmt.startsWith('--')) continue;
  const { error } = await c.rpc('run_sql', { sql_query: stmt });
  if (error) {
    console.log('FAIL:', error.message, '\n  SQL:', stmt.substring(0, 100));
    fail++;
  } else {
    ok++;
  }
}
console.log(`Deployed: ${ok} OK, ${fail} FAIL`);
