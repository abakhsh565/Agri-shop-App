import { defineConfig } from 'vitest/config';
import path from 'path';

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
    env: {
      VITE_APP_ENV: 'staging',
      VITE_OTP_DELIVERY: 'demo',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
