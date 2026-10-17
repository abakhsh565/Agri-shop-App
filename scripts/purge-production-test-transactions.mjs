#!/usr/bin/env node
/**
 * purge-production-test-transactions.mjs — remove every test transaction from production, and put
 * the derived figures they left behind back to zero.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION. A migration replays everywhere. This decision is about
 * ONE database whose owner has said, in writing, that the rows it holds are test data: the tenant is
 * the seeding migrations' demo shop, the customers and suppliers are demo rows, and the 52 sales are
 * the record of manual testing. Putting that into `supabase/migrations/` would delete the same rows
 * on staging and on every future replay, which is not the decision that was made.
 *
 * WHAT IS REMOVED (children before parents; every table is only touched if it exists):
 *   return_items · returns · voids · sale_items · sales · purchase_items · purchases
 *   supplier_payments · customer_payments · inventory_movements · stock_adjustments
 *   cash_reconciliations · credit_limit_requests · customer_crops
 *   reminder_logs · reminder_occurrences · notifications · price_history · audit_events
 *
 * WHAT IS KEPT: schema, RPCs, policies, shops, branches, users, memberships, roles, permissions,
 * settings, suppliers, products, variants and customers — the working application structure. Stock
 * and customer/supplier balances are reset to zero because the movements and sales that produced
 * them no longer exist; leaving the old totals would be the inconsistency this script exists to
 * avoid.
 *
 * SAFETY
 *   * production only, and the credential's own user string must name production (`postgres.<ref>`);
 *   * dry run unless `--confirm PURGE-PRODUCTION-TEST-TRANSACTIONS` is passed;
 *   * ONE transaction: every delete, every reset and every assertion commits together or not at all;
 *   * assertions run before commit — all purged tables must be empty, no derived figure may be
 *     non-zero, and no orphan may reference a deleted row. A failure rolls back.
 *
 * USAGE (through the credential wrapper, which is the only place the password lives)
 *   node scripts/run-with-production-credentials.mjs -- \
 *     node scripts/purge-production-test-transactions.mjs --env production --dry-run
 *   node scripts/run-with-production-credentials.mjs -- \
 *     node scripts/purge-production-test-transactions.mjs --env production \
 *       --confirm PURGE-PRODUCTION-TEST-TRANSACTIONS --json backups/purge-report.json
 */

import fs from 'node:fs';
import path from 'node:path';

import pg from 'pg';

import { ROOT, connectionStringFor, resolveCredentials } from './lib/environments.mjs';

// PRODUCTION-PURGE-GUARDED — the marker `tests/unit/productionDataPolicy.test.ts` requires before a
// destructive script may name production. It is only ever satisfied together with the exact
// confirmation token, a dry run by default, and a single transaction that rolls back on failure.
const CONFIRMATION = 'PURGE-PRODUCTION-TEST-TRANSACTIONS';
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1] ?? fallback;
};
const has = (name) => argv.includes(`--${name}`);

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

const envName = flag('env');
if (envName !== 'production') {
  refuse('this script only ever runs against production (`--env production`); it deletes business history.');
}

let creds;
try {
  creds = resolveCredentials('production', { requireAll: true, allowEnvFile: false });
} catch (error) {
  refuse(`${error.message}\n  Run it through scripts/run-with-production-credentials.mjs.`);
}

const declaredRef = creds.projectRef;
if (!creds.values.PROD_DB_USER?.endsWith(`.${declaredRef}`)) {
  refuse(`the credential does not name production (${declaredRef}).`);
}

const dryRun = has('dry-run') || flag('confirm') !== CONFIRMATION;

/** Children before parents. `null` in the second column = no row filter, the whole table is test data. */
const PURGE = [
  ['return_items', null],
  ['returns', null],
  ['voids', null],
  ['sale_items', null],
  ['sales', null],
  ['purchase_items', null],
  ['purchases', null],
  ['supplier_payments', null],
  ['customer_payments', null],
  ['inventory_movements', null],
  ['stock_adjustments', null],
  ['cash_reconciliations', null],
  ['credit_limit_requests', null],
  ['customer_crops', null],
  ['reminder_logs', null],
  ['reminder_occurrences', null],
  ['notifications', null],
  ['price_history', null],
  ['audit_events', null],
];

/** Derived figures that only these transactions produced. */
const RESET = [
  ['customers', 'outstanding_balance = 0, total_purchases = 0, total_paid = 0'],
  ['products', 'stock_qty = 0'],
  ['product_variants', 'stock_qty = 0'],
  ['companies', 'outstanding_payable = 0, total_purchases = 0'],
];

