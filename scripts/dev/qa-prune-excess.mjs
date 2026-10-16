#!/usr/bin/env node
/**
 * qa-prune-excess.mjs — remove the QA rows that are provably this repository's own test residue.
 *
 * WHY THIS EXISTS
 *   `qa-baseline.mjs` reports drift and refuses to judge. `qa-excess.mjs` attributes rows above the
 *   reviewed declaration into CONFIRMED and UNKNOWN. What was missing was the act itself: removing
 *   the confirmed rows, in one transaction, against the QA project only, with a recount that does not
 *   come from this script's own arithmetic.
 *
 * THE RULES IT OBEYS
 *   Only CONFIRMED rows — the criteria live in `qa-excess-criteria.mjs` and are justified there by
 *   evidence in the row (actor, fixture customer, row shape, date), never by a count being higher than
 *   expected. UNKNOWN rows are reported and preserved.
 *   TWO CLASSES, both from that module: the SHAPED residue (`EXCESS_RULES` — the permissions suite's
 *   sales, its credit requests, and the one supplier payment recorded against the shared supplier
 *   fixture) and the residue whose SUBJECT IS GONE (`ORPHAN_RULES` — 3 `inventory_movements` and 4
 *   `notifications` whose sale/void/payment no longer exists, measured 2026-10-14). Each line the plan
 *   prints names the basis it was selected on, because for a notification the basis is the suite-only
 *   actor in the lane window, not a missing parent.
 *   QA only, structurally: the connection must resolve to the QA project ref, and a connection string
 *   naming the production project ref is refused by name before any statement runs.
 *   Children before parents: `voids.sale_id` is ON DELETE NO ACTION, so a sale cannot be removed while
 *   its void exists; `sale_items.sale_id` cascades but is deleted explicitly so the count is visible.
 *   Nothing is inferred after the fact: the tool prints the plan (default) or executes it (--apply),
 *   and then recounts through `qa-baseline.mjs`'s own checker, which knows nothing about this script.
 *
 * USAGE
 *   node scripts/dev/qa-prune-excess.mjs            # plan only (DRY RUN) — prints every row to remove
 *   node scripts/dev/qa-prune-excess.mjs --apply    # execute, then recount independently
 */
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';
import {
  ORPHAN_PRESERVED,
  ORPHAN_RULES,
  ORPHAN_TABLES,
  PRESERVED_BY_CONSTRUCTION,
  excessWhere,
  orphanWhere,
} from './qa-excess-criteria.mjs';
import { checkBaseline } from './qa-baseline.mjs';

/** The production project ref, named so this tool can refuse it out loud. */
const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';

const apply = process.argv.includes('--apply');

const url = qaDatabaseUrl();
if (!url) {
  console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
  process.exit(2);
}

let targetRef = '';
try {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username || '');
  targetRef = user.includes('.') ? user.split('.')[1] : (parsed.hostname.match(/^([a-z]{20})\./)?.[1] ?? '');
} catch {
  targetRef = '';
}

