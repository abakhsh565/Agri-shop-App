#!/usr/bin/env node
/**
 * extract-missing-functions.mjs — write the function half of the production gap, from the ledger.
 *
 * WHY THIS EXISTS
 *   `docs/PRODUCTION_MIGRATION_PLAN.md` §4 batch 2 is the gap migration, and it has two halves. The
 *   *relations* half is `0207`: six relations the repository never created, plus the helpers they
 *   need. The *function* half is this file's output: the functions the signed-in app calls that
 *   production's frozen schema does not have. That half was measured, not guessed — 46 of the app's
 *   65 client RPCs are absent from production's baseline (a live rehearsal database, kept for
 *   inspection), and their bodies call 10 more absent helpers, so the closure is 56 functions.
 *
 *   A 56-function file written by hand is not reviewable. It is derived here instead, from the
 *   repository's own definitions: for each name, the LAST `CREATE [OR REPLACE] FUNCTION` the migration
 *   ledger writes (the definition the app is developed against), emitted in dependency order so each
 *   function follows the ones its body calls. A SQL-language body is validated at creation time, which
 *   is why the order is computed rather than inherited from the ledger's.
 *
 * WHAT IT GUARANTEES
 *   * Catalog-guarded: every function is created only when `pg_proc` does not already have it, so the
 *     file is a real change where the objects are missing and a no-op where they exist
 *     (`SCHEMA_STRATEGY.md` §6.3).
 *   * Access is not widened. The ledger's own EXECUTE contract decides the ACL: `authenticated` always
 *     gets an explicit grant; `anon` gets one where the contract leaves it able to execute; otherwise
 *     `public` and `anon` are revoked, because a freshly created PostgreSQL function is executable by
 *     PUBLIC until something says otherwise.
 *   * Additive only — no DROP, no ALTER of an existing object, no data statement.
 *   * A dependency cycle is refused rather than ordered arbitrarily.
 *
 * USAGE
 *   node scripts/dev/extract-missing-functions.mjs --check
 *   node scripts/dev/extract-missing-functions.mjs --write supabase/migrations/0208_<name>.sql
 */

import fs from 'node:fs';
import path from 'node:path';

import { baselineMetadataPath } from '../lib/baseline.mjs';
import { effectiveContract, ledgerFiles, scanLedger, stripSqlComments } from '../lib/rpc-contract.mjs';
import { splitStatements } from '../lib/sql-statements.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const baselineName = flag('baseline', 'production');
const writeTo = flag('write');
const asJson = flag('json');

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

// ── What the target's frozen schema already has ────────────────────────────────────────────────
const metaPath = baselineMetadataPath(baselineName);
if (!fs.existsSync(metaPath)) refuse(`${metaPath} does not exist.`);
const record = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const artifactPath = path.join(ROOT, record.artifact);
if (!fs.existsSync(artifactPath)) refuse(`the artifact the record names is not here: ${record.artifact}`);

