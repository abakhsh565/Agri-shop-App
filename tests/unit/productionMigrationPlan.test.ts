/**
 * productionMigrationPlan — production cannot be planned for by accident.
 *
 * The report that opened this work: production's ledger holds 8 entries through 0016 while the
 * repository holds 198 files, so "apply the migrations" could damage data or break the app. The answer
 * is `docs/PRODUCTION_MIGRATION_PLAN.md`: what production actually has, what it can take unchanged
 * (measured, as a batch), what it cannot, and the order in which the difference closes.
 *
 * A plan like that rots in two specific ways, and this file blocks both:
 *
 *   1. **A new migration appears with no production disposition.** Every file is relevant to
 *      production the day it is written, not the day someone remembers to think about production. The
 *      first test below fails until the plan says what should happen to it.
 *   2. **A premise drifts while the plan keeps its old numbers.** The plan rests on two measured
 *      facts — production's recorded position (8 / 0016) and the batch results — plus one policy
 *      (the migration tool refuses production before connecting). Each is asserted here, so changing
 *      the baseline record or re-opening production in the tool fails the suite instead of quietly
 *      invalidating a reviewed document.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const plan = readFileSync(join(ROOT, 'docs/PRODUCTION_MIGRATION_PLAN.md'), 'utf8');
const baseline = JSON.parse(readFileSync(join(ROOT, 'supabase/baseline/production-baseline.json'), 'utf8'));
const migrateTool = readFileSync(join(ROOT, 'scripts/migrate.mjs'), 'utf8');

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const versionOf = (file: string) => file.slice(0, 4);

/** Production's recorded position, from the frozen baseline record. */
const PRODUCTION_POSITION = '0016';
/** Every file at or after the first one production has not recorded. */
const PENDING = files.filter((f) => versionOf(f) >= '0177');

/** Batch 1 as verified: `--files <these> --baseline production` → PASS, 11 files, 50 statements. */
const BATCH_1 = [
  '0179_cost_price_is_the_owner_s_business.sql',
  '0181_audit_rows_are_written_by_the_system_not_by_the_caller.sql',
  '0190_invitation_starts_in_the_selected_branch.sql',
  '0199_uploads_and_live_updates_survive_a_restore.sql',
  '0200_the_pre_login_lookup_returns_only_what_the_screen_shows.sql',
  '0201_the_pre_login_lookup_answers_for_the_number_only.sql',
  '0202_archiving_a_customer_needs_the_delete_permission.sql',
  '0203_client_errors_are_write_only_and_environment_tagged.sql',
  '0204_error_records_are_pruned_by_an_authorized_function_only.sql',
  '0205_the_error_insert_policy_is_not_a_permissive_true.sql',
  '0206_a_view_is_not_a_boundary.sql',
];