console.log(`── target project ref: ${targetRef || '(unreadable)'}`);
// Two independent refusals, because "the ref parsed correctly" and "this is not production" are
// different claims and only the second one protects the data.
if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error(`Refusing to run: the connection string names the PRODUCTION project (${PRODUCTION_PROJECT_REF}).`);
  process.exit(2);
}
if (targetRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const iso = (v) => (v instanceof Date ? v.toISOString().replace('.000Z', 'Z') : v ? String(v) : null);

async function main() {
  await client.connect();

  const saleWhere = excessWhere('sales', 's');
  const creditWhere = excessWhere('credit_limit_requests');

  const sales = (await client.query(
    `select s.id, s.sale_number, s.created_at, s.total_amount, s.is_voided, s.employee_name,
            c.name as customer_name, sh.name as shop_name
       from sales s
       left join customers c on c.id = s.customer_id
       left join shops sh on sh.id = s.shop_id
      where ${saleWhere}
      order by s.created_at`,
  )).rows;

  const saleIds = sales.map((s) => s.id);
  const idList = (ids) => ids.map((i) => `'${i}'`).join(', ');

  const voids = saleIds.length
    ? (await client.query(`select id, sale_id, reason, created_at from voids where sale_id in (${idList(saleIds)})`)).rows
    : [];
  const items = saleIds.length
    ? (await client.query(`select id, sale_id from sale_items where sale_id in (${idList(saleIds)})`)).rows
    : [];
  // `returns.sale_id` is ON DELETE NO ACTION: if anything here references a doomed sale the whole
  // removal must stop, because the return is not residue of the same run.
  const returns = saleIds.length
    ? (await client.query(`select id, sale_id from returns where sale_id in (${idList(saleIds)})`)).rows
    : [];

  const credit = (await client.query(
    `select id, customer_name, status, requested_by, created_at, requested_limit
       from credit_limit_requests where ${creditWhere} order by created_at`,
  )).rows;

  // ── The residue whose subject is gone (2026-10-14): the rows an RPC wrote beside a sale or payment
  // the lane then removed. Selected by the SAME expression the DELETE below carries, so the plan and the
  // removal cannot describe different rows — and the parent-absent clause is inside both, so a row whose
  // subject reappears between the plan and the transaction is not deleted by this pass.
  const orphans = {};
  for (const table of ORPHAN_TABLES) {
    const where = orphanWhere(table, 'r');
    orphans[table] = (await client.query(
      `select r.* from ${table} r where ${where} order by r.created_at`,
    )).rows;
  }

  const supplierWhere = excessWhere('supplier_payments');
  const supplierPayments = (await client.query(
    `select id, company_id, amount, method, recorded_by_name, created_at, idempotency_key
       from supplier_payments where ${supplierWhere} order by created_at`,
  )).rows;

  console.log(`\n═══ ${apply ? 'QA EXCESS PRUNE — APPLYING' : 'QA EXCESS PRUNE — PLAN (dry run, nothing written)'}`);
  console.log(`  sales to remove                 ${sales.length}`);
  for (const s of sales) {
    console.log(`     ${s.sale_number}  ${iso(s.created_at)}  ${s.customer_name}  ${s.total_amount}  voided=${s.is_voided}  by ${s.employee_name}`);
  }
  console.log(`  sale_items (children)           ${items.length}`);
  console.log(`  voids (children)                ${voids.length}`);
  console.log(`  credit_limit_requests           ${credit.length}`);
  for (const c of credit.slice(0, 5)) console.log(`     ${iso(c.created_at)}  ${c.customer_name}  ${c.status}  requested_by=${c.requested_by}`);
  if (credit.length > 5) console.log(`     … ${credit.length - 5} more, same fixture customer, same 2026-10-13 runs`);
  console.log(`  returns referencing those sales ${returns.length}${returns.length ? '  ← REMOVAL REFUSED (a return is not this run\'s residue)' : ''}`);

  for (const table of ORPHAN_TABLES) {
    const rows = orphans[table];
    const rule = ORPHAN_RULES[table];
    // WHAT IS PRINTED FOLLOWS THE RULE THAT SELECTED THE ROW. A movement is removed because its
    // reference is gone, and the line says so. A payment notification is removed because a suite-only
    // account wrote it in the lane window — its `entity_id` is often a fixture CUSTOMER that still
    // exists, so claiming "absent" for it would be a false statement in an audit trail.
    const basis = rule.requireParentAbsent ? 'subject' : 'event';
    const why = rule.requireParentAbsent ? 'reference absent' : 'suite actor, lane window';
    console.log(`  ${table} (${why})`.padEnd(34) + `${rows.length}`);
    for (const row of rows) {
      const subject = `${row[rule.link.typeColumn] ?? '(untyped)'}:${row[rule.link.column]}`;
      console.log(
        `     ${iso(row.created_at)}  ${row.id}  ${basis}=${subject}  actor=${row[rule.actor] ?? 'null'}  (${why})`,
      );
    }
  }

  console.log(`  supplier_payments (lane burst)  ${supplierPayments.length}`);
  for (const p of supplierPayments) {
    console.log(
      `     ${iso(p.created_at)}  ${p.id}  company=${p.company_id}  ${p.amount} ${p.method}  by ${p.recorded_by_name}`,
    );
  }

  console.log('\n  preserved by construction:');
  for (const line of PRESERVED_BY_CONSTRUCTION) console.log(`     · ${line}`);
  for (const line of ORPHAN_PRESERVED) console.log(`     · ${line}`);

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to remove the rows above.');
    return;
  }
  if (returns.length) {
    console.error('\nREFUSED: a return references a sale in this set. Nothing was removed.');
    process.exitCode = 1;
    return;
  }

  const before = {};
  for (const table of ['sales', 'sale_items', 'voids', 'credit_limit_requests', 'audit_events', ...ORPHAN_TABLES, 'supplier_payments']) {
    before[table] = (await client.query(`select count(*)::int n from ${table}`)).rows[0].n;
  }

  await client.query('BEGIN');
  try {
    // Children first. Each statement is scoped by the parent id list from the plan above, so the
    // removal cannot widen between the plan and the execution inside the same transaction.
    if (items.length) await client.query(`delete from sale_items where sale_id in (${idList(saleIds)})`);
    if (voids.length) await client.query(`delete from voids where sale_id in (${idList(saleIds)})`);
    if (saleIds.length) await client.query(`delete from sales where id in (${idList(saleIds)})`);
    await client.query(`delete from credit_limit_requests where ${creditWhere}`);

    // The residue whose subject is gone. The criteria is repeated INSIDE the delete — ids alone would
    // remove a row that stopped being residue between the plan and this statement, which is exactly what
    // the parent-absent clause exists to prevent. A statement that removes a different number of rows
    // than the plan showed aborts the transaction rather than reporting a partial cleanup.
    for (const table of ORPHAN_TABLES) {
      const planned = orphans[table];
      if (!planned.length) continue;
      // The table is aliased in the DELETE too: `orphanWhere` names its columns qualified (`r.reference_id`)
      // so the same expression can serve the plan's SELECT and this statement, and Postgres needs the
      // alias declared on the target for that to resolve.
      const result = await client.query(
        `delete from ${table} as r where r.id in (${idList(planned.map((row) => row.id))}) and ${orphanWhere(table, 'r')}`,
      );
      if (result.rowCount !== planned.length) {
        throw new Error(
          `${table}: the plan showed ${planned.length} row(s), the delete matched ${result.rowCount} — ` +
            'a row changed while the plan was being read',
        );
      }
    }
    if (supplierPayments.length) {
      const result = await client.query(
        `delete from supplier_payments where id in (${idList(supplierPayments.map((p) => p.id))}) and ${supplierWhere}`,
      );
      if (result.rowCount !== supplierPayments.length) {
        throw new Error(
          `supplier_payments: the plan showed ${supplierPayments.length} row(s), the delete matched ${result.rowCount}`,
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nROLLED BACK — nothing was removed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const after = {};
  for (const table of Object.keys(before)) {
    after[table] = (await client.query(`select count(*)::int n from ${table}`)).rows[0].n;
  }
  console.log('\n── row counts around the removal (this tool\'s own reading)');
  for (const table of Object.keys(before)) console.log(`   ${table.padEnd(24)} ${before[table]} → ${after[table]}`);
}

try {
  await main();
} catch (error) {
  console.error(`qa-prune-excess failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}

// The independent recount: `qa-baseline.mjs`'s own checker, which knows nothing about this script
// and re-reads the reviewed declaration. A removal this tool believes in must satisfy that gate.
if (apply && process.exitCode !== 1) {
  const result = await checkBaseline();
  console.log(`\n── independent recount through scripts/dev/qa-baseline.mjs`);
  for (const failure of result.failures) console.log(`   FAIL  ${failure}`);
  console.log(result.ok
    ? '   BASELINE OK — every remaining row is declared, every fixture is present, the isolated tenant is still empty.'
    : `   BASELINE STILL DRIFTED (${result.failures.length} finding(s))`);
  if (!result.ok) process.exitCode = 1;
}
