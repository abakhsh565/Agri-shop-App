#!/usr/bin/env node
/**
 * rehearse-restore-local-engine.mjs — rehearse a REAL recovery, and time it.
 *
 * WHY THIS EXISTS
 *   `docs/RECOVERY.md` §9 records an RTO of **4 hours** for the database at its current size, and
 *   says plainly that it is "an agreed target, not a drilled result — PGlite was the stand-in".
 *   `scripts/restore-verify.mjs` proves the artifact *replays*, statement by statement, into
 *   in-process Postgres. That is a correctness proof, not a recovery: it has never been loaded into
 *   an engine that is shaped like the thing it would have to become, and no one has measured how
 *   long any of it takes.
 *
 *   This is the drill. Against the local Supabase CLI stack — the real engine, `postgres:17.x`,
 *   production's own server version — it:
 *
 *     1. provisions a scratch database and gives it the platform schemas a hosted project has;
 *     2. applies the artifact **whole, including its rows**, which is what a recovery actually is;
 *     3. verifies the result against the manifest that travelled with the artifact — structure
 *        counts, per-table row counts, and the auth rows that make a restored database signable-into;
 *     4. reports the wall-clock time of each step and the total.
 *
 *   The rows are the point. Every other tool in this repository deliberately refuses to load them
 *   (§ "WHAT IT WILL NOT DO"); a drill that skipped them would be measuring the fast half.
 *
 * WHAT IT WILL NEVER DO
 *   * It never contacts a hosted project. The only connection string it can build is the loopback
 *     container, and it refuses to start at all if hosted credentials are present in its environment
 *     — so it cannot be pointed at production or staging even by mistake.
 *   * It never writes into the local development database, or into a `rehearsal_*` database. Its
 *     target must be named `drill_*`; anything else is refused before a byte is read.
 *   * It never trusts the artifact: the manifest's sha256 and byte length are re-measured, and a
 *     mismatch is refused before anything is created.
 *   * It never reports PASS without parity. A restore that completes but disagrees with the manifest
 *     is a FAIL, and the differences are named.
 *
 * WHAT A PASS HERE IS NOT
 *   It is not a validated 4-hour RTO. It measures the database layer ONLY, on this machine, from a
 *   local file. It does not measure creating a hosted Supabase project, re-pointing the app
 *   (Vercel/APK), restoring storage objects (they are not in the dump), re-applying grants
 *   (the dump excludes them), or any human decision time. Those are named in the report as
 *   `notCovered` so the number is never read as more than it is.
 *
 * USAGE
 *   node scripts/dev/rehearse-restore-local-engine.mjs \
 *     --manifest backups/backup-production-<ref>-<ts>.manifest.json
 *   node scripts/dev/rehearse-restore-local-engine.mjs --manifest <m> --keep --json backups/restore-drill.json
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// One splitter and one data-statement rule for the whole repository: the artifact is parsed exactly
// the way the rehearsal harness and `restore-verify` parse it, so the three cannot disagree about
// what "a data statement" is.
import { isDataStatement } from '../lib/baseline.mjs';
import { splitStatements } from '../lib/sql-statements.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BACKUPS = path.join(ROOT, 'backups');
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

function refuse(message, code = 2) {
  console.error(`REFUSED: ${message}`);
  process.exit(code);
}

// ── The credential boundary, asserted before anything else ───────────────────────────────────
// The drill reads a local file and talks to a loopback container. If hosted credentials are present
// in the environment, something about the invocation is wrong, and the right answer is to stop
// rather than to proceed and hope the connection string stays local.
{
  const hosted = Object.keys(process.env).filter((k) => /^(PROD|QA)_DB_(HOST|USER|PASS)$/.test(k) || /(_SUPABASE_SERVICE_ROLE|SUPABASE_DB_URL)$/.test(k));
  if (hosted.length) {
    refuse(
      `hosted credentials are present in this environment (${hosted.join(', ')}). This drill is\n` +
      `        strictly local: unset them and re-run. Run it from a plain shell, not from inside\n` +
      `        \`npm run creds:production\`.`,
    );
  }
}

const manifestArg = flag('manifest');
if (!manifestArg) refuse('name the manifest to drill: --manifest backups/backup-<env>-<ref>-<ts>.manifest.json.');

// Every refusal that can be made from the arguments alone happens BEFORE the engine is touched: a
// two-minute restore followed by "your --json path is wrong" would throw the work away and, worse,
// leave a database full of production rows behind because the report that names it was never written.
const jsonOutArg = flag('json');
if (jsonOutArg && !path.resolve(ROOT, jsonOutArg).startsWith(path.join(ROOT, 'backups') + path.sep)) {
  refuse(`--json must write inside backups/ (the report describes a dump). Got: ${jsonOutArg}`);
}

const manifestPath = path.resolve(ROOT, manifestArg);
if (!manifestPath.startsWith(BACKUPS + path.sep)) {
  refuse(`the manifest must live in backups/ (it names a dump that contains personal data). Got: ${manifestArg}`);
}
if (!fs.existsSync(manifestPath)) refuse(`${manifestArg} does not exist.`);

// ── The target database, named so that a drill can never be a rehearsal ──────────────────────
const DB_NAME = flag('db', 'drill_production');
if (!/^drill_[a-z0-9_]+$/.test(DB_NAME)) {
  refuse(
    `the drill database must be named drill_*; got "${DB_NAME}". A drill LOADS ROWS and must never\n` +
    `        write into a rehearsal_* database (which is schema-only by contract) or the local\n` +
    `        development database (which your app is using).`,
  );
}

// ── The manifest, and the artifact it names, re-measured ─────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const field of ['artifact', 'sha256', 'bytes', 'environment', 'projectRef', 'tableCounts', 'structure']) {
  if (manifest[field] === undefined || manifest[field] === null) {
    refuse(`the manifest has no "${field}", so the artifact cannot be held to it.`);
  }
}
const artifactPath = path.join(BACKUPS, path.basename(manifest.artifact));
if (!fs.existsSync(artifactPath)) refuse(`the artifact the manifest names is not here: ${manifest.artifact}`);

const artifactBuffer = fs.readFileSync(artifactPath);
const artifactSha = createHash('sha256').update(artifactBuffer).digest('hex');
if (artifactSha !== manifest.sha256) {
  refuse(`artifact sha256 mismatch: the manifest says ${manifest.sha256}, the file hashes to ${artifactSha}.`);
}
if (artifactBuffer.length !== manifest.bytes) {
  refuse(`artifact length mismatch: the manifest says ${manifest.bytes} bytes, the file is ${artifactBuffer.length}.`);
}

const statements = splitStatements(artifactBuffer.toString('utf8'));
const dataStatements = statements.filter(isDataStatement);
const schemaStatements = statements.filter((s) => !isDataStatement(s));
const recordedRows = Object.values(manifest.tableCounts).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);

// ── The engine ───────────────────────────────────────────────────────────────────────────────
/**
 * Run docker and return stdout and stderr SEPARATELY.
 *
 * psql reports errors on stderr; a harness that read only stdout would score a failing statement as
 * a success. (`scripts/dev/rehearse-on-local-engine.mjs` records the same defect being found in its
 * own first version. The lesson is shared, not re-learned.)
 */
