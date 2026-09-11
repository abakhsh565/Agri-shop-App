import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 120000,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: './tests/e2e/results.json' }]
  ],
  use: {
    // Use system Chrome instead of downloading Chromium
    channel: 'chrome',
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'e2e',
      testMatch: /\.spec\.ts$/,
    },
  ],
  webServer: {
    // Use --mode qa so Vite loads .env.qa → QA Supabase instead of production
    command: 'npx vite --mode qa --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60000,
    env: {
      VITE_SUPABASE_URL: 'https://bpybjrjenwccowvtrevu.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJweWJqcmplbndjY293dnRyZXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMjY1NzIsImV4cCI6MjEwNDYwMjU3Mn0.nHzYWdjmZ_TEp_2mzqeinCNoXeLvVdvOETgvJXxldS0',
      VITE_SUPABASE_PROJECT_ID: 'bpybjrjenwccowvtrevu',
    },
  },
});
