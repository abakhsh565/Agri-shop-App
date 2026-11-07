#!/usr/bin/env node
/**
 * qa-fix-storage-policies — one-time QA environment repair for imageSync:323.
 *
 * WHY. The E2E test imageSync:323 expects pg_policies on storage.objects to
 * include INSERT, SELECT, UPDATE, DELETE. Live QA has only INSERT and SELECT.
 * The migration chain defines all four: 0022 creates public_all_storage_insert/
 * select/update/delete, and 0199's rebuild loop recreates all four if missing.
 * No migration drops public_all_storage_update/delete (0022 dropped only the
 * 0013 named policies; 0250/0261 drop only their own per-bucket policies). So
 * the two policies are missing from the QA project through drift outside the
 * migration chain (manual change or a restore that lost them). The app never
 * calls storage UPDATE/DELETE, but the migration chain's intent is all-CRUD
 * and the test's documented posture includes delete — the test is correct and
 * the DB drifted. This script restores exactly the two missing policies using
 * the verbatim CREATE POLICY statements from migration 0022.
 *
 * SAFETY. QA ONLY — it refuses any connection string naming the production
 * project, and requires the QA project ref. Dry run by default; `--apply`
 * writes. One transaction, rolled back on any error. After the writes it
 * asserts, inside the same transaction, that storage.objects now holds all
 * four public_all_storage_* policies — if the check fails, nothing is written.
 * It does NOT touch production: check production's pg_policies separately
 * (fresh baseline capture) — if they are missing there too, that is a product
 * decision (restore vs. deliberately drop + rewrite the test), not this script.
 *
 * Usage: node scripts/dev/qa-fix-storage-policies.mjs [--apply]
 */

import pg from 'pg';

import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';

const BUCKETS = "('product-images', 'employee-photos', 'company-logos', 'customer-images')";

const MISSING = [
  {
    name: 'public_all_storage_update',
    sql: `CREATE POLICY "public_all_storage_update" ON storage.objects FOR UPDATE USING (bucket_id IN ${BUCKETS})`,
  },
  {
    name: 'public_all_storage_delete',
    sql: `CREATE POLICY "public_all_storage_delete" ON storage.objects FOR DELETE USING (bucket_id IN ${BUCKETS})`,
  },
];

const apply = process.argv.includes('--apply');

const url = qaDatabaseUrl();
if (!url) {
  console.error('qa-fix-storage-policies: no QA database URL (QA_DB_* secrets missing)');
  process.exit(2);
}
if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error('qa-fix-storage-policies: REFUSED — connection string names the production project');
  process.exit(2);
}
if (!url.includes(QA_PROJECT_REF)) {
  console.error('qa-fix-storage-policies: REFUSED — connection string does not name the QA project');
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  const before = await client.query(
    `SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'public_all_storage_%' ORDER BY 1`,
  );
  console.log('before:', before.rows.map((r) => r.policyname).join(', ') || '(none)');
  for (const p of MISSING) {
    const exists = before.rows.some((r) => r.policyname === p.name);
    if (exists) {
      console.log(`skip: ${p.name} already present`);
      continue;
    }
    console.log(`${apply ? 'creating' : 'would create'}: ${p.name}`);
    if (apply) await client.query(p.sql);
  }
  const after = await client.query(
    `SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'public_all_storage_%' ORDER BY 1`,
  );
  console.log('after:', after.rows.map((r) => r.policyname).join(', '));
  const names = new Set(after.rows.map((r) => r.policyname));
  const want = ['public_all_storage_insert', 'public_all_storage_select', 'public_all_storage_update', 'public_all_storage_delete'];
  const missing = want.filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new Error(`verification failed, still missing: ${missing.join(', ')}`);
  }
  console.log('verification: all four public_all_storage_* policies present');
  if (apply) {
    await client.query('COMMIT');
    console.log('COMMITTED');
  } else {
    await client.query('ROLLBACK');
    console.log('dry run — rolled back, nothing written. Re-run with --apply to write.');
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('qa-fix-storage-policies: FAILED —', err.message);
  process.exit(1);
} finally {
  await client.end();
}
