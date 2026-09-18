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

const { data } = await c.rpc('run_sql', { sql_query: "SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'create_sale' ORDER BY oid DESC LIMIT 1" });
if (data && data[0]) {
  console.log(data[0].def);
}
