import { describe, it, expect, beforeAll } from 'vitest';
import { qaServiceClient, execSqlAsAdmin } from '../setup/qa-client';

/** Helper to call analyze_frontend_impact and parse result */
async function analyze(targetType: string, targetName: string) {
  const { data, error } = await qaServiceClient.rpc('analyze_frontend_impact' as any, {
    p_target_type: targetType,
    p_target_name: targetName,
  } as any);
  if (error) throw new Error(`RPC error: ${error.message}`);
  return typeof data === 'string' ? JSON.parse(data) : data;
}

/** Helper to call analyze_table_impact from Phase 4.4 */
async function analyzeTableDb(tableName: string) {
  const { data, error } = await qaServiceClient.rpc('analyze_table_impact' as any, {
    p_table_name: tableName,
  } as any);
  if (error) throw new Error(`RPC error: ${error.message}`);
  return typeof data === 'string' ? JSON.parse(data) : data;
}

/** Helper to call analyze_function_impact from Phase 4.4 */
async function analyzeFunctionDb(funcName: string) {
  const { data, error } = await qaServiceClient.rpc('analyze_function_impact' as any, {
    p_function_name: funcName,
  } as any);
  if (error) throw new Error(`RPC error: ${error.message}`);
  return typeof data === 'string' ? JSON.parse(data) : data;
}

