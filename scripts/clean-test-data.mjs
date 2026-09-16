#!/usr/bin/env node
/**
 * clean-test-data.mjs — Remove ALL business/test data from the QA database.
 * 
 * Preserves: schema, tables, RLS, RPCs, functions, triggers, shops, users, auth.
 * Removes: customers, products, companies, sales, payments, inventory, returns,
 *          voids, credit requests, notifications, reminders, audit, shop_requests,
 *          activity_log, and ALL orphaned auth.users.
 * 
 * Usage: node scripts/clean-test-data.mjs
 */

import pg from 'pg';
const { Client } = pg;

const DATABASE_URL = process.env.QA_DATABASE_URL || 
  (process.env.QA_DB_USER && process.env.QA_DB_PASS && process.env.QA_DB_HOST
    ? `postgresql://${process.env.QA_DB_USER}:${process.env.QA_DB_PASS}@${process.env.QA_DB_HOST}:5432/postgres`
    : 'postgresql://postgres.bpybjrjenwccowvtrevu:LptUWZQm4TZrRksv4nAtFUHk3YG6rO@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres');

const KEEP_PHONES = ['923001234567', '923001122334']; // Seed accounts only

async function clean() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  
  const tables = [
    // Child tables first (FK order)
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
    'price_history',
    'agent_tasks', 'agent_attempts',
    'engineering_memory',
    'incident_reports',
    'drafts',
  ];
  
  let totalDeleted = 0;
  for (const table of tables) {
    try {
      const r = await c.query(`DELETE FROM ${table}`);
      if (r.rowCount > 0) {
        console.log(`  ${table}: removed ${r.rowCount} rows`);
        totalDeleted += r.rowCount;
      }
    } catch (e) {
      // Table might not exist — that's fine
    }
  }
  
  // Remove test users (keep seed accounts)
  try {
    const r = await c.query(`DELETE FROM users WHERE phone NOT IN ('${KEEP_PHONES.join("','")}')`);
    if (r.rowCount > 0) {
      console.log(`  users: removed ${r.rowCount} test users`);
      totalDeleted += r.rowCount;
    }
  } catch (e) { console.log('  users cleanup error:', e.message); }
  
  // Remove orphaned auth.users
  try {
    const appUsers = await c.query('SELECT id FROM users');
    const keepIds = new Set(appUsers.rows.map(r => r.id));
    const authUsers = await c.query('SELECT id FROM auth.users');
    for (const au of authUsers.rows) {
      if (!keepIds.has(au.id)) {
        await c.query('DELETE FROM auth.users WHERE id = $1', [au.id]);
        totalDeleted++;
      }
    }
    const remaining = await c.query('SELECT count(*) FROM auth.users');
    console.log(`  auth.users: ${remaining.rows[0].count} remaining`);
  } catch (e) { console.log('  auth.users cleanup error:', e.message); }
  
  // Verify clean state
  console.log('\n--- Verification ---');
  const verifyTables = ['customers', 'products', 'companies', 'sales', 'sale_items', 
    'customer_payments', 'inventory_movements', 'stock_adjustments', 'shop_requests', 'voids'];
  let allClean = true;
  for (const t of verifyTables) {
    try {
      const r = await c.query(`SELECT count(*) FROM ${t}`);
      const count = parseInt(r.rows[0].count);
      if (count > 0) {
        console.log(`  ⚠️  ${t}: still has ${count} rows`);
        allClean = false;
      }
    } catch {}
  }
  
  const userCount = await c.query('SELECT count(*) FROM users');
  console.log(`  users: ${userCount.rows[0].count}`);
  
  console.log(`\nTotal rows removed: ${totalDeleted}`);
  console.log(`Status: ${allClean ? '✅ CLEAN' : '⚠️  NOT FULLY CLEAN'}`);
  
  await c.end();
}

clean().catch(e => { console.error(e); process.exit(1); });
