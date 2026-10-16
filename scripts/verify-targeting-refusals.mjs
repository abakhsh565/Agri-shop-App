#!/usr/bin/env node
/**
 * verify-targeting-refusals.mjs — prove the targeting rules at the PROCESS boundary.
 *
 * WHY THIS EXISTS, GIVEN tests/unit/backupTargeting.test.ts
 *   The unit tests import `scripts/lib/environments.mjs` and check that the right functions throw.
 *   That proves the logic. It does not prove that `node scripts/backup-database.mjs` — the thing the
 *   workflow actually runs — returns a non-zero exit code, gives up *before* opening a socket, or
 *   keeps a credential out of its output. A function can throw and a wrapper can still swallow it.
 *   So this harness spawns the real CLIs and judges them from the outside: exit code, elapsed time,
 *   and the exact bytes on stdout/stderr.
 *
 * THREE CLAIMS, EACH PROVEN RATHER THAN ARGUED
 *
 *   1. Every refusal is an exit code. A warning that scrolls past is not a refusal, and in CI it is
 *      indistinguishable from success.
 *
 *   2. Refusals happen BEFORE a connection is attempted. This is checked by pointing the run at an
 *      address that could not possibly answer (TEST-NET-3, reserved for documentation) and asserting
 *      the refusal still arrives in well under a second. A check that ran after connecting would
 *      have to wait for that address to time out.
 *
 *   3. No credential value ever reaches the output — including on a genuine connection failure, where
 *      a driver is most likely to echo the connection string it was given. Every case that supplies
 *      credentials supplies a synthetic password containing a unique canary, and the canary is
 *      asserted absent from all output of every case. The canary is generated per run, so it cannot
 *      be whitewashed by a fixture.
 *
 * THE CONTROL THAT MAKES THE REFUSALS MEAN SOMETHING
 *   A suite that only ever observes refusals is satisfied by a tool that refuses everything. So case
 *   `production_identity_accepted` supplies credentials that legitimately name production and asserts
 *   the opposite outcome: the identity check must PASS and the run must proceed far enough to fail on
 *   the network. Without that case, `production_rejects_staging_credentials` would be worthless.
 *
 * NO PART OF THIS HARNESS HOLDS A REAL PRODUCTION CREDENTIAL.
 *   The real staging auth is never read. The adversarial credential is the *identity string*
 *   `postgres.<staging-ref>`, which is derived here from environments.json and is not a secret, paired
 *   with a synthetic password. That is sufficient, because rule 2 means the password is never used:
 *   the refusal is decided from the user string before a socket exists.
 *
 * Usage:  node scripts/verify-targeting-refusals.mjs [--json <path>]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ENVIRONMENT_NAMES, ROOT, loadEnvironmentConfig } from './lib/environments.mjs';

const config = loadEnvironmentConfig();
const STAGING_REF = config.environments.staging.projectRef;
const PRODUCTION_REF = config.environments.production.projectRef;

/**
 * Development's own state, read from environments.json rather than assumed.
 *
 * This harness used to hardcode "development has no project ref" as the expected refusal. That was
 * true when it was written and stops being true the moment the dedicated development project this
 * repository is waiting for exists — at which point a correct environment would be reported as a
 * failure and the harness would have to be weakened to go green. The rule it is really testing is
 * wider than the current state: **development is never a target unless its OWN project is recorded,
 * and then only with its own credentials.** Both branches are asserted, and each is refused with
 * exit 2 before a socket exists.
 */
const DEVELOPMENT = config.environments.development;
const DEVELOPMENT_REF = DEVELOPMENT.projectRef ?? null;
const DEVELOPMENT_TARGETABLE = DEVELOPMENT.status === 'active' && Boolean(DEVELOPMENT_REF);

// Unroutable by definition: RFC 5737 reserves 203.0.113.0/24 for documentation, and `.invalid` is
// reserved by RFC 2606, so it fails resolution locally instead of waiting on a network.
const BLACK_HOLE_HOST = '203.0.113.1';
const NOWHERE_HOST = 'nonexistent-backup-target.invalid';

// A fresh canary per run. If any credential value reaches stdout or stderr, this string is how we
// see it; because it is random, no formatting or redaction rule can have been written to expect it.
const CANARY = `CANARY_${crypto.randomBytes(12).toString('hex')}`;

/** Every environment's credential variables, derived from environments.json so a new prefix
 *  (development's DEV_) is cleared here without anyone remembering to add it to a list. */
