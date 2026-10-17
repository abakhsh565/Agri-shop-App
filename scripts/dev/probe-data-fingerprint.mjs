#!/usr/bin/env node
/**
 * probe-data-fingerprint.mjs — prove the fingerprint works on a real Postgres, without production.
 *
 * The local Supabase stack is disposable by design (docs/LOCAL_DEVELOPMENT.md), so it is the right
 * place to answer the three questions a unit test cannot:
 *
 *   1. Does the digest stay identical when nothing moved? (a fingerprint that drifts is worse than none)
 *   2. Does an UPDATE inside a transaction that is rolled back leave the table exactly as it was?
 *      (this is what `migrate.mjs apply --env production` relies on)
 *   3. Does an additive column change the digest? It must not — otherwise every safe migration would be
 *      refused as a data change.
 *
 * A scratch table (`zz_fingerprint_probe`) is created, used and dropped. No existing row is touched.
 */
import pg from 'pg';

import { diffFingerprints, fingerprintDatabase, fingerprintTable } from '../lib/data-fingerprint.mjs';
import { rehearseBatchData } from '../lib/data-rehearsal.mjs';

const TABLE = 'public.zz_fingerprint_probe';
const connectionString = process.env.LOCAL_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * This probe CREATES and DROPS a table, so it must never be able to name a hosted database. Its safety
 * property is not "is this QA?" but "is this the local stack?": only loopback is accepted, and the
 * message says why. `LOCAL_DB_URL` exists so the port can move, not so the host can.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
function refuse(message) {
  console.error(`[REFUSED] ${message}`);
  process.exit(2);
}
try {
  const host = new URL(connectionString).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    refuse(
      `this probe writes and drops a table, so it runs against the local stack only ` +
        `(the supabase_db_* container on loopback). Refusing host ${host}.`,
    );
  }
} catch {
  refuse('LOCAL_DB_URL is not a URL; the local stack is the only target this probe accepts.');
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};

const client = new pg.Client({ connectionString });
await client.connect();
const query = (sql, params = []) => client.query(sql, params);
const tables = [TABLE];
const snapshot = () => fingerprintDatabase(query, { tables });

try {
  await query(`drop table if exists ${TABLE}`);
  await query(`create table ${TABLE} (id serial primary key, amount numeric not null)`);
  await query(`insert into ${TABLE} (amount) values (10), (20), (30)`);

  const before = await snapshot();

  // 1. A read-only pass must be stable.
  const again = await snapshot();
  check('two reads with nothing in between agree', before[TABLE].digest === again[TABLE].digest, {
    count: again[TABLE].count,
    digest: String(again[TABLE].digest).slice(0, 12),
  });

  // 2. An UPDATE is visible inside the transaction, and the rollback restores the exact rows.
  await query('begin');
  await query(`update ${TABLE} set amount = amount + 1 where id = 1`);
  const during = await snapshot();
  await query('rollback');

  const moved = diffFingerprints(before, during, []);
  check('an UPDATE inside a transaction is detected', moved.ok === false && moved.unexpected.includes(TABLE), {
    changed: moved.changed,
  });

  const restored = await snapshot();
  const clean = diffFingerprints(before, restored, []);
  const row = (await query(`select amount from ${TABLE} where id = 1`)).rows[0];
  check('ROLLBACK restores the rows exactly', clean.ok === true && String(row.amount) === '10', {
    digestEqual: before[TABLE].digest === restored[TABLE].digest,
    id1: String(row.amount),
  });

  // 3. An additive column must not look like a data change.
  await query('begin');
  await query(`alter table ${TABLE} add column if not exists note text`);
  const afterColumn = await fingerprintDatabase(query, { tables, previous: before });
  await query('rollback');
  const additive = diffFingerprints(before, afterColumn, []);
  check('an additive column is invisible to the digest', additive.ok === true && additive.changed.length === 0, {
    comparedColumns: afterColumn[TABLE].columns,
  });

  // 4. A DELETE is detected, and a missing table is never benign.
  await query('begin');
  await query(`delete from ${TABLE} where id = 3`);
  const afterDelete = await snapshot();
  await query('rollback');
  const deleted = diffFingerprints(before, afterDelete, []);
  check('a DELETE is detected by count and digest', deleted.ok === false, { changed: deleted.changed });

  const missing = diffFingerprints(before, {}, []);
  check('a vanished table is a change, not an empty result', missing.ok === false && missing.missing.includes(TABLE));

  // 5. The production rehearsal mechanism (the same function migrate.mjs calls) on real Postgres.
  const scoped = (q, opts = {}) => fingerprintDatabase(q, { tables, ...opts });
  const rehearsalTarget = { query, exec: (sql) => client.query(sql) };

  const additiveRehearsal = await rehearseBatchData({
    target: rehearsalTarget,
    entries: [{ version: '9999', filename: 'zz_add_column.sql' }],
    readFile: () => `alter table ${TABLE} add column note text`,
    fingerprint: scoped,
  });
  const noteColumn = (
    await query(
      `select count(*)::int n from information_schema.columns
        where table_schema='public' and table_name='zz_fingerprint_probe' and column_name='note'`,
    )
  ).rows[0].n;
  check('a rehearsed additive migration is allowed and leaves no column behind', additiveRehearsal.error === null && additiveRehearsal.diff.ok === true && noteColumn === 0, {
    error: additiveRehearsal.error,
    changed: additiveRehearsal.diff?.changed,
    noteColumn,
  });

  const unauthorised = await rehearseBatchData({
    target: rehearsalTarget,
    entries: [{ version: '9998', filename: 'zz_update.sql' }],
    readFile: () => `update ${TABLE} set amount = amount + 5`,
    fingerprint: scoped,
  });
  const rowAfterRehearsal = (await query(`select amount from ${TABLE} where id = 1`)).rows[0];
  check(
    'a rehearsed UPDATE of real data is refused, and the rows are untouched',
    unauthorised.diff?.ok === false && unauthorised.diff.unexpected.includes(TABLE) && String(rowAfterRehearsal.amount) === '10',
    { unexpected: unauthorised.diff?.unexpected, id1: String(rowAfterRehearsal.amount) },
  );

  const approved = await rehearseBatchData({
    target: rehearsalTarget,
    entries: [{ version: '9997', filename: 'zz_update_approved.sql' }],
    readFile: () => `update ${TABLE} set amount = amount + 5`,
    approvedTables: [TABLE],
    fingerprint: scoped,
  });
  check('the same UPDATE is allowed when that table is named as approved', approved.diff?.ok === true && approved.diff.allowedChanges.includes(TABLE), {
    allowed: approved.diff?.allowedChanges,
  });

  // 6. The scratch table is actually gone afterwards.
  await query(`drop table if exists ${TABLE}`);
  const ghost = await fingerprintTable(query, TABLE);
  check('the probe cleans up after itself', ghost.count === null);
} finally {
  await client.end();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
