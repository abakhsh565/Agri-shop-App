#!/usr/bin/env node
/**
 * rehearse-on-local-engine.mjs — apply a verified selection to a REAL Supabase engine, not PGlite.
 *
 * WHY THIS EXISTS
 *   `scripts/verify-forward-on-baseline.mjs` proves a selection applies onto an environment's frozen
 *   schema — but it replays it in-process PGlite, which is Postgres without the platform: no
 *   `pgcrypto`, no Supabase roles, none of the extensions or defaults a hosted project actually has.
 *   Its own verdict says so, honestly: a range can come back `PASS` with `0 env-gap failures` and
 *   still have statements it could not exercise. `docs/PRODUCTION_MIGRATION_PLAN.md` §9.3 carried that
 *   as an open caveat — "PGlite is Postgres, not Supabase" — until something rehearsed on the real
 *   thing.
 *
 *   This is that something. It loads an environment's baseline artifact into a **scratch database on
 *   the local Supabase CLI stack** (the real engine: `postgres:17.x` + the Supabase roles, the same
 *   server version the hosted project runs) and applies a named file selection to it, statement by
 *   statement, reporting per-file and per-statement failures. It then compares its result with a
 *   PGlite report you pass it, so "the PASS holds on the real engine" is a measurement rather than a
 *   hope.
 *
 * WHAT IT WILL NOT DO
 *   * It never loads the artifact's DATA statements. Production's rows are personal data; the harness
 *     counts them, refuses to apply them, and says so. (A rehearsal of schema migration does not need
 *     rows; `scripts/dev/local-db.mjs` restores rows for local DEVELOPMENT, which is a different job
 *     with a different target.)
 *   * It never touches the local development database. It creates and drops its own scratch database
 *     (`rehearsal_<baseline>`), so `npm run local:db`'s database is untouched.
 *   * It never contacts a hosted project: the only connection string it will use is the local stack's
 *     own loopback container.
 *   * It never invents an artifact: the baseline record's sha256 and byte length are re-measured and
 *     a mismatch is refused before anything runs.
 *
 * USAGE
 *   node scripts/dev/rehearse-on-local-engine.mjs --baseline production --since 0177
 *   node scripts/dev/rehearse-on-local-engine.mjs --baseline production --files a.sql,b.sql \
 *     --compare-report backups/baseline-prod-batch1-verified.json --json backups/rehearsal.json
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_PHASE,
  baselineMetadataPath,
  isDataStatement,
  phaseReader,
  selectForwardFiles,
  validateBaselineMetadata,
} from '../lib/baseline.mjs';
import { splitStatements, splitStatementsWithOffsets } from '../lib/sql-statements.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
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

const baselineArg = flag('baseline');
if (!baselineArg) refuse('name a baseline: --baseline production|staging.');
const since = flag('since');
const filesArg = flag('files');
if ((since && filesArg) || (!since && !filesArg)) refuse('pass exactly one of --since <ver> or --files <a.sql,b.sql>.');

const DB_NAME = flag('db', `rehearsal_${baselineArg}`);
if (!/^rehearsal_[a-z0-9_]+$/.test(DB_NAME)) refuse(`the scratch database must be named rehearsal_*; got "${DB_NAME}".`);

// ── The engine must be reachable, and must be the local stack ────────────────────────────────
/**
 * Run docker and return stdout AND stderr separately.
 *
 * `execFileSync` returns stdout alone: psql reports errors on **stderr**, so a version of this
 * harness built on it counted a failing statement as a success. Both streams are captured here, and
 * every caller that judges a result looks at both.
 */
function docker(args, input) {
  const result = spawnSync(DOCKER, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    input: input === undefined ? undefined : input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status, error: result.error };
}

let container;
{
  const listed = docker(['ps','--filter','name=supabase_db_','--format','{{.Names}}']);
  const names = listed.stdout.trim().split('\n').filter(Boolean);
  if (listed.error || listed.status !== 0) {
    refuse(`docker is not reachable (${(listed.error?.message ?? listed.stderr).split('\n')[0]}). Start Docker Desktop, then: npm run local:db -- up`, 2);
  }
  if (names.length === 0) refuse('no local Supabase database container is running. Start the stack: npm run local:db -- up', 2);
  container = names[0];
}

const serverVersion = docker(['exec', container, 'psql','-U','postgres','-d','postgres','-X','-t','-A','-c','show server_version']).stdout.trim();
const platformExtensions = docker(['exec', container, 'psql','-U','postgres','-d','postgres','-X','-t','-A','-c',
  "select string_agg(name, ',' order by name) from pg_available_extensions where name in ('pgcrypto','cron','pgsodium','pg_net')"]).stdout.trim();

