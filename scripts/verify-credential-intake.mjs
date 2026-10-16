#!/usr/bin/env node
/**
 * verify-credential-intake.mjs — prove that the one file a human has to touch cannot leak, cannot
 * be pointed at the wrong project, and cannot be used to run anything but the two read-only
 * production commands.
 *
 * WHY THIS EXISTS
 *   `PROD_DB_PASS` is the single input Phase 2A cannot generate for itself, so it is the one place
 *   where a mistake is unrecoverable: a value pasted into the wrong file, a path inside the
 *   checkout, a QA password behind a PROD prefix, or an injector that will happily run
 *   `node -e "console.log(process.env.PROD_DB_PASS)"`. Every one of those is a check here, judged
 *   from outside the process by exit code and by the exact bytes on stdout/stderr.
 *
 * THE CLAIMS
 *   1. Every refusal is an exit code (2), never a warning, and happens BEFORE the child is spawned.
 *   2. The credential file must live outside the repository — proven by pointing `--file` at a path
 *      inside the checkout that does not even exist, so the location check cannot be a side effect
 *      of reading the file.
 *   3. A password containing quotes, spaces, `#`, `=`, `$` and backslashes survives the file
 *      verbatim — quoting is the only ambiguity, and it is tested as quoting.
 *   4. No value ever reaches the output: the password in every case carries a canary generated this
 *      run, asserted absent from the combined output of every case, including the one where the
 *      child is a real backup script failing on DNS.
 *   5. The validation call site is load-bearing — the mutation case deletes it in a throwaway copy
 *      and watches a wrong-project file become acceptable. A suite that only observes refusals is
 *      satisfied by a tool that refuses everything, so the accepted case is the control.
 *
 * Usage:  node scripts/verify-credential-intake.mjs [--json <path>]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, loadEnvironmentConfig } from './lib/environments.mjs';
import {
  CREDENTIAL_KEYS,
  assertOutsideRepository,
  parseCredentialsFile,
  readCredentialsFile,
  validateProductionCredentials,
} from './lib/credentials-file.mjs';

const config = loadEnvironmentConfig();
const PRODUCTION_REF = config.environments.production.projectRef;
const STAGING_REF = config.environments.staging.projectRef;

const WRAPPER = path.join(ROOT, 'scripts', 'run-with-production-credentials.mjs');
const BACKUP = 'scripts/backup-database.mjs';
const RESTORE_VERIFY = 'scripts/restore-verify.mjs';

// RFC 5737 / RFC 2606: reserved for documentation, so they fail locally instead of over a network.
const BLACK_HOLE_HOST = '203.0.113.1';
const NOWHERE_HOST = 'nonexistent-backup-target.invalid';

// Fresh per run, so no redaction rule could have been written to expect it.
const CANARY = `CANARY_${crypto.randomBytes(12).toString('hex')}`;
const CANARY_WITH_SYMBOLS = `${CANARY} p@ss#w"ord'&$;=tail`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agrishop-credintake-'));
const insideRepoPath = path.join(ROOT, 'backups', `should-not-exist-${process.pid}.env`);
const wrongRefFile = path.join(tmp, 'wrong-project.env');
const completeFile = path.join(tmp, 'complete.env');
const missingPassFile = path.join(tmp, 'missing-pass.env');
const emptyPassFile = path.join(tmp, 'empty-pass.env');
const templateFile = path.join(tmp, 'template.env');

fs.writeFileSync(
  wrongRefFile,
  `# QA identity behind a PROD prefix — the exact mistake the guard exists to catch\n` +
    `PROD_DB_HOST=${BLACK_HOLE_HOST}\nPROD_DB_USER=postgres.${STAGING_REF}\nPROD_DB_PASS=${CANARY}\n`,
);
fs.writeFileSync(
  completeFile,
  `PROD_DB_HOST=${NOWHERE_HOST}\nPROD_DB_USER=postgres.${PRODUCTION_REF}\nPROD_DB_PASS=${CANARY_WITH_SYMBOLS}\n`,
);
fs.writeFileSync(missingPassFile, `PROD_DB_HOST=${BLACK_HOLE_HOST}\nPROD_DB_USER=postgres.${PRODUCTION_REF}\n`);
fs.writeFileSync(emptyPassFile, `PROD_DB_HOST=${BLACK_HOLE_HOST}\nPROD_DB_USER=postgres.${PRODUCTION_REF}\nPROD_DB_PASS=\n`);

const results = [];
let failures = 0;

function record(name, why, { ok, problems = [], detail = '', exit = null, elapsedMs = null }) {
  if (!ok) failures += 1;
  results.push({ name, why, status: ok ? 'PASS' : 'FAIL', exitCode: exit, elapsedMs, problems, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${exit === null ? '' : `  (exit ${exit}${elapsedMs === null ? '' : `, ${elapsedMs}ms`})`}`);
  console.log(`      ${why}`);
  if (!ok) for (const problem of problems) console.log(`      → ${problem}`);
  else if (detail) console.log(`      → "${String(detail).slice(0, 160)}"`);
  console.log('');
}

/** Spawn the wrapper for real and judge it from the outside. */
function spawnWrapper({ name, why, argv, expectExit, expectStdout = null, expectStderr = null, forbidStderr = null, timeout = 60_000 }) {
  const env = { ...process.env };
  for (const key of CREDENTIAL_KEYS) delete env[key];

  const startedAt = Date.now();
  const run = spawnSync(process.execPath, [WRAPPER, ...argv], { cwd: ROOT, env, encoding: 'utf8', timeout });
  const elapsedMs = Date.now() - startedAt;
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const combined = stdout + stderr;
  const problems = [];

  if (run.error) problems.push(`could not run: ${run.error.message}`);
  if (run.status !== expectExit) problems.push(`exit code ${run.status}, expected ${expectExit}`);
  if (expectStdout && !expectStdout.test(stdout)) problems.push(`stdout did not match ${expectStdout}`);
  if (expectStderr && !expectStderr.test(stderr)) problems.push(`stderr did not match ${expectStderr}`);
  if (forbidStderr && forbidStderr.test(stderr)) problems.push(`stderr matched forbidden ${forbidStderr}`);
  if (combined.includes(CANARY)) problems.push('CREDENTIAL LEAK: canary found in output');

  const firstLine = (stderr.split('\n').find((line) => line.trim()) ?? stdout.split('\n').find((line) => line.trim()) ?? '').trim();
  record(name, why, { ok: problems.length === 0, problems, detail: firstLine, exit: run.status, elapsedMs });
  return { stdout, stderr };
}

