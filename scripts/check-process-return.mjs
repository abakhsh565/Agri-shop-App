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

const { data } = await c.rpc('run_sql', { sql_query: "SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = 'process_return' AND proargtypes = ARRAY['jsonb'::regtype]::oid[] LIMIT 1" });
if (data && data[0] && data[0].def) {
  console.log(data[0].def.substring(0, 3000));
} else {
  console.log('Function not found or returned null');
  const { data: d2 } = await c.rpc('run_sql', { sql_query: "SELECT proname, proargtypes::text[] as args FROM pg_proc WHERE proname = 'process_return'" });
  console.log('All overloads:', JSON.stringify(d2));
}
