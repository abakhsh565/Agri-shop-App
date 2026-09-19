/**
 * Evidence probe: what can a REAL authenticated user actually read/write?
 *
 * Several tenant-owned tables have RLS enabled with zero policies, which denies
 * every row to the `authenticated` role. The app then renders an empty state and
 * reports success, so the failure is invisible. This script signs in with the
 * same deterministic credentials the app uses and reports, per table, the real
 * PostgREST result.
 *
 * READ-ONLY except for one probe insert into reminder_configs (rolled back by
 * deleting the row it created).
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.qa', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL = (env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '');
const ANON = env.QA_SUPABASE_ANON_KEY;
const SERVICE = env.QA_SUPABASE_SERVICE_ROLE;

// Same derivation the app uses (src/lib/auth.ts).
const normalize = (input) => {
  const d = String(input).replace(/\D/g, '');
  if (d.startsWith('0')) return '92' + d.slice(1);
  if (d.startsWith('92')) return d;
  return '92' + d;
};

const admin = createClient(URL, SERVICE);
const { data: users } = await admin.from('users').select('id,name,phone,role').eq('role', 'admin').limit(5);
console.log('admin users:', users?.map((u) => `${u.name} (${u.phone})`).join(', '));

const owner = users?.find((u) => u.phone === '923001234567') || users?.[0];
const e164 = normalize(owner.phone);
const email = `user-${e164}@agrishop.auth.local`;
const password = `AgriShop-${e164}-2026!`;

const client = createClient(URL, ANON);
const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
if (signInErr) {
  console.error('sign-in failed:', signInErr.message);
  process.exit(1);
}
const { data: { session } } = await client.auth.getSession();
console.log(`signed in as ${owner.name} — sub=${session.user.id} role=${session.user.role}\n`);

const TABLES = [
  'customers', 'products', 'product_variants', 'sales', 'sale_items', 'purchases',
  'companies', 'payments', 'customer_payments', 'supplier_payments', 'returns',
  'voids', 'inventory_movements', 'activity_log', 'business_settings', 'shops',
  'branches', 'memberships', 'roles', 'business_areas', 'permissions',
  'reminder_configs', 'reminder_occurrences', 'reminder_logs',
  'credit_limit_requests', 'cash_reconciliations', 'daily_cash_reconciliations',
  'notifications', 'users', 'audit_events', 'user_permissions',
];

console.log('TABLE'.padEnd(30) + 'AUTH  /  TRUTH   VERDICT');
for (const t of TABLES) {
  const { data, error, count } = await client.from(t).select('*', { count: 'exact' }).limit(1);
  const { count: truth } = await admin.from(t).select('*', { count: 'exact', head: true });
  const seen = error ? 'ERR' : String(count ?? data?.length ?? 0);
  const verdict = error
    ? `READ ERROR: ${error.message.slice(0, 45)}`
    : Number(count ?? 0) === 0 && (truth ?? 0) > 0
      ? `MASKED — ${truth} rows invisible to the app`
      : Number(count ?? 0) < (truth ?? 0)
        ? `PARTIAL — sees ${count} of ${truth}`
        : 'ok';
  console.log('  ' + t.padEnd(28) + seen.padEnd(6) + String(truth ?? '?').padEnd(9) + verdict);
}

console.log('\n--- WRITE PROBE: insert into reminder_configs as authenticated');
const probe = await client
  .from('reminder_configs')
  .insert({ name: 'QA Probe config', type: 'credit', anchor: 'due_date', channel: 'sms', is_active: false })
  .select('id');
console.log('  insert:', probe.error ? `ERROR: ${probe.error.message}` : `OK id=${probe.data?.[0]?.id}`);
if (probe.data?.[0]?.id) {
  await admin.from('reminder_configs').delete().eq('id', probe.data[0].id);
  console.log('  probe row removed');
}

console.log('\n--- WRITE PROBE: insert into payments as authenticated');
const payProbe = await client
  .from('payments')
  .insert({ amount: 1 })
  .select('id');
console.log('  insert:', payProbe.error ? `ERROR: ${payProbe.error.message}` : `OK id=${payProbe.data?.[0]?.id}`);
if (payProbe.data?.[0]?.id) await admin.from('payments').delete().eq('id', payProbe.data[0].id);
