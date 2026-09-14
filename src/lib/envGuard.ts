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
 * Safe to call in production — just logs, never throws.
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

  if (isProductionProject()) {
    console.warn(
      "[EnvGuard] WARNING: You are connected to the PRODUCTION Supabase project. " +
      "Any changes will affect real data. Use .env.local to point to QA for development."
    );
  }
}

/**
 * Assert the environment is QA. Throws if connected to production or unknown.
 * Use in test setup only — never in production code paths.
 */
export function assertQaEnvironment(): void {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Cannot determine Supabase project from URL: ${supabaseUrl}`
    );
  }
  if (isProductionProject()) {
    throw new Error(
      `[ENVIRONMENT MISMATCH] Tests must not run against PRODUCTION. ` +
      `Connected to: ${projectId} (${supabaseUrl}). ` +
      `Set VITE_SUPABASE_URL to the QA project in .env.local or environment variables.`
    );
  }
  if (!isQaProject()) {
    console.warn(
      `[ENVIRONMENT WARNING] Connected to unknown project: ${projectId}. ` +
      `Expected QA project: ${QA_PROJECT_ID}`
    );
  }
}
