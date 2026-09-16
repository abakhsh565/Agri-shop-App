/**
 * Vitest globalSetup — cleans QA database AFTER all tests complete.
 * 
 * The setup() function runs before all tests (no-op).
 * The teardown function runs after all tests — cleans ALL business/test data.
 */

import pg from 'pg';

const DATABASE_URL = process.env.QA_DATABASE_URL ||
  'postgresql://postgres.bpybjrjenwccowvtrevu:LptUWZQm4TZrRksv4nAtFUHk3YG6rO@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

const KEEP_PHONES = ['923001234567', '923001122334'];

export async function setup() {
  // No-op before tests
}

export async function teardown() {
  // Only clean if QA env is configured
  if (!process.env.QA_DB_HOST && !process.env.QA_DATABASE_URL) return;
  
  try {
    const c = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
