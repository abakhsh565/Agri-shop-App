/**
 * `runWorkerCleanup` — the worker-teardown decisions, proved without a browser or a database.
 *
 * WHY THESE CASES. The teardown only earns its place if it (a) stays silent when the worker owns
 * nothing, so read-only lanes pay one log line and no query; (b) issues exactly the existing ownership
 * cleanup when anything remains; (c) counts an uploaded storage object as remaining work, because
 * skipping it would leave exactly the orphan `imageSync` tracks; (d) is safe to run beside a file's own
 * `afterAll`; and (e) makes a failure loud without losing the reason cleanup failed.
 *
 * It deliberately does NOT test table selection or the delete plan: those live in
 * `cleanupOwnership.ts` and are held by `e2eCleanupOwnership.test.ts`. This module has no table, id or
 * fixture knowledge of its own, which is the property that keeps it from widening what cleanup can
 * touch.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runWorkerCleanup, pendingRegistrations } from '../e2e/workerCleanup';
import { createOwnership, trackOwned, PROTECTED_QA_IDS } from '../e2e/cleanupOwnership';

describe('worker teardown cleanup', () => {
  test('issues nothing when the worker owns nothing', async () => {
    let calls = 0;
    const lines: string[] = [];

    const outcome = await runWorkerCleanup({
      workerIndex: 0,
      pendingCount: () => 0,
      cleanup: async () => {
        calls += 1;
      },
      log: (line) => lines.push(line),
    });

    expect(outcome).toEqual({ ran: false, pending: 0 });
    expect(calls, 'a lane that cleaned up after itself must not issue a second cleanup').toBe(0);
    expect(lines.join('\n')).toMatch(/nothing owned/);
  });

  test('runs the existing ownership cleanup once when ids are still registered', async () => {
    let calls = 0;
    const lines: string[] = [];

    const outcome = await runWorkerCleanup({
      workerIndex: 3,
      pendingCount: () => 7,
      cleanup: async () => {
        calls += 1;
      },
      log: (line) => lines.push(line),
    });

    expect(calls).toBe(1);
    expect(outcome).toEqual({ ran: true, pending: 7 });
    expect(lines.join('\n')).toContain('7 registration(s)');
  });

  test('counts a storage object, so a worker whose rows are gone but whose upload is not still cleans up', () => {
    const own = createOwnership();
    // No rows at all: the case a row-only guard would skip.
    expect(pendingRegistrations(own, [{ bucket: 'product-images', path: 'qa/x.png' }])).toBe(1);

    trackOwned(own, 'products', 'row-1');
    expect(pendingRegistrations(own, [{ bucket: 'product-images', path: 'qa/x.png' }])).toBe(2);
    expect(pendingRegistrations(own)).toBe(1);

    // A protected baseline id is not tracked in the first place, so it never inflates the count.
    trackOwned(own, 'companies', PROTECTED_QA_IDS[0]);
    expect(pendingRegistrations(own)).toBe(1);
  });

  test('is idempotent — a second teardown after a successful cleanup is a no-op', async () => {
    let pending = 2;
    let calls = 0;
    const deps = {
      workerIndex: 1,
      pendingCount: () => pending,
      cleanup: async () => {
        calls += 1;
        pending = 0; // cleanupFixtures clears the registry only after a fully successful pass
      },
      log: () => undefined,
    };

    expect(await runWorkerCleanup(deps)).toEqual({ ran: true, pending: 2 });
    expect(await runWorkerCleanup(deps)).toEqual({ ran: false, pending: 0 });
    expect(calls, 'the second pass must not issue another delete plan').toBe(1);
  });

  test('fails loudly, names the worker and the count, and keeps the ids registered for a retry', async () => {
    let pending = 5;
    let attempts = 0;

    const deps = {
      workerIndex: 2,
      pendingCount: () => pending,
      cleanup: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('inventory_movements.reference_id (3 id(s)): permission denied');
        pending = 0;
      },
      log: () => undefined,
    };

    const thrown = await runWorkerCleanup(deps).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(thrown, 'a worker that leaves rows behind must fail the run').not.toBeNull();
    expect(thrown!.message).toContain('[QA CLEANUP]');
    expect(thrown!.message).toContain('worker 2');
    expect(thrown!.message).toContain('5 registration(s)');
    expect(thrown!.message, 'the underlying reason must survive the wrapper').toContain(
      'permission denied',
    );
    expect(thrown!.message).toMatch(/remain in QA/);
    expect(pending, 'the registry must NOT be cleared by a failed cleanup — that is what makes a retry possible').toBe(5);

    const retry = await runWorkerCleanup(deps);
    expect(retry).toEqual({ ran: true, pending: 5 });
    expect(attempts).toBe(2);
  });

  test('a cleanup failure is never reported as success', async () => {
    await expect(
      runWorkerCleanup({
        workerIndex: 0,
        pendingCount: () => 1,
        cleanup: async () => {
          throw new Error('connection terminated unexpectedly');
        },
        log: () => undefined,
      }),
    ).rejects.toThrow(/connection terminated unexpectedly/);
  });
});

/**
 * The wiring itself: a decision function nobody calls is a comment. This pins the three properties
 * that make the fixture reachable and cheap — auto (no lane has to request it), worker scope (once
 * per process, not once per test), and the ownership count plus the existing cleanup (so it cannot
 * grow its own delete path).
 */
