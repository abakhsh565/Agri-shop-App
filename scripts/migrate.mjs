#!/usr/bin/env node
/**
 * migrate.mjs — the deployment script that records what it applied.
 *
 * WHAT WAS WRONG
 *   `scripts/deploy-migrations.mjs` (retired by this file) ran a migration file and recorded
 *   nothing. Every deploy therefore left `supabase_migrations.schema_migrations` unchanged — it
 *   still held three rows while the directory held 167 files — so no environment could answer
 *   "what has been applied here?" except by being diffed by hand. The audit called this out as
 *   "no record of which migrations have run", and the two non-canonical filenames made any naive
 *   replay wrong as well.
 *
 * WHAT THIS FILE DOES
 *   `status`  read-only: directory vs ledger, as a table. Never fails on a difference.
 *   `verify`  read-only: the CI check. Exits 1 if the directory breaks its grammar, if any file is
 *             pending, if the ledger records a version no file carries, if a file's sha256 differs
 *             from the one recorded when it was applied, or if the recorded rows carry no hash.
 *   `adopt`   dry-run unless `--apply`: records the EXISTING directory against a database whose
 *             schema is already at that state. This is how a database that was migrated by hand
 *             stops being a mystery — every existing file becomes a ledger row, with its sha256,
 *             marked `source = 'adopted'`, and with per-file object evidence printed. Requires
 *             `--attest <newest-version>`: adoption is an owner's act, not a side effect.
 *   `apply`   dry-run unless `--apply`: applies pending files in canonical order. Each file is one
 *             transaction that contains the file AND its two ledger rows, so "applied" and
 *             "recorded" can never disagree: a file that fails leaves no row, and a row that
 *             exists means the file committed.
 *
 * WHAT IT REFUSES, AND WHY THAT IS THE POINT
 *   * production: never, for reads or writes — with one exception, granted by the owner on
 *     2026-10-16 and written down in docs/PRODUCTION_MIGRATION_PLAN.md §7(a): `apply` may target
 *     production when a batch is NAMED and every precondition holds — a PASS verification report
 *     against production's own baseline, taken minutes earlier; no batch file edited since; a
 *     backup taken immediately before and restore-verified; and nothing in the batch sorting at or
 *     before production's recorded position. The rules live in scripts/lib/production-batch-gate.mjs
 *     and the check runs before a credential is resolved or a socket is opened. Everything else
 *     (status, verify, adopt, reconcile, and `apply` with no named batch) is refused as before.
 *     The blanket refusal is still the default because a directory replay is the failure mode the
 *     schema strategy exists to prevent.
 *   * a pending file whose version sorts before the newest recorded version: applying it would
 *     rewrite history out of order.
 *   * a directory with a non-canonical name, a duplicate version, or an order conflict.
 *   * a file that must be applied while its neighbours are unrecorded — unless every pending file
 *     is applied together, in order, in the same run.
 *
 * Usage:
 *   node scripts/migrate.mjs status --env staging
 *   node scripts/migrate.mjs verify --env staging
 *   node scripts/migrate.mjs adopt  --env staging --attest 0175 [--apply]
 *   node scripts/migrate.mjs apply  --env staging [--apply]
 *   node scripts/migrate.mjs verify --target pglite --dir <directory>
 *
 * Exit codes: 0 = ok, 1 = verification failed or an apply failed, 2 = refused before doing anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

import {
  MIGRATIONS_DIR,
  classifyReconciliation,
  compareWithLedger,
  ledgerOnlyAudit,
  declaredObjects,
  orderHazards,
  readMigrationDirectory,
} from './lib/migrations.mjs';
import { splitStatements } from './lib/sql-statements.mjs';
import { rehearseBatchData } from './lib/data-rehearsal.mjs';
import {
  describeFingerprints,
  diffFingerprints,
  fingerprintDatabase,
  parseApprovals,
} from './lib/data-fingerprint.mjs';
import { FRESHNESS_WINDOW_MINUTES, describeGate, productionBatchGate } from './lib/production-batch-gate.mjs';
import {
  ROOT,
  assertReached,
  connectionStringFor,
  identifyConnection,
  isLocalEnvironment,
  localStackConnection,
  resolveCredentials,
} from './lib/environments.mjs';

const MODES = ['status', 'verify', 'adopt', 'apply', 'reconcile', 'diverge'];

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const token = args[index];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[index + 1] ?? fallback;
};
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

if (has('help') || args.includes('-h') || args.length === 0) {
  console.log(
    [
      'Usage: node scripts/migrate.mjs <status|verify|adopt|apply|reconcile|diverge> --env staging [--apply] [--dir <dir>] [--json <file>]',
      '       node scripts/migrate.mjs reconcile --env staging --version <v> --reason "<why the edit is cosmetic>" [--apply]',
      '       node scripts/migrate.mjs diverge   --env staging --version <v> --kind superseded|not-applicable --reason "<why>" [--apply]',
      '       node scripts/migrate.mjs apply --env production --files <a.sql,b.sql> --verification <report.json>',
      '                                      --backup <artifact>.manifest.json --restored <report.json> [--apply]',
      '       node scripts/migrate.mjs <status|verify|apply> --target pglite [--dir <dir>] [--apply]',
      '',
      '  --env staging      the QA project (the only hosted environment this tool will touch)',
      '  --env development  the local stack, through the connection `localStackConnection` resolves',
      '                     (loopback only). Its ledger is recorded here like any other target: a',
      '                     file applied by hand shows as pending until `apply`/`adopt` records it.',
      '  --env production   refused, by policy — one exception: `apply` with a NAMED batch and all four',
      '                     preconditions satisfied (verification report, backup manifest, restore report,',
      '                     in-position versions). See docs/PRODUCTION_MIGRATION_PLAN.md §7(a).',
      '  --target pglite    a throwaway in-process Postgres, discarded on exit',
      '  --dir <dir>        migration directory (default supabase/migrations)',
      '  --apply            actually write (adopt/apply are dry runs without it)',
      '  --attest <ver>     required by adopt: the newest version being adopted',
      '  --json <file>      machine-readable report',
      '  --ledger-only-allowlist <file>  verify only: QA-only versions this release has reviewed',
      '                     (one version per line, # comments allowed). Every unlisted QA-only row and',
      '                     every stale entry still fails.',
      '  --files <list>     production apply only: the batch to apply, in the verified order',
      '  --verification <f> production apply only: the PASS verify:baseline report for that batch',
      '  --backup <f>       production apply only: the manifest of the backup taken just before',
      '  --restored <f>     production apply only: the restore-verify report proving that backup',
      '  --data-change <t>  production apply only: tables this batch is ALLOWED to change (comma',
      '                     separated). Without it, a batch that moves a user-owned row is refused, in a',
      '                     rehearsal that is always rolled back, before production is written.',
    ].join('\n'),
  );
  process.exit(args.length === 0 ? 2 : 0);
}

function refuse(message, code = 2) {
  console.error(`\n[MIGRATE REFUSED] ${message}\n`);
  writeReport(code);
  process.exit(code);
}

function fail(message) {
  console.error(`\n[MIGRATE] FAIL — ${message}\n`);
  writeReport(1);
  process.exit(1);
}

/**
 * The machine-readable report is written on every exit path that has one, including FAIL and
 * REFUSED. Evidence that only exists when a run is green is not evidence about the failure.
 */
