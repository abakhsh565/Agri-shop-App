#!/usr/bin/env node
/**
 * preflight.mjs — the five-second environment gate.
 *
 * WHY THIS EXISTS
 *   The expensive failures in this repo were never type errors; they were
 *   environment mistakes that surface minutes later as a failed lane:
 *     * the server on the QA port is not this app in QA mode (a foreign app, a
 *       default-mode dev server, or the right app pointed at the wrong
 *       project) and Playwright would have reused it; the identity rule is
 *       shared with the E2E guard — scripts/lib/dev-server-identity.mjs;
 *     * the QA database unreachable turns every integration `beforeAll` into a
 *       120s timeout (measured cost: ~46 minutes before the run even reports);
 *     * missing fixture accounts make lanes misreport rather than fail;
 *     * a dirty QA database makes the tier-2 row count fail after a long run.
 *   One command checks all of it before any of that is paid for.
 *
 * Usage: node scripts/dev/preflight.mjs [--strict]
 *   --strict also fails when the dev server is down (lanes need it).
 */
import fs from 'node:fs';
import { currentBranch, currentHead, dirtyFiles, qaFixtureCount, QA_FIXTURE_PHONES, QA_PORT, serverProbe } from './lib.mjs';
import { checkBaseline } from './qa-baseline.mjs';

const strict = process.argv.includes('--strict');
const fails = [];
const warns = [];
const ok = [];

console.log('═══ preflight');

const branch = currentBranch();
const head = currentHead();
ok.push(`git: ${branch} @ ${String(head).slice(0, 8)}`);
const dirty = dirtyFiles();
if (dirty.length) warns.push(`${dirty.length} uncommitted file(s) — verification will scope to them`);

if (!fs.existsSync('.env.qa')) {
  warns.push('.env.qa not found — QA credentials must come from the environment (CI) or a local .env.qa');
}

// Identity, not occupancy: the server is asked to serve one module of THIS repository and the
// environment it actually loaded is checked (mode, project from environments.json, environment
// marker). Anything that cannot be verified fails closed, because `reuseExistingServer: true` in
// the Playwright configs would otherwise drive it.
const server = await serverProbe(QA_PORT);
const startCommand = `npx vite --mode qa --host 0.0.0.0 --port ${QA_PORT}`;
if (!server.up) {
  const msg = `dev server DOWN on ${QA_PORT} — start it with: ${startCommand}`;
  if (strict) fails.push(msg); else warns.push(msg);
} else if (server.problem) {
  fails.push(`server on ${server.origin} is not this app's QA server: ${server.problem}. Start this repository's QA server with: ${startCommand}`);
} else {
  ok.push(
    `dev server: UP on ${QA_PORT} · --mode qa ✓ · project ${server.identity.projectId} ✓ · env ${server.identity.appEnv} ✓`,
  );
}

const fixtures = await qaFixtureCount();
if (!fixtures.ok) fails.push(`QA database unreachable: ${fixtures.error}`);
else if (fixtures.count !== QA_FIXTURE_PHONES.length) {
  warns.push(`QA fixture accounts: ${fixtures.count}/${QA_FIXTURE_PHONES.length} present — restore with: node scripts/reset-qa-baseline.mjs`);
} else ok.push(`QA fixture accounts: ${fixtures.count}/${QA_FIXTURE_PHONES.length} ✓`);

if (fixtures.ok) {
  // The baseline is a DECLARATION (scripts/dev/qa-baseline.json), not a zero-row count: rows are
  // attributed by ownership and expected fixtures, and drift is caught in both directions — including
  // rows that DISAPPEARED, which the old count read as the database getting cleaner.
  const baseline = await checkBaseline();
  if (baseline.unreachable) {
    warns.push(`QA baseline not checked: ${baseline.failures[0]}`);
  } else if (!baseline.ok) {
    const total = Object.values(baseline.observed.tables).reduce((a, b) => a + b, 0);
    warns.push(`QA baseline differs from the reviewed declaration (${total} rows, ${baseline.failures.length} finding(s)):\n           ${baseline.failures.slice(0, 3).join('\n           ')}${baseline.failures.length > 3 ? `\n           +${baseline.failures.length - 3} more — run: node scripts/dev/qa-baseline.mjs` : ''}`);
  } else {
    const total = Object.values(baseline.observed.tables).reduce((a, b) => a + b, 0);
    ok.push(`QA baseline: as declared (${total} row(s), every row attributed, fixtures present, isolated tenant empty)`);
  }
}

for (const o of ok) console.log(`  OK    ${o}`);
for (const w of warns) console.log(`  WARN  ${w}`);
for (const f of fails) console.log(`  FAIL  ${f}`);

if (fails.length) {
  console.log(`\nPREFLIGHT FAILED (${fails.length} hard problem${fails.length === 1 ? '' : 's'}) — fix before running lanes.`);
  process.exit(1);
}
console.log(`\nPREFLIGHT OK${warns.length ? ` with ${warns.length} warning(s)` : ''}.`);
