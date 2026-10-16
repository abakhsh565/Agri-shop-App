#!/usr/bin/env node
/**
 * verify-cleanup-runbook.mjs — OFFLINE. Proves the cleanup runbook's statements actually work,
 * against a throwaway copy of production rather than against production.
 *
 *   node scripts/verify-cleanup-runbook.mjs
 *   node scripts/verify-cleanup-runbook.mjs --from backups/<artifact>.sql
 *
 * WHY THIS EXISTS
 *   A runbook is SQL somebody will paste into a live database, and the risk is not that a statement
 *   is missing — it is that the ORDER is wrong. 55 of production's 56 foreign keys are `NO ACTION`
 *   rather than `CASCADE`, so a delete that runs one table too early simply fails, midway through a
 *   transaction, on a database whose only copy is the backup you are trying not to need. The order
 *   in `docs/PRODUCTION_DEMO_DATA_CLEANUP.md` was derived from the foreign-key graph; this executes
 *   it, so "the order is right" is measured rather than reasoned about.
 *
 * WHAT IT DOES
 *   1. Loads the artifact into PGlite — an in-process Postgres that exists only for this run.
 *   2. Runs the runbook's own blocks, minus their final `rollback;`, inside a transaction whose
 *      rollback it then performs, and reports the before/after counts per table.
 *   3. Runs Plan A a second time with a second (real-looking) shop inserted, and requires the
 *      precondition to REFUSE and nothing to be deleted. A guard that cannot fail is not a guard.
 *   4. Requires Plan A to leave EVERY table empty — the table list is read from the loaded schema,
 *      not written here, so a table added by a later migration is covered the day it exists — and
 *      to NAME every table that holds rows. A table the runbook forgets to delete from fails here
 *      instead of leaving a row behind for a new owner to find. Point it at another file with
 *      `--runbook <path>` to prove that rule is not vacuous.
 *
 * WHAT IT DOES NOT DO
 *   It never opens a network connection, holds no credentials, and cannot reach production or
 *   staging: the only input is a local artifact file. `auth.users`/`auth.identities` are a shim
 *   built from the artifact's own insert columns, so this proves the runbook's SQL and its ordering,
 *   not Supabase's auth behaviour.
 *
 * Exit codes: 0 = every plan behaved as documented, 1 = it did not, 2 = refused (no artifact).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { splitStatements } from './lib/sql-statements.mjs';

const DEFAULT_RUNBOOK = 'docs/PRODUCTION_DEMO_DATA_CLEANUP.md';
const DEMO_SHOP = '00000000-0000-0000-0000-000000000001';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

// `--runbook` exists so the coverage rule below can be shown to be non-vacuous: point it at a copy of
// the runbook with one `delete from` removed and this tool must FAIL, naming the table that leaks.
const RUNBOOK = flag('--runbook') || DEFAULT_RUNBOOK;

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}
function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/**
 * The safety property, asserted rather than assumed: this tool is OFFLINE. Its database exists only
 * inside this process, so it must not run where database credentials are present — that is the
 * environment where a mistake could be mistaken for a connection, and where this script's own
 * `delete` statements would look like they meant something outside it.
 */
const CONNECTION_VARS = ['QA_DB_HOST', 'QA_DB_PASS', 'PROD_DB_HOST', 'PROD_DB_PASS', 'DATABASE_URL'];
const credentialsPresent = CONNECTION_VARS.filter((key) => (process.env[key] || '').trim().length > 0);
if (credentialsPresent.length) {
  refuse(
    `this verifier is offline-only and never connects to a database, so it refuses to run where ` +
      `database credentials are present: ${credentialsPresent.join(', ')}. Unset them and run it again — ` +
      'it needs only a local artifact file.',
  );
}

