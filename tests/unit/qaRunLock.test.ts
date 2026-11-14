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
  QA_LOCK_APPLICATION_NAME,
  QA_RUN_LOCK_ID,
  acquireQaRunLock,
  claimVerifiedQaRunLock,
  playwrightDatabaseIsInScope,
  qaClientConfig,
  qaClusterProblem,
  qaDatabaseIsInScope,
  qaLockTargetProblem,
  qaLockTargetRef,
  releaseQaRunLock,
  type LockClient,
} from '../setup/qa-lock';
import { QA_PROJECT_REF } from '../../scripts/dev/lib.mjs';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
import { environmentConfig } from '../../scripts/lib/environments.mjs';

/** The pooler host both CI and `.env.qa` use; it carries no ref, the user does. */
const POOLER = 'aws-0-ap-northeast-1.pooler.supabase.com';

/**
 * The cluster the guard must be given — read from `environments.json`, never restated here, so this
 * file cannot go on passing against a value the repository no longer enrols.
 */
const ENROLLED_CLUSTER_ID = environmentConfig('staging').clusterId;

/** A well-formed id that is not the enrolled one, for the mismatch cases. */
const OTHER_CLUSTER_ID = '1234567890123456789';

/** A client that answers the two statements this module sends, and records what it was asked. */
function fakeClient(
  options: {
    held?: boolean;
    failure?: string;
    unlockFails?: boolean;
    /** What `pg_control_system()` answers. `undefined` = the enrolled staging id. */
    clusterId?: string | null;
    /** What `pg_control_system()` throws instead of answering. */
    clusterError?: string;
  } = {},
) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  let ended = false;
  const client: LockClient = {
    async connect() {
      calls.push({ sql: 'connect' });
    },
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      if (options.failure) throw new Error(options.failure);
      if (/pg_control_system/.test(sql)) {
        if (options.clusterError) throw new Error(options.clusterError);
        return { rows: [{ id: options.clusterId === undefined ? ENROLLED_CLUSTER_ID : options.clusterId }] };
      }
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

describe('QA run lock — the cluster it is taken on', () => {
  it('reads the fingerprint first and claims second, on a cluster that matches', async () => {
    const { client, calls } = fakeClient();
    const result = await claimVerifiedQaRunLock(client, { enrolled: ENROLLED_CLUSTER_ID, rehearsal: false });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.sql)).toHaveLength(2);
    expect(calls[0].sql, 'identity must be read before the lock is even asked for').toMatch(/pg_control_system/);
    expect(calls[0].sql, 'the identity read must be a read-only statement').toMatch(/^select/i);
    expect(calls[1].sql).toMatch(/pg_try_advisory_lock/);
    expect(calls[1].values).toEqual([QA_RUN_LOCK_ID]);
  });

  it('refuses a different cluster and never asks for the lock', async () => {
    const { client, calls } = fakeClient({ clusterId: OTHER_CLUSTER_ID });
    const result = await claimVerifiedQaRunLock(client, { enrolled: ENROLLED_CLUSTER_ID, rehearsal: false });

    expect(result.ok).toBe(false);
    expect(calls.some((c) => /pg_try_advisory_lock/.test(c.sql)), 'a wrong cluster must not reach the claim').toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(OTHER_CLUSTER_ID);
    expect(result.reason).toContain(ENROLLED_CLUSTER_ID);
    expect(result.reason).toMatch(/No lock was taken/);
  });

  it('treats an empty answer as unverifiable, not as permission', async () => {
    const { client, calls } = fakeClient({ clusterId: null });
    const result = await claimVerifiedQaRunLock(client, { enrolled: ENROLLED_CLUSTER_ID, rehearsal: false });

    expect(result.ok).toBe(false);
    expect(calls.some((c) => /pg_try_advisory_lock/.test(c.sql))).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/without a cluster identity/);
  });

  it('fails closed when the fingerprint cannot be read, and names the permission it needs', async () => {
    const { client, calls } = fakeClient({ clusterError: 'permission denied for function pg_control_system' });
    const result = await claimVerifiedQaRunLock(client, { enrolled: ENROLLED_CLUSTER_ID, rehearsal: false });

    expect(result.ok).toBe(false);
    expect(calls.some((c) => /pg_try_advisory_lock/.test(c.sql))).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('permission denied for function pg_control_system');
    expect(result.reason).toMatch(/EXECUTE on pg_control_system\(\)/);
  });

  it('refuses when no cluster is enrolled, rather than comparing against nothing', () => {
    const problem = qaClusterProblem({
      observed: { id: ENROLLED_CLUSTER_ID, error: null },
      enrolled: null,
      rehearsal: false,
    });
    expect(problem).toMatch(/records no clusterId for "staging"/);
  });

  it('skips the fingerprint only on the rehearsal path — the local stack has its own cluster', async () => {
    const { client, calls } = fakeClient({ clusterId: 'some-local-cluster' });
    const result = await claimVerifiedQaRunLock(client, { enrolled: ENROLLED_CLUSTER_ID, rehearsal: true });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.sql), 'rehearsal must not touch the QA identity check').toHaveLength(1);
    expect(calls[0].sql).toMatch(/pg_try_advisory_lock/);

    // The decision itself also declines to compare on the rehearsal path, so a caller that reaches
    // it directly cannot turn a local cluster into a QA refusal.
    expect(
      qaClusterProblem({ observed: { id: OTHER_CLUSTER_ID, error: null }, enrolled: ENROLLED_CLUSTER_ID, rehearsal: true }),
    ).toBeNull();
  });

  it('accepts only the exact enrolled id — never a prefix or a superset', () => {
    const base = { observed: { id: ENROLLED_CLUSTER_ID, error: null }, enrolled: ENROLLED_CLUSTER_ID, rehearsal: false };
    expect(qaClusterProblem(base)).toBeNull();
    expect(qaClusterProblem({ ...base, observed: { id: `${ENROLLED_CLUSTER_ID}0`, error: null } })).toBeTruthy();
    expect(qaClusterProblem({ ...base, observed: { id: ENROLLED_CLUSTER_ID.slice(0, -1), error: null } })).toBeTruthy();
  });

  it('the staging cluster the guard compares against is actually enrolled', () => {
    // Without an enrolled id every real run refuses; that is the right behaviour, but it is worth a
    // failing test rather than a QA run discovering it.
    expect(environmentConfig('staging').clusterId).toBeTruthy();
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

  it('claims for a Playwright run that executes tests, whole suite or one spec', () => {
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test'])).toBe(true);
    expect(
      playwrightDatabaseIsInScope(['node', 'playwright', 'test', 'tests/e2e/dashboardScope.spec.ts', '--workers=1']),
    ).toBe(true);
    // The media capture config drives the same QA app through the same shared global setup.
    expect(
      playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--config=playwright.media.config.ts']),
    ).toBe(true);
  });

  it('does not claim when Playwright exits without running a spec', () => {
    // `--list` is used by the verification sequence: it must not block a real run behind it.
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--list'])).toBe(false);
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--list', '--reporter=json'])).toBe(false);
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--help'])).toBe(false);
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '-h'])).toBe(false);
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--version'])).toBe(false);
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '-V'])).toBe(false);
  });

  it('treats an argument it does not recognise as executing, not as a reason to skip', () => {
    expect(playwrightDatabaseIsInScope(['node', 'playwright', 'test', '--project=e2e'])).toBe(true);
    expect(playwrightDatabaseIsInScope([])).toBe(true);
  });
});

