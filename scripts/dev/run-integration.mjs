#!/usr/bin/env node
/**
 * Run the verified, disjoint integration shard with file workers, then run every other file serially.
 * Both phases are selected in one Vitest process/config invocation, so the inherited global setup
 * takes the QA advisory lock once before either phase and releases it after both phases finish.
 *
 * Usage: node scripts/dev/run-integration.mjs [--reporter=dot|verbose]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUP_FILE = path.join(ROOT, 'scripts/dev/integration-parallel-group.json');
const INTEGRATION_DIR = path.join(ROOT, 'tests/integration');
const configPath = path.join(ROOT, 'vitest.integration.config.ts');
const group = JSON.parse(fs.readFileSync(GROUP_FILE, 'utf8')).files;
const onDisk = fs.readdirSync(INTEGRATION_DIR).filter((file) => file.endsWith('.test.ts')).sort();

if (!Array.isArray(group) || group.length !== 7 || new Set(group).size !== group.length) {
  console.error('[integration] refusing: the measured parallel shard must contain exactly seven unique files.');
  process.exit(1);
}
if (group.some((file) => !onDisk.includes(file))) {
  console.error('[integration] refusing: a measured shard file is missing from tests/integration.');
  process.exit(1);
}

const rest = onDisk.filter((file) => !group.includes(file));
if (group.length + rest.length !== onDisk.length || [...group, ...rest].some((file, index, files) => files.indexOf(file) !== index)) {
  console.error('[integration] refusing: the parallel and serial projects do not partition the on-disk suite exactly once.');
  process.exit(1);
}
const vitestBin = path.join(ROOT, 'node_modules/vitest/vitest.mjs');
const listOnly = process.argv[2] === '--list';
const projectArgs = [
  '--project',
  'integration-measured-parallel',
  '--project',
  'integration-serial-remainder',
];
const userArgs = listOnly
  ? ['list', '--filesOnly', '--config', configPath, ...projectArgs]
  : ['run', ...process.argv.slice(2), '--config', configPath, ...projectArgs];
const args = [vitestBin, ...userArgs];

console.log(`[integration] measured shard: ${group.length} files, up to 4 workers`);
console.log(`[integration] serial remainder: ${rest.length} files, one at a time`);
if (!listOnly) console.log('[integration] one Vitest process holds the QA lock across both ordered phases.');

const result = spawnSync(process.execPath, args, {
  cwd: ROOT,
  env: {
    ...process.env,
    VITEST_MAX_WORKERS_PARALLEL: '4',
  },
  stdio: 'inherit',
});
if (result.error) {
  console.error(`[integration] could not start Vitest: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