/** Parser-level assertions: cheaper than a process, and the only way to compare an exact value. */
function checkParser(name, why, run) {
  const problems = [];
  try {
    run(problems);
  } catch (error) {
    problems.push(`threw: ${error.message}`);
  }
  record(name, why, { ok: problems.length === 0, problems });
}

console.log('Credential intake — real processes, real exit codes, canary per run');
console.log(`  production ref : ${PRODUCTION_REF}`);
console.log(`  staging ref    : ${STAGING_REF}`);
console.log(`  canary         : ${CANARY.length} chars + ${CANARY_WITH_SYMBOLS.length - CANARY.length} symbol chars, generated this run`);
console.log(`  scratch dir    : ${tmp}`);
console.log('');

// ── A. The file's location is a rule, not a suggestion ───────────────────────────────────────
spawnWrapper({
  name: 'file_inside_repository_refused',
  why: 'a production credential in the checkout is one `git add` away from being committed — the path does not even have to exist to be refused',
  argv: ['--file', insideRepoPath, '--check'],
  expectExit: 2,
  expectStderr: /inside this repository[\s\S]*outside the repository/,
});

spawnWrapper({
  name: 'missing_file_refused',
  why: 'an absent file is a refusal with instructions, never a silent fallback to another environment',
  argv: ['--file', path.join(tmp, 'not-created.env'), '--check'],
  expectExit: 2,
  expectStderr: /No production credential file[\s\S]*--init/,
});

// ── B. Identity: the wrong project behind a PROD prefix ──────────────────────────────────────
spawnWrapper({
  name: 'staging_identity_behind_prod_prefix_refused',
  why: 'THE ORIGINAL DEFECT, one layer up: a file labelled PROD carrying QA credentials',
  argv: ['--file', wrongRefFile, '--check'],
  expectExit: 2,
  expectStderr: new RegExp(`credentials name project ${STAGING_REF}.*which is "staging"`, 's'),
});

