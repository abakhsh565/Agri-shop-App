/**
 * Worker teardown: remove what this worker still OWNS, through the existing ownership cleanup.
 *
 * WHY (measured 2026-10-18)
 *   Every writing lane calls `cleanupFixtures()` in its own `afterAll`. Playwright restarts the worker
 *   process after a failing test, and the ownership registry is in-process memory, so the ids a failed
 *   test registered die with that process: the next file's cleanup has nothing to delete, and the rows
 *   stay in QA. That is how `crossScreenSync` can leave its five registered rows (customer, product,
 *   variant, supplier, employee) behind on a red run while its `afterAll` still passes.
 *
 * WHAT THIS IS, AND IS NOT
 *   It is a thin, testable decision layer over `cleanupFixtures()`: run it once when the worker
 *   finishes, only if the worker still owns something. It does NOT know tables, ids or fixtures — it
 *   cannot widen what cleanup deletes, and the canonical baseline rows are protected where they always
 *   were (`PROTECTED_QA_IDS` / `USER_DELETE_GUARDS` in `cleanupOwnership.ts`). It never selects rows by
 *   name or shop, so it cannot sweep a shared QA customer, product or tenant.
 *
 *   "Something" is rows AND uploaded storage objects, because `cleanupFixtures()` removes both and a
 *   guard that counted only rows would skip an object whose rows had already been deleted.
 *
 *   Cleanup is idempotent by construction: `cleanupFixtures()` clears the registry only after a fully
 *   successful pass, so a second call is a no-op on success and a retry on failure. Running it beside a
 *   file's own `afterAll` therefore costs a log line, not a duplicate delete.
 *
 *   Failures are thrown, not swallowed: a worker that leaves rows behind fails the run with the count
 *   and the underlying cleanup message. Playwright reports that separately from any test failure that
 *   caused it, so the original red test is not replaced by the cleanup error.
 */
import { ownedCount, type OwnedObject, type Ownership } from './cleanupOwnership';

/**
 * How much this worker still owns: registered rows plus recorded storage objects.
 *
 * Kept here rather than in the fixture so the "objects count too" decision is unit-testable without a
 * browser. Read-only: it counts, it never adds to either registry.
 */
export function pendingRegistrations(
  ownership: Ownership,
  objects: readonly OwnedObject[] = [],
): number {
  return ownedCount(ownership) + objects.length;
}

/** What the worker teardown needs, all injected so the decision is testable without a database. */
export interface WorkerCleanupDeps {
  /** For the message only: which worker left rows behind. */
  workerIndex: number;
  /** Rows still registered plus objects still recorded. Read at teardown, after the file hooks ran. */
  pendingCount: () => number;
  /** The existing ownership cleanup. Never a table-wide delete, never a fresh registry. */
  cleanup: () => Promise<void>;
  /** Where to say what happened. Defaults to `console.log`, matching the rest of the QA harness. */
  log?: (message: string) => void;
}

export interface WorkerCleanupOutcome {
  /** False when the worker owned nothing, so no statement was issued. */
  ran: boolean;
  /** Row/object registrations this worker still owned when it finished. */
  pending: number;
}

/**
 * Run the ownership cleanup once for a finishing worker.
 *
 * Returns `{ ran: false }` and issues nothing when the worker owns nothing — the ordinary case for a
 * lane that cleaned up after itself, and the reason an auto fixture here is cheap.
 */
export async function runWorkerCleanup(deps: WorkerCleanupDeps): Promise<WorkerCleanupOutcome> {
  const log = deps.log ?? ((message: string) => console.log(message));
  const pending = deps.pendingCount();

  if (pending === 0) {
    log('[QA CLEANUP] worker teardown: nothing owned — no deletes issued.');
    return { ran: false, pending: 0 };
  }

  try {
    await deps.cleanup();
  } catch (error) {
    throw new Error(
      `[QA CLEANUP] worker ${deps.workerIndex} teardown failed — ${pending} registration(s) are still owned, ` +
        'so rows created by this worker remain in QA. They were NOT removed silently, and they stay ' +
        'registered so a later cleanup can still remove them.\n' +
        `  ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  log(`[QA CLEANUP] worker teardown removed what this worker still owned (${pending} registration(s)).`);
  return { ran: true, pending };
}