const client = new pg.Client({
  connectionString: connectionStringFor(creds),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const exists = async (table) => Boolean((await one('select to_regclass($1) as t', [`public.${table}`])).t);
const countOf = async (table) => Number((await one(`select count(*)::int as n from public."${table}"`)).n);

const report = {
  environment: 'production',
  projectRef: declaredRef,
  startedAt: new Date().toISOString(),
  dryRun,
  before: {},
  deleted: {},
  reset: {},
  after: {},
  assertions: {},
};

try {
  await client.query('begin');
  await client.query("set local statement_timeout = '300s'");

  const before = {};
  for (const [table] of PURGE) {
    before[table] = (await exists(table)) ? await countOf(table) : null;
  }
  for (const [table] of RESET) {
    before[`${table} (derived)`] = (await exists(table)) ? await countOf(table) : null;
  }
  report.before = before;
  report.salesBefore = await one(
    'select count(*)::int as n, coalesce(sum(total_amount), 0)::text as total from public.sales',
  );

  for (const [table] of PURGE) {
    if (!(await exists(table))) continue;
    const result = await client.query(`delete from public."${table}"`);
    report.deleted[table] = result.rowCount;
  }

  for (const [table, assignment] of RESET) {
    if (!(await exists(table))) continue;
    // Only apply the columns the table actually has, so a replay against a narrower schema does not
    // fail on a column that a later migration added elsewhere.
    const columns = (
      await client.query(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
        [table],
      )
    ).rows.map((r) => r.column_name);
    const sets = assignment
      .split(',')
      .map((s) => s.trim())
      .filter((s) => columns.includes(s.split('=')[0].trim()));
    if (!sets.length) continue;
    const result = await client.query(`update public."${table}" set ${sets.join(', ')}`);
    report.reset[table] = result.rowCount;
  }

  // ── Assertions, before commit ────────────────────────────────────────────────────────────────
  const problems = [];

  for (const [table] of PURGE) {
    if (!(await exists(table))) continue;
    const n = await countOf(table);
    if (n !== 0) problems.push(`${table} still holds ${n} row(s)`);
  }

  const derived = [
    ['customers', 'outstanding_balance'],
    ['customers', 'total_purchases'],
    ['customers', 'total_paid'],
    ['products', 'stock_qty'],
    ['product_variants', 'stock_qty'],
    ['companies', 'outstanding_payable'],
    ['companies', 'total_purchases'],
  ];
  for (const [table, column] of derived) {
    if (!(await exists(table))) continue;
    const has = await one(
      `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
      [table, column],
    );
    if (!has) continue;
    const { n } = await one(`select count(*)::int as n from public."${table}" where coalesce(${column},0) <> 0`);
    if (Number(n) !== 0) problems.push(`${table}.${column} is non-zero on ${n} row(s)`);
  }

  const orphans = [
    ['returns', 'sale_id', 'sales'],
    ['voids', 'sale_id', 'sales'],
    ['sale_items', 'sale_id', 'sales'],
    ['purchase_items', 'purchase_id', 'purchases'],
  ];
  for (const [child, column, parent] of orphans) {
    if (!(await exists(child)) || !(await exists(parent))) continue;
    const { n } = await one(
      `select count(*)::int as n from public."${child}" c
        where c.${column} is not null and not exists (select 1 from public."${parent}" p where p.id = c.${column})`,
    );
    if (Number(n) !== 0) problems.push(`${child}.${column} references ${n} missing ${parent} row(s)`);
  }

  const sales = await one('select count(*)::int as n, coalesce(sum(total_amount),0)::text as total from public.sales');
  if (Number(sales.n) !== 0) problems.push(`sales still holds ${sales.n} row(s)`);

  // Configuration must have survived untouched.
  const config = await one(`select
      (select count(*)::int from public.shops) shops,
      (select count(*)::int from public.branches) branches,
      (select count(*)::int from public.users) users,
      (select count(*)::int from public.memberships) memberships,
      (select count(*)::int from public.permissions) permissions,
      (select count(*)::int from public.roles) roles`);
  if (config.shops < 1 || config.branches < 1 || config.users < 1 || config.memberships < 1) {
    problems.push(`configuration did not survive: ${JSON.stringify(config)}`);
  }

  report.assertions = { ok: problems.length === 0, problems, config, salesAfter: sales };

  if (problems.length) {
    await client.query('rollback');
    console.error('ROLLED BACK — the purge did not satisfy its own invariants:');
    problems.forEach((p) => console.error(`  ✗ ${p}`));
    process.exit(1);
  }

  if (dryRun) {
    await client.query('rollback');
    report.committed = false;
  } else {
    await client.query('commit');
    report.committed = true;
  }

  for (const [table] of PURGE) {
    report.after[table] = (await exists(table)) ? await countOf(table) : null;
  }
  report.finishedAt = new Date().toISOString();
} catch (error) {
  try {
    await client.query('rollback');
  } catch {
    /* the transaction is gone; the original error is the one that matters */
  }
  console.error(`FAILED and rolled back: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

const jsonOut = flag('json');
if (jsonOut) {
  const abs = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n  Report: ${path.relative(ROOT, abs)}`);
}

console.log(`\n  ${dryRun ? 'DRY RUN — rolled back' : report.committed ? 'COMMITTED' : 'NOT COMMITTED'}`);
console.log(`  deleted: ${JSON.stringify(report.deleted)}`);
console.log(`  reset  : ${JSON.stringify(report.reset)}`);
console.log(`  assertions: ${report.assertions?.ok ? 'PASS' : 'FAIL'}`);
