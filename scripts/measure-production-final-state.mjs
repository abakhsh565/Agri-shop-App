#!/usr/bin/env node
/**
 * measure-production-final-state.mjs — READ ONLY. What production actually holds, in one run.
 *
 * WHY THIS EXISTS
 *   "The work is finished" is a claim about a database nobody can see from the repository. The
 *   closing measurement has to be reproducible and has to be able to FAIL: counts of the tables a
 *   test transaction would land in, derived figures that must be zero again, the branch a row is
 *   attached to, what `anon` holds, and where the ledger says production is.
 *
 * WHAT IT REFUSES
 *   Any target other than production (the user string must name that project), and any transaction
 *   that is not READ ONLY. Nothing here writes, and there is no flag that could make it.
 *
 *   The `--env production` argument is required: the credential wrapper hands a password only to a
 *   command that names the environment it believes it is talking to, so that it can never be used to
 *   smuggle credentials into an unrelated run.
 *
 * Usage:
 *   node scripts/measure-production-final-state.mjs --env production [--json backups/<report>.json]
 *   node scripts/run-with-production-credentials.mjs -- node scripts/measure-production-final-state.mjs --env production
 *
 * Exit codes: 0 = every assertion held, 1 = at least one did not, 2 = refused before connecting.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { readCredentialsFile, defaultCredentialsPath } from './lib/credentials-file.mjs';
import { connectionStringFor, ROOT } from './lib/environments.mjs';

const PRODUCTION_PROJECT = 'gkswcfljxlutkfdvvqng';

const jsonFlag = process.argv.indexOf('--json');
const jsonOut = jsonFlag === -1 ? null : process.argv[jsonFlag + 1];
if (!process.argv.includes('--env') || process.argv[process.argv.indexOf('--env') + 1] !== 'production') {
  console.error('[REFUSED] name the environment: --env production');
  process.exit(2);
}

const { values } = readCredentialsFile(defaultCredentialsPath());
const user = String(values.PROD_DB_USER ?? '');
if (!user.includes(PRODUCTION_PROJECT)) {
  console.error(`[REFUSED] this measurement is only about production (${PRODUCTION_PROJECT}); user is ${user}`);
  process.exit(2);
}

/** Transactional tables a rehearsal, a demo or a stray client could put a row in. */
const EMPTY_TABLES = [
  'sales',
  'sale_items',
  'sales_items',
  'returns',
  'return_items',
  'voids',
  'purchases',
  'purchase_items',
  'customer_payments',
  'supplier_payments',
  'inventory_movements',
  'stock_adjustments',
  'notifications',
  'audit_events',
  'sale_submissions',
];

/** Figures that are derived from those rows and must read zero once the rows are gone. */
const ZERO_FIGURES = [
  ['customers', 'outstanding_balance'],
  ['customers', 'total_purchases'],
  ['customers', 'total_paid'],
  ['products', 'stock_qty'],
  ['product_variants', 'stock_qty'],
  ['companies', 'outstanding_payable'],
  ['companies', 'total_purchases'],
];

/** Configuration the reset was not allowed to remove. */
const KEEP = [
  ['shops', null],
  ['branches', null],
  ['users', null],
  ['memberships', null],
  ['permissions', null],
  ['roles', null],
];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
}