function writeReport(exitCode) {
  if (!jsonOut || !reportResult) return;
  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify({ ...reportResult, exitCode }, null, 2)}\n`);
  console.log(`  Report: ${path.relative(ROOT, outPath)}`);
}

const jsonOut = flag('json');
let reportResult = null;

/**
 * The reviewed QA-ahead list, when the release explicitly supplies one. It is read before the
 * database so a missing or empty exception file cannot be mistaken for "no exceptions".
 */
const allowlistFile = flag('ledger-only-allowlist');
let allowedLedgerOnly = null;
if (allowlistFile) {
  const allowlistPath = path.isAbsolute(allowlistFile) ? allowlistFile : path.join(ROOT, allowlistFile);
  if (!fs.existsSync(allowlistPath)) {
    refuse(`ledger-only allowlist not found: ${allowlistFile}. Nothing was read.`);
  }
  allowedLedgerOnly = fs
    .readFileSync(allowlistPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim().split(/\s+/)[0])
    .filter(Boolean);
  if (!allowedLedgerOnly.length) {
    refuse(`ledger-only allowlist ${allowlistFile} is empty. Nothing was read.`);
  }
}
const mode = args.find((a) => MODES.includes(a));
if (!mode) refuse(`no mode given. One of: ${MODES.join(', ')}`, 2);
if (allowedLedgerOnly && mode !== 'verify') {
  refuse('--ledger-only-allowlist is only valid with verify. Nothing was read.');
}
if (mode === 'status' && has('apply')) refuse('status is read-only. Use `apply` to write.');

// ── Target resolution, before anything is read ──────────────────────────────────────────────
const targetFlag = flag('target');
const envName = flag('env');

if (targetFlag && envName) refuse('choose one target: --env <name> or --target pglite, not both.');
if (!targetFlag && !envName) {
  refuse(
    'this tool has no default target. Pass --env staging (the QA project) or --target pglite.\n' +
      '  A deployment that does not name its database is the failure the ledger exists to catch.',
  );
}

// The blanket refusal, and the one exception to it. `apply` with an explicit `--files` batch is the
// only path that proceeds, and it has to satisfy the gate below — which runs before this tool
// resolves a credential. Every other mode, and `apply` without a named batch, is refused here.
if (envName === 'production' && !(mode === 'apply' && Boolean(flag('files')))) {
  refuse(
    'production is not a target of this tool. This refusal happens before a credential is resolved\n' +
      '  and before any ledger is read, so it states no position — a refusal that printed a version\n' +
      '  number would be describing a measurement it never took. Where production actually stands is\n' +
      '  recorded in supabase/baseline/production-baseline.json; that record, not this message, is the\n' +
      '  measure. What production needs is the schema-strategy decision in PRODUCTION_READINESS_AUDIT.md\n' +
      '  §D — not a replay.\n' +
      '  Nothing was read and nothing was written. This refusal is deliberate and is not a bug.\n' +
      '  The single exception is `apply` with a NAMED batch and a PASS verification report, a fresh\n' +
      '  restore-verified backup, and an in-position file list — see docs/PRODUCTION_MIGRATION_PLAN.md §7(a).',
  );
}

const dir = path.resolve(ROOT, flag('dir', MIGRATIONS_DIR));
const dryRun = !has('apply');

// `--state` keeps the throwaway PGlite database on disk so a second run sees what the first one
// recorded. It exists for the proof runs (apply, then verify, then apply again) — nothing else uses
// it, and it is refused for a live target, where the ledger is the real thing and not a fixture.
const stateFlag = flag('state');
if (stateFlag && targetFlag !== 'pglite') refuse('--state only applies to --target pglite.');
const stateDir = stateFlag ? path.resolve(ROOT, stateFlag) : null;

// ── Adapters: one interface, two targets ────────────────────────────────────────────────────
const LEDGER_DDL = [
  `create schema if not exists supabase_migrations`,
  `create table if not exists supabase_migrations.schema_migrations (
     version text primary key,
     statements text[],
     name text
   )`,
  `create table if not exists supabase_migrations.schema_migration_files (
     version text primary key,
     filename text not null,
     sha256 text not null,
     bytes integer not null,
     source text not null check (source in ('applied','adopted')),
     applied_at timestamptz not null default now(),
     applied_by text not null default current_user
   )`,
  // Added later, so the ledger can say WHEN a recorded hash was re-recorded after the fact and WHY.
  // A file whose hash was reconciled is not the same fact as a file nobody ever edited, and the
  // ledger must be able to tell them apart.
  `alter table supabase_migrations.schema_migration_files add column if not exists reconciled_at timestamptz`,
  `alter table supabase_migrations.schema_migration_files add column if not exists reconcile_note text`,
  // A recorded divergence: this environment legitimately cannot hold the file on disk. Two shapes
  // exist and both are named here, because they are different facts:
  //   * `superseded`      the database applied a different text at this version (staging's 0220);
  //   * `not-applicable`  the database has the effect already and the file's rest is a repair for
  //                       another lineage, so it was never run at all (staging's 0224).
  // The two exact hashes are stored, so the record can only ever explain THIS pair of bytes.
  `create table if not exists supabase_migrations.schema_migration_divergences (
     version text primary key,
     kind text not null check (kind in ('superseded','not-applicable')),
     recorded_sha256 text not null,
     current_sha256 text not null,
     reason text not null,
     recorded_at timestamptz not null default now(),
     recorded_by text not null default current_user
   )`,
];

/**
 * The local stack, as a target of the SAME tool.
 *
 * Development had no ledger at all: `local-db.mjs init` restores the frozen baseline and applies
 * the forward files, but records nothing, so a file applied there by hand (`psql`, a hotfix) left
 * no trace and no `status`/`verify` could tell it from a pending one. The answer is not a hand
 * INSERT into the ledger — that is how a record starts lying. It is to let this tool reach the
 * stack through the connection the repository already owns (`localStackConnection`, which refuses
 * anything but loopback) and then `adopt`/`apply` it exactly as it does staging: one file and its
 * ledger rows in one transaction, or nothing.
 *
 * The hosted identity checks cannot run here: they compare a project ref, and a loopback address
 * deliberately has none. Its own guard replaces them — the resolved connection must be loopback
 * and the container it names must be a local `supabase_db_*` one.
 */
async function openLocalTarget(name) {
  let local;
  try {
    local = localStackConnection(name);
  } catch (error) {
    refuse(String(error.message));
  }
  if (!local.loopback) {
    refuse(`refusing "${name}": its connection is not loopback, so it is not this machine's stack.`);
  }
  if (!(local.containers?.length) || local.containers.some((c) => !/^supabase_db_[A-Za-z0-9_\-]+$/.test(c))) {
    refuse(
      `refusing "${name}": no local \`supabase_db_*\` container was found for it, so there is no local ` +
        'database to record against. Start the stack with `npm run local:db -- up`.',
    );
  }

  const client = new pg.Client({
    connectionString: local.connectionString,
    ssl: false,
    connectionTimeoutMillis: 15000,
    statement_timeout: 300000,
  });
  await client.connect();

  const serverUser = (await client.query('select current_user as u')).rows[0]?.u ?? null;
  const database = (await client.query('select current_database() as d')).rows[0]?.d ?? null;
  let clusterId = null;
  try {
    clusterId = (await client.query('select system_identifier::text as id from pg_control_system()')).rows[0]?.id ?? null;
  } catch {
    clusterId = null;
  }

  return {
    kind: 'postgres',
    label: `${name} (local stack, ${local.host}:${local.port ?? '5432'}/${database})`,
    identity: { clusterId, configuredUser: serverUser, serverUser, local: true },
    exec: (sql) => client.query(sql),
    query: (sql, params) => client.query(sql, params),
    close: () => client.end(),
  };
}

