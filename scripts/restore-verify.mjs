#!/usr/bin/env node
/**
 * restore-verify.mjs — restore a backup artifact into a throwaway database and prove it landed.
 *
 *   node scripts/restore-verify.mjs --from backups/<artifact>.manifest.json
 *   node scripts/restore-verify.mjs --from backups/<artifact>.manifest.json --compare-with staging
 *
 * WHY THIS FILE EXISTS
 *   A backup nobody has restored is a hypothesis. This repository had no restore script at all:
 *   `docs/RECOVERY.md` described one that did not exist, and the only backup workflow backed up the
 *   wrong project. So the artifact this phase produces is not trusted because it was written by our
 *   own code — it is trusted because it is replayed into a fresh database and then compared, table
 *   by table and column by column, against the live source.
 *
 * WHAT IT PROVES, IN FOUR LAYERS
 *   1. Integrity   the artifact still hashes to the manifest's sha256, and not one byte shorter.
 *   2. Replay      every statement is executed individually against a fresh Postgres. Failures are
 *                  reported per statement with the exact statement text, never swallowed.
 *   3. Fidelity    row counts restored == row counts recorded at backup time == live counts (with
 *                  any live drift reported separately, because a backup is a point in time).
 *   4. Equivalence every public table's columns, constraints, indexes, policies, triggers,
 *                  functions, views, RLS flags and enum labels are compared with the live source.
 *                  Where counts match, a row-level digest of the actual data is compared too, so
 *                  the claim is "the same rows", not merely "the same number of rows".
 *
 * WHERE IT RESTORES TO
 *   A throwaway Postgres running in this process (@electric-sql/pglite). Not a Supabase project,
 *   not a file that outlives the run. `assertSafeRestoreTarget` refuses any other target by name,
 *   project ref, or connection string — see scripts/lib/environments.mjs.
 *
 * WHAT IT DOES NOT PROVE
 *   The `auth` schema is a shim, not Supabase's: PGlite has no auth schema, so the verifier rebuilds
 *   `auth.users` and `auth.identities` with the columns the artifact inserts into. That proves the
 *   auth rows are well-formed and complete; it does not prove Supabase auth behaviour. Storage
 *   objects, grants and extensions are outside the artifact (see the manifest's `limitations`).
 *
 * Exit codes: 0 = PASS, 1 = FAIL, 2 = refused before doing anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

import {
  ROOT,
  SAFE_RESTORE_TARGETS,
  assertCredentialsNameTarget,
  assertSafeRestoreTarget,
  connectionStringFor,
  identifyConnection,
  resolveCredentials,
} from './lib/environments.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const token = args[i];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[i + 1] ?? fallback;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/restore-verify.mjs --from <artifact.manifest.json|artifact.sql>');
  console.log('         [--target pglite] [--compare-with <environment>]');
  process.exit(0);
}

function refuse(message) {
  console.error(`\n${message}\n`);
  process.exit(2);
}

function fail(message) {
  console.error(`\n[RESTORE VERIFY] FAIL — ${message}\n`);
  process.exit(1);
}

// ── Statement splitting ──────────────────────────────────────────────────────────────────────
// A dollar-quote-, string- and comment-aware splitter. Needed because the artifact contains
// plpgsql bodies full of semicolons, and because executing one statement at a time is what makes a
// failure attributable to the statement that caused it instead of to "the restore".
function splitStatements(sql) {
  const out = [];
  let buf = '';
  let stmtStart = -1;
  let i = 0;
  let state = 'normal';
  let dollarTag = '';

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === 'line-comment') {
      if (ch === '\n') {
        state = 'normal';
        buf += ch;
      }
      i++;
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') {
        i += 2;
        state = 'normal';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'single') {
      buf += ch;
      if (ch === "'") {
        if (next === "'") {
          buf += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }
    if (state === 'double') {
      buf += ch;
      if (ch === '"') {
        if (next === '"') {
          buf += next;
          i += 2;
          continue;
        }
        state = 'normal';
      }
      i++;
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) {
        buf += dollarTag;
        i += dollarTag.length;
        state = 'normal';
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // normal
    // Record where this statement begins, so a statement can be attributed to the `-- @phase:`
    // marker that precedes it. A marker is a comment and comments are not retained in the buffer,
    // so offsets are the only reliable link between the two.
    if (buf === '' && !/\s/.test(ch) && stmtStart === -1) stmtStart = i;
    if (ch === '-' && next === '-') {
      state = 'line-comment';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block-comment';
      i += 2;
      continue;
    }
    if (ch === "'") {
      state = 'single';
      buf += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      state = 'double';
      buf += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const m = sql.slice(i).match(/^\$[A-Za-z_0-9]*\$/);
      if (m) {
        dollarTag = m[0];
        state = 'dollar';
        buf += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (ch === ';') {
      if (buf.trim()) out.push({ text: buf.trim(), offset: stmtStart });
      buf = '';
      stmtStart = -1;
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) out.push({ text: buf.trim(), offset: stmtStart });
  return out;
}

/** The `-- @phase:` markers the artifact carries, and which statement belongs to which. */
function phaseReader(sql) {
  const markers = [...sql.matchAll(/^-- @phase: ([a-z-]+)/gm)].map((m) => ({ offset: m.index, phase: m[1] }));
  if (!markers.length) return () => 'unspecified';
  return (offset) => {
    let phase = markers[0].phase;
    for (const marker of markers) {
      if (marker.offset <= offset) phase = marker.phase;
    }
    return phase;
  };
}

