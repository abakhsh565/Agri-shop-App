#!/usr/bin/env node
/**
 * CI preflight: prove the QA database is reachable BEFORE the test suite runs.
 *
 * WHY THIS EXISTS
 * ---------------
 * A database host that cannot be reached does not fail the suite quickly — every
 * integration `beforeAll` hook sits on its 120s timeout, so the job burns ~46
 * minutes and then fails, which also means the APK job never starts. On
 * 2026-09-16 that produced ENETUNREACH for an IPv6-only host
 * (db.<ref>.supabase.co resolves to 2406:da14:...:5432 and GitHub-hosted runners
 * have no IPv6 route), and the run cost ~47 minutes to reach "12 failed" with an
 * artifact upload that could not even complete.
 *
 * This check connects once, with a short timeout, reports which address family it
 * used, and exits non-zero with an actionable message — so a connectivity
 * regression costs seconds instead of minutes.
 *
 * Read-only: it issues `select 1`.
 */
import fs from 'fs';
import pg from 'pg';

// Fill in only what is not already provided (CI supplies everything through the
// environment; a local run falls back to .env.qa).
if (fs.existsSync('.env.qa')) {
  for (const line of fs.readFileSync('.env.qa', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i <= 0 || line.trim().startsWith('#')) continue;
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
  }
}

const user = (process.env.QA_DB_USER || '').replace(/^\[|\]$/g, '');
const pass = (process.env.QA_DB_PASS || '').replace(/^\[|\]$/g, '');
const host = (process.env.QA_DB_HOST || '').replace(/^\[|\]$/g, '');
const url =
  (process.env.QA_DATABASE_URL || '').replace(/^\[|\]$/g, '') ||
  (host && user && pass ? `postgresql://${user}:${pass}@${host}:5432/postgres` : '');

if (!url) {
  console.error('check-qa-connectivity: no QA database configuration found (QA_DATABASE_URL or QA_DB_HOST/QA_DB_USER/QA_DB_PASS).');
  process.exit(1);
}

// The pooler host form is postgres.<project-ref>; the direct host form is db.<ref>.
// The direct host is IPv6-only today, and GitHub-hosted runners cannot route IPv6.
const target = (() => {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || '5432', poolerUser: u.username.includes('.') };
  } catch {
    return { host: '(unparseable)', port: '5432', poolerUser: false };
  }
})();

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});

try {
  const started = Date.now();
  await client.connect();
  const { rows } = await client.query('select 1 as ok, inet_server_addr()::text as server_addr, current_user as who');
  console.log(
    `QA database reachable in ${Date.now() - started}ms — host=${target.host}:${target.port} ` +
      `server=${rows[0].server_addr} user=${rows[0].who}`
  );
} catch (err) {
  console.error(`\nQA database NOT reachable: ${err.code || ''} ${err.message}`);
  console.error(`  target: ${target.host}:${target.port} (username after '@' from the connection string)`);
  if (/ENETUNREACH|EAI_AGAIN|EHOSTUNREACH/.test(String(err.code))) {
    console.error(
      '  hint: this is typical of an IPv6-only host. Supabase\'s direct host\n' +
        '        db.<project-ref>.supabase.co has an AAAA record but no A record, and\n' +
        '        GitHub-hosted runners have no IPv6 route. Point QA_DB_HOST at the IPv4\n' +
        '        pooler instead: aws-0-ap-northeast-1.pooler.supabase.com with the\n' +
        '        username form postgres.<project-ref>.'
    );
  }
  process.exit(1);
} finally {
  await client.end().catch(() => undefined);
}
