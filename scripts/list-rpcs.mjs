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

const { data, error } = await c.rpc('run_sql', {
  sql_query: `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname`
});
if (error) console.log('ERROR:', error.message);
else {
  const names = typeof data === 'string' ? JSON.parse(data) : data;
  console.log('RPCs:', JSON.stringify(names.map(n => n.proname), null, 2));
}
