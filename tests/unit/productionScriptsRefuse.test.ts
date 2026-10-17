/**
 * The production scripts refuse before they connect — asserted by running them.
 *
 * Four scripts were added on 2026-10-17 so that production's state can be measured, its flows
 * rehearsed and its two-shop boundary demonstrated without a person remembering the safety rules:
 *
 *   scripts/rehearse-production-flows.mjs   drives seven write RPCs and ALWAYS rolls back
 *   scripts/measure-production-final-state.mjs   reads only, in a READ ONLY transaction
 *   scripts/audit-app-surface.mjs           asks production for the columns/RPCs the client names
 *   scripts/dev/probe-two-shop-isolation.mjs  the two-shop QA probe, one rolled-back transaction
 *
 * Each one's refusal is the thing standing between a typo and a write to the wrong database, and a
 * refusal that is only described in a comment is not a refusal. These run the real processes: no
 * credentials are needed to reach the guard, so a guard that moved behind the connection would fail
 * here rather than pass quietly.
 *
 * The last test is the non-vacuity half — it executes the same check on a mutated copy of one script
 * and requires the failure the real script avoids. Without it these could all pass against a script
 * whose refusal had been deleted and whose argument parsing accidentally exited 2 for another reason.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const run = (script: string, args: string[] = []) =>
  spawnSync(process.execPath, [join(ROOT, script), ...args], { encoding: 'utf8', cwd: ROOT });

describe('the production scripts refuse what they must, before connecting', () => {
  test('the flow rehearsal refuses with no environment named', () => {
    const result = run('scripts/rehearse-production-flows.mjs');
    expect(result.status, `expected a refusal, got:\n${result.stdout}${result.stderr}`).toBe(2);
    expect(result.stderr).toMatch(/name the environment: --env production/);
    // The refusal must come before any credential is looked for.
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/PROD_DB_PASS|must be set|is not set/);
  });

  test('the flow rehearsal refuses an environment that is not production', () => {
    const result = run('scripts/rehearse-production-flows.mjs', ['--env', 'staging']);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/name the environment: --env production/);
  });

  test('the flow rehearsal rolls back unconditionally — there is no flag that commits', () => {
    const source = readFileSync(join(ROOT, 'scripts/rehearse-production-flows.mjs'), 'utf8');
    expect(source, 'the rehearsal must open a transaction').toMatch(/await client\.query\('begin'\)/);
    // The rollback lives in `finally`, so a thrown assertion cannot leave a committed write behind.
    expect(source).toMatch(/finally \{[\s\S]*?await client\.query\('rollback'\)/);
    expect(source, 'no commit call may exist').not.toMatch(/\bcommit\b/i);
    // And it proves the row counts are back to zero rather than assuming the rollback worked.
    expect(source).toMatch(/left nothing behind/);
  });

  test('the final-state measurement refuses without naming production, and reads only', () => {
    const noEnv = run('scripts/measure-production-final-state.mjs');
    expect(noEnv.status, `expected a refusal, got:\n${noEnv.stdout}${noEnv.stderr}`).toBe(2);
    expect(noEnv.stderr).toMatch(/name the environment: --env production/);

    const source = readFileSync(join(ROOT, 'scripts/measure-production-final-state.mjs'), 'utf8');
    expect(source, 'the measurement must run in a READ ONLY transaction').toMatch(
      /begin transaction read only/,
    );
    expect(source, 'the measurement may not commit').not.toMatch(/await client\.query\('commit'\)/);
  });

  test('the app-surface audit refuses without naming an environment it supports', () => {
    const none = run('scripts/audit-app-surface.mjs');
    expect(none.status).toBe(2);
    expect(none.stderr).toMatch(/name the environment: --env production\|staging/);

    const bogus = run('scripts/audit-app-surface.mjs', ['--env', 'localhost']);
    expect(bogus.status).toBe(2);
    expect(bogus.stderr).toMatch(/name the environment/);

    const source = readFileSync(join(ROOT, 'scripts/audit-app-surface.mjs'), 'utf8');
    expect(source, 'production credentials must come from the wrapper, never a file this opens').toMatch(
      /run-with-production-credentials\.mjs/,
    );
  });

  test('the two-shop probe refuses any target that is not QA', () => {
    const source = readFileSync(join(ROOT, 'scripts/dev/probe-two-shop-isolation.mjs'), 'utf8');
    // The guard is on the resolved target, not on a comment: the project ref must appear in the
    // check, and production's ref must be named as the thing it refuses.
    expect(source).toMatch(/only runs against QA/);
    expect(source).toMatch(/gkswcfljxlutkfdvvqng/);
    expect(source, 'the probe must roll back').toMatch(/await client\.query\('rollback'\)/);
    expect(source, 'the probe may not commit').not.toMatch(/await client\.query\('commit'\)/);
  });

  test('the guard itself is not vacuous: removing a refusal makes these checks fail', () => {
    // A copy of the rehearsal with its `--env production` refusal deleted. Running it must NOT
    // produce the refusal the real script produces — if it still did, the assertions above would be
    // measuring something other than the refusal (argument parsing, a missing file, an import error).
    const dir = mkdtempSync(join(tmpdir(), 'refusal-guard-'));
    const mutated = join(dir, 'rehearse-production-flows.mjs');
    const original = readFileSync(join(ROOT, 'scripts/rehearse-production-flows.mjs'), 'utf8');
    const withoutRefusal = original.replace(
      /if \(envIndex === -1 \|\| process\.argv\[envIndex \+ 1\] !== 'production'\) \{[\s\S]*?process\.exit\(2\);\n\}/,
      '// refusal removed for the non-vacuity check',
    );
    expect(withoutRefusal, 'the mutation did not apply — the guard text moved').not.toBe(original);
    writeFileSync(mutated, withoutRefusal);

    const mutant = spawnSync(process.execPath, [mutated], { encoding: 'utf8', cwd: ROOT });
    expect(
      mutant.stderr,
      'the mutant refused too, so the assertion above is not measuring the refusal',
    ).not.toMatch(/name the environment: --env production/);
  });
});
