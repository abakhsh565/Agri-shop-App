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
