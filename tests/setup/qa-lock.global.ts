/**
 * Vitest globalSetup — claim the QA run lock before any integration file opens a table.
 *
 * WHY GLOBALSETUP. It is the one hook both entry points share: CI runs
 * `npx vitest run tests/integration --fileParallelism=false`, a developer runs
 * `npm run test:integration` or a single file, and both go through `vitest.config.ts`. So both run
 * this `setup()` once, before the first test file, and its `teardown()` once, after the last one.
 *
 * A run that cannot claim THROWS here. Vitest then reports one failure and never loads a file, which
 * is the point: the second run must stop BEFORE it can delete someone else's fixtures, not halfway
 * through, where the damage is already done. The same is true of a run whose configured database is
 * not the QA project: it stops before the first connection, not after the first assertion.
 *
 * A unit-only run (`npx vitest run tests/unit` — the CI gates job) never reaches QA and never claims.
 */

import {
  acquireQaRunLock,
  createQaClient,
  loadQaEnv,
  qaDatabaseIsInScope,
  qaLockTargetProblem,
  releaseQaRunLock,
  type LockClient,
} from './qa-lock';

let client: LockClient | null = null;
let claimed = false;

export async function setup() {
  if (!qaDatabaseIsInScope(process.argv)) return;

  loadQaEnv();

  // WHICH DATABASE, before WHOSE LOCK. A lock taken on the wrong project coordinates with nobody,
  // and the suite that followed it would run against that same wrong database. This decides from
  // configuration alone — no connection, no query — so a mis-pointed target stops the run here.
  const targetProblem = qaLockTargetProblem();
  if (targetProblem) throw new Error(`\n[QA LOCK] ${targetProblem}\n`);

  client = createQaClient();
  if (!client) {
    // Fail closed. A run that cannot take the lock cannot know whether another run is mid-flight,
    // and "probably alone" is the assumption that produced two wasted promotion attempts.
    throw new Error(
      '\n[QA LOCK] QA credentials are missing (QA_DB_HOST / QA_DB_USER / QA_DB_PASS, or .env.qa).\n' +
        '  The run lock cannot be taken, so exclusivity cannot be established. This run stops here.\n'
    );
  }

  // Open the session BEFORE claiming: `pg.Client.query()` throws on an unconnected client, and the
  // refusal below would then blame QA for a wiring mistake (found by this file's own completion
  // check — the client was built but never connected).
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      '\n[QA LOCK] QA could not be reached to take the run lock.\n' +
        `  ${(error as Error).message}\n` +
        '  Exclusivity cannot be established, so this run stops here rather than risk sharing QA.\n'
    );
  }

  const result = await acquireQaRunLock(client);
  if (!result.ok) {
    await releaseQaRunLock(client); // closes the session this process opened
    throw new Error(`\n[QA LOCK] ${result.reason}\n`);
  }
  claimed = true;

  // An interrupted run releases where the runtime gives it the chance. This is NOT stale-session
  // recovery — a SIGKILLed run still cannot release, and the server notices only when the socket
  // dies. Terminating a provably dead backend is the next task.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void releaseQaRunLock(client as LockClient).then(() => process.exit(130));
    });
  }
}

export async function teardown() {
  if (!claimed || !client) return;
  await releaseQaRunLock(client);
  claimed = false;
}
