/**
 * qaConcurrencyGuard — the one QA database accepts one writer at a time.
 *
 * WHY THIS GUARD EXISTS (measured, not anticipated)
 *   Two workflows mutate the same QA project. `ci.yml` runs the integration suites in `qa` and
 *   Playwright in `e2e`; `build-apk.yml` provisions auth sessions, runs the integration suites and
 *   drives Playwright again inside `test`. A push to `main` starts both workflows at once, and when
 *   this guard was written only vitest took the QA advisory lock, so the two could write the same
 *   fixtures simultaneously. Observed on 2026-10-14 (an APK E2E window `19:37:13–20:17:40`
 *   overlapping three CI integration jobs) and 2026-10-16 (two E2E runs `01:11:44–01:56:03` /
 *   `00:56:21–01:36:22` overlapping a QA job `00:59:35–01:11:42`), and it surfaced as failures in
 *   lanes that had nothing to do with the write — leftover `QA Security Matrix *` roles failed
 *   `accessUx`, and integration suites deleted each other's fixtures.
 *
 *   Playwright now claims the SAME lock as vitest (`tests/e2e/global-setup.ts`, released by the
 *   global teardown it returns), so the group below is no longer the only thing standing between the
 *   two runners. It still earns its place: a cancelled job releases the advisory lock only when its
 *   socket dies, and a job killed mid-suite leaves its run-owned rows behind. The lock and the group
 *   are two layers of one rule — one QA database, one writer at a time.
 *
 * THE CONTRACT THIS PINS
 *   1. Every QA-mutating job declares the SAME literal group, `qa-database`. Concurrency group
 *      names share one repository-wide namespace, so a literal repeated in two files is what makes
 *      `ci.qa`, `ci.e2e` and `apk.test` queue behind each other instead of overlapping.
 *   2. None of them may cancel a run in progress (`cancel-in-progress: false`). A job killed
 *      mid-suite leaves its run-owned rows behind (`tests/e2e/cleanupOwnership.ts`) and can strand
 *      the QA advisory lock until its socket dies — the failure this serialisation exists to stop.
 *   3. `ci.yml`'s `gates` keeps its own, separately cancellable group, so a superseded commit still
 *      cancels the cheap work without ever reaching a QA writer.
 *   4. Neither workflow reintroduces a workflow-level `concurrency` block that can cancel. That is
 *      how a same-ref supersede used to kill a running job mid-suite, no matter what the jobs
 *      declared: job-level settings cannot protect a job from its own run being cancelled.
 *
 * HOW IT READS THE WORKFLOWS
 *   As text, at fixed indentation, like the other workflow guards in this directory — no YAML
 *   parser is installed (no `yaml`/`js-yaml` under `node_modules`, no PyYAML, Ruby/Psych or Perl
 *   YAML on the machine) and a guard does not add a dependency to read its own repository.
 *   Comment lines are skipped and only a four-space job key and a six-space key inside a job's
 *   `concurrency` block are read, so a comment that mentions a group name can never satisfy an
 *   assertion. Each rule is a pure function of the lines, so the non-vacuity cases at the end can
 *   feed it a mutated copy of the real file without editing anything on disk.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..', '..');

const CI = 'ci.yml';
const APK = 'build-apk.yml';

/** The literal every QA-mutating job must share. Repository-wide, so it must not be an expression. */
const QA_GROUP = 'qa-database';

/** The jobs that touch QA, and the file each lives in. */
const QA_WRITERS: ReadonlyArray<{ file: string; job: string }> = [
  { file: CI, job: 'qa' },
  { file: CI, job: 'e2e' },
  { file: APK, job: 'test' },
];

function readWorkflow(file: string): string[] {
  return readFileSync(path.join(root, '.github/workflows', file), 'utf8').split(/\r?\n/);
}

