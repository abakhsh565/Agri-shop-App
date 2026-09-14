/**
 * Phase 4.4 — Impact Intelligence: Behavioral Tests
 *
 * Tests the complete impact analysis lifecycle:
 * - Table impact analysis (DB dependencies, functions, triggers, policies)
 * - RPC/function impact analysis (tables, security, mutations)
 * - Risk classification (low/medium/high/critical)
 * - Historical/financial/security impact detection
 * - Unknown target handling
 * - Agent task integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadQaEnv() {
  if (process.env.QA_SUPABASE_URL) return;
  try {
    const candidates = [
      path.resolve(process.cwd(), '.env.qa'),
      path.resolve(process.cwd(), '../../.env.qa'),
    ];
    for (const envPath of candidates) {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) process.env[key] = val;
        }
        return;
      }
    }
  } catch { /* .env.qa not found */ }
}
loadQaEnv();

const QA_URL = (process.env.QA_SUPABASE_URL || '').replace(/^\[|\]$/g, '').trim();
const QA_SERVICE_ROLE = process.env.QA_SUPABASE_SERVICE_ROLE || '';
const serviceClient = createClient(QA_URL, QA_SERVICE_ROLE);

async function sql(query: string): Promise<any[]> {
  const { data, error } = await serviceClient.rpc('run_sql', { sql_query: query });
  if (error) throw new Error(`run_sql: ${error.message}`);
  if (!data || data === 'ok') return [];
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return [{ result: data }]; }
}

async function rpc(name: string, params: Record<string, any>): Promise<any> {
  const { data, error } = await serviceClient.rpc(name, params);
  if (error) throw new Error(error.message);
  return data;
}

async function cleanupTestData() {
  await sql(`DELETE FROM impact_analyses WHERE target_name LIKE 'qa_test_%'`);
}

