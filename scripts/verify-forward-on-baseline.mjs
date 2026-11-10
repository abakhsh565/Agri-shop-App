#!/usr/bin/env node
/**
 * verify-forward-on-baseline.mjs — replay a migration file against a FROZEN environment baseline,
 * in PGlite, without touching any environment.
 *
 * WHY THIS EXISTS (SCHEMA_STRATEGY.md)
 *   `supabase/migrations` is a patch set, not a baseline, and it does not replay cleanly onto any
 *   real database either. Measured on 2026-10-01 in PGlite:
 *     * onto the captured PRODUCTION schema:  30 files with failures / 169
 *     * onto the captured STAGING schema:     24 files with failures / 169
 *     * onto COMPLETE_DATABASE_SETUP.sql:     26 files with failures
 *     * ALL_MIGRATIONS_TO_RUN.sql as a base:  78 failures in the base itself
 *   So history is never replayed. Every environment has a frozen schema-only baseline; new changes
 *   are new files (0178+); and before any file is applied to an environment it is replayed onto that
 *   environment's baseline HERE. Production stays read-only: its baseline exists to check migrations
 *   against, never to receive a replay of history.
 *
 * WHAT IT DOES
 *   Loads `supabase/baseline/<env>-baseline.json`, re-hashes the artifact it names (a mismatch is a
 *   refusal, not a warning), loads the schema-only dump into an in-process PGlite with Supabase's
 *   scaffolding stubbed, then applies the selected files in canonical order and reports, per file,
 *   every statement that failed. A failure caused by PGlite missing an extension/schema is classed
 *   `env-gap` (unverifiable here); everything else is `sql` and must be zero.
 *
 *   PASS           sql = 0 and no env-gaps: the selection replays cleanly onto this environment.
 *   FAIL           at least one real SQL failure. Exit 1.
 *   UNVERIFIABLE   sql = 0 but statements could not run because PGlite cannot host that dependency.
 *                  Exit 1 with the reason — an unchecked statement is never a PASS.
 *   BASELINE-BROKEN the baseline itself fails to load with SQL errors, so nothing downstream could
 *                  be trusted; the selection is not applied and the run exits 1.
 *
 * WHAT IT REFUSES
 *   * verifying "everything" — that is a replay of history, which this tool exists to prevent; the
 *     selection must be `--since`, `--since/--upto`, or explicit `--files`.
 *   * an artifact whose sha256 or byte length differs from the recorded baseline.
 *   * a `--files` name outside the 4-digit version grammar (it could not be ordered).
 *   * production is never connected to: this tool only ever reads a local dump.
 *
 * Usage:
 *   node scripts/verify-forward-on-baseline.mjs --baseline production --since 0176
 *   node scripts/verify-forward-on-baseline.mjs --baseline staging --since 0178 --json report.json
 *   node scripts/verify-forward-on-baseline.mjs --baseline production --files backups/migration-proof/corpus-d/0178_x.sql
 *
 * Exit codes: 0 = PASS, 1 = FAIL or UNVERIFIABLE or BASELINE-BROKEN, 2 = refused before doing anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

import { readMigrationDirectory, sha256 } from './lib/migrations.mjs';
import { copyDataToInsert, splitStatements, splitStatementsWithOffsets } from './lib/sql-statements.mjs';
import { ROOT } from './lib/environments.mjs';
import {
  BASELINE_ENVIRONMENTS,
  EXPECTED_PHASE,
  baselineMetadataPath,
  baselineProvidesStorageSchema,
  baselineSkipReason,
  checkReferenceDataCap,
  classifyBaselineFailure,
  countDataStatements,
  dataStatementTarget,
  isDataStatement,
  isExtensionStatement,
  isReferenceDataStatement,
  phaseReader,
  selectForwardFiles,
  summarizeReplay,
  validateBaselineMetadata,
} from './lib/baseline.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const token = args[index];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[index + 1] ?? fallback;
};
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const jsonOut = flag('json');
let reportResult = null;
function writeReport(exitCode) {
  if (!jsonOut || !reportResult) return;
  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ ...reportResult, exitCode }, null, 2)}\n`);
  console.log(`  Report: ${path.relative(ROOT, outPath)}`);
}
function refuse(message, code = 2) {
  console.error(`\n[BASELINE REFUSED] ${message}\n`);
  reportResult = { status: 'REFUSED', reason: message, generatedAt: new Date().toISOString() };
  writeReport(code);
  process.exit(code);
}
function fail(message, result) {
  console.error(`\n[BASELINE] ${result?.status ?? 'FAIL'} — ${message}\n`);
  reportResult = result;
  writeReport(1);
  process.exit(1);
}

if (has('help') || args.includes('-h') || args.length === 0) {
  console.log(
    [
      'Usage: node scripts/verify-forward-on-baseline.mjs --baseline <production|staging|path> (--since <ver> [--upto <ver>] | --files <a.sql,b.sql>) [--json <file>]',
      '       node scripts/verify-forward-on-baseline.mjs --metadata <file> (--since <ver> | --files <a.sql>)',
      '',
      '  --baseline production|staging   use the recorded baseline for that environment (sha256-verified)',
      '  --baseline <path>               use an explicit dump as the baseline (hash NOT verified)',
      '  --metadata <file>               use a baseline record at an explicit path',
      '  --since <ver>                   replay files from this 4-digit version, inclusive',
      '  --upto <ver>                    stop at this version, inclusive',
      '  --files <list>                  explicit comma-separated files (for scratch corpora)',
      '  --json <file>                   machine-readable report',
    ].join('\n'),
  );
  process.exit(args.length === 0 ? 2 : 0);
}

const baselineArg = flag('baseline');
const metadataArg = flag('metadata');
const since = flag('since');
const upto = flag('upto');
const filesArg = flag('files');

if (!baselineArg && !metadataArg) {
  refuse('name a baseline: --baseline production|staging|<path> (or --metadata <file>).');
}
if (baselineArg && metadataArg) refuse('pass either --baseline or --metadata, not both.');
if (!since && !upto && !filesArg) {
  refuse(
    'name what to verify: --since <version> [--upto <version>] or --files <a.sql,b.sql>. ' +
      'Verifying the whole directory is a replay of history, which this tool exists to prevent.',
  );
}
if ((since || upto) && filesArg) refuse('--since/--upto and --files are alternatives.');

// ---- Resolve the baseline record and artifact ------------------------------------------------
let metadata = null;
let artifactPath = null;
let artifactLabel = null;
if (metadataArg) {
  const metaPath = path.resolve(ROOT, metadataArg);
  if (!fs.existsSync(metaPath)) refuse(`${metadataArg} does not exist.`);
  try {
    metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    refuse(`${metadataArg} is not valid JSON: ${error.message}`);
  }
  const problems = validateBaselineMetadata(metadata);
  if (problems.length) refuse(`${metadataArg} is not a valid baseline record: ${problems.join(' ')}`);
  artifactPath = path.resolve(ROOT, metadata.artifact);
  artifactLabel = metadata.artifact;
} else if (BASELINE_ENVIRONMENTS.includes(baselineArg)) {
  const metaPath = path.join(ROOT, baselineMetadataPath(baselineArg));
  if (!fs.existsSync(metaPath)) {
    refuse(
      `no baseline is recorded for ${baselineArg} at ${baselineMetadataPath(baselineArg)}. ` +
        'Capture one read-only with `npm run backup` and record it before verifying forward files.',
    );
  }
  metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const problems = validateBaselineMetadata(metadata);
  if (problems.length) refuse(`${baselineMetadataPath(baselineArg)} is not a valid baseline record: ${problems.join(' ')}`);
  artifactPath = path.resolve(ROOT, metadata.artifact);
  artifactLabel = metadata.artifact;
} else {
  artifactPath = path.resolve(ROOT, baselineArg);
  artifactLabel = baselineArg;
  if (!fs.existsSync(artifactPath)) refuse(`${baselineArg} does not exist.`);
}

if (!fs.existsSync(artifactPath)) {
  refuse(
    `the baseline artifact ${artifactLabel} is missing. It is a captured dump (gitignored on purpose: ` +
      'it is an environment snapshot). Re-capture it read-only with `npm run backup` or point --metadata at a local copy.',
  );
}

const artifactText = fs.readFileSync(artifactPath, 'utf8');
const artifactSha256 = crypto.createHash('sha256').update(artifactText).digest('hex');
if (metadata) {
  if (artifactSha256 !== metadata.artifactSha256) {
    refuse(
      `artifact ${artifactLabel} has sha256 ${artifactSha256} but the record says ${metadata.artifactSha256}. ` +
        'Refusing to verify against a schema that is not the recorded baseline.',
    );
  }
  if (Buffer.byteLength(artifactText, 'utf8') !== metadata.artifactBytes) {
    refuse(`artifact ${artifactLabel} is not the recorded byte length (${metadata.artifactBytes}).`);
  }
}

// ---- Select the files ------------------------------------------------------------------------
let selected = [];
if (filesArg) {
  const names = filesArg.split(',').map((n) => n.trim()).filter(Boolean);
  if (!names.length) refuse('--files was given no names.');
  for (const name of names) {
    const filePath = path.resolve(ROOT, name);
    if (!fs.existsSync(filePath)) refuse(`--files: ${name} does not exist.`);
    const filename = path.basename(filePath);
    if (!/^\d{4}_/.test(filename)) refuse(`--files: ${filename} does not start with a 4-digit version.`);
    selected.push({ filename, version: filename.slice(0, 4), body: fs.readFileSync(filePath, 'utf8') });
  }
  selected.sort((a, b) => a.version.localeCompare(b.version) || a.filename.localeCompare(b.filename));
} else {
  const { entries, problems } = readMigrationDirectory();
  if (problems.length) {
    refuse(`the migration directory does not satisfy its grammar: ${problems.map((p) => p.detail).join(' ')}`);
  }
  const selection = selectForwardFiles(entries, { since, upto });
  if (selection.problems.length) refuse(selection.problems.join(' '));
  if (!selection.files.length) refuse('the selection is empty.');
  selected = selection.files.map((filename) => entries.find((entry) => entry.filename === filename));
}

// ---- Load the baseline into PGlite -----------------------------------------------------------
console.log(`\n[BASELINE] ${artifactLabel}`);
console.log(`  sha256 ${artifactSha256}${metadata ? ' (matches the record)' : ' (no record: hash NOT verified)'}`);
if (metadata) {
  console.log(
    `  ${metadata.environment} · captured ${metadata.capturedAt} · server ${metadata.serverVersion} · ` +
      `structure ${metadata.structure.tables} tables / ${metadata.structure.functions} functions / ${metadata.structure.policies} policies`,
  );
}
console.log(`  selection: ${selected.map((f) => f.filename).join(', ')}\n`);

const db = new PGlite();
await db.exec(`set time zone 'UTC'`);
await db.exec(`create schema if not exists auth`);
for (const fn of [
  `create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$`,
  `create or replace function auth.role() returns text language sql stable as $$ select null::text $$`,
  `create or replace function auth.email() returns text language sql stable as $$ select null::text $$`,
  `create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$`,
]) {
  await db.exec(fn);
}
for (const stmt of [
  `create role anon`,
  `create role authenticated`,
  `create role service_role`,
  `create schema if not exists extensions`,
]) {
  try {
    await db.exec(stmt);
  } catch {
    /* already there */
  }
}
try {
  await db.exec(`create extension if not exists pgcrypto with schema extensions`);
} catch (error) {
  console.log(`  (env) pgcrypto unavailable in PGlite: ${String(error.message).split('\n')[0]}`);
}
await db.exec(`create schema if not exists storage`);
// The pg_dump baselines define the real storage tables; the canonical backup format does
// not. When the artifact provides them, use its own definitions — the stub's narrow columns
// (no file_size_limit) are what made 0250/0261 fail. When it does not, stub exactly as
// before, so the old format still verifies. See baselineProvidesStorageSchema.
const storageSchemaInBaseline = baselineProvidesStorageSchema(artifactText);
if (!storageSchemaInBaseline) {
  await db.exec(`create table if not exists storage.buckets (id text primary key, name text, public boolean default false)`);
  await db.exec(
    `create table if not exists storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid, path_tokens text[], metadata jsonb)`,
  );
}
await db.exec(`create schema if not exists cron`);
await db.exec(`create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ select 1::bigint $$`);
await db.exec(`create or replace function cron.schedule(schedule text, command text) returns bigint language sql as $$ select 1::bigint $$`);
await db.exec(`create or replace function cron.unschedule(job_name text) returns boolean language sql as $$ select true $$`);
try {
  await db.exec(`create publication supabase_realtime`);
} catch {
  /* already there */
}