const CREDENTIAL_KEYS = ENVIRONMENT_NAMES.flatMap((name) => {
  const prefix = config.environments[name].envPrefix;
  return [`${prefix}_DB_HOST`, `${prefix}_DB_USER`, `${prefix}_DB_PASS`];
});

/**
 * @param {object} c
 * @param {string} c.name
 * @param {string[]} c.argv
 * @param {Record<string,string>} [c.credentials]  keys to place in the child environment
 * @param {string[]} [c.clearCredentials]          keys to remove, so "missing" is genuinely missing
 * @param {number} c.expectExit
 * @param {RegExp} c.expectStderr
 * @param {RegExp} [c.forbidStderr]
 * @param {string} [c.why]
 */
const CASES = [
  {
    name: 'no_env_flag',
    why: 'no default target: a backup must name where it is going',
    argv: ['scripts/backup-database.mjs'],
    clearCredentials: CREDENTIAL_KEYS,
    expectExit: 2,
    expectStderr: /requires an explicit target and has no default/,
  },
  {
    name: 'unknown_environment',
    why: 'an environment nobody defined is not guessed at',
    argv: ['scripts/backup-database.mjs', '--env', 'banana'],
    clearCredentials: CREDENTIAL_KEYS,
    expectExit: 2,
    expectStderr: /banana/,
  },
  {
    name: DEVELOPMENT_TARGETABLE ? 'development_without_its_own_credentials' : 'development_has_no_project',
    why: DEVELOPMENT_TARGETABLE
      ? 'development now has its own project, so the refusal must be about ITS credentials — never a fallback to another environment’s'
      : 'development has no recorded ref, so it cannot be verified, so it is refused',
    argv: ['scripts/backup-database.mjs', '--env', 'development'],
    clearCredentials: CREDENTIAL_KEYS,
    expectExit: 2,
    expectStderr: DEVELOPMENT_TARGETABLE
      ? /missing DEV_DB_HOST, DEV_DB_USER, DEV_DB_PASS[\s\S]*will not fall back/
      : /Refusing to run for "development".*no project ref is recorded/s,
  },
  {
    name: 'production_without_credentials',
    why: 'missing credentials are a refusal, never a fallback to another environment',
    argv: ['scripts/backup-database.mjs', '--env', 'production'],
    clearCredentials: CREDENTIAL_KEYS,
    expectExit: 2,
    expectStderr: /missing PROD_DB_HOST, PROD_DB_USER, PROD_DB_PASS[\s\S]*will not fall back/,
  },
  {
    name: 'production_rejects_staging_credentials',
    why: 'THE ORIGINAL DEFECT: the run that was called "production" while carrying QA credentials',
    argv: ['scripts/backup-database.mjs', '--env', 'production'],
    credentials: {
      // A real identity string for a *different* project, with a synthetic secret.
      PROD_DB_USER: `postgres.${STAGING_REF}`,
      PROD_DB_PASS: CANARY,
      PROD_DB_HOST: BLACK_HOLE_HOST,
    },
    expectExit: 2,
    // Both halves matter: it must refuse, and it must name the project the credential actually
    // points at, so the operator can see what they nearly did.
    expectStderr: new RegExp(
      `declared "production" \\(project ${PRODUCTION_REF}\\).*credentials name project ${STAGING_REF}.*which is "staging"`,
      's',
    ),
  },
  {
    name: 'staging_rejects_production_credentials',
    why: 'the isolation is symmetric, so it is a rule and not a one-way special case',
    argv: ['scripts/backup-database.mjs', '--env', 'staging'],
    credentials: {
      QA_DB_USER: `postgres.${PRODUCTION_REF}`,
      QA_DB_PASS: CANARY,
      QA_DB_HOST: BLACK_HOLE_HOST,
    },
    expectExit: 2,
    expectStderr: new RegExp(`credentials name project ${PRODUCTION_REF}.*which is "production"`, 's'),
  },
  {
    name: 'unverifiable_credential_refused',
    why: 'the pooler rewrites current_user to "postgres", so a user with no ref has to carry one',
    argv: ['scripts/backup-database.mjs', '--env', 'production'],
    credentials: {
      PROD_DB_USER: 'postgres',
      PROD_DB_PASS: CANARY,
      PROD_DB_HOST: BLACK_HOLE_HOST,
    },
    expectExit: 2,
    expectStderr: /do not name a project \(user: postgres\)[\s\S]*unverifiable target must not be backed up/,
  },
  {
    name: 'production_identity_accepted_then_network_fails',
    why: 'THE CONTROL: correct credentials are NOT refused on identity, so the refusals above are about the pairing',
    argv: ['scripts/backup-database.mjs', '--env', 'production'],
    credentials: {
      PROD_DB_USER: `postgres.${PRODUCTION_REF}`,
      PROD_DB_PASS: CANARY,
      PROD_DB_HOST: NOWHERE_HOST,
    },
    expectExit: 1, // a real failure, but a *later* one
    forbidStderr: /\[TARGETING\] ABORTED/,
    expectStderr: /ENOTFOUND|getaddrinfo|EAI_AGAIN/,
  },
];

