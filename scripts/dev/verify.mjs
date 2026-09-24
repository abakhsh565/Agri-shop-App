#!/usr/bin/env node
/**
 * verify.mjs — run the smallest verification that is actually sufficient,
 * decided by the changed files rather than by how small the change felt.
 *
 * TIERS (locked decisions — the tier is computed, never chosen downward)
 *   Tier 0  documentation-only changes        → tsc + build
 *   Tier 1  UI / copy / component / settings  → tsc + unit guards + affected E2E lanes + build
 *   Tier 2  money, RBAC, migrations, destructive actions, integration tests,
 *           release workflow                   → tsc + full vitest + canonical E2E lanes
 *                                                 (forced, never skipped) + affected lanes + build
 *                                                 + independent QA row count
 *
 * LANE CACHING (locked decision)
 *   A lane is skipped only when (a) it was GREEN, and (b) every file its
 *   lane-map globs cover is byte-identical to that green run. Skips are printed
 *   as `SKIPPED — unchanged since green`; nothing is ever skipped silently.
 *
 * PERMANENT RULE: speed must never reduce required verification or evidence.
 *   Tier 2 is never downgraded; --tier may only RAISE the tier. A change that
 *   cannot be classified conservatively is treated as Tier 2.
 *
 * Usage:
 *   node scripts/dev/verify.mjs [--plan] [--tier N] [--no-cache] [--all-lanes] [--force]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
  currentHead, EXCLUDED_PATHS, gitLines, hashMap, hashOf, laneSpecPath,
  matchAny, qaRowCount, readLaneMap, readState, seconds, treeHash, updateState,
  workingFiles,
} from './lib.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f) => {
  const i = argv.indexOf(`--${f}`);
  return i === -1 ? null : argv[i + 1];
};

const PLANS_ONLY = has('plan');
const NO_CACHE = has('no-cache');
const ALL_LANES = has('all-lanes');
const FORCE = has('force');

// ── classification ───────────────────────────────────────────
const DOCS = [/\.md$/, /^docs\//];
const TIER2 = [
  /^supabase\/migrations\//,
  /^tests\/integration\//,
  /^\.github\/workflows\//,
  /^src\/lib\/(auth|tenantContext|accessModel|permissionLabels|pinLock|envGuard|db)\.ts$/,
  // The shared confirm surface exists for irreversible actions: changing how a
  // destructive action is confirmed is a critical-path change by definition.
  /^src\/components\/ui\/ConfirmDialog\.tsx$/,
  /(payment|refund|credit|purchase|sale|return|void|stock|inventory|cogs|price|delete|deactivate|remove)/i,
];
const CANONICAL = ['rtlLtr', 'imageSync', 'splitPayment', 'accessUx', 'actionCenter', 'dashboardScope', 'crossScreenSync'];

const laneMap = readLaneMap();
const state = readState();

function globsFor(lane) {
  if (lane in laneMap.lanes) return laneMap.lanes[lane];
  return laneMap.default;
}

function laneFiles(lane) {
  const globs = [...globsFor(lane), laneSpecPath(lane)];
  return workingFiles().filter((f) => matchAny(f, globs));
}

function changedSinceVerified() {
  const v = state.verified || {};
  // Byte-identical tree to the last green run → nothing to re-verify. This is
  // the case a session restart lands in, and it is the single biggest saving.
  if (v.treeHash && v.treeHash === treeHash()) return [];
  const base = v.head;
  let committed = [];
  if (base) {
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', base, 'HEAD']).status === 0;
    if (ancestor) committed = gitLines(['diff', '--name-only', base, 'HEAD']);
  } else {
    committed = gitLines(['diff', '--name-only', 'origin/main...HEAD']);
  }
  const dirty = gitLines(['status', '--porcelain']).map((l) => l.slice(3).trim()).filter(Boolean);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...committed, ...dirty, ...untracked])]
    .filter((f) => f && !EXCLUDED_PATHS.some((re) => re.test(f)));
}

function classify(files) {
  const isTier2 = files.some((f) => TIER2.some((re) => re.test(f)));
  const isDocsOnly = files.length > 0 && files.every((f) => DOCS.some((re) => re.test(f)));
  if (isTier2) {
    const hit = files.find((f) => TIER2.some((re) => re.test(f)));
    return { tier: 2, why: `critical path in ${hit}` };
  }
  if (isDocsOnly) return { tier: 0, why: 'documentation-only change' };
  return { tier: 1, why: 'UI / component / copy change' };
}

function laneAffected(lane, files) {
  const globs = [...globsFor(lane), laneSpecPath(lane)];
  return files.some((f) => matchAny(f, globs));
}

function laneIsGreen(lane) {
  const rec = state.lanes?.[lane];
  if (!rec || rec.status !== 'pass') return false;
  const hash = hashOf(hashMap(laneFiles(lane)));
  return rec.hash === hash;
}

// ── execution ────────────────────────────────────────────────
const results = [];
let failure = null;

function step(name, command, args, { allowFail = false } = {}) {
  const start = Date.now();
  process.stdout.write(`\n─── ${name}\n`);
  const r = spawnSync(command, args, { stdio: 'inherit', shell: true });
  const secs = Math.round((Date.now() - start) / 1000);
  const code = r.status ?? 1;
  results.push({ name, code, seconds: secs });
  if (code !== 0 && !allowFail) {
    failure = failure || `${name} failed (exit ${code})`;
    return false;
  }
  return code === 0;
}

const changed = changedSinceVerified();
const computed = classify(changed);
let tier = computed.tier;
const requested = val('tier') ? Number(val('tier')) : null;
if (requested !== null && requested < tier) {
  console.error(`refusing to lower the required tier: computed Tier ${tier} (${computed.why}), requested Tier ${requested}.\n` +
    'The tier is derived from changed files; --tier may only raise it. This is the rule that keeps speed from weakening verification.');
  process.exit(2);
}
if (requested !== null) tier = Math.max(tier, requested);

const treeAtStart = treeHash();
if (!changed.length && !FORCE && state.verified?.treeHash === treeAtStart) {
  console.log(`═══ verify — nothing changed since the last full verification at ${String(state.verified.head).slice(0, 8)} (${state.verified.at}), tree ${treeAtStart}.`);
  console.log('    Evidence from that run still stands; use --force to re-run anyway.');
  process.exit(0);
}

const allLanes = fs.readdirSync('tests/e2e')
  .filter((f) => f.endsWith('.spec.ts'))
  .map((f) => f.replace(/\.spec\.ts$/, ''));

const toRun = [];
const skipped = [];
for (const lane of allLanes) {
  if (ALL_LANES) { toRun.push({ lane, forced: false }); continue; }
  if (!laneAffected(lane, changed)) continue;
  if (!NO_CACHE && laneIsGreen(lane)) skipped.push({ lane, reason: `unchanged since green (${state.lanes[lane].at})` });
  else toRun.push({ lane, forced: false });
}

// A Tier-2 change must always produce E2E evidence. Lane caching (locked decision) governs
// normally: the lanes that cover the change are the evidence. But if NO lane is affected —
// e.g. a migration no lane's globs name yet — the canonical lanes run uncached rather than
// letting a critical change produce zero browser evidence.
if (tier >= 2 && !toRun.length && !ALL_LANES) {
  for (const lane of CANONICAL) {
    if (allLanes.includes(lane)) toRun.push({ lane, forced: true });
  }
}

const plan = {
  tier,
  why: computed.why,
  changed: changed.length,
  files: changed.slice(0, 12),
  vitest: tier >= 2 ? 'full (unit + integration)' : tier === 1 ? 'unit guards' : 'none',
  lanes: toRun.map((r) => `${r.lane}${r.forced ? ' (tier-2 coverage)' : ''}`),
  skipped,
  build: true,
  qaCount: tier >= 2,
};

console.log('═══ verify — plan');
console.log(`tier     : ${tier}  (${computed.why})`);
console.log(`changed  : ${changed.length} file(s)${changed.length ? ': ' + plan.files.join(', ') + (changed.length > 12 ? `, +${changed.length - 12} more` : '') : ''}`);
console.log(`vitest   : ${plan.vitest}`);
console.log(`lanes    : ${plan.lanes.length ? plan.lanes.join(', ') : '(none affected)'}`);
for (const s of skipped) console.log(`SKIPPED  : ${s.lane} — ${s.reason}`);
console.log(`build    : yes · qa count: ${plan.qaCount ? 'yes (independent)' : 'no'}`);

if (PLANS_ONLY) process.exit(0);

// The tree hash is captured BEFORE the run: the gate proves the state we are
// about to verify, not whatever the tests left behind.
const laneHashes = {};
for (const { lane } of toRun) laneHashes[lane] = hashOf(hashMap(laneFiles(lane)));

const started = Date.now();

if (!step('tsc --noEmit', 'npx', ['tsc', '--noEmit'])) { /* fail-fast */ }
if (!failure && tier >= 2 && !step('vitest (full)', 'npx', ['vitest', 'run'])) { /* fail-fast */ }
if (!failure && tier === 1 && !step('vitest (unit guards)', 'npx', ['vitest', 'run', 'tests/unit/'])) { /* fail-fast */ }