async function openLiveTarget(name) {
  if (isLocalEnvironment(name)) return openLocalTarget(name);
  let creds;
  try {
    creds = resolveCredentials(name);
  } catch (error) {
    refuse(String(error.message));
  }
  const client = new pg.Client({
    connectionString: connectionStringFor(creds),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 300000,
  });
  await client.connect();
  const identity = await identifyConnection(client, creds);
  try {
    assertReached(creds, identity);
  } catch (error) {
    await client.end();
    refuse(String(error.message));
  }
  return {
    kind: 'postgres',
    label: `${creds.environment} (project ${creds.projectRef})`,
    identity,
    exec: (sql) => client.query(sql),
    query: (sql, params) => client.query(sql, params),
    close: () => client.end(),
  };
}

async function openPgliteTarget(stateDir) {
  if (stateDir) fs.mkdirSync(stateDir, { recursive: true });
  const db = stateDir ? new PGlite(stateDir) : new PGlite();
  await db.exec(`set time zone 'UTC'`);
  return {
    kind: 'pglite',
    label: stateDir
      ? `pglite (state kept at ${path.relative(ROOT, stateDir)}, for repeated proof runs)`
      : 'pglite (throwaway, in-process, discarded on exit)',
    identity: { clusterId: 'in-process', configuredUser: 'pglite' },
    exec: (sql) => db.exec(sql),
    query: (sql, params) => db.query(sql, params),
    close: () => db.close(),
  };
}

async function readLedger(target) {
  const haveCliTable = (
    await target.query(`select to_regclass('supabase_migrations.schema_migrations') as t`)
  ).rows[0].t;
  if (!haveCliTable) return { present: false, rows: [], hasFileTable: false, divergences: [] };

  const haveFileTable = (
    await target.query(`select to_regclass('supabase_migrations.schema_migration_files') as t`)
  ).rows[0].t;

  const haveDivergenceTable = (
    await target.query(`select to_regclass('supabase_migrations.schema_migration_divergences') as t`)
  ).rows[0].t;
  const divergences = haveDivergenceTable
    ? (
        await target.query(
          `select version, kind, recorded_sha256, current_sha256, reason, recorded_at
             from supabase_migrations.schema_migration_divergences order by version`,
        )
      ).rows
    : [];

  const rows = haveFileTable
    ? (
        await target.query(
          `select coalesce(m.version, f.version) as version, m.name, f.sha256, f.source, f.filename
             from supabase_migrations.schema_migrations m
             full join supabase_migrations.schema_migration_files f on f.version = m.version
            order by 1`,
        )
      ).rows
    : (
        await target.query(
          `select version, name, null::text as sha256, null::text as source, null::text as filename
             from supabase_migrations.schema_migrations order by version`,
        )
      ).rows;

  return { present: true, rows, hasFileTable: haveFileTable, divergences };
}

async function ensureLedger(target) {
  for (const statement of LEDGER_DDL) await target.exec(statement);
}

/**
 * Run one migration file and record it, atomically.
 *
 * The file's statements and the two ledger rows commit together. There is no code path that writes
 * a ledger row without the file having run in the same transaction, which is what makes
 * "the row exists" and "the file is applied" the same statement of fact.
 */
async function applyOne(target, entry) {
  const statements = splitStatements(entry.body);
  await target.exec('begin');
  try {
    await target.exec(entry.body);
    await target.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3)
       on conflict (version) do update set name = excluded.name, statements = excluded.statements`,
      [entry.version, entry.name, statements],
    );
    await target.query(
      `insert into supabase_migrations.schema_migration_files
         (version, filename, sha256, bytes, source, applied_at)
       values ($1, $2, $3, $4, 'applied', now())
       on conflict (version) do update set
         filename = excluded.filename, sha256 = excluded.sha256, bytes = excluded.bytes,
         source = 'applied', applied_at = now()`,
      [entry.version, entry.filename, entry.sha256, entry.bytes],
    );
    await target.exec('commit');
  } catch (error) {
    try {
      await target.exec('rollback');
    } catch {
      /* the transaction is already gone; the original error is the one that matters */
    }
    return { ok: false, error: error.message.split('\n')[0], statements: statements.length };
  }
  return { ok: true, statements: statements.length };
}

/**
 * Re-record the hash of an applied file that was edited cosmetically.
 *
 * `verify` cannot tell "a comment was added" from "the predicate changed" — both are a different
 * hash — so it reports the safer of the two and stops. This mode is the way out, and it is
 * deliberately narrow: the file's statements must normalise to exactly what the ledger recorded as
 * applied (comments and whitespace aside), the reason must be given, and the re-recording is itself
 * recorded (`reconciled_at`, `reconcile_note`). Anything else is refused with the instruction to
 * write a new migration instead.
 */
async function runReconcile() {
  const version = flag('version');
  const reason = flag('reason');
  if (!version) return fail('reconcile requires --version <version>.');
  if (!reason || reason.trim().length < 10) {
    return fail('reconcile requires --reason "<why this edit is cosmetic>" (at least 10 characters).');
  }
  if (target.kind !== 'postgres') return fail('reconcile applies to a live ledger; --target pglite has nothing to reconcile.');
  if (directory.problems.length) return fail('the directory breaks its own grammar; fix it first.');

  const entry = directory.entries.find((e) => e.version === String(version).replace(/^0+/, '').padStart(4, '0'));
  if (!entry) return fail(`no file in ${dir} has version ${version}.`);

  const row = ledger.rows.find((r) => String(r.version) === entry.version);
  if (!row) return fail(`${entry.filename} has no ledger row — nothing to reconcile.`);
  if (!row.sha256) return fail(`${entry.version} was recorded without a hash; use \`adopt --apply\` instead.`);
  if (row.sha256 === entry.sha256) {
    console.log(`\n  ${entry.filename} already matches its recorded hash — nothing to reconcile.`);
    return 0;
  }

  const { rows: recordedRows } = await target.query(
    `select statements from supabase_migrations.schema_migrations where version = $1`,
    [entry.version],
  );
  const recordedStatements = recordedRows[0]?.statements ?? null;
  if (!recordedStatements) {
    return fail(
      `${entry.version} has no recorded statements, so this edit cannot be shown to be cosmetic. ` +
        `Write a new migration instead.`,
    );
  }

  const verdict = classifyReconciliation({ recordedStatements, fileBody: entry.body });
  console.log(`\n  ${entry.filename}: recorded ${row.sha256.slice(0, 12)}…, on disk ${entry.sha256.slice(0, 12)}…`);
  console.log(`  Compared with the recorded statements, ignoring comments and whitespace: ${verdict.cosmetic ? 'identical' : 'DIFFERENT'}`);
  if (!verdict.cosmetic) {
    return fail(
      `${entry.filename} differs from what was applied by more than comments and whitespace. ` +
        `A version that means two different things cannot be reconciled — write the change as a new ` +
        `migration (next free version) and leave this file as it was applied.`,
    );
  }

  if (dryRun) {
    console.log('  Nothing was written. Re-run with --apply to record the new hash and the reason.');
    return 0;
  }

  await ensureLedger(target);
  await target.query(
    `update supabase_migrations.schema_migration_files
        set sha256 = $2, bytes = $3, filename = $4, reconciled_at = now(), reconcile_note = $5
      where version = $1`,
    [entry.version, entry.sha256, entry.bytes, entry.filename, reason.trim()],
  );
  console.log(`  Reconciled ${entry.version}: the new hash is recorded, with the reason.`);
  console.log('  The file is still the applied file — only its recorded hash changed.');
  return 0;
}