const firstLine = (error) => String(error.message).split('\n')[0].trim();
const collapse = (statement) => statement.replace(/\s+/g, ' ').slice(0, 110);

const baselineEntries = splitStatementsWithOffsets(artifactText);
const dataStatements = countDataStatements(baselineEntries.map((entry) => entry.text));
if (metadata && dataStatements !== metadata.dataStatements) {
  refuse(
    `the record says ${metadata.dataStatements} data statement(s) but the artifact contains ${dataStatements}. ` +
      'Refusing to verify against an artifact the record does not describe.',
  );
}
const phaseAt = phaseReader(artifactText);
const baselineLoadFailures = [];
const baselineSkipped = [];
const referenceRowCounts = {};
let skippedDataStatements = 0;
for (const entry of baselineEntries) {
  // A baseline is loaded for its schema: bulk rows are never executed — see isDataStatement().
  // The one exception is the allowlisted reference tables (REFERENCE_DATA_TABLES): foreign
  // keys in the selection can only be validated when the rows they point at exist, so those
  // rows load — bounded by REFERENCE_DATA_ROW_CAP, counted, and reported in the report.
  // COPY blocks are converted to INSERTs first: PGlite has no COPY ... FROM stdin channel.
  if (isDataStatement(entry.text)) {
    if (!isReferenceDataStatement(entry.text)) {
      skippedDataStatements++;
      continue;
    }
    const table = dataStatementTarget(entry.text);
    let converted = null;
    try {
      converted = copyDataToInsert(entry.text);
    } catch (error) {
      // A malformed reference COPY block: the load cannot be trusted, refuse loudly.
      refuse(firstLine(error));
    }
    const rows = converted ? converted.rows.length : 1;
    const nextCounts = { ...referenceRowCounts, [table]: (referenceRowCounts[table] ?? 0) + rows };
    const capProblems = checkReferenceDataCap(nextCounts);
    if (capProblems.length) refuse(capProblems.join(' '));
    try {
      if (converted) {
        if (converted.insert) await db.exec(converted.insert);
      } else {
        // INSERT-form reference data (the old backup format): execute as-is, one row.
        await db.exec(entry.text);
      }
    } catch (error) {
      baselineLoadFailures.push({
        class: 'sql',
        phase: phaseAt(entry.offset),
        message: firstLine(error),
        statement: collapse(entry.text),
      });
      continue;
    }
    referenceRowCounts[table] = nextCounts[table];
    continue;
  }
  // Statements that re-create the PGlite scaffolding this tool pre-creates, or that target the
  // stubbed storage tables, are skipped — not executed, not failures. The reason is recorded
  // (see baselineSkipReason); a skip is explicit, never silent. When the baseline provides
  // its own storage schema, the stub-table branch does not apply: the dump's own storage
  // statements execute against its real tables.
  const skipReason = baselineSkipReason(entry.text, { storageSchemaInBaseline });
  if (skipReason) {
    baselineSkipped.push({ reason: skipReason, statement: collapse(entry.text) });
    continue;
  }
  // CREATE EXTENSION is tried for real: when PGlite can host the extension it is installed and
  // later statements may use it. Only the exact "not available" message becomes a skip; any
  // other error is a real failure, recorded like any other statement's.
  if (isExtensionStatement(entry.text)) {
    try {
      await db.exec(entry.text);
    } catch (error) {
      const message = firstLine(error);
      if (/extension "[^"]+" is not available/i.test(message)) {
        baselineSkipped.push({ reason: 'extension-unavailable', statement: collapse(entry.text) });
      } else {
        baselineLoadFailures.push({
          class: classifyBaselineFailure(message),
          phase: phaseAt(entry.offset),
          message,
          statement: collapse(entry.text),
        });
      }
    }
    continue;
  }
  try {
    await db.exec(entry.text);
  } catch (error) {
    const message = firstLine(error);
    const phase = phaseAt(entry.offset);
    // The dump's pre-table pass is best-effort by construction; its failures are re-applied after
    // the data, and that authoritative copy is where a genuine defect would surface (as `sql`).
    baselineLoadFailures.push({
      class: phase === EXPECTED_PHASE ? 'expected-phase' : classifyBaselineFailure(message),
      phase,
      message,
      statement: collapse(entry.text),
    });
  }
}
// A dump sets session settings (notably search_path='') that must not leak into the selection
// phase: forward files resolve unqualified names against the default path.
await db.exec(`SET search_path TO "$user", public`);
const loadByClass = (kind) => baselineLoadFailures.filter((f) => f.class === kind).length;
const skippedByReason = {};
for (const skipped of baselineSkipped) skippedByReason[skipped.reason] = (skippedByReason[skipped.reason] ?? 0) + 1;
const skippedSummary = Object.entries(skippedByReason)
  .map(([reason, count]) => `${count} ${reason}`)
  .join(', ');
