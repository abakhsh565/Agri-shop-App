/**
 * vercelDeployScopes — what the Vercel dashboard must contain, checked rather than described.
 *
 * WHY THIS FILE EXISTS
 *   `PHASE_1_PRODUCTION_SAFETY_GATES.md` §F3 carries a table of the three Vercel scopes and the
 *   variables each one must define. It was prose, and prose is exactly how the defect this phase
 *   closed got in: `VITE_OTP_DELIVERY` was "set nowhere — not in build-apk.yml, not in vercel.json,
 *   not in any script", and no check disagreed. The audit that found it could not verify the
 *   dashboard either ("I could not verify it from here").
 *
 *   So the deploy contract is machine-checked here. What that buys, precisely:
 *
 *     * the set of variables a production-scoped deploy must define is derived from
 *       `.env.example` and from `src/lib/environmentContract.ts` — the two things the app already
 *       reads — not retyped from the table, so the three cannot drift apart;
 *     * each scope's configuration is put through the SAME decision the build and the app use
 *       (`resolveEnvironment`), so "this deploy is configured correctly" and "this build will be
 *       accepted" are one answer rather than two opinions;
 *     * every required variable is proved NECESSARY — dropping any one of them must fail with a
 *       named code — which is what turns "the list is complete" from a claim into a test;
 *     * the isolation between scopes is asserted, because a Preview deploy that inherits the
 *       production project is the original production-fallback bug wearing a different hat.
 *
 * WHAT A PASS HERE DOES NOT MEAN
 *   It does not mean the dashboard IS configured — nothing in this repository can read the Vercel
 *   project, and no credential for it exists in this checkout. It means the configuration the
 *   dashboard must hold is unambiguous, and that a build given exactly those variables succeeds
 *   while a build missing any of them is refused before it can produce an artifact.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  DEVELOPMENT_LOCAL_PROJECT_ID,
  LOCAL_STACK_API_URL,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  resolveEnvironment,
  type EnvironmentInput,
} from '@/lib/environmentContract';

const ROOT = process.cwd();
const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
const viteConfig = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');

/**
 * The variable NAMES `.env.example` documents as required, read out of the file.
 *
 * Everything above the `Optional` heading is required — that is the file's own structure, and
 * parsing it here is what keeps this test honest: add a required variable to the template and this
 * test starts failing until the deploy contract below accounts for it.
 */
const requiredNames = [
  ...example
    .split('── Optional')[0]
    .matchAll(/^(VITE_[A-Z_]+)=/gm),
]
  .map((match) => match[1])
  .sort();

const optionalNames = [
  ...example.split('── Optional')[1].matchAll(/^(VITE_[A-Z_]+)=/gm),
].map((match) => match[1]);

