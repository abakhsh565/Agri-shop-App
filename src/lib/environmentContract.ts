/**
 * environmentContract.ts — what "which environment am I" means, and when it is a lie.
 *
 * One pure decision, used by three callers so they cannot drift apart:
 *
 *   • src/lib/envGuard.ts   — the browser, at app start, so a misconfigured build refuses to boot
 *   • vite.config.ts        — the build, so a misconfigured build never produces an artifact
 *   • tests/unit/*          — so every rule below has a failing case proving it is not vacuous
 *
 * Nothing here reads `import.meta.env` or `process.env`. It takes values and returns a verdict.
 * That is the whole point: the rules are testable without a build, and the caller that reads the
 * environment is a thin, obvious adapter.
 *
 * WHY THIS EXISTS (read before relaxing anything):
 *   The app used to fall back to a hardcoded PRODUCTION project id when its env vars were
 *   missing, and only the Vite DEV server complained. A preview or staging deploy built without
 *   env vars therefore became production silently — with production's anon key, against real
 *   data, while showing no sign of it. Every rule below closes one of those doors.
 *
 *   The rules are deliberately asymmetrical. Development is only forbidden from talking to
 *   production; staging and production must land on their exact project, because those two are
 *   the ones a wrong build can hurt.
 */

export type AppEnvironment = "development" | "staging" | "production";

export const APP_ENVIRONMENTS: readonly AppEnvironment[] = [
  "development",
  "staging",
  "production",
];

/** How the phone verification code reaches a person. See src/lib/authMode.ts. */
export type OtpDelivery = "demo" | "sms";

// The `with { type: "json" }` attribute is required, not decorative: Node's native ESM loader
// (used by Playwright to load a TS test/config graph on Node 22+) refuses a JSON module without
// it, which took the whole browser suite down at import time.
import environmentConfig from "../../environments.json" with { type: "json" };

/**
 * The environment → project mapping lives in `environments.json`, not here.
 *
 * It moved because a second consumer needed it: the backup and restore tooling has to verify that
 * the database it actually reached is the one its environment claims. The bug that made that
 * necessary was a workflow called "Backup Production Database" running with staging credentials —
 * and nothing noticed, because "production" was a word in a filename rather than a value anyone
 * checked against. Two copies of this mapping would eventually disagree, and the disagreement
 * would be exactly that bug again. One file, read by the app, the build gate, the audit script and
 * the backup tooling.
 *
 * A project ref is not a secret. Credentials are not stored here.
 */
interface EnvironmentEntry {
  projectRef: string | null;
  status?: string;
  envPrefix?: string;
}

const ENTRY_BY_NAME: Record<string, EnvironmentEntry> =
  (environmentConfig as { environments?: Record<string, EnvironmentEntry> }).environments ?? {};

function refOf(name: AppEnvironment): string | null {
  const entry = ENTRY_BY_NAME[name];
  if (!entry) {
    throw new Error(
      `[ENVIRONMENT CONTRACT] environments.json has no entry for "${name}". The mapping is the ` +
        `only thing that says which project an environment may use, so it must be complete.`,
    );
  }
  return entry.projectRef ?? null;
}

/** The production Supabase project — a value that must never be *reached* outside production. */
export const PRODUCTION_PROJECT_ID = refOf("production") as string;

/** The project this repo's `.env.qa`, E2E lane and CI currently target — i.e. staging. */
export const STAGING_PROJECT_ID = refOf("staging") as string;

/**
 * There is no development project yet: `.env.local` still points at the staging one, which is
 * exactly the isolation gap recorded in PRODUCTION_READINESS_AUDIT.md for Phase 2. Until a real
 * development project exists there is no ref to demand, so the rule for development is only
 * "never production". Record it in environments.json and the "staging" rule applies to it too.
 */
export const DEVELOPMENT_PROJECT_ID: string | null = refOf("development");

/** The project each environment must land on, when we know it. `null` = no ref to enforce yet. */
export function expectedProjectFor(environment: AppEnvironment): string | null {
  switch (environment) {
    case "development":
      return DEVELOPMENT_PROJECT_ID;
    case "staging":
      return STAGING_PROJECT_ID;
    case "production":
      return PRODUCTION_PROJECT_ID;
  }
}

export interface EnvironmentInput {
  /** `VITE_APP_ENV` — the environment this build belongs to. */
  appEnv?: string | null;
  /** `VITE_SUPABASE_URL`. */
  supabaseUrl?: string | null;
  /** `VITE_SUPABASE_PROJECT_ID` — CI names the project instead of the URL. */
  supabaseProjectId?: string | null;
  /** `VITE_SUPABASE_ANON_KEY`. */
  supabaseAnonKey?: string | null;
  /** `VITE_OTP_DELIVERY` — `sms` in production, `demo` only where demo sign-in is intended. */
  otpDelivery?: string | null;
}

