import { defineConfig } from 'vitest/config';
import path from 'path';
import dns from 'dns';

// Force IPv4 DNS resolution — GitHub Actions runners lack IPv6 support
// and Supabase pooler hostname resolves to both IPv4 and IPv6
dns.setDefaultResultOrder('ipv4first');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    setupFiles: ['tests/setup/localStorage-mock.cjs'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
