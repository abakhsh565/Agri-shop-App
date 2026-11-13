/**
 * E2E global setup: the run refuses to reuse a dev server that is not this app's QA server.
 *
 * WHY THIS EXISTS
 *   `reuseExistingServer: true` means Playwright treats *anything* that answers on the base URL as
 *   "the server is already up". It cannot tell this app's QA-mode dev server from any other process
 *   holding the same port. Measured on 2026-10-13: the separate Farmer-App project's vite was
 *   listening on 5173, and an E2E run at that moment would have driven that foreign application
 *   through this suite's selectors — reporting failures, or worse, passes about the wrong product.
 *   `.freebuff/run.md` already warned that Playwright reuses a running server silently; this file
 *   makes that reuse conditional on a positive identity check.
 *
 * THE CHECK ITSELF LIVES IN ONE PLACE
 *   `scripts/lib/dev-server-identity.mjs` — the same identity contract `npm run preflight` uses, so
 *   the two gates cannot decide the same question differently. This file supplies only what is
 *   specific to the browser suite: that the expected project comes from the app's own environment
 *   contract, and that the run fails closed before a single test starts.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It never terminates, restarts, or modifies another process. The port owner decides that.
 *   * It never prints the environment block: only `MODE`, `VITE_APP_ENV` and the project id are read
 *     out — identifiers, not credentials. The anon key sitting in the same block is never echoed.
 *   * It does not start a server. When nothing answers, Playwright's own `webServer` starts this
 *     repository's QA-mode server exactly as before, so the reuse path is the only one guarded.
 *
 * THE RUN LOCK (2026-10-18)
 *   Playwright writes the same QA fixtures an integration run does, and until now it took no
 *   advisory lock: the `qa-database` concurrency group orders CI jobs, but it cannot see a
 *   developer's machine, so a local E2E run and a CI integration run could still delete each
 *   other's rows. After the identity check succeeds, this file claims the same lock
 *   `tests/setup/qa-lock.ts` already gives Vitest, and returns the release closure Playwright runs
 *   as the global teardown. No second lock implementation, no new id, no automatic recovery.
 *
 *   Order matters and mirrors the vitest setup: server identity, then which database, then whose
 *   lock. A foreign server is refused before a QA connection is even opened, and a wrong QA target
 *   is refused before the lock is asked for.
 */