/**
 * Record that THIS environment legitimately cannot hold the file on disk, and why.
 *
 * `reconcile` is for a file whose statements are the same after normalisation. This is for the two
 * cases that are not: a database that applied a different text at the same version, and a database
 * that already has the file's effect and was never meant to run its other half. Neither is allowed
 * to be silent, and neither is allowed to be broad: the record stores both exact hashes, so it
 * stops explaining anything the moment either side changes.
 */
async function runDiverge() {
  const version = flag('version');
  const kind = flag('kind');
  const reason = flag('reason');
  if (!version) return fail('diverge requires --version <version>.');
  if (!['superseded', 'not-applicable'].includes(String(kind))) {
    return fail('diverge requires --kind superseded|not-applicable.');
  }
  if (!reason || reason.trim().length < 40) {
    return fail(
      'diverge requires --reason "<what the difference is and why it is intentional>" ' +
        '(at least 40 characters). A record nobody can review is not a record.',
    );
  }
  if (target.kind !== 'postgres') return fail('diverge records history; --target pglite has none.');
  if (directory.problems.length) return fail('the directory breaks its own grammar; fix it first.');

  const entry = directory.entries.find((e) => e.version === String(version).replace(/^0+/, '').padStart(4, '0'));
  if (!entry) return fail(`no file in ${dir} has version ${version}.`);
  const row = ledger.rows.find((r) => String(r.version) === entry.version);

  if (kind === 'superseded') {
    if (!row) return fail(`${entry.filename} has no ledger row on this database — use --kind not-applicable.`);
    if (!row.sha256) return fail(`${entry.version} was recorded without a hash; use \`adopt --apply\` first.`);
    if (row.sha256 === entry.sha256) {
      console.log(`\n  ${entry.filename} already matches its recorded hash — nothing diverges.`);
      return 0;
    }
    const { rows } = await target.query(
      `select statements from supabase_migrations.schema_migrations where version = $1`,
      [entry.version],
    );
    const verdict = classifyReconciliation({ recordedStatements: rows[0]?.statements ?? null, fileBody: entry.body });
    if (verdict.cosmetic) {
      return fail(
        `${entry.filename} differs only by comments and whitespace — use \`reconcile --version ${entry.version}\`,\n` +
          '  which re-records the hash instead of claiming a divergence that is not there.',
      );
    }
    console.log(`\n  ${entry.filename}: recorded ${row.sha256.slice(0, 12)}…, on disk ${entry.sha256.slice(0, 12)}…`);
    console.log('  The statements differ, and this database applied the recorded one.');
  } else {
    if (row) {
      return fail(
        `${entry.filename} HAS a ledger row here (${row.sha256?.slice(0, 12) ?? 'no hash'}). ` +
          'A version that was applied is superseded, not not-applicable.',
      );
    }
    console.log(`\n  ${entry.filename}: no ledger row, and the file is ${entry.sha256.slice(0, 12)}…`);
    console.log("  Recording that this environment's lineage already holds its effect and it was not run here.");
  }

  if (dryRun) {
    console.log('  Nothing was written. Re-run with --apply to record it.');
    return 0;
  }

  await ensureLedger(target);
  await target.query(
    `insert into supabase_migrations.schema_migration_divergences
       (version, kind, recorded_sha256, current_sha256, reason, recorded_at, recorded_by)
     values ($1, $2, $3, $4, $5, now(), current_user)
     on conflict (version) do update set
       kind = excluded.kind, recorded_sha256 = excluded.recorded_sha256,
       current_sha256 = excluded.current_sha256, reason = excluded.reason,
       recorded_at = now(), recorded_by = current_user`,
    [entry.version, kind, row?.sha256 ?? '', entry.sha256, reason.trim()],
  );
  console.log(`  Recorded ${entry.version} as ${kind}, for these bytes only.`);
  console.log('  Any later edit to the file, or to the recorded statements, is reported again.');
  return 0;
}

