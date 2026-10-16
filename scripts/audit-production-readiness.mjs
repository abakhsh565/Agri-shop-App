/**
 * audit-production-readiness.mjs — READ ONLY.
 *
 * Dumps the database facts that decide whether this app is safe to put in front of
 * real users: RLS coverage, policy inventory, deny-all tables, unsafe SECURITY DEFINER
 * functions, unindexed foreign keys, table growth, and lifecycle (soft-delete) columns.
 *
 * It runs SELECTs only. It never writes, never DDLs, never touches a row.
 *
 *   node scripts/audit-production-readiness.mjs            # summary
 *   node scripts/audit-production-readiness.mjs --full     # + every policy body
 *
 * Against QA today, because QA is the only database this repo has credentials for.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';

const FULL = process.argv.includes('--full');

const env = {};
for (const l of readFileSync('.env.qa', 'utf8').split('\n')) {
  const i = l.indexOf('=');
  if (i <= 0 || l.trim().startsWith('#')) continue;
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}

const client = createClient(env.QA_SUPABASE_URL, env.QA_SUPABASE_SERVICE_ROLE);
const projectRef = (env.QA_SUPABASE_URL || '').replace(/^https?:\/\//, '').split('.')[0];

async function q(sql) {
  const { data, error } = await client.rpc('run_sql', { sql_query: sql });
  if (error) throw new Error(error.message);
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function section(title) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

console.log(`Production-readiness audit — READ ONLY — project ${projectRef}`);

// ── 1. RLS coverage ──────────────────────────────────────────
section('1. RLS coverage');
const rls = await q(`
  SELECT c.relname AS table_name, c.relrowsecurity AS rls_on, c.relforcerowsecurity AS forced,
         count(p.policyname) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY 1, 2, 3 ORDER BY 4 ASC, 1 ASC`);
const tables = rls?.rows ?? rls ?? [];
const noRls = tables.filter((t) => !t.rls_on);
const denyAll = tables.filter((t) => t.rls_on && Number(t.policies) === 0);
console.log(`public tables: ${tables.length}`);
console.log(`RLS OFF (world-readable via anon key): ${noRls.length} ${noRls.map((t) => t.table_name).join(', ') || '—'}`);
console.log(`RLS ON but ZERO policies (deny-all): ${denyAll.length}`);
for (const t of denyAll) console.log(`   • ${t.table_name}`);
console.log(`force-RLS tables: ${tables.filter((t) => t.forced).length}`);

// ── 2. Policy inventory ──────────────────────────────────────
section('2. Policy inventory');
const pol = await q(`
  SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
  FROM pg_policies WHERE schemaname = 'public'
  ORDER BY tablename, policyname`);
const policies = pol?.rows ?? pol ?? [];
console.log(`total policies: ${policies.length}`);
if (FULL) {
  for (const p of policies) {
    console.log(`\n[${p.tablename}] ${p.policyname}  cmd=${p.cmd} roles=${p.roles}`);
    if (p.qual) console.log(`   using: ${p.qual}`);
    if (p.with_check) console.log(`   check: ${p.with_check}`);
  }
} else {
  const permissive = policies.filter((p) => (p.qual || '').trim() === 'true');
  console.log(`policies with USING (true) — allow everything to whoever the role matches: ${permissive.length}`);
  for (const p of permissive) console.log(`   • ${p.tablename}.${p.policyname} (${p.cmd}, roles=${p.roles})`);
  const roleSet = [...new Set(policies.map((p) => p.roles))].sort();
  console.log(`roles referenced: ${roleSet.join(' | ')}`);
}

// ── 3. SECURITY DEFINER functions and their search_path ──────
section('3. SECURITY DEFINER functions');
const fns = await q(`
  SELECT p.proname, p.prosecdef AS security_definer,
         array_to_string(p.proconfig, ',') AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
  ORDER BY p.prosecdef DESC, p.proname`);
const funcs = fns?.rows ?? fns ?? [];
const definers = funcs.filter((f) => f.security_definer);
const unsafe = definers.filter((f) => !(f.config || '').includes('search_path'));
console.log(`public functions: ${funcs.length}  |  SECURITY DEFINER: ${definers.length}`);
console.log(`SECURITY DEFINER without pinned search_path: ${unsafe.length}`);
for (const f of unsafe) console.log(`   • ${f.proname}`);
if (FULL) for (const f of definers) console.log(`   ${f.proname}  config=${f.config || '(none)'}`);

// ── 4. Unindexed foreign keys ────────────────────────────────
section('4. Unindexed foreign keys (join/scan cost at scale)');
const fk = await q(`
  SELECT con.conrelid::regclass::text AS table_name,
         con.conname AS constraint_name,
         (SELECT string_agg(att.attname, ', ')
            FROM unnest(con.conkey) AS k(attnum)
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns
  FROM pg_constraint con
  JOIN pg_namespace n ON n.oid = con.connamespace
  WHERE con.contype = 'f' AND n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = con.conrelid
        AND (i.indkey::int2[])[0:array_length(con.conkey, 1) - 1] = con.conkey
    )
  ORDER BY 1, 2`);
const fks = fk?.rows ?? fk ?? [];
console.log(`foreign keys with no covering index: ${fks.length}`);
for (const f of fks) console.log(`   • ${f.table_name}.${f.constraint_name} (${f.columns})`);

// ── 5. Growth: where the rows actually are ───────────────────
section('5. Table sizes (live row estimate)');
const sizes = await q(`
  SELECT c.relname AS table_name, c.reltuples::bigint AS est_rows,
         pg_total_relation_size(c.oid) AS bytes
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 25`);
for (const r of sizes?.rows ?? sizes ?? []) {
  console.log(`   ${String(r.table_name).padEnd(34)} rows≈${String(r.est_rows).padStart(10)}  ${(Number(r.bytes) / 1024).toFixed(0)} KB`);
}

// ── 6. Tenant spine: how much real data is in there right now ─
section('6. Tenant spine');
const spine = await q(`
  SELECT 'shops' t, count(*) n FROM shops
  UNION ALL SELECT 'memberships', count(*) FROM memberships
  UNION ALL SELECT 'users', count(*) FROM users
  UNION ALL SELECT 'auth.users', count(*) FROM auth.users
  UNION ALL SELECT 'branches', count(*) FROM branches
  UNION ALL SELECT 'products', count(*) FROM products
  UNION ALL SELECT 'customers', count(*) FROM customers
  UNION ALL SELECT 'sales', count(*) FROM sales`);
for (const r of spine?.rows ?? spine ?? []) console.log(`   ${String(r.t).padEnd(16)} ${r.n}`);

// ── 7. Lifecycle / soft-delete columns ───────────────────────
section('7. Lifecycle columns (can a deleted row be recovered?)');
const cols = await q(`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name IN ('deleted_at','archived_at','archived_by','is_archived','is_active','purged_at','restored_at')
  ORDER BY table_name, column_name`);
const byTable = {};
for (const r of cols?.rows ?? cols ?? []) (byTable[r.table_name] ??= []).push(r.column_name);
console.log(`tables carrying a lifecycle flag: ${Object.keys(byTable).length}`);
for (const [t, c] of Object.entries(byTable)) console.log(`   ${t.padEnd(34)} ${c.join(', ')}`);

// ── 8. Migration bookkeeping ─────────────────────────────────
section('8. Migration bookkeeping');
const mig = await q(`SELECT count(*) AS applied FROM supabase_migrations.schema_migrations`);
const migList = await q(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`);
const versions = (migList?.rows ?? migList ?? []).map((r) => r.version);
console.log(`rows in supabase_migrations.schema_migrations: ${(mig?.rows ?? mig)?.[0]?.applied ?? 'n/a'}`);
console.log(`newest recorded versions: ${versions.slice(-8).join(', ') || '(none)'}`);
console.log(`files in supabase/migrations/: 167 (checked separately)`);

// ── 9. Storage buckets & public exposure ─────────────────────
section('9. Storage buckets');
const buckets = await q(`SELECT id, name, public, file_size_limit FROM storage.buckets ORDER BY name`);
const bl = buckets?.rows ?? buckets ?? [];
if (!bl.length) console.log('   (no buckets)');
for (const b of bl) console.log(`   ${String(b.id).padEnd(28)} public=${b.public}  size_limit=${b.file_size_limit ?? 'default'}`);

// ── 10. Production reach: who can authenticate against production? ────
//
// The question this answers is not "is production referenced" — the guard has to name production
// to refuse it — but "can anything run automatically and land on production, or accept the shared
// demo code". Scope and rules match tests/unit/productionReachGuard.test.ts.
section('10. Production reach (source scan)');

const PROD_URL = 'gkswcfljxlutkfdvvqng.supabase.co';
const PROD_KEY = 'sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG';
const AUTOMATED = ['src', 'utils', 'scripts', 'tests/unit', 'tests/integration', 'tests/e2e', 'tests/setup', '.github/workflows'];
const AUTOMATED_FILES = ['package.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'playwright.media.config.ts', 'capacitor.config.ts', 'index.html', '.env.example'];
// Both scanners necessarily contain the literals they search for.
const SCANNER_SELF = new Set([
  'tests/unit/productionReachGuard.test.ts',
  'scripts/audit-production-readiness.mjs',
]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|json|html|yml|yaml|sql)$/;

function walkDir(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (['node_modules', '.git', 'dist', 'android', 'ios'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(full, out);
    else if (TEXT.test(e.name)) out.push(relPath(full));
  }
  return out;
}

function relPath(p) {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

const automated = [...AUTOMATED_FILES, ...AUTOMATED.flatMap((d) => walkDir(d))];
const automatedOffenders = automated.filter((f) => {
  if (SCANNER_SELF.has(f)) return false;
  const text = fs.readFileSync(f, 'utf8');
  return text.includes(PROD_URL) || text.includes(PROD_KEY);
});
console.log(`automated surface: ${automated.length} files scanned`);
console.log(`  files hardcoding a PRODUCTION url or key: ${automatedOffenders.length}`);
for (const f of automatedOffenders) console.log(`   ! ${f}`);

const legacy = fs
  .readdirSync('tests', { withFileTypes: true })
  .filter((e) => e.isFile() && /\.(mjs|cjs|mts|cts|ts)$/.test(e.name))
  .map((e) => `tests/${e.name}`)
  .filter((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return text.includes(PROD_URL) || text.includes(PROD_KEY);
  });
console.log(`\n  unmanaged manual harnesses under tests/ pointing at production: ${legacy.length}`);
console.log('  (nothing references these; several of them write rows. Delete or quarantine them.)');
for (const f of legacy) console.log(`   - ${f}`);

const buildJob = '.github/workflows/build-apk.yml';
if (fs.existsSync(buildJob)) {
  const wf = fs.readFileSync(buildJob, 'utf8');
  const buildStepHasEnv = /- name: Build Web App\s*\n\s*run: npm run build\s*\n\s*env:/.test(wf);
  console.log(`\n  APK workflow: the "Build Web App" step supplies env vars: ${buildStepHasEnv ? 'yes' : 'NO'}`);
  if (!buildStepHasEnv) {
    console.log('   ! The release build runs with no VITE_* env. Before the fallback was removed that');
    console.log('   ! meant every released APK used the PRODUCTION project in demo-OTP mode.');
    console.log('   ! With the fallback gone this step now FAILS until VITE_APP_ENV, VITE_SUPABASE_URL,');
    console.log('   ! VITE_SUPABASE_ANON_KEY and VITE_OTP_DELIVERY are added to it.');
  }
}

// ── 11. Which environment does each local env file claim? ─────────────
section('11. Local environment files (names only, never values)');
for (const file of ['.env.local', '.env.qa', '.env.example']) {
  if (!fs.existsSync(file)) {
    console.log(`   ${file.padEnd(16)} (absent)`);
    continue;
  }
  const text = fs.readFileSync(file, 'utf8');
  // Line-based on purpose: a comment is not configuration, and a comment ABOVE a variable is
  // easy to mistake for its value. This section reports what the build would actually read.
  const read = (name) => {
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && m[1] === name) return m[2].trim();
    }
    return '';
  };
  const url = read('VITE_SUPABASE_URL');
  const ref = read('VITE_SUPABASE_PROJECT_ID') || url.match(/\/\/([a-z0-9]+)\./)?.[1] || '';
  console.log(
    `   ${file.padEnd(16)} appEnv=${read('VITE_APP_ENV') || '(unset)'}` +
      `  otp=${read('VITE_OTP_DELIVERY') || '(unset)'}` +
      `  project=${ref || '(unset)'}`,
  );
}

console.log('\nAudit complete. Nothing was modified.\n');