/**
 * The event names under the workflow's top-level `on:` block.
 *
 * Same reading rule as the concurrency helpers: comment lines are dropped, so prose about a trigger
 * can never satisfy the guard, and the block ends at the next column-zero line.
 */
function triggerEvents(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.trim() === 'on:' && !line.trimStart().startsWith('#'));
  if (start === -1) throw new Error('the workflow has no `on:` block for this guard to read');
  const events: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break;
    const event = line.match(/^ {2}([a-z_]+):/);
    if (event) events.push(event[1]);
  }
  return events;
}

/**
 * Split the `jobs:` block into job id → the job's own lines.
 *
 * A job key is two-space indented and nothing else follows it on the line; a top-level non-comment
 * line ends the block. Comment and blank lines are dropped, so a comment can never be read as a
 * setting.
 */
function jobBlocks(lines: readonly string[]): Map<string, string[]> {
  const blocks = new Map<string, string[]>();
  const start = lines.findIndex((line) => line.trim() === 'jobs:' && !line.trimStart().startsWith('#'));
  if (start === -1) throw new Error('the workflow has no `jobs:` block for this guard to read');

  let id: string | null = null;
  let body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // left the jobs block
    const job = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (job) {
      if (id) blocks.set(id, body);
      id = job[1];
      body = [];
      continue;
    }
    if (id) body.push(line);
  }
  if (id) blocks.set(id, body);
  return blocks;
}

interface Concurrency {
  group: string | null;
  cancelInProgress: string | null;
}

