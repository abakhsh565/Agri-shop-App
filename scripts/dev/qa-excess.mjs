#!/usr/bin/env node
/**
 * qa-excess.mjs — WHICH rows exceed the reviewed QA declaration, and can each one be attributed?
 *
 * WHY THIS EXISTS
 *   `qa-baseline.mjs` answers "has the baseline drifted" and refuses to judge. `qa-attribution.mjs`
 *   groups rows by table, shop, time and the repo's own suite tags. Neither answers the question
 *   the cleanup actually needs: for the specific rows ABOVE the declared expectation, what are
 *   they, who made them, what do they reference, and is the evidence strong enough to remove them?
 *
 *   The rule this tool implements, stated by the owner:
 *     "Do not delete rows merely because they exceed an expected count. Confirm their ownership
 *      and test-run origin, then remove only the disposable QA records. If any records cannot be
 *      safely identified, preserve them and report that specific exception."
 *
 *   So it produces three buckets per table and never deletes:
 *     DECLARED   the rows the reviewed declaration already accounts for, named by the identity the
 *                declaration names them with (sale_number patterns, creation windows);
 *     CONFIRMED  rows beyond the declaration that carry unambiguously machine-generated evidence
 *                (a suite tag the repo's cleaner matches, a test-tagged actor, the exact creation
 *                burst of a single lane run);
 *     UNKNOWN    everything else. Reported with full identifying detail and left alone.
 *
 * THE SAFETY RULE
 *   Read-only, structurally: `BEGIN READ ONLY` plus SELECTs, rolled back. It refuses any target
 *   that is not the QA project ref, and it prints the ref it resolved so the refusal is auditable.
 *
 * USAGE
 *   node scripts/dev/qa-excess.mjs            # the evidence
 *   node scripts/dev/qa-excess.mjs --json     # machine-readable
 *   node scripts/dev/qa-excess.mjs --dependents  # also list every FK edge that points at `sales`,
 *                                                # so a removal can never orphan a child row
 */
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';
import { ORPHAN_TABLES, excessWhere, orphanWhere } from './qa-excess-criteria.mjs';

/**
 * The tables this report classifies, in the order it prints them.
 *
 * ONE LIST, not four copies: the report iterates it for the columns probe, for the classification and
 * for the output, so a table can never be classified without being printed (an earlier version of this
 * file had the loop literals written out four times, and a table added to one of them and not the
 * others was silently skipped).
 */
const TABLES = ['sales', 'sale_items', 'voids', 'credit_limit_requests', ...ORPHAN_TABLES, 'supplier_payments'];

const asJson = process.argv.includes('--json');
const withDependents = process.argv.includes('--dependents');

const url = qaDatabaseUrl();
if (!url) {
  console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
  process.exit(1);
}

let targetRef = '';
try {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username || '');
  targetRef = user.includes('.') ? user.split('.')[1] : (parsed.hostname.match(/^([a-z]{20})\./)?.[1] ?? '');
} catch {
  targetRef = '';
}
console.log(`── target project ref resolved from the configured connection: ${targetRef || '(unreadable)'}`);
if (targetRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(1);
}

/** The identities the reviewed declaration names. Rows matching these are NOT excess. */
/**
 * THE REVIEWED DECLARATION'S OWN IDENTITIES, restated as the expression that says "this row is already
 * accounted for". Read against `scripts/dev/qa-baseline.json` (reviewedAt 2026-10-14): sales `exact 2`
 * (PERM-SALE-001/002), and ZERO for every other table this file classifies.
 *
 * WHY IT WAS REWRITTEN. This map still carried the pre-incident inventory — an `^SALE-` prefix for
 * sales and a 2026-10-11/12 window for credit requests — so it reported the two PERM-SALE rows, which
 * the declaration accounts for, as "beyond the declaration". A report that names declared rows as
 * excess is how a cleanup starts deleting fixtures, so the map now restates exactly what the reviewed
 * file says. Nothing else was declared, so everything else present is beyond by construction.
 */
const DECLARED = {
  sales: `sale_number in ('PERM-SALE-001', 'PERM-SALE-002')`,
  sale_items: 'false',
  voids: 'false',
  credit_limit_requests: 'false',
  inventory_movements: 'false',
  notifications: 'false',
  supplier_payments: 'false',
};

/**
 * The columns this report reads, in preference order. Only the ones that EXIST are selected, and the
 * actor check uses whichever of the actor-shaped columns the table actually carries — assuming a
 * name (`created_by`) is what made the first version of this tool fail against `sales`.
 */