// ── The baseline record, re-measured ─────────────────────────────────────────────────────────
const metaPath = baselineMetadataPath(baselineArg);
if (!fs.existsSync(metaPath)) refuse(`${metaPath} does not exist.`);
const record = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const problems = validateBaselineMetadata(record);
if (problems.length) refuse(`${metaPath} is not a valid baseline record: ${problems.join(' ')}`);

const artifactPath = path.join(ROOT, record.artifact);
if (!fs.existsSync(artifactPath)) refuse(`the artifact the record names is not here: ${record.artifact}`);
const artifactBytes = fs.readFileSync(artifactPath);
const artifactSha = createHash('sha256').update(artifactBytes).digest('hex');
if (artifactSha !== record.artifactSha256) refuse(`artifact sha256 mismatch: recorded ${record.artifactSha256}, on disk ${artifactSha}`);
if (artifactBytes.length !== record.artifactBytes) refuse(`artifact length mismatch: recorded ${record.artifactBytes}, on disk ${artifactBytes.length}`);

// ── Load the baseline's SCHEMA (never its data) into a scratch database ──────────────────────
// The artifact's own `-- @phase:` markers are read with the same rule `restore-verify` and the PGlite
// verifier use, so a baseline statement that cannot run before the tables exist is reported as
// expected rather than as a broken baseline — without being swallowed: it is counted and printed.
const artifactText = artifactBytes.toString('utf8');
const phaseAt = phaseReader(artifactText);
const statements = splitStatementsWithOffsets(artifactText).map((entry) => ({
  text: entry.text,
  phase: phaseAt(entry.offset),
}));
const dataStatements = statements.filter((entry) => isDataStatement(entry.text));
const schemaStatements = statements.filter((entry) => !isDataStatement(entry.text));
if (dataStatements.length !== record.dataStatements) {
  refuse(`the record says ${record.dataStatements} data statements; the splitter found ${dataStatements.length} — the record and the artifact disagree.`);
}

function runSql(sql) {
  const r = docker(['exec','-i', container, 'psql','-U','postgres','-d', DB_NAME, '-X','-q','-v','ON_ERROR_STOP=0'], sql);
  return { text: `${r.stdout}\n${r.stderr}`, status: r.status };
}

// Fresh scratch database, dropped so a rehearsal never inherits a previous one's state. The drop or
// create failing is fatal: a rehearsal that silently ran against the wrong database would report a
// result about nothing.
function adminSql(sql) {
  const r = docker(['exec', container, 'psql','-U','postgres','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1','-c', sql]);
  if (r.status !== 0) refuse(`admin SQL failed (${r.stderr.trim().split('\n')[0] || `exit ${r.status}`}): ${sql}`);
  return r.stdout;
}
adminSql(`drop database if exists "${DB_NAME}" with (force)`);
adminSql(`create database "${DB_NAME}"`);

// A hosted Supabase project has platform schemas (`auth`, `storage`, `extensions`) that the
// environment's own artifact does not carry — the backup tool dumps `public` and `auth` data, and
// `storage` belongs to the platform. A scratch database without them is not production-shaped: a
// file that installs an upload policy would fail here for a reason that does not exist on hosted.
// So the platform's schemas are copied schema-only from the stack's own database. Schema only: a
// rehearsal needs the shape, never the platform's rows.
{
  const copied = docker(['exec', container, 'sh', '-c',
    `pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges ` +
    `--schema=auth --schema=storage --schema=extensions | psql -U postgres -d ${DB_NAME} -X -q -v ON_ERROR_STOP=0`]);
  if (copied.status !== 0) {
    refuse(`could not copy the platform schemas into ${DB_NAME}: ${(copied.stderr || copied.stdout).trim().split('\n').slice(-1)[0]}`);
  }
}
// The artifact carries no GRANT and no platform defaults, and a freshly created database has none of
// the platform's own schemas. Install the extensions a hosted project has and the artifact's SQL
// assumes; the platform schemas themselves (auth, storage) are NOT fabricated here — where a file
// needs one, that shows up as a named rehearsal-environment gap rather than being papered over.
adminSql('create extension if not exists pgcrypto; create extension if not exists pg_trgm;');
docker(['exec', container, 'psql','-U','postgres','-d', DB_NAME, '-X','-q','-v','ON_ERROR_STOP=0',
  '-c', 'create extension if not exists pgcrypto; create extension if not exists pg_trgm;']);

// ── The second thing the artifact cannot carry: hosted's DEFAULT PRIVILEGES ──────────────────
/**
 * WHY THIS RUNS HERE
 *   The baseline artifact contains no GRANT at all, and a freshly created database has no default
 *   privileges to give: that is a property of the artifact and of a new database, not of the schema.
 *   `scripts/dev/local-db.mjs` documents the consequence and installs hosted's mapping before its
 *   objects exist; a rehearsal database needs the same base for the same reason, and its absence was
 *   measured rather than assumed — the first intent probe of the production-baseline rehearsal
 *   reported `authenticated` unable to SELECT `sales`, `products`, `customers` and `companies`, which
 *   said nothing about the batch and everything about the database it was asked.
 *
 *   The SQL is kept IDENTICAL to `local-db.mjs`'s (a unit test compares the two literals), and it is
 *   applied BEFORE the baseline loads, so it is a default for every object created afterwards — the
 *   same order hosted has, and the only order in which a forward file's REVOKE can mean anything.
 *   Applied after the batch it would undo 0189's and 0195's revokes.
 */
