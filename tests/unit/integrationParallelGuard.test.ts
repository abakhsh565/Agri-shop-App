/**
 * integrationParallelGuard — the parallel group is exactly the files P4 proved, and nothing else.
 *
 * WHY THIS GUARD EXISTS (measured, not anticipated)
 *   P4 ran seven integration files with file parallelism inside ONE lock-holding vitest process:
 *   139.1s → 51.5s wall, 102/102 tests green, baseline unchanged at 6574 rows, 0 residue and 0 advisory
 *   locks held afterwards (`backups/phase3-p4-group-{serial,parallel4}-2026-10-19.log`). That result is
 *   a fact about THOSE SEVEN FILES, not about the suite: the other 36 include files that read global
 *   aggregates and files that write the shared tenant, and the suite's default is — and stays — serial
 *   (`vitest.integration.config.ts`, `fileParallelism: false`).
 *
 *   The risk this guard closes is silent widening: a later agent reads "parallel files cut wall clock by
 *   63%", adds a file to a group, and the resulting red looks like a product bug (the same failure shape
 *   the serial default was introduced to end). So the group is a frozen literal here, with the evidence
 *   that made each member safe, and the files that must stay serial are named with the reason.
 *
 * THE CONTRACT THIS PINS
 *   1. `PARALLEL_GROUP` is exactly the seven approved files; each carries a non-empty `proves` note.
 *   2. No member of `MUST_STAY_SERIAL` may enter the group. That set covers, at minimum: the global
 *      aggregate readers (`rbacEnforcement`, `rbacInvariants`, `auditIntegrity`, `agentTelemetry`), the
 *      shared-fixture writers (personas/roles in the shared tenant), `customerBalance` (reads the shared
 *      customers' money), and `resolutionMemory` (unfiltered `DELETE FROM incident_rate_limits`).
 *   3. Every classification entry names a file that exists — a stale classification is drift, not
 *      documentation.
 *   4. Files in `EXCLUSIVE_PAIRS` never run together; `incidentFoundation`/`resolutionMemory` both issue
 *      an unfiltered `DELETE FROM incident_rate_limits`.
 *   5. Unknown or unclassified files remain in the serial remainder. The shared runner and Vitest config
 *      must use this exact frozen group; repository-owned runners cannot bypass that one process/lock path.
 *
 * WHAT IT CANNOT CATCH, STATED RATHER THAN IMPLIED
 *   A guard cannot prove row-level disjointness; the source inspection recorded in
 *   `ENGINEERING_OS_STATE.md` is that evidence, and this file freezes the human decision so it cannot be
 *   widened without review. Runtime project ordering remains a Vitest behavior to verify with the runner.
 *
 * NON-VACUITY
 *   The negative cases below inject a `MUST_STAY_SERIAL` file and an unclassified file into the group
 *   and require the same predicate to complain; the filesystem case writes the injection into a temporary
 *   directory and removes it in `finally`, so the repository is never mutated by a test run.
 */
import { describe, expect, it } from 'vitest';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const INTEGRATION_DIR = 'tests/integration';

type Category = 'global-aggregate-reader' | 'shared-fixture-writer' | 'shared-row-reader' | 'shared-global-table';

const CATEGORIES: readonly Category[] = [
  'global-aggregate-reader',
  'shared-fixture-writer',
  'shared-row-reader',
  'shared-global-table',
];

/** The seven files P4 proved disjoint, each with the evidence that made it safe to overlap. */
const PARALLEL_GROUP: ReadonlyArray<{ file: string; proves: string }> = [
  {
    file: 'accountDeletion.test.ts',
    proves: 'owns shop 9c…0002, its branches/users/memberships; every write and count filtered by those ids',
  },
  {
    file: 'branchPlaceRead.test.ts',
    proves: 'owns shops 9c…00b3/9c…00b5; deletes and asserts only by those tenant ids and its own phones',
  },
  {
    file: 'customerDeletionSecurity.test.ts',
    proves: 'owns shops dad10001/dad10002; every cleanup and assertion scoped to those ids and its phones',
  },
  {
    file: 'placeLocation.test.ts',
    proves: 'owns shops 9c…00a3/9c…00a4; set_place writes customers/branches/shops by id plus one audit row',
  },
  {
    file: 'impactIntelligence.test.ts',
    proves: 'writes impact_analyses only, cleaned by its own qa_test_% names',
  },
  {
    file: 'incidentFoundation.test.ts',
    proves: 'writes incident tables only; alone in the group, so its unfiltered incident_rate_limits delete is unshared',
  },
  {
    file: 'frontendImpact.test.ts',
    proves: 'issues no SQL at all (no execSqlAsAdmin/execRpcAsUser calls), so it cannot collide',
  },
];

