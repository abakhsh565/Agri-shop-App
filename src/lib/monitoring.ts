/**
 * Client error reporting — the smallest monitoring that can prove itself.
 *
 * WHAT THIS IS FOR
 *   Production had no error visibility at all: a crash on an owner's phone left nothing behind.
 *   This module records errors as rows in `client_error_events` (migration 0203), which every
 *   environment can already reach because Supabase is already the stack.
 *
 * THE THREE RULES THIS FILE EXISTS TO KEEP
 *
 *   1. MISSING CONFIGURATION MUST NOT LOOK LIKE WORKING MONITORING.
 *      `monitoringStatus()` answers `operational: false` with a reason when the environment is
 *      unknown or the client is unavailable. `reportClientError()` then returns
 *      `{ recorded: false, reason }` and sends nothing. A monitoring path that silently swallows
 *      errors while reporting success is worse than none, because it reads as coverage.
 *
 *   2. A MESSAGE CAN QUOTE A CUSTOMER. Only allow-listed keys reach `details`, and the payload is
 *      built from primitives here rather than spread from whatever the caller passed.
 *
 *   3. QA AND PRODUCTION MUST BE DISTINGUISHABLE. Every event carries the environment it happened
 *      in, and the column is constrained to the three real names, so a staging event cannot be
 *      filtered into production's counts or the other way round.
 *
 * The pure functions below are exported so `tests/unit/monitoringPrivacy.test.ts` can prove the
 * rules, including that each one fails when broken.
 */

/** The only three environments the database accepts. Kept in step with the migration's CHECK. */
export const MONITORING_ENVIRONMENTS = ['development', 'staging', 'production'] as const;
export type MonitoringEnvironment = (typeof MONITORING_ENVIRONMENTS)[number];

/** The only keys that may travel in `details`. Anything else is dropped, not truncated. */
export const ALLOWED_DETAIL_KEYS = [
  'route',
  'component',
  'status',
  'error_name',
  'attempt',
  'online',
  'release_stage',
] as const;

/**
 * Keys that must never reach `details`, even accidentally. This is a denial list in addition to the
 * allow list: the allow list already excludes them, and naming them makes the intent reviewable and
 * gives the guard test something concrete to attack.
 */
export const FORBIDDEN_DETAIL_KEYS = [
  'phone',
  'email',
  'name',
  'customer',
  'customer_id',
  'customerId',
  'amount',
  'total',
  'balance',
  'password',
  'pin',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'key',
  'authorization',
  'address',
  'note',
  'notes',
] as const;

export interface ErrorEventInput {
  error: unknown;
  screen?: string;
  errorCode?: string;
  appVersion?: string;
  details?: Record<string, unknown>;
  userId?: string | null;
  shopId?: string | null;
  branchId?: string | null;
}

export interface ErrorEventRow {
  environment: MonitoringEnvironment;
  app_version: string | null;
  screen: string | null;
  error_code: string | null;
  message: string;
  user_id: string | null;
  shop_id: string | null;
  branch_id: string | null;
  details: Record<string, unknown>;
}

export interface MonitoringStatus {
  operational: boolean;
  environment: MonitoringEnvironment | null;
  /** Present whenever `operational` is false. Says why, in words an operator can act on. */
  reason: string;
}

const MAX_MESSAGE = 500;

/**
 * A stored diagnostic, not screen copy.
 *
 * This string is written to `client_error_events` and read by the service role; it is never
 * rendered, so it is deliberately not an i18n key. It is a named constant rather than an inline
 * `|| 'unknown error'` because that shape — a raw English string on the right of `||` — is the one
 * `tests/unit/microcopy.test.ts` exists to catch, and a real fallback that ships to a screen should
 * fail that guard rather than be tolerated by it.
 */
const UNKNOWN_ERROR_MESSAGE = 'unknown error';

/** The environment the app is running in, or null when it is not one this database accepts. */
export function resolveEnvironment(value: unknown): MonitoringEnvironment | null {
  return typeof value === 'string' && (MONITORING_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as MonitoringEnvironment)
    : null;
}

