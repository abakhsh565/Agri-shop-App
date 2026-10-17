#!/usr/bin/env node
/**
 * audit-app-surface.mjs — READ ONLY. What the app asks the database for, answered against a live one.
 *
 * WHY THIS EXISTS
 *   A database can hold every table and still lack a column the client selects. Production's
 *   `business_settings` is the measured example: the app selects `setting_value` where
 *   `setting_key = 'crops'`, production's copy still has the pre-`0093` shape (`id, owner_id, crops,
 *   updated_at`), and PostgREST answers 400 — once per customer row on the customers screen — so the
 *   crop-based reminders are silently empty. No migration guard could see it: the file exists, the
 *   ledger is complete, and the columns the app names are simply not there.
 *
 * WHAT IT DOES
 *   1. Scans `src/` for `.from("<table>")` followed by a `.select(...)` whose argument is a simple
 *      column list, and for `supabase.rpc("<name>")`.
 *   2. Asks the connected database for each table's columns, and for each RPC's existence.
 *   3. Reports every column the app names that the table does not have, and every RPC the app calls
 *      that `public` does not define. Embedded selects (`sale_items(*)`, `users(name)`) are skipped
 *      rather than guessed at, and the count of skipped ones is printed, so the report is honest about
 *      its own coverage.
 *
 * WHAT IT REFUSES
 *   Any environment not named with `--env`. Production additionally requires the credential wrapper
 *   to have supplied the password (the script never reads the credentials file itself).
 *
 * Usage:
 *   node scripts/audit-app-surface.mjs --env staging
 *   node scripts/run-with-production-credentials.mjs -- node scripts/audit-app-surface.mjs --env production
 *
 * Exit codes: 0 = nothing missing, 1 = something the app asks for is absent, 2 = refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { ROOT, connectionStringFor } from './lib/environments.mjs';

const envIndex = process.argv.indexOf('--env');
const environment = envIndex === -1 ? null : process.argv[envIndex + 1];
if (!['production', 'staging'].includes(environment ?? '')) {
  console.error('[REFUSED] name the environment: --env production|staging');
  process.exit(2);
}
const jsonIndex = process.argv.indexOf('--json');
const jsonOut = jsonIndex === -1 ? null : process.argv[jsonIndex + 1];

// Production credentials arrive from the wrapper (never from a file this script opens); QA's come
// from `.env.qa`, which is the same file the integration suite signs in with.
let envPrefix;
let values;
if (environment === 'production') {
  envPrefix = 'PROD';
  values = {
    PROD_DB_HOST: process.env.PROD_DB_HOST,
    PROD_DB_USER: process.env.PROD_DB_USER,
    PROD_DB_PASS: process.env.PROD_DB_PASS,
  };
  if (!values.PROD_DB_PASS) {
    console.error('[REFUSED] production credentials must be supplied by scripts/run-with-production-credentials.mjs');
    process.exit(2);
  }
} else {
  envPrefix = 'QA';
  values = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env.qa'), 'utf8').split('\n')) {
    if (!line.includes('=')) continue;
    values[line.split('=')[0].trim()] = line.split('=').slice(1).join('=').trim().replace(/^\[|\]$/g, '');
  }
}
const connectionString = connectionStringFor({ values, envPrefix });

// ── 1. What the app asks for ────────────────────────────────────────────────────────────────────
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SOURCE_ROOT = path.join(ROOT, 'src');

/** Every file under src/, without following symlinks. */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

/** `from("x")` … `select("a, b")` inside one statement, and `rpc("name")`. */
const asks = new Map(); // table -> Map(column -> Set<file>)
const rpcs = new Map(); // name -> Set<file>
let skippedEmbedded = 0;

function record(table, column, file) {
  const rel = path.relative(ROOT, file);
  if (!asks.has(table)) asks.set(table, new Map());
  const columns = asks.get(table);
  if (!columns.has(column)) columns.set(column, new Set());
  columns.get(column).add(rel);
}

for (const file of walk(SOURCE_ROOT)) {
  const text = fs.readFileSync(file, 'utf8');
  // Simple column lists only: word characters, commas and spaces. Anything with `(`, `!` or `:` is an
  // embedded resource or a cast, and this audit refuses to guess what PostgREST would resolve it to.
  const re = /\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)\s*\.select\(\s*["'`]([^"'`]*)["'`]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const [, table, selection] = match;
    const list = selection.split(',').map((c) => c.trim()).filter(Boolean);
    for (const item of list) {
      if (/[():!]/.test(item)) {
        skippedEmbedded += 1;
        continue;
      }
      const column = item.replace(/\s+.*$/, '');
      if (!/^[a-z_][a-z0-9_]*$/i.test(column)) {
        skippedEmbedded += 1;
        continue;
      }
      record(table, column, file);
    }
  }
  const rpcRe = /\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/g;
  while ((match = rpcRe.exec(text)) !== null) {
    if (!rpcs.has(match[1])) rpcs.set(match[1], new Set());
    rpcs.get(match[1]).add(path.relative(ROOT, file));
  }
}

// ── 2. What the database has ────────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const columnRows = await client.query(
  `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
);
const columnsByTable = new Map();
for (const row of columnRows.rows) {
  if (!columnsByTable.has(row.table_name)) columnsByTable.set(row.table_name, new Set());
  columnsByTable.get(row.table_name).add(row.column_name);
}

const views = new Set(
  (await client.query(`select table_name from information_schema.views where table_schema = 'public'`)).rows.map(
    (r) => r.table_name,
  ),
);
const procNames = new Set(
  (await client.query(`select distinct proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows.map(
    (r) => r.proname,
  ),
);
await client.end();

// ── 3. The report ───────────────────────────────────────────────────────────────────────────────
const missingTables = [];
const missingColumns = [];
for (const [table, columns] of asks) {
  if (!columnsByTable.has(table)) {
    missingTables.push({ table, files: [...new Set([...columns.values()].flatMap((s) => [...s]))] });
    continue;
  }
  for (const [column, files] of columns) {
    if (!columnsByTable.get(table).has(column)) {
      missingColumns.push({ table, column, files: [...files] });
    }
  }
}
const missingRpcs = [...rpcs].filter(([name]) => !procNames.has(name)).map(([name, files]) => ({ name, files: [...files] }));

console.log(`app surface vs ${environment}`);
console.log(`  tables asked for : ${asks.size} (${views.size} views exist in public)`);
console.log(`  rpcs asked for   : ${rpcs.size}`);
console.log(`  skipped          : ${skippedEmbedded} embedded/cast selections (not guessed at)`);
console.log('');
console.log(
  missingTables.length === 0 && missingColumns.length === 0 && missingRpcs.length === 0
    ? 'PASS — every simple column and every RPC the app names exists'
    : 'MISSING — the app asks for things this database does not have',
);
for (const t of missingTables) console.log(`  TABLE   ${t.table}  ← ${t.files.join(', ')}`);
for (const c of missingColumns) console.log(`  COLUMN  ${c.table}.${c.column}  ← ${c.files.join(', ')}`);
for (const r of missingRpcs) console.log(`  RPC     ${r.name}  ← ${r.files.join(', ')}`);

if (jsonOut) {
  const out = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        environment,
        tablesAsked: asks.size,
        rpcsAsked: rpcs.size,
        skippedEmbedded,
        missingTables,
        missingColumns,
        missingRpcs,
      },
      null,
      2,
    ),
  );
  console.log(`report: ${out}`);
}

if (missingTables.length || missingColumns.length || missingRpcs.length) process.exitCode = 1;
