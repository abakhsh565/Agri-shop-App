#!/usr/bin/env node
/**
 * qa.mjs — the QA database lifecycle, in one place.
 *
 * The point of this file is the ORDER: `clean` runs the cleaner and then counts
 * independently, because the cleaner's own "CLEAN" line has already been wrong
 * once (it reported CLEAN while rows remained). Counts produced here never come
 * from the cleaner's output.
 *
 * Usage:
 *   node scripts/dev/qa.mjs count
 *   node scripts/dev/qa.mjs clean
 *   node scripts/dev/qa.mjs seed baseline|e2e
 */
import { spawnSync } from 'node:child_process';
import { qaRowCount } from './lib.mjs';

const [cmd, scenario] = process.argv.slice(2);

async function count() {
  const rows = await qaRowCount();
  if (!rows.ok) {
    console.log(`QA count FAILED: ${rows.error}`);
    return 1;
  }
  const nonzero = Object.entries(rows.tables).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  console.log(`QA business rows: ${rows.total}`);
  for (const [t, n] of nonzero) console.log(`  ${t.padEnd(28)} ${n}`);
  if (!rows.total) console.log('  (baseline clean: 0 rows in every business table)');
  return rows.total === 0 ? 0 : 1;
}

function run(script, args = []) {
  const r = spawnSync('node', [script, ...args], { stdio: 'inherit', shell: true });
  return r.status ?? 1;
}

if (cmd === 'count') {
  process.exit(await count());
} else if (cmd === 'clean') {
  console.log('─── running the cleaner');
  run('scripts/clean-test-data.mjs');
  console.log('\n─── independent re-count (never the cleaner\'s own output)');
  process.exit(await count());
} else if (cmd === 'seed') {
  const scenarios = {
    baseline: { script: 'scripts/reset-qa-baseline.mjs', why: 'schema fixtures + 4 QA accounts, zero business rows' },
    e2e: { script: 'scripts/e2e-setup-data.mjs', why: 'the rows the E2E suite expects to exist' },
  };
  const chosen = scenarios[scenario];
  if (!chosen) {
    console.log(`unknown scenario "${scenario ?? ''}" — available: ${Object.entries(scenarios).map(([k, v]) => `${k} (${v.why})`).join(', ')}`);
    process.exit(2);
  }
  console.log(`─── seed ${scenario}: ${chosen.why}`);
  const code = run(chosen.script);
  console.log('\n─── independent count after seeding');
  const countCode = await count();
  process.exit(code || countCode);
} else {
  console.error('usage: qa.mjs count | clean | seed baseline|e2e');
  process.exit(2);
}
