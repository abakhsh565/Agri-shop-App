/**
 * Environment Guard — prevents accidental production access.
 *
 * Problem this solves:
 *   The dev server defaults to the hardcoded project in utils/supabase/info.tsx.
 *   If no .env.local overrides are set, the browser silently connects to production.
 *   All tests then run against production data — producing false verification.
 *
 * How it works:
 *   On app startup, this module logs the connected Supabase project.
 *   In test/CI environments, it can be called to verify the expected project.
 *
 * NEVER modify this guard to skip validation.
 */

import { supabaseUrl } from "./supabase";

/** The QA Supabase project ID — update if the QA project changes. */
export const QA_PROJECT_ID = "bpybjrjenwccowvtrevu";

/** The production Supabase project ID. */
export const PRODUCTION_PROJECT_ID = "gkswcfljxlutkfdvvqng";

/**
 * Extract the project ID from a Supabase URL.
 * Handles: https://<project-id>.supabase.co
 */
export function extractProjectId(url: string): string | null {
  const match = url.match(/\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : null;
}

/**
 * Get the currently connected project ID.
 */
export function getCurrentProjectId(): string | null {
  return extractProjectId(supabaseUrl);
}

/**
 * Check whether the current connection is to the QA project.
 */
export function isQaProject(): boolean {
  return getCurrentProjectId() === QA_PROJECT_ID;
}

/**
 * Check whether the current connection is to production.
 */
export function isProductionProject(): boolean {
  return getCurrentProjectId() === PRODUCTION_PROJECT_ID;
}

/**
 * Log environment info on app startup.
 * In dev/QA mode: throws if connected to production.
 * In production mode: just logs (safe for end users).
 */
export function logEnvironmentInfo(): void {
  const projectId = getCurrentProjectId();
  const env = isProductionProject() ? "PRODUCTION" : isQaProject() ? "QA" : "UNKNOWN";

  console.log(
    `%c[EnvGuard] Connected to: ${env} (${projectId})`,
    isProductionProject()
      ? "color: red; font-weight: bold; font-size: 14px"
      : "color: green; font-weight: bold"
  );

  // In development mode (Vite dev), hard-fail if connected to production
  // This prevents the exact bug where .env.local is missing and tests hit production
  if (import.meta.env.DEV && isProductionProject()) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Dev server connected to PRODUCTION (${projectId}). ` +
      `Create .env.local with VITE_SUPABASE_URL pointing to QA. ` +
      `See .env.local.example for reference.`
    );
  }
}

/**
 * Assert the environment is QA. Throws if connected to production or unknown.
 * Can be called with an explicit URL (for tests) or uses the browser's supabaseUrl.
 *
 * Usage:
 *   assertQaEnvironment()           — browser (reads from supabase.ts)
 *   assertQaEnvironment(url)        — test/CI (reads from env var)
 */
export function assertQaEnvironment(urlOverride?: string): void {
  const url = urlOverride || supabaseUrl;
  const projectId = extractProjectId(url);
  if (!projectId) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Cannot determine Supabase project from URL: ${url}`
    );
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Tests must not run against PRODUCTION. ` +
      `Connected to: ${projectId} (${url}). ` +
      `Set the correct QA project URL in .env.local or environment variables.`
    );
  }
  if (projectId !== QA_PROJECT_ID) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Expected QA project ${QA_PROJECT_ID}. ` +
      `Connected to: ${projectId} (${url}).`
    );
  }
  // Correct environment confirmed
  console.log(`[EnvGuard] Environment verified: ${projectId}`);
}
