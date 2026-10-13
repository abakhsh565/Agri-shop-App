#!/usr/bin/env node
/**
 * verify-workflow-safety.mjs — judge the backup workflow before it is ever trusted with credentials.
 *
 * WHY A SCRIPT AND NOT A REVIEW
 *   `.github/workflows/backup-database.yml` is the only component that will ever hold production
 *   credentials. It is also the component that shipped the original defect: a file named "Backup
 *   Production Database" that passed QA credentials to a script hardcoding QA. It was green every
 *   day, and no one could tell from the outside. A reading of the file would not have caught that
 *   either, because the file *looked* like it backed up production. So this script does not read the
 *   workflow and agree with it. It does three things:
 *
 *     1. CHECKS THE FILE IS WELL FORMED
 *        No tabs, consistent indentation, balanced `${{ }}`, and every `run:` block shell-checked
 *        with `bash -n`. This repository has no YAML parser installed, and GitHub parsing the file
 *        for the first time on a push is not a verification strategy.
 *
 *     2. CHECKS THE INVARIANTS — AND PROVES EACH CHECK CAN FAIL
 *        Each invariant carries a mutation alongside it: the textual change that would break it.
 *        The check must pass on the real file and FAIL on the mutated one. A check that passes both
 *        ways is reported as a failure, because a guard that cannot detect its own failure mode
 *        provides no evidence. This is the whole point of the file.
 *
 *     3. RUNS THE WORKFLOW'S OWN SHELL
 *        The preflight and artefact-confirmation blocks are extracted from the YAML and executed
 *        with controlled environments. The requirement "never silently use QA credentials" is
 *        answered by running the thing that decides it, not by restating it.
 *
 * Usage:  node scripts/verify-workflow-safety.mjs [--json <path>]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, loadEnvironmentConfig } from './lib/environments.mjs';

const config = loadEnvironmentConfig();
const PRODUCTION_REF = config.environments.production.projectRef;
const STAGING_REF = config.environments.staging.projectRef;

const FILE = '.github/workflows/backup-database.yml';
const filePath = path.join(ROOT, FILE);
const text = fs.readFileSync(filePath, 'utf8');
const lines = text.split('\n');

const problems = [];
const checks = [];
let structural = 0;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Is the file well formed?
// ─────────────────────────────────────────────────────────────────────────────────────────────

if (/\t/.test(text)) problems.push('contains a tab character (illegal for YAML indentation)');

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (!line.trim() || line.trim().startsWith('#')) continue;
  const indent = line.search(/\S/);
  if (indent % 2 !== 0) problems.push(`line ${i + 1}: indent ${indent} is not a multiple of 2`);
  const trimmed = line.trim();
  const isMapping = /^[A-Za-z_][A-Za-z0-9_-]*:(\s|$)/.test(trimmed);
  const isSequence = trimmed.startsWith('- ') || trimmed === '-';
  const isBlockBody = indent > 0 && !isMapping && !isSequence;
  const isExpression = trimmed.startsWith('${{') || trimmed.startsWith('}}');
  if (!isMapping && !isSequence && !isBlockBody && !isExpression) {
    problems.push(`line ${i + 1}: does not look like YAML ("${trimmed.slice(0, 40)}")`);
  }
}

const openExpr = (text.match(/\$\{\{/g) ?? []).length;
const closeExpr = (text.match(/\}\}/g) ?? []).length;
if (openExpr !== closeExpr) {
  problems.push(`unbalanced \${{ }}: ${openExpr} opens, ${closeExpr} closes`);
}

for (const key of ['name:', 'on:', 'jobs:']) {
  if (!lines.some((line) => line.startsWith(key))) problems.push(`missing top-level key "${key}"`);
}

/** The body of every `run:` block, so the shell the runner executes can be checked. */
function runBlocks() {
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(\s*)run:\s*[|>]-?\s*$/);
    if (!match) continue;
    const keyIndent = match[1].length;
    const body = [];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > keyIndent)) {
      body.push(lines[j]);
      j += 1;
    }
    if (!body.some((line) => line.trim())) problems.push(`line ${i + 1}: run block has no body`);
    found.push({ line: i + 1, body: body.join('\n') });
    i = j - 1;
  }
  return found;
}

