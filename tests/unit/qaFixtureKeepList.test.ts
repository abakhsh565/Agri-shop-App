import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
});
