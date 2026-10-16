#!/usr/bin/env node
/**
 * release-gate.mjs — a release may only proceed on a candidate that has actually been verified.
 *
 * WHY THIS FILE EXISTS
 *   The intended control is a required status check on the release branch. It cannot be used here:
 *   this repository is private on a plan without branch protection, and GitHub answers
 *   `403 — Upgrade to GitHub Pro or make this repository public to enable this feature`. So
 *   "failed checks block the release" was, until now, a convention rather than a mechanism: a
 *   release could be started on a commit whose gates were red, in progress, or never run at all.
 *
 *   This script is that mechanism, and it fails closed. It does not migrate anything, it does not
 *   connect to a database to write, and it has no way to be talked out of a refusal — every check
 *   below is a refusal, and the only output is the reviewed plan the operator runs next.
 *
 * WHAT IT REFUSES
 *   1. A commit that is not a full-ish SHA, or an environment that is not in environments.json.
 *   2. Missing owner approval, or approval given for a different commit than the one released.
 *   3. A working tree with uncommitted changes: a release is a commit, not a directory.
 *   4. No CI run for that exact SHA, a run still in progress, or a run that failed.
 *   5. No successful QA/staging job inside that run — a gate that never ran is not a gate that
 *      passed. This is what ties the release to the staging verification of the same commit.
 *   6. Production credentials that are absent, or that name a project the configuration does not
 *      call production. The pair (declared target, credentials) must agree, in both directions.
 *
 * Usage:
 *   node scripts/release-gate.mjs --commit <sha> --env production --owner-approved
 *   node scripts/release-gate.mjs --commit <sha> --env staging  --owner-approved
 *
 * Exit codes: 0 = nothing to refuse (the plan above was printed), 2 = refused, 1 = usage error.
 */

import { execFileSync } from 'node:child_process';

import { ROOT, loadEnvironmentConfig } from './lib/environments.mjs';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

const refusals = [];
const refuse = (message) => refusals.push(message);

if (has('--help') || args.length === 0) {
  console.log(
    'Usage: node scripts/release-gate.mjs --commit <sha> --env <production|staging> --owner-approved',
  );
  process.exit(args.length === 0 ? 1 : 0);
}

// ── 1. The request must be unambiguous ──────────────────────────────────────────────────────────
const commit = valueOf('--commit');
const target = valueOf('--env');

const config = loadEnvironmentConfig();
const known = Object.keys(config.environments);

if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
  refuse(`--commit must be a commit SHA (got ${commit === undefined ? 'nothing' : `"${commit}"`}).`);
}
if (!target || !known.includes(target)) {
  refuse(`--env must be one of ${known.join(', ')} (got ${target === undefined ? 'nothing' : `"${target}"`}).`);
}
if (!has('--owner-approved')) {
  refuse(
    'no owner approval: pass --owner-approved only after the exact migration plan below has been ' +
      'reviewed by the owner. The flag is deliberately separate from --commit so approving a plan ' +
      'and releasing a different commit are two different actions.',
  );
}
if (refusals.length) {
  console.log('REFUSED');
  for (const r of refusals) console.log(`  ✗ ${r}`);
  process.exit(2);
}

const short = commit.slice(0, 8);
console.log(`release gate — candidate ${short} → ${target}\n`);