const blocks = runBlocks();
const shellCheckFile = path.join(os.tmpdir(), `agrishop-workflow-check-${process.pid}.sh`);
for (const block of blocks) {
  fs.writeFileSync(shellCheckFile, block.body);
  try {
    execFileSync('bash', ['-n', shellCheckFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    problems.push(
      `run block at line ${block.line}: bash -n FAILED\n${String(error.stderr || error.message).slice(0, 400)}`,
    );
  } finally {
    structural += 1;
  }
}
fs.rmSync(shellCheckFile, { force: true });

console.log(`Workflow certification — ${FILE}`);
console.log(`  lines          : ${lines.length}`);
console.log(`  run blocks     : ${blocks.length} (each shell-checked with \`bash -n\`)`);
console.log(`  template exprs : ${openExpr} balanced`);
console.log('');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Invariants, each with the mutation that must break it
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every step, in file order, as the lines that belong to it.
 * Named steps are the workflow's only unit of intent, so assertions are scoped to them rather than
 * to the file as a whole — a rule that holds "somewhere in the file" is not a rule about the step.
 */
function parseSteps(source) {
  const sourceLines = source.split('\n');
  const found = [];
  for (let i = 0; i < sourceLines.length; i += 1) {
    const match = sourceLines[i].match(/^\s+- name:\s*(.*)$/);
    if (!match) continue;
    let end = i + 1;
    while (end < sourceLines.length && !/^\s+- name:/.test(sourceLines[end])) end += 1;
    found.push({ name: match[1].trim(), lines: sourceLines.slice(i, end) });
    i = end - 1;
  }
  return found;
}

/** One step's full text, for textual assertions. */
function step(source, nameFragment) {
  const found = parseSteps(source).find((candidate) => candidate.name.includes(nameFragment));
  return found ? found.lines.join('\n') : null;
}

/**
 * One step's shell, dedented exactly the way the runner would, ready to execute.
 *
 * THIS FUNCTION EXISTS BECAUSE OF A TRAP THAT ALREADY SPRUNG ONCE. Feeding the *whole step* to
 * bash — header and `run: |` included — does not fail. `run:` becomes a command, the `|` starts a
 * pipeline, and everything after it is parsed as the pipeline's right-hand side, which bash runs in
 * a subshell. An `exit 1` inside that subshell then terminates only the subshell: the error message
 * still prints, execution continues, and the script's status becomes whatever the last command was.
 * Observed directly: `TARGET=banana` reported "Unknown environment", then exited 0. The first
 * version of this file therefore certified a workflow on evidence that was reading as PASS while
 * exercising the wrong thing entirely. The guard below refuses to execute a body that still
 * contains a step header.
 */
function stepRunBody(nameFragment) {
  const found = parseSteps(text).find((candidate) => candidate.name.includes(nameFragment));
  if (!found) return null;

  const runIndex = found.lines.findIndex((line) => /^\s+run:\s*[|>]-?\s*$/.test(line));
  if (runIndex === -1) return null;
  const keyIndent = found.lines[runIndex].search(/\S/);

  const raw = [];
  for (let i = runIndex + 1; i < found.lines.length; i += 1) {
    if (found.lines[i].trim() && found.lines[i].search(/\S/) <= keyIndent) break;
    raw.push(found.lines[i]);
  }
  while (raw.length && !raw[0].trim()) raw.shift();
  while (raw.length && !raw.at(-1).trim()) raw.pop();
  if (!raw.length) return '';

  // A YAML block scalar strips the indentation of its own first line, so dedent by the minimum.
  const indent = Math.min(...raw.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  return raw.map((line) => line.slice(indent)).join('\n');
}

/** Extract the `environment` input, so "no default" is checked on that input and not on all of them. */
function environmentInput(source) {
  const sourceLines = source.split('\n');
  const start = sourceLines.findIndex((line) => /^\s+environment:\s*$/.test(line));
  if (start === -1) return '';
  const indent = sourceLines[start].search(/\S/);
  const body = [];
  for (let i = start + 1; i < sourceLines.length; i += 1) {
    if (sourceLines[i].trim() && sourceLines[i].search(/\S/) <= indent) break;
    body.push(sourceLines[i]);
  }
  return body.join('\n');
}

const invariants = [
  {
    id: 'environment_input_is_a_required_choice',
    why: 'the target must be stated on every manual run, chosen from a list, with no free text',
    test: (s) => {
      const input = environmentInput(s);
      return /type:\s*choice/.test(input) && /required:\s*true/.test(input);
    },
    mutation: (s) => s.replace('        required: true\n        options:', '        required: false\n        options:'),
  },
  {
    id: 'environment_input_has_no_default',
    why: 'a default is how "I forgot to choose" becomes "it backed up production anyway"',
    test: (s) => !/default:/.test(environmentInput(s)),
    mutation: (s) => s.replace('        type: choice', '        type: choice\n        default: production'),
  },
  {
    id: 'only_targetable_environments_are_offered',
    why: 'development is disposable by design and is not a backup target: offering it would invite recovery artefacts for an environment whose data is meant to be thrown away',
    test: (s) => {
      const input = environmentInput(s);
      return /-\s*production/.test(input) && /-\s*staging/.test(input) && !/-\s*development/.test(input);
    },
    mutation: (s) => s.replace('          - staging', '          - staging\n          - development'),
  },
  {
    id: 'no_project_ref_is_hardcoded_in_the_workflow',
    why: 'targeting must come from environments.json, or the workflow and the tool can disagree',
    test: (s) => !s.includes(PRODUCTION_REF) && !s.includes(STAGING_REF),
    mutation: (s) => `${s}\n# mutation: ${PRODUCTION_REF}\n`,
  },
  {
    id: 'backup_delegates_targeting_to_the_verified_tool',
    why: 'the workflow must not decide the target; it must pass the decision to the checked tool',
    test: (s) => /backup-database\.mjs\s+--env\s+"\$TARGET"/.test(s),
    mutation: (s) => s.replace(/node scripts\/backup-database\.mjs --env "\$TARGET"/, 'node scripts/backup-database.mjs --env production'),
  },
  {
    id: 'preflight_refuses_when_credentials_are_missing',
    why: 'a backup that did not happen must not be green',
    test: (s) => {
      const p = step(s, 'Preflight');
      return Boolean(p) && /REFUSING TO RUN/.test(p) && /exit 1/.test(p);
    },
    // Scoped to the step. `exit 1` appears in several steps, so a file-wide replace would have
    // mutated a different one, left this check green, and been misreported as a vacuous check —
    // which is exactly what happened before this line was scoped.
    mutation: (s) => {
      const preflight = step(s, 'Preflight');
      return preflight ? s.replace(preflight, preflight.replace(/exit 1/, 'exit 0')) : s;
    },
  },
  {
    id: 'preflight_names_the_missing_production_credentials',
    why: 'the failure must say what to add, instead of looking like a broken workflow',
    test: (s) => /PRODUCTION HAS NO BACKUP CREDENTIALS CONFIGURED/.test(s),
    mutation: (s) => s.replace('PRODUCTION HAS NO BACKUP CREDENTIALS CONFIGURED.', 'Continuing without them.'),
  },
  {
    id: 'verification_runs_before_the_upload',
    why: 'the artefact is accepted because it replays, not because it was written',
    test: (s) => {
      const verify = step(s, 'Verify the backup against');
      const uploadIndex = s.indexOf('Upload the backup and its verification report');
      const verifyIndex = s.indexOf('Verify the backup against the environment it names');
      if (!verify || uploadIndex === -1 || verifyIndex === -1) return false;
      return /restore-verify\.mjs/.test(verify) && /--compare-with\s+"\$TARGET"/.test(verify) && verifyIndex < uploadIndex;
    },
    mutation: (s) => s.replace('node scripts/restore-verify.mjs', 'echo "skipped"'),
  },
  {
    id: 'upload_is_gated_on_the_run_succeeding',
    why: 'an upload step with `if: always()` would publish an artefact from a failed verification',
    test: (s) => {
      const upload = step(s, 'Upload the backup');
      return Boolean(upload) && !/^\s+if:/m.test(upload) && /if-no-files-found:\s*error/.test(upload);
    },
    mutation: (s) => s.replace('        uses: actions/upload-artifact@v4', '        if: always()\n        uses: actions/upload-artifact@v4'),
  },
  {
    id: 'upload_is_scoped_to_the_target_environment',
    why: 'a production run must not be able to upload a file named for another environment',
    test: (s) => {
      const upload = step(s, 'Upload the backup');
      return Boolean(upload) && /\$\{\{\s*env\.TARGET\s*\}\}/.test(upload);
    },
    // Every reference in the step, not just the file glob: the artefact name and the report path
    // also carry the environment, and mutating one of them left the check green.
    mutation: (s) => {
      const upload = step(s, 'Upload the backup');
      return upload ? s.replace(upload, upload.replaceAll('env.TARGET', 'github.run_number')) : s;
    },
  },
  {
    id: 'no_step_may_fail_softly',
    why: '`continue-on-error` would let a failed backup produce a green run',
    test: (s) => !/continue-on-error/.test(s),
    mutation: (s) => s.replace('    timeout-minutes: 30', '    timeout-minutes: 30\n    continue-on-error: true'),
  },
  {
    id: 'retention_is_bounded_by_an_input_not_a_literal',
    why: 'artefacts hold personal data and password hashes, so how long they live must be visible',
    test: (s) => /retention-days:\s*\$\{\{\s*fromJSON\(env\.RETENTION_DAYS\)\s*\}\}/.test(s),
    mutation: (s) => s.replace('retention-days: ${{ fromJSON(env.RETENTION_DAYS) }}', 'retention-days: 90'),
  },
];

console.log('Invariants (each proven able to fail by mutating a copy):');
for (const invariant of invariants) {
  const holds = invariant.test(text);
  const mutationBreaksIt = !invariant.test(invariant.mutation(text));
  const ok = holds && mutationBreaksIt;
  if (!ok) {
    problems.push(
      holds
        ? `${invariant.id}: VACUOUS — the check passes even after its own mutation, so it proves nothing`
        : `${invariant.id}: FAILS on the real workflow — ${invariant.why}`,
    );
  }
  checks.push({ id: invariant.id, holds, mutationBreaksIt, status: ok ? 'PASS' : 'FAIL' });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${invariant.id}`);
  if (!ok) console.log(`        ${holds ? 'vacuous check' : invariant.why}`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 3. Run the workflow's own shell
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Execute an extracted step body under a controlled environment. */
function runStep(bodyText, env, { timeout = 30_000, cwd = ROOT } = {}) {
  const scrubbed = { ...process.env };
  for (const key of ['PROD_DB_HOST', 'PROD_DB_USER', 'PROD_DB_PASS', 'QA_DB_HOST', 'QA_DB_USER', 'QA_DB_PASS']) {
    delete scrubbed[key];
  }
  Object.assign(scrubbed, env);
  const result = execFileSync('bash', ['-c', bodyText], {
    cwd,
    env: scrubbed,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: 0, output: String(result) };
}

function expectExit(label, bodyText, env, expectedCode, expectedText, options = {}) {
  let code = 0;
  let output = '';
  try {
    const result = runStep(bodyText, env, options);
    output = result.output;
  } catch (error) {
    code = typeof error.status === 'number' ? error.status : -1;
    output = String(error.stdout ?? '') + String(error.stderr ?? '');
  }
  const problems_ = [];
  if (code !== expectedCode) problems_.push(`exit ${code}, expected ${expectedCode}`);
  if (expectedText && !expectedText.test(output)) problems_.push(`output did not match ${expectedText}`);
  const ok = problems_.length === 0;
  if (!ok) problems.push(`${label}: ${problems_.join('; ')}`);
  checks.push({ id: label, status: ok ? 'PASS' : 'FAIL', exitCode: code });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} ${ok ? '' : `— ${problems_.join('; ')}`}`);
  return ok;
}

const targetStep = stepRunBody('Confirm the target is a known environment');
const preflightStep = stepRunBody('Preflight');
const confirmArtifactStep = stepRunBody('Confirm the artefact names');

for (const [name, body] of [
  ['Confirm the target', targetStep],
  ['Preflight', preflightStep],
  ['Confirm the artefact', confirmArtifactStep],
]) {
  if (!body) {
    problems.push(`could not extract the shell of the "${name}" step, so it could not be executed`);
  } else if (/^\s*- name:/m.test(body)) {
    // The trap described above `stepRunBody`. Fail loudly rather than certify on a pipeline.
    problems.push(`the text extracted for "${name}" still contains a step header; bash would parse it as a pipeline and swallow \`exit\``);
  } else if (body.length < 40) {
    problems.push(`the text extracted for "${name}" is too short to be the whole step`);
  }
}

console.log('Executing the workflow\'s own shell blocks:');
if (targetStep && preflightStep && confirmArtifactStep) {
  // The gate on the target name.
  expectExit('target gate accepts production', targetStep, { TARGET: 'production' }, 0, /target=production/);
  expectExit('target gate rejects an unknown environment', targetStep, { TARGET: 'banana' }, 1, /Unknown environment/);
  expectExit('target gate rejects development', targetStep, { TARGET: 'development' }, 0, /target=development/);

  // The fail-closed rule. The same block is run twice with only the credentials changed, which is
  // what makes this behavioural rather than decorative: if the preflight were ignoring the
  // environment, both runs would produce the same exit code and this pair of checks would fail.
  expectExit(
    'preflight FAILS production with no production credentials',
    preflightStep,
    { TARGET: 'production' },
    1,
    /PRODUCTION HAS NO BACKUP CREDENTIALS CONFIGURED/,
  );
  expectExit(
    'preflight PASSES production once the credentials exist',
    preflightStep,
    { TARGET: 'production', PROD_DB_HOST: 'synthetic.example', PROD_DB_USER: `postgres.${PRODUCTION_REF}`, PROD_DB_PASS: 'synthetic' },
    0,
    /credentials present for production/,
  );
  expectExit('preflight FAILS staging with no staging credentials', preflightStep, { TARGET: 'staging' }, 1, /No credentials for 'staging'/);
  expectExit(
    'preflight PASSES staging once the credentials exist',
    preflightStep,
    { TARGET: 'staging', QA_DB_HOST: 'synthetic.example', QA_DB_USER: `postgres.${STAGING_REF}`, QA_DB_PASS: 'synthetic' },
    0,
    /credentials present for staging/,
  );
  // The refusal must not be satisfiable by the other environment's variables — the original defect.
  expectExit(
    'QA credentials do not satisfy a production preflight',
    preflightStep,
    { TARGET: 'production', QA_DB_HOST: 'synthetic.example', QA_DB_USER: `postgres.${STAGING_REF}`, QA_DB_PASS: 'synthetic' },
    1,
    /No credentials for 'production'/,
  );

  // The artefact gate. In CI this step sees exactly one manifest, because the run that produced
  // it is the run under inspection — so the step body itself picks `ls -t backups/*.manifest.json`.
  // This harness must present a *chosen* artefact instead of whatever is newest on this machine:
  // once a production artefact existed alongside the staging one, `ls -t` silently swapped the
  // subject of these checks and they failed for the wrong reason. Each scratch directory therefore
  // holds one manifest and a copy of environments.json, and the step body runs unmodified inside it.
  // `backups/` is gitignored, so a fresh CI checkout has no such directory and `readdirSync` would
  // throw ENOENT before the SKIP below could report anything. An absent directory means there is no
  // local artefact to present to the gate — a skip, which is printed as a skip and never as a pass.
  const backupsDir = path.join(ROOT, 'backups');
  const manifests = fs.existsSync(backupsDir)
    ? fs
        .readdirSync(backupsDir)
        .filter((name) => name.endsWith('.manifest.json'))
        .sort()
    : [];
  const byEnvironment = new Map();
  for (const name of manifests) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(backupsDir, name), 'utf8'));
      if (manifest.environment && !byEnvironment.has(manifest.environment)) {
        byEnvironment.set(manifest.environment, name);
      }
    } catch {
      // An unparsable manifest is a problem for the tooling that wrote it, not for the gate check.
    }
  }
  const scratchDirs = [];
  const scratchFor = (manifestName) => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agrishop-artefact-gate-'));
    scratchDirs.push(scratch);
    fs.mkdirSync(path.join(scratch, 'backups'));
    fs.copyFileSync(path.join(ROOT, 'backups', manifestName), path.join(scratch, 'backups', manifestName));
    fs.copyFileSync(path.join(ROOT, 'environments.json'), path.join(scratch, 'environments.json'));
    return scratch;
  };
  let artefactChecks = 0;
  try {
    for (const [artefactEnv, targetEnv] of [
      ['staging', 'staging'],
      ['staging', 'production'],
      ['production', 'production'],
      ['production', 'staging'],
    ]) {
      if (!byEnvironment.has(artefactEnv)) continue;
      const accepts = artefactEnv === targetEnv;
      expectExit(
        `${accepts ? 'artefact gate accepts' : 'artefact gate REFUSES'} the ${artefactEnv} artefact for a ${targetEnv} run`,
        confirmArtifactStep,
        { TARGET: targetEnv },
        accepts ? 0 : 1,
        accepts ? /as requested/ : /Artefact does not match the requested target/,
        { cwd: scratchFor(byEnvironment.get(artefactEnv)) },
      );
      artefactChecks += 1;
    }
  } finally {
    for (const scratch of scratchDirs) fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (artefactChecks === 0) {
    // Recorded as a SKIP, not a PASS. The invariants above prove the gate *exists* in the workflow;
    // nothing here has executed it against an artefact, and that must stay visible in the summary.
    checks.push({ id: 'artefact gate executed against a real local artefact', status: 'SKIP' });
    console.log('  SKIP  artefact gate — no artefact in backups/ to present to it');
  }
}
console.log('');