const present = new Set();
const DEFINE = /create\s+(?:or\s+replace\s+)?function\s+(?:(?:"?public"?\.))?"?([a-z0-9_]+)"?\s*\(/gi;
for (const m of fs.readFileSync(artifactPath, 'utf8').matchAll(DEFINE)) present.add(m[1].toLowerCase());

// Files already applied before this one count as present too: the batch is applied in order, and
// re-creating a function an earlier batch file defines would defeat the guard's purpose.
const appliedBefore = (flag('after') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
for (const given of appliedBefore) {
  const file = path.join(MIGRATIONS, path.basename(given));
  if (!fs.existsSync(file)) refuse(`--after names a file that is not in supabase/migrations: ${given}`);
  for (const m of fs.readFileSync(file, 'utf8').matchAll(DEFINE)) present.add(m[1].toLowerCase());
}

// ── Every function definition in the ledger; the last one wins ──────────────────────────────────
// The output file is not an input. A first run of this script wrote 0208, a second run read it back as
// "the ledger" and inherited its own statements as the last-wins definition for two columns — so the
// target file's version and everything after it are excluded from the scan, and a definition can only
// come from a migration that would already have been applied when this file runs.
const outName = flag('out-name') ?? (writeTo ? path.basename(writeTo) : null);
const outVersion = outName?.slice(0, 4) ?? null;
const files = ledgerFiles(MIGRATIONS).filter((f) => !outVersion || path.basename(f).slice(0, 4) < outVersion);
const byName = new Map();
const tableByName = new Map();
const columnByName = new Map();
const skippedColumns = [];
for (const [order, file] of files.entries()) {
  const sql = stripSqlComments(fs.readFileSync(file, 'utf8'));
  for (const statement of splitStatements(sql)) {
    const fn = statement.match(/^\s*create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/i);
    if (fn) {
      byName.set(fn[1].toLowerCase(), { name: fn[1].toLowerCase(), file: path.basename(file), order, text: statement });
      continue;
    }
    const table = statement.match(/^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/i);
    if (table) {
      tableByName.set(table[1].toLowerCase(), { name: table[1].toLowerCase(), file: path.basename(file), order, text: statement });
      continue;
    }
    const column = statement.match(/^\s*alter\s+table\s+(?:only\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+([\s\S]*)$/i);
    if (column) {
      const [, tableName, columnName, rest] = column;
      const record = { table: tableName.toLowerCase(), column: columnName.toLowerCase(), file: path.basename(file), order, text: statement };
      // "Nullable or defaulted" is the plan's rule for an additive column (§6.1). A NOT NULL column
      // with a constant default is already allowed and needs no rewrite of existing rows; a NOT NULL
      // column without one would need a value invented for every row, which is a data change this file
      // may not make. The latter is recorded and not emitted.
      if (/\bnot\s+null\b/i.test(rest) && !/\bdefault\b/i.test(rest)) skippedColumns.push(record);
      else columnByName.set(`${record.table}.${record.column}`, record);
    }
  }
}

// ── The app's client RPCs, extracted exactly as the app writes them ────────────────────────────
const clientRpcs = new Set();
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/(?:supabase|client)\s*\.\s*rpc\s*\(\s*['"]([a-z0-9_]+)['"]/g)) clientRpcs.add(m[1]);
      for (const m of s.matchAll(/scopedRpc\s*\(\s*['"]([a-z0-9_]+)['"]/g)) clientRpcs.add(m[1]);
    }
  }
})(path.join(ROOT, 'src'));

const clientMissing = [...clientRpcs].filter((n) => !present.has(n) && byName.has(n)).sort();
const clientMissingUnwritten = [...clientRpcs].filter((n) => !present.has(n) && !byName.has(n)).sort();
if (clientMissingUnwritten.length) {
  refuse(`the app calls ${clientMissingUnwritten.join(', ')} and no migration defines it — that is a ledger gap, not a production gap.`);
}

// ── The closure these bodies need, and the order to emit them in ───────────────────────────────
const known = new Set(byName.keys());
const knownTables = new Set(tableByName.keys());

/**
 * The functions a body calls.
 *
 * The identifier is matched wherever it appears, qualified or not: `public.current_branch_id()` is the
 * same call as `current_branch_id()`, and an earlier version of this scan excluded every qualified one
 * — which is how the first generation of this file failed to carry two functions it needed. Names the
 * ledger does not define as functions are dropped, so a table reference or a type name is not mistaken
 * for a call.
 */
function callsIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const name = m[1].toLowerCase();
    if (known.has(name)) out.add(name);
  }
  return out;
}

/**
 * The relations a body reads, whichever clause introduces them.
 *
 * A name counts when the ledger creates it OR the target's own schema already has it. Both are
 * needed: `sales` is created before the ledger's first recorded file and a body reads it anyway — an
 * earlier version of this scan only accepted ledger-created tables and so missed `sales.branch_id`,
 * which `get_my_branches` reads and production does not have.
 */
function tablesIn(text) {
  const out = new Set();
  const patterns = [
    /\b(?:from|join|into|update|table)\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?/gi,
    /::\s*(?:"?public"?\.)?"?([a-z0-9_]+)"?/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = (m[1] ?? '').toLowerCase();
      if (knownTables.has(name) || relationPresent.has(name)) out.add(name);
    }
  }
  return out;
}

const needed = new Set();
const neededTables = new Set();
const relationPresent = new Set();
const TABLE_DEFINE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(/gi;
for (const m of fs.readFileSync(artifactPath, 'utf8').matchAll(TABLE_DEFINE)) relationPresent.add(m[1].toLowerCase());
for (const given of appliedBefore) {
  for (const m of fs.readFileSync(path.join(MIGRATIONS, path.basename(given)), 'utf8').matchAll(TABLE_DEFINE)) relationPresent.add(m[1].toLowerCase());
}

const tablesRead = new Set();
const queue = [...clientMissing];
while (queue.length) {
  const name = queue.pop();
  if (needed.has(name)) continue;
  needed.add(name);
  for (const callee of callsIn(byName.get(name).text)) {
    if (!present.has(callee) && !needed.has(callee)) queue.push(callee);
  }
  for (const table of tablesIn(byName.get(name).text)) {
    tablesRead.add(table);
    if (!relationPresent.has(table) && !neededTables.has(table)) neededTables.add(table);
  }
}

// ── The columns those bodies read, which the baseline's tables do not have ─────────────────────
//
// Measured the same way the relations are, and for the same reason: `get_my_branches` reads
// `sales.branch_id`, production's `sales` predates branches, and a SQL-language body is validated at
// creation time — so the file carries the ledger's own `add column if not exists` for it. Columns the
// ledger adds as NOT NULL are recorded and not emitted; they would need a value for existing rows.
const artifactText = fs.readFileSync(artifactPath, 'utf8');
/** The columns a dump's `create table` block declares for a relation, plus any later add-column. */
function baselineColumns(table) {
  const columns = new Set();
  const block = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(artifactText);
  if (block) {
    for (const c of block[1].matchAll(/(?:^|\n)\s*"?([a-z_][a-z0-9_]*)"?\s+[a-z]/gi)) columns.add(c[1].toLowerCase());
  }
  const added = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:public\\.)?"?${table}"?\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?([a-z_][a-z0-9_]*)"?`, 'gi');
  for (const c of artifactText.matchAll(added)) columns.add(c[1].toLowerCase());
  return columns;
}

const neededColumns = [];
for (const table of [...tablesRead].sort()) {
  const have = baselineColumns(table);
  for (const [key, record] of [...columnByName].sort()) {
    if (record.table !== table || have.has(record.column)) continue;
    neededColumns.push({ key, ...record });
  }
}

const ordered = [];
const state = new Map();
function visit(name, stack) {
  if (state.get(name) === 'done') return;
  if (state.get(name) === 'open') refuse(`dependency cycle: ${[...stack, name].join(' -> ')}`);
  state.set(name, 'open');
  for (const callee of callsIn(byName.get(name).text)) {
    // A recursive function calls itself; that is not a cycle, and PostgreSQL is happy to create it.
    if (needed.has(callee) && callee !== name) visit(callee, [...stack, name]);
  }
  state.set(name, 'done');
  ordered.push(name);
}
for (const name of [...needed].sort()) visit(name, []);

// ── The ledger's own EXECUTE contract, per function ────────────────────────────────────────────
const { contract } = effectiveContract(scanLedger(files));
const aclAnon = (name) => {
  const entry = contract.get(name);
  if (!entry) refuse(`no contract entry for ${name}.`);
  return Boolean(entry.anonExplicit || entry.public);
};

/** A dollar-quote tag that cannot collide with the statement it wraps. */
function tagFor(text, prefix) {
  let tag = `$${prefix}$`;
  let n = 0;
  while (text.includes(tag)) tag = `$${prefix}${++n}$`;
  return tag;
}

const relationBlocks = [...neededTables].sort().map((name) => {
  const { file, text } = tableByName.get(name);
  const ddlTag = tagFor(text, 'ddl');
  const guardTag = tagFor(text, 'guard');
  return [
    `-- relation ${name} — ${file} (a body above reads it)`,
    `do ${guardTag} begin`,
    '  if not exists (',
    '    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace',
    `    where n.nspname = 'public' and c.relname = '${name}'`,
    '  ) then',
    `    execute ${ddlTag}${text}${ddlTag};`,
    '  end if;',
    'end',
    `${guardTag};`,
    '',
  ].join('\n');
});

/**
 * The additive columns the plan's D-2 names for batch 2, as (table, column, type).
 *
 * Taken from `docs/PRODUCTION_MIGRATION_PLAN.md` §4 batch 2 — "`add column if not exists` for
 * `notifications.shop_id`, `notifications.branch_id`, `audit_events.tenant_id` (nullable, no backfill,
 * no rewrite of existing rows)" — and emitted only for a table that exists and a column that does not.
 */
const PLANNED_COLUMNS = [
  ['notifications', 'shop_id'],
  ['notifications', 'branch_id'],
  ['audit_events', 'tenant_id'],
];

/**
 * A column definition taken from the accepted staging baseline, for a column no tracked file writes.
 *
 * `notifications.shop_id` is the one this file needs and the ledger cannot supply: production's
 * `notifications` has no such column, 0197 adds only `branch_id`, and the ledger merely *reads*
 * `shop_id` (0147, 0197) — the column it reads was created out of band, the same divergence 0207
 * records for the relations. The owner's decision of 2026-10-16 (`docs/PRODUCTION_MIGRATION_PLAN.md`
 * §7.2) allows exactly this move — schema-only, out of the accepted staging baseline — and the file
 * names the source in the comment above the statement. `PRODUCTION_DATA_POLICY.md` §1 states the
 * direction it follows: code and schema move forward; data never moves up.
 */
function extractedColumn(table, column) {
  const extractedFrom = flag('extract-from', 'staging');
  const extractionMeta = baselineMetadataPath(extractedFrom);
  if (!fs.existsSync(extractionMeta)) return null;
  const extraction = JSON.parse(fs.readFileSync(extractionMeta, 'utf8'));
  const extractionPath = path.join(ROOT, extraction.artifact);
  if (!fs.existsSync(extractionPath)) return null;
  const block = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?"?${table}"?\\s*\\(([\\s\\S]*?)\\n\\);`, 'i')
    .exec(fs.readFileSync(extractionPath, 'utf8'));
  if (!block) return null;
  for (const line of block[1].split('\n')) {
    const m = line.match(new RegExp(`^\\s*"?${column}"?\\s+([\\s\\S]+?),?\\s*$`, 'i'));
    if (!m) continue;
    return { key: `${table}.${column}`, file: `${extraction.artifact} (extracted schema-only, no row moves)`, text: `alter table public."${table}" add column if not exists "${column}" ${m[1].trim()}` };
  }
  return null;
}

const emittedColumnKeys = new Set(neededColumns.map((c) => c.key));
for (const [table, column] of PLANNED_COLUMNS) {
  const key = `${table}.${column}`;
  if (emittedColumnKeys.has(key) || !relationPresent.has(table)) continue;
  if (baselineColumns(table).has(column)) continue;
  const record = columnByName.get(key) ?? extractedColumn(table, column);
  if (!record) refuse(`${key} is named by the plan, no migration writes it, and ${flag('extract-from', 'staging')}'s baseline does not carry it either.`);
  neededColumns.push({ key, ...record });
  emittedColumnKeys.add(key);
}

const columnBlocks = neededColumns.map((record) => [
  `-- ${record.key} — additive, nullable, no backfill (${record.file})`,
  `${record.text};`,
  '',
].join('\n'));

const blocks = ordered.map((name) => {
  const { file, text } = byName.get(name);
  const ddlTag = tagFor(text, 'ddl');
  const guardTag = tagFor(text, 'guard');
  const acl = aclAnon(name)
    ? "      execute format('grant execute on function %s to anon', r.sig);"
    : "      execute format('revoke execute on function %s from public, anon', r.sig);";
  return [
    `-- ${name} — ${file}`,
    `do ${guardTag} begin`,
    '  if not exists (',
    '    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace',
    `    where n.nspname = 'public' and p.proname = '${name}'`,
    '  ) then',
    `    execute ${ddlTag}${text}${ddlTag};`,
    '  end if;',
    'end',
    `${guardTag};`,
    '',
    `-- its EXECUTE contract, from the ledger: ${aclAnon(name) ? 'anon may execute it' : 'revoked from public and anon'}`,
    'do $acl$ declare r record; begin',
    '  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace',
    `    where n.nspname = 'public' and p.proname = '${name}' loop`,
    "    execute format('grant execute on function %s to authenticated', r.sig);",
    acl,
    '  end loop;',
    'end $acl$;',
    '',
  ].join('\n');
});

const header = `-- 0208 — the functions the signed-in app calls, and the relations they read, which production's
-- schema does not have.
--
-- WHY THIS FILE EXISTS. 0207 closed the relations half of the production gap: six relations that no
-- tracked SQL ever created. This closes the rest of it, measured rather than guessed. Against
-- production's own frozen baseline — loaded into the local Supabase engine, artifact sha256 verified,
-- every one of the dump's ${record.dataStatements} data statements counted and skipped — ${clientMissing.length} of the app's
-- ${clientRpcs.size} client RPCs have no function at all. Their bodies call ${ordered.length - clientMissing.length} more functions that are
-- equally absent, so the function closure is ${ordered.length}; they read ${neededTables.size} relations and ${columnBlocks.length} columns that are absent
-- too, and all of those come first. Every count above is measured against the target, not listed by hand.
--
-- WHERE THE SQL COMES FROM. Not from a dump. For every name in the closure this file carries the LAST
-- \`CREATE [OR REPLACE] FUNCTION\` the migration ledger writes for it — the definition the application
-- is developed against — with the file it came from named above each one, in dependency order so each
-- function follows the functions its body calls. That order is computed here, and the first generation
-- of this file is why: it missed two helpers whose calls were written \`public.qualified\`, and the
-- verifier caught them. Generated by
-- \`node scripts/dev/extract-missing-functions.mjs\`, which refuses on a dependency cycle, on a client
-- RPC no migration defines, and on a baseline record whose artifact is missing; re-runnable, so the
-- file can be re-derived rather than trusted.
--
-- WHAT IT DELIBERATELY DOES NOT DO. Nothing is dropped, renamed or narrowed. Every function is created
-- only when \`pg_proc\` does not already have it, so the file is a real change on production and a no-op
-- on an environment already past it (\`SCHEMA_STRATEGY.md\` §6.3). No access is widened: \`authenticated\`
-- always keeps an explicit grant, \`anon\` keeps one only where the ledger's own contract does, and
-- where it does not, \`public\` and \`anon\` are revoked — a freshly created PostgreSQL function is
-- executable by PUBLIC until something says otherwise. No data statement appears below.
--
-- VERIFY. \`npm run verify:baseline -- --baseline production --files <this file>\` replays it onto
-- production's accepted baseline, and \`npm run rehearse:engine\` does the same on a real PostgreSQL 17.

`;

const report = {
  generatedAt: new Date().toISOString(),
  baseline: { environment: baselineName, artifact: record.artifact, dataStatementsSkipped: record.dataStatements },
  appliedBefore,
  ledger: { files: files.length, distinctFunctionNames: byName.size },
  functionsPresentInBaseline: present.size,
  clientRpcs: { named: clientRpcs.size, missing: clientMissing.length, missingNames: clientMissing },
  closure: { size: ordered.length, order: ordered, anonExecutable: ordered.filter(aclAnon) },
  relations: { missing: [...neededTables].sort(), from: [...neededTables].sort().map((n) => tableByName.get(n).file) },
  columns: { emitted: neededColumns.map((c) => `${c.key} (${c.file})`), notNullAndSkipped: skippedColumns.map((c) => `${c.table}.${c.column} (${c.file})`) },
};

if (writeTo) {
  fs.writeFileSync(path.join(ROOT, writeTo), `${header}${[...relationBlocks, ...columnBlocks, ...blocks].join('\n')}`);
  console.log(`wrote ${writeTo}: ${neededTables.size} relations, ${columnBlocks.length} columns, ${ordered.length} functions (${ordered.filter(aclAnon).length} executable by anon).`);
}
if (asJson) fs.writeFileSync(path.join(ROOT, asJson), `${JSON.stringify(report, null, 2)}\n`);

console.log(`baseline       : ${record.artifact}`);
console.log(`app RPCs       : ${clientRpcs.size} named, ${clientMissing.length} absent from the baseline`);
console.log(`closure        : ${ordered.length} functions (${ordered.length - clientMissing.length} pulled in by their bodies)`);
console.log(`relations      : ${neededTables.size} absent relation(s) a body reads — ${[...neededTables].sort().join(', ') || 'none'}`);
console.log(`columns        : ${columnBlocks.length} additive column(s) from the plan's D-2`);
console.log(`dependency order: ${ordered.slice(0, 6).join(' -> ')} ... ${ordered.slice(-3).join(' -> ')}`);
