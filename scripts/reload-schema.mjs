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

// Notify PostgREST to reload its schema cache
const { error } = await c.rpc('run_sql', { sql_query: "NOTIFY pgrst, 'reload schema'" });
if (error) console.log('ERROR:', error.message);
else console.log('Schema reload triggered');