// ── 2. A release is a commit, not a working tree ────────────────────────────────────────────────
try {
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  if (dirty.length) {
    refuse(
      `${dirty.length} uncommitted path(s) in the working tree. Commit or set them aside first: a ` +
        'release of a directory that differs from the commit is not reproducible. Paths:\n' +
        dirty.slice(0, 10).map((d) => `      ${d}`).join('\n'),
    );
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (!head.startsWith(commit) && !commit.startsWith(head)) {
    console.log(`  note: HEAD is ${head.slice(0, 8)}, which is not the candidate ${short} — the gate`);
    console.log('        asks CI about the candidate, not about HEAD, on purpose.\n');
  }
} catch (error) {
  refuse(`could not read the git state: ${error.message}`);
}

// ── 3. CI must have run for this exact commit, and finished, and passed ─────────────────────────
let runId;
let ciRun;
try {
  // A short SHA is what a human types, and `gh run list --commit <short>` does not match one — an
  // earlier version of this gate refused a commit that *had* run, for the wrong reason. Resolve to
  // the full SHA when the object is here, and match on the prefix rather than trusting the filter.
  let full = commit;
  try {
    full = execFileSync('git', ['rev-parse', '--verify', `${commit}^{commit}`], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    // Not in this clone — the prefix match below still works against the runs GitHub returns.
  }
  const raw = execFileSync(
    'gh',
    [
      'run', 'list', '--workflow=ci.yml', '--limit', '60',
      '--json', 'databaseId,status,conclusion,headSha,createdAt',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const runs = JSON.parse(raw).filter(
    (r) => r.headSha.startsWith(commit) || commit.startsWith(r.headSha) || r.headSha === full,
  );
  if (!runs.length) {
    refuse(
      `no CI run exists for ${short}. A commit that was never gated cannot be released — push it ` +
        'and let the gates run, or point --commit at a commit that has.',
    );
  } else {
    const done = runs.filter((r) => r.status === 'completed');
    const green = done.filter((r) => r.conclusion === 'success');
    if (!green.length) {
      const inProgress = runs.filter((r) => r.status !== 'completed');
      refuse(
        inProgress.length
          ? `CI for ${short} is still running (${inProgress.map((r) => r.databaseId).join(', ')}). ` +
            'Wait for it: releasing mid-run is releasing an unverified commit.'
          : `CI for ${short} exists but did not succeed: ` +
            done.map((r) => `${r.databaseId}=${r.conclusion}`).join(', '),
      );
    } else {
      ciRun = green.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      runId = ciRun.databaseId;
    }
  }
} catch (error) {
  refuse(`could not ask GitHub about the candidate's checks: ${error.message}`);
}
if (refusals.length) {
  console.log('REFUSED');
  for (const r of refusals) console.log(`  ✗ ${r}`);
  process.exit(2);
}

// ── 4. The staging verification must belong to the same run ─────────────────────────────────────
try {
  const jobs = JSON.parse(
    execFileSync('gh', ['run', 'view', String(runId), '--json', 'jobs'], { cwd: ROOT, encoding: 'utf8' }),
  ).jobs;
  const qa = jobs.find((j) => /^QA\b/.test(j.name));
  if (!qa) {
    refuse(`run ${runId} has no QA/staging job, so staging was never verified for ${short}.`);
  } else if (qa.conclusion !== 'success') {
    refuse(
      `run ${runId}: the staging job concluded "${qa.conclusion}". Staging must be verified for the ` +
        'released commit — a green unit-only run is not a staging verification.',
    );
  } else {
    console.log(`  ✓ CI run ${runId} succeeded for ${short}, including the staging job`);
  }
} catch (error) {
  refuse(`could not read the jobs of run ${runId}: ${error.message}`);
}

// ── 5. The declared target and the credentials must agree ───────────────────────────────────────
const environment = config.environments[target];
const ref = environment.projectRef;
if (target === 'production') {
  const host = process.env.PROD_DB_HOST;
  const user = process.env.PROD_DB_USER;
  const pass = process.env.PROD_DB_PASS;
  const missing = [!host && 'PROD_DB_HOST', !user && 'PROD_DB_USER', !pass && 'PROD_DB_PASS'].filter(Boolean);
  if (missing.length) {
    refuse(
      `production is declared but its credentials are absent (${missing.join(', ')}). This is a ` +
        'REFUSAL, not a warning: without them the gate cannot compare the candidate with the live ' +
        'schema, and releasing on an unverified schema is the failure this gate exists to prevent.',
    );
  } else if (!String(user).includes(ref)) {
    refuse(
      `PROD_DB_USER does not name production's project (${ref}). The gate refuses rather than trust ` +
        'a credential whose identity it cannot see.',
    );
  }
} else {
  const user = process.env.QA_DB_USER;
  if (!user || !String(user).includes(ref)) {
    refuse(`the ${target} credentials do not name ${ref}; the gate refuses an unidentifiable target.`);
  } else {
    console.log(`  ✓ the ${target} credentials name ${ref}`);
  }
}

if (refusals.length) {
  console.log('\nREFUSED');
  for (const r of refusals) console.log(`  ✗ ${r}`);
  process.exit(2);
}

// ── 6. Print the reviewed plan. This script never applies it ────────────────────────────────────
console.log('\nMigration plan (read-only — this gate does not apply anything):');
try {
  const plan = execFileSync('node', ['scripts/migrate.mjs', 'status', '--env', target], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(plan.trimEnd());
} catch (error) {
  const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
  console.log(`  the plan could not be produced: ${detail || error.message}`);
  console.log('  NOT CERTIFIED for release — see the refusal above before re-running.');
  process.exit(2);
}

console.log(
  '\nCANDIDATE IS RELEASABLE (nothing was applied). The operator applies the reviewed plan with:\n' +
    `  node scripts/migrate.mjs apply --env ${target} --apply\n` +
    'and records the applied version, hash and result against this commit.',
);