fs.writeFileSync(path.join(tmp, 'bare-user.env'), `PROD_DB_HOST=${BLACK_HOLE_HOST}\nPROD_DB_USER=postgres\nPROD_DB_PASS=${CANARY}\n`);
spawnWrapper({
  name: 'bare_postgres_user_refused',
  why: 'the pooler rewrites current_user, so a credential that does not name a project cannot be verified and must not be used',
  argv: ['--file', path.join(tmp, 'bare-user.env'), '--check'],
  expectExit: 2,
  expectStderr: /do not name a project/,
});

// ── C. Completeness: the empty placeholder is a refusal ──────────────────────────────────────
spawnWrapper({
  name: 'missing_password_refused',
  why: 'PROD_DB_PASS has no default; an absent key must not degrade into another environment',
  argv: ['--file', missingPassFile, '--check'],
  expectExit: 2,
  expectStderr: /missing PROD_DB_PASS[\s\S]*dashboard/,
});

spawnWrapper({
  name: 'empty_password_refused',
  why: 'the template ships with an empty PROD_DB_PASS line, so an unfilled template must refuse',
  argv: ['--file', emptyPassFile, '--check'],
  expectExit: 2,
  expectStderr: /missing PROD_DB_PASS/,
});

// ── D. The command must be one of two, and must name production itself ───────────────────────
spawnWrapper({
  name: 'arbitrary_command_refused',
  why: 'a credential injector that runs anything is a leak with a polite interface',
  argv: ['--file', completeFile, '--', 'node', '-e', 'console.log(process.env.PROD_DB_PASS)'],
  expectExit: 2,
  expectStderr: /not on the allow-list/,
});

spawnWrapper({
  name: 'non_node_runtime_refused',
  why: 'only the Node entry points are on the allow-list, so a shell wrapper cannot be substituted',
  argv: ['--file', completeFile, '--', 'bash', '-c', 'env | grep PROD'],
  expectExit: 2,
  expectStderr: /Only "node" may be launched/,
});

spawnWrapper({
  name: 'command_that_does_not_name_production_refused',
  why: 'the wrapper cannot be used to smuggle credentials into an unrelated run',
  argv: ['--file', completeFile, '--', 'node', BACKUP, '--env', 'staging'],
  expectExit: 2,
  expectStderr: /must name production itself/,
});

spawnWrapper({
  name: 'no_command_refused',
  why: 'a mode that neither checks nor runs is a mistake worth naming',
  argv: ['--file', completeFile],
  expectExit: 2,
  expectStderr: /No command given/,
});

// ── E. The control: correct credentials are NOT refused ──────────────────────────────────────
spawnWrapper({
  name: 'check_mode_accepts_a_complete_production_file',
  why: 'THE CONTROL: the refusals above are about the pairing and the shape, not about refusing everything',
  argv: ['--file', completeFile, '--check'],
  expectExit: 0,
  expectStdout: new RegExp(`OK — ${CREDENTIAL_KEYS.length} keys loaded.*${PRODUCTION_REF}`),
});

spawnWrapper({
  name: 'real_backup_child_runs_and_fails_on_dns_not_identity',
  why: 'the whole chain: file → validation → injection → the real backup script accepting the identity and failing later on an unresolvable host',
  argv: ['--file', completeFile, '--', 'node', BACKUP, '--env', 'production'],
  expectExit: 1,
  expectStderr: /ENOTFOUND|getaddrinfo|EAI_AGAIN/,
  forbidStderr: /\[TARGETING\] ABORTED/,
});

