import { defineConfig } from 'vitest/config';
import path from 'path';
import dns from 'dns';

// Force IPv4 DNS resolution — GitHub Actions runners lack IPv6 support.
// The platform DNS may only return AAAA (IPv6) records for Supabase poolers.
// Use Google DNS (8.8.8.8) which has both A and AAAA records, then prefer IPv4.
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch { /* already set by another module */ }
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
