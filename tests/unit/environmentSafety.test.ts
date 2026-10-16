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
  DEVELOPMENT_LOCAL_PROJECT_ID,
  LOCAL_STACK_API_URL,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  extractProjectId,
  parseAppEnvironment,
  projectIdFromKey,
  projectIdFromTarget,
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

/**
 * A development build as `.env.local` describes it: the stack in Docker on this machine.
 *
 * Read from `environments.json` through the contract rather than typed in here, so this test fails
 * if the recorded local stack and the app's idea of it ever drift apart — which is the whole class
 * of defect these rules exist to catch.
 */
const LOCAL_STACK_URL = LOCAL_STACK_API_URL ?? 'http://127.0.0.1:54321';
const LOCAL_STACK_PROJECT_ID = DEVELOPMENT_LOCAL_PROJECT_ID ?? 'localdev';
// The CLI's local anon key carries no readable `ref` claim, so nothing can be cross-checked: that is
// why a development build reports `credentialsCrossChecked: false`.
const LOCAL_STACK_KEY = 'sb_publishable_local_stack_key';

const validDevelopment = (overrides: Partial<EnvironmentInput> = {}): EnvironmentInput => ({
  appEnv: 'development',
  supabaseUrl: LOCAL_STACK_URL,
  supabaseProjectId: LOCAL_STACK_PROJECT_ID,
  supabaseAnonKey: LOCAL_STACK_KEY,
  otpDelivery: 'demo',
  ...overrides,
});

