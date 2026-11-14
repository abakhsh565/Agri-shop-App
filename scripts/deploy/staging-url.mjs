#!/usr/bin/env node
/**
 * staging-url.mjs — report the live URL of the newest staging deployment.
 *
 * Staging is a Vercel **Preview** environment bound to the `staging` branch of the existing
 * project (no second project, no extra plan). Vercel builds that branch on every push because
 * `vercel.json` only disables deployments for `main` — so this script does not *create* a
 * deployment, it reports the one Vercel made, which is the only honest way to say "here is the
 * URL that now serves this commit".
 *
 * The URL is written to the GitHub step summary when GITHUB_STEP_SUMMARY is set, so the run page
 * carries a clickable link next to the commit that produced it.
 *
 * A missing credential exits non-zero: a deploy job that cannot name the deployment it just
 * published has not verified anything, and a green tick there would be a claim, not a check.
 *
 * Environment:
 *   VERCEL_TOKEN        a token that may read this project's deployments
 *   VERCEL_PROJECT_ID   prj_tWZoyuctxYUj6RiA60q1d3ZACK52
 *   VERCEL_TEAM_ID      optional
 *   STAGING_REF         the branch to report (default: staging)
 *   STAGING_SHA         the commit that was pushed (default: GITHUB_SHA)
 *   VERCEL_API_BASE     default https://api.vercel.com (tests point this at a local server)
 */
import { appendFileSync } from 'node:fs';

const API = process.env.VERCEL_API_BASE || 'https://api.vercel.com';
const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const ref = process.env.STAGING_REF || 'staging';
const sha = process.env.STAGING_SHA || process.env.GITHUB_SHA || '';

function fail(message) {
  console.error(`\n[STAGING URL] FAIL — ${message}\n`);
  process.exit(1);
}

if (!token) fail('VERCEL_TOKEN is not set, so the staging deployment cannot be named.');
if (!projectId) fail('VERCEL_PROJECT_ID is not set, so the staging deployment cannot be found.');

const query = new URLSearchParams({ projectId, limit: '20', target: 'preview' });
if (teamId) query.set('teamId', teamId);

const response = await fetch(`${API}/v6/deployments?${query.toString()}`, {
  headers: { authorization: `Bearer ${token}` },
});

if (!response.ok) {
  fail(`Vercel answered ${response.status} ${response.statusText} for the deployment list.`);
}

const body = await response.json();
const deployments = Array.isArray(body.deployments) ? body.deployments : [];

/** The branch a deployment was built from, in the shapes Vercel uses across plan tiers. */
const refOf = (deployment) =>
  deployment?.meta?.githubCommitRef ??
  deployment?.meta?.branch ??
  deployment?.gitSource?.ref ??
  null;

const candidates = deployments
  .filter((deployment) => refOf(deployment) === ref)
  .filter((deployment) => (sha ? deployment?.meta?.githubCommitSha === sha : true))
  .sort((a, b) => (b?.createdAt ?? 0) - (a?.createdAt ?? 0));

const newest = candidates[0] ?? deployments.find((deployment) => refOf(deployment) === ref);

if (!newest) {
  fail(`no ${ref} deployment exists yet — Vercel builds that branch on push; check the project's Git integration.`);
}

const state = newest?.readyState ?? newest?.state ?? 'unknown';
const url = newest?.url ? `https://${newest.url}` : null;
if (!url) fail('the newest staging deployment has no URL yet.');

const matchedSha = newest?.meta?.githubCommitSha ?? null;
const exact = sha && matchedSha ? matchedSha === sha : null;

console.log(`staging deployment: ${url}`);
console.log(`  readyState: ${state}`);
console.log(`  ref:        ${ref}`);
console.log(`  commit:     ${matchedSha ?? '(not reported by Vercel)'}${exact === false ? ' — NOT the pushed commit' : ''}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      '### Staging',
      '',
      `- URL: ${url}`,
      `- commit: \`${matchedSha ?? sha ?? 'unknown'}\``,
      `- state: \`${state}\``,
      exact === false ? '- **warning**: Vercel reported a different commit than the one pushed' : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

if (state !== 'READY') {
  console.log(`\n[STAGING URL] the newest deployment is ${state}; the URL will answer once it is READY.`);
}