/**
 * Does monitoring actually work here? A missing or unrecognised environment is *not* operational —
 * it is the difference between "no errors" and "no idea".
 */
export function monitoringStatus(env: Record<string, unknown> | undefined): MonitoringStatus {
  const environment = resolveEnvironment(env?.VITE_APP_ENV);
  if (!environment) {
    return {
      operational: false,
      environment: null,
      reason:
        'monitoring is NOT operational: VITE_APP_ENV is not one of development, staging or ' +
        'production, so an event could not be labelled with the environment it happened in.',
    };
  }
  const url = env?.VITE_SUPABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    return {
      operational: false,
      environment,
      reason:
        'monitoring is NOT operational: VITE_SUPABASE_URL is unset, so there is nowhere to record ' +
        'an event.',
    };
  }
  return { operational: true, environment, reason: `monitoring is operational for ${environment}` };
}

/** A message, bounded. Never the raw object, so a huge payload cannot be used as storage. */
export function messageFrom(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  const text = (raw ?? '').trim();
  if (!text) return UNKNOWN_ERROR_MESSAGE;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

const errorName = (error: unknown): string =>
  error instanceof Error && error.name ? error.name : typeof error;

/**
 * Only allow-listed keys, only primitives. Objects and arrays are dropped rather than serialised,
 * because a nested object is where a phone number or an amount hides.
 */
export function scrubDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!details) return out;
  for (const key of ALLOWED_DETAIL_KEYS) {
    const value = details[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'string' ? value.slice(0, 200) : value;
    }
  }
  return out;
}

/** Build the row. Pure, so the guard test can read exactly what would be sent. */
export function buildErrorEvent(input: ErrorEventInput, environment: MonitoringEnvironment): ErrorEventRow {
  return {
    environment,
    app_version: input.appVersion ? input.appVersion.slice(0, 40) : null,
    screen: input.screen ? input.screen.slice(0, 120) : null,
    error_code: input.errorCode ? input.errorCode.slice(0, 80) : null,
    message: messageFrom(input.error),
    user_id: input.userId ?? null,
    shop_id: input.shopId ?? null,
    branch_id: input.branchId ?? null,
    details: { ...scrubDetails(input.details), error_name: errorName(input.error) },
  };
}

/** The row that proves the destination works. Deliberately obvious in a query. */
export const TEST_EVENT_CODE = 'MONITORING_TEST_EVENT';

export interface ReportResult {
  recorded: boolean;
  reason: string;
}

/**
 * Record an event, or say why nothing was recorded.
 *
 * The insert carries no `.select()`: the table is write-only for clients on purpose, so asking for
 * the row back would be asking for a permission that does not exist. Verification of the destination
 * is done by the service role, which is the only reader.
 */
export async function reportClientError(
  input: ErrorEventInput,
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Promise<ReportResult> {
  const status = monitoringStatus(env);
  if (!status.operational || !status.environment) return { recorded: false, reason: status.reason };
  try {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('client_error_events').insert(buildErrorEvent(input, status.environment));
    if (error) return { recorded: false, reason: `monitoring could not record the event: ${error.message}` };
    return { recorded: true, reason: `recorded a ${status.environment} event` };
  } catch (error) {
    return { recorded: false, reason: `monitoring failed: ${messageFrom(error)}` };
  }
}

/** Send the controlled self-test event and report whether it actually landed. */
export async function sendMonitoringSelfTest(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): Promise<ReportResult> {
  const status = monitoringStatus(env);
  if (!status.operational || !status.environment) return { recorded: false, reason: status.reason };
  return reportClientError(
    {
      error: new Error('controlled test event from monitoring self-check'),
      errorCode: TEST_EVENT_CODE,
      screen: 'monitoring:self-test',
      details: { release_stage: 'self-test', component: 'monitoring' },
    },
    env,
  );
}

export function buildTestEvent(environment: MonitoringEnvironment, screen = 'monitoring:self-test'): ErrorEventRow {
  return buildErrorEvent(
    {
      error: new Error('controlled test event from monitoring self-check'),
      errorCode: TEST_EVENT_CODE,
      screen,
      details: { release_stage: 'self-test', component: 'monitoring' },
    },
    environment,
  );
}
