#!/usr/bin/env node
/**
 * probe-rehearsal-intent.mjs — after a rehearsal applies the forward batch, measure what actually
 * arrived.
 *
 * WHY THIS IS NEEDED. `verify-forward-on-baseline` and `rehearse-on-local-engine` count SQL failures.
 * A guarded statement that DECLINES to run reports no failure, so a batch can be clean on production
 * and still deliver nothing there — which is exactly what happened to `marketplace_listings` (guarded
 * on whether the view existed; production's baseline does not contain it, so the create was skipped)
 * and to the two `comment on` statements (their guard resolved its subject to `public`, so it was
 * never true anywhere). "Zero failures" is a floor, not the outcome.
 *
 * WHAT IT DOES. Connects to the scratch database a rehearsal left behind — never to a hosted project,
 * never to the local development database — and asserts, from `pg_catalog` and the privilege tables,
 * that the objects the re-issue exists to install are present and that access is what the ledger
 * decided. Each check prints expected/actual, and the run exits 1 if any check fails.
 *
 * Usage:
 *   node scripts/dev/probe-rehearsal-intent.mjs --db rehearsal_production
 *   node scripts/dev/probe-rehearsal-intent.mjs --db rehearsal_staging [--json <file>]
 *
 * Exit codes: 0 = every check held, 1 = at least one did not, 2 = refused before doing anything.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

const dbName = flag('db');
if (!dbName) refuse('name the scratch database a rehearsal left behind: --db rehearsal_<baseline>.');
if (!/^rehearsal_[a-z0-9_]+$/.test(dbName)) {
  refuse(`only a rehearsal_* database is probed; got "${dbName}". A hosted project and the local development database are both out of reach from here on purpose.`);
}

function docker(args, input) {
  const result = spawnSync(DOCKER, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input, stdio: ['pipe', 'pipe', 'pipe'] });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, error: result.error };
}

const listed = docker(['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}']);
if (listed.error || listed.status !== 0) refuse(`docker is not reachable (${(listed.error?.message ?? listed.stderr).split('\n')[0]}).`);
const container = listed.stdout.trim().split('\n').filter(Boolean)[0];
if (!container) refuse('no local Supabase database container is running.');

const exists = docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-t', '-A', '-c',
  `select 1 from pg_database where datname = '${dbName}'`]);
if (exists.stdout.trim() !== '1') {
  refuse(`${dbName} does not exist — run a rehearsal first (it creates the scratch database), and keep it if it was dropped.`);
}

// A rehearsal that did not install hosted's default privileges cannot answer a privilege question: every
// table would look unreadable and every function unexecutable, and the probe would report that as the
// batch's doing. The rehearsal applies them before the baseline loads; this asserts it actually did.
{
  const aclBase = docker(['exec', container, 'psql', '-U', 'postgres', '-d', dbName, '-X', '-t', '-A', '-c',
    "select coalesce(string_agg(coalesce(d.defaclacl::text, ''), ' '), '(none)') from pg_default_acl d " +
      "where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'"]);
  if (!/authenticated=arwdDxtm/.test(aclBase.stdout)) {
    refuse(`${dbName} was created without hosted's default privileges (pg_default_acl: ${aclBase.stdout.trim() || '(nothing)'}). Its privilege state is not production-shaped, so an ACL check here would measure the database rather than the batch. Re-run the rehearsal.`);
  }
}

/**
 * One check per row, evaluated in SQL and returned as `name|expected|actual`.
 *
 * Reading the answer from the engine rather than from the statement text is the point: the question
 * is what the database holds after the batch, not what the batch looked like.
 */
