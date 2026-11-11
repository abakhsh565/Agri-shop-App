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
 * This check connects with a short timeout per attempt and retries for ~5 min,
 * reports which address family it used, and exits non-zero with an actionable
 * message — so a connectivity regression costs minutes instead of ~46.
 *
 * RETRY RATIONALE (2026-11-11): the QA database goes slow for minutes at a time
 * while otherwise idle (proven 2026-11-10 20:12Z: a table-free `select 1` took
 * >10s on both the direct and the pooler path, then recovered). A single 10s
 * attempt killed the whole QA job in 21s before any suite ran. Retrying keeps
 * the fast-fail purpose for a truly dead DB (~5 min worst case) while a brief
 * slow episode costs a delay instead of the run. DNS/routing errors still fail
 * immediately: those are config errors, no retry can fix them.
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

// TRANSIENT-SLOWNESS RETRY (2026-11-11): the QA database goes slow for
// minutes at a time while otherwise idle (proven 2026-11-10 20:12Z: direct and
// pooler paths both wedged, then recovered). A single 10s attempt killed the
// whole QA job in 21s before any suite ran. Retry for ~5 min so a brief slow
// episode costs a delay, not the run. A truly unreachable DB still fails in
// ~5 min — far below the ~46 min burn this check was built to prevent.
// DNS/routing errors (ENETUNREACH etc.) fail immediately: those are config
// errors, no retry can fix them.
const MAX_ATTEMPTS = 12;
const ATTEMPT_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 15000;
const NON_RETRYABLE = /ENETUNREACH|EAI_AGAIN|EHOSTUNREACH|ENOTFOUND/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryOnce() {
  const client = new pg.Client({
    connectionString: url,
    // The local stack serves plain Postgres on 54322: asking for TLS fails
    // the handshake. The hosted path keeps rejectUnauthorized: false (the
    // pooler presents a chain Node's default trust store does not accept;
    // the compensating control is the exact target pinning elsewhere).
    ssl: process.env.QA_TARGET === 'local' ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: ATTEMPT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    const { rows } = await client.query('select 1 as ok, inet_server_addr()::text as server_addr, current_user as who');
    return rows[0];
  } finally {
    await client.end().catch(() => undefined);
  }
}

const overallStarted = Date.now();
let lastErr = null;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const started = Date.now();
  try {
    const row = await tryOnce();
    console.log(
      `QA database reachable in ${Date.now() - started}ms (attempt ${attempt}/${MAX_ATTEMPTS}, ${Date.now() - overallStarted}ms total) — host=${target.host}:${target.port} ` +
        `server=${row.server_addr} user=${row.who}`
    );
    process.exit(0);
  } catch (err) {
    lastErr = err;
    console.error(`check-qa-connectivity: attempt ${attempt}/${MAX_ATTEMPTS} failed after ${Date.now() - started}ms: ${err.code || ''} ${err.message}`);
    if (NON_RETRYABLE.test(String(err.code))) {
      console.error('  not retrying: DNS/routing error — check the host configuration.');
      break;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
}

console.error(`\nQA database NOT reachable after ${MAX_ATTEMPTS} attempts (${Date.now() - overallStarted}ms): ${lastErr?.code || ''} ${lastErr?.message || 'unknown error'}`);
console.error(`  target: ${target.host}:${target.port} (username after '@' from the connection string)`);
if (/ENETUNREACH|EAI_AGAIN|EHOSTUNREACH/.test(String(lastErr?.code))) {
  console.error(
    '  hint: this is typical of an IPv6-only host. Supabase\'s direct host\n' +
      '        db.<project-ref>.supabase.co has an AAAA record but no A record, and\n' +
      '        GitHub-hosted runners have no IPv6 route. Point QA_DB_HOST at the IPv4\n' +
      '        pooler instead: aws-0-ap-northeast-1.pooler.supabase.com with the\n' +
      '        username form postgres.<project-ref>.'
  );
}
process.exit(1);
