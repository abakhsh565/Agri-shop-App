/**
 * integrationSerialGuard — only the reviewed shard uses workers; the QA database lock stays exclusive.
 * *   WHY THIS GUARD EXISTS (measured by configuration, not by a run)
 *   Integration files share one QA database. Their isolation is ownership-based — each file deletes
 *   only the rows it registered — but a run with parallel FILES can still put one file's cleanup
 *   against a sibling's mid-assertion rows, and the resulting red says nothing about the product.
 *
 *   The same suite was being started under two different execution semantics:
 *
 *     `.github/workflows/ci.yml` and `build-apk.yml`   shared measured-shard runner
 *     `npm test` / `npm run test:integration`          shared measured-shard runner
 *     `scripts/dev/verify.mjs` tier 2                  shared measured-shard runner
 *
 *   So a local run and the gate could disagree with CI about whether files overlap, which is
 *   exactly the kind of divergence that turns "it passed" into a statement about the runner rather
 *   than the code. Phase-3 exit criterion EC1 is that all of them agree.
 *
 * THE CONTRACT THIS PINS
 *   1. `vitest.config.ts` does not reach the integration directory (its `include` is unit-only), so
 *      a bare `npx vitest run` cannot touch QA and `npx vitest run tests/integration` selects zero
 *      files there (measured: `npx vitest list tests/integration` lists none).
 *   2. `vitest.integration.config.ts` includes only integration tests at its root and inherits the
 *      base config. Its two ordered projects inherit the same QA run lock and staging environment:
 *      only the frozen seven-file project enables four workers; the remainder stays serial. The QA
 *      global setup runs once in the root process, before either project, and teardown follows both.
 *   3. Every repository runner invokes the shared script. Vitest's root global setup claims QA once,
 *      then ordered project groups run the seven measured files (four workers) before the serial remainder.
 *
 * WHAT IT CANNOT CATCH, STATED RATHER THAN IMPLIED
 *   The runner and config can be statically checked, but proving group order and maximum overlap still
 *   requires exercising Vitest itself. The seven-file concurrency is a previously measured bounded
 *   experiment, not a claim that the remainder can overlap safely.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INTEGRATION_CONFIG = 'vitest.integration.config.ts';
const RUNNER = 'scripts/dev/run-integration.mjs';
const PARALLEL_GROUP = 'scripts/dev/integration-parallel-group.json';

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

/**
 * The file with its comments removed, because these configs DOCUMENT the settings they declare.
 *
 * A predicate run over raw text can be satisfied by a docblock: an integration config whose setting
 * was deleted still reads as serial because the prose explains it (found by this guard's own
 * non-vacuity case, which failed for exactly that reason). Every rule below therefore reads code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Command-line tokens, with the quotes a mixed shell/YAML/JSON line may carry stripped. */
function commandTokens(command: string): string[] {
  return command
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** What the base config says about whether an unfiltered run reaches integration. */
interface BaseReach {
  includesIntegration: boolean;
}

function baseReach(source: string): BaseReach {
  const code = codeOnly(source);
  const include = /include\s*:\s*\[([^\]]*)\]/.exec(code);
  return { includesIntegration: include ? include[1].includes('tests/integration') : false };
}

/**
 * Does one command reach the integration directory, and does it use the reviewed runner?
 *
 * "Reaches" means: it names the integration config, names a path outside `tests/unit`, or names no
 * path while the base config includes integration. Any other shape — unit-only or non-vitest — cannot.
 */
function classify(command: string, base: BaseReach): { reaches: boolean; approvedRunner: boolean } {
  const tokens = commandTokens(command);
  if (!tokens.includes('vitest')) return { reaches: false, approvedRunner: true };

  const usesIntegrationConfig = tokens.some(
    (token, i) => token === '--config' && tokens[i + 1] === INTEGRATION_CONFIG,
  );
  const usesSharedRunner = tokens.some((token) => token.endsWith(RUNNER));
  const paths = tokens.filter((token) => token.startsWith('tests/'));
  const reachesIntegration =
    paths.some((p) => !/^tests\/unit(\/.*)?$/.test(p)) ||
    (paths.length === 0 && base.includesIntegration);

  return { reaches: reachesIntegration || usesIntegrationConfig, approvedRunner: !reachesIntegration || usesSharedRunner };
}