import type { FullConfig } from '@playwright/test';
import { STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
import { environmentConfig } from '../../scripts/lib/environments.mjs';
import {
  claimVerifiedQaRunLock,
  closeQaClient,
  createQaClient,
  loadQaEnv,
  playwrightDatabaseIsInScope,
  QA_RUN_LOCK_ID,
  qaLockTargetProblem,
  releaseQaRunLock,
  type LockClient,
} from '../setup/qa-lock';
// The shared identity contract. Plain ESM on purpose: `npm run preflight` is a Node script and
// imports this same file, so there is exactly one implementation of the rule.
import {
  assertServerIdentity,
  identityProblem,
  probeDevServerIdentity,
  refusedServerMessage,
} from '../../scripts/lib/dev-server-identity.mjs';
import { QA_FIXTURE_USERS } from '../setup/qa-fixtures';

/** The documented default. The config decides the real origin, which may be another port. */
export const QA_DEV_SERVER_ORIGIN = 'http://localhost:5173';

/**
 * Expected identity of the QA server: the staging project (from `environments.json` via the app's
 * environment contract) and the environment marker that must accompany it — the E2E `webServer`
 * starts Vite with `VITE_APP_ENV: 'staging'`, and the lanes sign in through the real login flow
 * against that project.
 */
const EXPECTED = { projectId: STAGING_PROJECT_ID, appEnv: 'staging' };

// Re-exported for the guard tests and any caller that already imported them from here.
export { IDENTITY_MODULE_PATH, probeDevServerIdentity } from '../../scripts/lib/dev-server-identity.mjs';

export interface DevServerIdentity {
  mode: string | null;
  projectId: string | null;
  appEnv: string | null;
}

/** The acceptance rule, kept separate so the test can pin each clause. */
export function identityProblemFor(identity: DevServerIdentity): string | null {
  return identityProblem(identity, EXPECTED);
}

export function foreignServerDiagnostic(origin: string, problem: string): string {
  return refusedServerMessage('E2E', origin, problem);
}

/**
 * Fail closed unless an *existing* server on the origin is positively this app's QA-mode server.
 *
 * Returns the verified identity when a server was found and accepted, `null` when nothing was
 * listening (Playwright then starts the server itself), and throws a diagnostic otherwise: a
 * foreign application, a wrong-mode server, a wrong project, or an answer whose identity cannot be
 * established.
 */
export async function assertReusedServerIsOurs(
  origin: string = QA_DEV_SERVER_ORIGIN,
  fetchImpl: typeof fetch = fetch,
): Promise<DevServerIdentity | null> {
  return (await assertServerIdentity(origin, EXPECTED, { fetchImpl, refusedBy: 'E2E' })) as
    | DevServerIdentity
    | null;
}

/** What the claim needs that the real run supplies, and a test must be able to replace. */
export interface E2eQaLockDeps {
  argv?: readonly string[];
  loadEnv?: () => void;
  targetProblem?: () => string | null;
  createClient?: () => LockClient | null;
  /** `null` means "no cluster enrolled" — a subject of the refusal, not "use the default". */
  enrolled?: string | null;
  rehearsal?: boolean;
}

/** A held lock, and the one way to give it back. */
export interface E2eQaLock {
  release: () => Promise<void>;
}

/**
 * Claim the QA run lock for this Playwright run, or explain why this run must not start.
 *
 * Every failure path THROWS after closing whatever it opened: a run that cannot establish
 * exclusivity must stop before the first spec, not halfway through the suite where the damage is
 * already done. Returns `null` for an invocation that executes no tests (`--list`, `--help`,
 * `--version`) — it has nothing to coordinate, and holding the lock for a listing would block a
 * real run.
 *
 * The dependencies are injectable so the whole claim/refuse/release sequence is provable without a
 * database; the defaults are the exact helpers the vitest setup uses, so there is one lock
 * implementation and one set of refusal messages.
 */
export async function claimE2eQaRunLock(deps: E2eQaLockDeps = {}): Promise<E2eQaLock | null> {
  if (!playwrightDatabaseIsInScope(deps.argv ?? process.argv)) return null;

  (deps.loadEnv ?? loadQaEnv)();

  // WHICH DATABASE, before WHOSE LOCK — decided from configuration alone, so a mis-pointed target
  // is refused here instead of being coordinated with a database no other QA run uses.
  const targetProblem = (deps.targetProblem ?? qaLockTargetProblem)();
  if (targetProblem) throw new Error(`\n[E2E LOCK] ${targetProblem}\n`);

  const client = (deps.createClient ?? createQaClient)();
  if (!client) {
    throw new Error(
      '\n[E2E LOCK] QA credentials are missing (QA_DB_HOST / QA_DB_USER / QA_DB_PASS, or .env.qa).\n' +
        '  Playwright writes QA fixtures, so a run that cannot take the lock cannot know whether\n' +
        '  another run is mid-flight. This run stops here rather than sharing the database.\n',
    );
  }

  try {
    await client.connect();
  } catch (error) {
    await closeQaClient(client);
    throw new Error(
      '\n[E2E LOCK] QA could not be reached to take the run lock.\n' +
        `  ${(error as Error).message}\n` +
        '  Exclusivity cannot be established, so this run stops here rather than risk sharing QA.\n',
    );
  }

  // Identity is proven on this very session BEFORE the claim (the cluster fingerprint the pooler
  // cannot rewrite), exactly as the vitest setup does. A refused claim closes the session — it never
  // held the lock, so there is nothing to unlock.
  const result = await claimVerifiedQaRunLock(client, {
    enrolled:
      deps.enrolled !== undefined
        ? deps.enrolled
        : (environmentConfig('staging').clusterId ?? null),
    rehearsal: deps.rehearsal ?? process.env.QA_LOCK_DB_PORT !== undefined,
  });
  if (!result.ok) {
    await closeQaClient(client);
    throw new Error(`\n[E2E LOCK] ${result.reason}\n`);
  }

  console.log(
    `[e2e] claimed QA advisory lock ${QA_RUN_LOCK_ID} — this run has the QA database to itself.`,
  );

  // Playwright runs a function returned here as the global teardown. Returning it (rather than
  // naming a separate `globalTeardown` file) is what keeps this session: a separate module cannot
  // see this client, and the lock is session-scoped.
  return { release: () => releaseQaRunLock(client) };
}

/** What the setup needs that a test must be able to replace, so the ordering is provable. */
export interface E2eGlobalSetupDeps {
  claim?: () => Promise<E2eQaLock | null>;
  fixtureCheck?: () => Promise<void>;
}

/**
 * ONE PHONE, ONE SHOP — a fixture account must hold exactly one active membership.
 *
 * WHY THIS GATE EXISTS. On 2026-11-13 the fixture owner held TWO active shops (the QA shop and a
 * leftover "Baba jaani"). After sign-in the app sends a multi-shop account to `/login/business` and
 * only auto-opens when there is exactly ONE, so every lane that signed in as the owner waited 30 s
 * for a dashboard that was never coming: 87 of 144 specs failed in run 43409329236, almost none of
 * them about the feature they were named for. The suite reported a timeout, and the cause lived in
 * the database rather than in any spec.
 *
 * The cost of NOT having this check is measured, and it is not the failures — it is that the report
 * pointed at `education.spec.ts` and at auth-state leakage, both of which are symptoms. This gate
 * turns a 30-minute timeout storm into a two-second refusal that NAMES the phone and the extra
 * shop.
 *
 * It reads only. Removing the extra shop is an owner action (`qa:clean`-class, never a side effect
 * of a test run), so this never deletes anything to make itself pass.
 */
export async function assertFixtureAccountsHoldOneShop(
  deps: { loadEnv?: () => void; createClient?: () => LockClient | null } = {},
): Promise<void> {
  (deps.loadEnv ?? loadQaEnv)();
  const client = (deps.createClient ?? createQaClient)();
  // No credentials: the run lock below refuses this run with its own, clearer message.
  if (!client) return;

  const phones = QA_FIXTURE_USERS.map((row) => String(row.phone));
  await client.connect();
  try {
    const { rows } = await client.query(
      `select u.phone, m.tenant_id, s.name
         from memberships m
         join users u on u.id = m.user_id
         left join shops s on s.id = m.tenant_id
        where m.status = 'active' and u.phone = any($1::text[])
        order by u.phone, s.name`,
      [phones],
    );

    const shopsByPhone = new Map<string, string[]>();
    for (const row of rows) {
      const phone = String(row.phone);
      const label = String(row.name ?? row.tenant_id);
      shopsByPhone.set(phone, [...(shopsByPhone.get(phone) ?? []), label]);
    }

    const extra = [...shopsByPhone.entries()].filter(([, shops]) => shops.length > 1);
    if (extra.length) {
      throw new Error(
        '\n[E2E FIXTURES] one phone must answer for exactly ONE shop; these fixture accounts hold more:\n' +
          extra.map(([phone, shops]) => `  · ${phone} → ${shops.join(', ')}`).join('\n') +
          '\n  A multi-shop account is sent to the workspace chooser after sign-in, so a lane that\n' +
          '  expects a dashboard waits for one the app will not show. Remove the extra shop (an\n' +
          '  owner action) or correct the fixture — this run will not paper over it.\n',
      );
    }
  } finally {
    await closeQaClient(client);
  }
}

/**
 * The global setup body, in the order that matters: server identity, then the run lock.
 *
 * Split from the default export only so the wiring (`return claim?.release`) and the ordering (a
 * foreign server is refused before any QA connection is opened) can be asserted without a database
 * or a browser. A refusal from the identity check propagates before `claim` is ever called.
 */
export async function e2eGlobalSetup(
  config: FullConfig,
  deps: E2eGlobalSetupDeps = {},
): Promise<(() => Promise<void>) | void> {
  // Derive the origin from the config rather than assuming it, so a baseURL change cannot leave the
  // guard watching a port the suite no longer uses.
  let origin = QA_DEV_SERVER_ORIGIN;
  const baseURL = config.projects?.[0]?.use?.baseURL;
  if (typeof baseURL === 'string' && baseURL) {
    try {
      origin = new URL(baseURL).origin;
    } catch {
      /* keep the documented default */
    }
  }

  const identity = await assertReusedServerIsOurs(origin);
  if (identity) {
    console.log(
      `[e2e] reusing the running server on ${origin} — verified this app in QA mode (project ${identity.projectId}, env ${identity.appEnv}).`,
    );
  }

  // Only after the server is proven to be ours: a foreign server must never be accompanied by a
  // held QA lock, and a fixture account with two shops must be refused before any spec runs.
  await (deps.fixtureCheck ?? assertFixtureAccountsHoldOneShop)();
  const claim = await (deps.claim ?? claimE2eQaRunLock)();
  return claim?.release;
}

export default async function globalSetup(
  config: FullConfig,
): Promise<(() => Promise<void>) | void> {
  return e2eGlobalSetup(config);
}
