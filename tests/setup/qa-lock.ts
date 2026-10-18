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
  try {
    await client.end();
  } catch {
    // Already closed, or never opened — either way there is nothing left to release.
  }
}
