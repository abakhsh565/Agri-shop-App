#!/usr/bin/env node
/**
 * trigger-production.mjs — the only code path that puts a web build into production.
 *
 * The order is deliberate and short:
 *
 *   1. Read what the trigger says: which SHA, which branch, which CI conclusion.
 *   2. Resolve main's actual head (`git ls-remote`, or an explicit override for the test harness).
 *   3. Ask `scripts/lib/deploy-gate.mjs` whether that combination is permission.
 *   4. Only if it is, ask Vercel to build *that commit* — never "the branch as it stands", which is
 *      how a deploy can silently ship a commit nobody gated.
 *
 * A missing credential, a failed CI run, a stale SHA or an unreadable trigger all exit non-zero and
 * make no request. `DRY_RUN=1` prints the plan and makes no request either: it exists so the gate can
 * be exercised on its own.
 *
 * Usage (normally from .github/workflows/deploy-production.yml):
 *   node scripts/deploy/trigger-production.mjs
 *
 * Environment:
 *   DEPLOY_EVENT        workflow_run | workflow_dispatch
 *   CI_CONCLUSION       the CI run's conclusion (workflow_run)
 *   GATED_BRANCH        the branch the CI run tested (default main)
 *   GITHUB_TOKEN        needed only for a dispatch, to read that commit's CI conclusion
 *   GITHUB_REPOSITORY   owner/repo, for the same lookup
 *   GATED_SHA           the commit to deploy
 *   MAIN_SHA            optional: main's head, for tests; otherwise resolved with git ls-remote
 *   DRY_RUN             1 = decide and print only
 *   VERCEL_TOKEN        required unless DRY_RUN=1
 *   VERCEL_PROJECT_ID   required unless DRY_RUN=1
 *   VERCEL_TEAM_ID      optional
 *   VERCEL_REPO_ID      GitHub numeric repository id (default 1345429482)
 *   VERCEL_API_BASE     default https://api.vercel.com (tests point this at a local server)
 */
import { execFileSync } from 'node:child_process';

import { deploymentBody, productionDeployDecision } from '../lib/deploy-gate.mjs';
import { ROOT } from '../lib/environments.mjs';

const env = process.env;
const dryRun = env.DRY_RUN === '1';
const event = env.DEPLOY_EVENT || 'workflow_run';
const gatedSha = (env.GATED_SHA || '').trim().toLowerCase();
const branch = env.GATED_BRANCH || 'main';

const fail = (message) => {
  console.error(`\n[DEPLOY REFUSED] ${message}\n`);
  process.exit(2);
};

/** main's head, from the remote — the only authority on what is deployable right now. */
function resolveMainSha() {
  if (env.MAIN_SHA) return env.MAIN_SHA.trim().toLowerCase();
  try {
    const out = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const line = out.split('\n').find((l) => l.trim().length);
    return line ? line.split(/\s+/)[0].trim().toLowerCase() : null;
  } catch (error) {
    console.error(`[DEPLOY] could not read origin/main: ${error.message.split('\n')[0]}`);
    return null;
  }
}

/**
 * A dispatch has no conclusion to inherit, so it asks GitHub for the CI run on that exact commit.
 * No run, or a run that is not green, is a refusal — not an invitation to deploy anyway.
 */
async function resolveConclusion() {
  if (env.CI_CONCLUSION) return env.CI_CONCLUSION;
  if (event !== 'workflow_dispatch') return null;
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !gatedSha) return null;
  const api = (env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
  const url = `${api}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${gatedSha}&per_page=1`;
  try {
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'agri-shop-release-gate',
      },
    });
    if (!res.ok) {
      console.error(`[DEPLOY] GitHub answered ${res.status} for the CI run of ${gatedSha.slice(0, 10)}`);
      return null;
    }
    const payload = await res.json();
    const run = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : null;
    if (!run) return null;
    if (run.head_branch && run.head_branch !== branch) return `${run.conclusion ?? 'unknown'} (branch ${run.head_branch})`;
    return run.conclusion ?? run.status ?? null;
  } catch (error) {
    console.error(`[DEPLOY] could not read the CI run: ${error.message}`);
    return null;
  }
}

const mainSha = resolveMainSha();
const conclusion = await resolveConclusion();
const decision = productionDeployDecision({
  event,
  conclusion,
  headBranch: branch,
  gatedSha,
  mainSha,
  tokenPresent: Boolean(env.VERCEL_TOKEN),
  projectId: env.VERCEL_PROJECT_ID || null,
  dryRun,
});

console.log(
  `\n  trigger: ${event}   branch: ${branch}   conclusion: ${conclusion || 'n/a'}\n` +
    `  gated:   ${gatedSha || '(none)'}\n  main:    ${mainSha || '(unresolved)'}\n` +
    `  mode:    ${decision.mode}`,
);

if (!decision.ok) {
  fail(decision.problems.map((p) => `  ✗ ${p}`).join('\n'));
}

if (!decision.deploy) {
  console.log('\n  DRY RUN — the gate passed and NOTHING was sent to Vercel.\n');
  process.exit(0);
}

const base = (env.VERCEL_API_BASE || 'https://api.vercel.com').replace(/\/+$/, '');
const params = new URLSearchParams({ forceNew: '1' });
if (env.VERCEL_TEAM_ID) params.set('teamId', env.VERCEL_TEAM_ID);
const url = `${base}/v13/deployments?${params.toString()}`;

const body = deploymentBody({
  projectId: env.VERCEL_PROJECT_ID,
  sha: gatedSha,
  repoId: env.VERCEL_REPO_ID || '1345429482',
});

let response;
try {
  response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VERCEL_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
} catch (error) {
  fail(`the request to Vercel did not complete: ${error.message}`);
}

const text = await response.text();
let payload = null;
try {
  payload = JSON.parse(text);
} catch {
  /* a non-JSON answer is reported below, with its status, and is a refusal */
}

if (!response.ok) {
  fail(`Vercel answered ${response.status}: ${String(payload?.error?.message ?? text).slice(0, 400)}`);
}
if (!payload?.id) {
  fail(`Vercel accepted the request (${response.status}) but returned no deployment id: ${text.slice(0, 200)}`);
}

console.log(
  `\n  DEPLOYMENT REQUESTED\n` +
    `    commit:     ${gatedSha}\n` +
    `    deployment: ${payload.id}\n` +
    `    url:        ${payload.url ? `https://${payload.url}` : '(pending)'}\n` +
    `    target:     ${payload.target ?? 'production'}\n`,
);
