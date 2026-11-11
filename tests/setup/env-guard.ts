/**
 * Environment Guard for tests and CI — shared across every test file.
 *
 * This used to re-implement the project check with its own copies of the project ids, which meant
 * the app and the tests could disagree about which project was production and neither would
 * notice. It now delegates to the one contract both sides use
 * (src/lib/environmentContract.ts), so a rule can only be changed in one place.
 *
 * NEVER modify this to skip validation.
 */

import {
  DEVELOPMENT_LOCAL_PROJECT_ID,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  extractProjectId,
  projectIdFromKey,
} from "../../src/lib/environmentContract";

export { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID };

/** A build/test target that is not allowed to be production. */
export function assertNotProduction(url: string, anonKey?: string | null): string {
  const projectId = extractProjectId(url);
  if (!projectId) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Cannot determine Supabase project from URL: ${url}`,
    );
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Tests must NOT run against PRODUCTION. ` +
        `Connected to: ${projectId} (${url}). Point the test target at staging.`,
    );
  }
  // A URL from one project with a key from another is the misconfiguration that produces a
  // confusing 401 rather than a clear failure, so it is caught here too.
  const keyProjectId = projectIdFromKey(anonKey);
  if (keyProjectId && keyProjectId !== projectId) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] The anon key belongs to "${keyProjectId}" but the URL points at ` +
        `"${projectId}". One of the two is from the wrong environment.`,
    );
  }
  return projectId;
}

/**
 * Assert the given Supabase URL points at the staging project.
 *
 * Named `assertQaProject` because QA is what this target has always been called in this repo; the
 * environment it now belongs to is staging. Kept under this name so the E2E helpers and
 * `tests/setup/qa-client.ts` that call it keep working unchanged.
 */
export function assertQaProject(url: string): string {
  const projectId = assertNotProduction(url);
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected the staging project ${STAGING_PROJECT_ID}. ` +
        `Connected to: ${projectId} (${url}).`,
    );
  }
  console.log(`[EnvGuard] Environment verified: ${projectId}`);
  return projectId;
}

/**
 * Assert the given Supabase URL points at the LOCAL stack — the Supabase CLI
 * stack on this machine — and nothing else.
 *
 * The local stack has no hosted project id: `extractProjectId` returns null
 * for `http://127.0.0.1:54321`, so `assertNotProduction` throws before the
 * staging comparison is even reached. This is therefore a separate function,
 * not a branch of `assertQaProject`, and the caller (`tests/setup/qa-client.ts`)
 * reaches it only when `QA_TARGET=local` names the target explicitly — a
 * localhost URL in a QA run must never pass silently.
 *
 * The rules, in the order they are checked:
 *   1. plain `http:` — the local stack serves no TLS; `https:` on loopback
 *      is a misconfiguration, not a local run;
 *   2. a loopback host (`127.0.0.1` or `localhost`) — any other host, even a
 *      private-network one, is not this machine's stack;
 *   3. port `54321` exactly — the CLI's API gateway port, named explicitly
 *      (no default-port guess: `http://127.0.0.1` with no port is refused);
 *   4. root path, no credentials, query, or hash — same strictness as the QA
 *      URL check;
 *   5. when the anon key names a hosted project, it must not be staging or
 *      production — a hosted key used against a local URL is a
 *      misconfiguration that would otherwise fail later as a confusing 401.
 *      A key that names nothing (local keys carry the local id, or no
 *      readable claim) passes: the URL check above is the binding constraint.
 */
export function assertLocalTarget(url: string, anonKey?: string | null): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[ENVIRONMENT MISMATCH] Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(
      `[ENVIRONMENT MISMATCH] The local stack serves plain http, not ${parsed.protocol} (${url}).`,
    );
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected the local stack on 127.0.0.1:54321. ` +
        `Connected to: ${parsed.hostname} (${url}).`,
    );
  }
  if (parsed.port !== '54321') {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected the local stack API port 54321. ` +
        `Connected to: ${parsed.host} (${url}).`,
    );
  }
  if (
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected the bare local stack URL http://127.0.0.1:54321. Got: ${url}.`,
    );
  }
  const keyProjectId = projectIdFromKey(anonKey);
  if (keyProjectId === STAGING_PROJECT_ID || keyProjectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] The anon key belongs to "${keyProjectId}" but the URL points at ` +
        `the local stack. One of the two is from the wrong environment.`,
    );
  }
  const projectId = DEVELOPMENT_LOCAL_PROJECT_ID ?? 'localdev';
  console.log(`[EnvGuard] Environment verified: local stack (${projectId})`);
  return projectId;
}

/**
 * Read a required variable from the test environment, or fail.
 *
 * A test helper with no target must stop, not silently pick one up from a local file left over
 * from a different environment.
 */
export function requireTestEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] ${name} is not set. Tests must name their target explicitly ` +
        `(see .env.example). There is no fallback, on purpose.`,
    );
  }
  return value.trim();
}