/**
 * Files that must stay serial. Each entry is a decision with its reason, not a convenience list: adding
 * one of these to the group is exactly the drift this guard exists to refuse.
 */
const MUST_STAY_SERIAL: Readonly<Record<string, { category: Category; reason: string }>> = {
  'rbacEnforcement.test.ts': {
    category: 'global-aggregate-reader',
    reason: 'counts orphaned memberships across ALL users/memberships (no tenant filter); any concurrent user or membership writer reddens it',
  },
  'rbacInvariants.test.ts': {
    category: 'global-aggregate-reader',
    reason: 'counts all users and probes triggers/catalogs, i.e. rows every other suite writes',
  },
  'auditIntegrity.test.ts': {
    category: 'global-aggregate-reader',
    reason: 'scans audit_events globally, and every writer inserts audit rows (0181)',
  },
  'agentTelemetry.test.ts': {
    category: 'global-aggregate-reader',
    reason: 'counts every agent_tasks/agent_attempts row rather than its own',
  },
  'securityMatrix.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'creates personas and roles in the shared tenant, which the global readers above scan',
  },
  'securityAudit.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'writes personas and roles in the shared tenant as its actors',
  },
  'employeePermissions.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'writes memberships and permission rows for employees in the shared tenant',
  },
  'employeeAccessOverrides.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'writes per-user permission overrides in the shared tenant',
  },
  'employeeInviteLifecycle.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'writes users, memberships and invitations through the invitation path in the shared tenant',
  },
  'rbacLifecycleAndSessions.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'creates and revokes roles and sessions in the shared tenant',
  },
  'rbacRoleLifecycleTargeted.test.ts': {
    category: 'shared-fixture-writer',
    reason: 'creates roles in the shared tenant',
  },
  'customerBalance.test.ts': {
    category: 'shared-row-reader',
    reason: 'reads the shared customers A/B/C money; any writer of their payments or credit changes the expected balance',
  },
  'resolutionMemory.test.ts': {
    category: 'shared-global-table',
    reason: 'issues an unfiltered DELETE FROM incident_rate_limits, the same statement incidentFoundation runs',
  },
};

/** File pairs that must never overlap, whatever else the group approves. */
const EXCLUSIVE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  [
    'incidentFoundation.test.ts',
    'resolutionMemory.test.ts',
    'both run an unfiltered DELETE FROM incident_rate_limits',
  ],
];

interface Classification {
  group: readonly string[];
  serial: Readonly<Record<string, { category: string; reason: string }>>;
  filesOnDisk: readonly string[];
  exclusivePairs?: ReadonlyArray<readonly [string, string, string]>;
}

/** The only way a file may run in parallel is being named in the frozen group; everything else is serial. */
function effectiveMode(file: string, group: readonly string[] = PARALLEL_GROUP.map((g) => g.file)): 'parallel' | 'serial' {
  return group.includes(file) ? 'parallel' : 'serial';
}

function integrationFiles(dir: string = path.join(ROOT, INTEGRATION_DIR)): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.test.ts'))
    .sort();
}