/** Rule 1: unfiltered Vitest remains unit-only, and cannot reach the QA database. */
function baseConfigProblem(source: string): string | null {
  const base = baseReach(source);
  return base.includesIntegration
    ? 'vitest.config.ts includes tests/integration, so an unfiltered run would reach QA outside the reviewed runner'
    : null;
}

/** Rule 2: the bounded integration config and shared runner preserve the root QA lock contract. */
function integrationConfigProblems(source: string): string[] {
  const problems: string[] = [];
  const code = codeOnly(source);
  const include = /include\s*:\s*\[([^\]]*)\]/.exec(code);
  if (!include) {
    if (!code.includes('include: integrationFiles')) {
      problems.push(`${INTEGRATION_CONFIG} has no include list, so what it runs cannot be reviewed`);
    }
  } else {
    if (!include[1].includes('tests/integration')) {
      problems.push(`${INTEGRATION_CONFIG} does not include tests/integration`);
    }
    if (include[1].includes('tests/unit')) {
      problems.push(
        `${INTEGRATION_CONFIG} also includes tests/unit — unit files would then run inside the QA run`,
      );
    }
  }
  const rootTestOptions = /test:\s*\{([\s\S]*?)projects:\s*\[/.exec(code)?.[1] ?? '';
  if (!/fileParallelism\s*:\s*false/.test(rootTestOptions)) {
    problems.push(`${INTEGRATION_CONFIG} no longer keeps the root default serial`);
  }
  if (!code.includes('parallelIntegrationGroup.files.map')) {
    problems.push(`${INTEGRATION_CONFIG} no longer derives the worker project from the frozen seven-file set`);
  }
  if (!code.includes('include: parallelFiles') || !code.includes('include: serialFiles')) {
    problems.push(`${INTEGRATION_CONFIG} no longer limits each ordered project to its own partition`);
  }
  if (!code.includes('integration-measured-parallel') || !code.includes('maxWorkers: 4')) {
    problems.push(`${INTEGRATION_CONFIG} no longer bounds the measured shard to four workers`);
  }
  if (!code.includes('include: integrationFiles')) {
    problems.push(`${INTEGRATION_CONFIG} root no longer discovers the full integration suite`);
  }
  if (!code.includes('integration-serial-remainder') || !code.includes('exclude: parallelFiles')) {
    problems.push(`${INTEGRATION_CONFIG} no longer runs all remaining integration files serially`);
  }
  if (!code.includes('groupOrder: 0') || !code.includes('groupOrder: 1')) {
    problems.push(`${INTEGRATION_CONFIG} no longer orders the measured shard before the serial remainder`);
  }
  if (!code.includes("from './vitest.config'")) {
    problems.push(`${INTEGRATION_CONFIG} no longer extends the base config and QA lock`);
  }
  return problems;
}

/** Rule 3a: npm scripts. `&&`-chained commands are classified one by one. */
function scriptProblems(scripts: Record<string, string>, base: BaseReach): string[] {
  const problems: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    for (const segment of command.split('&&').map((s) => s.trim()).filter(Boolean)) {
      const { reaches, approvedRunner } = classify(segment, base);
      if (reaches && !approvedRunner) {
        problems.push(`package.json script "${name}" bypasses ${RUNNER}: ${segment}`);
      }
    }
  }

  if (!(scripts.test ?? '').includes('npm run test:integration')) {
    problems.push('package.json script "test" no longer includes the complete integration runner');
  }

  // The pipeline must still RUN integration through the shared measured runner.
  if (!(scripts['test:integration'] ?? '').includes(RUNNER)) {
    problems.push(
      `package.json script "test:integration" no longer uses ${RUNNER}, so the measured shard and serial remainder are not both run`,
    );
  }
  return problems;
}

