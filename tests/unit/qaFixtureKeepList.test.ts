import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * THE DEFECT THIS PREVENTS (observed in QA)
 *
 *   Two files decide which QA fixture accounts survive a cleanup:
 *     scripts/clean-test-data.mjs            (manual/QA cleanup) — 4 phones
 *     tests/setup/global-teardown.ts         (runs after EVERY vitest run) — was 2
 *
 *   The teardown therefore deleted QA Admin and QA Employee on every test run,
 *   including their auth.users credential. Deleting the users row deletes the
 *   credential, and the app cannot re-create it (signUp yields no confirmed
 *   session), so the accounts became unloginable with "could not start a secure
 *   session" — a failure that looks like a product bug, appears intermittently
 *   (only after a vitest run), and cost real time to trace.
 *
 *   The lists are read from source rather than imported because one is a script and
 *   the other is the vitest global teardown; a future refactor to a shared constant
 *   is welcome, and this test will keep passing as long as the values agree.
 */

const root = path.resolve(__dirname, '..', '..');

function keepPhones(relPath: string): string[] {
  const src = readFileSync(path.join(root, relPath), 'utf8');
  const m = src.match(/KEEP_PHONES\s*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error(`KEEP_PHONES not found in ${relPath}`);
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
}

describe('QA fixture keep-list', () => {
  it('is identical in the vitest teardown and the cleanup script', () => {
    expect(keepPhones('tests/setup/global-teardown.ts')).toEqual(
      keepPhones('scripts/clean-test-data.mjs')
    );
  });

  it('keeps the accounts the app signs in with (owners + employees)', () => {
    const keep = keepPhones('tests/setup/global-teardown.ts');
    // The QA owner and QA employee: without these the E2E suites and any manual
    // sign-in have no working fixture, which is exactly how the drift presented.
    expect(keep).toContain('923009999999');
    expect(keep).toContain('923008888888');
  });

  /**
   * THE THIRD DOOR (found later, same defect class)
   *
   *   tests/e2e/helpers.ts `cleanupFixtures()` ran on every E2E spec and ended with
   *   `DELETE FROM users WHERE id IN (QA_IDS.admin, QA_IDS.employee)`. Every lane that
   *   cleaned up after itself therefore deleted the two QA accounts and their
   *   auth.users credential — the 4-account baseline silently collapsed to 2 after
   *   any Playwright run, and later lanes either failed to sign in or misreported.
   *
   *   A cleanup may undo destructive STATE (is_active, deactivated_at) but must never
   *   delete an account whose credential the app cannot re-create.
   */
  /**
   * The precise rule: a test may delete users it created itself, but no `DELETE FROM
   * users` statement may target one of the shared fixture accounts. Those carry a
   * Supabase Auth credential in auth.users; deleting the row deletes the credential,
   * and the app cannot re-create it (signUp yields no confirmed session), so the
   * accounts become unloginable and later lanes silently misreport.
   */
  function deletesAkixtureAccount(src: string): boolean {
    const stmts = src.match(/DELETE\s+FROM\s+users[\s\S]{0,400}?`/gi) ?? [];
    return stmts.some((s) => /923009999999|923008888888|QA_IDS\.admin|QA_IDS\.employee/.test(s));
  }

  it('the detector is not vacuous — it catches the exact statement that caused the loss', () => {
    // The line that shipped in tests/e2e/helpers.ts and collapsed the baseline from
    // 4 accounts to 2 after every Playwright run. If this ever stops matching, the
    // guard below is blind and must be repaired.
    const shipped = 'await execSql(`DELETE FROM users WHERE id IN (\'${QA_IDS.admin}\', \'${QA_IDS.employee}\')`);';
    expect(deletesAkixtureAccount(shipped)).toBe(true);
    // ...and it does not fire on a test cleaning up a user it created itself.
    expect(deletesAkixtureAccount('await sql(`DELETE FROM users WHERE phone = \'${EMP_PHONE}\'`)')).toBe(false);
  });

  it('no test-side cleanup deletes a fixture account', () => {
    const offenders: string[] = [];
    for (const dir of ['e2e', 'integration', 'unit']) {
      for (const f of readdirSync(path.join(root, 'tests', dir))) {
        if (!f.endsWith('.ts')) continue;
        // This file holds the offending statement as a literal, to prove the
        // detector above is not vacuous. Scanning it would flag its own test data.
        if (f === 'qaFixtureKeepList.test.ts') continue;
        const src = readFileSync(path.join(root, 'tests', dir, f), 'utf8');
        if (deletesAkixtureAccount(src)) offenders.push(`tests/${dir}/${f}`);
      }
    }
    expect(
      offenders,
      'These files DELETE a shared QA fixture account. Cleanup must reset is_active/' +
        'deactivated_at instead: deleting the row deletes the Supabase Auth credential and ' +
        'the app cannot re-create it, so the accounts become unloginable.',
    ).toEqual([]);
  });
});