const PREFERRED = {
  sales: ['id', 'sale_number', 'created_at', 'shop_id', 'customer_id', 'employee_id', 'employee_name', 'branch_id', 'total_amount', 'status', 'is_voided', 'voided_by'],
  sale_items: ['id', 'sale_id', 'product_id', 'product_name', 'variant_id', 'qty', 'created_at'],
  voids: ['id', 'sale_id', 'reason', 'created_at', 'voided_by'],
  credit_limit_requests: ['id', 'customer_id', 'customer_name', 'status', 'created_at', 'requested_by', 'current_limit', 'requested_limit', 'reviewed_by', 'reviewed_at'],
  inventory_movements: ['id', 'product_id', 'variant_id', 'movement_type', 'reference_type', 'reference_id', 'qty_change', 'created_by', 'created_at', 'branch_id'],
  notifications: ['id', 'kind', 'entity_type', 'entity_id', 'actor_id', 'actor_name', 'shop_id', 'created_at'],
  supplier_payments: ['id', 'company_id', 'amount', 'method', 'recorded_by', 'recorded_by_name', 'created_at', 'idempotency_key', 'branch_id'],
};
const ACTOR_COLUMNS = ['user_id', 'created_by', 'sold_by', 'recorded_by', 'voided_by', 'employee_id', 'requested_by'];

/**
 * Columns WITH their types. The type matters: `credit_limit_requests.requested_by` is a text name,
 * not a uuid, so an actor comparison against `users.id` is a type error rather than a match — the
 * reason a text column must never be treated as an actor id.
 */