// ── F. The template is safe to create and cannot clobber ─────────────────────────────────────
{
  const init = spawnSync(process.execPath, [WRAPPER, '--init', '--file', templateFile], { cwd: ROOT, encoding: 'utf8' });
  const content = fs.existsSync(templateFile) ? fs.readFileSync(templateFile, 'utf8') : '';
  const problems = [];
  if (init.status !== 0) problems.push(`--init exited ${init.status}: ${(init.stderr ?? '').trim().slice(0, 120)}`);
  if (!content.includes(`PROD_DB_USER=postgres.${PRODUCTION_REF}`)) problems.push('template does not prefill the production user string');
  if (!/^PROD_DB_PASS=\s*$/m.test(content)) problems.push('template PROD_DB_PASS line is not empty');
  if (content.includes(CANARY)) problems.push('CREDENTIAL LEAK: canary in template');
  record('init_writes_a_template_with_no_secret', 'the one value that cannot be recovered is the one value the template leaves empty', {
    ok: problems.length === 0,
    problems,
    detail: `template created at ${path.relative(ROOT, templateFile)} (outside the repository)`,
    exit: init.status,
  });

  const second = spawnSync(process.execPath, [WRAPPER, '--init', '--file', templateFile], { cwd: ROOT, encoding: 'utf8' });
  const secondProblems = [];
  if (second.status !== 2) secondProblems.push(`second --init exited ${second.status}, expected 2`);
  if (!/already exists/.test(second.stderr ?? '')) secondProblems.push('second --init did not say why it refused');
  record('init_refuses_to_overwrite', 'a filled-in password exists nowhere else, so the template writer must never replace the file', {
    ok: secondProblems.length === 0,
    problems: secondProblems,
    detail: (second.stderr ?? '').split('\n').find((l) => l.trim()) ?? '',
    exit: second.status,
  });
}

// ── G. Value fidelity, at the level where an exact comparison is possible ────────────────────
checkParser('parser_preserves_symbols_and_equals', 'a password with quotes, spaces, #, $, ; and = must survive verbatim', (problems) => {
  const { values } = parseCredentialsFile(`PROD_DB_PASS=${CANARY_WITH_SYMBOLS}\n`);
  if (values.PROD_DB_PASS !== CANARY_WITH_SYMBOLS) {
    problems.push(`value changed: expected ${CANARY_WITH_SYMBOLS.length} chars, got ${String(values.PROD_DB_PASS).length}`);
  }
});

checkParser('parser_strips_one_pair_of_quotes_and_keeps_inner_spaces', 'quoting is how a password with leading/trailing spaces is written unambiguously', (problems) => {
  const { values } = parseCredentialsFile(`PROD_DB_PASS="  ${CANARY} pw  "\n`);
  if (values.PROD_DB_PASS !== `  ${CANARY} pw  `) problems.push('quoted value was not preserved with its surrounding spaces');
});

checkParser('parser_ignores_comments_and_blanks', 'a template full of comments must not turn into a credential', (problems) => {
  const { values, ignored } = parseCredentialsFile(
    `# comment\n\n   # indented comment\nPROD_DB_HOST=${BLACK_HOLE_HOST}\n\nPROD_DB_PASS=${CANARY}\n`,
  );
  if (ignored.length) problems.push(`unexpected ignored lines: ${ignored.length}`);
  if (values.PROD_DB_HOST !== BLACK_HOLE_HOST) problems.push('host not parsed');
  if (values.PROD_DB_PASS !== CANARY) problems.push('password not parsed');
});

checkParser('parser_handles_crlf_and_a_missing_final_newline', 'Windows editors write CRLF; an editor that drops the final newline must not drop the last key', (problems) => {
  const { values } = parseCredentialsFile(`PROD_DB_USER=postgres.${PRODUCTION_REF}\r\nPROD_DB_PASS=${CANARY}`);
  if (values.PROD_DB_USER !== `postgres.${PRODUCTION_REF}`) problems.push('CRLF key mangled');
  if (values.PROD_DB_PASS !== CANARY) problems.push('final line without newline lost');
});

checkParser('parser_reports_duplicates_and_unparsable_lines', 'a duplicated key or a missing `=` should be visible, not silently ignored', (problems) => {
  const { values, duplicates, ignored } = parseCredentialsFile(`PROD_DB_PASS=first\nPROD_DB_PASS=second\nPROD_DB_PASS\n`);
  if (values.PROD_DB_PASS !== 'second') problems.push('last value should win');
  if (!duplicates.includes('PROD_DB_PASS')) problems.push('duplicate not reported');
  if (!ignored.length) problems.push('line without `=` not reported');
});

