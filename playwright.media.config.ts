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
    baseURL: 'http://localhost:5173',
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
    command: 'npx vite --mode qa --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