describe('every pending migration has exactly one production disposition', () => {
  test('the plan is not empty and covers the range it claims', () => {
    expect(PENDING.length, 'no migration files at or after 0177 — the parse is stale').toBeGreaterThanOrEqual(25);
    expect(plan).toMatch(/## 5\. Disposition of every file/);
  });

  test('each file at or after 0177 appears exactly once in the plan', () => {
    const missing: string[] = [];
    const duplicated: string[] = [];
    for (const file of PENDING) {
      const hits = plan.split(file).length - 1;
      if (hits === 0) missing.push(file);
      if (hits > 1) duplicated.push(`${file} (×${hits})`);
    }
    expect(
      missing,
      'A migration file added since this plan was written has no production disposition. Decide what ' +
        'production should do with it (batch, gap migration, production-shaped variant, or "not ' +
        'applicable") and record it in docs/PRODUCTION_MIGRATION_PLAN.md §5.',
    ).toEqual([]);
    expect(duplicated, 'a file is classed twice, so the plan contradicts itself:').toEqual([]);
  });

  test('nothing before production’s recorded position is quietly re-planned as replayable', () => {
    // 0017–0176 are the files whose intent production already holds from its out-of-band setup. The
    // plan may name the range, but no individual pre-0177 file may be given a batch.
    const prePosition = files.filter((f) => versionOf(f) < '0177');
    for (const file of prePosition) {
      expect(plan.split(file).length - 1, `${file} is pre-position and must not be scheduled`).toBe(0);
    }
  });
});

describe('batch 1 is the batch that was actually verified', () => {
  test('the plan names exactly the 11 verified files, each marked verified', () => {
    const rows = plan
      .split('\n')
      .filter((line) => line.includes('batch 1 — verified PASS'));
    const named = rows.map((line) => line.match(/`([^`]+\.sql)`/)?.[1]).filter(Boolean) as string[];
    expect(named.sort()).toEqual([...BATCH_1].sort());
  });

  test('every file it schedules exists on disk', () => {
    for (const file of BATCH_1) {
      expect(files, `${file} is scheduled but no longer exists`).toContain(file);
    }
  });

  test('the plan carries the measured results rather than a summary of them', () => {
    // The whole-range FAIL and the batch PASS as the verifier printed them. If a batch result is
    // re-measured, these numbers change with it — they cannot be edited to look better.
    expect(plan, 'the 30-file measurement is not quoted as measured').toContain('30 files, 275 statements, 106 sql failures');
    expect(plan, 'the batch-1 result is not quoted as measured').toContain('11 files,  50 statements,   0 sql failures');
    expect(plan, 'the batch-order trap that changed the method is not recorded').toContain('0193');
    expect(plan).toMatch(/column "tenant_id" does not exist/);
  });
});

describe('the plan’s premises cannot drift unnoticed', () => {
  test('production’s recorded position is still what the plan says it is', () => {
    expect(
      baseline.ledgerOnServer.latest,
      'the production baseline record moved. The plan’s whole shape depends on where production is; ' +
        're-derive §§1–2 and update docs/PRODUCTION_MIGRATION_PLAN.md before changing this record.',
    ).toBe(PRODUCTION_POSITION);
    expect(plan).toContain('8 rows, latest `0016`');
  });

  test('the tool still refuses production before connecting, except for a named, gated batch', () => {
    // If this refusal is removed without the §7 decision, production has become an ordinary target of
    // a tool that can also replay history — the one thing the strategy forbids. Asserted by RUNNING
    // the tool, not by reading it: each case below must exit 2 and must say so, and this suite has no
    // production credentials in its environment, so a refusal that happened after connecting would
    // fail here instead of passing.
    expect(migrateTool).toContain('production is not a target of this tool');
    const refused: string[][] = [
      ['status', '--env', 'production'],
      ['verify', '--env', 'production'],
      ['adopt', '--env', 'production', '--attest', '0206', '--apply'],
      ['apply', '--env', 'production'], // no batch named
      ['apply', '--env', 'production', '--files', BATCH_1[0]], // named, but unverified and unbacked
    ];
    for (const args of refused) {
      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/migrate.mjs'), ...args], { encoding: 'utf8' });
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status, `${args.join(' ')} should be refused (exit 2):\n${output}`).toBe(2);
      expect(output, `${args.join(' ')} was refused for an unexpected reason:\n${output}`).toMatch(
        /not a target of this tool|gate did not pass/,
      );
      // The refusal must happen before any credential is resolved: a missing-secret error here would
      // mean the tool reached for production first and only then objected.
      expect(output).not.toMatch(/must be set|is not set|PROD_DB_PASS/);
    }
    expect(plan, 'the owner decision the refusal creates is not recorded').toContain('## 7. The one decision the owner must make');
  });

  test('the gate runs before a connection, and its rules are where the plan says they are', () => {
    const gate = readFileSync(join(ROOT, 'scripts/lib/production-batch-gate.mjs'), 'utf8');
    expect(gate).toContain('export function productionBatchGate');
    // No socket, no credentials, no clock of its own: the purity is what makes the rule set testable
    // without production, and it is what lets migrate.mjs refuse before it resolves anything.
    expect(gate, 'the gate must not read credentials').not.toMatch(/resolveCredentials|process\.env/);
    expect(gate, 'the gate must take the clock as a parameter').toMatch(/now,/);
    expect(gate, 'the gate must open nothing').not.toMatch(/new pg\.|Client\(|fetch\(/);
    // And the tool must run it before it opens the target.
    const gateCall = migrateTool.indexOf('productionGate = gateProductionBatch()');
    const connection = migrateTool.indexOf('await openLiveTarget(envName)');
    expect(gateCall, 'migrate.mjs no longer runs the production gate').toBeGreaterThan(0);
    expect(gateCall, 'the gate must be checked before the target is opened').toBeLessThan(connection);
  });

  test('the plan still says nothing has been applied', () => {
    expect(plan).toMatch(/NOTHING HAS BEEN APPLIED/);
    expect(plan, 'the approval gate disappeared').toContain('## 8. Approval gate and preconditions');
  });
});

// ── the real-engine rehearsal, and the harness that performs it ───────────────────────────────
describe('the rehearsal harness refuses before it touches anything', () => {
  /**
   * The harness loads a baseline into a real Supabase engine, so its refusals are the thing standing
   * between a rehearsal and an accident. These three checks need no Docker precisely because they run
   * before the engine is looked for — which is also what makes them testable in CI.
   */
  const HARNESS = join(ROOT, 'scripts/dev/rehearse-on-local-engine.mjs');
  const runHarness = (args: string[]) => spawnSync(process.execPath, [HARNESS, ...args], { encoding: 'utf8' });

  test('nothing named → refused before any engine work', () => {
    const result = runHarness([]);
    expect(result.status, `expected a refusal, got:\n${result.stdout}${result.stderr}`).toBe(2);
    expect(result.stderr).toMatch(/REFUSED: name a baseline/);
  });

  test('a database that is not named rehearsal_* → refused', () => {
    const result = runHarness(['--baseline', 'production', '--since', '0177', '--db', 'postgres']);
    expect(result.status, `expected a refusal, got:\n${result.stdout}${result.stderr}`).toBe(2);
    expect(result.stderr).toMatch(/must be named rehearsal_/);
  });

  test('--since and --files together → refused', () => {
    const result = runHarness(['--baseline', 'production', '--since', '0177', '--files', 'a.sql']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/exactly one of/);
  });

  test('the harness carries the baseline record\'s own preconditions', () => {
    const source = readFileSync(HARNESS, 'utf8');
    // The sha256/byte check: a rehearsal must not run against an artifact whose record has drifted.
    expect(source).toMatch(/artifact sha256 mismatch/);
    expect(source).toMatch(/artifact length mismatch/);
    // Production rows are counted and never applied — asserted in the report it writes.
    expect(source).toContain('isDataStatement(');
    expect(source).toContain('dataStatementsApplied: 0');
    // The defect that made the first version unable to fail: stdout-only capture misses psql errors.
    // It may be NAMED in the comment that records the defect; it must not be imported or called.
    expect(source, 'stdout-only capture would score every failing statement as a success').toContain("stdio: ['pipe', 'pipe', 'pipe']");
    expect(source, 'execFileSync returns stdout only — psql reports errors on stderr').not.toMatch(/execFileSync\s*\(/);
    expect(source).not.toMatch(/import\s*\{[^}]*execFileSync[^}]*\}\s*from/);
    expect(source, 'the harness must capture both streams').toMatch(/import \{ spawnSync \} from 'node:child_process'/);
  });

  test('the documented entry point exists', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(packageJson.scripts['rehearse:engine']).toBe('node scripts/dev/rehearse-on-local-engine.mjs');
  });
});

describe('the rehearsal result is recorded, on both sides', () => {
  const evidence = readFileSync(join(ROOT, 'device-evidence/production-schema-reconciliation-2026-10-16.md'), 'utf8');

  test('the plan states the real-engine result and what it still does not cover', () => {
    expect(plan).toMatch(/rehearsed on a real Supabase engine/);
    expect(plan, 'the PGlite comparison result is not recorded').toMatch(/AGREES/);
    expect(plan, 'the hosted-platform limits were dropped').toMatch(/Supavisor/);
  });

  test('the evidence record carries the engine, the data refusal and the comparison', () => {
    expect(evidence).toMatch(/Postgres 17\.6/);
    expect(evidence).toMatch(/268 data statements counted, 0 applied/);
    expect(evidence).toMatch(/AGREES/);
    // The harness defect is recorded rather than quietly fixed: a PASS from a harness that could not
    // fail is not evidence, and that is worth a line in the record.
    expect(evidence).toMatch(/stdout only/);
    expect(evidence).toMatch(/exit 1/);
  });
});
