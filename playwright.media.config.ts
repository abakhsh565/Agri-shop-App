import { defineConfig } from '@playwright/test';

/**
 * Config for the education MEDIA pipeline (screen recordings + screenshots of the
 * real app). Deliberately not the verification config: the capture run writes files
 * into `public/`, takes minutes, and has no assertions about the product — it is a
 * recorder, not a test. It lives in its own config so nothing in `npm run verify`,
 * `test:e2e:lanes` or the APK job ever picks it up by accident.
 *
 * Usage:
 *   npx playwright test --config=playwright.media.config.ts
 */
// Same configurable port as the verification config, for the same reason: 5173 may be held by
// another project on this machine. The shared identity guard still proves it is this app's server.
const PORT = Number(process.env.E2E_PORT) || 5173;
const ORIGIN = process.env.QA_APP_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/media',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 240000,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: ORIGIN,
    headless: true,
    viewport: { width: 390, height: 844 },
    actionTimeout: 20000,
    navigationTimeout: 30000,
    screenshot: 'off',
    trace: 'off',
    // NOTE: Playwright's own video recording is deliberately NOT used here. It needs its
    // bundled ffmpeg (`ms-playwright/ffmpeg-1011`), which is not installed on this machine
    // and cannot be downloaded here. Tutorial videos are recorded by
    // `scripts/dev/record-tutorial.mjs`, which drives Chrome's own encoder via a CDP
    // screencast + MediaRecorder — no external binary required.
  },
  projects: [{ name: 'media', testMatch: /capture.spec.ts$/, }],
  webServer: {
    command: `npx vite --mode qa --port ${PORT}`,
    url: ORIGIN,
    reuseExistingServer: true,
    timeout: 60000,
  },
  // Same port, same reuse hazard as the verification config: a capture run must not be driven
  // against whatever else happens to hold 5173 (see tests/e2e/global-setup.ts).
  globalSetup: './tests/e2e/global-setup.ts',
});