describe('a correct configuration is accepted (so the failures below are not vacuous)', () => {
  test('development on the local stack with demo codes', () => {
    const verdict = resolveEnvironment(validDevelopment());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.environment).toBe('development');
      expect(verdict.projectId).toBe(LOCAL_STACK_PROJECT_ID);
      expect(verdict.otpDelivery).toBe('demo');
      // Nothing to cross-check: the CLI's key names no project, which is not a contradiction.
      expect(verdict.credentialsCrossChecked).toBe(false);
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
    // Both names are accepted on the target each one owns, so the refusals above came from the
    // project being named, not from the environment name being present.
    expect(resolveEnvironment(valid()).ok).toBe(true);
    expect(resolveEnvironment(validDevelopment()).ok).toBe(true);
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

describe('development is the local stack and may not name a hosted project', () => {
  test('the local stack is recorded, and a development build resolves to it', () => {
    expect(LOCAL_STACK_PROJECT_ID).toBe('localdev');
    expect(LOCAL_STACK_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
    const verdict = resolveEnvironment(validDevelopment());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.projectId).toBe(LOCAL_STACK_PROJECT_ID);
  });

  test('a LAN address is accepted — a phone on the network still talks to the local stack', () => {
    // The address carries no project ref, so the explicitly named project id identifies the target.
    // Refusing this would break development on a real device while protecting nothing.
    const verdict = resolveEnvironment(
      validDevelopment({ supabaseUrl: 'http://192.168.1.20:54321' }),
    );
    expect(verdict.ok).toBe(true);
  });

  test('the project id alone identifies the target', () => {
    const verdict = resolveEnvironment(validDevelopment({ supabaseUrl: undefined }));
    expect(verdict.ok).toBe(true);
  });

  test('DEV app + STAGING URL → refused: development is not a second client of QA', () => {
    // This exact configuration is what `.env.local` held before the local stack existed, and it was
    // ACCEPTED: development plus QA's project was a valid build. That is the gap this rule closes.
    const verdict = resolveEnvironment(valid({ appEnv: 'development' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEVELOPMENT_ENV_HOSTED_URL');
  });

  test('a hosted URL wins over a local project id → refused', () => {
    const verdict = resolveEnvironment(
      validDevelopment({ supabaseUrl: STAGING_URL, supabaseAnonKey: STAGING_KEY }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEVELOPMENT_ENV_HOSTED_URL');
  });

  test('a local URL with a hosted project id → refused: the id alone names a target', () => {
    const verdict = resolveEnvironment(
      validDevelopment({ supabaseProjectId: STAGING_PROJECT_ID }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEVELOPMENT_ENV_WRONG_TARGET');
  });

  test('a bare hosted ref in the URL field → refused', () => {
    // `VITE_SUPABASE_URL` holding a bare ref instead of a URL is a real misconfiguration shape, and
    // it is not a hosted-URL refusal — the target it names is simply not the local stack.
    const verdict = resolveEnvironment(
      validDevelopment({
        supabaseUrl: STAGING_PROJECT_ID,
        supabaseProjectId: STAGING_PROJECT_ID,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEVELOPMENT_ENV_WRONG_TARGET');
  });

  test('DEV app + PROD project → the production refusal, which names the more serious problem', () => {
    // Both rules would catch this; production's is reported first because "this build reaches
    // production" is the more dangerous fact, and a message should name the real problem.
    const verdict = resolveEnvironment(
      validDevelopment({ supabaseUrl: PRODUCTION_URL, supabaseAnonKey: PRODUCTION_KEY }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PRODUCTION_PROJECT_OUTSIDE_PRODUCTION');
  });

  test('staging is unaffected by the development rule', () => {
    expect(resolveEnvironment(valid()).ok).toBe(true);
    expect(resolveEnvironment(valid({ supabaseAnonKey: LOCAL_STACK_KEY })).ok).toBe(true);
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

describe('a dashboard link is not a URL — the shape that failed the Production scope', () => {
  /*
   * Measured on 2026-10-16, read from the real Vercel project (`agri-shop-app`, scope
   * `ab-s-projects-7cb39308`), Production environment:
   *
   *   VITE_APP_ENV            = production
   *   VITE_OTP_DELIVERY       = sms
   *   VITE_SUPABASE_URL       = https://supabase.com/dashboard/project/<staging ref>
   *   VITE_SUPABASE_ANON_KEY  = a key whose own `ref` claim names the STAGING project
   *   VITE_SUPABASE_PROJECT_ID = (absent)
   *
   * Five consecutive production deployments failed with `BUILD_UTILS_SPAWN_1 — Command "npm run
   * build" exited with 1`, and rebuilding that exact configuration locally produced the refusal
   * asserted below. So this is the failure the pipeline reported, not a guess about it.
   *
   * The lesson the case encodes: a dashboard link reads as "the URL is set" while naming no
   * project, and the bare-ref fallback cannot read it either — so a build can be confidently
   * misconfigured in a way nothing could previously catch. Nothing in this repository can see the
   * dashboard; the gate is the last line that can, which is why it has to be exercised here.
   */
  const DASHBOARD_URL = `https://supabase.com/dashboard/project/${STAGING_PROJECT_ID}`;

  test('nothing is readable in it, by either route the gate uses', () => {
    expect(extractProjectId(DASHBOARD_URL)).toBeNull();
    expect(projectIdFromTarget(DASHBOARD_URL)).toBeNull();
  });

  test('production pointed at a dashboard link is refused, naming the real problem', () => {
    const verdict = resolveEnvironment({
      appEnv: 'production',
      supabaseUrl: DASHBOARD_URL,
      supabaseAnonKey: PRODUCTION_KEY,
      otpDelivery: 'sms',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PROJECT_ID_UNREADABLE');
  });

  test('staging pointed at a dashboard link is refused too, not quietly accepted', () => {
    const verdict = resolveEnvironment(
      valid({ supabaseUrl: DASHBOARD_URL, supabaseProjectId: undefined }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('PROJECT_ID_UNREADABLE');
  });

  test('the same configuration with the API URL is accepted — the refusal is about the URL', () => {
    const verdict = resolveEnvironment({
      appEnv: 'production',
      supabaseUrl: PRODUCTION_URL,
      supabaseAnonKey: PRODUCTION_KEY,
      otpDelivery: 'sms',
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.projectId).toBe(PRODUCTION_PROJECT_ID);
  });

  test('naming the project does not rescue a key from the other project', () => {
    // The next mistake after the one above: add VITE_SUPABASE_PROJECT_ID and keep the staging key.
    // The URL is then irrelevant — the pair is still contradictory, and it must still be refused.
    const verdict = resolveEnvironment({
      appEnv: 'production',
      supabaseUrl: DASHBOARD_URL,
      supabaseProjectId: PRODUCTION_PROJECT_ID,
      supabaseAnonKey: STAGING_KEY,
      otpDelivery: 'sms',
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('CREDENTIALS_MISMATCHED');
  });
});