describe('QA run lock — the session it opens', () => {
  it('announces this module, so a refusal can name the holder instead of only the lock id', () => {
    const config = qaClientConfig({
      QA_DB_USER: `postgres.${QA_PROJECT_REF}`,
      QA_DB_PASS: 'p@ss:word',
      QA_DB_HOST: POOLER,
    });

    expect(config.application_name).toBe(QA_LOCK_APPLICATION_NAME);
    expect(config.application_name, 'the name must identify a QA run lock, not a generic client').toMatch(
      /qa-run-lock/,
    );
    expect(config.application_name).not.toContain(' ');
  });

  it('uses the same direct QA connection the teardown uses, with the password encoded', () => {
    const config = qaClientConfig({
      QA_DB_USER: `postgres.${QA_PROJECT_REF}`,
      QA_DB_PASS: 'p@ss:word',
      QA_DB_HOST: POOLER,
    });

    expect(config.connectionString).toContain(`${POOLER}:5432/postgres`);
    expect(config.connectionString, 'an unencoded password would split the URL at the colon').toContain(
      'p%40ss%3Aword',
    );
    expect(config.connectionString).not.toContain('p@ss:word');
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.connectionTimeoutMillis, 'the claim is bounded: no unbounded wait for a session').toBe(15000);
  });

  it('names the rehearsal port and drops TLS only when QA_LOCK_DB_PORT is set', () => {
    const rehearsal = qaClientConfig({ QA_DB_USER: 'postgres', QA_DB_PASS: 'x', QA_DB_HOST: '127.0.0.1', QA_LOCK_DB_PORT: '54322' });
    expect(rehearsal.connectionString).toContain('127.0.0.1:54322/postgres');
    expect(rehearsal.ssl).toBe(false);
    expect(rehearsal.application_name).toBe(QA_LOCK_APPLICATION_NAME);
  });
});
