#!/usr/bin/env node
/**
 * preflight.mjs — the five-second environment gate.
 *
 * WHY THIS EXISTS
 *   The expensive failures in this repo were never type errors; they were
 *   environment mistakes that surface minutes later as a failed lane:
 *     * a dev server started without `--mode qa` is silently reused by
 *       Playwright and reads the wrong project;
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
import { currentBranch, currentHead, dirtyFiles, qaFixtureCount, qaRowCount, QA_FIXTURE_PHONES, QA_PORT, serverProbe } from './lib.mjs';

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

const server = await serverProbe(QA_PORT);
if (!server.up) {
  const msg = `dev server DOWN on ${QA_PORT} — start it with: npx vite --mode qa --host 0.0.0.0 --port ${QA_PORT}`;
  if (strict) fails.push(msg); else warns.push(msg);
} else if (server.mode === 'qa') {
  ok.push(`dev server: UP on ${QA_PORT} · --mode qa ✓`);
} else if (server.mode === 'unknown') {
  warns.push(`dev server: UP on ${QA_PORT} but its command line could not be read — confirm it was started with --mode qa`);
} else {
  fails.push(`dev server on ${QA_PORT} is running WITHOUT --mode qa (${server.mode}) — it reads the wrong project and Playwright reuses it silently. Restart with: npx vite --mode qa --host 0.0.0.0 --port ${QA_PORT}`);
}

const fixtures = await qaFixtureCount();
if (!fixtures.ok) fails.push(`QA database unreachable: ${fixtures.error}`);
else if (fixtures.count !== QA_FIXTURE_PHONES.length) {
  warns.push(`QA fixture accounts: ${fixtures.count}/${QA_FIXTURE_PHONES.length} present — restore with: node scripts/reset-qa-baseline.mjs`);
} else ok.push(`QA fixture accounts: ${fixtures.count}/${QA_FIXTURE_PHONES.length} ✓`);

if (fixtures.ok) {
  const rows = await qaRowCount();
  if (!rows.ok) fails.push(`QA row count failed: ${rows.error}`);
  else if (rows.total > 0) {
    warns.push(`QA database holds ${rows.total} business row(s) — a tier-2 gate will fail its independent count. Clean with: npm run qa:clean`);
  } else ok.push('QA business rows: 0 ✓');
}

for (const o of ok) console.log(`  OK    ${o}`);
for (const w of warns) console.log(`  WARN  ${w}`);
for (const f of fails) console.log(`  FAIL  ${f}`);

if (fails.length) {
  console.log(`\nPREFLIGHT FAILED (${fails.length} hard problem${fails.length === 1 ? '' : 's'}) — fix before running lanes.`);
  process.exit(1);
}
console.log(`\nPREFLIGHT OK${warns.length ? ` with ${warns.length} warning(s)` : ''}.`);
