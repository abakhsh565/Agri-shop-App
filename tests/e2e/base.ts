/**
 * The Playwright `test` a lane imports when it writes QA rows.
 *
 * WHY A BASE MODULE. Playwright fixtures are only available to specs that import the extended
 * `test`, so worker-scoped cleanup cannot be injected globally from the config. This module is that
 * extension: importing it is the whole adoption, and a lane that already cleans up after itself in
 * `afterAll` keeps doing so — the fixture only covers what that hook could not, e.g. a failing test
 * whose worker is restarted before the file's cleanup can run.
 *
 * WHAT THE FIXTURE DOES
 *   `qaWorkerCleanup` is **auto** (no test has to request it) and **worker-scoped**: its teardown runs
 *   once, when the worker process finishes its files, and calls the existing ownership cleanup for
 *   whatever is still registered. It never invents ids, never names a table, and never touches the
 *   shared baseline: only `trackOwned` registrations are eligible, exactly as in a file's `afterAll`.
 *
 * WHAT IT DOES NOT DO
 *   It cannot run after a hard kill (SIGKILL, OOM, cancelled run) — the process is gone, so no
 *   teardown of any kind runs. Session-scoped database work is unaffected by that; QA rows registered
 *   by such a run remain, and the write tenant's marker-based reclaim is the only pattern that can
 *   find them again. That limitation is stated, not papered over.
 */
import { test as base, expect } from '@playwright/test';
import { cleanupFixtures, ownedObjects, ownership } from './helpers';
import { pendingRegistrations, runWorkerCleanup } from './workerCleanup';

export const test = base.extend<Record<string, never>, { qaWorkerCleanup: void }>({
  qaWorkerCleanup: [
    async ({}, use, workerInfo) => {
      // No setup: the registry is populated by the lanes themselves as they create rows.
      await use();

      // TEARDOWN. Runs when Playwright stops this worker gracefully — including after a failing test,
      // where the restart is exactly the case this exists for: the old worker still holds the ids and
      // the restarted worker's `afterAll` starts from an empty registry. Throws rather than swallowing
      // when anything is still owned.
      await runWorkerCleanup({
        workerIndex: workerInfo.workerIndex,
        pendingCount: () => pendingRegistrations(ownership(), ownedObjects()),
        cleanup: cleanupFixtures,
      });
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect };
