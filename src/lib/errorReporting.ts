/**
 * Production error reporting — the half of monitoring that tells a person.
 *
 * WHY THIS EXISTS
 *   `src/lib/monitoring.ts` already records errors in `client_error_events` (migration 0203). That
 *   table is a record, not an alert: it is write-only for clients and read by nobody on a schedule,
 *   so a release that breaks for every shop owner looks exactly like a quiet night. The gap is not
 *   detection — it is *notification*. This module sends the same events to a destination with
 *   alerting built in (Sentry), so a broken release becomes a page rather than a support call.
 *
 * WHY A VENDOR, WHEN THE LAST PHASE DELIBERATELY CHOSE THE DATABASE
 *   Because the repository deliberately holds no production read path (`docs/PRODUCTION_DATA_POLICY.md`
 *   §2). A watchdog that read `client_error_events` from CI would need a new production credential
 *   and a new exception in that policy. The browser sending an allow-listed payload outwards does
 *   not read production at all, so the policy stays exactly as written. The database row remains the
 *   private record; the vendor is the notification channel.
 *
 * THE RULES THIS FILE EXISTS TO KEEP
 *
 *   1. OFF IS OFF, AND IT SAYS SO.
 *      No DSN (or a DSN that is not a DSN, or an environment this build cannot name) means
 *      `enabled: false` and a reason in words. It never installs a handler that looks like coverage
 *      while dropping everything. This mirrors `monitoringStatus()` on purpose.
 *
 *   2. A MESSAGE CAN QUOTE A CUSTOMER.
 *      Nothing is forwarded as-sent. `scrubEvent()` removes the request, the user, free-form extra
 *      data and every breadcrumb, keeps only browser/OS/runtime context, and redacts e-mail
 *      addresses, phone-shaped digit runs, bearer tokens and Supabase-style keys out of every string
 *      it keeps — including the exception message, which is the one field most likely to quote a
 *      phone number. The rules are pure and exported so the guard test can attack them.
 *
 *   3. THE RELEASE MUST BE NAMED.
 *      Every event carries the commit it was built from (`VITE_RELEASE`, injected by `vite.config.ts`
 *      from the CI/Vercel build environment). Without it, "production is broken" cannot be tied to a
 *      deploy, and the rollback path in `deploy-production.yml` has no counterpart on the error side.
 *      A release-less production build is still reported, but `errorReportingStatus()` says the
 *      correlation is missing rather than pretending it exists.
 *
 * The SDK is loaded lazily: a deployment with no DSN pays for this module's decision logic only, not
 * for the Sentry client.
 */

/**
 * The environments this module can name. `development` is listed because the vendor accepts it as a
 * tag, but it is reachable only through the explicit `VITE_SENTRY_DEV=true` opt-in below —
 * development noise is the developer's, not the team's.
 */
export const REPORTING_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type ReportingEnvironment = (typeof REPORTING_ENVIRONMENTS)[number];

/** The prefix every release name uses, so a Sentry release is recognisably this app's. */
export const RELEASE_PREFIX = 'agrishop-app@';

/**
 * The only `contexts` groups forwarded. `device` is dropped: it can carry a carrier, a model and a
 * locale, and none of those are needed to reproduce a stack trace.
 */
export const ALLOWED_CONTEXTS = ['browser', 'os', 'runtime'] as const;

/** The only tags forwarded. Anything else a caller sets is dropped, not truncated. */
export const ALLOWED_TAGS = ['screen', 'error_code', 'app_env', 'release_stage', 'component'] as const;

/**
 * Errors that are not defects: the network dropping mid-request, a ResizeObserver loop warning, a
 * user aborting navigation. Reporting these is how an alert channel gets muted, which is worse than
 * having none. Deliberately short — anything not listed here is reported.
 */
export const IGNORED_ERROR_PATTERNS: readonly RegExp[] = [
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i,
  /^AbortError\b/i,
  /^NetworkError\b/i,
  /Load failed$/i,
  /^Failed to fetch$/i,
  /Non-Error promise rejection captured with value: (undefined|null)$/i,
];

export interface ErrorReportingStatus {
  /** True only when a valid DSN and a reporting environment were both resolved. */
  enabled: boolean;
  environment: ReportingEnvironment | null;
  /** `<prefix><commit sha>`, or null when the build did not carry one. */
  release: string | null;
  /** The DSN's host only — never the key. Safe to log and to show an operator. */
  host: string | null;
  /** Present whenever something is missing. Says what, in words an operator can act on. */
  reason: string;
}

interface ParsedDsn {
  /** `<scheme>://<public key>@<host>[/<path>]/<project id>` */
  host: string;
  projectId: string;
}

/**
 * Validate a DSN without ever keeping its public key.
 *
 * Sentry's DSN is a URL whose username is the public key and whose last path segment is the project
 * id. A value that does not have that shape is not a DSN, and treating it as one produces a client
 * that silently fails to send — the exact "looks like monitoring" failure rule 1 exists to prevent.
 */
export function parseDsn(value: unknown): ParsedDsn | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!url.username) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments[segments.length - 1] ?? '';
  if (!projectId) return null;
  return { host: url.host, projectId };
}

/** The environment name for the vendor, or null when this build cannot name its own environment. */
export function resolveReportingEnvironment(value: unknown): ReportingEnvironment | null {
  return typeof value === 'string' && (REPORTING_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as ReportingEnvironment)
    : null;
}

function sanitizeReleaseId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  // A commit sha, a tag, or a short version. Anything else is refused rather than trusted: the
  // value is rendered in an alert and used in a URL path by the vendor.
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(text)) return null;
  return text;
}

/**
 * The release this bundle belongs to.
 *
 * `VITE_RELEASE` wins because a workflow can set it explicitly; `__APP_RELEASE__` is what
 * `vite.config.ts` defines from `VERCEL_GIT_COMMIT_SHA` / `GITHUB_SHA` at build time, so a Vercel or
 * APK build is named without any dashboard configuration. The `typeof` guard keeps this importable
 * from a vitest process, where the define does not exist.
 */
export function resolveReleaseId(env: Record<string, unknown> | undefined): string | null {
  const explicit = sanitizeReleaseId(env?.VITE_RELEASE);
  if (explicit) return explicit;
  const injected = typeof __APP_RELEASE__ === 'string' ? __APP_RELEASE__ : '';
  return sanitizeReleaseId(injected);
}

/** The release name the vendor and its source maps share. */
export function resolveRelease(env: Record<string, unknown> | undefined): string | null {
  const id = resolveReleaseId(env);
  return id ? `${RELEASE_PREFIX}${id}` : null;
}

/**
 * Decide whether reporting works here, and say why not when it does not.
 *
 * `VITE_SENTRY_DEV=true` is the only way a development build reports, and it has to be said out
 * loud — development errors are the developer's, not the team's.
 */
export function errorReportingStatus(
  env: Record<string, unknown> | undefined,
): ErrorReportingStatus {
  const environment = resolveReportingEnvironment(env?.VITE_APP_ENV);

  if (!environment) {
    return {
      enabled: false,
      environment: null,
      release: resolveRelease(env),
      host: null,
      reason:
        'error reporting is NOT enabled: VITE_APP_ENV is not one of development, staging or ' +
        'production, so an event could not be labelled with the environment it happened in.',
    };
  }

  if (environment === 'development' && env?.VITE_SENTRY_DEV !== 'true') {
    return {
      enabled: false,
      environment,
      release: resolveRelease(env),
      host: null,
      reason:
        'error reporting is NOT enabled: this is a development build. Set VITE_SENTRY_DEV=true to ' +
        'report development errors, or run the production/staging build the alert is meant for.',
    };
  }

  const rawDsn = env?.VITE_SENTRY_DSN;
  if (rawDsn === undefined || rawDsn === null || String(rawDsn).trim() === '') {
    return {
      enabled: false,
      environment,
      release: resolveRelease(env),
      host: null,
      reason:
        `error reporting is NOT enabled for ${environment}: VITE_SENTRY_DSN is unset, so there is ` +
        'nowhere to send an event. The Supabase record in client_error_events still works, but ' +
        'nobody is notified.',
    };
  }

  const dsn = parseDsn(rawDsn);
  if (!dsn) {
    return {
      enabled: false,
      environment,
      release: resolveRelease(env),
      host: null,
      reason:
        'error reporting is NOT enabled: VITE_SENTRY_DSN is not a DSN. Expected ' +
        'https://<public key>@<host>/<project id>. A malformed value is refused rather than ' +
        'silently producing a client that sends nothing.',
    };
  }

  const release = resolveRelease(env);
  return {
    enabled: true,
    environment,
    release,
    host: dsn.host,
    reason: release
      ? `error reporting is operational for ${environment} at ${dsn.host}, release ${release}`
      : `error reporting is operational for ${environment} at ${dsn.host}, but this build carries ` +
        'no release id, so errors cannot be tied to a deploy (set VITE_RELEASE or build through ' +
        'CI/Vercel so the commit sha is injected).',
  };
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/**
 * Ten or more digits, optionally separated — a phone number, not a date or a uuid.
 *
 * The threshold is 10 digits because the shortest thing that must NOT be redacted is an ISO date
 * (`2026-10-19`, eight digits). A nine-digit run would have turned every timestamp in a message into
 * `[redacted-number]`, which would make the alert less useful than the defect it describes.
 */
const PHONE = /\+?\d(?:[\d\s().-]{8,})\d/g;
/** A date, optionally followed by a time. Matched by the phone rule's separator class; left alone. */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/;
/**
 * A uuid. This application puts record ids in messages, and a uuid's tail (`...-426614174000`) is
 * twelve digits — long enough for the phone rule to swallow. Redacting it would remove exactly the
 * value an operator needs to find the row, so uuids are lifted out before redaction and put back.
 */
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SUPABASE_KEY = /\b(?:sb_[a-z]+_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{20,})\b/g;

/**
 * Redact the things a stack trace can quote.
 *
 * Applied to every string that survives `scrubEvent()`. Order matters: the auth-header rule runs
 * before the generic phone rule so a token containing digits is replaced as a token.
 */
export function redactText(value: string, max = 500): string {
  const ids: string[] = [];
  let text = String(value).replace(UUID, (match) => {
    ids.push(match);
    return `\u0000${ids.length - 1}\u0000`;
  });

  text = text
    .replace(AUTH_HEADER, '$1 [redacted]')
    .replace(SUPABASE_KEY, '[redacted-token]')
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, (match: string, offset: number, whole: string) => {
      // The tail of a longer hex token (`a456-426614174000`) is an identifier fragment, not a phone.
      const before = offset > 0 ? whole[offset - 1] : '';
      if (before && /[0-9a-fA-F]/.test(before)) return match;
      return DATE_SHAPE.test(match.trim()) ? match : '[redacted-number]';
    });

  text = text.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => ids[Number(index)] ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function scrubRecord(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(scrubRecord);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubRecord(nested);
    }
    return out;
  }
  return value;
}

/** Keep only allow-listed context groups, scrubbed. */
export function scrubContexts(contexts: unknown): Record<string, unknown> {
  if (!contexts || typeof contexts !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_CONTEXTS) {
    const value = (contexts as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    out[key] = scrubRecord(value);
  }
  return out;
}

/** Keep only allow-listed tags, scrubbed. A caller's arbitrary tag is dropped, not sent. */
export function scrubTags(tags: unknown): Record<string, string> {
  if (!tags || typeof tags !== 'object') return {};
  const out: Record<string, string> = {};
  for (const key of ALLOWED_TAGS) {
    const value = (tags as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    out[key] = redactText(String(value), 120);
  }
  return out;
}

/** The exception list, with every message redacted and the mechanism's free-form data dropped. */
function scrubExceptions(exception: unknown): unknown {
  if (!exception || typeof exception !== 'object') return exception;
  const groups = exception as { values?: unknown };
  if (!Array.isArray(groups.values)) return { values: [] };
  return {
    values: groups.values.slice(0, 10).map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const item = { ...(entry as Record<string, unknown>) };
      if (typeof item.value === 'string') item.value = redactText(item.value);
      if (typeof item.type === 'string') item.type = redactText(item.type, 120);
      if (item.mechanism && typeof item.mechanism === 'object') {
        const mechanism = item.mechanism as Record<string, unknown>;
        item.mechanism = {
          type: typeof mechanism.type === 'string' ? mechanism.type : undefined,
          handled: typeof mechanism.handled === 'boolean' ? mechanism.handled : undefined,
        };
      }
      if (item.stacktrace && typeof item.stacktrace === 'object') {
        const frames = (item.stacktrace as { frames?: unknown }).frames;
        item.stacktrace = { frames: Array.isArray(frames) ? frames.slice(0, 40) : [] };
      }
      return item;
    }),
  };
}

/**
 * The one function allowed to decide what leaves the browser.
 *
 * The removals are the point: `request` (URLs with query strings, cookies), `user` (id, e-mail,
 * phone, IP), `extra` (whatever a caller attached), `breadcrumbs` (console arguments, fetch URLs),
 * `modules` (a fingerprint of the customer's toolchain and therefore a tracking surface), and
 * `server_name`. What remains is a stack trace, a redacted message, a named release, a screen, and
 * the browser that produced it — enough to fix the defect, not enough to identify the customer.
 */
