import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deploymentBody, productionDeployDecision } from '../../scripts/lib/deploy-gate.mjs';

const ROOT = path.resolve(__dirname, '../..');
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const base = {
  event: 'workflow_run' as const,
  conclusion: 'success',
  headBranch: 'main',
  gatedSha: SHA,
  mainSha: SHA,
  tokenPresent: true,
  projectId: 'prj_test',
};

describe('the production deploy decision', () => {
  it('allows a green CI run for main’s current head', () => {
    const decision = productionDeployDecision(base);
    expect(decision.problems).toEqual([]);
    expect(decision.deploy).toBe(true);
  });

  it('refuses a failed CI run, and a cancelled one, and a missing conclusion', () => {
    for (const conclusion of ['failure', 'cancelled', null, 'skipped', 'timed_out']) {
      const decision = productionDeployDecision({ ...base, conclusion });
      expect(decision.deploy, String(conclusion)).toBe(false);
      expect(decision.mode).toBe('refused');
      expect(decision.problems.join(' ')).toContain('not "success"');
    }
  });

  it('refuses a run that tested something other than main', () => {
    const decision = productionDeployDecision({ ...base, headBranch: 'production/schema-reconciliation' });
    expect(decision.deploy).toBe(false);
    expect(decision.problems.join(' ')).toContain('not "main"');
  });

  it('refuses a green run whose commit is no longer main’s head', () => {
    const decision = productionDeployDecision({ ...base, gatedSha: OTHER });
    expect(decision.deploy).toBe(false);
    expect(decision.problems.join(' ')).toContain("not main's head");
  });

  it('refuses an unreadable main head rather than guessing', () => {
    const decision = productionDeployDecision({ ...base, mainSha: null });
    expect(decision.deploy).toBe(false);
    expect(decision.problems.join(' ')).toContain('could not be resolved');
  });

  it('refuses a short or non-hex SHA', () => {
    for (const gatedSha of ['abc123', 'Z'.repeat(40), null]) {
      const decision = productionDeployDecision({ ...base, gatedSha, mainSha: gatedSha });
      expect(decision.deploy, String(gatedSha)).toBe(false);
      expect(decision.problems.join(' ')).toContain('not a full 40-character SHA');
    }
  });

  it('refuses without a token or a project — missing configuration is never a fallback', () => {
    expect(productionDeployDecision({ ...base, tokenPresent: false }).problems.join(' ')).toContain('VERCEL_TOKEN');
    expect(productionDeployDecision({ ...base, projectId: null }).problems.join(' ')).toContain('VERCEL_PROJECT_ID');
  });

  it('refuses an unknown trigger', () => {
    const decision = productionDeployDecision({ ...base, event: 'push' as never });
    expect(decision.deploy).toBe(false);
  });

  it('a dry run decides but never deploys, and needs no credentials', () => {
    const decision = productionDeployDecision({ ...base, dryRun: true, tokenPresent: false, projectId: null });
    expect(decision.ok).toBe(true);
    expect(decision.deploy).toBe(false);
    expect(decision.mode).toBe('dry-run');
  });

  it('asks Vercel to build exactly the gated commit, never "the branch"', () => {
    const body = deploymentBody({ projectId: 'prj_test', sha: SHA });
    expect(body.gitSource).toEqual({ type: 'github', repoId: '1345429482', ref: 'main', sha: SHA });
    expect(body.target).toBe('production');
    expect(JSON.stringify(body)).not.toContain('"sha":null');
  });
});

