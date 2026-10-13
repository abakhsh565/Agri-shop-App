/**
 * dev-server-identity.mjs — ONE answer to "is the server answering on this port the app I think it is?"
 *
 * WHY IT IS SHARED, AND WHY IT IS NOT A SOURCE SCAN
 *   A port is not an identity. Two separate gates decide whether a run may proceed against a dev
 *   server, and they used to decide it differently:
 *
 *     * the E2E run (`tests/e2e/global-setup.ts`) fetched a module of THIS repository from the server
 *       and read the environment Vite inlines into it — real evidence, per port;
 *     * `npm run preflight` read a `vite` command line **found anywhere on the machine**, so a
 *       `--mode qa` server on one port certified an unrelated server on another (measured
 *       2026-10-13: port 5273's default-mode server would have been reported as `qa`).
 *
 *   Two implementations of one rule eventually disagree, and the disagreement is exactly the bug
 *   above. Both callers now use the functions in this file; only the expected project id is passed
 *   in, and it comes from `environments.json` in both call sites.
 *
 * HOW IDENTITY IS ESTABLISHED — no new endpoint, no new server, no credentials
 *   Vite inlines the *resolved* environment at the top of every transformed module it serves
 *   (`import.meta.env = {"MODE": …, "VITE_SUPABASE_PROJECT_ID": …};`), so fetching one module of this
 *   repository reports what the server actually loaded:
 *     * `MODE`                    — `qa` only when it was started with `--mode qa`, which is what
 *                                   makes Vite load `.env.qa` at all;
 *     * `VITE_SUPABASE_PROJECT_ID` — must be the QA project (from `environments.json`);
 *     * `VITE_APP_ENV`             — must be the environment marker that goes with that project.
 *   A foreign application answers with its own page, a 404, or, when it is also a Vite app, an env
 *   block naming another project — and every one of those fails closed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   * It never terminates, restarts, or modifies another process. The port owner decides that.
 *   * It never prints the environment block: only `MODE`, `VITE_APP_ENV` and the project id are
 *     read out — identifiers, not credentials. The anon key sitting in the same block is never
 *     echoed, in a result object or in a diagnostic.
 */

/** A module every build of this app serves; its transformed form carries the env block. */
export const IDENTITY_MODULE_PATH = '/src/lib/envGuard.ts';

const PROBE_TIMEOUT_MS = 8000;

/**
 * Read only what identifies the server — never the whole environment block, which also carries the
 * anon key. A guard's diagnostic must not become a credential leak.
 */
export function extractIdentity(body) {
  const dump = /import\.meta\.env\s*=\s*(\{[\s\S]*?\});/.exec(body);
  if (!dump) return null;
  let env;
  try {
    env = JSON.parse(dump[1]);
  } catch {
    return null;
  }
  const asString = (value) => (typeof value === 'string' ? value : null);
  return {
    mode: asString(env.MODE),
    projectId: asString(env.VITE_SUPABASE_PROJECT_ID),
    appEnv: asString(env.VITE_APP_ENV),
  };
}

/**
 * The acceptance rule, kept separate so each clause can be pinned by a test.
 *
 * @param {{ mode: string|null, projectId: string|null, appEnv: string|null }} identity what the server served
 * @param {{ projectId: string, appEnv?: string }} expected the QA project (from environments.json) and its marker
 * @returns {string|null} why the server is not the QA server, or null when it is
 */
export function identityProblem(identity, expected) {
  if (identity.mode !== 'qa') {
    return `it was not started with --mode qa (MODE=${identity.mode ?? 'missing'}), so Vite never loaded .env.qa`;
  }
  if (identity.projectId !== expected.projectId) {
    return `it is reading project ${identity.projectId ?? '(none)'}, not the QA project ${expected.projectId}`;
  }
  if (expected.appEnv && identity.appEnv !== expected.appEnv) {
    return (
      `it reports VITE_APP_ENV=${identity.appEnv ?? 'missing'}, not ${expected.appEnv} — the project ` +
      'and the environment marker that must go with it disagree'
    );
  }
  return null;
}

/**
 * What a caller says when it will not use the server. Shared so the E2E run and preflight cannot
 * drift into saying different things about the same condition.
 *
 * @param {string} refusedBy `E2E` or `preflight`
 * @param {string} origin the origin that answered, e.g. `http://localhost:5174`
 * @param {string} problem the clause from {@link identityProblem}
 */
export function refusedServerMessage(refusedBy, origin, problem) {
  const port = (() => {
    try {
      return new URL(origin).port || '5173';
    } catch {
      return '5173';
    }
  })();
  return [
    `${refusedBy} refused to reuse the server on ${origin}: ${problem}.`,
    '',
    'Whatever is on that port is not this app in QA mode, so nothing was driven against it and no',
    'result about it would have meant anything. Nothing here terminates another process — the port',
    'owner decides when the port is free.',
    '',
    "Start this repository's QA-mode server (on any free port):",
    `  npx vite --mode qa --host 0.0.0.0 --port ${port}`,
  ].join('\n');
}

/**
 * @returns {Promise<{ listening: boolean, identity?: object, reason?: string }>}
 *   `listening: false` means nothing answered (callers decide whether that is fatal); `reason` is
 *   set when something answered but was not identifiable as this app.
 */
export async function probeDevServerIdentity(origin, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(`${origin}${IDENTITY_MODULE_PATH}`, {
      signal: controller.signal,
      headers: { accept: 'application/javascript' },
    });
  } catch {
    return { listening: false };
  } finally {
    clearTimeout(timer);
  }

  if (response.status !== 200) {
    return { listening: true, reason: `it answered HTTP ${response.status} for ${IDENTITY_MODULE_PATH}` };
  }

  const identity = extractIdentity(await response.text());
  if (!identity) {
    return {
      listening: true,
      reason: `${IDENTITY_MODULE_PATH} did not come back as this app's module (no environment block)`,
    };
  }
  return { listening: true, identity };
}

/**
 * Fail closed unless an *existing* server on the origin is positively this app's QA-mode server.
 *
 * @returns {Promise<object|null>} the verified identity, or null when nothing is listening
 * @throws when something answered and is not this app's QA server
 */
export async function assertServerIdentity(origin, expected, options = {}) {
  const { fetchImpl = fetch, refusedBy = 'E2E' } = options;
  const probe = await probeDevServerIdentity(origin, fetchImpl);
  if (!probe.listening) return null;

  const problem = probe.reason ?? identityProblem(probe.identity, expected);
  if (problem) throw new Error(refusedServerMessage(refusedBy, origin, problem));
  return probe.identity;
}