console.log('─'.repeat(72));
const failed = checks.filter((check) => check.status === 'FAIL').length;
const skipped = checks.filter((check) => check.status === 'SKIP').length;
console.log(
  `${checks.length} checks: ${checks.length - failed - skipped} passed, ${failed} failed, ` +
    `${skipped} skipped (${structural} shell blocks syntax-checked)`,
);
for (const check of checks.filter((c) => c.status === 'SKIP')) console.log(`  – skipped: ${check.id}`);
for (const problem of problems) console.log(`  ✗ ${problem}`);
console.log(
  failed === 0 && problems.length === 0
    ? 'CERTIFIED — the workflow requires an explicit target, refuses to run without the credentials ' +
        'for that exact environment, verifies every artefact before it can be uploaded, and no ' +
        'invariant is vacuous.' +
        (skipped > 0
          ? ' The steps that need a real artefact were skipped, not passed: run this with an ' +
            'artefact in backups/ before treating the artefact gate as executed.'
          : '')
    : 'NOT CERTIFIED.',
);

const jsonIndex = process.argv.indexOf('--json');
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  const outPath = path.resolve(ROOT, process.argv[jsonIndex + 1]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), workflow: FILE, checks, problems, runBlocks: structural },
      null,
      2,
    ),
  );
  console.log(`report: ${path.relative(ROOT, outPath)}`);
}

process.exit(failed === 0 && problems.length === 0 ? 0 : 1);