/** Vitest command arrays inside `verify.mjs` — the strings `step(...)` is given. */
function vitestSteps(source: string): string[] {
  return [...source.matchAll(/\[\s*'vitest'[^\]]*\]/g)].map((m) => m[0].replace(/\s+/g, ' '));
}

/** Rule 3b: the tier-2 gate runs units, then integration through the shared runner. */
function verifyProblems(source: string): string[] {
  const problems: string[] = [];
  const steps = vitestSteps(source);

  if (!steps.some((step) => step.includes('tests/unit'))) {
    problems.push('verify.mjs no longer runs the unit suite as its own vitest step');
  }
  if (!source.includes(RUNNER)) {
    problems.push(`verify.mjs does not invoke ${RUNNER} for tier-2 integration verification`);
  }
  return problems;
}

/**
 * Rule 3d: a runbook must not describe a bare run as "the suite".
 *
 * The release gate is prose an operator follows, so a stale command there is the same drift wearing a
 * different costume: `npx vitest run` no longer includes integration. A line that runs vitest is
 * acceptable when it names a unit path or uses the shared integration runner.
 */
function docProblems(source: string, file: string): string[] {
  const problems: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const command = line.trim();
    if (!/^(npx )?vitest run\b/.test(command)) continue;
    if (command.includes('tests/') || command.includes(INTEGRATION_CONFIG) || command.includes(RUNNER)) continue;
    problems.push(
      `${file}: "${command}" runs the base config, which is unit-only — name a path or use ` +
        `${INTEGRATION_CONFIG} (or \`npm test\` for both)`,
    );
  }
  return problems;
}

/** Rule 3c: integration workflow commands use the shared runner rather than direct Vitest. */
function workflowProblems(source: string, file: string): string[] {
  const problems: string[] = [];
  const commands = source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) => /^\s*run:/.test(line));
  const runnerSteps = commands.filter((line) => line.includes(RUNNER));
  if (!runnerSteps.length) problems.push(`${file}: no command runs integration through ${RUNNER}`);
  for (const line of commands) {
    if (/\bvitest run\b/.test(line) && /tests\/integration|vitest\.integration\.config/.test(line)) {
      problems.push(`${file}: direct integration Vitest invocation bypasses ${RUNNER}: ${line.trim()}`);
    }
  }
  return problems;
}