function classificationProblems(classification: Classification): string[] {
  const problems: string[] = [];
  const approved = PARALLEL_GROUP.map((entry) => entry.file);
  const seen = new Set<string>();

  for (const file of classification.group) {
    if (seen.has(file)) problems.push(`${file} appears twice in the parallel group`);
    seen.add(file);

    const serial = classification.serial[file];
    if (serial) {
      problems.push(
        `${file} is in the parallel group and classified ${serial.category} — it must stay serial: ${serial.reason}`,
      );
    }
    if (!approved.includes(file)) {
      problems.push(
        `${file} is in the parallel group but is not an approved parallel file — it needs its own disjointness proof and a reviewed guard change`,
      );
    }
    if (!classification.filesOnDisk.includes(file)) {
      problems.push(`${file} is in the parallel group but is not on disk`);
    }
  }

  for (const file of approved) {
    if (!classification.group.includes(file)) {
      problems.push(`${file} is an approved parallel file but is missing from the group`);
    }
  }

  for (const [file, entry] of Object.entries(classification.serial)) {
    if (!CATEGORIES.includes(entry.category as Category)) {
      problems.push(`${file} has unknown category "${entry.category}"`);
    }
    if (entry.reason.trim().length < 30) {
      problems.push(`${file} is classified serial without a reason that explains it`);
    }
    if (!classification.filesOnDisk.includes(file)) {
      problems.push(`${file} is classified ${entry.category} but is not on disk — the classification is stale`);
    }
  }

  for (const [a, b, why] of classification.exclusivePairs ?? []) {
    if (classification.group.includes(a) && classification.group.includes(b)) {
      problems.push(`${a} and ${b} are both in the parallel group but must never overlap: ${why}`);
    }
  }

  return problems;
}

/** A file's code, without the prose that documents the setting it is being read for. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

const RUNNER_FILES = [
  'package.json',
  'scripts/dev/verify.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/build-apk.yml',
  'vitest.integration.config.ts',
  'scripts/dev/run-integration.mjs',
  'scripts/dev/integration-parallel-group.json',
  'tests/unit/integrationParallelGuard.test.ts',
] as const;

/**
 * The shared runner is the only repository-owned way to execute integration suites and must use the
 * config that implements this frozen partition.
 */
function runnerProblems(sources: Readonly<Record<string, string>>): string[] {
  const problems: string[] = [];

  for (const [file, raw] of Object.entries(sources)) {
    // YAML comments use `#`; the JS/JSON files' comments are already handled by codeOnly.
    const code = file.endsWith('.yml') ? codeOnly(raw).replace(/#.*$/gm, '') : codeOnly(raw);
    if (['.github/workflows/ci.yml', '.github/workflows/build-apk.yml'].includes(file)) {
      if (!code.includes('node scripts/dev/run-integration.mjs')) {
        problems.push(`${file}: integration step bypasses the shared runner`);
      }
      if (/^\s*run:.*vitest.*integration/m.test(code)) {
        problems.push(`${file}: direct integration Vitest invocation bypasses the shared runner`);
      }
    }
    if (file === 'package.json') {
      const scripts = JSON.parse(raw).scripts ?? {};
      if (!String(scripts['test:integration'] ?? '').includes('scripts/dev/run-integration.mjs')) {
        problems.push('package.json test:integration bypasses the shared runner');
      }
    }
    if (file === 'scripts/dev/verify.mjs' && !code.includes("['scripts/dev/run-integration.mjs'")) {
      problems.push('scripts/dev/verify.mjs bypasses the shared runner');
    }
  }

  const config = codeOnly(sources['vitest.integration.config.ts'] ?? '');
  if (!/fileParallelism\s*:\s*false/.test(config)) {
    problems.push('vitest.integration.config.ts no longer keeps the root and remainder serial');
  }
  if (!/fileParallelism\s*:\s*true/.test(config) || !/maxWorkers\s*:\s*4/.test(config)) {
    problems.push('vitest.integration.config.ts no longer runs the measured group with four workers');
  }
  if (!/sequence:\s*\{\s*groupOrder:\s*0\s*\}/.test(config) || !/sequence:\s*\{\s*groupOrder:\s*1\s*\}/.test(config)) {
    problems.push('vitest.integration.config.ts no longer runs the parallel group before the serial remainder');
  }
  const runner = codeOnly(sources['scripts/dev/run-integration.mjs'] ?? '');
  if (!runner.includes('vitest.integration.config.ts')) {
    problems.push('scripts/dev/run-integration.mjs does not invoke the integration config');
  }
  const groupFile = JSON.parse(sources['scripts/dev/integration-parallel-group.json'] ?? '{"files":[]}');
  const declaredFiles = [...(groupFile.files ?? [])].sort();
  const guardedFiles = PARALLEL_GROUP.map((entry) => entry.file).sort();
  const configHasGroupReference = config.includes('parallelIntegrationGroup.files.map');
  if (!configHasGroupReference) problems.push('integration config no longer derives its parallel files from the frozen group');
  if (!config.includes('include: parallelFiles') || !config.includes('include: serialFiles')) {
    problems.push('integration config no longer scopes the ordered projects to their file partitions');
  }
  if (JSON.stringify(guardedFiles) !== JSON.stringify(declaredFiles)) {
    problems.push('integration-parallel-group.json differs from the independently reviewed P4 guard');
  }
  if (!runner.includes('exactly once')) {
    problems.push('scripts/dev/run-integration.mjs must enforce a complete file partition');
  }
  if (!runner.includes("'integration-measured-parallel'") || !runner.includes("'integration-serial-remainder'")) {
    problems.push('scripts/dev/run-integration.mjs must explicitly select both ordered Vitest projects');
  }
  const approvedFiles = PARALLEL_GROUP.map((entry) => entry.file).sort();
  if (JSON.stringify(declaredFiles) !== JSON.stringify(approvedFiles)) {
    problems.push('integration-parallel-group.json differs from the independently reviewed P4 classification');
  }
  for (const file of RUNNER_FILES.slice(0, 5)) {
    const source = codeOnly(sources[file] ?? '');
    if (['.github/workflows/ci.yml', '.github/workflows/build-apk.yml'].includes(file)) {
      if (!source.includes('node scripts/dev/run-integration.mjs')) {
        problems.push(`${file}: integration invocation bypasses the shared runner`);
      }
      if (/^\s*run:.*vitest.*integration/m.test(source)) {
        problems.push(`${file}: direct integration Vitest invocation bypasses the shared runner`);
      }
    } else if (file === 'package.json') {
      const scripts = JSON.parse(source).scripts ?? {};
      if (!String(scripts['test:integration'] ?? '').includes('scripts/dev/run-integration.mjs')) {
        problems.push('package.json test:integration bypasses the shared runner');
      }
    } else if (file === 'scripts/dev/verify.mjs' && !source.includes("['scripts/dev/run-integration.mjs'")) {
      problems.push('scripts/dev/verify.mjs bypasses the shared runner');
    }
  }
  return problems;
}

function readRunnerSources(): Record<string, string> {
  return Object.fromEntries(RUNNER_FILES.map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));
}