function docker(args, input) {
  const result = spawnSync(DOCKER, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    input: input === undefined ? undefined : input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, error: result.error };
}

let container;
{
  const listed = docker(['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}']);
  if (listed.error || listed.status !== 0) {
    refuse(`docker is not reachable (${(listed.error?.message ?? listed.stderr).split('\n')[0]}). Start Docker Desktop, then: npm run local:db -- up`);
  }
  const names = listed.stdout.trim().split('\n').filter(Boolean);
  if (names.length === 0) refuse('no local Supabase database container is running. Start the stack: npm run local:db -- up');
  container = names[0];
}

const serverVersion = docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-t', '-A', '-c', 'show server_version']).stdout.trim();

function adminSql(sql) {
  const r = docker(['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (r.status !== 0) refuse(`admin SQL failed (${r.stderr.trim().split('\n')[0] || `exit ${r.status}`}): ${sql}`);
  return r.stdout;
}

/** One scalar, from the drill database unless another is named. */
function query(sql, database = DB_NAME) {
  const r = docker(['exec', container, 'psql', '-U', 'postgres', '-d', database, '-X', '-t', '-A', '-c', sql]);
  if (r.status !== 0) throw new Error(`query failed: ${(r.stderr.trim().split('\n')[0]) || `exit ${r.status}`} :: ${sql}`);
  return r.stdout.trim();
}
const count = (sql) => Number(query(sql));
/** The same, but a failure returns '' instead of throwing — for probes that may legitimately not resolve. */
function querySafe(sql, database = DB_NAME) {
  try {
    return query(sql, database);
  } catch {
    return '';
  }
}

const ms = (from) => Number(process.hrtime.bigint() - from) / 1e6;

// ══ STEP 1 — provision an empty, production-shaped database ══════════════════════════════════
// On a hosted recovery this step is "create a Supabase project", which takes minutes and is not
// reproducible here. What IS reproduced is its result: a database with the platform schemas
// (`auth`, `storage`, `extensions`) a hosted project has and the artifact does not carry.
const startedAll = process.hrtime.bigint();
const t0 = process.hrtime.bigint();

adminSql(`drop database if exists "${DB_NAME}" with (force)`);
adminSql(`create database "${DB_NAME}"`);

{
  const copied = docker(['exec', container, 'sh', '-c',
    `pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges ` +
    `--schema=auth --schema=storage --schema=extensions | psql -U postgres -d ${DB_NAME} -X -q -v ON_ERROR_STOP=0`]);
  if (copied.status !== 0) {
    refuse(`could not copy the platform schemas into ${DB_NAME}: ${(copied.stderr || copied.stdout).trim().split('\n').slice(-1)[0]}`);
  }
}

// Extensions go where a hosted project puts them. Installing pgcrypto into `public` instead adds ~67
// extension functions to the schema under test, which then looks like a restore that produced 104
// public functions where production has 37 — a false FAIL caused by the drill, not by the artifact.
const extensionsRequested = ['pgcrypto', 'pg_trgm'];
const extensionOutcome = [];
for (const extension of extensionsRequested) {
  const r = docker(['exec', container, 'psql', '-U', 'postgres', '-d', DB_NAME, '-X', '-q', '-v', 'ON_ERROR_STOP=0', '-c',
    `create extension if not exists ${extension} with schema extensions;`]);
  const message = `${r.stdout}${r.stderr}`.trim().split('\n').filter(Boolean).slice(-1)[0] ?? '';
  const where = querySafe(`select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = '${extension}'`);
  extensionOutcome.push({ extension, installedSchema: where || null, message: message.slice(0, 160) });
}

const provisionMs = ms(t0);

// ══ STEP 2 — restore: apply the artifact whole, including its rows ═══════════════════════════
// One `psql` invocation over the whole file, which is what an operator does. `ON_ERROR_STOP` is OFF
// on purpose: the artifact's `functions-pre-tables` phase is *expected* to fail (a function returning
// a table's row type cannot exist before the table; it is re-applied later in the same file). Those
// errors are collected and reported, never swallowed — and the end state is what is judged, by the
// parity check below.
const t1 = process.hrtime.bigint();
const restoreRun = docker(
  ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', DB_NAME, '-X', '-q', '-v', 'ON_ERROR_STOP=0', '-f', '-'],
  artifactBuffer.toString('utf8'),
);
const restoreMs = ms(t1);

const stderrLines = restoreRun.stderr.split('\n').map((l) => l.trim()).filter(Boolean);
const errorLines = stderrLines.filter((l) => /^ERROR:/.test(l));
const fatalLines = stderrLines.filter((l) => /^psql:.*(fatal|FATAL)/.test(l));

// ══ STEP 3 — verify the result against the manifest ══════════════════════════════════════════
const t2 = process.hrtime.bigint();

const structureActual = {
  tables: count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`),
  functions: count(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`),
  views: count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`),
  // Counted exactly the way scripts/backup-database.mjs counts it: an index that backs a primary key
  // or unique constraint is excluded, because that constraint creates it. Counting them here reported
  // 84 restored indexes against the manifest's 47 — +37, which is precisely the 28 primary keys and 9
  // unique constraints. A false FAIL produced by the drill is worse than no number at all.
  indexes:
    count(`select count(*) from pg_indexes where schemaname = 'public'`) -
    count(`select count(*) from pg_constraint c join pg_class i on i.oid = c.conindid join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype in ('p','u')`),
  foreignKeys: count(`select count(*) from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace`),
  checks: count(`select count(*) from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace`),
  uniques: count(`select count(*) from pg_constraint where contype = 'u' and connamespace = 'public'::regnamespace`),
  triggers: count(`select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`),
  policies: count(`select count(*) from pg_policies where schemaname = 'public'`),
  enums: count(`select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e'`),
};

const expectedStructure = manifest.structure;
// A count-valued field is compared as a count; `views` arrives as a list of NAMES, so it is compared
// as both a count and a set — a restore that produced the right number of the wrong views would
// otherwise pass.
const structureDeltas = [];
for (const [key, expected] of Object.entries(expectedStructure)) {
  if (Array.isArray(expected)) {
    if (structureActual[key] !== expected.length) {
      structureDeltas.push(`${key}: manifest ${expected.length}, restored ${structureActual[key]}`);
    }
    for (const name of expected) {
      const present = count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' and c.relname = '${String(name).replace(/'/g, "''")}'`);
      if (present !== 1) structureDeltas.push(`${key}: "${name}" is missing from the restored schema`);
    }
    continue;
  }
  if (typeof expected === 'number' && structureActual[key] !== expected) {
    structureDeltas.push(`${key}: manifest ${expected}, restored ${structureActual[key]}`);
  }
}

const rowDeltas = [];
for (const [table, expected] of Object.entries(manifest.tableCounts)) {
  const target = table.includes('.') ? table : `public.${table}`;
  let actual;
  try {
    actual = count(`select count(*) from ${target}`);
  } catch (error) {
    rowDeltas.push(`${target}: manifest ${expected}, restored <missing> (${error.message.split('::')[0].trim()})`);
    continue;
  }
  if (actual !== expected) rowDeltas.push(`${target}: manifest ${expected}, restored ${actual}`);
}

// Observations that are NOT pass/fail criteria, reported because a real recovery depends on them.
const observations = {
  authUsersRestored: count(`select count(*) from auth.users`),
  authIdentitiesRestored: count(`select count(*) from auth.identities`),
  rlsEnabledPublicTables: count(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity`),
  publicTablesReadableByAuthenticated: count(`select count(distinct table_name) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'`),
  note:
    'Grants are NOT in the dump (the manifest says so). This scratch database was given the platform\n' +
    'SCHEMAS but not the platform DEFAULT PRIVILEGES, which a hosted project applies to objects the\n' +
    'postgres role creates — that is why API readability here is low. The local stack\u2019s own database\n' +
    'is the closest available reference for that configuration (it reports the figure in the report as\n' +
    'platformReference), so read this as "measure grants on the real target", not as a defect.',
  platformReference: {
    // Read from the stack's OWN database, which carries the platform's default privileges — the
    // restored database is the one under test and must not be compared with itself.
    localStackAuthenticatedReadablePublicTables: Number(
      querySafe(`select count(distinct table_name) from information_schema.role_table_grants where grantee = 'authenticated' and table_schema = 'public'`, 'postgres').replace(/[^0-9]/g, '') || 0,
    ),
    note: 'From the local stack’s own database, for contrast: it carries the platform default privileges the drill deliberately does not copy.',
  },
};

const verifyMs = ms(t2);
const totalMs = ms(startedAll);

const report = {
  generatedAt: new Date().toISOString(),
  drill: 'restore-from-artifact-into-production-shaped-local-engine',
  engine: { kind: 'local-supabase-cli-stack', container, serverVersion, note: 'production’s own server version is 17.6; the hosted project runs on the same major' },
  source: { environment: manifest.environment, projectRef: manifest.projectRef, backupGeneratedAt: manifest.generatedAt, artifact: path.basename(artifactPath), artifactSha256: artifactSha, artifactBytes: artifactBuffer.length, recordedRows, recordedTables: Object.keys(manifest.tableCounts).length },
  scratchDatabase: DB_NAME,
  timing: { provisionMs: Math.round(provisionMs), restoreMs: Math.round(restoreMs), verifyMs: Math.round(verifyMs), totalMs: Math.round(totalMs), totalSeconds: Number((totalMs / 1000).toFixed(1)) },
  provision: 'create database + platform schemas + extensions',
  restore: { statements: statements.length, schemaStatements: schemaStatements.length, dataStatements: dataStatements.length, dataStatementsApplied: dataStatements.length, sqlErrors: errorLines.length, fatalErrors: fatalLines.length, firstErrors: errorLines.slice(0, 10), extensions: extensionOutcome },
  verification: { structureExpected: expectedStructure, structureActual, structureDeltas, rowDeltas, observations },
  status: structureDeltas.length === 0 && rowDeltas.length === 0 && fatalLines.length === 0 ? 'PASS' : 'FAIL',
  notCovered: [
    'Creating the hosted Supabase project, and any Supabase-side restore/import path (production is on the Free plan: no managed backups, no PITR, no downloadable backup — this local file IS the coverage).',
    'Storage objects: the dump excludes them by design, so uploaded images are not restored by this.',
    'Grants, ownership, extensions and role passwords: excluded from the dump by design and re-established by the platform on a hosted target.',
    'Re-pointing the application: Vercel production environment variables, the Android build, and DNS.',
    'Human decision time, the approval checklist in docs/RECOVERY.md §5, and verification against the live source (impossible without production credentials, which this tool refuses to use).',
    'Anything about whether production’s rows are the right rows — this measures reproduction, not correctness of content.',
  ],
};

if (jsonOutArg) fs.writeFileSync(path.resolve(ROOT, jsonOutArg), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nRecovery drill on the local Supabase engine — ${manifest.environment} (${manifest.projectRef})`);
console.log(`  engine      : ${container} (Postgres ${serverVersion})`);
console.log(`  artifact    : ${path.basename(artifactPath)} — ${artifactBuffer.length} bytes, sha256 verified against the manifest`);
console.log(`  recorded    : ${report.source.recordedTables} tables, ${recordedRows} rows at ${manifest.generatedAt}`);
console.log(`  scratch db  : ${DB_NAME} (drill_* only; the development database is untouched)\n`);
console.log(`  provision   : ${(provisionMs / 1000).toFixed(1)} s   (create database + platform schemas)`);
console.log(`  restore     : ${(restoreMs / 1000).toFixed(1)} s   (${statements.length} statements: ${schemaStatements.length} schema, ${dataStatements.length} data)`);
console.log(`  verify      : ${(verifyMs / 1000).toFixed(1)} s   (structure + row parity against the manifest)`);
console.log(`  ─────────────────────`);
console.log(`  total       : ${(totalMs / 1000).toFixed(1)} s\n`);
console.log(`  extensions                : ${extensionOutcome.map((e) => `${e.extension}→${e.installedSchema ?? 'MISSING'}`).join(', ')} (a hosted project keeps these out of public)`);
console.log(`  sql errors during restore : ${errorLines.length}${errorLines.length ? ' (first few below)' : ''}`);
for (const line of errorLines.slice(0, 4)) console.log(`      ${line.slice(0, 150)}`);
console.log(`  structure deltas          : ${structureDeltas.length}`);
for (const d of structureDeltas.slice(0, 10)) console.log(`      ${d}`);
console.log(`  row-count deltas          : ${rowDeltas.length}`);
for (const d of rowDeltas.slice(0, 10)) console.log(`      ${d}`);
console.log(`  auth restored             : ${observations.authUsersRestored} user(s), ${observations.authIdentitiesRestored} identity/ies`);
console.log(`  RLS on public tables      : ${observations.rlsEnabledPublicTables}/${structureActual.tables}`);
console.log(`  readable by authenticated : ${observations.publicTablesReadableByAuthenticated}/${structureActual.tables} public tables here, vs ${observations.platformReference.localStackAuthenticatedReadablePublicTables} in the stack's own database (grants are not in the dump — see the note)`);
console.log(`\nSUMMARY ${report.status}: ${report.restore.statements} statements restored, ${errorLines.length} sql errors, ${structureDeltas.length} structure deltas, ${rowDeltas.length} row deltas, ${(totalMs / 1000).toFixed(1)} s total`);
console.log(`  NOT a validated RTO — see "notCovered" in the report (${report.notCovered.length} items excluded).\n`);

if (has('keep')) {
  console.log(`  kept ${DB_NAME} for inspection (drop it with: docker exec ${container} psql -U postgres -d postgres -c 'drop database ${DB_NAME}')\n`);
} else {
  adminSql(`drop database if exists "${DB_NAME}" with (force)`);
  console.log(`  ${DB_NAME} dropped (pass --keep to inspect it)\n`);
}

process.exit(report.status === 'PASS' ? 0 : 1);