if (!failure && toRun.length) {
  const canonicalToRun = toRun.filter((r) => r.forced).map((r) => r.lane);
  const singles = toRun.filter((r) => !r.forced).map((r) => r.lane);
  if (canonicalToRun.length) {
    const runnerPassed = step(`E2E lanes (own lane runner: ${canonicalToRun.join(', ')})`, 'node', ['scripts/run-e2e-lanes.mjs']);
    const lanes = { ...(readState().lanes || {}) };
    for (const lane of canonicalToRun) {
      lanes[lane] = runnerPassed
        ? { status: 'pass', hash: laneHashes[lane], at: new Date().toISOString(), head: currentHead() }
        : { status: 'fail', hash: null, at: new Date().toISOString(), head: currentHead() };
    }
    updateState({ lanes });
  }
  if (!failure && singles.length) {
    for (const lane of singles) {
      if (failure) break;
      const passed = step(`E2E ${lane}`, 'npx', ['playwright', 'test', laneSpecPath(lane), '--workers=1']);
      // Record each lane the moment it finishes: a run killed by a restart keeps the
      // evidence it already earned, and the next run skips exactly the lanes that are
      // byte-identical AND green — never a lane that failed or never ran.
      const lanes = { ...(readState().lanes || {}) };
      lanes[lane] = passed
        ? { status: 'pass', hash: laneHashes[lane], at: new Date().toISOString(), head: currentHead() }
        : { status: 'fail', hash: null, at: new Date().toISOString(), head: currentHead() };
      updateState({
        lanes,
        lastVerify: { at: new Date().toISOString(), tier, result: 'running', seconds: Math.round((Date.now() - started) / 1000), ran: results.map((r) => r.name), skipped: skipped.map((s) => s.lane), reason: null },
      });
    }
  }
}

