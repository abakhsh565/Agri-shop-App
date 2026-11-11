#!/usr/bin/env node
/**
 * build-local-ci-baseline.mjs — build the committed local-CI baseline.
 *
 * WHAT IT DOES
 *   Reads the production dump (gitignored `backups/`, the current production
 *   baseline artifact), sanitizes it through `scripts/lib/local-ci-baseline.mjs`
 *   (schema kept whole, reference rows only, everything personal or secret
 *   left out), appends the RBAC supplement, and writes the committed
 *   artifact plus its record:
 *
 *     supabase/baseline/local-ci-baseline.sql
 *     supabase/baseline/local-ci-baseline.json
 *
 * The artifact is what `local-db init --baseline local-ci` restores on the
 * GitHub runner, where no staging dump exists and no hosted database may be
 * reached. CI reads the committed files; it never runs this script.
 *
 * WHEN TO RE-RUN IT
 *   When production receives migrations beyond 0305. The forward set in the
 *   record already covers 0233-0302 + 0305, so a new production migration is
 *   the only thing that makes the artifact stale. Re-run against a fresh
 *   production dump and commit the regenerated pair together.
 *
 * WHAT IT REFUSES
 *   * A dump that is not under gitignored `backups/` (the source must be the
 *     captured artifact, never a file from the committed tree).
 *   * A sanitization that reports any problem — a changed reference-row
 *     count, a surviving fixture identity, a surviving row block outside the
 *     allowlist. The build fails instead of writing a wrong artifact.
 *
 * Usage:
 *   node scripts/dev/build-local-ci-baseline.mjs [--dump <path>] [--out <path>] [--record <path>]
 *   Defaults: the 2026-11-10 production dump, the local-ci artifact and record.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/environments.mjs';
import { sanitizeDump, measureStructure } from '../lib/local-ci-baseline.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const token = args[index];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[index + 1] ?? fallback;
};

const DUMP = flag('dump', 'backups/backup-production-gkswcfljxlutkfdvvqng-2026-11-10T01-28-00.sql');
const SUPPLEMENT = flag('supplement', 'supabase/baseline/local-ci-supplement.sql');
const OUT = flag('out', 'supabase/baseline/local-ci-baseline.sql');
const RECORD = flag('record', 'supabase/baseline/local-ci-baseline.json');

function refuse(message) {
  console.error(`\n[LOCAL-CI BASELINE REFUSED] ${message}\n`);
  process.exit(2);
}

const dumpPath = path.join(ROOT, DUMP);
if (!DUMP.startsWith('backups/')) {
  refuse(`the source dump must live under gitignored backups/; got ${DUMP}.`);
}
if (!fs.existsSync(dumpPath)) {
  refuse(
    `the source dump is not in this checkout: ${DUMP}\n` +
      `  It is the production baseline artifact (gitignored backups/). Re-run where it exists.`,
  );
}
const supplementPath = path.join(ROOT, SUPPLEMENT);
if (!fs.existsSync(supplementPath)) refuse(`the supplement is missing: ${SUPPLEMENT}`);

const dumpText = fs.readFileSync(dumpPath, 'utf8');
const dumpSha256 = crypto.createHash('sha256').update(dumpText).digest('hex');
const versionMatch = dumpText.match(/Dumped from database version (\d+\.\d+)/);
if (!versionMatch) refuse('the dump names no server version; refusing to record one.');
const capturedMatch = path.basename(DUMP).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
if (!capturedMatch) refuse(`the dump filename carries no capture timestamp: ${DUMP}`);
const [, y, mo, d, h, mi, s] = capturedMatch;
const capturedAt = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;

const { artifact, report, problems } = sanitizeDump(dumpText, fs.readFileSync(supplementPath, 'utf8'));
if (problems.length) {
  refuse(`sanitization reported ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
}
const structure = measureStructure(artifact);
if (structure.tables < 40 || structure.functions < 100 || structure.policies < 100) {
  refuse(
    `the measured structure looks wrong (tables ${structure.tables}, functions ${structure.functions}, ` +
      `policies ${structure.policies}); refusing to record it.`,
  );
}

const artifactSha256 = crypto.createHash('sha256').update(artifact).digest('hex');
const record = {
  record:
    'The sanitized production schema the local-CI job restores on the GitHub runner. ' +
    'Built from the production dump at ledger 0304: the whole schema, reference rows only ' +
    '(permissions, roles, role_permissions, app_settings, shops, branches, storage.buckets), ' +
    'plus the RBAC supplement for the surface production never received (business_areas). ' +
    'No personal data, no password hashes, no business rows — the build refuses to write ' +
    'an artifact that carries a fixture identity. CI-only; never a migrate target.',
  environment: 'local-ci',
  projectRef: 'gkswcfljxlutkfdvvqng',
  capturedAt,
  serverVersion: versionMatch[1],
  artifact: OUT,
  artifactSha256,
  artifactBytes: Buffer.byteLength(artifact, 'utf8'),
  contentType: 'logical-dump',
  dataStatements: report.dataStatements,
  dataHandling: 'reference-only',
  dataNote:
    'Only the reference rows the suite needs are restored (see the build report); ' +
    'every other row block in the source dump is left out. The build asserts the kept ' +
    'row counts exactly, so a source dump with different reference data fails loudly.',
  ledgerOnServer: {
    count: 48,
    latest: '0304',
    note: 'Production ledger at capture. Forward files 0233-0302 plus 0305 apply on top of this artifact in local-db init; that order is recorded in forwardOrder.',
  },
  structure: {
    tables: structure.tables,
    functions: structure.functions,
    views: structure.views,
    indexes: structure.indexes,
    triggers: structure.triggers,
    policies: structure.policies,
  },
  policy: {
    forwardOnly: true,
    replayHistory: 'never',
    migrateTarget: false,
    note: 'Local CI test target only. It is checked against, never written by hosted tooling; the local stack is discarded after the run.',
  },
  forwardOrder: ['0071', '0075-0078', '0305', '0233-0302'],
  forwardNote:
    'Apply order for local-db init: the test-auth helper first (0071 _test_check_auth), then the agent/impact tables (0075-0078), then 0305 (the enum labels batch 1 needs), then the production batches in version order (0233-0276, 0277-0289, 0291-0299, 0300-0302). 0070 is deliberately NOT in this order: its run_sql body is invalid PL/pgSQL (RETURN (EXECUTE ...) — EXECUTE is a statement, not an expression) and has never applied anywhere, yet it is recorded in the QA ledger with its current hash, so editing it would break migrate verify; the suite’s run_sql comes from tests/setup/create_run_sql.sql instead, applied by the local-CI job via `local-db apply` (the same file QA got by hand).',
  source: {
    dump: DUMP,
    dumpSha256,
    supplement: SUPPLEMENT,
    builder: 'scripts/dev/build-local-ci-baseline.mjs',
  },
  refresh:
    'Re-run this script against a fresh production dump when production receives migrations beyond 0305, and commit the regenerated artifact + record together.',
  recheck:
    'npm run local:db -- init --baseline local-ci --skip-verify && npm run local:db -- seed && npm run local:db -- verify --baseline local-ci',
};

fs.writeFileSync(path.join(ROOT, OUT), artifact);
fs.writeFileSync(path.join(ROOT, RECORD), `${JSON.stringify(record, null, 2)}\n`);

console.log('Local-CI baseline built');
console.log(`  source dump : ${DUMP} (sha ${dumpSha256.slice(0, 16)}…)`);
console.log(`  artifact    : ${OUT} (${report.keptStatements} statements kept, ${report.omittedDataStatements} row blocks left out)`);
console.log(`  artifact sha: ${artifactSha256.slice(0, 16)}… (${Buffer.byteLength(artifact, 'utf8')} bytes)`);
console.log(`  kept rows   : ${Object.entries(report.keptRows).map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(
  `  structure   : ${structure.tables} tables / ${structure.functions} functions / ` +
    `${structure.views.length} views / ${structure.indexes} indexes / ${structure.triggers} triggers / ${structure.policies} policies`,
);
console.log(`  record      : ${RECORD}`);