const results = [];
let failures = 0;

console.log('Targeting refusal matrix — real processes, real exit codes');
console.log(`  production ref : ${PRODUCTION_REF}`);
console.log(`  staging ref    : ${STAGING_REF}`);
console.log(
  DEVELOPMENT_TARGETABLE
    ? `  development    : status "${DEVELOPMENT.status}", project ${DEVELOPMENT_REF}, targetable only with DEV_ credentials`
    : `  development    : status "${DEVELOPMENT.status}", no ref, therefore untargetable`,
);
console.log(`  canary         : ${CANARY.length} chars, generated this run`);
console.log('');

for (const testCase of CASES) {
  const env = { ...process.env };
  for (const key of testCase.clearCredentials ?? []) delete env[key];
  for (const [key, value] of Object.entries(testCase.credentials ?? {})) env[key] = value;

  const startedAt = Date.now();
  const run = spawnSync(process.execPath, testCase.argv, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const elapsedMs = Date.now() - startedAt;

  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const combined = stdout + stderr;
  const problems = [];

  if (run.error) problems.push(`could not run: ${run.error.message}`);
  if (run.status !== testCase.expectExit) {
    problems.push(`exit code ${run.status}, expected ${testCase.expectExit}`);
  }
  if (!testCase.expectStderr.test(stderr)) {
    problems.push(`stderr did not match ${testCase.expectStderr}`);
  }
  if (testCase.forbidStderr && testCase.forbidStderr.test(stderr)) {
    problems.push(`stderr matched forbidden ${testCase.forbidStderr}`);
  }
  // Claim 3, asserted for every case: the synthetic secret appears nowhere.
  if (combined.includes(CANARY)) problems.push('CREDENTIAL LEAK: canary found in output');
  // Claim 2, asserted only where the run is supposed to stop before connecting. Case H is exempt
  // because it is *meant* to reach the network.
  const mustRefuseBeforeConnecting = testCase.expectExit === 2;
  if (mustRefuseBeforeConnecting && elapsedMs > 3000) {
    problems.push(`${elapsedMs}ms — slow enough that a connection may have been attempted`);
  }

  const ok = problems.length === 0;
  if (!ok) failures += 1;

  results.push({
    case: testCase.name,
    why: testCase.why,
    argv: testCase.argv.join(' '),
    exitCode: run.status,
    elapsedMs,
    status: ok ? 'PASS' : 'FAIL',
    problems,
    // First non-empty line of stderr only. Refusal messages are written to be shown; they name
    // projects and variables, never values. Leading blanks are skipped because a driver's own error
    // dump can precede the message we wrote.
    said: (stderr.split('\n').find((line) => line.trim()) ?? '').trim().slice(0, 160),
  });

  console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}  (exit ${run.status}, ${elapsedMs}ms)`);
  console.log(`      ${testCase.why}`);
  if (!ok) for (const problem of problems) console.log(`      → ${problem}`);
  else console.log(`      → "${results.at(-1).said}"`);
  console.log('');
}

console.log('─'.repeat(72));
console.log(
  failures === 0
    ? `ALL ${CASES.length} CASES PASS — every refusal is an exit code, arrives before a connection, ` +
        'and leaks nothing; the accepted case proves the identity check discriminates.'
    : `${failures} of ${CASES.length} CASES FAILED.`,
);

const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  const outPath = path.resolve(ROOT, process.argv[jsonIndex + 1]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        productionProjectRef: PRODUCTION_REF,
        stagingProjectRef: STAGING_REF,
        canaryLeakDetected: results.some((r) => r.problems.some((p) => p.includes('CREDENTIAL LEAK'))),
        cases: results,
      },
      null,
      2,
    ),
  );
  console.log(`report: ${path.relative(ROOT, outPath)}`);
}

process.exit(failures === 0 ? 0 : 1);