console.log(
  `  baseline loaded: ${baselineEntries.length} statements, ${loadByClass('sql')} sql failures, ` +
    `${loadByClass('env-gap')} env-gap, ${loadByClass('expected-phase')} expected pre-table failure(s) (re-applied after the data), ` +
    `${skippedDataStatements} data statement(s) skipped (never executed)` +
    (baselineSkipped.length ? `, ${baselineSkipped.length} skipped (${skippedSummary})` : ''),
);
for (const failure of baselineLoadFailures.slice(0, 5)) console.log(`    [${failure.class}] ${failure.message}`);
const referenceDataEntries = Object.entries(referenceRowCounts);
if (referenceDataEntries.length) {
  console.log(
    `  reference data loaded for FK validation: ${referenceDataEntries.map(([table, rows]) => `${rows} row(s) from ${table}`).join(', ')}`,
  );
}

const baseReport = {
  status: null,
  generatedAt: new Date().toISOString(),
  baseline: {
    label: artifactLabel,
    environment: metadata?.environment ?? null,
    artifactSha256,
    sha256Verified: Boolean(metadata),
    capturedAt: metadata?.capturedAt ?? null,
    statements: baselineEntries.length,
    dataStatements, // measured in the artifact
    dataStatementsSkipped: skippedDataStatements,
    referenceData: referenceDataEntries.map(([table, rows]) => ({ table, rows })),
    loadFailures: baselineLoadFailures,
    skippedStatements: baselineSkipped,
  },
  selection: { since, upto, files: filesArg ?? null, resolved: selected.map((f) => f.filename) },
  files: [],
  summary: null,
};