checkParser('validator_rejects_a_file_carrying_no_prod_keys', 'a QA-only file behind --file must not satisfy production intake', (problems) => {
  try {
    validateProductionCredentials({ QA_DB_HOST: BLACK_HOLE_HOST, QA_DB_USER: `postgres.${STAGING_REF}`, QA_DB_PASS: CANARY });
    problems.push('accepted a file with no PROD_* keys');
  } catch (error) {
    if (!/missing PROD_DB_HOST, PROD_DB_USER, PROD_DB_PASS/.test(error.message)) problems.push(`wrong refusal: ${error.message.slice(0, 120)}`);
  }
});

checkParser('outside_repository_guard_is_absolute', 'the location rule must hold for paths that do not exist as well as for real files', (problems) => {
  try {
    assertOutsideRepository(path.join(ROOT, 'backups', 'does-not-exist.env'));
    problems.push('accepted a path inside the repository');
  } catch {
    /* expected */
  }
  const outside = assertOutsideRepository(path.join(os.tmpdir(), 'agrishop-outside-check.env'));
  if (!path.isAbsolute(outside)) problems.push('did not return an absolute path for an outside file');
});

checkParser('read_credentials_file_refuses_inside_repo_before_reading', 'the location check must come first, so an existing in-repo secret is never parsed at all', (problems) => {
  try {
    readCredentialsFile(path.join(ROOT, '.env.local'));
    problems.push('read a file inside the repository');
  } catch (error) {
    if (!/inside this repository/.test(error.message)) problems.push(`wrong refusal: ${error.message.slice(0, 120)}`);
  }
});

// ── H. Non-vacuity: delete the check and watch the wrong-project file become acceptable ──────
{
  const mutantPath = path.join(ROOT, 'scripts', `.tmp-intake-mutant-${process.pid}.mjs`);
  const anchor = 'info = validateProductionCredentials(values, { source: filePath });';
  const source = fs.readFileSync(WRAPPER, 'utf8');
  const problems = [];

  if (!source.includes(anchor)) {
    problems.push(`mutation anchor not found in ${path.relative(ROOT, WRAPPER)} — this harness would have been vacuous`);
    record('mutation_removing_the_validation_is_detected', 'the guard must be the thing that refuses', {
      ok: false,
      problems,
      detail: '',
    });
  } else {
    fs.writeFileSync(
      mutantPath,
      source.replace(anchor, 'info = { projectRef: "(unchecked)", host: values.PROD_DB_HOST, user: values.PROD_DB_USER, extras: [] };'),
    );
    const mutant = spawnSync(process.execPath, [mutantPath, '--file', wrongRefFile, '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
    const real = spawnSync(process.execPath, [WRAPPER, '--file', wrongRefFile, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });

    if (mutant.status !== 0) problems.push(`mutant exited ${mutant.status}; without the check the wrong-project file should be ACCEPTED, so the mutations proves nothing`);
    if (!/unchecked/.test(mutant.stdout ?? '')) problems.push('mutant did not reach the unchecked branch');
    if (real.status !== 2) problems.push(`the unmutated wrapper exited ${real.status}, expected the same 2 as case B`);
    if ((mutant.stdout + mutant.stderr).includes(CANARY)) problems.push('CREDENTIAL LEAK: canary in mutant output');

    record('mutation_removing_the_validation_is_detected', 'delete the check and the wrong-project file passes; keep it and the same file is refused', {
      ok: problems.length === 0,
      problems,
      detail: `mutant accepted (exit ${mutant.status}), real wrapper refused (exit ${real.status})`,
      exit: real.status,
    });

    fs.rmSync(mutantPath, { force: true });
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(insideRepoPath, { force: true });

console.log('─'.repeat(72));
console.log(
  failures === 0
    ? `ALL ${results.length} CHECKS PASS — the intake refuses the wrong project, the wrong location, the ` +
        'wrong shape and the wrong command, leaks nothing under a fresh canary, and its validation call ' +
        'site was shown to be load-bearing.'
    : `${failures} of ${results.length} CHECKS FAILED.`,
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
        checks: results,
      },
      null,
      2,
    ),
  );
  console.log(`report: ${path.relative(ROOT, outPath)}`);
}

process.exit(failures === 0 ? 0 : 1);
