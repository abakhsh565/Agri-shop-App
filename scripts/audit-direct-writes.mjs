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

// Check each table individually
const tables = [
  'notifications', 'reminder_configs', 'reminder_occurrences', 'reminder_logs',
  'customer_crops', 'credit_limit_requests', 'inventory_movements',
  'activity_events', 'audit_events', 'business_settings'
];

for (const t of tables) {
  // Check if shop_id column exists
  const { data: cols } = await c.rpc('run_sql', {
    sql_query: `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${t}' AND column_name = 'shop_id'`
  });
  const hasShopId = typeof cols === 'string' ? JSON.parse(cols).length > 0 : (cols?.length > 0);

  // Check RLS policies
  const { data: policies } = await c.rpc('run_sql', {
    sql_query: `SELECT cmd, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = '${t}' AND cmd IN ('INSERT','UPDATE') AND qual IS NOT NULL`
  });
  const polList = typeof policies === 'string' ? JSON.parse(policies) : (policies || []);
  
  const flags = [];
  if (hasShopId) flags.push('shop_id');
  if (polList.length > 0) flags.push(polList.map(p => p.cmd + '_RLS').join(','));
  
  console.log(`  ${t}: ${flags.join(', ') || 'no shop_id, no RLS'}`);
}