export type EnvironmentFailureCode =
  | "ENV_NAME_MISSING"
  | "ENV_NAME_UNKNOWN"
  | "SUPABASE_URL_MISSING"
  | "SUPABASE_ANON_KEY_MISSING"
  | "PROJECT_ID_UNREADABLE"
  | "CREDENTIALS_MISMATCHED"
  | "PRODUCTION_PROJECT_OUTSIDE_PRODUCTION"
  | "PRODUCTION_ENV_WRONG_PROJECT"
  | "STAGING_ENV_WRONG_PROJECT"
  | "DEMO_OTP_IN_PRODUCTION";

export interface EnvironmentOk {
  ok: true;
  environment: AppEnvironment;
  projectId: string;
  /** True once the anon key was decoded and agreed with the URL. */
  credentialsCrossChecked: boolean;
  otpDelivery: OtpDelivery;
}

export interface EnvironmentFailure {
  ok: false;
  code: EnvironmentFailureCode;
  message: string;
}

export type EnvironmentVerdict = EnvironmentOk | EnvironmentFailure;

/** Uppercase aliases (`PRODUCTION`, `Prod`) are a mistake, not a dialect. Match exactly. */
export function parseAppEnvironment(value: string | null | undefined): AppEnvironment | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (APP_ENVIRONMENTS as readonly string[]).includes(trimmed)
    ? (trimmed as AppEnvironment)
    : null;
}

/**
 * The project ref inside a Supabase URL: `https://<ref>.supabase.co` → `<ref>`.
 * Returns null for anything that is not that shape, so callers must decide what "unknown" means.
 */