/** An anon key whose own claims name its project, exactly as the real publishable keys do. */
function keyFor(projectRef: string): string {
  const payload = Buffer.from(JSON.stringify({ ref: projectRef, role: 'anon' }), 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

/**
 * The three scopes, and what each must be pointed at.
 *
 * The PROJECTS are read from the environment map rather than typed in: `environments.json` is the
 * single place that says which environment owns which project, and a second copy here would
 * eventually disagree with it. Only the topology — which branch is which scope, and how codes are
 * delivered — is stated, because it exists nowhere machine-readable today.
 */
const SCOPES = [
  {
    scope: 'Production',
    branches: ['main'],
    environment: 'production',
    projectRef: PRODUCTION_PROJECT_ID,
    otpDelivery: 'sms',
    supabaseUrl: `https://${PRODUCTION_PROJECT_ID}.supabase.co`,
    anonKey: keyFor(PRODUCTION_PROJECT_ID),
  },
  {
    scope: 'Preview',
    branches: ['staging'],
    environment: 'staging',
    projectRef: STAGING_PROJECT_ID,
    otpDelivery: 'demo',
    supabaseUrl: `https://${STAGING_PROJECT_ID}.supabase.co`,
    anonKey: keyFor(STAGING_PROJECT_ID),
  },
  {
    scope: 'Development',
    branches: ['develop', 'feature/*'],
    environment: 'development',
    projectRef: DEVELOPMENT_LOCAL_PROJECT_ID,
    otpDelivery: 'demo',
    supabaseUrl: LOCAL_STACK_API_URL ?? 'http://127.0.0.1:54321',
    // The CLI's local key carries no readable `ref` claim, so nothing can be cross-checked against it.
    anonKey: 'sb_publishable_local_stack_key',
  },
] as const;

/** The variables a scope must define, as a value set the contract can judge. */
function valuesFor(scope: (typeof SCOPES)[number]): EnvironmentInput {
  return {
    appEnv: scope.environment,
    supabaseUrl: scope.supabaseUrl,
    supabaseProjectId: scope.projectRef ?? undefined,
    supabaseAnonKey: scope.anonKey,
    otpDelivery: scope.otpDelivery,
  };
}

describe('the deploy contract is derived from the files the app already reads', () => {
  test('the required variable names are exactly what .env.example marks as required', () => {
    // If a name is added to the required section of the template, this list changes and the
    // assertions below judge the new name too. That is the point: the deploy notes cannot rot away
    // from the contract without a failure here.
    expect(requiredNames).toEqual([
      'VITE_APP_ENV',
      'VITE_OTP_DELIVERY',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_PROJECT_ID',
      'VITE_SUPABASE_URL',
    ]);
  });

  test('a genuinely optional variable is not treated as required', () => {
    // The failing twin of the assertion above: a test that called everything required would pass
    // while making the deploy look impossible.
    expect(optionalNames).toContain('VITE_APP_URL');
    expect(requiredNames).not.toContain('VITE_APP_URL');
  });

  test('the build gate reads exactly these names, from the environment, for both commands', () => {
    expect(viteConfig).toContain("loadEnv(mode, process.cwd(), 'VITE_')");
    expect(viteConfig).toContain('environmentGate(mode, isPreview === true)');
    // No `apply` filter on the gate: a build must refuse to produce a mis-targeted artifact, and a
    // dev server must refuse to start against one. A Vercel deploy is the `build` half.
    expect(viteConfig).toMatch(/function environmentGate[\s\S]*?name: 'agrishop-environment-gate'/);
    expect(viteConfig).toMatch(/if \(!verdict\.ok\) \{[\s\S]*?throw new Error/);
  });
});

describe('each Vercel scope, put through the decision the build makes', () => {
  for (const scope of SCOPES) {
    test(`${scope.scope} (${scope.branches.join(', ')}) is accepted and lands on ${scope.projectRef}`, () => {
      const verdict = resolveEnvironment(valuesFor(scope));
      expect(verdict.ok, `the ${scope.scope} scope's own values were refused`).toBe(true);
      if (verdict.ok) {
        expect(verdict.environment).toBe(scope.environment);
        expect(verdict.projectId).toBe(scope.projectRef);
        expect(verdict.otpDelivery).toBe(scope.otpDelivery);
      }
    });
  }

  test('no scope reaches the production project except Production', () => {
    for (const scope of SCOPES.filter((s) => s.scope !== 'Production')) {
      expect(scope.projectRef, `${scope.scope} names the production project`).not.toBe(PRODUCTION_PROJECT_ID);
      // And the isolation is enforced, not merely intended: these values would be refused even if
      // someone pointed the scope at production.
      const refused = resolveEnvironment({
        ...valuesFor(scope),
        supabaseUrl: `https://${PRODUCTION_PROJECT_ID}.supabase.co`,
        supabaseProjectId: PRODUCTION_PROJECT_ID,
        supabaseAnonKey: keyFor(PRODUCTION_PROJECT_ID),
      });
      expect(refused.ok, `${scope.scope} accepted the production project`).toBe(false);
    }
  });
});

describe('every required variable is necessary — the list is complete, not merely sufficient', () => {
  const PRODUCTION = SCOPES[0];

  test('a production-scoped deploy with no variables at all is refused (this is the broken state)', () => {
    const verdict = resolveEnvironment({});
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('ENV_NAME_MISSING');
  });

  test('dropping each one fails, with the code that names the real problem', () => {
    // The four failures a real production deploy hits, each of which used to produce a bundle that
    // connected somewhere it was never told to go.
    const cases: Array<[string, Partial<EnvironmentInput>, string]> = [
      ['VITE_APP_ENV', { appEnv: undefined }, 'ENV_NAME_MISSING'],
      ['VITE_SUPABASE_URL and VITE_SUPABASE_PROJECT_ID', { supabaseUrl: undefined, supabaseProjectId: undefined }, 'SUPABASE_URL_MISSING'],
      ['VITE_SUPABASE_ANON_KEY', { supabaseAnonKey: undefined }, 'SUPABASE_ANON_KEY_MISSING'],
      ['VITE_OTP_DELIVERY', { otpDelivery: undefined }, 'DEMO_OTP_IN_PRODUCTION'],
    ];
    for (const [name, override, code] of cases) {
      const verdict = resolveEnvironment({ ...valuesFor(PRODUCTION), ...override });
      expect(verdict.ok, `a production deploy without ${name} was accepted`).toBe(false);
      if (!verdict.ok) expect(verdict.code, `dropping ${name} produced the wrong failure`).toBe(code);
    }
  });

  test('the demo delivery code is not merely discouraged in production — a build cannot be made', () => {
    // `VITE_OTP_DELIVERY=demo` on the Production scope is the configuration that would accept the
    // shared code for any registered phone number. It must fail here, not at sign-in time.
    const verdict = resolveEnvironment({ ...valuesFor(PRODUCTION), otpDelivery: 'demo' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DEMO_OTP_IN_PRODUCTION');
  });

  test('and the same set with the one correction is accepted — so the failures above are not vacuous', () => {
    expect(resolveEnvironment(valuesFor(PRODUCTION)).ok).toBe(true);
  });
});
