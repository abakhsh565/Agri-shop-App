/**
 * errorReporting — the rules that decide whether a production break reaches a person.
 *
 * The defect these guard against is not a crash: it is a monitoring path that *looks* installed and
 * sends nothing. So every "off" state is asserted with its reason, the payload is attacked with the
 * fields most likely to carry a customer, and each redaction is paired with a control that shows the
 * assertion would fail if the scrubber were removed.
 *
 * The last group is a source scan, because two of the decisions live outside this module: the
 * release is injected by `vite.config.ts`, and the install order in `src/main.tsx` is what makes an
 * error before the first render reportable at all. Neither is visible to a behavioural test.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  ALLOWED_CONTEXTS,
  ALLOWED_TAGS,
  IGNORED_ERROR_PATTERNS,
  RELEASE_PREFIX,
  buildSentryOptions,
  errorReportingStatus,
  isIgnoredError,
  parseDsn,
  redactText,
  resolveRelease,
  resolveReleaseId,
} from '@/lib/errorReporting';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const DSN = 'https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/42';

const productionEnv = {
  VITE_APP_ENV: 'production',
  VITE_SENTRY_DSN: DSN,
  VITE_RELEASE: '4f9c2ab',
};

describe('a DSN is validated, never assumed', () => {
  test('a real DSN shape is accepted', () => {
    expect(parseDsn(DSN)).toEqual({ host: 'o1.ingest.sentry.io', projectId: '42' });
  });

  test.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL', 'sentry-dsn-goes-here'],
    ['no public key', 'https://o1.ingest.sentry.io/42'],
    ['no project id', 'https://key@o1.ingest.sentry.io/'],
    ['wrong scheme', 'ftp://key@o1.ingest.sentry.io/42'],
    ['a bare key', '0123456789abcdef0123456789abcdef'],
  ])('rejects %s', (_label, value) => {
    expect(parseDsn(value)).toBeNull();
  });

  test('the public key is not among the values it returns', () => {
    const parsed = parseDsn(DSN);
    // The key is public in Sentry's model, but nothing here needs it, and a value that is not kept
    // cannot be logged by accident.
    expect(JSON.stringify(parsed)).not.toContain('0123456789abcdef0123456789abcdef');
  });
});

describe('the release is named, and can only be a release-shaped value', () => {
  test('VITE_RELEASE wins and carries the shared prefix', () => {
    expect(resolveReleaseId(productionEnv)).toBe('4f9c2ab');
    expect(resolveRelease(productionEnv)).toBe(`${RELEASE_PREFIX}4f9c2ab`);
  });

  test('an empty value is no release rather than a blank tag', () => {
    expect(resolveReleaseId({ VITE_RELEASE: '   ' })).toBeNull();
    expect(resolveRelease({})).toBeNull();
  });

  test.each([
    'has spaces in it',
    'semi;colon',
    'slash/inside',
    'quote"inside',
    'a'.repeat(61),
  ])('refuses %s as a release id', (value) => {
    expect(resolveReleaseId({ VITE_RELEASE: value })).toBeNull();
  });
});

describe('missing configuration is NOT operational, and says why', () => {
  test('no DSN: disabled, and the reason names the consequence', () => {
    const status = errorReportingStatus({ ...productionEnv, VITE_SENTRY_DSN: '' });
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('NOT enabled');
    expect(status.reason).toContain('VITE_SENTRY_DSN');
    // The database record is not what is missing; notification is.
    expect(status.reason).toContain('client_error_events');
  });

  test('a malformed DSN is refused rather than half-installed', () => {
    const status = errorReportingStatus({ ...productionEnv, VITE_SENTRY_DSN: 'not-a-dsn' });
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('not a DSN');
  });

  test('an unnamed environment is refused', () => {
    const status = errorReportingStatus({ VITE_SENTRY_DSN: DSN });
    expect(status.enabled).toBe(false);
    expect(status.reason).toContain('VITE_APP_ENV');
  });

  test('development is off unless someone asks for it out loud', () => {
    const quiet = errorReportingStatus({ VITE_APP_ENV: 'development', VITE_SENTRY_DSN: DSN });
    expect(quiet.enabled).toBe(false);
    expect(quiet.reason).toContain('VITE_SENTRY_DEV=true');

    const opted = errorReportingStatus({
      VITE_APP_ENV: 'development',
      VITE_SENTRY_DSN: DSN,
      VITE_SENTRY_DEV: 'true',
    });
    expect(opted.enabled).toBe(true);
  });

  test('a valid production configuration is operational and names the release', () => {
    const status = errorReportingStatus(productionEnv);
    expect(status.enabled).toBe(true);
    expect(status.environment).toBe('production');
    expect(status.release).toBe(`${RELEASE_PREFIX}4f9c2ab`);
    expect(status.reason).toContain('o1.ingest.sentry.io');
  });

  test('a release-less production build reports that the correlation is missing', () => {
    const status = errorReportingStatus({ ...productionEnv, VITE_RELEASE: undefined });
    expect(status.enabled).toBe(true);
    expect(status.release).toBeNull();
    expect(status.reason).toContain('no release id');
  });
});

describe('the initialisation options keep the privacy and cost choices', () => {
  test('nothing is installed when reporting is off', () => {
    const { options } = buildSentryOptions({});
    expect(options).toBeNull();
  });

  test('sampling is off, PII is off, breadcrumbs are off', () => {
    const { options } = buildSentryOptions(productionEnv);
    expect(options).not.toBeNull();
    expect(options).toMatchObject({
      environment: 'production',
      release: `${RELEASE_PREFIX}4f9c2ab`,
      sendDefaultPii: false,
      autoSessionTracking: false,
      maxBreadcrumbs: 0,
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      enableLogs: false,
    });
    expect(typeof options!.beforeSend).toBe('function');
    expect((options!.beforeBreadcrumb as () => unknown)()).toBeNull();
  });

  test('session tracking is removed, and the other integrations are kept', () => {
    // Measured in a real browser against a local sink: without this filter the SDK also POSTs
    // session envelopes carrying the visitor's user agent and `ip_address: {{auto}}`, which would
    // undo the scrubbing applied to every event.
    const filter = buildSentryOptions(productionEnv).options!.integrations as (
      list: Array<{ name: string }>,
    ) => Array<{ name: string }>;
    const remaining = filter([
      { name: 'GlobalHandlers' },
      { name: 'BrowserSession' },
      { name: 'Dedupe' },
    ]);
    expect(remaining.map((integration) => integration.name)).toEqual(['GlobalHandlers', 'Dedupe']);
  });

  test('the ignore list is real, not an empty array', () => {
    expect(IGNORED_ERROR_PATTERNS.length).toBeGreaterThan(0);
    expect(isIgnoredError(new Error('ResizeObserver loop limit exceeded'))).toBe(true);
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    expect(isIgnoredError(abort)).toBe(true);
    // And a defect is not on the list.
    expect(isIgnoredError(new Error("Cannot read properties of undefined (reading 'total')"))).toBe(
      false,
    );
  });
});

describe('what leaves the browser is an allow-list, not the event', () => {
  const event = {
    event_id: 'abc123',
    message: "Payment for 03001234567 failed; contact ali@example.com",
    request: { url: 'https://app.example/?phone=03001234567', cookies: { session: 'x' } },
    user: { id: 'u-1', email: 'ali@example.com', ip_address: '1.2.3.4' },
    extra: { customer_name: 'Ali', balance: 4200 },
    breadcrumbs: [{ category: 'console', message: 'token sb_publishable_abc123456789' }],
    modules: { react: '19.0.0' },
    server_name: 'vps-1',
    tags: { screen: '/sales/new', customer: 'Ali', error_code: 'SALE_FAILED' },
    contexts: {
      browser: { name: 'Chrome', version: '140' },
      os: { name: 'Android' },
      runtime: { name: 'browser' },
      device: { model: 'Pixel 8', carrier: 'Jazz' },
      culture: { locale: 'ur-PK' },
    },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'failed for 03001234567 / ali@example.com',
          mechanism: { type: 'onerror', handled: false, data: { phone: '03001234567' } },
          stacktrace: {
            frames: Array.from({ length: 60 }, (_, i) => ({ filename: 'app.js', lineno: i })),
          },
        },
      ],
    },
  };

  const scrubbed = () => {
    const beforeSend = buildSentryOptions(productionEnv).options!.beforeSend as (
      candidate: Record<string, unknown>,
    ) => Record<string, unknown>;
    return beforeSend(JSON.parse(JSON.stringify(event)) as Record<string, unknown>);
  };

  test('the control: the raw event really does carry every one of these fields', () => {
    // Without this, the assertions below could pass on an event that never had the data.
    expect(JSON.stringify(event)).toContain('03001234567');
    expect(JSON.stringify(event)).toContain('ali@example.com');
    expect(event.user).toBeDefined();
    expect(event.request).toBeDefined();
  });

  test('the high-risk fields are removed, not truncated', () => {
    const out = scrubbed();
    for (const key of ['request', 'user', 'extra', 'breadcrumbs', 'modules', 'server_name']) {
      expect(out[key], `${key} must not be transmitted`).toBeUndefined();
    }
  });

  test('contexts keep the browser and drop the device', () => {
    const out = scrubbed();
    expect(Object.keys(out.contexts as Record<string, unknown>).sort()).toEqual(
      [...ALLOWED_CONTEXTS].sort(),
    );
    expect(JSON.stringify(out)).not.toContain('Pixel 8');
  });

  test('tags keep the screen and code, and drop a customer name', () => {
    const out = scrubbed();
    expect(out.tags).toEqual({ screen: '/sales/new', error_code: 'SALE_FAILED' });
    expect(Object.keys(out.tags as Record<string, unknown>).every((key) =>
      (ALLOWED_TAGS as readonly string[]).includes(key),
    )).toBe(true);
  });

  test('every surviving string is redacted, including the exception message', () => {
    const out = scrubbed();
    const text = JSON.stringify(out);
    expect(text).not.toContain('03001234567');
    expect(text).not.toContain('ali@example.com');
    expect(text).not.toContain('sb_publishable_abc123456789');
    expect(text).toContain('[redacted-number]');
    expect(text).toContain('[redacted-email]');
  });

  test('the stack is bounded and its mechanism data is dropped', () => {
    const out = scrubbed();
    const values = (out.exception as { values: Array<Record<string, unknown>> }).values;
    expect(values).toHaveLength(1);
    expect((values[0].stacktrace as { frames: unknown[] }).frames).toHaveLength(40);
    expect(values[0].mechanism).toEqual({ type: 'onerror', handled: false });
  });

  test('a message is bounded, so a payload cannot be used as storage', () => {
    expect(redactText('x'.repeat(900)).length).toBe(500);
    expect(redactText('all good here')).toBe('all good here');
  });

  test('the redaction rules are not vacuous', () => {
    // Each of these is a shape the patterns must catch, and a near-miss they must leave alone.
    expect(redactText('call 03001234567')).toBe('call [redacted-number]');
    expect(redactText('call 0300-123-4567')).toBe('call [redacted-number]');
    expect(redactText('Bearer abcdef1234567890')).toContain('[redacted]');
    expect(redactText('sale total 4200')).toBe('sale total 4200');
    expect(redactText('2026-10-19T13:27:04Z')).toBe('2026-10-19T13:27:04Z');
    // A timestamp written with a space has the same 14 digits as a phone number; it must survive,
    // otherwise every alert would read `[redacted-number]` instead of when it happened.
    expect(redactText('2026-10-19 13:27:04 retry failed')).toBe('2026-10-19 13:27:04 retry failed');
    expect(redactText('+92 300 1234567')).toBe('[redacted-number]');
    expect(redactText('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });
});

describe('the install is wired where an early crash can reach it', () => {
  const main = read('src/main.tsx');

  test('reporting is initialised before the first render', () => {
    expect(main).toContain('initErrorReporting()');
    expect(main.indexOf('void initErrorReporting()')).toBeGreaterThan(-1);
    expect(main.indexOf('void initErrorReporting()')).toBeLessThan(
      main.indexOf('ReactDOM.createRoot'),
    );
  });

  test('both global handlers report, and the private record still gets the event', () => {
    expect(main).toContain("window.addEventListener('error'");
    expect(main).toContain("window.addEventListener('unhandledrejection'");
    expect(main).toContain('captureError(error');
    expect(main).toContain('reportClientError(');
  });

  test('the release id is passed to the record as well, so both name one commit', () => {
    expect(main).toContain('resolveReleaseId');
    expect(main).toContain('appVersion: releaseId');
  });
});

describe('the build injects the release, and uploads maps only when configured', () => {
  const config = read('vite.config.ts');

  test('the release comes from the build environment, never a literal', () => {
    expect(config).toContain('__APP_RELEASE__');
    expect(config).toContain('VERCEL_GIT_COMMIT_SHA');
    expect(config).toContain('GITHUB_SHA');
    // A hardcoded sha would be a build that lies about which commit it is.
    expect(config).not.toMatch(/__APP_RELEASE__:\s*JSON\.stringify\('[0-9a-f]{7,40}'\)/);
  });

  test('source-map upload is conditional on all three CI values', () => {
    expect(config).toContain('SENTRY_AUTH_TOKEN');
    expect(config).toContain('SENTRY_ORG');
    expect(config).toContain('SENTRY_PROJECT');
    expect(config).toContain('uploadSourcemaps');
    // A failed upload warns; it must not fail a release.
    expect(config).toContain('errorHandler');
  });

  test('no DSN is committed anywhere in shipped code', () => {
    const source = read('src/lib/errorReporting.ts');
    expect(source).toContain('VITE_SENTRY_DSN');
    expect(source).not.toMatch(/https:\/\/[0-9a-f]{32}@/);
  });
});
