import { defineConfig } from '@playwright/test';

// The suite's port is configurable because 5173 is shared with other projects on this machine.
// Whichever port is used, the identity guard below still proves the server is THIS app's QA server.
const PORT = Number(process.env.E2E_PORT) || 5173;
// `QA_APP_URL` is the same variable the specs read for their own navigations, so config, guard and
// specs can never disagree about which server is under test.
const ORIGIN = process.env.QA_APP_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // The Co-Owner local lane writes to the local stack and is run with playwright.coowner.config.ts.
  // Never let the staging suite pick it up by accident.
  testIgnore: /coOwner\.local\.spec\.ts/,
  // Reusing a running server is safe only when it is THIS app's QA-mode server on the port. The
  // setup below reads that server's own environment block and fails the run closed otherwise, so a
  // foreign application can never be driven silently (see tests/e2e/global-setup.ts).
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 120000,
  // ONE worker by default, and it is not a tuning knob: the QA database is single-writer, and the
  // fixture rows are SHARED AND PINNED (`QA_FIXTURE_IDS`, `fixtureIdCollision`). Running specs in
  // parallel splits them across browsers that write the same ids, which is the collision class the
  // 2026-10-13 parallel experiment produced (25 failures, 20 of them in the serial remainder).
  // `E2E_WORKERS` exists so a read-only lane can be measured at higher concurrency deliberately;
  // CI never raises it without that measurement.
  workers: Number(process.env.E2E_WORKERS) || 1,
  reporter: [
    ['list'],
    ['json', { outputFile: './tests/e2e/results.json' }]
  ],
  use: {
    // Use system Chrome instead of downloading Chromium
    channel: 'chrome',
    baseURL: ORIGIN,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10000,
    // A dev server transforms the whole app on the first request; when Playwright starts
    // Vite itself (no server already on 5173) that first navigation can outrun 30s and
    // fail the first test for a reason that is not the app. The wait is for the cold
    // server to serve the app, not a weaker assertion about it.
    navigationTimeout: 90000,
  },
  projects: [
    {
      name: 'e2e',
      testMatch: /\.spec\.ts$/,
    },
  ],
  webServer: {
    // Use --mode qa so Vite loads .env.qa → QA Supabase instead of production
    command: `npx vite --mode qa --port ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: true,
    timeout: 60000,
    env: {
      VITE_SUPABASE_URL: 'https://bpybjrjenwccowvtrevu.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjY1NzIsImV4cCI6MjEwNDYwMjU3Mn0.nHzYWdjmZ_TEp_2mzqeinCNoXeLvVdvOETgvJXxldS0',
      VITE_SUPABASE_PROJECT_ID: 'bpybjrjenwccowvtrevu',
      // The app now refuses to start in an environment it cannot name, and refuses to accept the
      // demo code outside development/staging. The lanes sign in through the real login flow
      // against the staging project, so they say so explicitly rather than relying on defaults.
      VITE_APP_ENV: 'staging',
      VITE_OTP_DELIVERY: 'demo',
    },
  },
});