const client = new pg.Client({
  connectionString: connectionStringFor({ environment: 'production', envPrefix: 'PROD', values }),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query('begin transaction read only');

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

try {
  // ── 1. The ledger ──────────────────────────────────────────────────────────────────────────
  const ledger = await client.query(
    `select version, name, statements from supabase_migrations.schema_migrations order by version`,
  );
  const latest = ledger.rows.at(-1)?.version ?? null;
  const files = fs
    .readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pending = files.filter((f) => f.slice(0, 4) > (latest ?? '0000'));
  check('the ledger is not empty', ledger.rows.length > 0, { rows: ledger.rows.length, latest });
  check('no migration file is newer than the ledger’s position (nothing is unapplied)', pending.length === 0, {
    latest,
    pending: pending.slice(0, 5),
  });

  // The ledger's other half: the file it recorded must be the file on disk, byte for byte. A hash
  // recorded from a Windows working copy and a repository that checks out LF is exactly the kind of
  // drift this catches (measured and reconciled for 0222/0224/0225/0227 on 2026-10-17).
  const fileRows = await client.query(
    `select version, filename, sha256, bytes from supabase_migrations.schema_migration_files order by version`,
  );
  const hashDrift = [];
  for (const file of files) {
    const version = file.slice(0, 4);
    const row = fileRows.rows.find((r) => r.version === version && r.filename === file);
    if (!row) continue;
    const text = fs.readFileSync(path.join(ROOT, 'supabase/migrations', file), 'utf8');
    const digest = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    if (row.sha256 !== digest || row.bytes !== Buffer.byteLength(text, 'utf8')) {
      hashDrift.push(`${file}: recorded ${String(row.sha256).slice(0, 12)}/${row.bytes}B, on disk ${digest.slice(0, 12)}/${Buffer.byteLength(text, 'utf8')}B`);
    }
  }
  check('every migration file matches the bytes the ledger recorded for it', hashDrift.length === 0, {
    checked: files.length,
    drifted: hashDrift.slice(0, 5),
  });
  // The other half of the same claim: an APPLY must have its file identity recorded, not just its
  // statements. Rows below 0017 predate the tooling (production's out-of-band setup); everything it
  // took through a batch has both halves, and a version production deliberately did not take has
  // neither — which is why this asks about the statements it holds rather than about every file in
  // the repository.
  const statementVersions = ledger.rows.map((r) => r.version);
  const legacyOnly = statementVersions.filter((v) => v < '0017');
  const missingFileRow = statementVersions.filter(
    (v) => v >= '0017' && !fileRows.rows.some((r) => r.version === v),
  );
  check('every batch-era apply carries both its statements and its file row', missingFileRow.length === 0, {
    statements: statementVersions.length,
    fileRows: fileRows.rows.length,
    legacyWithoutFileRow: legacyOnly,
    missingFileRow,
  });

  // ── 2. Transactional tables are empty ──────────────────────────────────────────────────────
  const counts = {};
  for (const table of EMPTY_TABLES) {
    const exists = await one(`select to_regclass($1) is not null present`, [`public.${table}`]);
    if (!exists.present) continue;
    counts[table] = (await one(`select count(*)::int n from public.${table}`)).n;
  }
  const notEmpty = Object.entries(counts).filter(([, n]) => n !== 0);
  check('no test transaction survives in any transactional table', notEmpty.length === 0, {
    nonZero: Object.fromEntries(notEmpty),
    measured: counts,
  });

  // ── 3. Derived figures match ───────────────────────────────────────────────────────────────
  const figures = {};
  for (const [table, column] of ZERO_FIGURES) {
    const exists = await one(
      `select count(*)::int n from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, column],
    );
    if (exists.n === 0) continue;
    const r = await one(
      `select count(*)::int rows, coalesce(sum(abs(${column})), 0)::text total
         from public.${table} where ${column} <> 0`,
    );
    figures[`${table}.${column}`] = { rows: r.rows, sum: r.total };
  }
  const drifted = Object.entries(figures).filter(([, v]) => v.rows !== 0);
  check('no derived figure is left over from a deleted row', drifted.length === 0, {
    nonZero: Object.fromEntries(drifted),
  });

  // ── 4. Configuration intact ────────────────────────────────────────────────────────────────
  const configuration = {};
  for (const [table] of KEEP) {
    configuration[table] = (await one(`select count(*)::int n from public.${table}`)).n;
  }
  check(
    'the tenant shell survived the reset',
    configuration.shops >= 1 &&
      configuration.branches >= 1 &&
      configuration.roles >= 1 &&
      configuration.permissions === 32,
    configuration,
  );

  // `users` and `memberships` are NOT required to be non-zero any more: the seeded demo identities
  // were removed on 2026-10-18, so production is entitled to hold none until the owner signs in on
  // a real number. What must be true instead is that none of the seeded identities came back.
  const seeded = ['923001234567', '923009876543', '923001122334', '923001999999'];
  const demo = await one(
    `select
       (select count(*)::int from public.users where phone = any($1)) users,
       (select count(*)::int from auth.users where phone = any($1)) logins,
       (select count(*)::int from auth.identities i join auth.users u on u.id = i.user_id where u.phone = any($1)) identities`,
    [seeded],
  );
  check('no seeded demo identity or login survives', demo.users === 0 && demo.logins === 0 && demo.identities === 0, demo);

  // ── 5. Every operational row, when there are any, is attached to a branch ──────────────────
  const branchGaps = {};
  for (const table of ['sales', 'purchases', 'returns', 'customer_payments', 'supplier_payments', 'inventory_movements', 'stock_adjustments', 'notifications']) {
    const columns = await one(
      `select count(*)::int n from information_schema.columns
        where table_schema = 'public' and table_name = $1 and column_name = 'branch_id'`,
      [table],
    );
    if (columns.n === 0) continue;
    branchGaps[table] = (await one(`select count(*)::int n from public.${table} where branch_id is null`)).n;
  }
  check('no operational row is missing its branch', Object.values(branchGaps).every((n) => n === 0), branchGaps);

  // ── 6. The unauthenticated caller ──────────────────────────────────────────────────────────
  const anonGrants = await one(
    `select count(*)::int n
       from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'`,
  );
  const anonPolicies = await one(
    `select count(*)::int n from pg_policies
      where schemaname = 'public' and (roles::text ilike '%anon%' or roles::text ilike '%public%')`,
  );
  check('anon holds no privilege on any public table', anonGrants.n === 0, { grants: anonGrants.n });
  check('no policy in public is addressed to anon or public', anonPolicies.n === 0, { policies: anonPolicies.n });

  await client.query('savepoint attempt');
  let anonRead = null;
  try {
    await client.query('set local role anon');
    await client.query('select 1 from public.sales limit 1');
  } catch (error) {
    anonRead = error.message;
  } finally {
    await client.query('rollback to savepoint attempt');
  }
  check('anon cannot read a business table at all', /permission denied/i.test(anonRead ?? ''), { error: anonRead });

  // ── 7. An authenticated caller can still see the shop it belongs to ────────────────────────
  const visible = await one(
    `select count(*)::int n from pg_policies where schemaname = 'public' and roles::text ilike '%authenticated%'`,
  );
  check('the authenticated role still carries the policies it needs', visible.n > 0, { policies: visible.n });

  // ── 8. The repairs are in place, not just "the data looks clean" ──────────────────────────
  //
  // The emptiness above would also be true of a database missing every fix. These four assertions
  // are about the objects: the branch stamp of 0222, the return mirror of 0227, the void that no
  // longer needs `activity_log`, and the write RPCs the app calls being callable by name.
  // The stamp is one trigger function of one name; the table list is read from the catalog rather
  // than hard-coded, so the assertion is "this function guards the operational tables", not "six
  // trigger names I happen to remember".
  const stamped = await client.query(
    `select c.relname
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal
        and t.tgfoid = (select p.oid from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace
                         where pn.nspname = 'public' and p.proname = 'stamp_operational_branch' limit 1)
      order by c.relname`,
  );
  check(
    'the branch-stamp trigger guards the operational tables',
    stamped.rows.length >= 8,
    { tables: stamped.rows.map((r) => r.relname), count: stamped.rows.length },
  );

  const mirror = await one(
    `select count(*)::int n from pg_trigger where not tgisinternal and tgname = 'return_items_mirror_qty_trg'`,
  );
  check('a return’s legacy qty column is kept equal to the quantity returned (0227)', mirror.n === 1, {
    triggers: mirror.n,
  });

  const void_body = await one(
    `select coalesce(position('activity_log' in pg_get_functiondef(p.oid)), 0)::int pos
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'void_sale' limit 1`,
  );
  check('void_sale no longer writes the table production never received', void_body.pos === 0, {
    position: void_body.pos,
  });

  const rpcNames = [
    'create_sale',
    'create_purchase',
    'adjust_stock',
    'record_customer_payment',
    'record_supplier_payment',
    'process_return',
    'void_sale',
  ];
  const missingRpcs = [];
  for (const name of rpcNames) {
    const present = await one(
      `select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1 and pg_get_function_identity_arguments(p.oid) <> ''`,
      [name],
    );
    if (present.n === 0) missingRpcs.push(name);
  }
  check('every write RPC the app calls exists in public', missingRpcs.length === 0, { missing: missingRpcs });
} catch (error) {
  check('the measurement completed', false, { error: `${error.message} [${error.code ?? ''}]` });
} finally {
  await client.query('rollback');
  await client.end();
}

if (jsonOut) {
  const out = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.writeFileSync(
    out,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), target: PRODUCTION_PROJECT, status: process.exitCode ? 'FAIL' : 'PASS', results },
      null,
      2,
    ),
  );
  console.log(`report: ${out}`);
}

console.log(
  `\n${results.filter((r) => r.ok).length}/${results.length} checks passed` +
    (process.exitCode ? ' — at least one FAILED' : ''),
);