/** Per-file object evidence for adoption. Names only — see declaredObjects(). */
async function evidenceFor(target, entry) {
  const objects = declaredObjects(entry.body);
  const missing = [];

  for (const table of objects.tables) {
    const found = (await target.query(`select to_regclass($1) as t`, [`public.${table}`])).rows[0].t;
    if (!found) missing.push(`table ${table}`);
  }
  for (const view of objects.views) {
    const found = (await target.query(`select to_regclass($1) as t`, [`public.${view}`])).rows[0].t;
    if (!found) missing.push(`view ${view}`);
  }
  for (const fn of objects.functions) {
    const found = (
      await target.query(
        `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`,
        [fn],
      )
    ).rows.length;
    if (!found) missing.push(`function ${fn}`);
  }
  for (const column of objects.columns) {
    const [table, name] = column.split('.');
    const found = (
      await target.query(
        `select 1 from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
        [table, name],
      )
    ).rows.length;
    if (!found) missing.push(`column ${column}`);
  }

  const declared = objects.tables.length + objects.views.length + objects.functions.length + objects.columns.length;
  return { declared, confirmed: declared - missing.length, missing };
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────
const directory = readMigrationDirectory(dir);

/**
 * Read one report the operator named, or refuse. A missing or unreadable report is a refusal, not a
 * `null` the gate has to interpret: the difference between "no report" and "a report I could not
 * read" is exactly the difference between an honest gate and one that can be satisfied by accident.
 */
function readNamedJson(label, rawPath) {
  if (!rawPath) return null;
  const abs = path.isAbsolute(rawPath) ? rawPath : path.join(ROOT, rawPath);
  if (!fs.existsSync(abs)) refuse(`${label} does not exist: ${path.relative(ROOT, abs)}.`);
  try {
    return { json: JSON.parse(fs.readFileSync(abs, 'utf8')), abs, mtimeMs: fs.statSync(abs).mtimeMs };
  } catch (error) {
    refuse(`${label} is not readable JSON (${path.relative(ROOT, abs)}): ${error.message}`);
    return null;
  }
}

/**
 * Assemble the gate's inputs. Kept separate from the verdict so the same call can be made twice: once
 * before the connection (with `ledgerRows: null`) and once after the ledger has been read.
 *
 * @param {{ ledgerRows?: Array<object>|null }} [options]
 */
function gateProductionBatch({ ledgerRows = null } = {}) {
  const batch = String(flag('files') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    // Accept a path as well as a bare filename, because that is what a shell's tab-completion produces.
    .map((name) => path.basename(name));

  const verification = readNamedJson('the verification report (--verification)', flag('verification'));
  const backup = readNamedJson('the backup manifest (--backup)', flag('backup'));
  const restored = readNamedJson('the restore-verification report (--restored)', flag('restored'));

  const entries = directory.entries.map((entry) => ({
    version: entry.version,
    filename: entry.filename,
    sha256: entry.sha256,
    bytes: entry.bytes,
    mtimeMs: fs.statSync(path.join(dir, entry.filename)).mtimeMs,
  }));

  return productionBatchGate({
    batch,
    entries,
    ledgerRows,
    verification: verification?.json ?? null,
    backupManifest: backup?.json ?? null,
    restoreReport: restored?.json ?? null,
    restoreReportMtimeMs: restored?.mtimeMs ?? null,
    now: Date.now(),
    windowMinutes: Number(flag('window-minutes', FRESHNESS_WINDOW_MINUTES)),
  });
}

// ── Production: the gate runs here, before a credential is resolved and before a socket exists ──
let productionGate = null;
if (envName === 'production') {
  productionGate = gateProductionBatch();
  describeGate(productionGate);
  if (!productionGate.ok) {
    refuse(
      'the production gate did not pass, so nothing was read from production and nothing was written:\n' +
        productionGate.problems.map((p) => `    ✗ ${p}`).join('\n'),
    );
  }
}

const target = targetFlag === 'pglite' ? await openPgliteTarget(stateDir) : await openLiveTarget(envName);

/** @type {{ mode: string, target: string, dir: string, directoryProblems: any[], ledger: any, comparison: any, order: any, applied: any[], report: any }} */
const result = {
  mode,
  dryRun,
  target: target.label,
  identity: target.identity,
  dir,
  directoryProblems: directory.problems,
  files: directory.entries.map((e) => ({
    version: e.version,
    filename: e.filename,
    bytes: e.bytes,
    sha256: e.sha256,
  })),
};
reportResult = result;

const ledger = await readLedger(target);
result.ledger = {
  present: ledger.present,
  rows: ledger.rows.length,
  hasFileTable: ledger.hasFileTable,
  entries: ledger.rows.map((r) => ({
    version: r.version,
    name: r.name ?? null,
    sha256: r.sha256 ?? null,
    source: r.source ?? null,
  })),
};

const comparison = compareWithLedger(directory, ledger.rows, ledger.divergences);
const pendingVersions = comparison.pending.map((e) => e.version);
const order = orderHazards(directory, ledger.rows, pendingVersions);
const allowlistAudit = allowedLedgerOnly
  ? ledgerOnlyAudit(comparison.ledgerOnly, allowedLedgerOnly)
  : null;
const ledgerOnlyForVerification = allowlistAudit
  ? comparison.ledgerOnly.filter((row) => allowlistAudit.unlisted.includes(String(row.version)))
  : comparison.ledgerOnly;

const existsInFiles = new Set(ledger.rows.filter((r) => r.sha256 != null).map((r) => String(r.version)));
const unattested = ledger.rows
  .filter((r) => !existsInFiles.has(String(r.version)) && directory.entries.some((e) => e.version === String(r.version)))
  .map((r) => ({ version: String(r.version), name: r.name ?? null }));

result.comparison = {
  pending: comparison.pending.map((e) => `${e.version} ${e.filename}`),
  ledgerOnly: comparison.ledgerOnly.map((r) => `${r.version} ${r.name ?? ''}`.trim()),
  ledgerOnlyAllowed: allowlistAudit?.allowed ?? [],
  ledgerOnlyUnlisted: allowlistAudit?.unlisted ?? [],
  ledgerOnlyAllowlistStale: allowlistAudit?.stale ?? [],
  changed: comparison.changed.map((c) => `${c.version} ${c.filename}`),
  reconciled: comparison.reconciled.map((r) => `${r.recorded} -> ${r.satisfiedBy}`),
  diverged: comparison.diverged.map((d) => `${d.version} ${d.kind} ${d.filename}`),
  staleDivergences: comparison.staleDivergences.map((d) => `${d.version} ${d.why}`),
  unattested: unattested.map((r) => `${r.version} ${r.name ?? ''}`.trim()),
  order,
};

// ── Report the state ────────────────────────────────────────────────────────────────────────
console.log(`\nMigration ledger — ${mode}${dryRun && mode !== 'status' && mode !== 'verify' ? ' (dry run)' : ''}`);
console.log(`  Target:     ${target.label}`);
console.log(`  Cluster:    ${target.identity.clusterId ?? 'unavailable'}`);
console.log(`  Directory:  ${dir}`);
console.log(`  Files:      ${directory.entries.length}${directory.entries.length ? `, newest ${directory.entries[directory.entries.length - 1].version}` : ''}`);
console.log(`  Ledger:     ${ledger.present ? `${ledger.rows.length} row(s) in schema_migrations${ledger.hasFileTable ? ' (+ file hashes)' : ' (no file hashes recorded)'}` : 'absent — nothing has ever been recorded here'}`);

if (directory.problems.length) {
  console.log(`\n  Directory problems: ${directory.problems.length}`);
  for (const problem of directory.problems) console.log(`    ✗ [${problem.kind}] ${problem.detail}`);
}
const differences = [
  ['pending (in the directory, not recorded)', result.comparison.pending],
  [
    allowlistAudit ? 'ledger-only (recorded, no file; NOT in the reviewed allowlist)' : 'ledger-only (recorded, no file)',
    ledgerOnlyForVerification.map((r) => `${r.version} ${r.name ?? ''}`.trim()),
  ],
  ['allowlist entries that are no longer QA-only', allowlistAudit?.stale ?? []],
  ['changed after it was applied', result.comparison.changed],
  ['recorded without a hash', result.comparison.unattested],
  ['reconciled old version names', result.comparison.reconciled],
  ['divergence records that no longer describe this pair of files', result.comparison.staleDivergences],
];
const totalDifferences = differences.reduce((sum, [, list]) => sum + list.length, 0);
if (totalDifferences) {
  console.log('');
  for (const [label, list] of differences) {
    if (!list.length) continue;
    console.log(`  ${label}: ${list.length}`);
    for (const item of list.slice(0, 25)) console.log(`    ${item}`);
    if (list.length > 25) console.log(`    … and ${list.length - 25} more`);
  }
}
// Named, never silent: a divergence is a measured fact with a reason, and it is printed on every
// run so nobody has to remember that it exists.
if (comparison.diverged.length) {
  console.log(`\n  DIVERGED — recorded in the ledger, with a reason (${comparison.diverged.length}):`);
  for (const d of comparison.diverged) {
    console.log(`    ${d.version} ${d.kind} (${d.filename})`);
    console.log(`      ${d.reason}`);
  }
}
if (order.hazards.length) {
  console.log(`\n  ORDER HAZARD: ${order.hazards.length} pending file(s) sort before the newest recorded version (${order.highestRecorded}):`);
  for (const hazard of order.hazards.slice(0, 25)) console.log(`    ${hazard}`);
}
if (allowlistAudit) {
  console.log(`\n  QA-AHEAD ALLOWLIST: ${allowlistAudit.allowed.length} reviewed ledger-only version(s) accepted; ${allowlistAudit.unlisted.length} unlisted, ${allowlistAudit.stale.length} stale.`);
  if (allowlistAudit.allowed.length) console.log(`    ${allowlistAudit.allowed.join(', ')}`);
}
if (!directory.problems.length && !totalDifferences && !order.hazards.length) {
  console.log('\n  Directory and ledger agree at every candidate file: every file recorded, every hash matches; QA-only rows are covered by the reviewed allowlist.');
}

let exitCode = 0;
if (mode === 'verify') {
  const problems = directory.problems.length + totalDifferences + order.hazards.length;
  console.log(`\n  VERIFY: ${problems ? `FAIL — ${problems} problem(s)` : 'PASS'}`);
  exitCode = problems ? 1 : 0;
} else if (mode === 'status') {
  exitCode = 0;
} else if (mode === 'adopt') {
  exitCode = await runAdopt();
} else if (mode === 'apply') {
  exitCode = productionGate ? await runProductionApply() : await runApply();
} else if (mode === 'reconcile') {
  exitCode = await runReconcile();
} else if (mode === 'diverge') {
  exitCode = await runDiverge();
}

async function runAdopt() {
  const attest = flag('attest');
  const newest = directory.entries[directory.entries.length - 1]?.version ?? null;
  if (directory.problems.length) return fail('the directory breaks its own grammar; fix it before adopting.');
  if (target.kind !== 'postgres') return fail('adopt records history for a live environment; --target pglite has none to adopt.');
  if (!attest) return fail('adopt requires --attest <newest-version>: name the newest migration you are claiming this database already has.');
  if (attest.replace(/^0+/, '') !== String(newest).replace(/^0+/, '')) {
    return fail(`--attest ${attest} does not match the newest file in the directory (${newest}). Nothing was written.`);
  }
  if (order.hazards.length) return fail(`refusing to adopt with an order hazard present: ${order.hazards.slice(0, 5).join(', ')}`);

  const nameConflicts = [];
  for (const entry of directory.entries) {
    const row = ledger.rows.find((r) => String(r.version) === entry.version && r.name != null);
    if (row && row.name !== entry.name) {
      nameConflicts.push(`${entry.version}: ledger says "${row.name}", file is "${entry.name}"`);
    }
  }
  if (nameConflicts.length) {
    console.log(`\n  NAME CONFLICTS (${nameConflicts.length}) — a recorded name differs from the file:`);
    for (const conflict of nameConflicts.slice(0, 10)) console.log(`    ${conflict}`);
    return fail('resolve the name conflicts before adopting; a version that means two things cannot be trusted.');
  }

  const toRecord = directory.entries.filter((entry) => {
    const row = ledger.rows.find((r) => String(r.version) === entry.version);
    return !row || row.sha256 == null;
  });

  console.log(`\n  Adoption: ${toRecord.length} of ${directory.entries.length} file(s) need a ledger row or a hash.`);
  const evidence = [];
  let unconfirmedFiles = 0;
  let uncheckableFiles = 0;
  for (const entry of toRecord) {
    const found = dryRun ? { declared: 0, confirmed: 0, missing: [], skipped: true } : await evidenceFor(target, entry);
    if (!dryRun) {
      if (found.declared === 0) uncheckableFiles++;
      else if (found.missing.length) unconfirmedFiles++;
    }
    evidence.push({ version: entry.version, filename: entry.filename, ...found });
  }

  if (!dryRun) {
    console.log(
      `  Object evidence: ${toRecord.length - uncheckableFiles - unconfirmedFiles} confirmed, ` +
        `${unconfirmedFiles} with unconfirmed objects, ${uncheckableFiles} with no declarable objects`,
    );
    for (const item of evidence.filter((e) => e.missing?.length)) {
      console.log(`    · ${item.version} ${item.filename}: ${item.missing.length}/${item.declared} declared object(s) not found (${item.missing.slice(0, 3).join(', ')}${item.missing.length > 3 ? ', …' : ''})`);
    }
  }

  if (dryRun) {
    console.log('  Nothing was written. Re-run with --apply to record them (source = adopted).');
    console.log('  Adoption records what the directory already contains; it does NOT prove each file ran.');
    return 0;
  }

  await ensureLedger(target);
  let recorded = 0;
  await target.exec('begin');
  try {
    for (const entry of directory.entries) {
      await target.query(
        `insert into supabase_migrations.schema_migrations (version, name, statements)
         values ($1, $2, $3)
         on conflict (version) do nothing`,
        [entry.version, entry.name, splitStatements(entry.body)],
      );
      await target.query(
        `insert into supabase_migrations.schema_migration_files
           (version, filename, sha256, bytes, source, applied_at)
         values ($1, $2, $3, $4, 'adopted', now())
         on conflict (version) do update set
           filename = excluded.filename, sha256 = excluded.sha256, bytes = excluded.bytes,
           source = case when supabase_migrations.schema_migration_files.source = 'applied'
                         then 'applied' else 'adopted' end`,
        [entry.version, entry.filename, entry.sha256, entry.bytes],
      );
      recorded++;
    }
    await target.exec('commit');
  } catch (error) {
    await target.exec('rollback');
    return fail(`adoption failed and was rolled back — nothing was recorded: ${error.message.split('\n')[0]}`);
  }

  console.log(`  Recorded: ${recorded} file(s) adopted into the ledger.`);
  return 0;
}

async function runApply() {
  if (directory.problems.length) return fail('the directory breaks its own grammar; nothing was applied.');
  if (order.hazards.length) {
    refuse(
      `refusing to apply out of order: ${order.hazards.join(', ')} sort before the newest recorded ` +
        `version (${order.highestRecorded}). Applying them would rewrite history; normalise the ` +
        `filenames or resolve the difference with the owner first.`,
    );
  }
  if (!comparison.pending.length) {
    console.log('\n  Nothing to apply: every file in the directory is recorded.');
    return 0;
  }
  if (unattested.length) {
    return fail(
      `${unattested.length} recorded row(s) carry no hash — run \`adopt --apply\` first so the ` +
        `record is complete before new files are applied.`,
    );
  }

  console.log(`\n  Pending: ${comparison.pending.length} file(s)`);
  for (const entry of comparison.pending) console.log(`    ${entry.version} ${entry.filename}`);
  if (dryRun) {
    console.log('  Nothing was applied. Re-run with --apply to apply them.');
    return 0;
  }

  await ensureLedger(target);
  const applied = [];
  for (const entry of comparison.pending) {
    const outcome = await applyOne(target, entry);
    if (!outcome.ok) {
      // The failure report carries the rollback's own evidence: the ledger must have no row for the
      // failed version, and the objects the file declared must not exist. Both are read back from
      // this same process and this same database, after the rollback — the only way to show that a
      // half-applied file left nothing behind.
      const declared = declaredObjects(entry.body);
      const objectsAfterRollback = [];
      for (const table of declared.tables) {
        const present = (await target.query(`select to_regclass($1) as t`, [`public.${table}`])).rows[0].t;
        objectsAfterRollback.push({ kind: 'table', name: table, present: Boolean(present) });
      }
      for (const view of declared.views) {
        const present = (await target.query(`select to_regclass($1) as t`, [`public.${view}`])).rows[0].t;
        objectsAfterRollback.push({ kind: 'view', name: view, present: Boolean(present) });
      }
      for (const fn of declared.functions) {
        const present = (
          await target.query(
            `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = $1 limit 1`,
            [fn],
          )
        ).rows.length;
        objectsAfterRollback.push({ kind: 'function', name: fn, present: Boolean(present) });
      }
      const ledgerRowPresent = ledger.present
        ? (
            await target.query(
              `select 1 from supabase_migrations.schema_migrations where version = $1`,
              [entry.version],
            )
          ).rows.length > 0
        : false;
      applied.push({ version: entry.version, filename: entry.filename, ok: false, error: outcome.error });
      result.applied = applied;
      result.failed = {
        version: entry.version,
        filename: entry.filename,
        error: outcome.error,
        ledgerRowPresentAfterRollback: ledgerRowPresent,
        objectsPresentAfterRollback: objectsAfterRollback.filter((o) => o.present),
        objectsDeclared: objectsAfterRollback.length,
      };
      console.log(
        `    ✗ ${entry.version} ${entry.filename} failed and was rolled back: ${outcome.error}`,
      );
      console.log(
        `      after rollback: ledger row = ${ledgerRowPresent ? 'PRESENT (wrong)' : 'absent'}, ` +
          `declared objects present = ${result.failed.objectsPresentAfterRollback.length}/${objectsAfterRollback.length}`,
      );
      return fail(
        `${entry.filename} failed and was rolled back (no ledger row). ` +
          `Applied before it in this run: ${applied.filter((a) => a.ok).map((a) => a.version).join(', ') || 'none'}. ` +
          `Database said: ${outcome.error}`,
      );
    }
    applied.push({ version: entry.version, filename: entry.filename, ok: true, statements: outcome.statements });
    console.log(`    ✓ ${entry.version} ${entry.filename} (${outcome.statements} statement(s), recorded)`);
  }
}

/** The objects a file declared, read back after its transaction rolled back. */
async function objectsPresentAfterRollback(target, entry) {
  const declared = declaredObjects(entry.body);
  const present = [];
  for (const table of declared.tables) {
    const found = (await target.query(`select to_regclass($1) as t`, [`public.${table}`])).rows[0].t;
    if (found) present.push(`table ${table}`);
  }
  for (const view of declared.views) {
    const found = (await target.query(`select to_regclass($1) as t`, [`public.${view}`])).rows[0].t;
    if (found) present.push(`view ${view}`);
  }
  for (const fn of declared.functions) {
    const found = (
      await target.query(
        `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`,
        [fn],
      )
    ).rows.length;
    if (found) present.push(`function ${fn}`);
  }
  return {
    declared: declared.tables.length + declared.views.length + declared.functions.length + declared.columns.length,
    present,
  };
}

/**
 * Apply a batch inside a transaction that is ALWAYS rolled back, and compare the data on both sides.
 *
 * This is the only way to know what a migration does to rows *before* it does it for real. The batch
 * is executed against production inside `BEGIN … ROLLBACK`, the protected tables are fingerprinted
 * on both sides of that transaction, and any table that moved without being named in `--data-change`
 * stops the run with production untouched. An additive column is invisible here by construction (the
 * digest is taken over the columns that existed before), so a safe schema change is not refused for
 * looking different.
 */
async function rehearseBatch(entries, approvedTables) {
  return rehearseBatchData({
    target,
    entries,
    approvedTables,
    readFile: (entry) => fs.readFileSync(path.join(dir, entry.filename), 'utf8'),
  });
}

/**
 * `apply --env production` — the single exception to the blanket refusal, and the only code path in
 * this repository that writes to production.
 *
 * The gate was already run before the connection; it runs again here with the ledger in hand, because
 * "already applied" is only knowable over a connection and a file recorded under a different hash must
 * stop the run rather than be applied twice. Everything else is the same contract as staging: one
 * transaction per file, containing the file AND its ledger rows, in the verified order.
 *
 * Nothing is replayed: only the named batch is considered, and only the part of it production has not
 * recorded. 0017-0176 are never named at all (the gate refuses them), so production's schema keeps
 * whatever its out-of-band setup created for them.
 */
async function runProductionApply() {
  if (directory.problems.length) return fail('the directory breaks its own grammar; nothing was applied.');

  const gate = gateProductionBatch({ ledgerRows: ledger.rows });
  result.gate = gate.context;
  if (!gate.ok) {
    return fail(
      'the production gate did not pass with production\'s ledger in hand:\n' +
        gate.problems.map((p) => `    ✗ ${p}`).join('\n'),
    );
  }
  if (!gate.toApply.length) {
    console.log(
      `\n  Nothing to apply: all ${gate.alreadyRecorded.length} file(s) in the batch are already recorded, ` +
        'with hashes matching the files on disk.',
    );
    return 0;
  }

  console.log(`\n  Batch: ${gate.toApply.length} file(s) to apply, in this order`);
  for (const entry of gate.toApply) console.log(`    ${entry.version} ${entry.filename}`);
  if (gate.alreadyRecorded.length) {
    console.log(`  Already recorded (not re-applied): ${gate.alreadyRecorded.map((e) => e.version).join(', ')}`);
  }

  if (dryRun) {
    console.log(
      '\n  DRY RUN — nothing was written and production was only read (the ledger).\n' +
        '  Re-run the same command with --apply to apply the batch.',
    );
    return 0;
  }

  const approvals = parseApprovals(flag('data-change'));
  if (approvals.unknown.length) {
    return fail(
      `--data-change names table(s) this tool does not protect: ${approvals.unknown.join(', ')}. ` +
        'Names are checked so a typo cannot silently approve the wrong table. Nothing was written.',
    );
  }

  console.log('\n  Rehearsing the batch against production inside a transaction that will be rolled back…');
  const rehearsal = await rehearseBatch(gate.toApply, approvals.names);
  result.rehearsal = {
    ok: false,
    approvedTables: approvals.names,
    error: rehearsal.error,
    changed: rehearsal.diff?.changed ?? [],
    allowedChanges: rehearsal.diff?.allowedChanges ?? [],
    unexpected: rehearsal.diff?.unexpected ?? [],
    before: rehearsal.before,
    after: rehearsal.after,
  };

  if (rehearsal.error) {
    return fail(
      `the batch could not be rehearsed, so its effect on data is unknown: ${rehearsal.error}\n` +
        '  Nothing was written (the rehearsal was rolled back). Fix the statement before applying.',
    );
  }
  if (!rehearsal.diff.ok) {
    return fail(
      'the batch changes rows it was not approved to change. Production was NOT written; the rehearsal\n' +
        '  was rolled back. Per-table movement:\n' +
        describeFingerprints(rehearsal.before, rehearsal.after)
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n') +
        '\n  If this change is intended, name exactly the tables it may touch:\n' +
        `    --data-change ${rehearsal.diff.unexpected.join(',')}\n` +
        '  Anything not named must move by zero rows.',
    );
  }
  result.rehearsal.ok = true;
  console.log(
    `    rehearsal holds: ${Object.values(rehearsal.before).filter((f) => f.count !== null).length} table(s) fingerprinted, ` +
      '0 unexpected row changes' +
      (rehearsal.diff.allowedChanges.length ? `, approved changes: ${rehearsal.diff.allowedChanges.join(', ')}` : ''),
  );

  await ensureLedger(target);
  const applied = [];
  for (const entry of gate.toApply) {
    // The gate hands back directory entries (version/name/hash/mtime) — the SQL itself is read here,
    // from the very file the gate verified. Without this the splitter receives `undefined`, which is
    // exactly how the first attempt to apply this batch to production ended: gate PASS, then a crash
    // before a single statement ran.
    const outcome = await applyOne(target, {
      ...entry,
      body: fs.readFileSync(path.join(dir, entry.filename), 'utf8'),
    });
    if (!outcome.ok) {
      const after = await objectsPresentAfterRollback(target, entry);
      const ledgerRowPresent =
        (
          await target.query(`select 1 from supabase_migrations.schema_migrations where version = $1`, [entry.version])
        ).rows.length > 0;
      applied.push({ version: entry.version, filename: entry.filename, ok: false, error: outcome.error });
      result.applied = applied;
      result.failed = {
        version: entry.version,
        filename: entry.filename,
        error: outcome.error,
        ledgerRowPresentAfterRollback: ledgerRowPresent,
        objectsPresentAfterRollback: after.present,
        objectsDeclared: after.declared,
      };
      console.log(`    ✗ ${entry.version} ${entry.filename} failed and was rolled back: ${outcome.error}`);
      console.log(
        `      after rollback: ledger row = ${ledgerRowPresent ? 'PRESENT (wrong)' : 'absent'}, ` +
          `declared objects present = ${after.present.length}/${after.declared}`,
      );
      return fail(
        `${entry.filename} failed and was rolled back (no ledger row). ` +
          `Applied before it in this run: ${applied.filter((a) => a.ok).map((a) => a.version).join(', ') || 'none'}. ` +
          `Production said: ${outcome.error}\n` +
          '  The batch is resumable: re-running it skips what is recorded and continues from here.',
      );
    }
    applied.push({ version: entry.version, filename: entry.filename, ok: true, statements: outcome.statements });
    console.log(`    ✓ ${entry.version} ${entry.filename} (${outcome.statements} statement(s), recorded)`);
  }
  result.applied = applied;

  // Read production's own ledger back. The mode exists so that what production has and what the
  // repository says production has are the same fact, so the check is not optional.
  const after = await readLedger(target);
  const unrecorded = gate.toApply.filter(
    (entry) => !after.rows.some((row) => String(row.version) === entry.version),
  );
  result.ledgerAfter = {
    rows: after.rows.length,
    latest: after.rows.length ? String(after.rows[after.rows.length - 1].version) : null,
  };
  console.log(
    `\n  Applied ${applied.length} file(s), each with its ledger rows in the same transaction.`,
  );
  console.log(`  Production's ledger now: ${after.rows.length} row(s), latest ${result.ledgerAfter.latest}`);
  if (unrecorded.length) {
    return fail(
      `the ledger has no row for ${unrecorded.map((e) => e.version).join(', ')} — the files ran but production ` +
        'does not record them, which is exactly the state this tool exists to prevent.',
    );
  }

  // The rehearsal predicted the row-level effect; this checks that what committed is that effect and
  // not something the rehearsal could not see (a trigger firing only outside a rolled-back block, a
  // sequence that advanced, an ON CONFLICT path taken differently).
  const appliedFingerprints = await fingerprintDatabase((sql, params = []) => target.query(sql, params), {
    previous: rehearsal.before,
  });
  const drift = diffFingerprints(rehearsal.after, appliedFingerprints, []);
  result.dataAfterApply = { matchesRehearsal: drift.ok, changed: drift.changed, missing: drift.missing };
  if (!drift.ok) {
    console.log(describeFingerprints(rehearsal.after, appliedFingerprints));
    return fail(
      'the applied batch changed rows differently from its rehearsal: ' +
        `${[...new Set([...drift.changed, ...drift.missing])].join(', ')}. The batch is recorded and applied; ` +
        'this is a data-integrity alarm, not a retry. Compare the two fingerprints in the report before touching production again.',
    );
  }
  console.log(
    '  Data after apply matches the rehearsal exactly: every protected table is where the rehearsal said it would be.',
  );
  return 0;
}

await target.close();

writeReport(exitCode);

process.exit(exitCode);
