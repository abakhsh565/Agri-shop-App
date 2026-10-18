/**
 * The QA run lock's rules, proved without a database.
 *
 * Everything here drives `tests/setup/qa-lock.ts` through a fake client: no connection is opened, no
 * query reaches QA, and nothing is written anywhere. What a fake cannot prove is that the advisory
 * lock really holds across a session — that was measured separately against the QA pooler
 * (2026-10-18: true for the first connection, false for a second, still false at 32s of idle and
 * activity, released cleanly, nothing left behind by a dead session).
 */

import { describe, it, expect } from 'vitest';
import {
  QA_RUN_LOCK_ID,
  acquireQaRunLock,
  qaDatabaseIsInScope,
  qaLockTargetProblem,
  qaLockTargetRef,
  releaseQaRunLock,
  type LockClient,
} from '../setup/qa-lock';
import { QA_PROJECT_REF } from '../../scripts/dev/lib.mjs';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '../../src/lib/environmentContract';

/** The pooler host both CI and `.env.qa` use; it carries no ref, the user does. */
const POOLER = 'aws-0-ap-northeast-1.pooler.supabase.com';

/** A client that answers the two statements this module sends, and records what it was asked. */
function fakeClient(options: { held?: boolean; failure?: string; unlockFails?: boolean } = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let ended = false;
  const client: LockClient = {
    async connect() {
      calls.push({ sql: 'connect' });
    },
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (options.failure) throw new Error(options.failure);
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ ok: !options.held }] };
      if (/pg_advisory_unlock/.test(sql)) {
        if (options.unlockFails) throw new Error('unlock refused');
        return { rows: [{ pg_advisory_unlock: true }] };
      }
      return { rows: [{}] };
    },
    async end() {
      ended = true;
    },
  };
  return { client, calls, ended: () => ended };
}

describe('QA run lock — claiming', () => {
  it('takes the lock when nobody holds it', async () => {
    const { client, calls } = fakeClient();
    const result = await acquireQaRunLock(client);
    expect(result.ok).toBe(true);
    expect(calls[0].sql).toMatch(/pg_try_advisory_lock/);
    expect(calls[0].values).toEqual([QA_RUN_LOCK_ID]);
  });

  it('refuses when another run holds it, and says what that costs', async () => {
    const { client } = fakeClient({ held: true });
    const result = await acquireQaRunLock(client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/another QA run is in flight/);
    expect(result.reason).toContain(String(QA_RUN_LOCK_ID));
    expect(result.reason, 'the message must say why this matters, not just that it failed').toMatch(
      /delete each other's fixtures/
    );
  });

  it('fails closed when the database cannot be asked at all', async () => {
    const { client } = fakeClient({ failure: 'connection terminated unexpectedly' });
    const result = await acquireQaRunLock(client);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/could not be asked/);
    expect(result.reason).toContain('connection terminated unexpectedly');
    expect(result.reason, 'an unknown holder must not be reported as a free lock').toMatch(/stops here/);
  });
});

describe('QA run lock — releasing', () => {
  it('unlocks and closes the session that held it', async () => {
    const { client, calls, ended } = fakeClient();
    await acquireQaRunLock(client);
    await releaseQaRunLock(client);

    expect(calls.some((c) => /pg_advisory_unlock/.test(c.sql))).toBe(true);
    expect(
      ended(),
      'the session must be closed: the lock is session-scoped, so this is what stops a later SIGKILL leaving it behind'
    ).toBe(true);
  });

  it('never throws from release — it runs on the way out of a failing run', async () => {
    const { client, ended } = fakeClient({ unlockFails: true });
    await expect(releaseQaRunLock(client)).resolves.toBeUndefined();
    expect(ended()).toBe(true);
  });
});

