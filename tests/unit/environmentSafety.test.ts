/**
 * Environment safety — every door that used to lead to production, closed.
 *
 * These are the rules from src/lib/environmentContract.ts. Each test states the wrong
 * configuration that must be refused, and then the same configuration with exactly one field
 * corrected, which must be allowed. The second half is what makes the first half mean something:
 * a rule that refuses everything would pass a "must fail" assertion while being useless.
 *
 * The scenario these encode was real: `utils/supabase/info.tsx` defaulted to the production
 * project id and production publishable key, `VITE_APP_ENV` did not exist, and the only complaint
 * came from the Vite dev server. A preview or staging build with no env vars was therefore a
 * production build.
 */

import { describe, expect, test } from 'vitest';

import {
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  extractProjectId,
  parseAppEnvironment,
  projectIdFromKey,
  resolveEnvironment,
  type EnvironmentInput,
} from '@/lib/environmentContract';

const STAGING_URL = `https://${STAGING_PROJECT_ID}.supabase.co`;
const PRODUCTION_URL = `https://${PRODUCTION_PROJECT_ID}.supabase.co`;

/** An anon key whose own claims name the project it belongs to, as the real ones do. */
function keyFor(projectRef: string): string {
  const payload = Buffer.from(JSON.stringify({ ref: projectRef, role: 'anon' }), 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const STAGING_KEY = keyFor(STAGING_PROJECT_ID);
const PRODUCTION_KEY = keyFor(PRODUCTION_PROJECT_ID);

const valid = (overrides: Partial<EnvironmentInput> = {}): EnvironmentInput => ({
  appEnv: 'staging',
  supabaseUrl: STAGING_URL,
  supabaseProjectId: STAGING_PROJECT_ID,
  supabaseAnonKey: STAGING_KEY,
  otpDelivery: 'demo',
  ...overrides,
});

describe('a correct configuration is accepted (so the failures below are not vacuous)', () => {
  test('development with its own project and demo codes', () => {
    const verdict = resolveEnvironment(valid({ appEnv: 'development' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.environment).toBe('development');
      expect(verdict.otpDelivery).toBe('demo');
      expect(verdict.credentialsCrossChecked).toBe(true);
    }
  });

  test('staging on the staging project with demo codes', () => {
    const verdict = resolveEnvironment(valid());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.projectId).toBe(STAGING_PROJECT_ID);
  });

  test('production on the production project with real codes', () => {
    const verdict = resolveEnvironment(
      valid({
        appEnv: 'production',
        supabaseUrl: PRODUCTION_URL,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: PRODUCTION_KEY,
        otpDelivery: 'sms',
      }),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.environment).toBe('production');
      expect(verdict.otpDelivery).toBe('sms');
    }
  });
});

describe('missing configuration fails closed', () => {
  test('no VITE_APP_ENV at all is refused, not defaulted', () => {
    const verdict = resolveEnvironment(valid({ appEnv: undefined }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('ENV_NAME_MISSING');
  });

  test('an empty VITE_APP_ENV is refused', () => {
    const verdict = resolveEnvironment(valid({ appEnv: '   ' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('ENV_NAME_MISSING');
  });

  test('no URL and no project id is refused — this is the case that used to mean "production"', () => {
    const verdict = resolveEnvironment(
      valid({ supabaseUrl: undefined, supabaseProjectId: undefined }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SUPABASE_URL_MISSING');
  });

  test('no anon key is refused — there is no bundled fallback key any more', () => {
    const verdict = resolveEnvironment(valid({ supabaseAnonKey: undefined }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('SUPABASE_ANON_KEY_MISSING');
  });
});

describe('an unknown environment is refused', () => {
  for (const bogus of ['PRODUCTION', 'Prod', 'preview', 'qa', 'staging-prod', 'dev']) {
    test(`"${bogus}" is not an accepted environment name`, () => {
      const verdict = resolveEnvironment(valid({ appEnv: bogus }));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('ENV_NAME_UNKNOWN');
    });
  }

  test('the three real names are the only ones parsed', () => {
    expect(parseAppEnvironment('development')).toBe('development');
    expect(parseAppEnvironment('staging')).toBe('staging');
    expect(parseAppEnvironment('production')).toBe('production');
    expect(parseAppEnvironment('Production')).toBeNull();
    expect(parseAppEnvironment(undefined)).toBeNull();
  });

  test('surrounding whitespace is tolerated — a CRLF env file must not become an unknown env', () => {
    // Windows env files end lines with CRLF, which leaves \r on the value. Rejecting that would
    // make the guard fire on a correct configuration, which is how guards get switched off.
    expect(parseAppEnvironment('staging ')).toBe('staging');
    expect(parseAppEnvironment('\r\nproduction\r\n')).toBe('production');
  });
});

describe('a build may not reach production from anywhere but production', () => {
  test('DEV app + PROD Supabase → refused', () => {
    const verdict = resolveEnvironment(
      valid({
        appEnv: 'development',
        supabaseUrl: PRODUCTION_URL,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: PRODUCTION_KEY,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PRODUCTION_PROJECT_OUTSIDE_PRODUCTION');
  });

  test('STAGING app + PROD Supabase → refused', () => {
    const verdict = resolveEnvironment(
      valid({
        appEnv: 'staging',
        supabaseUrl: PRODUCTION_URL,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: PRODUCTION_KEY,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PRODUCTION_PROJECT_OUTSIDE_PRODUCTION');
  });

  test('that refusal is caused by the project, not by the environment name', () => {
    // Same two names, staging project → allowed. Proves the case above tested the project rule.
    expect(resolveEnvironment(valid({ appEnv: 'development' })).ok).toBe(true);
    expect(resolveEnvironment(valid({ appEnv: 'staging' })).ok).toBe(true);
  });

  test('the production project ref is reachable by exactly one environment', () => {
    const allowed = (['development', 'staging', 'production'] as const).filter(
      (appEnv) =>
        resolveEnvironment(
          valid({
            appEnv,
            supabaseUrl: PRODUCTION_URL,
            supabaseProjectId: PRODUCTION_PROJECT_ID,
            supabaseAnonKey: PRODUCTION_KEY,
            otpDelivery: 'sms',
          }),
        ).ok,
    );
    expect(allowed).toEqual(['production']);
  });
});

describe('the named environments must land on their own project', () => {
  test('PROD app + STAGING Supabase → refused', () => {
    const verdict = resolveEnvironment(
      valid({ appEnv: 'production', supabaseUrl: STAGING_URL, otpDelivery: 'sms' }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PRODUCTION_ENV_WRONG_PROJECT');
  });

  test('STAGING app + some other project → refused', () => {
    // The URL and key are made to agree with each other and with the other project, so the only
    // thing left that is wrong is the pairing of environment and project. That is the rule under
    // test here; a mismatched key would otherwise mask it with a different (also correct) code.
    const otherRef = 'somedevproject';
    const verdict = resolveEnvironment(
      valid({
        appEnv: 'staging',
        supabaseUrl: `https://${otherRef}.supabase.co`,
        supabaseProjectId: otherRef,
        supabaseAnonKey: keyFor(otherRef),
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('STAGING_ENV_WRONG_PROJECT');
  });

  test('the project id alone is enough to identify the target', () => {
    const verdict = resolveEnvironment(
      valid({
        supabaseUrl: undefined,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: PRODUCTION_KEY,
        appEnv: 'staging',
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PRODUCTION_PROJECT_OUTSIDE_PRODUCTION');
  });
});

describe('a URL and a key from different projects are refused', () => {
  test('staging URL with a production key', () => {
    const verdict = resolveEnvironment(valid({ supabaseAnonKey: PRODUCTION_KEY }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('CREDENTIALS_MISMATCHED');
  });

  test('production URL with a staging key', () => {
    const verdict = resolveEnvironment(
      valid({
        appEnv: 'production',
        supabaseUrl: PRODUCTION_URL,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: STAGING_KEY,
        otpDelivery: 'sms',
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('CREDENTIALS_MISMATCHED');
  });

  test('a key whose project cannot be read is not treated as a contradiction', () => {
    const verdict = resolveEnvironment(valid({ supabaseAnonKey: 'sb_publishable_not_a_jwt' }));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.credentialsCrossChecked).toBe(false);
  });

  test('the ref really is read out of the key, not inferred', () => {
    expect(projectIdFromKey(STAGING_KEY)).toBe(STAGING_PROJECT_ID);
    expect(projectIdFromKey(PRODUCTION_KEY)).toBe(PRODUCTION_PROJECT_ID);
    expect(projectIdFromKey('sb_publishable_abc')).toBeNull();
    expect(projectIdFromKey(undefined)).toBeNull();
  });
});

describe('project ids are read only from real Supabase URLs', () => {
  test('extracts the ref, case-insensitively', () => {
    expect(extractProjectId(STAGING_URL)).toBe(STAGING_PROJECT_ID);
    expect(extractProjectId(`https://${STAGING_PROJECT_ID.toUpperCase()}.supabase.co`)).toBe(
      STAGING_PROJECT_ID,
    );
  });

  test('does not invent a ref for anything else', () => {
    expect(extractProjectId('')).toBeNull();
    expect(extractProjectId('not a url')).toBeNull();
    expect(extractProjectId('https://example.com')).toBeNull();
    expect(extractProjectId(undefined)).toBeNull();
  });
});
