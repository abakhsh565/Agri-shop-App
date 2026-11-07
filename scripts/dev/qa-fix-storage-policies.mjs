#!/usr/bin/env node
/**
 * qa-fix-storage-policies — one-time QA environment repair for imageSync:323.
 *
 * WHY. The E2E test imageSync:323 expects pg_policies on storage.objects to
 * include INSERT, SELECT, UPDATE, DELETE (checked by cmd, not by name).
 * Live QA has per-bucket INSERT + SELECT policies only (3 each, from the
 * PR #10 per-bucket matrix): "images auth write", "images public read",
 * plus the business-documents and finance-receipts pairs. There is NO
 * UPDATE and NO DELETE policy on storage.objects at all. The 0022
 * public_all_storage_* policies do not exist on live QA either — they were
 * superseded by the per-bucket matrix — so a repair that recreates them by
 * name would be inconsistent with the live regime. This script restores
 * exactly the two missing operations, following the existing per-bucket
 * pattern for the four image buckets.
 *
 * SAFETY. QA ONLY — it refuses any connection string naming the production
 * project, and requires the QA project ref. Dry run by default; `--apply`
 * writes. One transaction, rolled back on any error. After the writes it
 * asserts, inside the same transaction, that storage.objects now holds all
 * four cmds (INSERT, SELECT, UPDATE, DELETE) — if the check fails, nothing
 * is written. It does NOT touch production: check production's pg_policies
 * separately (fresh baseline capture) — if they are missing there too, that
 * is a product decision (restore vs. deliberately drop + rewrite the test),
 * not this script.
 *
 * Usage: node scripts/dev/qa-fix-storage-policies.mjs [--apply]
 */

import pg from 'pg';

import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';

const BUCKETS = "('product-images', 'employee-photos', 'company-logos', 'customer-images')";

const MISSING = [
  {
    name: 'images auth update',
    sql: `CREATE POLICY "images auth update" ON storage.objects FOR UPDATE USING (bucket_id IN ${BUCKETS})`,
  },
  {
    name: 'images auth delete',
    sql: `CREATE POLICY "images auth delete" ON storage.objects FOR DELETE USING (bucket_id IN ${BUCKETS})`,
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
    `SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY cmd, policyname`,
  );
  console.log('before:', before.rows.map((r) => `${r.cmd}:${r.policyname}`).join(', ') || '(none)');
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
    `SELECT DISTINCT cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'`,
  );
  const cmds = after.rows.map((r) => r.cmd);
  console.log('after cmds:', cmds.join(', '));
  const want = ['INSERT', 'SELECT', 'UPDATE', 'DELETE'];
  const missing = want.filter((c) => !cmds.includes(c));
  if (missing.length > 0) {
    throw new Error(`verification failed, still missing cmds: ${missing.join(', ')}`);
  }
  console.log('verification: all four cmds (INSERT, SELECT, UPDATE, DELETE) present');
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