/**
 * EC5 — every E2E spec adopts the worker-cleanup fixture.
 *
 * A fixture that only two lanes import cannot cover the rest: a failing test restarts the worker
 * process, the ownership registry dies with it, and the file's own `afterAll` never gets to run. The
 * rows stay in QA, and the next run reads them as the fixture. So adoption is the criterion, and it is
 * a property of the IMPORT — Playwright gives no other handle on the test object a spec uses.
 *
 * Read-only lanes are included on purpose. The fixture issues nothing when the worker owns nothing, so
 * a universal rule costs one log line and removes the judgement call "is this lane a writing lane?".
 */
function fixtureAdoption(source: string): { usesBase: boolean; importsRunner: boolean } {
  const runtimeImports = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)].map((m) => ({
    names: m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0].trim()),
    from: m[2],
  }));
  return {
    usesBase: runtimeImports.some((i) => i.from === './base' && i.names.includes('test')),
    importsRunner: runtimeImports.some((i) => i.from === '@playwright/test' && i.names.includes('test')),
  };
}

describe('every E2E spec uses the worker-cleanup fixture', () => {
  const specs = readdirSync(resolve(process.cwd(), 'tests/e2e')).filter((f) => f.endsWith('.spec.ts'));

  test('the scan sees the suite, so the rules below are not vacuous', () => {
    expect(specs.length, 'no specs found — the scan would pass while checking nothing').toBeGreaterThan(20);
  });

  test('no spec imports `test` from @playwright/test, and every spec imports it from ./base', () => {
    const offenders = specs
      .map((file) => ({ file, ...fixtureAdoption(readFileSync(resolve(process.cwd(), 'tests/e2e', file), 'utf8')) }))
      .filter((s) => !s.usesBase || s.importsRunner)
      .map((s) => `${s.file}${s.importsRunner ? ' imports the runner directly' : ' does not use ./base'}`);

    expect(
      offenders,
      'a lane that skips this fixture loses its ownership registrations when a failing test restarts the worker, ' +
        'so its rows stay in QA and the next run reads them as the fixture. Import `test`/`expect` from `./base`',
    ).toEqual([]);
  });

  test('the detector is not vacuous', () => {
    expect(fixtureAdoption("import { test, expect } from './base';\nimport type { Page } from '@playwright/test';")).toEqual({
      usesBase: true,
      importsRunner: false,
    });
    expect(fixtureAdoption("import { test, expect } from '@playwright/test';")).toEqual({
      usesBase: false,
      importsRunner: true,
    });
  });
});

describe('base fixture wiring', () => {
  const source = readFileSync(resolve(process.cwd(), 'tests/e2e/base.ts'), 'utf8');

  test('is auto and worker-scoped', () => {
    expect(source).toMatch(/\{\s*scope:\s*'worker',\s*auto:\s*true\s*\}/);
  });

  test('counts rows AND objects, and cleans through the existing ownership cleanup', () => {
    expect(source).toContain('pendingRegistrations(ownership(), ownedObjects())');
    expect(source).toMatch(/cleanup:\s*cleanupFixtures/);
    expect(source, 'the fixture must not build its own delete path').not.toMatch(/delete\s+from/i);
  });
});