export function scrubEvent(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...event };
  delete out.request;
  delete out.user;
  delete out.extra;
  delete out.breadcrumbs;
  delete out.modules;
  delete out.server_name;
  if (typeof out.message === 'string') out.message = redactText(out.message);
  if ('exception' in out) out.exception = scrubExceptions(out.exception);
  out.tags = scrubTags(out.tags);
  out.contexts = scrubContexts(out.contexts);
  return out;
}

/** True when the error is one of the non-defects in `IGNORED_ERROR_PATTERNS`. */
export function isIgnoredError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const name = error instanceof Error ? error.name : '';
  return IGNORED_ERROR_PATTERNS.some(
    (pattern) => pattern.test(message) || (name !== '' && pattern.test(name)),
  );
}

const MAX_MESSAGE = 500;

export interface CaptureContext {
  screen?: string;
  errorCode?: string;
  releaseStage?: string;
  component?: string;
}

export interface CaptureResult {
  reported: boolean;
  reason: string;
}

/**
 * The options handed to `Sentry.init`, built from the same decision as `errorReportingStatus`.
 *
 * Returned rather than applied so the guard test can call `beforeSend` itself and read exactly what
 * would be transmitted. `null` means "do not initialise" — never "initialise with defaults".
 */
export function buildSentryOptions(env: Record<string, unknown> | undefined): {
  status: ErrorReportingStatus;
  options: Record<string, unknown> | null;
} {
  const status = errorReportingStatus(env);
  if (!status.enabled) return { status, options: null };

  return {
    status,
    options: {
      dsn: String(env?.VITE_SENTRY_DSN).trim(),
      environment: status.environment,
      ...(status.release ? { release: status.release } : {}),
      sendDefaultPii: false,
      // Session tracking is not error reporting, and it is not harmless: measured against a local
      // sink (2026-10-19), the SDK sent an `init` and an `unhandled` session envelope alongside the
      // error, each carrying the visitor's user agent and `ip_address: {{auto}}` — the same data the
      // scrubber spends its time removing from events. `BrowserSession` is the integration that
      // sends them, so it is dropped. `autoSessionTracking` is kept because older SDK majors read it.
      autoSessionTracking: false,
      integrations: (integrations: Array<{ name?: string }>) =>
        integrations.filter((integration) => integration.name !== 'BrowserSession'),
      maxBreadcrumbs: 0,
      maxValueLength: MAX_MESSAGE,
      normalizeDepth: 3,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      enableLogs: false,
      attachStacktrace: true,
      ignoreErrors: IGNORED_ERROR_PATTERNS as RegExp[],
      beforeBreadcrumb: () => null,
      beforeSend: (event: Record<string, unknown>) => scrubEvent(event),
      initialScope: { tags: { app_env: status.environment } },
    },
  };
}

let started = false;
let sdk: typeof import('@sentry/react') | null = null;

/**
 * Install the handlers, once, and report whether they are installed.
 *
 * Only uncaught errors and unhandled rejections are captured; React components are not wrapped and
 * no transaction is started, so this cannot change render behaviour or the bundle's first paint.
 */
export async function initErrorReporting(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Promise<ErrorReportingStatus> {
  const { status, options } = buildSentryOptions(env);
  if (!options || started) return status;

  started = true;
  try {
    sdk = await import('@sentry/react');
    sdk.init(options as never);
    return status;
  } catch (error) {
    sdk = null;
    return {
      ...status,
      enabled: false,
      reason: `error reporting is NOT enabled: the Sentry client failed to load (${
        error instanceof Error ? error.message : String(error)
      }).`,
    };
  }
}

/**
 * Send one error, with the screen and code as tags and nothing else.
 *
 * Never throws and never waits for the network: a monitoring call must not become a second failure,
 * and `captureException` on the vendor's client is already fire-and-forget.
 */
export async function captureError(
  error: unknown,
  context: CaptureContext = {},
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Promise<CaptureResult> {
  if (isIgnoredError(error)) {
    return { reported: false, reason: 'the error is a known non-defect and was not reported' };
  }
  const status = await initErrorReporting(env);
  if (!status.enabled || !sdk) return { reported: false, reason: status.reason };

  try {
    sdk.captureException(error, {
      tags: scrubTags({
        screen: context.screen,
        error_code: context.errorCode,
        release_stage: context.releaseStage,
        component: context.component,
        app_env: status.environment,
      }),
    });
    return { reported: true, reason: `reported to ${status.host}` };
  } catch (failure) {
    return {
      reported: false,
      reason: `error reporting failed: ${
        failure instanceof Error ? failure.message : String(failure)
      }`,
    };
  }
}