if (baselineLoadFailures.some((failure) => failure.class === 'sql')) {
  baseReport.status = 'BASELINE-BROKEN';
  baseReport.summary = summarizeReplay([], baselineLoadFailures, baselineSkipped);
  console.error('  the baseline itself fails to load with SQL errors; the selection was NOT applied.\n');
  fail('fix or re-capture the baseline before verifying forward files against it.', baseReport);
}

// ---- Apply the selection ---------------------------------------------------------------------
const fileResults = [];
for (const file of selected) {
  const statements = splitStatements(file.body);
  const failures = [];
  for (const statement of statements) {
    try {
      await db.exec(statement);
    } catch (error) {
      const message = firstLine(error);
      failures.push({ class: classifyBaselineFailure(message), message, statement: collapse(statement) });
    }
  }
  // The sha256 is what ties a verified file to the bytes on disk: the production gate compares
  // the report's hash against the file's current hash. mtime cannot do that job — a fresh
  // checkout sets every file's mtime to the checkout time, which is always after generatedAt.
  // Entries from readMigrationDirectory already carry their hash; --files entries carry only a
  // body, so hash it here.
  fileResults.push({
    filename: file.filename,
    version: file.version,
    statements: statements.length,
    sha256: file.sha256 ?? sha256(file.body),
    failures,
  });
  const mark = failures.some((f) => f.class === 'sql') ? '✗' : failures.length ? '~' : '✓';
  console.log(`${mark} ${file.filename}: ${statements.length} statements, ${failures.length} failures`);
  for (const failure of failures) console.log(`    [${failure.class}] ${failure.message}\n      ${failure.statement}`);
}
await db.close();

const summary = summarizeReplay(fileResults, baselineLoadFailures, baselineSkipped);
baseReport.status = summary.status;
baseReport.files = fileResults;
baseReport.summary = summary;

console.log(
  `\nSUMMARY ${summary.status}: ${summary.files} files, ${summary.statements} statements, ` +
    `${summary.sqlFailures} sql failures, ${summary.envGapFailures} env-gap failures` +
    (summary.baselineLoadFailures
      ? `; baseline load ${summary.baselineLoadFailures} failures (${summary.baselineSqlFailures} sql, ${summary.baselineEnvGapFailures} env-gap)`
      : ''),
);
if (summary.status === 'PASS') {
  console.log(`  the selection replays cleanly onto ${metadata?.environment ?? artifactLabel}.\n`);
  reportResult = baseReport;
  writeReport(0);
  process.exit(0);
}
if (summary.status === 'UNVERIFIABLE') {
  console.error(
    '  no SQL failures, but some statements could not be exercised in PGlite. ' +
      'An unchecked statement is not a PASS — resolve the dependency or verify it another way.\n',
  );
} else {
  console.error('  at least one real SQL failure: the selection does NOT apply cleanly onto this baseline.\n');
}
fail('verification did not pass.', baseReport);