async function columnsOf(table) {
  return rows(
    `select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table],
  );
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const iso = (v) => (v instanceof Date ? v.toISOString().replace('.000Z', 'Z') : v ? String(v) : null);

async function rows(sql, params = []) {
  return (await client.query(sql, params)).rows;
}

async function classify(table, selectList, declaredExpr, evidenceExpr, selected) {
  // Any failure names the statement it came from: a bare column error against a generated query is
  // not diagnosable, which is exactly how two earlier versions of this file stalled.
  const run = (sql) => rows(sql).catch((error) => {
    throw new Error(`${table}: ${error.message}\n  statement: ${sql.replace(/\s+/g, ' ').slice(0, 400)}`);
  });
  // The filters run against the BASE TABLE, not against the projected view: a declared/evidence
  // expression may name a column the projection does not carry (`voided_by` on sales), and applying it
  // outside the projection is what made an earlier version of this file report a column as missing
  // when the column existed all along.
  const probe = `select ${selectList} from ${table}`;
  const beyond = await run(`${probe} where not (${declaredExpr})`);
  const confirmed = await run(`${probe} where not (${declaredExpr}) and (${evidenceExpr})`);
  const unknown = await run(`${probe} where not (${declaredExpr}) and not (${evidenceExpr})`);
  const total = (await rows(`select count(*)::int n from ${table}`))[0].n;
  return { table, columns: selected, total, beyondCount: beyond.length, confirmed, unknown };
}

/**
 * The evidence expression for a table, built from the columns that exist: the repo's own suite tags
 * on the row or its parent, plus an actor who is a tagged test identity.
 */
function evidenceFor(table, actorColumn) {
  // The two residue classes this file now reports are decided by `qa-excess-criteria.mjs` — the same
  // module the remover uses — rather than by a second copy of the patterns here. The report and the
  // removal therefore cannot disagree about a row, which is the whole reason that module exists.
  if (table === 'supplier_payments') return excessWhere(table);
  if (ORPHAN_TABLES.includes(table)) return orphanWhere(table);
  const taggedActor = actorColumn
    ? `${actorColumn} in (select id from users where name ~ '^(Destruct|Perm |Inv |Fin |QA |dhfdhdh)')`
    : null;
  if (table === 'sales') {
    return [
      `sale_number ~ '^(DST|PERM|INV|FIN|QA)-'`,
      taggedActor,
      `customer_id in (select id from customers where name ~ '^(Destruct|Perm |Inv |Fin |QA )')`,
    ].filter(Boolean).join('\n           or ');
  }
  const parent = table === 'sale_items' || table === 'voids'
    ? `sale_id in (select s.id from sales s where s.sale_number ~ '^(DST|PERM|INV|FIN|QA)-'${taggedActor ? `\n                 or s.${actorColumn} in (select id from users where name ~ '^(Destruct|Perm |Inv |Fin |QA |dhfdhdh)')` : ''})`
    : null;
  if (parent) return parent;
  if (table === 'credit_limit_requests') {
    return [
      `customer_id in (select id from customers where name ~ '^(Destruct|Perm |Inv |Fin |QA )')`,
      taggedActor,
      `created_at >= '2026-10-13'`,
    ].filter(Boolean).join('\n                          or ');
  }
  return 'false';
}

async function main() {
  await client.connect();
  await client.query('BEGIN READ ONLY');

  const out = { projectRef: targetRef, readOnly: true, tables: {} };

  if (process.argv.includes('--columns')) {
    // The schema this tool attributes, printed rather than assumed — the first two versions of this
    // file failed on a column name that was guessed from another table.
    for (const table of TABLES) {
      const cols = await columnsOf(table);
      const rule = (await rows(
        `select table_type from information_schema.tables where table_schema='public' and table_name=$1`, [table],
      ))[0]?.table_type ?? '(absent)';
      console.log(`\n${table} — ${rule}`);
      console.log(`  ${cols.map((c) => c.column_name).join(', ') || '(no columns)'}`);
    }
    await client.query('ROLLBACK');
    return;
  }

  for (const table of TABLES) {
    const columns = await columnsOf(table);
    const names = columns.map((c) => c.column_name);
    const uuidColumns = new Set(columns.filter((c) => c.data_type === 'uuid').map((c) => c.column_name));
    const selected = PREFERRED[table].filter((c) => names.includes(c));
    // If none of the preferred columns exist, fall back to every column so the report is never empty.
    const selectList = selected.length ? selected.join(', ') : '*';
    // Only a uuid column can be an actor id; a text column of the same shape would be a type error.
    const actorColumn = ACTOR_COLUMNS.find((c) => uuidColumns.has(c)) ?? null;
    const evidence = evidenceFor(table, actorColumn);
    const result = await classify(table, selectList, DECLARED[table], evidence, selected);
    result.actorColumn = actorColumn;
    out.tables[table] = result;
  }

  // Which of the excess sales/voids are grouped into one burst (a single lane run)?
  out.bursts = await rows(
    `select date_trunc('minute', created_at) as minute, count(*)::int as n, min(sale_number) as sample
       from sales group by 1 having count(*) > 1 order by 1 desc limit 20`,
  );

  if (withDependents) {
    out.dependents = await rows(
      `select tc.table_name as child_table, kcu.column_name as child_column, rc.delete_rule
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
         join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
         join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'sales'
        order by 1, 2`,
    );
  }

  await client.query('ROLLBACK');

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  for (const key of TABLES) {
    const t = out.tables[key];
    console.log(`\n═══ ${t.table} — ${t.total} row(s), ${t.beyondCount} beyond the declaration`);
    console.log(`    CONFIRMED test-origin : ${t.confirmed.length}`);
    console.log(`    UNKNOWN (preserved)   : ${t.unknown.length}`);
    for (const r of t.confirmed.slice(0, 40)) {
      console.log(`    CONFIRMED ${Object.entries(r).map(([k, v]) => `${k}=${iso(v) ?? 'null'}`).join(' ')}`);
    }
    for (const r of t.unknown) {
      console.log(`    UNKNOWN   ${Object.entries(r).map(([k, v]) => `${k}=${iso(v) ?? 'null'}`).join(' ')}`);
    }
  }

  if (process.argv.includes('--detail')) {
    // Every row, not only the excess: attribution needs the actor and the customer on the rows that
    // LOOK declared, because a lane that records a sale through the real app path produces exactly the
    // same `SALE-xxxxx` shape as a human tapping through the UI.
    for (const key of TABLES) {
      const t = out.tables[key];
      const all = await rows(`select ${t.columns.join(', ')} from ${key}`);
      console.log(`\n── ${key}: all ${all.length} row(s)`);
      for (const r of all) {
        console.log(`   ${Object.entries(r).map(([k, v]) => `${k}=${iso(v) ?? 'null'}`).join(' ')}`);
      }
    }
  }

  console.log('\n── sales creation bursts (2+ rows in the same minute)');
  for (const b of out.bursts) console.log(`   ${iso(b.minute)}  ${b.n} row(s)  e.g. ${b.sample}`);

  if (withDependents) {
    console.log('\n── foreign keys pointing at sales');
    for (const d of out.dependents) console.log(`   ${d.child_table}.${d.child_column} → sales  (on delete ${d.delete_rule})`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`qa-excess failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
