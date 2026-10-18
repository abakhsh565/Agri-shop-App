/**
 * The QA run lock — one writer at a time against the shared QA database.
 *
 * WHY. On 2026-10-18 a local integration run and a CI integration run executed at the same time
 * against the one QA project. The suites delete each other's fixtures mid-assertion, so one genuine
 * failure came back as EIGHT files failing with `NOT_AUTHORIZED: tenant access denied`, and two
 * promotion attempts were spent on a problem that did not exist. The cost of that collision is
 * measured in hours of CI wall clock, and this is the smallest thing that removes it.
 *
 * HOW. A Postgres SESSION advisory lock over the direct connection `tests/setup/global-teardown.ts`
 * already opens (`QA_DB_HOST:5432`, session-mode pooler). It was probed against that exact host on
 * 2026-10-18 before this module was written:
 *
 *   - `pg_try_advisory_lock` returned true for the first connection and false for a second one;
 *   - it stayed false while the first sat idle AND ran ordinary queries, checked at 5s/12s/18s/25s/32s;
 *   - the backend pid did not change, which is why it holds — the 5432 pooler is session mode;
 *   - a connection killed without unlocking left nothing behind (session-scoped).
 *
 * A lock that cannot be taken is a FAKE lock, so two mechanisms were measured and rejected before
 * this one: Storage objects with `x-upsert: false` (two sequential uploads to the same path both
 * returned 200 — no conflict exists to lose), and `pg_advisory_lock` over the HTTP `run_sql` RPC
 * (each statement can land on a different backend, so a session lock is released immediately).
 *
 * IDENTITY, NOT JUST CONFIGURATION. A configured target can lie: the pooler rewrites `current_user`
 * to `postgres` and `current_setting('supabase.project_ref')` is NULL, so the credential's
 * `postgres.<ref>` is all the configuration names — and a host can be pointed elsewhere. So the
 * session that takes the lock also reads the physical cluster's fingerprint
 * (`pg_control_system().system_identifier`, which the pooler cannot rewrite) and refuses unless it
 * is the cluster enrolled for staging in `environments.json`. Measured against QA on 2026-10-18:
 * the lock's own connection shape answers it in one read-only statement, with EXECUTE available.
 *
 * NOT HERE YET, deliberately: terminating a stale session's backend. A run that is SIGKILLed cannot
 * release, and today that means waiting for the server to notice the dead socket. That recovery is
 * the next task, not this one.
 */

import pg from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PRODUCTION_PROJECT_ID } from '../../src/lib/environmentContract';
// The one QA project ref every QA tool in this repository refuses to work without
// (`scripts/dev/lib.mjs`, `scripts/lib/qa-connection.mjs`, the cleanup teardown).
import { QA_PROJECT_REF } from '../../scripts/dev/lib.mjs';

/**
 * The lock's identity. A literal, not an env var: both sides of the coordination — CI and a
 * developer's machine — must mean the same number, and a value that can differ per machine is a
 * value that silently stops coordinating. Chosen outside the small ids other tooling uses.
 */
export const QA_RUN_LOCK_ID = 918273645;

/** The hosts `QA_LOCK_DB_PORT` may name: the local stack, and nothing else. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * The project ref a lock connection names, or '' when it cannot be read.
 *
 * The same two shapes the QA tooling already resolves (`targetRefFromUrl` in
 * `scripts/dev/qa-tenant.mjs`, `qaPoolOptions` in `scripts/lib/qa-connection.mjs`): Supabase's
 * pooler names the project in the user (`postgres.<ref>`), and a direct connection names it in the
 * host (`db.<ref>.supabase.co`). The rule is re-stated here instead of imported because those
 * modules either build a pool of their own or run CLI code at import; this module has to decide
 * from configuration, before it dials anything.
 *
 * An unreadable value returns '' rather than a guess, so the caller refuses instead of proceeding.
 */
