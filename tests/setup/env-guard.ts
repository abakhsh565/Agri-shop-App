/**
 * Environment Guard for Test/CI — shared across all test files.
 *
 * Prevents tests from accidentally running against the production Supabase project.
 * Used by qa-client.ts, e2e/helpers.ts, and any test setup.
 *
 * NEVER modify this to skip validation.
 */

const QA_PROJECT_ID = 'bpybjrjenwccowvtrevu';
const PRODUCTION_PROJECT_ID = 'gkswcfljxlutkfdvvqng';

/**
 * Assert the given Supabase URL points to the QA project.
 * Throws immediately with ENVIRONMENT MISMATCH if it doesn't.
 *
 * @param url - The Supabase project URL to validate
 */
export function assertQaProject(url: string): void {
  const projectId = url.match(/\/\/([^.]+)\.supabase\.co/)?.[1] ?? '';
  if (!projectId) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Cannot determine Supabase project from URL: ${url}`
    );
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Tests must NOT run against PRODUCTION. ` +
      `Connected to: ${projectId} (${url}). ` +
      `Set QA_SUPABASE_URL to the QA project.`
    );
  }
  if (projectId !== QA_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected QA project ${QA_PROJECT_ID}. ` +
      `Connected to: ${projectId} (${url}).`
    );
  }
  console.log(`[EnvGuard] Environment verified: ${projectId}`);
}