describe('Frontend Impact Intelligence', () => {
  // ─── Scenario A: Direct RPC caller detected ──────────────────────
  describe('Scenario A — Direct RPC caller', () => {
    it('archive_customer RPC is found in customersStore.ts', async () => {
      const result = await analyze('rpc', 'archive_customer');
      expect(result.found).toBe(true);
      expect(result.confidence).toBe('verified');
      expect(result.affected_stores).toContain('src/stores/customersStore.ts');
      expect(result.total_files).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Scenario B: Store dependency ────────────────────────────────
  describe('Scenario B — Store dependency', () => {
    it('customers table is found in customersStore.ts', async () => {
      const result = await analyze('table', 'customers');
      expect(result.found).toBe(true);
      expect(result.affected_stores).toContain('src/stores/customersStore.ts');
    });
  });

  // ─── Scenario C: Hook/lib dependency ─────────────────────────────
  describe('Scenario C — Hook/lib dependency', () => {
    it('customers table is found in lib files (db.ts, offlineQueue.ts)', async () => {
      const result = await analyze('table', 'customers');
      expect(result.found).toBe(true);
      expect(result.affected_hooks.length).toBeGreaterThanOrEqual(2);
      // offlineQueue.ts and observationBot.ts reference customers
      const hookFiles = result.affected_hooks.map((f: string) => f.split('/').pop());
      expect(hookFiles).toContain('offlineQueue.ts');
    });
  });

  // ─── Scenario D: Component dependency ────────────────────────────
  describe('Scenario D — Component dependency', () => {
    it('customers table is found in at least one component', async () => {
      const result = await analyze('table', 'customers');
      expect(result.found).toBe(true);
      expect(result.affected_components.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Scenario E: Route dependency ────────────────────────────────
  describe('Scenario E — Route dependency', () => {
    it('customers table affects customer-related routes', async () => {
      const result = await analyze('table', 'customers');
      expect(result.found).toBe(true);
      expect(result.affected_routes.length).toBeGreaterThanOrEqual(1);
      // Should include at least one customer route
      const hasCustomerRoute = result.affected_routes.some((r: string) =>
        r.includes('customer')
      );
      expect(hasCustomerRoute).toBe(true);
    });

    it('products table affects product detail routes', async () => {
      const result = await analyze('table', 'products');
      expect(result.found).toBe(true);
      expect(result.affected_routes.length).toBeGreaterThanOrEqual(1);
      const hasProductRoute = result.affected_routes.some((r: string) =>
        r.includes('product')
      );
      expect(hasProductRoute).toBe(true);
    });
  });

  // ─── Scenario F: Test dependency ─────────────────────────────────
  describe('Scenario F — Test dependency', () => {
    it('sales table is found in integration tests', async () => {
      const result = await analyze('table', 'sales');
      expect(result.found).toBe(true);
      expect(result.affected_tests.length).toBeGreaterThanOrEqual(1);
      // Should find test files
      const hasTestFile = result.affected_tests.some((f: string) =>
        f.endsWith('.test.ts') || f.endsWith('.spec.ts')
      );
      expect(hasTestFile).toBe(true);
    });
  });

  // ─── Scenario G: Multi-layer dependency ──────────────────────────
  describe('Scenario G — Multi-layer dependency (DB → RPC → store → page → route → test)', () => {
    it('customers table traces through stores, pages, routes, and tests', async () => {
      const result = await analyze('table', 'customers');
      expect(result.found).toBe(true);
      // Multi-layer: at least store + page + route + test
      expect(result.affected_stores.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_pages.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_routes.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_tests.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Scenario H: No false dependency ─────────────────────────────
  describe('Scenario H — No false dependency', () => {
    it('activity_log table has minimal frontend impact', async () => {
      const result = await analyze('table', 'activity_log');
      expect(result.found).toBe(true);
      // activity_log is referenced in tests but should have minimal store/page/route impact
      expect(result.affected_stores.length).toBe(0);
      expect(result.affected_pages.length).toBe(0);
      expect(result.affected_routes.length).toBe(0);
    });
  });

  // ─── Scenario I: Unknown handling ────────────────────────────────
  describe('Scenario I — Unknown handling', () => {
    it('non-existent table returns found=false', async () => {
      const result = await analyze('table', 'totally_nonexistent_table_xyz');
      expect(result.found).toBe(false);
      expect(result.confidence).toBe('unknown');
    });

    it('non-existent RPC returns found=false', async () => {
      const result = await analyze('rpc', 'nonexistent_rpc_xyz');
      expect(result.found).toBe(false);
      expect(result.confidence).toBe('unknown');
    });

    it('unsupported target type returns error', async () => {
      const result = await analyze('column', 'anything');
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unsupported');
    });
  });

  // ─── Scenario J: Financial workflow ──────────────────────────────
  describe('Scenario J — Financial workflow impact', () => {
    it('customer_payments table traces to dashboard and payment lib', async () => {
      const result = await analyze('table', 'customer_payments');
      expect(result.found).toBe(true);
      // Should find lib/db.ts which has payment-related RPCs
      const hookFiles = result.affected_hooks.map((f: string) => f.split('/').pop());
      expect(hookFiles).toContain('db.ts');
    });

    it('credit_limit_requests table traces to lib and dashboard', async () => {
      const result = await analyze('table', 'credit_limit_requests');
      expect(result.found).toBe(true);
      expect(result.affected_hooks.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_pages.length).toBeGreaterThanOrEqual(1);
    });

    it('approve_credit_limit_request RPC found in frontend code', async () => {
      const result = await analyze('rpc', 'approve_credit_limit_request');
      expect(result.found).toBe(true);
      expect(result.total_files).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Scenario K: Integration with Phase 4.4 DB impact ───────────
  describe('Scenario K — DB + Frontend combined impact', () => {
    it('customers table has both DB and frontend dependencies', async () => {
      const dbImpact = await analyzeTableDb('customers');
      const feImpact = await analyze('table', 'customers');
      
      // DB impact exists (Phase 4.4)
      expect(dbImpact.confidence).toBeDefined();
      expect(dbImpact.affected_tables?.length).toBeGreaterThanOrEqual(1);
      
      // Frontend impact exists (Phase 5)
      expect(feImpact.found).toBe(true);
      expect(feImpact.affected_stores.length).toBeGreaterThanOrEqual(1);
    });

    it('archive_customer RPC has both DB function and frontend store dependencies', async () => {
      const dbImpact = await analyzeFunctionDb('archive_customer');
      const feImpact = await analyze('rpc', 'archive_customer');
      
      // DB impact (Phase 4.4)
      expect(dbImpact.confidence).toBeDefined();
      expect(dbImpact.impact_level).toBeDefined();
      
      // Frontend impact (Phase 5)
      expect(feImpact.found).toBe(true);
      expect(feImpact.affected_stores.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Scenario L: Scope deviation detection ───────────────────────
  describe('Scenario L — Unexpected scope tracking', () => {
    it('impact analysis includes all affected layers for sales', async () => {
      const result = await analyze('table', 'sales');
      expect(result.found).toBe(true);
      // Sales touches store, lib, page, and tests
      expect(result.affected_stores.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_hooks.length).toBeGreaterThanOrEqual(1);
      expect(result.affected_tests.length).toBeGreaterThanOrEqual(1);
      // Total should be the sum of all layers
      const totalFromLayers =
        result.affected_stores.length +
        result.affected_hooks.length +
        result.affected_components.length +
        result.affected_pages.length +
        result.affected_tests.length;
      expect(result.total_files).toBe(totalFromLayers);
    });
  });
});
