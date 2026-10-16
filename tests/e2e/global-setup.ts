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
 */
import type { FullConfig } from '@playwright/test';
import { STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
// The shared identity contract. Plain ESM on purpose: `npm run preflight` is a Node script and
// imports this same file, so there is exactly one implementation of the rule.
import {
  assertServerIdentity,
  identityProblem,
  probeDevServerIdentity,
  refusedServerMessage,
} from '../../scripts/lib/dev-server-identity.mjs';

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

export default async function globalSetup(config: FullConfig): Promise<void> {
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
}
