import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const AUDIT = path.join(ROOT, 'scripts/dev/audit-fixture-ownership.mjs');
const AFFECTED_E2E = path.join(ROOT, 'scripts/dev/affected-e2e.mjs');

function runAudit(cwd: string) {
  return spawnSync(process.execPath, [AUDIT, '--strict'], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function runAffectedE2e(files: string[]) {
  return spawnSync(process.execPath, [AFFECTED_E2E, '--files', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function specs(output: string): string[] {
  return output.trim().split(/\s+/).filter(Boolean);
}

function allSpecs(): string[] {
  return specs(spawnSync(process.execPath, [AFFECTED_E2E, '--all'], { cwd: ROOT, encoding: 'utf8' }).stdout);
}

function withFixtureProject(run: (cwd: string) => void) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'agrishop-fixture-ownership-'));
  try {
    const integration = path.join(cwd, 'tests/integration');
    mkdirSync(integration, { recursive: true });
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
  expect(existsSync(cwd), 'the synthetic fixture project must be removed').toBe(false);
}

describe('CI E2E selection', () => {
  it('runs only a directly changed E2E spec', () => {
    const result = runAffectedE2e(['tests/e2e/accessUx.spec.ts']);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(specs(result.stdout)).toEqual(['tests/e2e/accessUx.spec.ts']);
  });

  it('combines a changed spec with the lanes reached by changed application source', () => {
    const result = runAffectedE2e(['tests/e2e/accessUx.spec.ts', 'src/lib/biometric.ts']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(specs(result.stdout)).toContain('tests/e2e/accessUx.spec.ts');
    expect(specs(result.stdout)).toContain('tests/e2e/fingerprintUnlock.spec.ts');
    expect(specs(result.stdout).length).toBeLessThan(allSpecs().length);
  });

  it('keeps shared helpers and fixture/setup changes on the full suite', () => {
    const all = allSpecs();
    for (const file of ['tests/e2e/helpers.ts', 'tests/e2e/base.ts', 'tests/setup/fixtures.ts']) {
      const result = runAffectedE2e([file]);
      expect(result.status, `${file}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(specs(result.stdout)).toEqual(all);
    }
  });

  it('uses lane dependencies for source changes and the full suite for unmapped changes', () => {
    const mapped = runAffectedE2e(['src/lib/biometric.ts']);
    expect(mapped.status, mapped.stdout + mapped.stderr).toBe(0);
    expect(specs(mapped.stdout)).toContain('tests/e2e/fingerprintUnlock.spec.ts');
    expect(specs(mapped.stdout).length).toBeLessThan(allSpecs().length);

    const unmapped = runAffectedE2e(['package.json']);
    expect(unmapped.status, unmapped.stdout + unmapped.stderr).toBe(0);
    expect(specs(unmapped.stdout)).toEqual(allSpecs());
  });
});

describe('integration fixture-ownership audit', () => {
  it('keeps agent telemetry cleanup limited to task ids created by that file', () => {
    const relative = 'tests/integration/agentTelemetry.test.ts';
    const source = readFileSync(path.join(ROOT, relative), 'utf8');
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');

    expect(code, 'telemetry cleanup must never delete by a broad description predicate').not.toMatch(
      /DELETE\s+FROM\s+agent_tasks\s+WHERE\s+description\s+LIKE/i,
    );
    expect(code, 'tasks created by the file must be tracked for cleanup by id').toMatch(/ownedTaskIds\.add\(taskId\)/);
    expect(code, 'cleanup must delete only registered task ids').toMatch(/DELETE\s+FROM\s+agent_tasks\s+WHERE\s+id\s+IN/i);

    // Non-vacuity: this is the exact broad delete that previously erased any matching QA task.
    expect("await sql(`DELETE FROM agent_tasks WHERE description LIKE '%QA Test%'`);").toMatch(
      /DELETE\s+FROM\s+agent_tasks\s+WHERE\s+description\s+LIKE/i,
    );
  });

  it('keeps the real integration directory free of RISK findings', () => {
    const result = runAudit(ROOT);
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toMatch(/files:\s+\d+\s+OK:\s+\d+\s+WARN:\s+\d+\s+RISK:\s+0/);
  });

  it('fails closed when a suite indexes an unowned branch row', () => {
    withFixtureProject((cwd) => {
      writeFileSync(
        path.join(cwd, 'tests/integration/borrowedBranch.test.ts'),
        'const warehouseBranch = branches.rows[1];\n',
      );

      const result = runAudit(cwd);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('tests/integration/borrowedBranch.test.ts');
      expect(result.stdout).toContain('reads branches by row position');
      expect(result.stderr).toContain('1 file(s) assert against rows they do not own');
    });
  });

  it('fails closed when a telemetry suite cleans tasks by a broad description', () => {
    withFixtureProject((cwd) => {
      writeFileSync(
        path.join(cwd, 'tests/integration/agentTelemetry.test.ts'),
        "await sql(`DELETE FROM agent_tasks WHERE description LIKE '%QA Test%'`);\n",
      );

      const result = runAudit(cwd);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('tests/integration/agentTelemetry.test.ts');
      expect(result.stdout).toContain('deletes agent tasks by description rather than ids owned by this file');
      expect(result.stderr).toContain('1 file(s) assert against rows they do not own');
    });
  });

  it('fails closed when a suite silently falls back to a shared branch', () => {
    withFixtureProject((cwd) => {
      writeFileSync(
        path.join(cwd, 'tests/integration/sharedFallback.test.ts'),
        'const selectedBranch = branches.rows[0] ?? mainBranch;\n',
      );

      const result = runAudit(cwd);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('tests/integration/sharedFallback.test.ts');
      expect(result.stdout).toContain('reads branches by row position');
      expect(result.stdout).toContain('falls back to a shared branch when the list is short');
    });
  });
});
