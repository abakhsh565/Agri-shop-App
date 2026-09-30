#!/usr/bin/env node
/**
 * backup-database.mjs — a logical backup of ONE explicitly named environment.
 *
 *   node scripts/backup-database.mjs --env staging
 *   node scripts/backup-database.mjs --env production
 *
 * WHAT CHANGED AND WHY
 *   This script used to hardcode `QA_DB_*` and stamp its output `-- Environment: QA`, while the
 *   workflow that ran it was titled "Backup Production Database". So the only production backup
 *   this repository ever produced backed up QA — and nothing anywhere checked. Worse, it silently
 *   skipped any table with more than 1000 rows ("data not dumped inline"), which is precisely the
 *   table most likely to matter, and it never touched the `auth` schema, so a "restored" database
 *   had no logins at all.
 *
 *   Now: the environment must be named, credentials are read only from that environment's own
 *   prefix, and the project named by those credentials is verified before anything is written. A
 *   dump that cannot be verified produces no artifact.
 *
 * SHAPE OF THE ARTIFACT: pre-data → data → post-data
 *   The file is written in the three phases a logical restore needs, modelled on pg_dump:
 *
 *     pre-data    types, tables with primary keys
 *     data        every row of every `public` table, then `auth.users` and `auth.identities`
 *     post-data   functions, views, foreign keys, uniques, checks, indexes, triggers, RLS policies
 *
 *   The order is not cosmetic. The earlier version added foreign keys before the rows, and dumped
 *   tables alphabetically, so a restore had to insert e.g. `sale_items` before `sales` or fail on a
 *   foreign-key violation. Loading data before any foreign key exists removes that dependency
 *   entirely, and it is why `scripts/restore-verify.mjs` can replay every row.
 *
 *   Generated columns are excluded from INSERT column lists, and `overriding system value` is added
 *   for `generated always as identity` columns, because neither is a legal INSERT target otherwise.
 *
 * WHAT THIS ARTIFACT IS, AND IS NOT
 *   It is a LOGICAL dump: schema-defining DDL it can reconstruct from the catalogue (tables,
 *   columns, enums, primary/foreign/unique constraints, indexes, views, functions, triggers, RLS
 *   policies) plus every row of every `public` table, plus the `auth` identities needed to sign in
 *   afterwards.
 *
 *   It is NOT a physical backup, and it is not a drop-in replacement for `pg_dump`. It does not
 *   capture: storage objects (Supabase states database backups do not include Storage files
 *   either), grants/ownership, extensions, custom role passwords (Supabase does not back those up
 *   in daily backups either), or `supabase_migrations` bookkeeping. These are listed in the
 *   manifest's `limitations` so an operator never mistakes coverage for completeness.
 *
 * The artifact contains real personal data and password hashes. `backups/` is gitignored; keep it
 * that way.
 */

import pg from 'pg';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  assertReached,
  connectionStringFor,
  describeTarget,
  identifyConnection,
  requireEnvironmentOrExit,
} from './lib/environments.mjs';

// ── Exact value fidelity ─────────────────────────────────────────────────────────────────────
// node-postgres parses timestamptz/timestamp/date into a JS Date, which holds MILLISECONDS while
// Postgres holds MICROSECONDS. Going through Date therefore truncates every timestamp the backup
// carries — silently, and only visible when restored rows are compared with the originals. Measured
// on staging: 2026-09-27 14:17:44.338897+00 came back as ...44.338Z. The parsers below hand back the
// server's own text, so the literal written into the artifact is the value that was stored.
// interval is included for the same reason: as an object it would be re-serialised as JSON.
// json/jsonb are included because a JS value cannot represent what jsonb stores: jsonb numerics are
// arbitrary-precision decimals, and JSON.parse/stringify collapses 1.0 to 1 (a different jsonb
// value) and rounds anything beyond float64. Taking the server's own text keeps the document
// byte-identical. Found the same way as the timestamp bug: the restore digest for a table differed
// and the per-column diagnosis pointed at a jsonb column.
for (const oid of [1114, 1184, 1082, 1083, 1266, 1186, 114, 3802]) pg.types.setTypeParser(oid, (v) => v);

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/backup-database.mjs --env <development|staging|production>');
  console.log('  Writes backups/backup-<env>-<projectRef>-<timestamp>.sql and .manifest.json');
  process.exit(0);
}

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'backups');