const CHECKS = [
  // ── The marketplace chain (0184–0187) ───────────────────────────────────────────────────────
  [
    'marketplace listing view exists',
    `select case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'marketplace_listings' and c.relkind = 'v') then 'present' else 'absent' end`,
    'present',
  ],
  [
    'the marketplace view is readable by the marketplace identity',
    `select has_table_privilege('anon', 'public.marketplace_listings', 'SELECT')::text`,
    'true',
  ],
  [
    'the marketplace radius is not a branch setting (0187 removed it)',
    `select case when exists (select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'shops' and column_name = 'marketplace_radius_km') then 'present' else 'absent' end`,
    'absent',
  ],
  [
    'search_marketplace keeps its signature (0187 corrected the eligibility, not the shape)',
    // `pg_get_function_identity_arguments` prints the parameter names when they exist, and the first
    // version of this check compared it to a bare type list — a probe bug that read as a defect. The
    // ledger's shape is asserted as it is actually stored: seven parameters, these types, this order.
    `select coalesce(pg_get_function_identity_arguments(p.oid), '(missing)') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'search_marketplace'`,
    'p_latitude double precision, p_longitude double precision, p_radius_km numeric, p_query text, p_category text, p_limit integer, p_offset integer',
  ],
  [
    'the marketplace switch is the two-argument form (0187 dropped the owner-set radius)',
    `select coalesce(pg_get_function_identity_arguments(p.oid), '(missing)') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'set_marketplace_settings'`,
    'p_shop_id uuid, p_enabled boolean',
  ],

  // ── The audit history boundary (0181) ───────────────────────────────────────────────────────
  [
    'audit_events has no permissive INSERT policy',
    `select coalesce(string_agg(p.polname, ', '), 'none') from pg_policy p
      where p.polrelid = 'public.audit_events'::regclass and p.polcmd = 'a'
        and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true'`,
    'none',
  ],
  [
    'the client write policy on audit_events says no',
    `select coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '(none)') from pg_policy p
      where p.polrelid = 'public.audit_events'::regclass and p.polname = 'audit_events_no_client_writes'`,
    'false',
  ],
  [
    'every SELECT policy on audit_events carries a shop predicate',
    `select coalesce(string_agg(p.polname, ', '), 'none') from pg_policy p
      where p.polrelid = 'public.audit_events'::regclass and p.polcmd = 'r'
        and coalesce(pg_get_expr(p.polqual, p.polrelid), '') !~ 'current_shop_id'`,
    'none',
  ],
  [
    'the snapshot triggers are installed on the three financial tables',
    `select count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and t.tgname = 'audit_operational_snapshot_trg'
        and c.relname in ('customer_payments','supplier_payments','stock_adjustments')`,
    '3',
  ],

  // ── The tenant-scoped policies the batch replaces (0178, 0180, 0182, 0197) ──────────────────
  [
    'no tenant-blind legacy policy survives on the tables the range rewrites',
    `select coalesce(string_agg(c.relname || '.' || p.polname, ', '), 'none')
       from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname in ('product_variants','stock_adjustments','cash_reconciliations','app_settings','notifications','audit_events')
        and (p.polname in ('public_all_product_variants','public_all_stock_adjustments','public_all_cash_reconciliations',
             'public_all_app_settings','public_all_notifications','public_all_audit_events','authenticated_select')
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') = 'true')`,
    'none',
  ],
  [
    'the permission read gate is restrictive and present on the platform tables (0195)',
    `select count(*)::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname = 'permission_read_gate' and p.polpermissive = false
        and c.relname in ('sales','purchases','returns','customer_payments','supplier_payments',
                          'inventory_movements','stock_adjustments','products','customers','companies')`,
    '10',
  ],
  [
    'the branch read policies are restrictive (0188)',
    `select count(*)::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname = c.relname || '_branch_select' and p.polpermissive = false
        and c.relname in ('sales','purchases','returns','inventory_movements','customer_payments',
                          'supplier_payments','stock_adjustments')`,
    '7',
  ],

  // ── Access: what the API roles may actually do (0191, 0195, batch 1's REVOKEs) ─────────────
  [
    'anon holds no write privilege on the financial tables',
    `select string_agg(format('%s=%s', t, has_table_privilege('anon', 'public.' || t, 'INSERT')), ', ')
       from unnest(array['sales','purchases','returns','customer_payments','supplier_payments','inventory_movements','stock_adjustments']) t
      where has_table_privilege('anon', 'public.' || t, 'INSERT')`,
    null,
  ],
  [
    'authenticated holds no write privilege on the financial tables',
    `select string_agg(format('%s=%s', t, has_table_privilege('authenticated', 'public.' || t, 'INSERT')), ', ')
       from unnest(array['sales','purchases','returns','customer_payments','supplier_payments','inventory_movements','stock_adjustments']) t
      where has_table_privilege('authenticated', 'public.' || t, 'INSERT')`,
    null,
  ],
  [
    'authenticated may still read the tables it is meant to read',
    `select string_agg(t, ', ') from unnest(array['sales','products','customers','companies']) t
      where not has_table_privilege('authenticated', 'public.' || t, 'SELECT')`,
    null,
  ],
  [
    // `anon` is a member of PUBLIC, so its privilege is the test for the default grant as well: there is
    // no role named `public` to ask about, and the earlier version of this check pretended otherwise.
    "the ledger's guard and helper functions are not executable by anon",
    `select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('guard_operational_request','guard_employee_access_edit','void_sale_v1','delete_branch','my_shop_ids')
        and has_function_privilege('anon', p.oid, 'EXECUTE')`,
    'none',
  ],
  [
    // A trigger-returning function has one legitimate caller — the trigger — so the batch closes its
    // EXECUTE contract to every role. Without the ACL pass these arrived with PostgreSQL's default
    // PUBLIC EXECUTE, which is how `audit_operational_snapshot` was measured before the pass existed.
    'no trigger function the batch creates is executable by a client role',
    `select coalesce(string_agg(p.proname, ', '), 'none') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
        and p.proname in ('audit_context_stamp','audit_final_sale_created','audit_identity_labels',
                          'audit_operational_snapshot','audit_sale_created','enforce_branch_scope','notifications_stamp')
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))`,
    'none',
  ],

  // ── The membership substrate (batch 2) and the re-issue's own functions ────────────────────
  [
    'the membership substrate exists',
    `select coalesce(string_agg(missing, ', '), 'none') from (
       select unnest(array['branches','roles','memberships','permissions','role_permissions','user_permissions','user_active_shops']) as t
     ) x(missing)
     where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relname = x.missing and c.relkind = 'r')`,
    'none',
  ],
  [
    'process_return is the renamed shape (0198 / 0214)',
    `select coalesce(pg_get_function_identity_arguments(p.oid), '(missing)') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'process_return'`,
    'payload jsonb',
  ],
  [
    'the functions the app calls are present',
    `select coalesce(string_agg(name, ', '), 'none') from unnest(array[
        'create_sale','void_sale','process_return','adjust_stock','record_customer_payment','get_my_branches',
        'current_branch_id','current_branch_scope','allowed_branch_scope','set_active_branch','authorize_business_action',
        'has_effective_permission','get_effective_permissions','membership_in_active_shop','assign_employee_branch',
        'create_operating_branch','archive_operating_branch','grant_branch_responsibility','revoke_branch_responsibility',
        'transfer_branch_responsibility','branch_responsible_person','delete_branch','my_shop_ids','get_my_shop_request',
        'set_marketplace_settings','notification_branch_visible','audit_context_stamp'
      ]) name
     where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = name)`,
    'none',
  ],
];

