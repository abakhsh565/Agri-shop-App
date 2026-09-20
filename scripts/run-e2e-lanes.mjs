#!/usr/bin/env node
/**
 * run-e2e-lanes.mjs — run the browser E2E suite in two lanes.
 *
 * WHY THIS EXISTS
 *   The suite grew to 63 tests / ~17 minutes serially, which is longer than a
 *   local command budget and makes each verification cycle expensive. The
 *   obvious fix — raise the worker count for everything — is NOT safe here, and
 *   the reason is specific rather than general caution:
 *
 *     * dashboardScope.spec.ts reconciles the figures RENDERED on the dashboard
 *       against aggregate queries over the same tenant. Any concurrent spec that
 *       inserts a sale or customer in that tenant changes the aggregate between
 *       the UI read and the DB read, so the assertion fails for a reason that has
 *       nothing to do with the product.
 *     * actionCenter.spec.ts counts signals and badges, which are the same kind of
 *       tenant-wide aggregate.
 *
 *   Those two cannot run next to a writer, so they stay in a serial lane. The
 *   other specs are isolated by construction — crossScreenSync, imageSync and
 *   splitPayment mint their own ids with randomUUID()/Date.now(), rtlLtr only
 *   renders and navigates, and accessUx asserts on the entity it just created
 *   rather than on tenant totals — so they can share a parallel lane.
 *
 *   Lanes run one after the other. Running the two lanes at the same time would
 *   put writers next to the reconcilers again and reintroduce exactly the
 *   interference this split exists to prevent.
 *
 * Usage: node scripts/run-e2e-lanes.mjs
 */
import { spawnSync } from 'node:child_process';

const LANES = [
  {
    name: 'isolated',
    why: 'specs that mint their own rows — safe to run concurrently',
    workers: 4,
    files: [
      'tests/e2e/rtlLtr.spec.ts',
      'tests/e2e/imageSync.spec.ts',
      'tests/e2e/splitPayment.spec.ts',
      'tests/e2e/accessUx.spec.ts',
    ],
  },
  {
    name: 'reconcilers',
    why: 'specs that assert tenant-wide aggregates — must not run beside a writer',
    workers: 1,
    files: [
      'tests/e2e/actionCenter.spec.ts',
      'tests/e2e/dashboardScope.spec.ts',
      'tests/e2e/crossScreenSync.spec.ts',
    ],
  },
];

const started = Date.now();
const results = [];

for (const lane of LANES) {
  console.log(`\n═══ lane: ${lane.name} (workers=${lane.workers}) — ${lane.why}`);
  const laneStart = Date.now();
  const run = spawnSync(
    'npx',
    ['playwright', 'test', ...lane.files, `--workers=${lane.workers}`],
    { stdio: 'inherit', shell: true },
  );
  const seconds = Math.round((Date.now() - laneStart) / 1000);
  results.push({ ...lane, code: run.status ?? 1, seconds });
  console.log(`═══ lane ${lane.name}: exit=${run.status} in ${Math.floor(seconds / 60)}m${seconds % 60}s`);
}

const total = Math.round((Date.now() - started) / 1000);
console.log('\n─── lane summary');
for (const r of results) {
  console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(12)} ${Math.floor(r.seconds / 60)}m${r.seconds % 60}s  (workers=${r.workers})`);
}
console.log(`  total ${Math.floor(total / 60)}m${total % 60}s`);

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
