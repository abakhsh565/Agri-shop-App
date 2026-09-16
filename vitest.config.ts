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
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
