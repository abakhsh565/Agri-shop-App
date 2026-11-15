#!/usr/bin/env node
/**
 * release-prepare.mjs — one command that turns a finished dev batch into a checked release.
 *
 * WHY THIS EXISTS
 *   The 0312/0314/0315 and 0278–0308 production batches were both assembled by hand: copy the backup
 *   manifest, copy the restore report, re-run the forward replay, remember the exact dispatch
 *   arguments. That is not a process, it is a ritual, and a ritual fails silently — the first
 *   attempt at 0312 went stale inside the gate's 60-minute window while the work sat idle.
 *
 *   This tool is the process. It refuses to run anywhere but `dev`, builds the batch directory from
 *   the batch's own file list, measures the forward replay against the recorded production baseline,
 *   copies the backup and restore evidence out of a downloaded artifact, and prints the two dispatch
 *   commands. A release therefore cannot be prepared from staging or production, and cannot be
 *   prepared from an uncommitted tree.
 *
 * USAGE
 *   pnpm/npm run release:prepare -- --batch gap-0278-0308 --files 0278_….sql,0280_….sql
 *   npm run release:prepare -- --batch gap-0278-0308            # reads files.txt from the batch dir
 *   npm run release:prepare -- --batch gap-0278-0308 --artifact .tmp/prod-artifacts/backup-fresh
 *
 *   --artifact points at a downloaded backup workflow artifact directory (or its parent); the newest
 *   `*manifest*.json` and `restore-verification*.json` are copied into the batch directory, so the
 *   three gate files always land together and are committed together.
 *
 * WHAT IT DOES NOT DO
 *   It does not dispatch, deploy or promote. Promotion is still a pull request per the chain:
 *   dev → PR → staging → PR → main → gated dispatch. It does not touch any database.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT } from '../lib/environments.mjs';

export const RELEASE_BRANCH = 'dev';
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const BATCHES = path.join(ROOT, 'production-batches');

/** The chain starts on dev. Anything else is a violation, not a shortcut. */
export function assertReleaseBranch(branch) {
  if (branch !== RELEASE_BRANCH) {
    throw new Error(
      `release:prepare must run on \`${RELEASE_BRANCH}\` (this checkout is on \`${branch}\`). ` +
        'Changes are made on dev and promoted by pull request; nothing is prepared from staging or main.',
    );
  }
}

/** `a.sql, b.sql` or repeated values → existing migration files, in version order. */
export function resolveBatchFiles(names, migrationsDir = MIGRATIONS) {
  const wanted = names.map((name) => name.trim()).filter(Boolean);
  if (!wanted.length) throw new Error('the batch names no files.');
  return wanted
    .map((name) => {
      const file = path.basename(name);
      if (!fs.existsSync(path.join(migrationsDir, file))) {
        throw new Error(`--files: ${file} does not exist in supabase/migrations.`);
      }
      if (!/^\d{4}_/.test(file)) throw new Error(`--files: ${file} does not start with a 4-digit version.`);
      return file;
    })
    .sort((a, b) => a.localeCompare(b));
}

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : true;
};

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