// ── 1. Resolve the target, or refuse ─────────────────────────────────────────────────────────
// No default. Missing credentials for the named environment are a refusal, never a fallback to
// another environment's variables.
const creds = requireEnvironmentOrExit(args, { command: 'backup-database' });

const startedAt = new Date();
const timestamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const baseName = `backup-${creds.environment}-${creds.projectRef}-${timestamp}`;
const outFile = path.join(BACKUP_DIR, `${baseName}.sql`);
const manifestFile = path.join(BACKUP_DIR, `${baseName}.manifest.json`);

function fail(message) {
  console.error(`\n[BACKUP ABORTED] ${message}\n`);
  process.exit(1);
}

/**
 * Postgres literal. Handles the types this schema actually uses.
 *
 * Arrays need their own quoting rules: an array literal is a single-quoted string whose ELEMENTS
 * are double-quoted, so reusing the scalar branch would emit `'{'a','b'}'` — which terminates the
 * string at the first element's quote. That is what made every `text[]` value in the first restore
 * attempt a syntax error, so the array branch is written out explicitly rather than composed.
 */
function lit(value, pgType = null) {
  if (value === null || value === undefined) return 'NULL';
  // Type-directed dispatch, because the driver's JS shape does not tell you the column's type: a
  // jsonb column holding a JSON array arrives as a JS array, and the array branch below would write
  // it as a Postgres array literal that the column then rejects as invalid JSON. The declared
  // column type decides, not the JS shape.
  if (pgType === 'json' || pgType === 'jsonb') {
    // Already valid server-rendered JSON text (see the type parsers); stringified only as a
    // fallback for values that arrived some other way.
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return `'${text.replace(/'/g, "''")}'::${pgType}`;
  }
  if (typeof value?.toPostgres === 'function') return `'${String(value.toPostgres()).replace(/'/g, "''")}'`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'`;
  if (Array.isArray(value)) {
    const items = value.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'boolean') return v ? 'true' : 'false';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `'{${items.join(',')}}'`;
  }
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function main() {
  const client = new pg.Client({
    connectionString: connectionStringFor(creds),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  // ── 2. Verify the credentials name the database we said we would back up ──────────────────
  const identity = await identifyConnection(client, creds);
  let reachedRef;
  let clusterId;
  try {
    ({ projectRef: reachedRef, clusterId } = assertReached(creds, identity));
  } catch (error) {
    await client.end().catch(() => {});
    fail(error.message);
  }

  const server = await client.query('show server_version');

  // Independent corroboration: the migration ledger as this database reports it. It is compared
  // against the Supabase control-plane view of the same project in the phase report, so the claim
  // "this artifact came from project X" rests on two sources rather than one.
  let migrationLedger = { count: null, latest: null };
  try {
    const ledger = await client.query(
      `select count(*)::int as n, max(version) as latest from supabase_migrations.schema_migrations`,
    );
    migrationLedger = { count: ledger.rows[0]?.n ?? null, latest: ledger.rows[0]?.latest ?? null };
  } catch {
    migrationLedger = { count: null, latest: null, note: 'supabase_migrations not readable' };
  }

  const lines = [];
  const push = (...l) => lines.push(...l);

  push(`-- AgriShop logical backup`);
  push(`-- Environment:  ${creds.environment}`);
  push(`-- Project:      ${reachedRef}   (named by the credentials that produced this file)`);
  push(`-- Generated:    ${startedAt.toISOString()}`);
  push(`-- Server:       PostgreSQL ${server.rows[0].server_version}`);
  push(`-- Cluster:      ${clusterId ?? 'unavailable'}${identity.clusterId ? '' : ` (${identity.clusterIdError ?? 'no permission'})`}`);
  push(`-- Connected as: ${identity.configuredUser} -> session role ${identity.serverUser}`);
  push(`-- Ledger:       supabase_migrations latest=${migrationLedger.latest} count=${migrationLedger.count}`);
  push(`--`);
  push(`-- Contains personal data and password hashes. Never commit. Never publish.`);
  push(`-- Restoring this artifact is a two-step recovery: migrations create the schema,`);
  push(`-- this file supplies data plus functions and policies. See docs/RECOVERY.md.`);
  push(`-- Verify it with: node scripts/restore-verify.mjs --from <this file>.manifest.json`);
  push('');

  const manifest = {
    artifact: path.basename(outFile),
    environment: creds.environment,
    projectRef: reachedRef,
    generatedAt: startedAt.toISOString(),
    serverVersion: server.rows[0].server_version,
    identity: {
      configuredUser: identity.configuredUser,
      serverUser: identity.serverUser,
      clusterId,
      note: 'Session role is rewritten by the Supabase pooler, so the project ref comes from the credential.',
    },
    migrationLedger,
    schemas: ['public', 'auth'],
    tableCounts: {},
    structure: {},
    phaseOrder: ['pre-data', 'data', 'post-data'],
    limitations: [
      'Logical dump, not a physical backup; not interchangeable with pg_dump output.',
      'Storage objects are not included (Supabase database backups exclude them too).',
      'Grants, ownership, extensions and custom role passwords are not included.',
      'supabase_migrations bookkeeping is not included.',
    ],
  };

  const tables = await client.query(`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by c.relname`);

  const columnCatalog = await client.query(`
    select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as type,
           a.attgenerated, a.attidentity, a.attnum
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    order by c.relname, a.attnum`);

  const columnsByTable = new Map();
  for (const row of columnCatalog.rows) {
    if (!columnsByTable.has(row.relname)) {
      columnsByTable.set(row.relname, {
        all: [],
        generated: new Set(),
        alwaysIdentity: false,
        types: new Map(),
      });
    }
    const entry = columnsByTable.get(row.relname);
    entry.all.push(row.attname);
    entry.types.set(row.attname, row.type);
    if (row.attgenerated === 's') entry.generated.add(row.attname);
    if (row.attidentity === 'a') entry.alwaysIdentity = true;
  }

  // Column types for the auth tables, so their literals are written by the same rules.
  const authTypes = new Map();
  for (const row of (await client.query(`
    select c.relname, a.attname, format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname in ('users','identities')
      and a.attnum > 0 and not a.attisdropped`)).rows) {
    if (!authTypes.has(row.relname)) authTypes.set(row.relname, new Map());
    authTypes.get(row.relname).set(row.attname, row.type);
  }

  // ═══ PRE-DATA ═════════════════════════════════════════════════════════════════════════════

  push('-- ═══ PRE-DATA ═══════════════════════════════════════════');
  push('');

  // ── 3. Enums, before any table that uses them ────────────────────────────────────────────
  const enums = await client.query(`
    select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by t.typname`);

  push('-- ─── Types ───────────────────────────────────────────────');
  for (const e of enums.rows) {
    const labels = e.labels.split(',').map((l) => `'${l.replace(/'/g, "''")}'`).join(', ');
    push(`do $$ begin create type public.${ident(e.typname)} as enum (${labels});`);
    push(`exception when duplicate_object then null; end $$;`);
  }
  push('');

  // ── 4a. Functions, EARLY: a column DEFAULT may call one ───────────────────────────────────
  // `reminder_configs.shop_id default current_shop_id()` is why this pass exists. A default is
  // resolved when the table is created, so a dump that only creates functions in post-data cannot
  // create that table at all. Functions whose *signature* depends on a table (e.g. `returns sales`)
  // cannot be created this early, which is why the identical block is repeated after the data: the
  // second pass is the authority, and `create or replace` makes the first one harmless.
  const functions = await client.query(`
    select p.proname, pg_get_functiondef(p.oid) as src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by p.proname`);

  // `-- @phase:` is read by scripts/restore-verify.mjs, which uses it to tell a failure that is
  // expected from one that is not. Phase 1 is best-effort by construction: a function whose return
  // type is a table's row type cannot exist before that table does, so a small number of statements
  // here are *supposed* to fail and are re-applied later in the file. Naming the phase in the file
  // keeps that expectation auditable instead of burying it in a comment about how restores work.
  const emitFunctions = (heading, note, { validateBodies, phase }) => {
    push(`-- @phase: ${phase}`);
    push(`-- ─── ${heading} ───────────────────────────────────`);
    push(`-- ${note}`);
    // A `language sql` body is parsed and validated when the function is created, and this schema
    // has SQL functions over tables that do not exist yet at this point in the file. Deferring
    // validation is what pg_dump does for the same reason; the authoritative pass below runs with
    // validation back on, so a body that is genuinely broken still fails there and is reported.
    if (!validateBodies) push('set check_function_bodies = off;');
    for (const f of functions.rows) {
      push(`-- ${f.proname}`);
      push(`${f.src.trim()};`);
    }
    if (!validateBodies) push('set check_function_bodies = on;');
    push('');
  };

  emitFunctions(
    'Functions (before tables)',
    'Needed so column defaults such as reminder_configs.shop_id default current_shop_id() resolve.',
    { validateBodies: false, phase: 'functions-pre-tables' },
  );

  // ── 4b. Tables: columns and primary keys. No foreign keys yet, on purpose ─────────────────
  push('-- ─── Tables ──────────────────────────────────────────────');
  for (const { relname } of tables.rows) {
    const cols = await client.query(
      `select a.attname, format_type(a.atttypid, a.atttypmod) as type,
              a.attnotnull as notnull,
              pg_get_expr(d.adbin, d.adrelid) as default_expr,
              a.attidentity as identity, a.attgenerated as generated
       from pg_attribute a
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
       order by a.attnum`,
      [`public.${ident(relname)}`],
    );
    const defs = cols.rows.map((c) => {
      let def = `${ident(c.attname)} ${c.type}`;
      if (c.generated === 's' && c.default_expr) def += ` generated always as (${c.default_expr}) stored`;
      else if (c.identity && c.identity !== '') def += ` generated ${c.identity === 'a' ? 'always' : 'by default'} as identity`;
      else if (c.default_expr) def += ` default ${c.default_expr}`;
      if (c.notnull) def += ' not null';
      return def;
    });
    const pk = await client.query(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conrelid = $1::regclass and contype = 'p'`,
      [`public.${ident(relname)}`],
    );
    // The constraint NAME is preserved, not just the expression: a restore that renames a primary
    // key silently is a restore that no longer matches the schema it claims to reproduce.
    const body = [
      ...defs,
      ...pk.rows.map((r) => `constraint ${ident(r.conname)} primary key ${r.def.replace(/^PRIMARY KEY /, '')}`),
    ];
    push(`create table if not exists public.${ident(relname)} (`);
    push(`  ${body.join(',\n  ')}`);
    push(`);`);
  }
  push('');

  // ═══ DATA ════════════════════════════════════════════════════════════════════════════════

  push('-- ═══ DATA ═══════════════════════════════════════════════');
  push('-- No foreign keys exist yet: rows load in any order.');

  // ── 5. Every row of every public table, no cap ───────────────────────────────────────────
  // The previous version skipped tables over 1000 rows. Silent omission is how a backup passes
  // review and fails at the worst moment, so every row is written and every count is recorded.
  for (const { relname } of tables.rows) {
    const entry = columnsByTable.get(relname) ?? { all: [], generated: new Set() };
    const dumpColumns = entry.all.filter((c) => !entry.generated.has(c));
    const { rows: data } = await client.query(`select * from public.${ident(relname)}`);
    manifest.tableCounts[`public.${relname}`] = data.length;

    push('');
    push(`-- ${relname}: ${data.length} row(s)`);
    if (!data.length) continue;

    const overriding = entry.alwaysIdentity ? ' overriding system value' : '';
    for (const row of data) {
      const values = dumpColumns.map((c) => lit(row[c], entry.types.get(c))).join(', ');
      push(
        `insert into public.${ident(relname)} (${dumpColumns.map(ident).join(', ')})${overriding} ` +
          `values (${values}) on conflict do nothing;`,
      );
    }
  }

  // ── 6. Auth identities, so a restored database can actually be signed into ────────────────
  push('');
  push('-- ─── Auth identities (SENSITIVE: password hashes) ────────');
  for (const authTable of ['auth.users', 'auth.identities']) {
    const exists = await client.query(`select to_regclass($1) as t`, [authTable]);
    if (!exists.rows[0].t) {
      push(`-- ${authTable} not present; skipped`);
      continue;
    }
    const generated = await client.query(
      `select a.attname from pg_attribute a
       where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = 's'`,
      [authTable],
    );
    const skip = new Set(generated.rows.map((r) => r.attname));
    const { rows: data } = await client.query(`select * from ${authTable}`);
    manifest.tableCounts[authTable] = data.length;
    push(`-- ${authTable}: ${data.length} row(s)`);
    if (!data.length) continue;
    const dumpColumns = Object.keys(data[0]).filter((c) => !skip.has(c));
    const types = authTypes.get(authTable.replace(/^auth\./, '')) ?? new Map();
    for (const row of data) {
      const values = dumpColumns.map((c) => lit(row[c], types.get(c))).join(', ');
      push(
        `insert into ${authTable} (${dumpColumns.map(ident).join(', ')}) values (${values}) ` +
          `on conflict do nothing;`,
      );
    }
  }

  // ═══ POST-DATA ═══════════════════════════════════════════════════════════════════════════

  push('');
  push('-- ═══ POST-DATA ══════════════════════════════════════════');
  push('');

  // ── 7. Functions, twice more, now that every table and row exists ────────────────────────
  // The second pass is unvalidated: it is what guarantees every function EXISTS, including the few
  // whose signatures name a table row type and could not be created earlier. That guarantee is
  // exactly what makes the third pass meaningful — with every callee already present, a failure in
  // the validated pass can only mean the body itself is broken, never that it was reached in an
  // unlucky order. Without the middle pass, `app_is_admin()` (alphabetically early) is validated
  // before `membership_in_active_shop()` exists and fails for a reason that has nothing to do with
  // the definition being wrong.
  emitFunctions(
    'Functions (materialising pass)',
    'Creates every remaining function, including those whose signatures name a table row type.',
    { validateBodies: false, phase: 'functions-post-data' },
  );

  emitFunctions(
    'Functions (authoritative pass)',
    'Re-applies every function with body validation on, now that every callee exists.',
    { validateBodies: true, phase: 'functions-authoritative' },
  );
  manifest.structure.functions = functions.rows.length;

  push('-- ─── Views ───────────────────────────────────────────────');
  const views = await client.query(`
    select c.relname, pg_get_viewdef(c.oid, true) as def, c.reloptions
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v' order by 1`);
  for (const v of views.rows) {
    push(`create or replace view public.${ident(v.relname)} as ${v.def.trim()}`);
    if (v.reloptions?.some((o) => o.includes('security_invoker'))) {
      push(`alter view public.${ident(v.relname)} set (security_invoker = true);`);
    }
  }
  manifest.structure.views = views.rows.map((v) => v.relname);

  // ── 8. Constraints and indexes, now that every row is in place ───────────────────────────
  push('');
  push('-- ─── Foreign keys, uniques and checks ────────────────────');
  const constraints = await client.query(`
    select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype in ('f','u','c')
    order by 1, 2`);
  for (const c of constraints.rows) {
    const tbl = c.tbl.replace(/^public\./, '');
    push(
      `do $$ begin alter table public.${ident(tbl)} add constraint ${ident(c.conname)} ${c.def};` +
        ` exception when duplicate_object then null; end $$;`,
    );
  }

  push('');
  push('-- ─── Indexes ─────────────────────────────────────────────');
  // Indexes that back a primary key or unique constraint are skipped: those constraints are
  // created above and bring their index with them. Skipping by catalogue identity rather than by
  // name pattern is what keeps a renamed constraint index from reappearing as a duplicate.
  const constraintIndexes = await client.query(`
    select i.relname as name
    from pg_constraint c
    join pg_class i on i.oid = c.conindid
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype in ('p','u')`);
  const skipIndexes = new Set(constraintIndexes.rows.map((r) => r.name));
  const indexes = await client.query(`
    select indexname, indexdef from pg_indexes where schemaname = 'public' order by indexname`);
  for (const i of indexes.rows) {
    if (skipIndexes.has(i.indexname)) continue;
    push(`${i.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, (m, u) => `create ${u ? 'unique ' : ''}index if not exists `)};`);
  }
  manifest.structure.indexes = indexes.rows.length - skipIndexes.size;
  manifest.structure.foreignKeys = constraints.rows.filter((c) => c.def.startsWith('FOREIGN')).length;
  manifest.structure.checks = constraints.rows.filter((c) => c.def.startsWith('CHECK')).length;
  manifest.structure.uniques = constraints.rows.filter((c) => c.def.startsWith('UNIQUE')).length;

  push('');
  push('-- ─── Triggers ────────────────────────────────────────────');
  const triggers = await client.query(`
    select t.tgname, c.relname, pg_get_triggerdef(t.oid) as def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal order by 1`);
  for (const t of triggers.rows) push(`${t.def.trim()};`);
  manifest.structure.triggers = triggers.rows.length;

  push('');
  push('-- ─── Row level security ──────────────────────────────────');
  for (const { relname } of tables.rows) {
    push(`alter table public.${ident(relname)} enable row level security;`);
  }
  const policies = await client.query(`
    select tablename, policyname, cmd, qual, with_check, roles::text as roles
    from pg_policies where schemaname = 'public' order by tablename, policyname`);
  for (const p of policies.rows) {
    const qual = p.qual ? ` using (${p.qual})` : '';
    const check = p.with_check ? ` with check (${p.with_check})` : '';
    push(`drop policy if exists ${ident(p.policyname)} on public.${ident(p.tablename)};`);
    push(
      `create policy ${ident(p.policyname)} on public.${ident(p.tablename)} ` +
        `for ${p.cmd} to ${p.roles.replace(/^\{|\}$/g, '')}${qual}${check};`,
    );
  }
  manifest.structure.policies = policies.rows.length;
  manifest.structure.tables = tables.rows.length;
  manifest.structure.enums = enums.rows.length;

  await client.end();

  // ── 9. Write the artifact and its manifest ────────────────────────────────────────────────
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const body = lines.join('\n');
  fs.writeFileSync(outFile, body);

  manifest.bytes = Buffer.byteLength(body);
  manifest.sha256 = crypto.createHash('sha256').update(body).digest('hex');
  manifest.totalRows = Object.values(manifest.tableCounts).reduce((a, b) => a + b, 0);
  manifest.tablesDumped = Object.keys(manifest.tableCounts).length;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BACKUP COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Environment:  ${manifest.environment}`);
  console.log(`  Project:      ${manifest.projectRef}`);
  console.log(`  Cluster:      ${manifest.identity.clusterId ?? 'unavailable'}`);
  console.log(`  Credential:   ${manifest.identity.configuredUser}`);
  console.log(`  Artifact:     ${outFile}`);
  console.log(`  Manifest:     ${manifestFile}`);
  console.log(`  Size:         ${(manifest.bytes / 1024).toFixed(1)} KB`);
  console.log(`  Tables:       ${manifest.tablesDumped}   Rows: ${manifest.totalRows}`);
  console.log(`  FKs:          ${manifest.structure.foreignKeys}   Policies: ${manifest.structure.policies}`);
  console.log(`  sha256:       ${manifest.sha256.slice(0, 16)}…`);
  console.log('  Contains personal data and password hashes — never commit this file.');
  console.log('');
}

main().catch((error) => {
  fail(`${error.message}\n${error.stack ?? ''}`);
});
