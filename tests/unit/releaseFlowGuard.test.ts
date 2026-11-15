/**
 * releaseFlowGuard — work happens on dev, and a release proves alignment instead of asserting it.
 *
 * Two failures motivate this file.
 *
 *   1. **Work escaping the chain.** Every change is made on `dev` and promoted by pull request.
 *      Nothing is prepared, edited or verified forward from `staging` or `main`, because a release
 *      assembled at that end has already lost the branch the work was tested on. `release-prepare`
 *      refuses those branches; this test keeps that refusal real.
 *
 *   2. **"Ready" meaning the ledger moved.** On 2026-11-15 production held the repository's newest
 *      version while 30 RPCs and one table the client calls were absent: those screens answered 404
 *      and degraded, and every green signal was about history rather than the app. The gated
 *      workflow now measures the app's own objects after it writes. This test pins that step, its
 *      position, and the extraction it depends on.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { diffMissing, extractUsages } from '../../scripts/dev/production-gap.mjs';
import { RELEASE_BRANCH, assertReleaseBranch } from '../../scripts/dev/release-prepare.mjs';

const ROOT = process.cwd();
const workflow = readFileSync(join(ROOT, '.github/workflows/apply-production-migrations.yml'), 'utf8');
const gapTool = readFileSync(join(ROOT, 'scripts/dev/production-gap.mjs'), 'utf8');
const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('work happens on dev', () => {
  test('release preparation refuses every branch but dev', () => {
    expect(RELEASE_BRANCH).toBe('dev');
    expect(() => assertReleaseBranch('dev')).not.toThrow();
    for (const branch of ['staging', 'main', 'feature/x', 'HEAD']) {
      expect(() => assertReleaseBranch(branch), `${branch} must be refused`).toThrow();
    }
  });

  test('the rule is stated where an agent reads it, not only in a script', () => {
    expect(agents, 'AGENTS.md no longer says dev is the only place work happens').toMatch(
      /dev is the only place work happens/i,
    );
    expect(agents, 'AGENTS.md does not point at the tooling that enforces it').toContain('release:prepare');
    expect(agents, 'AGENTS.md does not say staging and production are never edited directly').toMatch(
      /never\s+edited\s+directly/i,
    );
  });
});

describe('the gap measurement cannot pass by measuring nothing', () => {
  test('it reads the calls the client makes', () => {
    const usages = extractUsages([
      'await supabase.rpc("get_my_dashboards");',
      "supabase.from('users').select('*')",
      'await supabase.rpc(`record_cash_reconciliation`, payload)',
    ]);
    expect(usages.rpc).toEqual(['get_my_dashboards', 'record_cash_reconciliation']);
    expect(usages.tables).toEqual(['users']);
  });

  test('it reports exactly what is absent, case-insensitively', () => {
    expect(diffMissing(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(diffMissing(['users'], ['USERS'])).toEqual([]);
    expect(diffMissing([], ['anything'])).toEqual([]);
  });

  test('importing the tool never runs it', () => {
    // The guard test imports this module. If the CLI body ran on import it would resolve production
    // credentials and exit the test process, so the import-safety check is load-bearing.
    expect(gapTool).toContain('pathToFileURL');
    expect(gapTool).toContain('import.meta.url === pathToFileURL');
  });
});

describe('the gated workflow proves alignment after it writes', () => {
  test('the app-object check runs after the apply and fails the release', () => {
    const applied = workflow.indexOf('node scripts/migrate.mjs apply "${ARGS[@]}"');
    const gap = workflow.indexOf('production-gap.mjs --env production --fail-on-gap');
    expect(applied, 'the gated apply step is gone from the workflow').toBeGreaterThan(-1);
    expect(gap, 'the workflow no longer measures the app\'s own objects after writing').toBeGreaterThan(
      applied,
    );
    expect(workflow).toMatch(/if: \$\{\{ inputs\.apply == true \}\}/);
  });

  test('both tools are wired in, so a future task cannot quietly drop them', () => {
    expect(pkg.scripts['prod:gap']).toContain('scripts/dev/production-gap.mjs');
    expect(pkg.scripts['release:prepare']).toContain('scripts/dev/release-prepare.mjs');
  });
});