const results = [];
for (const [name, query, expected] of CHECKS) {
  const r = docker(['exec', container, 'psql', '-U', 'postgres', '-d', dbName, '-X', '-t', '-A', '-c', query]);
  if (r.status !== 0) {
    results.push({ name, expected: expected ?? '(empty: nothing to report)', actual: `query failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`, ok: false });
    continue;
  }
  const actual = r.stdout.trim() || '(empty)';
  // `expected === null` means "no rows is the pass": the check returns NULL when nothing is wrong.
  const ok = expected === null ? actual === '(empty)' || actual === 'none' : actual === expected;
  results.push({ name, expected: expected ?? '(empty: nothing to report)', actual, ok });
}const failures = results.filter((r) => !r.ok);
console.log(`\nRehearsal intent — ${dbName} on ${container}\n`);
for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}\n      expected ${r.expected} · actual ${r.actual}`);
console.log(`\nSUMMARY ${failures.length ? 'FAIL' : 'PASS'}: ${results.length - failures.length}/${results.length} checks held\n`);

const jsonOut = flag('json');
if (jsonOut) {
  fs.writeFileSync(path.resolve(ROOT, jsonOut), `${JSON.stringify({ generatedAt: new Date().toISOString(), database: dbName, container, status: failures.length ? 'FAIL' : 'PASS', results }, null, 2)}\n`);
  console.log(`  Report: ${jsonOut}\n`);
}
process.exit(failures.length ? 1 : 0);
