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

// Credentials come from the environment (CI secrets) or .env.qa locally — never hardcoded.
import fs from 'node:fs';

if (!process.env.QA_DB_HOST && fs.existsSync('.env.qa')) {
  for (const line of fs.readFileSync('.env.qa', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0 || line.trim().startsWith('#')) continue;
    const key = line.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^\[|\]$/g, '');
  }
}

if ((process.env.QA_DB_USER || '').split('.')[1] !== 'bpybjrjenwccowvtrevu') {
  console.error('Refusing to run: target is not the QA project.');
  process.exit(1);
}

const DATABASE_URL = process.env.QA_DATABASE_URL
  || `postgresql://${process.env.QA_DB_USER}:${process.env.QA_DB_PASS}@${process.env.QA_DB_HOST}:5432/postgres`;

// Seed accounts only. The QA fixture accounts are kept because their Supabase Auth
// credentials live in auth.users: deleting the users row also deletes the credential,
// and the app cannot re-create it on its own (signUp yields no session until the
// email is confirmed), so the login then fails with "could not start a secure session"
// and every E2E spec that needs a real JWT times out. Keep them, or re-provision with
// scripts/provision-auth-sessions.mjs after cleaning.
const KEEP_PHONES = ['923001234567', '923001122334', '923009999999', '923008888888'];

async function clean() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  
  const tables = [
    // Child tables first (FK order). return_items -> returns/sale_items,
    // voids and returns -> sales, so both must go before sale_items/sales
    // (deleting sales first fails on voids_sale_id_fkey and blocks customers).
    'return_items', 'returns', 'voids',
    'sale_items', 'sales',
    'purchase_items', 'supplier_payments', 'purchases',
    'customer_payments', 'payments', 'credit_limit_requests', 'customer_crops',
    'inventory_movements', 'stock_adjustments',
    'product_variants', 'products',
    'companies', 'customers',
    'shop_requests',
    'cash_reconciliations', 'daily_cash_reconciliations',
    'activity_log', 'audit_events',
    'notifications',
    'reminder_logs', 'reminder_occurrences', 'reminder_configs',
    'price_history',
    'agent_tasks', 'agent_attempts',
    // engineering_memory is NOT test data — it is the durable Engineering OS
    // knowledge base. Cleaning it erased 13 verified findings once already.
    'incident_reports',
    'drafts',
  ];
  
  let totalDeleted = 0;
  const failures = [];
  for (const table of tables) {
    try {
      const r = await c.query(`DELETE FROM ${table}`);
      if (r.rowCount > 0) {
        console.log(`  ${table}: removed ${r.rowCount} rows`);
        totalDeleted += r.rowCount;
      }
    } catch (e) {
      // 42P01 = table does not exist. Anything else is a REAL cleanup gap
      // (typically a missing table in this list holding a blocking FK) and must
      // be reported, not silently swallowed.
      if (e.code === '42P01') continue;
      failures.push(`${table}: ${e.message}`);
    }
  }
  
  // Remove test users (keep seed accounts)
  try {
    const r = await c.query(`DELETE FROM users WHERE phone NOT IN ('${KEEP_PHONES.join("','")}')`);
    if (r.rowCount > 0) {
      console.log(`  users: removed ${r.rowCount} test users`);
      totalDeleted += r.rowCount;
    }
  } catch (e) { failures.push(`users: ${e.message}`); }

  // Authorization rows for users that no longer exist (memberships/user_permissions
  // of SEED users are preserved on purpose — the RBAC suites depend on them).
  for (const table of ['memberships', 'user_permissions']) {
    try {
      const r = await c.query(
        `DELETE FROM ${table} WHERE user_id NOT IN (SELECT id FROM users)`
      );
      if (r.rowCount > 0) {
        console.log(`  ${table}: removed ${r.rowCount} orphan rows`);
        totalDeleted += r.rowCount;
      }
    } catch (e) {
      if (e.code !== '42P01') failures.push(`${table}: ${e.message}`);
    }
  }
  
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
    'purchases', 'purchase_items', 'supplier_payments',
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

  if (failures.length) {
    console.log('\n--- Delete failures (real cleanup gaps) ---');
    for (const f of failures) console.log(`  ❌ ${f}`);
    allClean = false;
  }
  
  console.log(`\nTotal rows removed: ${totalDeleted}`);
  console.log(`Status: ${allClean ? '✅ CLEAN' : '⚠️  NOT FULLY CLEAN'}`);
  
  await c.end();
}

clean().catch(e => { console.error(e); process.exit(1); });