export function qaLockTargetRef(user: string | undefined, host: string | undefined): string {
  let decodedUser = user ?? '';
  try {
    decodedUser = decodeURIComponent(decodedUser);
  } catch {
    return ''; // a malformed percent-escape cannot name a project, and must not be guessed past
  }
  if (decodedUser.includes('.')) return decodedUser.split('.')[1] ?? '';

  const hostname = (host ?? '').trim().toLowerCase();
  const match =
    hostname.match(/^db\.([a-z0-9]{20})\.supabase\./) ?? hostname.match(/^([a-z0-9]{20})\.supabase\./);
  return match?.[1] ?? '';
}

/**
 * Why this run must not take the lock on the configured database — `null` when it may.
 *
 * THE GAP THIS CLOSES. The lock was taken on whatever `QA_DB_HOST` / `QA_DB_USER` named, so a
 * mis-pointed host coordinated with a database no other QA run uses and then ran the suite against
 * it. The teardown already refused a database that was not QA (`targetRef !== QA_PROJECT_REF`),
 * but only after the run — and only when it was about to delete, which is opt-in. The lock is the
 * first thing a run touches, so it is the right place to refuse a wrong target.
 *
 * Nothing here connects to or reads from anything: it decides from configuration, which is why the
 * refusal can be proved without reaching a database at all.
 *
 * Missing credentials return `null` on purpose: `createQaClient()` refuses those with `.env.qa` in
 * the message, and answering "not the QA project" instead would hide the actual fix.
 */
export function qaLockTargetProblem(
  env: { QA_DB_USER?: string; QA_DB_HOST?: string; QA_LOCK_DB_PORT?: string } = process.env,
): string | null {
  const user = env.QA_DB_USER ?? '';
  const host = (env.QA_DB_HOST ?? '').trim().toLowerCase();
  if (!user || !host) return null;

  // The rehearsal switch is how the lock was measured against the local stack. It opens an
  // UNENCRYPTED connection, so it may only ever name a loopback host — otherwise the switch would
  // be a way to take a lock, without TLS, on a remote project.
  if (env.QA_LOCK_DB_PORT !== undefined) {
    if (LOOPBACK_HOSTS.has(host)) return null;
    return (
      `QA_LOCK_DB_PORT is set — the local-stack rehearsal switch — but QA_DB_HOST is "${host}".\n` +
      '  That path connects without TLS and is meant for the stack on this machine, so it may only\n' +
      '  name a loopback host. Unset QA_LOCK_DB_PORT and let the run use the QA connection.'
    );
  }

  const ref = qaLockTargetRef(user, host);
  if (ref === QA_PROJECT_REF) return null;

  const production = ref === PRODUCTION_PROJECT_ID;
  return (
    `the lock would be taken on project "${ref || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).\n` +
    (production
      ? '  That ref is the PRODUCTION project. This run stops before the lock is taken, so nothing\n' +
        '  reaches production — not a lock, not a query, not a fixture delete.\n'
      : '') +
    '  QA_DB_USER / QA_DB_HOST (or .env.qa) point at another database, so this run would coordinate\n' +
    '  with a lock no other QA run uses, and then run the integration suite against that database.\n' +
    '  Point them at the QA project, or set QA_LOCK_DB_PORT=54322 to rehearse against the local stack.'
  );
}