/** A job's `concurrency` block, or null when it declares none. */
function jobConcurrency(body: readonly string[]): Concurrency | null {
  const at = body.findIndex((line) => /^ {4}concurrency:\s*$/.test(line));
  if (at === -1) return null;

  const block: Concurrency = { group: null, cancelInProgress: null };
  for (let i = at + 1; i < body.length; i++) {
    const line = body[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^ {6}/.test(line)) break; // the concurrency block ended
    const key = line.match(/^ {6}([A-Za-z-]+):\s*([^#]*?)\s*$/);
    if (!key) continue;
    if (key[1] === 'group') block.group = key[2];
    if (key[1] === 'cancel-in-progress') block.cancelInProgress = key[2];
  }
  return block;
}

/** The workflow-level `concurrency` block, or null when there is none. */
function workflowConcurrency(lines: readonly string[]): { cancelInProgress: string | null } | null {
  const at = lines.findIndex((line) => /^concurrency:\s*$/.test(line));
  if (at === -1) return null;

  let cancelInProgress: string | null = null;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // the block ended
    const key = line.match(/^ {2}([A-Za-z-]+):\s*([^#]*?)\s*$/);
    if (key && key[1] === 'cancel-in-progress') cancelInProgress = key[2];
  }
  return { cancelInProgress };
}

/**
 * Why this file's QA-mutating jobs are not protected, or null when they are.
 *
 * Returns a message naming the file and the job, because a guard that fails without saying which
 * literal drifted costs more than it saves.
 */
function writersProblem(file: string, lines: readonly string[]): string | null {
  const blocks = jobBlocks(lines);
  for (const writer of QA_WRITERS.filter((entry) => entry.file === file)) {
    const body = blocks.get(writer.job);
    if (!body) {
      return `${file}: job "${writer.job}" is gone — if it was renamed, name it here deliberately; if it was removed, remove it from QA_WRITERS. This guard would otherwise assert nothing about it.`;
    }
    const concurrency = jobConcurrency(body);
    if (!concurrency) {
      return `${file} job "${writer.job}": no job-level concurrency, so another workflow's QA job can run beside it against the same database. It must declare group: ${QA_GROUP} with cancel-in-progress: false.`;
    }
    if (concurrency.group !== QA_GROUP) {
      return `${file} job "${writer.job}": concurrency group is ${JSON.stringify(concurrency.group)}, not "${QA_GROUP}". The workflows only serialise while the literal matches, so a renamed or computed group silently removes the protection.`;
    }
    if (concurrency.cancelInProgress !== 'false') {
      return `${file} job "${writer.job}": cancel-in-progress is ${JSON.stringify(concurrency.cancelInProgress)} — a newer run would kill this QA writer mid-suite, leaving run-owned rows behind and possibly stranding the QA advisory lock.`;
    }
  }
  return null;
}

/** Why a job outside QA_WRITERS is in the QA group, or null when only the known writers are. */
function strangerProblem(file: string, lines: readonly string[]): string | null {
  for (const [job, body] of jobBlocks(lines)) {
    if (jobConcurrency(body)?.group !== QA_GROUP) continue;
    const known = QA_WRITERS.some((writer) => writer.file === file && writer.job === job);
    if (!known) {
      return `${file} job "${job}": joins the QA group but is not one of the known QA writers. If it really does mutate QA, add it to QA_WRITERS with cancel-in-progress: false; if it does not, it is serialising real work behind the database for nothing.`;
    }
  }
  return null;
}

/** Why `ci.yml`'s gate is no longer separately cancellable, or null when it is. */
function gatesProblem(lines: readonly string[]): string | null {
  const body = jobBlocks(lines).get('gates');
  if (!body) return 'ci.yml: job "gates" is gone — superseded commits would no longer cancel their cheap work.';
  const concurrency = jobConcurrency(body);
  if (!concurrency) {
    return 'ci.yml job "gates": no concurrency block, so a superseded commit keeps running the gate it no longer needs.';
  }
  if (concurrency.group !== 'ci-gates-${{ github.ref }}') {
    return `ci.yml job "gates": concurrency group is ${JSON.stringify(concurrency.group)}, not "ci-gates-\${{ github.ref }}". The gate needs its own group; sharing the QA one would serialise it behind the database.`;
  }
  if (concurrency.cancelInProgress !== 'true') {
    return `ci.yml job "gates": cancel-in-progress is ${JSON.stringify(concurrency.cancelInProgress)}; the group exists precisely so a superseded gate is cancelled.`;
  }
  return null;
}

/**
 * Why a workflow-level `concurrency` block can cancel a running QA writer, or null when it cannot.
 *
 * A block with no `cancel-in-progress` defaults to false and cannot cancel; anything else —
 * including an expression — is treated as capable, because this is a guard and failing closed is
 * the safe direction.
 */
function workflowLevelProblem(file: string, lines: readonly string[]): string | null {
  const top = workflowConcurrency(lines);
  if (!top) return null;
  const declared = top.cancelInProgress ?? 'false';
  if (declared === 'false') return null;
  return `${file}: a workflow-level concurrency block with cancel-in-progress: ${JSON.stringify(top.cancelInProgress)} cancels every running job of a superseded run — including a QA writer mid-suite. Job-level concurrency cannot protect a job from its own run being cancelled.`;
}

describe('QA concurrency guard — one QA database, one writer', () => {
  const workflows = new Map<string, string[]>([
    [CI, readWorkflow(CI)],
    [APK, readWorkflow(APK)],
  ]);

  it('every QA-mutating job shares the literal group and never cancels a run in progress', () => {
    for (const [file, lines] of workflows) {
      expect(writersProblem(file, lines), `${file}: QA concurrency protection is wrong`).toBeNull();
    }
  });

  it('no other job joins the QA group', () => {
    for (const [file, lines] of workflows) {
      expect(strangerProblem(file, lines), `${file}: an unexpected job is in the QA group`).toBeNull();
    }
  });

  it('the ci.yml gate stays separately cancellable', () => {
    expect(gatesProblem(workflows.get(CI)!)).toBeNull();
  });

  it('neither workflow has a workflow-level block that could cancel an active QA writer', () => {
    for (const [file, lines] of workflows) {
      expect(workflowLevelProblem(file, lines), `${file}: workflow-level cancellation is unsafe`).toBeNull();
    }
  });

  /**
   * NON-VACUITY. The rules above pass on the real files; these cases break a copy of the real file
   * in memory and require the same functions to complain — so a reader that stopped seeing the
   * blocks (a renamed key, a re-indented job, an appended comment) cannot make the guard quietly
   * pass. Nothing is written to disk.
   */
  describe('the guard catches the mutations it exists for (in-memory only)', () => {
    const ci = workflows.get(CI)!;

    it('a renamed group is reported by file and job', () => {
      const mutated = ci.map((line) => (line === `      group: ${QA_GROUP}` ? '      group: qa-database-old' : line));
      expect(writersProblem(CI, mutated)).toContain('job "qa"');
      expect(writersProblem(CI, mutated)).toContain(QA_GROUP);
    });

    it('a flipped cancel-in-progress is reported', () => {
      const mutated = ci.map((line) => (line === '      cancel-in-progress: false' ? '      cancel-in-progress: true' : line));
      expect(writersProblem(CI, mutated)).toContain('cancel-in-progress');
    });

    it('a removed concurrency block is reported, not ignored', () => {
      const mutated = ci.filter((line) => line !== '    concurrency:' && line !== `      group: ${QA_GROUP}` && line !== '      cancel-in-progress: false');
      expect(writersProblem(CI, mutated)).toContain('no job-level concurrency');
    });

    it('a fourth job in the QA group is reported', () => {
      const mutated = [...ci, '  extra:', '    concurrency:', `      group: ${QA_GROUP}`, '      cancel-in-progress: false'];
      expect(strangerProblem(CI, mutated)).toContain('job "extra"');
    });

    it('a workflow-level cancellable block is reported', () => {
      const mutated = ['concurrency:', '  group: whole-run', '  cancel-in-progress: true', ...ci];
      expect(workflowLevelProblem(CI, mutated)).toContain('workflow-level');
    });

    it('a gate without its own group is reported', () => {
      const mutated = ci.map((line) => (line === '      group: ci-gates-${{ github.ref }}' ? `      group: ${QA_GROUP}` : line));
      expect(gatesProblem(mutated)).toContain('gates');
    });

    it('a push trigger restored to the APK workflow is reported', () => {
      // The exact regression this guard exists for: a push to main starting this workflow's QA job
      // beside ci.yml's, which serialised the one QA database and delayed the deploy gate by up to
      // ~22 minutes (measured 2026-10-18: 22:32:26 push, 22:33:54 gates green, 22:55:27 QA start).
      const apk = workflows.get(APK)!;
      const at = apk.findIndex((line) => line.trim() === 'on:');
      const mutated = [...apk.slice(0, at + 1), '  push:', '    branches: [main]', ...apk.slice(at + 1)];
      expect(triggerEvents(mutated)).toContain('push');
      expect(triggerEvents(apk)).toEqual(['workflow_dispatch']);
    });
  });

  /**
   * ONE INTEGRATION RUN PER COMMIT.
   *
   * The two workflows share the single QA database, so two triggers for one event is two suites for
   * one commit — the second waits for the first, and the deploy gate waits behind both. The APK is an
   * artefact and is dispatched deliberately; the gate is ci.yml, and it still runs on every push to
   * main. Removing the APK's push trigger loses no check that the deploy path reads.
   */
  describe('one QA suite per commit', () => {
    const ci = readWorkflow(CI);
    const apk = readWorkflow(APK);

    it('the APK workflow is dispatch-only', () => {
      expect(triggerEvents(apk)).toEqual(['workflow_dispatch']);
    });

    it('the CI gate still runs on a push to main, and on a pull request', () => {
      const events = triggerEvents(ci);
      expect(events).toContain('push');
      expect(events).toContain('pull_request');
      expect(ci.join('\n')).toMatch(/push:\s*\r?\n\s+branches: \[main, staging-snapshot\]/);
    });
  });
});