export function extractProjectId(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const match = url.match(/\/\/([a-z0-9]+)\.supabase\.(co|in)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * The project ref named by either a Supabase URL or a bare project ref.
 *
 * One implementation, because the app (src/lib/supabase.ts), the guard (src/lib/envGuard.ts) and
 * the build gate all have to answer "which project is this?" and three answers would eventually
 * disagree — which is the whole class of defect this phase exists to remove.
 */
export function projectIdFromTarget(value: string | null | undefined): string | null {
  const direct = extractProjectId(value);
  if (direct) return direct;
  if (typeof value !== "string" || !value.trim()) return null;
  return extractProjectId(`https://${value.trim()}.supabase.co`);
}

/**
 * The project ref a Supabase key belongs to, read from its own claims.
 *
 * Two key formats exist and both are handled: the legacy JWT, whose payload carries `ref`, and
 * the newer `sb_publishable_…` key, which carries no readable claim at all. A key we cannot read
 * returns null — never a guess, and never a failure, because not being able to check is a
 * different thing from having checked and found a contradiction.
 */
export function projectIdFromKey(key: string | null | undefined): string | null {
  if (typeof key !== "string") return null;
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  const json = decodeBase64Url(parts[1]);
  if (json === null) return null;
  try {
    const payload = JSON.parse(json) as { ref?: unknown };
    return typeof payload.ref === "string" ? payload.ref.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * base64url → UTF-8 text, in whichever runtime this is.
 *
 * `atob` exists in the browser and in Node 16+; `Buffer` exists only in Node. Both are tried so
 * the same rule can be evaluated in the app and in the build config without a polyfill.
 */
function decodeBase64Url(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    if (typeof atob === "function") {
      const binary = atob(padded);
      return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    }
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function fail(code: EnvironmentFailureCode, message: string): EnvironmentFailure {
  return { ok: false, code, message };
}

/**
 * Decide whether this configuration is one we are willing to run.
 *
 * Order matters: the most specific, most dangerous condition is reported first so the message
 * names the real problem instead of the first thing that happened to be missing.
 */
export function resolveEnvironment(input: EnvironmentInput): EnvironmentVerdict {
  const environment = parseAppEnvironment(input.appEnv);
  if (input.appEnv === undefined || input.appEnv === null || String(input.appEnv).trim() === "") {
    return fail(
      "ENV_NAME_MISSING",
      "VITE_APP_ENV is not set. It must be exactly one of: development, staging, production. " +
        "The app will not guess, because guessing is how a staging build reaches production.",
    );
  }
  if (!environment) {
    return fail(
      "ENV_NAME_UNKNOWN",
      `VITE_APP_ENV is "${String(input.appEnv).trim()}", which is not one of: ` +
        `${APP_ENVIRONMENTS.join(", ")}. Refusing to run in an environment it cannot name.`,
    );
  }

  const providedUrl = typeof input.supabaseUrl === "string" ? input.supabaseUrl.trim() : "";
  const providedProjectId =
    typeof input.supabaseProjectId === "string" ? input.supabaseProjectId.trim() : "";

  // A build may name the project instead of the URL (CI does). That is still an explicit choice
  // by the build — nothing is inferred — so it is accepted here exactly as src/lib/supabase.ts
  // accepts it. What is refused is having neither, which is the case the old fallback answered
  // with the production project.
  const urlProjectId =
    projectIdFromTarget(providedUrl) ?? projectIdFromTarget(providedProjectId);

  if (!providedUrl && !providedProjectId) {
    return fail(
      "SUPABASE_URL_MISSING",
      "Neither VITE_SUPABASE_URL nor VITE_SUPABASE_PROJECT_ID is set. There is no fallback " +
        "project: this build will not connect anywhere it was not explicitly told to connect.",
    );
  }

  if (!urlProjectId) {
    return fail(
      "PROJECT_ID_UNREADABLE",
      `Cannot read a Supabase project id from this build's config ` +
        `(VITE_SUPABASE_URL="${providedUrl}", VITE_SUPABASE_PROJECT_ID="${providedProjectId}"). ` +
        "Expected https://<project-ref>.supabase.co or a bare project ref.",
    );
  }

  const key = typeof input.supabaseAnonKey === "string" ? input.supabaseAnonKey.trim() : "";
  if (!key) {
    return fail(
      "SUPABASE_ANON_KEY_MISSING",
      "VITE_SUPABASE_ANON_KEY is not set. There is no bundled fallback key.",
    );
  }

  // A URL from one project with a key from another is a misconfiguration that would otherwise
  // look like a successful build and fail later as a confusing 401.
  const keyProjectId = projectIdFromKey(key);
  const credentialsCrossChecked = keyProjectId !== null;
  if (keyProjectId && keyProjectId !== urlProjectId) {
    return fail(
      "CREDENTIALS_MISMATCHED",
      `VITE_SUPABASE_ANON_KEY belongs to project "${keyProjectId}" but VITE_SUPABASE_URL points ` +
        `at "${urlProjectId}". One of the two is from the wrong environment.`,
    );
  }

  // Never reach production from anywhere else — this is the rule the old fallback broke.
  if (environment !== "production" && urlProjectId === PRODUCTION_PROJECT_ID) {
    return fail(
      "PRODUCTION_PROJECT_OUTSIDE_PRODUCTION",
      `Refusing to start: this is a "${environment}" build but it points at the PRODUCTION ` +
        `Supabase project (${PRODUCTION_PROJECT_ID}). Point it at its own project.`,
    );
  }

  if (environment === "production" && urlProjectId !== PRODUCTION_PROJECT_ID) {
    return fail(
      "PRODUCTION_ENV_WRONG_PROJECT",
      `Refusing to start: this is a "production" build but it points at "${urlProjectId}", ` +
        `which is not the production project (${PRODUCTION_PROJECT_ID}).`,
    );
  }

  if (environment === "staging" && urlProjectId !== STAGING_PROJECT_ID) {
    return fail(
      "STAGING_ENV_WRONG_PROJECT",
      `Refusing to start: this is a "staging" build but it points at "${urlProjectId}", ` +
        `not the staging project (${STAGING_PROJECT_ID}).`,
    );
  }

  // Production authenticates with real codes. A shared constant is a login bypass, not a
  // convenience — see authMode.ts. Missing counts as demo, because missing is the dangerous case.
  const otpDelivery: OtpDelivery = input.otpDelivery === "sms" ? "sms" : "demo";
  if (environment === "production" && otpDelivery !== "sms") {
    return fail(
      "DEMO_OTP_IN_PRODUCTION",
      "Refusing to start: a production build must set VITE_OTP_DELIVERY=sms. Without it the app " +
        "would accept the shared demo code for any registered phone number, which is a login " +
        "bypass.",
    );
  }

  return { ok: true, environment, projectId: urlProjectId, credentialsCrossChecked, otpDelivery };
}

/** The resolved verdict for the environment this code is running in (browser/build side). */
export function readEnvironmentInput(env: Record<string, unknown>): EnvironmentInput {
  return {
    appEnv: (env.VITE_APP_ENV as string | undefined) ?? null,
    supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) ?? null,
    supabaseProjectId: (env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? null,
    supabaseAnonKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? null,
    otpDelivery: (env.VITE_OTP_DELIVERY as string | undefined) ?? null,
  };
}