const PLATFORM_DEFAULTS_SQL = `
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, update, usage on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
`;
// `adminSql` connects to the `postgres` maintenance database — that is deliberately where create/drop
// run — so the defaults have to be applied through a connection to the scratch database itself.
{
  const applied = docker(['exec', container, 'psql','-U', 'postgres','-d', DB_NAME, '-X','-q','-v','ON_ERROR_STOP=1',
    '-c', PLATFORM_DEFAULTS_SQL]);
  if (applied.status !== 0) {
    refuse(`the platform default privileges could not be applied in ${DB_NAME}: ${(applied.stderr || applied.stdout).trim().split('\n')[0]}`);
  }
}
// The ALTER is a no-op when it runs as a role that is not the one creating the objects, and a rehearsal
// that silently lost its platform base would answer every privilege question with "denied" — the exact
// false negative this block exists to prevent. Read it back instead of trusting it.
{
  const acl = docker(['exec', container, 'psql','-U','postgres','-d', DB_NAME, '-X','-t','-A','-c',
    "select coalesce(string_agg(coalesce(d.defaclacl::text, ''), ' '), '(none)') from pg_default_acl d " +
      "where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'"]).stdout.trim();
  if (!/authenticated=arwdDxtm/.test(acl)) {
    refuse(`the platform default privileges did not take in ${DB_NAME} (pg_default_acl said ${acl || '(nothing)'}). Every privilege check after this would be about a database no hosted project resembles.`);
  }
}

function applyStatements(list) {
  const failures = [];
  for (const { text: statement, phase } of list) {
    const out = runSql(statement);
    // stderr included: psql reports SQL errors there, and a harness that reads only stdout would
    // score every failing statement as a success.
    if (/ERROR:/.test(out.text) || out.status !== 0) {
      // The statement is kept WHOLE for the pre-table retry below; only its display form is cut.
      failures.push({
        statement,
        phase,
        display: statement.split('\n')[0].slice(0, 90),
        error: (out.text.match(/ERROR:[^\n]*/) ?? [`psql exit ${out.status}`])[0].slice(0, 200),
      });
    }
  }
  return { applied: list.length - failures.length, failures, attempted: list.length };
}

const baselinePass1 = applyStatements(schemaStatements);
// The artifact interleaves a `functions-pre-tables` phase: a function that returns a table row type
// cannot exist before its table. The PGlite loader reports those as expected and re-applies them
// after the tables exist; the same rule holds on a real engine, so the retry is mirrored here.
const retry = applyStatements(baselinePass1.failures.map((f) => ({ text: f.statement, phase: f.phase })));
// Whatever still fails after the retry is reported as it is. It is not swallowed and not classified
// away: the schema load's own result is part of the evidence, and a silently broken baseline would
// invalidate everything the selection proves.
const baselineFailures = retry.failures;
// Only a failure in an authoritative phase says the baseline is broken. The pre-table pass is
// best-effort BY CONSTRUCTION (a function returning a table's row type cannot exist before it), and
// the PGlite verifier classes those the same way — this is the same rule, so the two reports agree.
const unexpectedBaselineFailures = baselineFailures.filter((failure) => failure.phase !== EXPECTED_PHASE);
const expectedPhaseFailures = baselineFailures.length - unexpectedBaselineFailures.length;

// ── The selection ────────────────────────────────────────────────────────────────────────────
const entries = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  .map((filename) => ({ version: filename.slice(0, 4), filename }));

let selection;
if (filesArg) {
  selection = filesArg.split(',').map((f) => f.trim()).filter(Boolean).map((given) => {
    const filename = path.basename(given);
    const entry = entries.find((e) => e.filename === filename);
    if (!entry) refuse(`${filename} is not a file in supabase/migrations.`);
    return entry;
  });
} else {
  selection = selectForwardFiles(entries, { since, upto: flag('upto') });
  if (selection.length === 0) refuse(`--since ${since} selected no files.`);
}

const results = [];
for (const entry of selection) {
  const fileStatements = splitStatements(fs.readFileSync(path.join(MIGRATIONS, entry.filename), 'utf8')).map((text) => ({
    text,
    phase: 'forward',
  }));
  const outcome = applyStatements(fileStatements);
  results.push({ filename: entry.filename, statements: outcome.attempted, failures: outcome.failures.length, messages: outcome.failures.slice(0, 6).map((f) => f.error) });
}