if (!failure && !step('build', 'npm', ['run', 'build'])) { /* fail-fast */ }

if (!failure && tier >= 2) {
  const count = await qaRowCount();
  process.stdout.write(`\n─── QA independent row count\n`);
  if (!count.ok) {
    failure = `QA row count failed: ${count.error}`;
    console.log(`FAIL: ${count.error}`);
  } else if (count.total > 0) {
    failure = `QA database is not clean: ${count.total} business row(s)`;
    const top = Object.entries(count.tables).filter(([, n]) => n).sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(`FAIL: ${count.total} row(s) remain — ${top.map(([t, n]) => `${t}=${n}`).join(', ')}`);
    console.log('      cleanup is a deliberate step: npm run qa:clean (and re-count after it).');
  } else {
    console.log('PASS: 0 business rows (counted independently of the cleaner).');
  }
}

const elapsed = Math.round((Date.now() - started) / 1000);
const result = failure ? 'fail' : 'pass';

// Lane records were written as each lane finished (see above). A failed run leaves the
// lanes that never ran exactly as they were — it never mints a green for untested code.
const metrics = [...(state.metrics || []), {
  at: new Date().toISOString(), tier, seconds: elapsed, result,
  runs: toRun.length, skips: skipped.length, changed: changed.length,
}].slice(-20);

updateState({
  metrics,
  lastVerify: {
    at: new Date().toISOString(), tier, result, seconds: elapsed,
    ran: toRun.map((r) => r.lane), skipped: skipped.map((s) => s.lane),
    reason: failure,
  },
  ...(result === 'pass' ? { verified: { head: currentHead(), at: new Date().toISOString(), treeHash: treeAtStart } } : {}),
});

console.log('\n═══ verify — summary');
for (const r of results) console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name}  ${seconds(r.seconds)}`);
for (const s of skipped) console.log(`  SKIP  ${s.lane} — ${s.reason}`);
console.log(`\nTIER ${tier} · ${result.toUpperCase()} · ${seconds(elapsed)}${failure ? ` · ${failure}` : ''}`);
process.exit(failure ? 1 : 0);