describe('QA run lock — the project it is taken on', () => {
  it('accepts the QA project as the pooler names it', () => {
    expect(
      qaLockTargetProblem({ QA_DB_USER: `postgres.${QA_PROJECT_REF}`, QA_DB_HOST: POOLER }),
    ).toBeNull();
  });

  it('accepts the direct-connection shape, where the ref is in the host', () => {
    expect(qaLockTargetProblem({ QA_DB_USER: 'postgres', QA_DB_HOST: `db.${QA_PROJECT_REF}.supabase.co` })).toBeNull();
    expect(qaLockTargetRef('postgres', `db.${QA_PROJECT_REF}.supabase.co`)).toBe(QA_PROJECT_REF);
  });

  it('refuses production, and names it as production', () => {
    const problem = qaLockTargetProblem({
      QA_DB_USER: `postgres.${PRODUCTION_PROJECT_ID}`,
      QA_DB_HOST: POOLER,
    });
    expect(problem).toBeTruthy();
    expect(problem, 'the actual target must be named, not just "wrong"').toContain(PRODUCTION_PROJECT_ID);
    expect(problem, 'the expected target must be named too').toContain(QA_PROJECT_REF);
    expect(problem).toMatch(/not the QA project/);
    expect(problem).toMatch(/PRODUCTION project/);
    expect(problem, 'a refusal must say nothing was reached').toMatch(/nothing\s+reaches production/);
  });

  it('refuses any other project', () => {
    const problem = qaLockTargetProblem({ QA_DB_USER: 'postgres.someotherprojectref', QA_DB_HOST: POOLER });
    expect(problem).toContain('someotherprojectref');
    expect(problem).not.toMatch(/PRODUCTION project/);
  });

  it('refuses a target it cannot read instead of assuming it is QA', () => {
    const problem = qaLockTargetProblem({ QA_DB_USER: 'postgres', QA_DB_HOST: 'db.internal.example.com' });
    expect(problem).toMatch(/\(unreadable\)/);
  });

  it('leaves missing credentials to createQaClient, so that message is not masked', () => {
    expect(qaLockTargetProblem({})).toBeNull();
    expect(qaLockTargetProblem({ QA_DB_USER: `postgres.${QA_PROJECT_REF}` })).toBeNull();
  });

  it('keeps the rehearsal switch on loopback — it connects without TLS', () => {
    expect(qaLockTargetProblem({ QA_DB_USER: 'postgres', QA_DB_HOST: '127.0.0.1', QA_LOCK_DB_PORT: '54322' })).toBeNull();
    expect(qaLockTargetProblem({ QA_DB_USER: 'postgres', QA_DB_HOST: 'localhost', QA_LOCK_DB_PORT: '54322' })).toBeNull();
    const hosted = qaLockTargetProblem({ QA_DB_USER: `postgres.${QA_PROJECT_REF}`, QA_DB_HOST: POOLER, QA_LOCK_DB_PORT: '5432' });
    expect(hosted).toMatch(/rehearsal switch/);
    expect(hosted).toContain(POOLER);
  });

  it('enforces the same ref the rest of the repository calls QA', () => {
    // The lock is a literal id shared by CI and a developer's machine; if the ref it enforces ever
    // drifted from the staging project, CI and local runs would refuse each other's lock — or worse,
    // both accept a target that is not the one they think they are on.
    expect(QA_PROJECT_REF).toBe(STAGING_PROJECT_ID);
    expect(QA_PROJECT_REF).not.toBe(PRODUCTION_PROJECT_ID);
  });
});

describe('QA run lock — which runs claim it', () => {
  it('claims for integration runs, however they are named', () => {
    expect(qaDatabaseIsInScope(['node', 'vitest', 'run', 'tests/integration'])).toBe(true);
    expect(qaDatabaseIsInScope(['node', 'vitest', 'run', 'tests/integration/rbacFoundation.test.ts'])).toBe(true);
    expect(qaDatabaseIsInScope(['node', 'vitest', 'run'])).toBe(true);
  });

  it('does not claim for a unit-only run — the CI gates job must not hold a database lock', () => {
    expect(qaDatabaseIsInScope(['node', 'vitest', 'run', 'tests/unit', '--reporter=verbose'])).toBe(false);
    expect(qaDatabaseIsInScope(['node', 'vitest', 'run', 'tests/unit/qaRunLock.test.ts'])).toBe(false);
  });
});