const APPROVED = PARALLEL_GROUP.map((entry) => entry.file);
const FILES_ON_DISK = integrationFiles();

describe('the parallel integration group is the one P4 proved', () => {
  it('is exactly seven files, unique, each carrying the evidence that made it safe', () => {
    expect(APPROVED).toHaveLength(7);
    expect(new Set(APPROVED).size).toBe(APPROVED.length);
    for (const entry of PARALLEL_GROUP) {
      expect(entry.proves.trim().length, `${entry.file} must state what proves it disjoint`).toBeGreaterThan(40);
    }
    expect(FILES_ON_DISK.length, 'the scan must see the integration directory').toBeGreaterThanOrEqual(43);
  });

  it('classifies the mandatory serial sets, every entry real and reasoned', () => {
    for (const required of [
      'rbacEnforcement.test.ts',
      'rbacInvariants.test.ts',
      'auditIntegrity.test.ts',
      'agentTelemetry.test.ts',
      'customerBalance.test.ts',
      'resolutionMemory.test.ts',
      'securityMatrix.test.ts',
    ]) {
      expect(MUST_STAY_SERIAL[required], `${required} must be classified serial`).toBeDefined();
    }
    for (const [file, entry] of Object.entries(MUST_STAY_SERIAL)) {
      expect(CATEGORIES, `${file} has unknown category ${entry.category}`).toContain(entry.category);
      expect(entry.reason.length, `${file} needs a reason`).toBeGreaterThan(30);
    }
  });

  it('has no approved file classified serial, and no stale classification', () => {
    expect(
      classificationProblems({
        group: APPROVED,
        serial: MUST_STAY_SERIAL,
        filesOnDisk: FILES_ON_DISK,
        exclusivePairs: EXCLUSIVE_PAIRS,
      }),
    ).toEqual([]);
  });

  it('fails closed: any file outside the group is serial', () => {
    expect(effectiveMode('brandNewUnclassified.test.ts')).toBe('serial');
    for (const file of FILES_ON_DISK) {
      if (APPROVED.includes(file)) continue;
      expect(effectiveMode(file), `${file} is not approved and must be serial`).toBe('serial');
    }
    expect(effectiveMode('accountDeletion.test.ts')).toBe('parallel');
  });
});

