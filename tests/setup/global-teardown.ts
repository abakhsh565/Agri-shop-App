/**
 * Vitest globalSetup — cleans QA database AFTER all tests complete.
 * 
 * The setup() function runs before all tests (no-op).
 * The teardown function runs after all tests — cleans ALL business/test data.
 */

import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Load .env.qa into process.env. QA credentials live in that untracked file
 * (and in CI secrets) — never in source, so this file must not carry a fallback.
 */
function loadQaEnv() {
  if (process.env.QA_DATABASE_URL) return;
  const envPath = path.resolve(process.cwd(), '.env.qa');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}
loadQaEnv();

/** QA connection, built from environment (.env.qa or CI secrets) only. */
function qaDatabaseUrl(): string {
  const explicit = process.env.QA_DATABASE_URL;
  if (explicit) return explicit;
  const { QA_DB_USER, QA_DB_PASS, QA_DB_HOST } = process.env;
  if (!QA_DB_USER || !QA_DB_PASS || !QA_DB_HOST) return '';
  return `postgresql://${QA_DB_USER}:${QA_DB_PASS}@${QA_DB_HOST}:5432/postgres`;
}

const KEEP_PHONES = ['923001234567', '923001122334'];

export async function setup() {
  // No-op before tests
}

export async function teardown() {
  // Only clean if QA env is configured
  const databaseUrl = qaDatabaseUrl();
  if (!databaseUrl) {
    console.log('[QA Cleanup] skipped — QA database credentials are not configured');
    return;
  }

  try {
    const c = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await c.connect();
    
    const tables = [
      'sale_items', 'return_items', 'sale_returns',
      'returns', 'sales', 'voids',
      'customer_payments', 'credit_limit_requests',
      'inventory_movements', 'stock_adjustments',
      'product_variants', 'products',
      'companies', 'customers',
      'shop_requests',
      'activity_log', 'audit_events',
      'notifications',
      'reminder_logs', 'reminder_occurrences', 'reminder_configs',
      'agent_tasks', 'agent_attempts',
      'incident_reports',
    ];
    
    for (const table of tables) {
      try { await c.query(`DELETE FROM ${table}`); } catch {}
    }
    
    // Remove test users (keep seed accounts)
    try {
      await c.query(`DELETE FROM users WHERE phone NOT IN ('${KEEP_PHONES.join("','")}')`);
    } catch {}
    
    // Remove orphaned auth.users
    try {
      const appUsers = await c.query('SELECT id FROM users');
      const keepIds = new Set(appUsers.rows.map(r => r.id));
      const authUsers = await c.query('SELECT id FROM auth.users');
      for (const au of authUsers.rows) {
        if (!keepIds.has(au.id)) {
          await c.query('DELETE FROM auth.users WHERE id = $1', [au.id]);
        }
      }
    } catch {}
    
    await c.end();
    console.log('[QA Cleanup] Database cleaned after test run');
  } catch (e) {
    console.error('[QA Cleanup] Error:', e.message);
  }
}
