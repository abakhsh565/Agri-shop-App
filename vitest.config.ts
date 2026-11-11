import { defineConfig } from 'vitest/config';
import path from 'path';

import { DEVELOPMENT_LOCAL_PROJECT_ID, STAGING_PROJECT_ID } from './src/lib/environmentContract';

/**
 * A key whose own claims name the project it belongs to, exactly as the real ones do — the same
 * shape `tests/unit/environmentSafety.test.ts` builds. The environment contract cross-checks that
 * the key and the URL come from the same project, so the suite needs a key that *names* the project
 * it declares; it does not need a real secret, because nothing in the unit suite authenticates
 * against a live project. The integration suite authenticates through `tests/setup/qa-client.ts`,
 * which reads `.env.qa`, and is unaffected by this value.
 */
function declaredAnonKey(ref: string): string {
  const payload = Buffer.from(JSON.stringify({ ref, role: 'anon', iss: 'supabase' }), 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

/**
 * The suite's target is named by `QA_TARGET`, exactly as `tests/setup/qa-client.ts` names it.
 * `QA_TARGET=local` is the Supabase CLI stack on this machine (the `integration-local` CI job):
 * development environment, the loopback API URL, the local project id. Anything else is staging,
 * unchanged. The integration suite talks to the database through `qa-client.ts` (the `QA_*`
 * variables), so these `VITE_*` values only decide what the app code under test believes its
 * environment is — and the declared key keeps the contract's cross-check honest for either target.
 */
const isLocalTarget = process.env.QA_TARGET === 'local';
const localProjectId = DEVELOPMENT_LOCAL_PROJECT_ID ?? 'localdev';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    setupFiles: ['tests/setup/localStorage-mock.cjs'],
    globalSetup: 'tests/setup/global-teardown.ts',
    pool: 'forks',
    // Declared explicitly instead of inherited from whatever `.env.local` happens to hold on the
    // machine running the suite. Before this, `src/lib/supabase.ts` fell back to a hardcoded
    // PRODUCTION project id, so a checkout with no env file ran every test against production
    // and reported a pass. These two names make the target of the suite part of the suite.
    //
    // The Supabase trio is declared for the same reason, and it fixes a real failure rather than
    // anticipating one: Vite loads the developer's env files for tests too, and `.env.local` — which
    // is the LOCAL stack while Local Development is in use — takes precedence over both these values
    // and over `process.env`. Declaring only `VITE_APP_ENV` therefore produced the worst possible
    // combination: a suite that called itself `staging` while carrying `localdev`'s URL and key.
    // `resolveEnvironment` refused it (STAGING_ENV_WRONG_PROJECT), which is the contract working
    // correctly, and the refusal resolved the OTP mode to `sms` — so tests/unit/authSafetyGuard.test.ts
    // failed on a machine whose `.env.local` was doing exactly what it should. A suite whose target
    // depends on the developer's machine is not a suite; the target belongs here.
    env: {
      VITE_APP_ENV: isLocalTarget ? 'development' : 'staging',
      VITE_OTP_DELIVERY: 'demo',
      VITE_SUPABASE_URL: isLocalTarget
        ? 'http://127.0.0.1:54321'
        : `https://${STAGING_PROJECT_ID}.supabase.co`,
      VITE_SUPABASE_PROJECT_ID: isLocalTarget ? localProjectId : STAGING_PROJECT_ID,
      VITE_SUPABASE_ANON_KEY: declaredAnonKey(isLocalTarget ? localProjectId : STAGING_PROJECT_ID),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