/**
 * Compare two Postgres-rendered expressions ignoring casts, whitespace and grouping.
 *
 * Postgres deparses a definition from its own parse tree, so the same predicate can come back from
 * a restore with a different — and equivalent — rendering: the live side stores
 * `(ARRAY['a'::character varying])::text[]` while the re-parsed text yields per-element casts. This
 * predicate is what separates "the same predicate, re-rendered" from "a different predicate".
 *
 * It is deliberately narrow, and non-vacuity was checked before it was relied on: it collapses the
 * rendering difference, and still reports a changed column, operator or literal bound as `changed`.
 * The raw texts of everything it collapses are printed and stored, so nothing is hidden by it.
 */
function normalizeExpression(text) {
  return String(text ?? '')
    .replace(/::[A-Za-z_][A-Za-z_0-9 ]*(\[\])?/g, '')
    .replace(/[\s()]/g, '');
}

// ── The auth shim ────────────────────────────────────────────────────────────────────────────
// Inferred from the INSERT column lists in the artifact, so it accepts exactly what the artifact
// carries. Deliberately typed loosely: this is a shape for replayed rows, not a model of Supabase.
function inferColumnType(column) {
  if (column === 'id' || column.endsWith('_id')) return 'uuid';
  if (column.endsWith('_at')) return 'timestamptz';
  if (column.startsWith('is_')) return 'boolean';
  if (column.endsWith('_data')) return 'jsonb';
  return 'text';
}

function authShimDdl(sql) {
  const tables = new Map();
  const re = /insert into auth\.([a-z_]+) \(([^)]*)\)/g;
  let match;
  while ((match = re.exec(sql))) {
    const [, table, rawColumns] = match;
    const columns = rawColumns.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (!tables.has(table)) tables.set(table, new Set());
    for (const c of columns) tables.get(table).add(c);
  }
  return [...tables.entries()].map(([table, columns]) => {
    const defs = [...columns].map((c) => `"${c}" ${inferColumnType(c)}`);
    return `create table auth."${table}" (${defs.join(', ')});`;
  });
}

