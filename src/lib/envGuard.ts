/**
 * Environment Guard — the app refuses to boot against an environment it cannot name.
 *
 * This used to be a `console.log` plus a throw that only fired under `import.meta.env.DEV`. That
 * covered the Vite dev server and nothing else: a Vercel preview, a staging deploy or a release
 * APK built without env vars was a production build, talked to production, and showed no sign of
 * it. The rules now live in environmentContract.ts and apply to every build, not just dev.
 *
 * Behaviour, in order:
 *
 *   logEnvironmentInfo()  — called once at app start (src/App.tsx). Throws if the configuration
 *                           is not one we are willing to run. This is deliberate: a silent
 *                           degradation to "some other database" is worse than a screen that
 *                           says exactly what is wrong.
 *   assertEnvironment()   — the same check, callable from anywhere (tests, test setup).
 *   isDemoOtpAllowed()    — whether demo sign-in may exist here at all.
 *
 * NEVER relax a rule to make a build pass. If a build fails here, the build is wrong.
 */

import {
  APP_ENVIRONMENTS,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  extractProjectId,
  parseAppEnvironment,
  projectIdFromKey,
  projectIdFromTarget,
  readEnvironmentInput,
  resolveEnvironment,
  type AppEnvironment,
  type EnvironmentFailureCode,
  type EnvironmentVerdict,
} from "./environmentContract";

export {
  APP_ENVIRONMENTS,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  extractProjectId,
  projectIdFromKey,
  projectIdFromTarget,
  resolveEnvironment,
};
export type { AppEnvironment, EnvironmentFailureCode, EnvironmentVerdict };

export class EnvironmentConfigurationError extends Error {
  readonly code: EnvironmentFailureCode;

  constructor(code: EnvironmentFailureCode, message: string) {
    super(`[ENVIRONMENT MISMATCH] ${message}`);
    this.name = "EnvironmentConfigurationError";
    this.code = code;
  }
}

/** The values the app was built with. Read fresh each call, so tests can control them. */
function currentVerdict(): EnvironmentVerdict {
  return resolveEnvironment(readEnvironmentInput(import.meta.env as Record<string, unknown>));
}

/**
 * Throws unless this build knows which environment it is and is pointed at that environment's
 * project. Returns the verdict so callers can use the resolved names.
 */
export function assertEnvironment(): EnvironmentVerdict & { ok: true } {
  const verdict = currentVerdict();
  if (!verdict.ok) {
    throw new EnvironmentConfigurationError(verdict.code, verdict.message);
  }
  return verdict;
}

/** The environment this build belongs to, or null when it is unconfigured/unknown. */
export function currentEnvironment(): AppEnvironment | null {
  const verdict = currentVerdict();
  return verdict.ok ? verdict.environment : null;
}

/**
 * May this build accept the shared demo verification code?
 *
 * Only where a demo is intended: development and staging, never production. Note what this is
 * NOT — it is not the enforcement point. `authMode.ts` refuses to even resolve "demo" outside
 * those environments, and `auth.ts` re-checks before spending a code, so no UI condition and no
 * persisted value can turn this back on in a production build.
 */
export function isDemoOtpAllowed(): boolean {
  const environment = currentEnvironment();
  return environment === "development" || environment === "staging";
}

/** True when this build is connected to the production project. */
export function isProductionProject(): boolean {
  return getCurrentProjectId() === PRODUCTION_PROJECT_ID;
}

/** True when this build is connected to the staging project. */
export function isStagingProject(): boolean {
  return getCurrentProjectId() === STAGING_PROJECT_ID;
}

/**
 * The project id this build is actually connected to.
 *
 * Deliberately independent of `resolveEnvironment`: `isProductionProject()` must answer "yes"
 * even for a configuration the guard *rejects* (a staging build pointing at production), because
 * that is exactly the situation every caller of this function is trying to detect.
 */
export function getCurrentProjectId(): string | null {
  const input = readEnvironmentInput(import.meta.env as Record<string, unknown>);
  return projectIdFromTarget(input.supabaseUrl) ?? projectIdFromTarget(input.supabaseProjectId);
}

/**
 * Log which environment and project this build is connected to, and refuse to continue when they
 * do not agree. Called once, at module scope, in src/App.tsx.
 */
export function logEnvironmentInfo(): void {
  const verdict = assertEnvironment();
  const loud = verdict.environment === "production";

  console.log(
    `%c[EnvGuard] ${verdict.environment.toUpperCase()} → ${verdict.projectId}` +
      ` (otp: ${verdict.otpDelivery}${verdict.credentialsCrossChecked ? ", key verified" : ""})`,
    loud
      ? "color: red; font-weight: bold; font-size: 14px"
      : "color: green; font-weight: bold",
  );
}

/**
 * Assert that tests are not running against production, and that a given URL really belongs to
 * the project it claims. Kept for the E2E/test helpers that call it with an explicit URL.
 *
 * The environment name is optional: a test helper knows its URL but not which `VITE_APP_ENV` was
 * used to build the app under test, and demanding one there would produce a check that is
 * skipped rather than a check that runs.
 */
export function assertNotProduction(url?: string): string {
  const input = readEnvironmentInput(import.meta.env as Record<string, unknown>);
  const target = url ?? input.supabaseUrl ?? input.supabaseProjectId;
  const projectId = projectIdFromTarget(target);
  if (!projectId) {
    throw new EnvironmentConfigurationError(
      "PROJECT_ID_UNREADABLE",
      "This run has no Supabase URL or project id, so its project cannot be determined. " +
        "Set one explicitly rather than relying on a default.",
    );
  }
  if (projectId === PRODUCTION_PROJECT_ID) {
    throw new EnvironmentConfigurationError(
      "PRODUCTION_PROJECT_OUTSIDE_PRODUCTION",
      `Refusing to run: this target is the PRODUCTION project (${projectId}). ` +
        `Tests and tools must never write to production.`,
    );
  }
  return projectId;
}

/** Parse an environment name, for callers that need to validate one they were handed. */
export function readAppEnvironment(value: unknown): AppEnvironment | null {
  return parseAppEnvironment(typeof value === "string" ? value : null);
}