/** The slice of a client this module needs, so the rules are testable without a database. */
export interface LockClient {
  /**
   * Opening the session is the caller's job, and it is not optional: `pg.Client.query()` throws
   * before `connect()`, so a claim attempted on a fresh client would fail closed with a message that
   * blamed QA rather than the wiring. This is why the interface names it.
   */
  connect(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export type AcquireResult = { ok: true } | { ok: false; reason: string };

/** What `pg_control_system()` answered, or why it could not be asked. */
export interface ClusterRead {
  id: string | null;
  error: string | null;
}

/**
 * Ask the live session which physical cluster it is on.
 *
 * The same statement `scripts/lib/environments.mjs` (`identifyConnection`) already uses for the
 * backup and restore targeting checks — one vocabulary for one measurement. Read-only: it reads
 * `pg_control_system()` and writes nothing, takes no lock, and changes no setting.
 *
 * A failure is returned, never thrown: the caller decides what a session that cannot be placed must
 * do, and that decision is "do not take the lock".
 */
export async function readQaClusterId(client: LockClient): Promise<ClusterRead> {
  try {
    const { rows } = await client.query('select system_identifier::text as id from pg_control_system()');
    const id = rows[0]?.id;
    return { id: typeof id === 'string' && id.trim() ? id.trim() : null, error: null };
  } catch (error) {
    return { id: null, error: (error as Error).message };
  }
}

/**
 * Why this session must not take the lock, judging by the cluster it is actually on — `null` when it
 * may.
 *
 * The fingerprint is the one identity the pooler cannot rewrite, so it closes the gap the
 * configuration check cannot: a `postgres.<ref>` username that names QA while the connection lands
 * on another cluster, and a credential copied from the wrong environment.
 *
 * Every unverifiable answer fails closed. A run that cannot be placed on the enrolled staging
 * cluster does not get to delete another run's fixtures, so the absence of a fingerprint is treated
 * exactly like a mismatch rather than as permission to proceed.
 *
 * Rehearsal against the local stack is skipped on purpose: that database has its own cluster id and
 * `environments.json` records none for it, and the rehearsal path is separately restricted to a
 * loopback host — so it can never be a hosted project wearing a local stack's name.
 */
export function qaClusterProblem(input: {
  observed: ClusterRead;
  enrolled: string | null;
  rehearsal: boolean;
}): string | null {
  if (input.rehearsal) return null;

  if (input.observed.error) {
    return (
      'QA could not be asked which cluster it is, so the target of this run cannot be verified.\n' +
      `  ${input.observed.error}\n` +
      '  The check needs EXECUTE on pg_control_system() for the QA role. Without it a lock could be\n' +
      '  taken on a database that is not the one enrolled for staging, so this run stops here.'
    );
  }

  if (!input.observed.id) {
    return (
      'QA answered without a cluster identity, so the target of this run cannot be verified.\n' +
      '  pg_control_system() returned no system_identifier. A run that cannot be placed on the\n' +
      '  enrolled staging cluster does not take the lock.'
    );
  }

  if (!input.enrolled) {
    return (
      'environments.json records no clusterId for "staging", so the cluster reached cannot be verified.\n' +
      '  Enrol it from a verified run (the backup tooling records the same value), then re-run.\n' +
      '  A lock is not taken against a target that cannot be checked.'
    );
  }

  if (input.observed.id !== input.enrolled) {
    return (
      `the database reached is cluster ${input.observed.id}, not the cluster enrolled for staging ` +
      `(${input.enrolled}).\n` +
      '  A credential can name one project while the connection lands on another; the cluster\n' +
      '  fingerprint is the identity the pooler cannot rewrite. If the QA project was migrated to a\n' +
      '  new instance, re-enrol the clusterId in environments.json deliberately, then re-run.\n' +
      '  No lock was taken.'
    );
  }

  return null;
}

/**
 * Take the lock for a session whose identity is proven first, or say why not.
 *
 * The order is the point, and it is asserted as ORDER in the unit tests: the fingerprint is read
 * before `pg_try_advisory_lock` is even sent, so a wrong target never holds — and never briefly
 * holds — the lock a real run depends on. Keeping the two steps in one function is what makes that
 * order testable without a database.
 */
export async function claimVerifiedQaRunLock(
  client: LockClient,
  options: { enrolled: string | null; rehearsal: boolean },
): Promise<AcquireResult> {
  // The read is skipped on the rehearsal path, not merely ignored after the fact: `qaClusterProblem`
  // would return early there, but evaluating its argument first would still send the identity query
  // to the local stack. A rehearsal must not send QA's identity statement anywhere — caught by this
  // file's own ordering test, which failed on the eager version.
  if (!options.rehearsal) {
    const problem = qaClusterProblem({
      observed: await readQaClusterId(client),
      enrolled: options.enrolled,
      rehearsal: false,
    });
    if (problem) return { ok: false, reason: problem };
  }

  return acquireQaRunLock(client);
}

/**
 * Does this vitest invocation reach QA at all?
 *
 * A unit-only run must NOT take the lock: the CI gates job is exactly that, and it never touches the
 * database — making it hold a database lock would be a lie about what it does, and would block a
 * real run behind a 10-second unit suite.
 */
export function qaDatabaseIsInScope(argv: readonly string[]): boolean {
  const paths = argv.filter((a) => a.startsWith('tests/'));
  if (!paths.length) return true; // no path filter: the whole suite, integration included
  return paths.some((p) => !p.startsWith('tests/unit'));
}

/**
 * Build the client the way the QA teardown does — same host, same port, same SSL posture.
 *
 * `QA_LOCK_DB_PORT` exists for ONE purpose: rehearsing the lock against the local stack (Postgres on
 * 54322), which is how the ordering claim was verified without touching QA. It cannot name another
 * database by itself — the host still comes from `QA_DB_HOST`, which every other QA tool in this
 * repository also trusts — so it is not a way to point the lock somewhere unexpected.
 */
export function createQaClient(): LockClient | null {
  const { QA_DB_USER, QA_DB_PASS, QA_DB_HOST, QA_LOCK_DB_PORT } = process.env;
  if (!QA_DB_USER || !QA_DB_PASS || !QA_DB_HOST) return null;
  const rehearsal = QA_LOCK_DB_PORT !== undefined;
  const port = QA_LOCK_DB_PORT ?? '5432';
  return new pg.Client({
    connectionString: `postgresql://${QA_DB_USER}:${encodeURIComponent(QA_DB_PASS)}@${QA_DB_HOST}:${port}/postgres`,
    // The local stack serves no TLS; QA's pooler requires it. Naming a rehearsal port is the switch,
    // so the two cannot be confused at call time.
    ssl: rehearsal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  }) as unknown as LockClient;
}

/** Load `.env.qa` the way the rest of the setup files do; CI provides real env vars instead. */
export function loadQaEnv(): void {
  if (process.env.QA_DB_HOST) return;
  const envPath = path.resolve(process.cwd(), '.env.qa');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

/**
 * Take the lock, or explain why this run must not start.
 *
 * Every failure path returns `ok: false` rather than throwing: the caller prints one message and
 * aborts. Nothing here touches a table — an advisory lock writes no rows, which is why a run that is
 * refused cannot have damaged anything by being refused.
 */
export async function acquireQaRunLock(client: LockClient): Promise<AcquireResult> {
  try {
    const { rows } = await client.query('select pg_try_advisory_lock($1) as ok', [QA_RUN_LOCK_ID]);
    if (rows[0]?.ok === true) return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason:
        'QA could not be asked who holds the run lock.\n' +
        `  ${(error as Error).message}\n` +
        '  Running anyway would mean running without knowing whether another run is mid-flight, so\n' +
        '  this run stops here.',
    };
  }

  return {
    ok: false,
    reason:
      'another QA run is in flight.\n' +
      `  It holds advisory lock ${QA_RUN_LOCK_ID} on the QA database.\n` +
      '  Two runs against one database delete each other\'s fixtures, which is how a single real\n' +
      '  failure came back as eight misleading ones on 2026-10-18.\n' +
      '  Wait for it to finish (the lock is released when that run ends, or when its session dies).',
  };
}

/**
 * Release, and close the session that holds it.
 *
 * Closing matters as much as unlocking: the lock is session-scoped, so ending the connection is what
 * makes a run that is killed later — with no teardown at all — leave nothing behind. Never throws:
 * this runs on the way out of a failing run, where a teardown error would replace the real failure.
 */
export async function releaseQaRunLock(client: LockClient): Promise<void> {
  try {
    await client.query('select pg_advisory_unlock($1)', [QA_RUN_LOCK_ID]);
  } catch {
    // The session ends below; an unlock that failed is covered by that.
  }
  await closeQaClient(client);
}

/**
 * End the session, and never throw while doing it.
 *
 * Separate from `releaseQaRunLock` because a session that never claimed the lock has nothing to
 * unlock: sending `pg_advisory_unlock` there asks the server to release a lock it does not own,
 * which is noise in the QA log for no gain. Closing is the whole job in that case.
 */
export async function closeQaClient(client: LockClient): Promise<void> {
  try {
    await client.end();
  } catch {
    // Already closed, or never opened — either way there is nothing left to release.
  }
}
