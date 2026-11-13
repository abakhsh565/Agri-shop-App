/**
 * migrationOutOfOrderOverride — the one-time, reviewed exception to the order rule.
 *
 * The defect this guards is the Phase 2 deadlock (2026-11-06): the release/merge migrations
 * 0277-0289 are new files that sort before the already-recorded 0299, because the two branches
 * numbered independently. `scripts/migrate.mjs` refused to apply them — correctly, by default —
 * but there was no sanctioned path forward at all: the branch CI fails at the ledger step until
 * they are applied, and they could not be applied through the normal path.
 *
 * The exception is narrow on purpose, and this file asserts every side of it by RUNNING the tool
 * against a throwaway PGlite database (state kept on disk so one run sees what the last recorded):
 *
 *   - without the flag, an out-of-order apply is still refused (exit 2) and nothing is recorded;
 *   - with `--allow-out-of-order "<reason>"`, the same apply succeeds and a later verify passes;
 *   - verify honours the flag too (the workflow verifies before it applies);
 *   - the flag needs a non-empty reason, only applies to verify/apply, and is never valid for
 *     production — each of those is refused before anything is read or written;
 *   - the override is recorded in the machine-readable report, so the run log is not the only
 *     place the reason lives.
 *
 * The hazard itself is a numbering artifact here, not a rewrite: the 0291-0299 batch does not
 * depend on 0277-0289, and the production plan puts them last anyway — so applying them after
 * 0299 matches the intended order. That is the reason the test below uses, word for word.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const TOOL = path.join(ROOT, 'scripts/migrate.mjs');
const REASON =
  'Phase 2: 0277-0289 are new files numbered before the already-recorded 0299; the 0291-0299 batch does not depend on them and the plan puts them last.';

const scratch: string[] = [];

function makeDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agrishop-override-'));
  scratch.push(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

function run(args: string[]) {
  const result = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  while (scratch.length) fs.rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** A ledger that already holds 0299, with 0277 pending in the directory — the Phase 2 shape. */
function setupHazard() {
  const migDir = makeDir({ '0299_b.sql': 'select 1;' });
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agrishop-override-state-'));
  scratch.push(stateDir);
  // `adopt` refuses a pglite target (it records history for a live environment), so the ledger
  // is seeded the ordinary way: apply the 0299 file, then add the out-of-order 0277 file.
  const seeded = run(['apply', '--target', 'pglite', '--state', stateDir, '--dir', migDir, '--apply']);
  expect(seeded.status, `seeding 0299 should apply:\n${seeded.output}`).toBe(0);
  fs.writeFileSync(path.join(migDir, '0277_a.sql'), 'select 1;');
  return { migDir, stateDir };
}

describe('the out-of-order override', () => {
  it(
    'refuses an out-of-order apply without the flag, and records nothing',
    { timeout: 60000 },
    () => {
      const { migDir, stateDir } = setupHazard();
      const refused = run([
        'apply',
        '--target',
        'pglite',
        '--state',
        stateDir,
        '--dir',
        migDir,
        '--apply',
      ]);
      expect(refused.status, `should refuse (exit 2):\n${refused.output}`).toBe(2);
      expect(refused.output).toMatch(/refusing to apply out of order: 0277/);
      const stillPending = run(['verify', '--target', 'pglite', '--state', stateDir, '--dir', migDir]);
      expect(stillPending.status, `0277 must still be pending:\n${stillPending.output}`).toBe(1);
      expect(stillPending.output).toMatch(/0277_a\.sql/);
    },
  );

  it(
    'applies with the flag and a reason, and a later verify passes without it',
    { timeout: 60000 },
    () => {
      const { migDir, stateDir } = setupHazard();
      const report = path.join(migDir, 'report.json');
      const applied = run([
        'apply',
        '--target',
        'pglite',
        '--state',
        stateDir,
        '--dir',
        migDir,
        '--apply',
        '--allow-out-of-order',
        REASON,
        '--json',
        report,
      ]);
      expect(applied.status, `should apply (exit 0):\n${applied.output}`).toBe(0);
      expect(applied.output).toMatch(/OVERRIDE in effect: applying 0277 out of order/);
      const saved = JSON.parse(fs.readFileSync(report, 'utf8'));
      expect(saved.comparison.orderOverride).toEqual({ reason: REASON, versions: ['0277'] });
      const verified = run(['verify', '--target', 'pglite', '--state', stateDir, '--dir', migDir]);
      expect(verified.status, `verify must pass once 0277 is recorded:\n${verified.output}`).toBe(0);
      expect(verified.output).toMatch(/VERIFY: PASS/);
    },
  );

  it(
    'lets verify honour the flag before anything is applied',
    { timeout: 60000 },
    () => {
      const { migDir, stateDir } = setupHazard();
      const without = run(['verify', '--target', 'pglite', '--state', stateDir, '--dir', migDir]);
      expect(without.status, `verify must fail on the hazard:\n${without.output}`).toBe(1);
      expect(without.output).toMatch(/VERIFY: FAIL — 2 problem\(s\)/);
      // Verify still fails while 0277 is pending — the flag neutralises only the ORDER HAZARD
      // (2 problems become 1), it does not pretend the file is already recorded.
      const withFlag = run([
        'verify',
        '--target',
        'pglite',
        '--state',
        stateDir,
        '--dir',
        migDir,
        '--allow-out-of-order',
        REASON,
      ]);
      expect(withFlag.status, `verify must still fail on the pending file:\n${withFlag.output}`).toBe(1);
      expect(withFlag.output).toMatch(/VERIFY: FAIL — 1 problem\(s\)/);
      expect(withFlag.output).toMatch(/OVERRIDE — applying out of order, reviewed \(1\): 0277/);
    },
  );

  it('refuses the flag without a reason, for other modes, and for production', () => {
    const { migDir, stateDir } = setupHazard();
    const noReason = run([
      'apply',
      '--target',
      'pglite',
      '--state',
      stateDir,
      '--dir',
      migDir,
      '--apply',
      '--allow-out-of-order',
      '',
    ]);
    expect(noReason.status, `empty reason should refuse (exit 2):\n${noReason.output}`).toBe(2);
    expect(noReason.output).toMatch(/needs a reason/);
    const wrongMode = run([
      'status',
      '--target',
      'pglite',
      '--state',
      stateDir,
      '--dir',
      migDir,
      '--allow-out-of-order',
      REASON,
    ]);
    expect(wrongMode.status, `status must not accept the flag:\n${wrongMode.output}`).toBe(2);
    expect(wrongMode.output).toMatch(/only applies to verify\/apply/);
    const production = run(['apply', '--env', 'production', '--allow-out-of-order', REASON]);
    expect(production.status, `production must refuse the flag:\n${production.output}`).toBe(2);
    expect(production.output).toMatch(/never valid for production/);
    expect(production.output).not.toMatch(/PROD_DB_PASS|must be set/);
  });
});