describe('the repository uses the bounded parallel group only through the shared runner', () => {
  it('every integration entry point uses the shared runner and the default remains serial', () => {
    expect(runnerProblems(readRunnerSources())).toEqual([]);
  });

  it('catches a runner bypass, and accepts the bounded Vitest project config (in-memory only)', () => {
    const sources = readRunnerSources();
    const injected = {
      ...sources,
      '.github/workflows/ci.yml': sources['.github/workflows/ci.yml'].replace(
        'node scripts/dev/run-integration.mjs',
        'npx vitest run --config vitest.integration.config.ts --fileParallelism=true',
      ),
    };
    expect(runnerProblems(injected)).toEqual(
      expect.arrayContaining([expect.stringContaining('bypasses the shared runner')]),
    );

    const unchanged = { ...sources };
    expect(runnerProblems(unchanged)).toEqual([]);
  });
});

describe('the guard rejects an injected group member (in memory)', () => {
  it('refuses a must-stay-serial file with its own reason', () => {
    const problems = classificationProblems({
      group: [...APPROVED, 'securityMatrix.test.ts'],
      serial: MUST_STAY_SERIAL,
      filesOnDisk: FILES_ON_DISK,
      exclusivePairs: EXCLUSIVE_PAIRS,
    });
    expect(problems.join('\n')).toContain('securityMatrix.test.ts');
    expect(problems.join('\n')).toContain('must stay serial');
  });

  it('refuses an unclassified file', () => {
    const problems = classificationProblems({
      group: [...APPROVED, 'brandNewUnclassified.test.ts'],
      serial: MUST_STAY_SERIAL,
      filesOnDisk: FILES_ON_DISK,
      exclusivePairs: EXCLUSIVE_PAIRS,
    });
    expect(problems.join('\n')).toContain('brandNewUnclassified.test.ts');
    expect(problems.join('\n')).toContain('not an approved parallel file');
  });

  it('refuses both members of an exclusive pair', () => {
    const problems = classificationProblems({
      group: [...APPROVED, 'resolutionMemory.test.ts'],
      serial: MUST_STAY_SERIAL,
      filesOnDisk: FILES_ON_DISK,
      exclusivePairs: EXCLUSIVE_PAIRS,
    });
    expect(problems.join('\n')).toContain('must never overlap');
  });

  it('refuses a group that drops an approved file', () => {
    const problems = classificationProblems({
      group: APPROVED.slice(0, 6),
      serial: MUST_STAY_SERIAL,
      filesOnDisk: FILES_ON_DISK,
      exclusivePairs: EXCLUSIVE_PAIRS,
    });
    expect(problems.join('\n')).toContain('missing from the group');
  });
});

describe('the guard rejects an injected file on disk, and restores it even on failure', () => {
  it('sees the injected file, refuses it as a group member, and is serial by default', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qa-parallel-guard-'));
    try {
      for (const file of APPROVED) copyFileSync(path.join(ROOT, INTEGRATION_DIR, file), path.join(dir, file));
      writeFileSync(path.join(dir, 'zzInjectedUnclassified.test.ts'), '// injected, never a real test\nexport {};\n');

      const filesOnDisk = integrationFiles(dir);
      expect(filesOnDisk).toContain('zzInjectedUnclassified.test.ts');

      // The approved seven alone are clean against this directory.
      expect(
        classificationProblems({ group: APPROVED, serial: {}, filesOnDisk, exclusivePairs: [] }),
      ).toEqual([]);

      // The same directory plus the injected file in the group is refused.
      const problems = classificationProblems({
        group: [...APPROVED, 'zzInjectedUnclassified.test.ts'],
        serial: {},
        filesOnDisk,
        exclusivePairs: [],
      });
      expect(problems.join('\n')).toContain('zzInjectedUnclassified.test.ts');
      expect(problems.join('\n')).toContain('not an approved parallel file');

      // And fail-closed: the injected file is serial when nobody approves it.
      expect(effectiveMode('zzInjectedUnclassified.test.ts')).toBe('serial');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir), 'the injected directory must be gone').toBe(false);
  });
});