let artifact = flag('--from');
if (!artifact) {
  const dir = path.join(process.cwd(), 'backups');
  const candidates = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /^backup-production-.*\.sql$/.test(f))
        .map((f) => path.join(dir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    : [];
  if (!candidates.length) refuse('no backups/backup-production-*.sql found — pass --from <artifact.sql>');
  artifact = candidates[0];
}
if (!existsSync(artifact)) refuse(`no such artifact: ${artifact}`);
if (!existsSync(RUNBOOK)) refuse(`${RUNBOOK} is missing — nothing to verify`);

const sql = readFileSync(artifact, 'utf8');
const markdown = readFileSync(RUNBOOK, 'utf8');
const db = new PGlite();

// ── the auth shim: PGlite has no Supabase auth schema, so it is built from the insert columns ──
const authTables = new Map();
for (const m of sql.matchAll(/insert into auth\.([a-z_]+) \(([^)]*)\)/g)) {
  if (!authTables.has(m[1])) {
    authTables.set(m[1], m[2].split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  }
}
await db.exec('create schema if not exists auth');
for (const [table, cols] of authTables) {
  await db.exec(`create table if not exists auth."${table}" (${cols.map((c) => `"${c}" text`).join(', ')})`);
}
await db.exec(`
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
  create or replace function auth.email() returns text language sql stable as $$ select null::text $$;
  create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
`);
for (const role of ['anon', 'authenticated', 'service_role']) {
  await db.exec(`do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
}

// ── load the artifact ───────────────────────────────────────────────────────────────────────────
let loaded = 0;
const loadFailures = [];
for (const statement of splitStatements(sql)) {
  try {
    await db.exec(statement);
    loaded += 1;
  } catch (error) {
    loadFailures.push(`${statement.trim().split('\n')[0].slice(0, 80)} — ${String(error.message).slice(0, 80)}`);
  }
}
console.log(`artifact: ${path.relative(process.cwd(), artifact).replace(/\\/g, '/')}`);
console.log(`loaded:   ${loaded} statements executed, ${loadFailures.length} failed`);
for (const f of loadFailures.slice(0, 6)) console.log(`  ! ${f}`);
if (loadFailures.length) fail('the artifact did not load cleanly, so nothing about the runbook can be trusted from it');

const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
const AUTH_TABLES = ['auth.users', 'auth.identities'];
// The list is read from the loaded schema rather than written here. A hand-written list is exactly how
// a wipe stops covering a table nobody remembered, and "every table is empty" is the property the
// owner is buying — so it should be measured against the database, not against the runbook's prose.
const TABLES = [
  ...(await db.query(`select tablename from pg_tables where schemaname = 'public' order by tablename`))
    .rows.map((r) => r.tablename),
  ...AUTH_TABLES,
];

const before = {};
for (const t of TABLES) before[t] = await count(t);
const fkCount = (await db.query(`select count(*)::int n from pg_constraint where contype = 'f'`)).rows[0].n;
console.log(`schema:   ${fkCount} foreign keys · ${JSON.stringify(before)}`);

const blocks = [...markdown.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
const planA = blocks.find((b) => b.includes('delete from public.voids;'));
const planB = blocks.find((b) => b.includes('e7cbbff3'));
if (!planA) fail('the runbook has no Plan A block (the one that empties the demo tenant)');
if (!planB) fail('the runbook has no Plan B block (the one that removes only the test artifacts)');

/** Run a block's statements, minus its final rollback, inside a transaction we roll back ourselves. */
const runBlock = async (block, label) => {
  const statements = splitStatements(block).map((s) => s.trim()).filter(Boolean);
  if (statements[statements.length - 1] !== 'rollback') {
    fail(`${label} does not end in rollback — refusing to execute it`);
  }
  await db.exec('begin');
  try {
    for (const statement of statements.slice(0, -1)) await db.exec(statement);
  } catch (error) {
    await db.exec('rollback');
    return { ok: false, error: error.message };
  }
  return { ok: true, rollback: () => db.exec('rollback') };
};

const problems = [];

// ── 1. Plan A must REFUSE a database that holds a second, real shop ────────────────────────────
await db.exec(`insert into public.shops (id, name) values (gen_random_uuid(), 'A Real Shop')`);
const refused = await runBlock(planA, 'Plan A');
const salesAfterRefusal = await count('sales');
console.log(`\nPlan A vs a database with 2 shops: ${refused.ok ? 'RAN — that is the defect it exists to prevent' : 'refused'}`);
if (refused.ok) problems.push('Plan A ran against a database holding a real shop');
// The refusal raised inside the transaction, which runBlock already rolled back — there is nothing
// left to undo, which is the point of the precondition being the FIRST statement in the block.
else console.log(`  ${String(refused.error).split('\n')[0].slice(0, 120)}`);
if (salesAfterRefusal !== before.sales) problems.push(`the refusal still deleted rows: sales ${before.sales} -> ${salesAfterRefusal}`);
await db.exec(`delete from public.shops where id <> '${DEMO_SHOP}'`);

// ── 2. Plan A must empty the demo tenant, in an order the foreign keys accept ──────────────────
const ranA = await runBlock(planA, 'Plan A');
if (!ranA.ok) {
  problems.push(`Plan A failed on a demo-only database: ${ranA.error}`);
} else {
  const after = {};
  for (const t of TABLES) after[t] = await count(t);
  const leftover = TABLES.filter((t) => after[t] !== 0);
  console.log('\nPlan A:');
  for (const t of TABLES) console.log(`  ${t.padEnd(20)} ${String(before[t]).padStart(4)} -> ${after[t]}`);
  if (leftover.length) problems.push(`Plan A left rows behind: ${leftover.join(', ')}`);
  else console.log(`  all ${TABLES.length} tables 0, so the delete order works against the real constraint set`);

  // ── Coverage: counting afterwards only proves the tables this tool thought to count. This proves
  //    the runbook's own delete list names every table that holds rows, so a table added later cannot
  //    be silently left full on a database whose only copy is the backup you are trying not to need.
  const named = new Set(
    [...planA.matchAll(/delete\s+from\s+(?:public\.)?"?([a-z_]+)"?/gi)].map((m) => m[1].toLowerCase()),
  );
  const holding = TABLES.filter((t) => !AUTH_TABLES.includes(t) && before[t] > 0);
  const uncovered = holding.filter((t) => !named.has(t));
  if (uncovered.length) {
    problems.push(
      `Plan A never deletes from table(s) that hold rows: ${uncovered.map((t) => `${t}(${before[t]})`).join(', ')}`,
    );
  } else {
    console.log(`  coverage: Plan A names all ${holding.length} table(s) that hold rows (of ${TABLES.length} present)`);
  }
  await ranA.rollback();
  const restored = await count('sales');
  if (restored !== before.sales) problems.push(`the rollback did not restore: sales = ${restored}`);
  else console.log(`  rollback restores: sales = ${restored}`);
}

// ── 3. Plan B must remove only the two test artifacts and leave business records alone ─────────
const ranB = await runBlock(planB, 'Plan B');
if (!ranB.ok) {
  problems.push(`Plan B failed: ${ranB.error}`);
} else {
  const after = {};
  for (const t of TABLES) after[t] = await count(t);
  console.log('\nPlan B:');
  for (const t of TABLES) console.log(`  ${t.padEnd(18)} ${String(before[t]).padStart(4)} -> ${after[t]}`);
  const returnRow = (await db.query(`select processed_by_name from public.returns`)).rows[0];
  console.log(`  the return is now processed by: ${returnRow?.processed_by_name ?? '(none)'}`);
  for (const t of ['sales', 'sale_items', 'customers', 'products', 'customer_payments', 'returns', 'notifications']) {
    if (after[t] !== before[t]) problems.push(`Plan B changed ${t}: ${before[t]} -> ${after[t]}`);
  }
  if (after.users !== before.users - 1) problems.push(`Plan B removed ${before.users - after.users} users instead of 1`);
  if (!returnRow?.processed_by_name || /Test QA User/i.test(String(returnRow.processed_by_name))) {
    problems.push('the return still names the removed account');
  }
  await ranB.rollback();
}

await db.close();

if (problems.length) {
  console.error(`\nThe runbook does not do what it says (${problems.length} problem(s)):`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
console.log(
  '\nPASS: both plans behave as documented — Plan A refuses a database with a real shop, then leaves'
    + ' every table in the database empty and rolls back; and it names every table that holds rows, so a'
    + ' forgotten table cannot survive the wipe. Plan B removes exactly the two test artifacts, reassigns'
    + ' the return, and touches no business row.',
);
process.exit(0);