describe('the repository wiring', () => {
  it('turns off automatic production deployments for main in vercel.json', () => {
    const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    expect(config.git?.deploymentEnabled?.main).toBe(false);
  });

  it('has a deploy workflow that cannot run on a non-successful CI run', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-production.yml'), 'utf8');
    expect(workflow).toMatch(/workflow_run:/);
    expect(workflow).toMatch(/conclusion == 'success'/);
    expect(workflow).toMatch(/head_branch == 'main'/);
    expect(workflow).toContain('scripts/deploy/trigger-production.mjs');
    // Accepted is not released: the workflow must wait for the deployment and verify it, and that
    // step must be bound to the id the trigger reported (a missing output skips verification).
    expect(workflow).toContain('scripts/deploy/verify-production.mjs');
    expect(workflow).toContain("steps.trigger.outputs.deployment_id != ''");
    expect(workflow).toMatch(/DEPLOYMENT_ID: \$\{\{ steps\.trigger\.outputs\.deployment_id \}\}/);
    expect(workflow).not.toMatch(/continue-on-error:\s*true/);
    expect(workflow).not.toMatch(/\|\|\s*true/);
    expect(workflow).not.toMatch(/vercel\s+(deploy|--prod)/);
  });

  it('names the CI workflow it waits for, exactly as ci.yml names it', () => {
    // A rename on either side would leave this workflow waiting for a run that never arrives: the
    // gate would not be wrong, it would be silent. Pin the coupling.
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const ciName = /^name:\s*(.+)$/m.exec(ci)?.[1].trim();
    expect(ciName).toBeTruthy();
    const deploy = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-production.yml'), 'utf8');
    expect(deploy).toContain(`workflows: ['${ciName}']`);
    // And CI must run on a push to main, or there is no run to wait for.
    expect(ci).toMatch(/push:\s*\n\s*branches:\s*\[[^\]]*main[^\]]*\]/);
  });
});

describe('the trigger script end to end, against a local fake Vercel API', () => {
  const requests: Array<{ url: string; body: any; auth: string | undefined }> = [];
  let server: http.Server;
  let apiBase = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({ url: req.url ?? '', body: JSON.parse(body || '{}'), auth: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'dpl_fake', url: 'fake.vercel.app', target: 'production' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // Async spawn, not spawnSync: the fake API lives in this worker's event loop, and a synchronous
  // child would block the very server it is waiting for.
  const run = (env: Record<string, string>) =>
    new Promise<{ status: number | null; out: string }>((resolve) => {
      requests.length = 0;
      const child = spawn(process.execPath, ['scripts/deploy/trigger-production.mjs'], {
        cwd: ROOT,
        env: {
          ...process.env,
          DEPLOY_EVENT: 'workflow_run',
          GATED_BRANCH: 'main',
          GATED_SHA: SHA,
          MAIN_SHA: SHA,
          VERCEL_API_BASE: apiBase,
          VERCEL_PROJECT_ID: 'prj_test',
          VERCEL_TOKEN: 'test-token',
          VERCEL_REPO_ID: '1345429482',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('close', (status) => resolve({ status, out }));
    });

  it('', async () => {
    const { status, out } = await run({ CI_CONCLUSION: 'success' });
    expect(status, out).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain('/v13/deployments');
    expect(requests[0].auth).toBe('Bearer test-token');
    expect(requests[0].body.gitSource.sha).toBe(SHA);
    expect(requests[0].body.target).toBe('production');
    expect(out).toContain('DEPLOYMENT REQUESTED');
  });

  it('', async () => {
    const { status, out } = await run({ CI_CONCLUSION: 'failure' });
    expect(status).toBe(2);
    expect(requests).toHaveLength(0);
    expect(out).toContain('DEPLOY REFUSED');
  });

  it('', async () => {
    const { status } = await run({ CI_CONCLUSION: 'success', MAIN_SHA: OTHER });
    expect(status).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it('', async () => {
    const { status } = await run({ CI_CONCLUSION: 'success', VERCEL_TOKEN: '' });
    expect(status).toBe(2);
    expect(requests).toHaveLength(0);
  });

  it('', async () => {
    const { status, out } = await run({ CI_CONCLUSION: 'success', DRY_RUN: '1' });
    expect(status, out).toBe(0);
    expect(requests).toHaveLength(0);
    expect(out).toContain('DRY RUN');
  });

  it('reports the deployment id to the workflow, so the verify step can wait for it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-output-'));
    const output = path.join(dir, 'github-output');
    try {
      const { status, out } = await run({ CI_CONCLUSION: 'success', GITHUB_OUTPUT: output });
      expect(status, out).toBe(0);
      const written = fs.readFileSync(output, 'utf8');
      expect(written).toContain('deployment_id=dpl_fake');
      expect(written).toContain('deployment_url=fake.vercel.app');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