function main() {
  const batch = flag('batch');
  if (!batch || batch === true) {
    console.error('[RELEASE REFUSED] name the batch: --batch <name> (a directory under production-batches/).');
    process.exit(2);
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  try {
    assertReleaseBranch(branch);
  } catch (error) {
    console.error(`[RELEASE REFUSED] ${error.message}`);
    process.exit(2);
  }

  const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (dirty.length) {
    console.error('[RELEASE REFUSED] the tree has uncommitted tracked changes; commit them on dev first:');
    for (const line of dirty.slice(0, 10)) console.error(`  ${line}`);
    process.exit(2);
  }

  const batchDir = path.join(BATCHES, String(batch));
  const filesArg = flag('files');
  let fileNames;
  if (filesArg && filesArg !== true) {
    fileNames = String(filesArg).split(',');
  } else {
    const listPath = path.join(batchDir, 'files.txt');
    if (!fs.existsSync(listPath)) {
      console.error(`[RELEASE REFUSED] no --files and no ${path.relative(ROOT, listPath)}.`);
      console.error('  Write the batch file list there (one filename per line) or pass --files.');
      process.exit(2);
    }
    fileNames = fs
      .readFileSync(listPath, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim())
      .filter(Boolean);
  }

  let files;
  try {
    files = resolveBatchFiles(fileNames);
  } catch (error) {
    console.error(`[RELEASE REFUSED] ${error.message}`);
    process.exit(2);
  }

  fs.mkdirSync(batchDir, { recursive: true });
  fs.writeFileSync(
    path.join(batchDir, 'files.txt'),
    `${files.map((file) => file).join('\n')}\n`,
  );

  const artifact = flag('artifact');
  if (artifact && artifact !== true) {
    const root = path.resolve(ROOT, String(artifact));
    const found = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else found.push(full);
      }
    };
    if (!fs.existsSync(root)) {
      console.error(`[RELEASE REFUSED] --artifact ${artifact} does not exist.`);
      process.exit(2);
    }
    walk(root);
    const newest = (pattern) =>
      found
        .filter((file) => pattern.test(path.basename(file)))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    const manifest = newest(/manifest.*\.json$|\.manifest\.json$/i);
    const restore = newest(/restore-verification.*\.json$/i);
    if (!manifest || !restore) {
      console.error('[RELEASE REFUSED] the artifact directory has no backup manifest or restore report.');
      process.exit(2);
    }
    fs.copyFileSync(manifest, path.join(batchDir, 'backup.manifest.json'));
    fs.copyFileSync(restore, path.join(batchDir, 'restore-verification.json'));
    console.log(`  evidence: ${path.relative(ROOT, manifest)} → backup.manifest.json`);
    console.log(`            ${path.relative(ROOT, restore)} → restore-verification.json`);
  }

  const metadataCandidates = [
    'backups/production-baseline-local.json',
    'supabase/baseline/production-baseline.json',
  ];
  const metadata = metadataCandidates.find((file) => fs.existsSync(path.join(ROOT, file)));
  if (!metadata) {
    console.error('[RELEASE REFUSED] no production baseline record to replay against.');
    console.error('  Capture one read-only (capture-production-baseline workflow) before preparing a batch.');
    process.exit(2);
  }

  const verificationPath = path.join(batchDir, 'verification.json');
  const args = [
    'scripts/verify-forward-on-baseline.mjs',
    '--metadata',
    metadata,
    '--files',
    files.map((file) => `supabase/migrations/${file}`).join(','),
    '--json',
    path.relative(ROOT, verificationPath),
  ];
  console.log(`\nForward replay — ${files.length} file(s) against ${metadata}\n`);
  const replay = run(process.execPath, args);
  process.stdout.write(replay.out);

  const report = fs.existsSync(verificationPath)
    ? JSON.parse(fs.readFileSync(verificationPath, 'utf8'))
    : null;
  if (!report || report.status !== 'PASS') {
    console.error('\n[RELEASE REFUSED] the replay did not PASS, so there is no batch to promote.');
    console.error('  A batch that fails on the production baseline is a gap to fix on dev, not a gate to argue with.');
    process.exit(1);
  }

  const missingEvidence = ['backup.manifest.json', 'restore-verification.json'].filter(
    (file) => !fs.existsSync(path.join(batchDir, file)),
  );
  const batchFiles = `production-batches/${batch}`;
  console.log(`\nBatch ${batch} prepared: ${files.length} file(s), ${report.summary.statements} statement(s), PASS.`);
  if (missingEvidence.length) {
    console.log(`  still missing: ${missingEvidence.join(', ')} — run the backup workflow and pass --artifact.`);
  }

  console.log('\nCommit the batch directory on dev, then promote by pull request:\n');
  console.log(`  git add ${batchFiles} && git commit -m "Batch ${batch}: verified against the production baseline"`);
  console.log('  #   dev → PR → staging → PR → main\n');
  console.log('Then dispatch the gated apply from main (dry run first, then apply):\n');
  // A batch that fills a column with random()/now() cannot have that value reproduced twice. The
  // columns are declared beside the batch, so the dispatch carries the exclusion instead of the
  // operator remembering it after an alarm.
  const volatilePath = path.join(batchDir, 'volatile.txt');
  const volatileColumns = fs.existsSync(volatilePath)
    ? fs
        .readFileSync(volatilePath, 'utf8')
        .split(/[\n,]/)
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter(Boolean)
        .join(',')
    : '';
  if (volatileColumns) console.log(`  volatile columns (outside the data digest): ${volatileColumns}`);

  const dispatch =
    `gh workflow run apply-production-migrations.yml -f files="${files.join(',')}" ` +
    `-f verification="${batchFiles}/verification.json" ` +
    `-f backup="${batchFiles}/backup.manifest.json" ` +
    `-f restored="${batchFiles}/restore-verification.json"` +
    (volatileColumns ? ` -f volatile_columns="${volatileColumns}"` : '') +
    ' -f apply=false';
  console.log(`  ${dispatch}`);
  console.log(`  ${dispatch.replace('-f apply=false', '-f apply=true')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
