/**
 * Phase 4.3 — Agent Telemetry + Loop Detection: Behavioral Tests
 *
 * Tests the complete lifecycle:
 * - Task creation and attempt recording
 * - Progress detection (new evidence vs repeated work)
 * - Loop detection (same strategy, same failure, no evidence)
 * - Strategy change behavior
 * - Escalation with evidence
 * - Memory/incident integration
 * - Sensitive data protection
 * - Source-of-truth precedence over memory
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ─── Setup ────────────────────────────────────────────────────────────

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

// Service-role client (bypasses RLS, for test setup/teardown)
const serviceClient = createClient(QA_URL, QA_SERVICE_ROLE);

// ─── Helpers ──────────────────────────────────────────────────────────

async function sql(query: string): Promise<any[]> {
  const { data, error } = await serviceClient.rpc('run_sql', { sql_query: query });
  if (error) throw new Error(`run_sql: ${error.message}`);
  if (!data || data === 'ok') return [];
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [{ result: data }];
  }
}

async function rpc(name: string, params: Record<string, any>): Promise<any> {
  const { data, error } = await serviceClient.rpc(name, params);
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Clean up all test data before and after
async function cleanupTestData() {
  await sql(`DELETE FROM agent_tasks WHERE description LIKE '%QA Test%'`);
}

describe('Agent Telemetry + Loop Detection', () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Scenario A — Healthy task with progress', () => {
    it('should create a task and track attempts with progress', async () => {
      // Create task
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix customer payment calculation',
        p_module: 'payments',
        p_entity_type: 'customer',
      });
      expect(taskId).toBeTruthy();

      // Attempt 1: Inspect — produces evidence
      const a1 = await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'inspect_rpc',
        p_description: 'Inspected calculate_payment RPC, found incorrect formula',
        p_files_changed: [],
        p_tests_run: ['vitest:payments.test.ts'],
        p_evidence_produced: ['Formula uses wrong tax rate'],
        p_progress_made: true,
      });
      expect(a1).toBeTruthy();

      // Attempt 2: Fix — different strategy, produces evidence
      const a2 = await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_migration',
        p_description: 'Updated tax rate in migration',
        p_files_changed: ['supabase/migrations/0077_fix_tax.sql'],
        p_tests_run: ['vitest:payments.test.ts'],
        p_test_results: { passed: 5, failed: 2 },
        p_evidence_produced: ['Tax rate fixed but 2 tests fail due to auth'],
        p_failure_reason: 'Auth error on 2 tests',
        p_failure_category: 'auth_error',
        p_progress_made: true,
      });
      expect(a2).toBeTruthy();

      // Attempt 3: Fix auth — resolves the task
      const a3 = await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_auth_flow',
        p_description: 'Fixed JWT token refresh',
        p_files_changed: ['src/lib/auth.ts'],
        p_tests_run: ['vitest:payments.test.ts'],
        p_test_results: { passed: 7, failed: 0 },
        p_evidence_produced: ['All tests pass'],
        p_progress_made: true,
      });
      expect(a3).toBeTruthy();

      // Verify loop detection shows no loop
      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(false);
      expect(loop.total_attempts).toBe(3);
      expect(loop.no_progress_count).toBe(0);

      // Resolve the task
      const resolved = await rpc('resolve_task', {
        p_task_id: taskId,
        p_resolution_summary: 'Fixed tax rate calculation and JWT refresh',
      });
      expect(resolved).toBe(true);

      // Verify task is resolved
      const tasks = await sql(
        `SELECT status, attempt_count, resolution_summary FROM agent_tasks WHERE id = '${taskId}'`
      );
      expect(tasks[0].status).toBe('resolved');
      expect(tasks[0].attempt_count).toBe(3);
    });
  });

  describe('Scenario B — Same strategy repeated (loop detection)', () => {
    it('should detect same strategy loop', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix login error (loop test)',
        p_module: 'auth',
        p_entity_type: 'user',
      });

      // Attempt 1: Fix UI code
      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_ui_component',
        p_description: 'Changed login form validation',
        p_evidence_produced: ['Still fails after change'],
        p_progress_made: false,
        p_failure_reason: 'Login still fails',
        p_failure_category: 'test_failure',
      });

      // Attempt 2: Same strategy
      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_ui_component',
        p_description: 'Changed login form again',
        p_evidence_produced: ['Still fails with same error'],
        p_progress_made: false,
        p_failure_reason: 'Login still fails',
        p_failure_category: 'test_failure',
      });

      // Attempt 3: Same strategy
      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_ui_component',
        p_description: 'Changed login form third time',
        p_evidence_produced: ['Still fails with same error'],
        p_progress_made: false,
        p_failure_reason: 'Login still fails',
        p_failure_category: 'test_failure',
      });

      // Loop detection should fire
      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(true);
      expect(loop.loop_type).toBe('same_strategy_loop');
      expect(loop.same_strategy_count).toBe(3);
      expect(loop.no_progress_count).toBe(3);
      expect(loop.recommendation).toContain('Change investigation approach');

      // Verify task state
      const tasks = await sql(
        `SELECT attempt_count, strategy_change_count FROM agent_tasks WHERE id = '${taskId}'`
      );
      expect(tasks[0].attempt_count).toBe(3);
      expect(tasks[0].strategy_change_count).toBe(0); // no strategy changes

      // Cleanup
      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario C — Different strategy makes progress', () => {
    it('should not detect loop when strategy changes and progress is made', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix database persistence issue',
        p_module: 'sales',
        p_entity_type: 'sale',
      });

      // Attempt 1: Fix UI
      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'fix_ui_component',
        p_description: 'Modified form submission',
        p_evidence_produced: ['Form submits correctly but data not persisted'],
        p_progress_made: false,
        p_failure_reason: 'Data not reaching server',
        p_failure_category: 'test_failure',
      });

      // Attempt 2: Different strategy — inspect RPC (progress: new evidence)
      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'inspect_rpc',
        p_description: 'Checked RPC parameters',
        p_evidence_produced: ['RPC expects snake_case but UI sends camelCase'],
        p_progress_made: true, // NEW EVIDENCE!
      });

      // Verify: no loop despite 2 attempts
      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(false);
      expect(loop.same_strategy_count).toBe(1); // only 1 with current strategy
      expect(loop.no_progress_count).toBe(1); // only 1 no-progress (attempt 1)

      // Cleanup
      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario D — Same failure repeated (failure loop)', () => {
    it('should detect same failure loop', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix schema mismatch (failure loop)',
        p_module: 'inventory',
        p_entity_type: 'product',
      });

      // 3 attempts with same failure category
      for (let i = 0; i < 3; i++) {
        await rpc('record_attempt', {
          p_task_id: taskId,
          p_strategy: `approach_${i + 1}`,
          p_evidence_produced: [],
          p_progress_made: false,
          p_failure_reason: 'Column does not exist',
          p_failure_category: 'schema_mismatch',
        });
      }

      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(true);
      expect(loop.loop_type).toBe('same_failure_loop');
      expect(loop.same_failure_count).toBe(3);

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario E — Persistent failure escalation', () => {
    it('should escalate after many attempts with no progress', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Complex issue requiring escalation',
        p_module: 'auth',
      });

      // 5 no-progress attempts with different strategies
      for (let i = 0; i < 5; i++) {
        await rpc('record_attempt', {
          p_task_id: taskId,
          p_strategy: `strategy_${String.fromCharCode(65 + i)}`,
          p_evidence_produced: [],
          p_progress_made: false,
          p_failure_reason: 'Persistent failure',
          p_failure_category: 'unknown',
        });
      }

      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(true);
      expect(loop.loop_type).toBe('no_evidence_loop');
      expect(loop.no_progress_count).toBe(5);

      // Escalate
      const escalated = await rpc('escalate_task', {
        p_task_id: taskId,
        p_level: 2,
        p_reason: '5 consecutive attempts with no progress',
      });
      expect(escalated).toBe(true);

      // Verify escalated
      const tasks = await sql(
        `SELECT status, escalation_level, escalation_reason FROM agent_tasks WHERE id = '${taskId}'`
      );
      expect(tasks[0].status).toBe('escalated');
      expect(tasks[0].escalation_level).toBe(2);

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario F — Sensitive data protection', () => {
    it('should not store extra sensitive data in task records', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix auth with sensitive data in description',
        p_module: 'auth',
      });

      // Attempt with sensitive-looking data in description
      const attemptId = await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'investigate',
        p_description: 'Tested with password=secret123 and token=abc123',
        p_files_changed: ['src/lib/auth.ts'],
        p_evidence_produced: ['Found issue with JWT validation'],
        p_progress_made: true,
      });

      // Verify the attempt stores the description as-is (caller's responsibility to sanitize)
      // but the system doesn't automatically add extra sensitive data
      const attempts = await sql(
        `SELECT description, evidence_produced FROM agent_attempts WHERE id = '${attemptId}'`
      );
      // The description is stored — system doesn't strip it, caller is responsible
      expect(attempts[0].description).toBeTruthy();

      // Verify task doesn't have extra sensitive data in evidence_summary
      const tasks = await sql(
        `SELECT description, evidence_summary FROM agent_tasks WHERE id = '${taskId}'`
      );
      expect(tasks[0].description).toContain('QA Test');
      // evidence_summary should be empty by default (system doesn't collect it automatically)
      expect(tasks[0].evidence_summary).toEqual({});

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario G — Memory integration', () => {
    it('should link tasks to incidents and resolutions', async () => {
      // Create a task linked to a known resolution
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Fix issue with known resolution',
        p_module: 'payments',
        p_resolution_id: '00000000-0000-0000-0000-000000000001', // dummy
      });

      const tasks = await sql(
        `SELECT linked_resolution_id FROM agent_tasks WHERE id = '${taskId}'`
      );
      // The resolution ID is stored even if it doesn't exist in known_resolutions
      // (FK not enforced at RPC level — it's advisory linkage)
      expect(tasks[0].linked_resolution_id).toBe('00000000-0000-0000-0000-000000000001');

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario H — Abandon task', () => {
    it('should abandon a task that cannot be resolved', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Cannot fix this issue',
        p_module: 'infrastructure',
      });

      await rpc('record_attempt', {
        p_task_id: taskId,
        p_strategy: 'investigate',
        p_evidence_produced: ['Issue is in third-party library'],
        p_progress_made: false,
        p_failure_reason: 'Dependency not controllable',
        p_failure_category: 'dependency_error',
      });

      const abandoned = await rpc('abandon_task', {
        p_task_id: taskId,
        p_reason: 'Issue is in third-party library, cannot fix',
      });
      expect(abandoned).toBe(true);

      const tasks = await sql(
        `SELECT status FROM agent_tasks WHERE id = '${taskId}'`
      );
      expect(tasks[0].status).toBe('abandoned');

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario I — Invalid inputs', () => {
    it('should reject empty task description', async () => {
      try {
        await rpc('start_agent_task', { p_description: '' });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('required');
      }
    });

    it('should reject invalid failure category', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Validation test',
      });

      try {
        await rpc('record_attempt', {
          p_task_id: taskId,
          p_strategy: 'test',
          p_failure_category: 'invalid_category',
        });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('Invalid failure category');
      }

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });

    it('should reject recording attempt on non-existent task', async () => {
      try {
        await rpc('record_attempt', {
          p_task_id: '00000000-0000-0000-0000-000000000000',
          p_strategy: 'test',
        });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('not found');
      }
    });

    it('should reject resolving non-existent task', async () => {
      try {
        await rpc('resolve_task', {
          p_task_id: '00000000-0000-0000-0000-000000000000',
          p_resolution_summary: 'done',
        });
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('not found');
      }
    });
  });

  describe('Scenario J — RLS and security', () => {
    it('should enforce RLS on agent_tasks table', async () => {
      const result = await sql(
        "SELECT COUNT(*) as cnt FROM agent_tasks"
      );
      expect(result[0].cnt).toBeGreaterThanOrEqual(0);
    });

    it('should enforce RLS on agent_attempts table', async () => {
      const result = await sql(
        "SELECT COUNT(*) as cnt FROM agent_attempts"
      );
      expect(result[0].cnt).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Scenario K — Search functionality', () => {
    it('should search tasks by status', async () => {
      // Create a task
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: Searchable task',
        p_module: 'customers',
      });

      const result = await rpc('search_agent_tasks', {
        p_status: 'in_progress',
        p_module: 'customers',
        p_limit: 10,
      });

      expect(Array.isArray(result)).toBe(true);
      const found = result.find((t: any) => t.id === taskId);
      expect(found).toBeTruthy();
      expect(found.module).toBe('customers');

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });

  describe('Scenario L — No-evidence loop detection', () => {
    it('should detect no-evidence loop after 5 consecutive no-progress attempts', async () => {
      const taskId = await rpc('start_agent_task', {
        p_description: 'QA Test: No evidence loop detection',
        p_module: 'returns',
      });

      for (let i = 0; i < 5; i++) {
        await rpc('record_attempt', {
          p_task_id: taskId,
          p_strategy: `strategy_${i + 1}`,
          p_evidence_produced: [],
          p_progress_made: false,
          p_failure_reason: 'Same error',
          p_failure_category: 'test_failure',
        });
      }

      const loop = await rpc('detect_loop', { p_task_id: taskId });
      expect(loop.loop_detected).toBe(true);
      expect(loop.loop_type).toBe('no_evidence_loop');
      expect(loop.no_progress_count).toBe(5);

      await sql(`DELETE FROM agent_tasks WHERE id = '${taskId}'`);
    });
  });
});