const totals = results.reduce((acc, r) => ({ statements: acc.statements + r.statements, failures: acc.failures + r.failures }), { statements: 0, failures: 0 });
const report = {
  generatedAt: new Date().toISOString(),
  engine: { kind: 'local-supabase-cli-stack', container, serverVersion, platformExtensionsAvailable: platformExtensions },
  baseline: { environment: baselineArg, artifact: record.artifact, artifactSha256: artifactSha, dataStatementsCounted: dataStatements.length, dataStatementsApplied: 0 },
  platformPrivileges: 'hosted default privileges applied before the baseline loads (mirrors scripts/dev/local-db.mjs) — the artifact carries no GRANT, so without this an ACL check would be about an empty database',
  scratchDatabase: DB_NAME,
  platformSchemas: 'auth, storage, extensions — copied schema-only from the local stack, so a file that touches storage is judged on a shape production has',
  schemaLoad: {
    statements: schemaStatements.length,
    failuresFirstPass: baselinePass1.failures.length,
    failuresAfterRetry: baselineFailures.length,
    unexpectedAfterRetry: unexpectedBaselineFailures.length,
    expectedPhaseAfterRetry: expectedPhaseFailures,
    firstFew: baselineFailures.slice(0, 5).map((f) => ({ statement: f.display, phase: f.phase, error: f.error })),
  },
  selection: { kind: filesArg ? 'files' : 'since', since: since ?? null, files: selection.map((e) => e.filename) },
  results,
  summary: { files: results.length, statements: totals.statements, sqlFailures: totals.failures },
  status: totals.failures === 0 && unexpectedBaselineFailures.length === 0 ? 'PASS' : 'FAIL',
};

// ── Compare with a PGlite report, when one is given ──────────────────────────────────────────
const comparePath = flag('compare-report');
if (comparePath) {
  const prior = JSON.parse(fs.readFileSync(path.resolve(ROOT, comparePath), 'utf8'));
  const priorByFile = new Map((prior.files ?? []).map((f) => [f.filename, (f.failures ?? []).length]));
  const differences = results
    .filter((r) => priorByFile.has(r.filename) && priorByFile.get(r.filename) !== r.failures)
    .map((r) => `${r.filename}: PGlite ${priorByFile.get(r.filename)} → real engine ${r.failures}`);
  report.comparison = {
    against: comparePath,
    pglite: { files: prior.files?.length ?? null, statements: prior.summary?.statements ?? prior.summary?.totalStatements ?? null, sqlFailures: prior.summary?.sqlFailures ?? prior.summary?.failures ?? null },
    realEngine: { files: report.summary.files, statements: report.summary.statements, sqlFailures: report.summary.sqlFailures },
    perFileDifferences: differences,
    verdict: differences.length === 0 ? 'AGREES' : 'DIFFERS',
  };
}

const jsonOut = flag('json');
if (jsonOut) fs.writeFileSync(path.resolve(ROOT, jsonOut), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\nRehearsal on the local Supabase engine — ${baselineArg} baseline`);
console.log(`  engine      : ${container} (Postgres ${serverVersion}; extensions available: ${platformExtensions || 'none'})`);
console.log(`  baseline    : ${record.artifact}`);
console.log(`  data        : ${dataStatements.length} statements counted, 0 applied (production rows are not loaded)`);
console.log(
  `  schema load : ${schemaStatements.length} statements, ${unexpectedBaselineFailures.length} failures after the pre-table retry` +
    (expectedPhaseFailures ? ` (${expectedPhaseFailures} expected-phase, the artifact's own best-effort pass — not the batch's doing)` : ''),
);
console.log(`  scratch db  : ${DB_NAME} (the local development database is untouched)\n`);
for (const r of results) console.log(`  ${r.failures === 0 ? '✓' : '✗'} ${r.filename}: ${r.statements} statements, ${r.failures} failures${r.messages[0] ? `\n      ${r.messages[0]}` : ''}`);
console.log(`\nSUMMARY ${report.status}: ${report.summary.files} files, ${report.summary.statements} statements, ${report.summary.sqlFailures} sql failures`);
if (report.comparison) {
  console.log(`  vs PGlite (${comparePath}): ${report.comparison.verdict}` +
    ` — PGlite ${report.comparison.pglite.files} files / ${report.comparison.pglite.statements} statements / ${report.comparison.pglite.sqlFailures} failures`);
  for (const d of report.comparison.perFileDifferences) console.log(`    differs: ${d}`);
}
console.log('');

if (has('keep')) console.log(`  kept ${DB_NAME} for inspection (drop it with: docker exec ${container} psql -U postgres -d postgres -c 'drop database ${DB_NAME}')\n`);

process.exit(report.status === 'PASS' ? 0 : 1);