describe('Impact Intelligence', () => {
  beforeAll(async () => { await cleanupTestData(); });
  afterAll(async () => { await cleanupTestData(); });

  describe('Scenario A — Simple isolated change (low impact)', () => {
    it('should analyze an isolated table with minimal dependencies', async () => {
      // activity_log is likely isolated
      const result = await rpc('analyze_table_impact', { p_table_name: 'activity_log' });
      expect(result.impact_level).toBeDefined();
      expect(result.affected_tables).toBeDefined();
      expect(result.affected_functions).toBeDefined();
      expect(result.confidence).toBe('verified');
    });
  });

  describe('Scenario B — Shared store (multiple consumers)', () => {
    it('should detect that customers table has many function dependencies', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'customers' });
      // Customers is used by many functions
      expect(result.affected_functions.length).toBeGreaterThan(0);
      expect(result.affected_tables.length).toBeGreaterThanOrEqual(0);
      expect(result.impact_level).toBeDefined();
    });
  });

  describe('Scenario C — Financial RPC', () => {
    it('should detect that record_customer_payment has financial impact', async () => {
      const result = await rpc('analyze_function_impact', { p_function_name: 'record_customer_payment' });
      expect(result.impact_level).toMatch(/critical|high/);
      // The function references 'customers' table in its source
      expect(result.affected_tables).toContain('customers');
    });

    it('should detect that approve_credit_limit_request has security/financial impact', async () => {
      const result = await rpc('analyze_function_impact', { p_function_name: 'approve_credit_limit_request' });
      expect(result.impact_level).toMatch(/critical|high/);
      expect(result.impact_categories).toContain('security');
    });
  });

  describe('Scenario D — Database field (credit_limit)', () => {
    it('should detect credit_limit is a financial column', async () => {
      // Use classify_change_risk on the table level to check financial detection
      const result = await rpc('classify_change_risk', { p_target_type: 'table', p_target_name: 'customers' });
      expect(result.risk_level).toBe('critical');
      expect(result.risk_factors.some((f: string) => f.includes('financial'))).toBe(true);
      expect(result.requires_human_approval).toBe(true);
    });
  });

  describe('Scenario E — Historical data protection', () => {
    it('should detect sales table as critical (historical data)', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'sales' });
      expect(result.impact_level).toBe('critical');
      expect(result.impact_categories).toContain('financial');
      expect(result.impact_categories).toContain('historical');
    });

    it('should detect payments as critical', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'customer_payments' });
      expect(result.impact_level).toBe('critical');
      expect(result.impact_categories).toContain('financial');
    });
  });

  describe('Scenario F — Security detection', () => {
    it('should detect SECURITY DEFINER functions', async () => {
      const result = await rpc('analyze_function_impact', { p_function_name: 'archive_customer' });
      expect(result.is_security_definer).toBe(true);
      expect(result.impact_categories).toContain('security');
    });

    it('should detect that void_sale has security requirements', async () => {
      const result = await rpc('analyze_function_impact', { p_function_name: 'void_sale' });
      expect(result.impact_level).toBe('critical');
      expect(result.impact_categories).toContain('security');
    });
  });

  describe('Scenario G — Unknown dependency', () => {
    it('should report error for non-existent table', async () => {
      try {
        await rpc('analyze_table_impact', { p_table_name: 'nonexistent_xyz' });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('does not exist');
      }
    });

    it('should report error for non-existent function', async () => {
      try {
        await rpc('analyze_function_impact', { p_function_name: 'nonexistent_xyz' });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('does not exist');
      }
    });

    it('should report error for unsupported target type', async () => {
      const result = await rpc('classify_change_risk', { p_target_type: 'store', p_target_name: 'customersStore' });
      expect(result.error).toContain('Unsupported');
    });
  });

  describe('Scenario H — Risk classification', () => {
    it('should classify inventory table as critical', async () => {
      const result = await rpc('classify_change_risk', { p_target_type: 'table', p_target_name: 'products' });
      expect(result.risk_level).toBe('critical');
      expect(result.risk_factors.length).toBeGreaterThan(0);
      expect(result.requires_human_approval).toBe(true);
    });

    it('should classify auth function as high risk', async () => {
      const result = await rpc('classify_change_risk', { p_target_type: 'function', p_target_name: 'get_authenticated_user_id' });
      expect(result.risk_level).toMatch(/high|critical/);
    });

    it('should provide verification scope recommendations', async () => {
      const result = await rpc('classify_change_risk', { p_target_type: 'table', p_target_name: 'sales' });
      expect(result.recommendation).toBeDefined();
      expect(result.recommendation.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario I — Impact analysis persistence', () => {
    it('should store analysis results in impact_analyses table', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'products' });
      expect(result.analysis_id).toBeTruthy();

      // Verify the analysis was stored
      const stored = await sql(
        `SELECT * FROM impact_analyses WHERE id = '${result.analysis_id}'`
      );
      expect(stored.length).toBe(1);
      expect(stored[0].target_type).toBe('table');
      expect(stored[0].target_name).toBe('products');
      expect(stored[0].impact_level).toBe('critical');
    });
  });

  describe('Scenario J — Inventory detection', () => {
    it('should detect products as inventory-critical', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'products' });
      expect(result.impact_categories).toContain('inventory');
      expect(result.impact_level).toBe('critical');
    });

    it('should detect inventory_movements as inventory-critical', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'inventory_movements' });
      expect(result.impact_categories).toContain('inventory');
      expect(result.impact_level).toBe('critical');
    });
  });

  describe('Scenario K — RLS/security analysis', () => {
    it('should detect RLS policies on customers table', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'customers' });
      expect(result.affected_policies.length).toBeGreaterThan(0);
      expect(result.impact_categories).toContain('security');
    });
  });

  describe('Scenario L — RPC dependency discovery', () => {
    it('should discover RPCs that reference the customers table', async () => {
      const result = await rpc('analyze_table_impact', { p_table_name: 'customers' });
      // Customers table is referenced by many RPCs
      expect(result.affected_functions.length).toBeGreaterThan(0);
      // Verify specific known RPCs are found
      expect(result.affected_functions).toContain('archive_customer');
      expect(result.affected_functions).toContain('create_customer');
    });
  });

  describe('Scenario M — Column impact analysis', () => {
    it('should detect credit_limit as financial column', async () => {
      const result = await rpc('analyze_column_impact', { p_table_name: 'customers', p_column_name: 'credit_limit' });
      expect(result.impact_level).toBe('critical');
      expect(result.impact_categories).toContain('financial');
      expect(result.affected_functions.length).toBeGreaterThan(0);
    });

    it('should report error for non-existent column', async () => {
      try {
        await rpc('analyze_column_impact', { p_table_name: 'customers', p_column_name: 'nonexistent_col' });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('does not exist');
      }
    });
  });

  describe('Scenario N — Risk factor deduplication', () => {
    it('should not duplicate risk factors', async () => {
      const result = await rpc('classify_change_risk', { p_target_type: 'function', p_target_name: 'void_sale' });
      expect(result.risk_level).toBe('critical');
      // Each risk factor should appear only once
      const factors = result.risk_factors;
      const unique = [...new Set(factors)];
      expect(factors.length).toBe(unique.length);
      expect(factors.length).toBeGreaterThan(0);
      expect(factors.length).toBeLessThanOrEqual(5);
    });
  });
});