describe('integration files run only in the bounded, lock-protected shard', () => {
  const baseSource = read('vitest.config.ts');
  const base = baseReach(baseSource);
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const verifySource = read('scripts/dev/verify.mjs');
  const workflows = new Map<string, string>([
    ['.github/workflows/ci.yml', read('.github/workflows/ci.yml')],
    ['.github/workflows/build-apk.yml', read('.github/workflows/build-apk.yml')],
  ]);

  it('the base config cannot reach the integration directory', () => {
    expect(baseConfigProblem(baseSource)).toBeNull();
  });

  it('the integration config keeps the measured shard bounded and remainder serial', () => {
    const config = read(INTEGRATION_CONFIG);
    const group = JSON.parse(read(PARALLEL_GROUP)) as { files: string[] };
    expect(integrationConfigProblems(config)).toEqual([]);
    expect(group.files).toHaveLength(7);
  });

  it('no npm script can bypass the shared measured integration runner', () => {
    expect(scriptProblems(scripts, base)).toEqual([]);
  });

  it('the tier-2 gate runs units and integration through the shared measured runner', () => {
    expect(verifyProblems(verifySource)).toEqual([]);
  });

  it('both workflows still run integration through the shared runner', () => {
    for (const [file, source] of workflows) {
      expect(workflowProblems(source, file), `${file}: integration must use ${RUNNER}`).toEqual([]);
    }
  });

  it('the release runbook does not call a bare run "the suite"', () => {
    const file = '.claude/skills/release/SKILL.md';
    expect(docProblems(read(file), file)).toEqual([]);
  });

  /**
   * NON-VACUITY. The rules above pass on the real files; these cases break in-memory copies of those
   * files and require the same functions to complain — so a reader that stopped seeing an include
   * list, a `--config` pair or a step array cannot make the guard quietly pass. Nothing is written
   * to disk.
   */
  describe('the guard catches the drift it exists for (in-memory only)', () => {
    it('a config is judged by its code, not by the prose that explains it', () => {
      const source = read(INTEGRATION_CONFIG);
      const mutated = source.replace(/\n\s*fileParallelism: false,/, '\n');
      expect(mutated, 'the mutation must remove the root serial setting').not.toBe(source);
      expect(integrationConfigProblems(mutated)).toEqual(
        expect.arrayContaining([expect.stringContaining('default serial')]),
      );
    });

    it('a base config that re-adds integration without seriality is reported', () => {
      const mutated = baseSource.replace(
        "include: ['tests/unit/**/*.test.ts']",
        "include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']",
      );
      expect(mutated).not.toBe(baseSource);
      expect(baseConfigProblem(mutated)).toContain('tests/integration');
    });

    it('a base config that includes integration is refused even if it is globally serial', () => {
      const mutated = baseSource
        .replace(
          "include: ['tests/unit/**/*.test.ts']",
          "include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']",
        )
        .replace(
          "    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],",
          "    fileParallelism: false,\n    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],",
        );
      expect(mutated).toContain('fileParallelism: false');
      expect(baseConfigProblem(mutated)).toContain('tests/integration');
    });

    it('an integration config that forgets to extend the base config is reported', () => {
      const mutated = read(INTEGRATION_CONFIG).replace("import baseConfig from './vitest.config';", '');
      expect(integrationConfigProblems(mutated)).toEqual(
        expect.arrayContaining([expect.stringContaining('base config and QA lock')]),
      );
    });

    it('a script that bypasses the shared runner is reported', () => {
      const mutated = { ...scripts, 'test:integration': 'vitest run --config vitest.integration.config.ts' };
      expect(scriptProblems(mutated, base)).toEqual(
        expect.arrayContaining([expect.stringContaining(RUNNER)]),
      );
    });

    it('a tier-2 gate that bypasses the shared runner is reported', () => {
      const mutated = verifySource.replaceAll(RUNNER, 'scripts/dev/other-runner.mjs');
      expect(mutated).not.toBe(verifySource);
      expect(verifyProblems(mutated)).toEqual(
        expect.arrayContaining([expect.stringContaining(RUNNER)]),
      );
    });

    it('a runbook that keeps the pre-split command is reported', () => {
      const file = '.claude/skills/release/SKILL.md';
      const mutated = read(file).replace(
        'npm test                         # unit + integration; integration runs ONE FILE AT A TIME',
        'npx vitest run                   # full unit + integration suite, includes every guard',
      );
      expect(mutated, 'the mutation must restore the old command').not.toBe(read(file));
      expect(docProblems(mutated, file)).toEqual(
        expect.arrayContaining([expect.stringContaining('unit-only')]),
      );
    });

    it('a workflow step that bypasses the shared runner is reported', () => {
      const [file, source] = [...workflows.entries()][0];
      const mutated = source.replace(RUNNER, 'scripts/dev/other-runner.mjs');
      expect(mutated).not.toBe(source);
      expect(workflowProblems(mutated, file)).toEqual(
        expect.arrayContaining([expect.stringContaining(RUNNER)]),
      );
    });

    it('a direct Vitest command is rejected even while runner prose remains', () => {
      const [file, source] = [...workflows.entries()][0];
      const mutated = source.replace(
        'run: node scripts/dev/run-integration.mjs --reporter=dot',
        'run: npx vitest run --config vitest.integration.config.ts --reporter=dot',
      );
      expect(mutated).not.toBe(source);
      expect(workflowProblems(mutated, file)).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`no command runs integration through ${RUNNER}`),
          expect.stringContaining('direct integration Vitest invocation'),
        ]),
      );
    });
  });
});
