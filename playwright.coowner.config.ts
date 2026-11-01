import { defineConfig } from '@playwright/test';

/**
 * Local development lane for the Co-Owner journey.
 *
 * Deliberately separate from playwright.config.ts: that suite is the staging/QA lane and takes a
 * hosted-database lock. This one runs only against the owner's local Supabase stack and the Vite
 * development server, and the spec refuses to start unless both identify themselves as such.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /coOwner\.local\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: process.env.COOWNER_LOCAL_URL || 'http://127.0.0.1:5175',
    headless: true,
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15000,
    navigationTimeout: 60000,
  },
});