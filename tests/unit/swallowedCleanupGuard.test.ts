/**
 * No integration suite may swallow a cleanup failure.
 *
 * WHY THIS EXISTS. Every integration suite seeds its own rows in the ONE shared
 * QA database and cleans them up afterwards. A `.catch(() => undefined)` (or the
 * spelling `.catch(() => {})`) on a cleanup DELETE turns a failed delete into
 * silence: the rows stay, and the NEXT suite fails deep inside a test with an
 * authorization or uniqueness error that is really leftover state from this one.
 * That is how the CI QA job kept failing with a different file blamed each run.
 *
 * The sanctioned pattern (see tests/integration/customerDeletionSecurity.test.ts
 * and tests/integration/employeeInviteLifecycle.test.ts) is reporting cleanup:
 * `trySql(label, promise)` records failures into `cleanupFailures`, and
 * `throwIfCleanupFailed(context)` at the end of beforeAll/afterAll fails the
 * suite loudly naming the leak. The only sanctioned silent failure is an
 * explicit try/catch block whose comment says "best-effort by design" and why
 * (two exist: employeeInviteLifecycle's deactivate RPC and rbacFoundation's
 * password reset, where the row may legitimately not exist yet) — a bare
 * try/catch with a stated reason is reviewable; a one-line `.catch` is not.
 *
 * This guard reads the files rather than importing them, so it keeps working if
 * a suite is refactored. It does NOT cover the reporting `.catch` forms that
 * return a value or log the error (assistantPermission's `res.json()` fallback,
 * employeeAccessOverrides' diagnostics, tenantBoundarySweep's logged fixture
 * skips) — those report, they do not swallow.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const INTEGRATION_DIR = path.resolve(process.cwd(), 'tests/integration');

/** Every .ts file directly under tests/integration/. */
function integrationFiles(): string[] {
  return fs
    .readdirSync(INTEGRATION_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.join(INTEGRATION_DIR, e.name));
}

/** The two silent-swallow spellings. Any occurrence, code or comment, fails. */
const SWALLOWED = /\.catch\(\(\) => (?:undefined|\{\})\)/g;

describe('Swallowed cleanup guard', () => {
  it('never lets an integration suite swallow a cleanup failure', () => {
    const hits: string[] = [];
    for (const file of integrationFiles()) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(SWALLOWED)) {
        const line = source.slice(0, match.index).split('\n').length;
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        hits.push(`${rel}:${line}: ${match[0]}`);
      }
    }
    expect(
      hits,
      'a swallowed cleanup (.catch(() => undefined) or .catch(() => {})) leaves rows ' +
        'that contaminate the next suite — convert it to trySql + throwIfCleanupFailed ' +
        '(see customerDeletionSecurity.test.ts), or to an explicit try/catch with a ' +
        '"best-effort by design" comment stating why the failure is legitimate',
    ).toEqual([]);
  });

  it('never defines reporting cleanup without wiring the throw', () => {
    // customerDeletionSecurity is the one exception, by design: it does not
    // call throwIfCleanupFailed because its beforeAll stale-row check is the
    // surfacing mechanism — cleanup() records into cleanupFailures, and the
    // identity check refuses to run when the namespace is still contaminated,
    // which is exactly the state a failed cleanup leaves behind.
    const WIRED_DIFFERENTLY = new Set([
      'tests/integration/customerDeletionSecurity.test.ts',
    ]);
    const unwired: string[] = [];
    for (const file of integrationFiles()) {
      const source = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
      if (WIRED_DIFFERENTLY.has(rel)) continue;
      if (
        source.includes('const cleanupFailures: string[]') &&
        // A call passes a string context; the definition itself is
        // `function throwIfCleanupFailed(context: string)` and does not count.
        !source.includes("throwIfCleanupFailed('")
      ) {
        unwired.push(rel);
      }
    }
    expect(
      unwired,
      'a suite that collects cleanupFailures must call throwIfCleanupFailed in ' +
        'beforeAll/afterAll, or the failures are collected and never surfaced',
    ).toEqual([]);
  });
});