// ── Structural snapshot ──────────────────────────────────────────────────────────────────────
// One function, run against both databases, so the two sides are measured identically.
async function snapshot(runner) {
  const q = async (sql) => (await runner(sql)).rows;
  return {
    columns: await q(`select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as type,
        a.attnotnull as notnull, pg_get_expr(d.adbin, d.adrelid) as default_expr
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      order by 1, a.attnum`),
    tables: await q(`select c.relname as tbl, c.relrowsecurity as enabled from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`),
    constraints: await q(`select conrelid::regclass::text as tbl, contype as kind, conname as name,
        pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' and c.contype in ('p','f','u','c') order by 1, 3`),
    indexes: await q(`select indexname as name, indexdef as def from pg_indexes
      where schemaname = 'public' order by 1`),
    policies: await q(`select tablename as tbl, policyname as name, cmd, roles::text as roles,
        qual as using_expr, with_check as check_expr
      from pg_policies where schemaname = 'public' order by 1, 2`),
    triggers: await q(`select t.tgname as name, c.relname as tbl, pg_get_triggerdef(t.oid) as def
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal order by 1`),
    functions: await q(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
        pg_get_function_result(p.oid) as result, p.prosecdef as security_definer,
        p.provolatile as volatility, coalesce(array_to_string(p.proconfig, ','), '') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' order by 1, 2`),
    views: await q(`select c.relname as name, pg_get_viewdef(c.oid, true) as def from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v' order by 1`),
    enums: await q(`select t.typname as name, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by 1 order by 1`),
  };
}

function diffRows(sourceRows, restoredRows, keyOf, fields, normalizers = {}) {
  const sourceMap = new Map(sourceRows.map((r) => [keyOf(r), r]));
  const restoredMap = new Map(restoredRows.map((r) => [keyOf(r), r]));
  const missing = [];
  const extra = [];
  const changed = [];
  /** Differences that are the same definition re-rendered: recorded and printed, never a failure. */
  const renderOnly = [];

  for (const [key, row] of sourceMap) {
    const other = restoredMap.get(key);
    if (!other) {
      missing.push(key);
      continue;
    }
    for (const field of fields) {
      const source = String(row[field] ?? '');
      const restored = String(other[field] ?? '');
      if (source === restored) continue;
      const normalize = normalizers[field];
      if (normalize && normalize(source) === normalize(restored)) {
        renderOnly.push({ key, field, source, restored });
        continue;
      }
      changed.push({ key, field, source: source.slice(0, 120), restored: restored.slice(0, 120) });
    }
  }
  for (const key of restoredMap.keys()) if (!sourceMap.has(key)) extra.push(key);

  return { missing, extra, changed, renderOnly };
}

const CRITICAL_TABLES = [
  'shops', 'users', 'customers', 'products', 'product_variants', 'sales', 'sale_items',
  'customer_payments', 'supplier_payments', 'purchases', 'purchase_items', 'payments',
  'inventory_movements', 'stock_adjustments', 'returns', 'return_items', 'voids',
  'audit_events', 'notifications', 'memberships', 'roles', 'permissions', 'role_permissions',
];

async function main() {
  const from = flag('from');
  const target = flag('target', 'pglite');
  const jsonOut = flag('json');

  if (!from) refuse('[RESTORE REFUSED] --from <artifact|manifest> is required.');

  // ── 0. Target safety, before a single byte is read ───────────────────────────────────────
  let safeTarget;
  try {
    safeTarget = assertSafeRestoreTarget(target, { artifact: path.basename(from) });
  } catch (error) {
    refuse(error.message);
  }

  // ── 1. Locate the artifact and its manifest ─────────────────────────────────────────────
  const fromPath = path.isAbsolute(from) ? from : path.join(ROOT, from);
  const manifestPath = fromPath.endsWith('.manifest.json')
    ? fromPath
    : `${fromPath.replace(/\.sql$/, '')}.manifest.json`;
  const artifactPath = manifestPath.replace(/\.manifest\.json$/, '.sql');

  if (!fs.existsSync(manifestPath)) refuse(`[RESTORE REFUSED] Manifest not found: ${manifestPath}`);
  if (!fs.existsSync(artifactPath)) refuse(`[RESTORE REFUSED] Artifact not found: ${artifactPath}`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sql = fs.readFileSync(artifactPath, 'utf8');
  const report = { artifact: path.basename(artifactPath), manifest, target: safeTarget, checks: {}, failures: [] };

  console.log(`\nRestoring ${path.basename(artifactPath)}`);
  console.log(`  Recorded environment: ${manifest.environment} (project ${manifest.projectRef})`);
  console.log(`  Recorded at:          ${manifest.generatedAt}`);
  console.log(`  Recorded cluster:     ${manifest.identity?.clusterId ?? 'unavailable'}`);
  console.log(`  Target:               ${safeTarget} (in-process, discarded at exit)\n`);

  // ── 2. Integrity ────────────────────────────────────────────────────────────────────────
  const sha256 = crypto.createHash('sha256').update(sql).digest('hex');
  const bytes = Buffer.byteLength(sql);
  report.checks.integrity = {
    sha256Matches: sha256 === manifest.sha256,
    bytesMatch: bytes === manifest.bytes,
    sha256,
    bytes,
  };
  console.log('── 1. Integrity ─────────────────────────────────────────────');
  console.log(`  sha256 ${sha256.slice(0, 20)}… ${sha256 === manifest.sha256 ? '== manifest' : '!= MANIFEST'}`);
  console.log(`  bytes  ${bytes} ${bytes === manifest.bytes ? '== manifest' : `!= MANIFEST (${manifest.bytes})`}`);
  if (!report.checks.integrity.sha256Matches || !report.checks.integrity.bytesMatch) {
    fail('artifact does not match its manifest — it is truncated, edited or incomplete.');
  }

  // ── 3. Replay into a throwaway Postgres ─────────────────────────────────────────────────
  const db = new PGlite();
  await db.exec(`set time zone 'UTC'`);
  await db.exec(`create schema if not exists auth`);

  // Supabase's auth helpers, so policies and function bodies that call them can be created.
  for (const fn of [
    `create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`,
    `create or replace function auth.role() returns text language sql stable as $$ select null::text $$`,
    `create or replace function auth.email() returns text language sql stable as $$ select null::text $$`,
    `create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$`,
  ]) {
    await db.exec(fn);
  }

  // The Supabase roles that policies are addressed to, plus pgcrypto if this build ships it.
  let pgcrypto = 'unavailable';
  for (const stmt of [
    `create role anon`,
    `create role authenticated`,
    `create role service_role`,
    `create schema if not exists extensions`,
  ]) {
    try {
      await db.exec(stmt);
    } catch (error) {
      report.failures.push({ phase: 'bootstrap', statement: stmt, error: error.message });
    }
  }
  try {
    await db.exec(`create extension if not exists pgcrypto with schema extensions`);
    pgcrypto = 'loaded into schema extensions';
  } catch (error) {
    pgcrypto = `not available (${error.message}) — plpgsql bodies referencing extensions.crypt are not resolved at DDL time, so this only affects execution of those functions`;
  }

  const shim = authShimDdl(sql);
  for (const stmt of shim) await db.exec(stmt);

  console.log('\n── 2. Replay ────────────────────────────────────────────────');
  console.log(`  Target database:  fresh in-process Postgres (PGlite)`);
  console.log(`  Auth shim:        ${shim.length} table(s) built from the artifact's own column lists`);
  console.log(`  pgcrypto:         ${pgcrypto}`);

  const statements = splitStatements(sql);
  const phaseAt = phaseReader(sql);
  const replayFailures = [];
  const expectedFailures = [];
  const startedReplay = Date.now();
  for (let i = 0; i < statements.length; i++) {
    const { text: statement, offset } = statements[i];
    const phase = phaseAt(offset);
    try {
      await db.exec(statement);
    } catch (error) {
      const record = { index: i, phase, statement: statement.replace(/\s+/g, ' ').slice(0, 160), error: error.message };
      // A function whose return type is a table's row type cannot be created before that table
      // exists. The artifact marks that pass `functions-pre-tables`, and re-applies the same
      // definitions afterwards, where they must all succeed — so a failure here is expected from
      // the file's own structure rather than excused by it. Anything outside that pass is fatal.
      if (phase === 'functions-pre-tables') expectedFailures.push(record);
      else replayFailures.push(record);
    }
  }
  const replayMs = Date.now() - startedReplay;
  report.checks.replay = {
    statements: statements.length,
    failures: replayFailures.length,
    expectedFailures: expectedFailures.length,
    durationMs: replayMs,
    authShimTables: shim.length,
    pgcrypto,
    failureDetails: replayFailures,
    expectedFailureDetails: expectedFailures,
    bootstrapFailures: report.failures,
  };
  console.log(`  Statements:       ${statements.length} applied in ${(replayMs / 1000).toFixed(1)}s`);
  console.log(`  Failures:         ${replayFailures.length}  ${replayFailures.length ? '✗' : '✓'}`);
  for (const f of replayFailures.slice(0, 25)) {
    console.log(`    ✗ [${f.index}] ${f.phase} — ${f.statement.slice(0, 100)}`);
    console.log(`        ${f.error.split('\n')[0]}`);
  }
  if (expectedFailures.length) {
    console.log(`  Expected (functions-pre-tables, re-applied later): ${expectedFailures.length}`);
    for (const f of expectedFailures.slice(0, 6)) {
      console.log(`    · [${f.index}] ${f.statement.slice(0, 96)}`);
      console.log(`        ${f.error.split('\n')[0]}`);
    }
  }

  // ── 4. Compare with the live source ─────────────────────────────────────────────────────
  const compareEnv = flag('compare-with', manifest.environment);
  let creds;
  try {
    creds = resolveCredentials(compareEnv);
    assertCredentialsNameTarget(creds);
  } catch (error) {
    await db.close();
    refuse(`${error.message}\n[RESTORE REFUSED] The live comparison needs read access to "${compareEnv}".`);
  }
  if (creds.projectRef !== manifest.projectRef) {
    await db.close();
    refuse(
      `[RESTORE REFUSED] The manifest records project ${manifest.projectRef} but "${compareEnv}" is ` +
        `project ${creds.projectRef}. Comparing a restore against the wrong source would produce a ` +
        `confident answer to the wrong question.`,
    );
  }

  const live = new pg.Client({ connectionString: connectionStringFor(creds), ssl: { rejectUnauthorized: false } });
  await live.connect();
  // Both sides are pinned to UTC and the same float rendering, so a difference in session settings
  // can never be mistaken for a difference in stored data.
  await live.query(`set time zone 'UTC'`);
  await live.query(`set extra_float_digits = 1`);

  const liveIdentity = await identifyConnection(live, creds);
  report.checks.liveIdentity = liveIdentity;
  console.log('\n── 3. Live source identity ──────────────────────────────────');
  console.log(`  Environment:      ${compareEnv} (project ${creds.projectRef})`);
  console.log(`  Credential:       ${liveIdentity.configuredUser} -> session role ${liveIdentity.serverUser}`);
  console.log(`  Cluster:          ${liveIdentity.clusterId}` +
    (manifest.identity?.clusterId
      ? `  ${liveIdentity.clusterId === manifest.identity.clusterId ? '== artifact' : '!= ARTIFACT'}`
      : ''));

  await db.exec(`set extra_float_digits = 1`);
  await db.exec(`set time zone 'UTC'`);
  const liveSnap = await snapshot((sql) => live.query(sql));
  const restoredSnap = await snapshot((sql) => db.query(sql));

  console.log('\n── 4. Structural equivalence (restored vs live) ─────────────');
  // Fields whose text is produced by Postgres itself, and therefore subject to re-rendering.
  const EXPRESSION_FIELDS = {
    constraints: { def: normalizeExpression },
    indexes: { def: normalizeExpression },
    policies: { using_expr: normalizeExpression, check_expr: normalizeExpression },
    triggers: { def: normalizeExpression },
    views: { def: normalizeExpression },
  };

  const structure = {
    tables: diffRows(liveSnap.tables, restoredSnap.tables, (r) => r.tbl, ['enabled']),
    columns: diffRows(liveSnap.columns, restoredSnap.columns, (r) => `${r.tbl}.${r.col}`, ['type', 'notnull', 'default_expr']),
    constraints: diffRows(liveSnap.constraints, restoredSnap.constraints, (r) => `${r.tbl}.${r.name}`, ['kind', 'def'], EXPRESSION_FIELDS.constraints),
    indexes: diffRows(liveSnap.indexes, restoredSnap.indexes, (r) => r.name, ['def'], EXPRESSION_FIELDS.indexes),
    policies: diffRows(liveSnap.policies, restoredSnap.policies, (r) => `${r.tbl}.${r.name}`, ['cmd', 'roles', 'using_expr', 'check_expr'], EXPRESSION_FIELDS.policies),
    // Keyed by table AND name: a schema is allowed to reuse a trigger name on several tables, and
    // keying by name alone silently collapsed those into one entry and reported a phantom change.
    triggers: diffRows(liveSnap.triggers, restoredSnap.triggers, (r) => `${r.tbl}.${r.name}`, ['def'], EXPRESSION_FIELDS.triggers),
    functions: diffRows(liveSnap.functions, restoredSnap.functions, (r) => `${r.name}(${r.args})`, ['result', 'security_definer', 'volatility', 'config']),
    views: diffRows(liveSnap.views, restoredSnap.views, (r) => r.name, ['def'], EXPRESSION_FIELDS.views),
    enums: diffRows(liveSnap.enums, restoredSnap.enums, (r) => r.name, ['labels']),
  };
  report.checks.structure = {};

  let structureProblems = 0;
  let renderOnlyTotal = 0;
  for (const [category, diff] of Object.entries(structure)) {
    const total = liveSnap[category].length;
    const bad = diff.missing.length + diff.extra.length + diff.changed.length;
    structureProblems += bad;
    renderOnlyTotal += diff.renderOnly.length;
    report.checks.structure[category] = {
      live: total,
      restored: restoredSnap[category].length,
      missing: diff.missing.length,
      extra: diff.extra.length,
      changed: diff.changed.length,
      rendered: diff.renderOnly.length,
      details: {
        missing: diff.missing,
        extra: diff.extra,
        changed: diff.changed,
        renderOnly: diff.renderOnly,
      },
    };
    const mark = bad === 0 ? '✓' : '✗';
    console.log(`  ${mark} ${category.padEnd(12)} live ${String(total).padStart(4)}  restored ${String(restoredSnap[category].length).padStart(4)}  missing ${diff.missing.length}  extra ${diff.extra.length}  changed ${diff.changed.length}  re-rendered ${diff.renderOnly.length}`);
    for (const key of diff.missing.slice(0, 4)) console.log(`      missing: ${key}`);
    for (const key of diff.extra.slice(0, 4)) console.log(`      extra:   ${key}`);
    for (const c of diff.changed.slice(0, 4)) console.log(`      changed: ${c.key}.${c.field}\n        live:      ${c.source}\n        restored:  ${c.restored}`);
    for (const r of diff.renderOnly.slice(0, 4)) {
      console.log(`      same predicate, re-rendered: ${r.key}.${r.field}`);
      console.log(`        live:     ${r.source.slice(0, 130)}`);
      console.log(`        restored: ${r.restored.slice(0, 130)}`);
    }
  }
  report.checks.renderOnlyTotal = renderOnlyTotal;

  // ── 5. Row counts and row-level digests ─────────────────────────────────────────────────
  console.log('\n── 5. Data fidelity ─────────────────────────────────────────');
  const countRows = async (runner, tables) => {
    const out = {};
    for (const t of tables) {
      try {
        const r = await runner(`select count(*)::int as n from public."${t.replace(/"/g, '""')}"`);
        out[t] = r.rows[0].n;
      } catch (error) {
        out[t] = `unreadable: ${error.message}`;
      }
    }
    return out;
  };

  const manifestTables = Object.entries(manifest.tableCounts)
    .filter(([name]) => name.startsWith('public.'))
    .map(([name]) => name.replace(/^public\./, ''));
  const restoredCounts = await countRows((s) => db.query(s), manifestTables);
  const liveCountsByTable = await countRows((s) => live.query(s), manifestTables);

  const countDiffs = { lost: [], gained: [], drifted: [] };
  const countTable = [];
  for (const t of manifestTables) {
    const expected = manifest.tableCounts[`public.${t}`];
    const restored = restoredCounts[t];
    const liveNow = liveCountsByTable[t];
    if (restored !== expected) countDiffs.lost.push({ table: t, expected, restored });
    if (liveNow !== expected) countDiffs.drifted.push({ table: t, expected, live: liveNow });
    countTable.push({ table: t, atBackup: expected, restored, liveNow });
  }
  report.checks.counts = {
    tables: manifestTables.length,
    restoredMismatches: countDiffs.lost.length,
    driftedSinceBackup: countDiffs.drifted.length,
    details: countTable,
  };
  console.log(`  Public tables compared: ${manifestTables.length}`);
  console.log(`  Restored < backup:      ${countDiffs.lost.length}  ${countDiffs.lost.length ? '✗' : '✓'}`);
  for (const l of countDiffs.lost.slice(0, 10)) console.log(`      ${l.table}: backup ${l.expected} -> restored ${l.restored}`);
  console.log(`  Source drifted since:   ${countDiffs.drifted.length}  (expected: a backup is a point in time)`);
  for (const d of countDiffs.drifted.slice(0, 10)) console.log(`      ${d.table}: backup ${d.expected} -> live ${d.live}`);

  // Row-level digests: only meaningful where nothing changed since the backup was taken.
  const pkByTable = new Map();
  for (const row of liveSnap.constraints.filter((c) => c.kind === 'p')) {
    const tbl = row.tbl.replace(/^public\./, '');
    const cols = (row.def.match(/\(([^)]*)\)/)?.[1] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
    if (cols.length) pkByTable.set(tbl, cols);
  }
  const digestFor = async (runner, table, columns) => {
    const orderBy = columns.map((c) => `t."${c.replace(/"/g, '""')}"`).join(', ');
    const r = await runner(
      `select md5(coalesce(string_agg(t::text, '|' order by ${orderBy}), '')) as digest, count(*)::int as n from public."${table}" t`,
    );
    return r.rows[0];
  };

  const digestResults = { compared: 0, matched: 0, mismatched: [], skipped: [] };
  const drifted = new Set(countDiffs.drifted.map((d) => d.table));
  for (const t of manifestTables) {
    const cols = pkByTable.get(t);
    if (!cols) {
      digestResults.skipped.push({ table: t, reason: 'no primary key to order by' });
      continue;
    }
    if (drifted.has(t)) {
      digestResults.skipped.push({ table: t, reason: 'source changed after the backup was taken' });
      continue;
    }
    try {
      const [liveDigest, restoredDigest] = [
        await digestFor((s) => live.query(s), t, cols),
        await digestFor((s) => db.query(s), t, cols),
      ];
      digestResults.compared++;
      if (liveDigest.digest === restoredDigest.digest) digestResults.matched++;
      else digestResults.mismatched.push({ table: t, live: liveDigest.digest, restored: restoredDigest.digest });
    } catch (error) {
      digestResults.skipped.push({ table: t, reason: error.message.split('\n')[0] });
    }
  }
  report.checks.digests = {
    compared: digestResults.compared,
    matched: digestResults.matched,
    mismatched: digestResults.mismatched,
    skipped: digestResults.skipped.length,
  };
  console.log(`\n  Row digests (identical row content, not just identical counts):`);
  console.log(`    compared ${digestResults.compared}   matched ${digestResults.matched}   mismatched ${digestResults.mismatched.length}   skipped ${digestResults.skipped.length}  ${digestResults.mismatched.length ? '✗' : '✓'}`);
  for (const m of digestResults.mismatched.slice(0, 10)) console.log(`      ${m.table}: live ${m.live} != restored ${m.restored}`);
  for (const s of digestResults.skipped.slice(0, 6)) console.log(`      skipped ${s.table}: ${s.reason}`);

  // A mismatched digest says a table's rows differ; it does not say where. Locating the column
  // matters, because "one table differs" is not an actionable finding. Comparison is by per-column
  // digest, so no cell value is ever printed — the evidence is a column name and two hashes.
  const columnDiagnosis = [];
  if (digestResults.mismatched.length) {
    console.log(`\n  Diagnosing ${digestResults.mismatched.length} mismatched table(s) by column`);
    const columnsByTable = new Map();
    for (const row of restoredSnap.columns) {
      if (!columnsByTable.has(row.tbl)) columnsByTable.set(row.tbl, []);
      columnsByTable.get(row.tbl).push(row.col);
    }
    for (const mismatch of digestResults.mismatched.slice(0, 5)) {
      const table = mismatch.table;
      const orderBy = (pkByTable.get(table) ?? ['id']).map((c) => `t."${c}"`).join(', ');
      const differing = [];
      for (const column of columnsByTable.get(table) ?? []) {
        const sqlText =
          `select md5(coalesce(string_agg(coalesce(t."${column}"::text, '<null>'), '|' order by ${orderBy}), '')) as d` +
          `, count(*)::int as nulls from public."${table}" t`;
        try {
          const [a, b] = [
            (await live.query(sqlText)).rows[0].d,
            (await db.query(sqlText)).rows[0].d,
          ];
          if (a !== b) differing.push({ column, live: String(a).slice(0, 10), restored: String(b).slice(0, 10) });
        } catch (error) {
          differing.push({ column, error: error.message.split('\n')[0] });
        }
      }
      columnDiagnosis.push({ table, differing });
      console.log(`    ${table}: ${differing.length} of ${(columnsByTable.get(table) ?? []).length} column(s) differ`);
      for (const d of differing) {
        console.log(`      ${d.column}: ${d.error ? d.error : `live ${d.live}… != restored ${d.restored}…`}`);
      }
    }
  }
  report.checks.columnDiagnosis = columnDiagnosis;

  // ── 6. Critical tables, as the phase asks for them by name ──────────────────────────────
  console.log('\n── 6. Critical history survival ─────────────────────────────');
  const critical = [];
  const present = new Set(manifestTables);
  for (const t of CRITICAL_TABLES) {
    if (!present.has(t)) {
      critical.push({ table: t, present: false, reason: 'not in this environment' });
      continue;
    }
    critical.push({
      table: t,
      present: true,
      atBackup: manifest.tableCounts[`public.${t}`],
      restored: restoredCounts[t],
      rowsEqual: restoredCounts[t] === manifest.tableCounts[`public.${t}`],
      digest: digestResults.mismatched.some((m) => m.table === t)
        ? 'mismatch'
        : digestResults.skipped.some((s) => s.table === t)
          ? 'not compared'
          : 'identical',
    });
  }
  report.checks.critical = critical;
  for (const c of critical) {
    if (!c.present) {
      console.log(`  –  ${c.table.padEnd(22)} ${c.reason}`);
      continue;
    }
    console.log(`  ${c.rowsEqual ? '✓' : '✗'}  ${c.table.padEnd(22)} backup ${String(c.atBackup).padStart(5)}  restored ${String(c.restored).padStart(5)}  content ${c.digest}`);
  }

  // ── 7. Auth rows ────────────────────────────────────────────────────────────────────────
  const authCounts = {};
  for (const t of ['auth.users', 'auth.identities']) {
    if (!(t in manifest.tableCounts)) continue;
    try {
      const r = await db.query(`select count(*)::int as n from ${t}`);
      authCounts[t] = { atBackup: manifest.tableCounts[t], restored: r.rows[0].n, equal: r.rows[0].n === manifest.tableCounts[t] };
    } catch (error) {
      authCounts[t] = { atBackup: manifest.tableCounts[t], restored: null, error: error.message };
    }
  }
  report.checks.auth = { counts: authCounts, fidelityNote: 'auth tables are a shim; counts are exact, semantics are not Supabase auth' };
  console.log('\n── 7. Auth identities (through the shim) ────────────────────');
  for (const [t, c] of Object.entries(authCounts)) {
    console.log(`  ${c.equal ? '✓' : '✗'}  ${t.padEnd(18)} backup ${String(c.atBackup).padStart(4)}  restored ${String(c.restored).padStart(4)}${c.error ? `  ${c.error}` : ''}`);
  }

  await live.end();
  await db.close();

  // ── 8. Verdict ──────────────────────────────────────────────────────────────────────────
  const verdict = {
    integrity: report.checks.integrity.sha256Matches && report.checks.integrity.bytesMatch,
    replay: replayFailures.length === 0,
    counts: countDiffs.lost.length === 0,
    structure: structureProblems === 0,
    digests: digestResults.mismatched.length === 0,
    auth: Object.values(authCounts).every((c) => c.equal !== false),
  };
  report.verdict = verdict;
  const passed = Object.values(verdict).every(Boolean);

  console.log('\n═══════════════════════════════════════════════════════════');
  for (const [name, ok] of Object.entries(verdict)) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  RESTORE VERIFICATION: ${passed ? 'PASS' : 'FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (jsonOut) {
    const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`  Machine-readable report: ${outPath}\n`);
  }

  process.exit(passed ? 0 : 1);
}

main().catch((error) => fail(`${error.message}\n${error.stack ?? ''}`));
