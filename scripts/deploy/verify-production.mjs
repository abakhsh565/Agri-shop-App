#!/usr/bin/env node
/**
 * verify-production.mjs — wait for the deployment, prove production serves it, and roll back if not.
 *
 * The deploy workflow used to end where Vercel's answer begins: `trigger-production.mjs` POSTs a
 * deployment and exits 0 as soon as the build is *accepted*. That is not a release. Measured on
 * 2026-10-18, run 39125119857 reported `success` after 16 seconds, while the build was still
 * running; a build that failed, or one that promoted a page that no longer renders, would have been
 * recorded as a production release.
 *
 * WHAT THIS SCRIPT DOES, IN ORDER
 *   1. Waits for the deployment to be READY with its alias assigned, or ERROR/CANCELED, or a bounded
 *      timeout. READY without an alias is still pending: traffic has not moved. A timeout is a
 *      failure, not "probably fine".
 *   2. Fetches the production URL and checks it is the app: 200, HTML, the SPA shell markers, and
 *      the `X-Content-Type-Options` header `vercel.json` declares. A 200 error page is not a pass.
 *      It also compares the entry bundle (`/assets/index-<hash>.js`) with the one the deployment's
 *      own immutable URL serves: Vercel's edge cache IGNORES the query string (measured 2026-10-19:
 *      a fresh `?release=` still answered `X-Vercel-Cache: HIT`, `Age: 7729`), so a page that looks
 *      healthy can still be the *previous* build. That case waits for the alias to move and then
 *      fails — it is never reported as a release.
 *      The reference is MANDATORY and fails closed: if the deployment's own URL cannot be read
 *      (behind Vercel Deployment Protection, an HTTP error, a timeout) or exposes no entry bundle,
 *      the release fails. Page-shell checks alone never certify a release, because a cached previous
 *      page passes every one of them. Protection is not worked around here — a 401/403 is reported,
 *      not bypassed.
 *   3. If the deployment went live and the page is wrong, returns production to the newest earlier
 *      promoted deployment (`POST /v1/projects/{id}/rollback/{deploymentId}` — success is 201, any
 *      2xx is accepted), waits for that deployment to be live again, and still exits non-zero —
 *      containment, not success.
 *   4. If the rollback endpoint refuses (its reference lists a 402 error, but Vercel does not
 *      document what causes one, so no plan rule is assumed), it redeploys the previous deployment
 *      as production (`POST /v13/deployments` with `deploymentId`, `name`, `project`, `target`) and
 *      waits for that instead. The refusal becomes a slower rollback, never an unhandled failure
 *      with production left broken.
 *   5. Containment is claimed only when the production domain is OBSERVED serving the previous
 *      deployment's entry bundle. Vercel documents that a rollback turns off automatic production
 *      domain assignment, so a READY rollback target can sit behind a domain still serving the bad
 *      build; in that case the run says the rollback is unconfirmed and names the operator's next
 *      step, rather than reporting containment it did not measure.
 *   6. If the build failed, production still serves the previous deployment; nothing is rolled back
 *      and the script says so.
 *
 * WHY `node:http` AND NOT `fetch`
 *   Measured on this checkout (Windows, Node 24): `fetch` followed by `process.exit()` aborts with
 *   `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` (exit 0xC0000409), and waiting for the
 *   event loop instead hangs on Undici's keep-alive sockets. A verification script that cannot exit
 *   with the code it decided is worse than no verification. One-shot `http`/`https` requests with
 *   `agent: false` exit cleanly with the intended code on both platforms.
 *
 * Environment:
 *   DEPLOYMENT_ID            required — the id `trigger-production.mjs` reported
 *   DEPLOYMENT_URL           the deployment's own immutable URL, as reported by the trigger; used
 *                            as the entry-bundle reference when the GET response omits `url`
 *   GATED_SHA                the commit that was gated (recorded in the summary)
 *   VERCEL_TOKEN             required
 *   VERCEL_PROJECT_ID        required
 *   VERCEL_TEAM_ID           optional
 *   VERCEL_PROJECT_NAME      default agri-shop-app (used only by the redeploy fallback)
 *   VERCEL_API_BASE          default https://api.vercel.com (tests point this at a local server)
 *   SMOKE_URL                default https://hisaabkitaab.dpdns.org (the production domain)
 *   SMOKE_MARKERS            default `<div id="root">|/assets/` (pipe-separated substrings)
 *   DEPLOYMENT_URL_SCHEME    default https — how the deployment's own `url` is reached (tests use http)
 *   ALIAS_WAIT_SECONDS       default 120 — how long production may keep serving the previous build
 *   TIMEOUT_SECONDS          default 600 — how long the build may take before this fails
 *   POLL_SECONDS             default 10
 *   ROLLBACK_TIMEOUT_SECONDS default 300 — how long a rollback or its redeploy fallback may take
 *   REFERENCE_TIMEOUT_MS     default 20000 — how long the deployment's own immutable URL may take to
 *                            answer; a protected deployment answers 401/403 rather than timing out
 *
 * Exit codes: 0 = verified live; 1 = release not verified (contained when it had gone live);
 * 2 = refused before doing anything (missing configuration).
 *
 * No credential is printed. The token only ever appears in the Authorization header.
 */
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

import {
  deploymentDecision,
  deploymentKey,
  entryAsset,
  previousPromoted,
  referenceProblems,
  restorationProblems,
  rollbackDecision,
  smokeProblems,
  staleServing,
} from '../lib/deploy-verify.mjs';

const env = process.env;
const apiBase = (env.VERCEL_API_BASE || 'https://api.vercel.com').replace(/\/+$/, '');
const deploymentId = (env.DEPLOYMENT_ID || '').trim();
// `trigger-production.mjs` reports the deployment's own immutable URL from the POST response. The
// single-deployment GET does not document `url`, so without this the entry-bundle comparison would
// be silently skipped whenever the response omits it — exactly the check a cached release needs.
const reportedUrl = (env.DEPLOYMENT_URL || '').trim();
const projectId = (env.VERCEL_PROJECT_ID || '').trim();
const projectName = (env.VERCEL_PROJECT_NAME || 'agri-shop-app').trim();
const teamId = (env.VERCEL_TEAM_ID || '').trim();
const token = (env.VERCEL_TOKEN || '').trim();
const gatedSha = (env.GATED_SHA || '').trim();
const smokeUrl = (env.SMOKE_URL || 'https://hisaabkitaab.dpdns.org').replace(/\/+$/, '');
const markers = (env.SMOKE_MARKERS || '<div id="root">|/assets/')
  .split('|')
  .map((marker) => marker.trim())
  .filter(Boolean);
const timeoutSeconds = Number(env.TIMEOUT_SECONDS || 600);
const pollSeconds = Number(env.POLL_SECONDS || 10);
const rollbackTimeoutSeconds = Number(env.ROLLBACK_TIMEOUT_SECONDS || 300);
const aliasWaitSeconds = Number(env.ALIAS_WAIT_SECONDS || 120);
const deploymentScheme = (env.DEPLOYMENT_URL_SCHEME || 'https').replace(/:\/+$/, '');
// The reference read is a hard gate now, so its timeout is configurable: a hung deployment URL must
// fail the release quickly and repeatably instead of stretching the job.
const referenceTimeoutMs = Number(env.REFERENCE_TIMEOUT_MS || 20_000);

const summary = (text) => {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch {
    /* the step summary is a convenience; losing it must not change the result */
  }
};

/** Configuration that makes verification impossible: nothing was checked. */
const refuse = (message) => {
  console.error(`\n[RELEASE VERIFICATION REFUSED] ${message}\n`);
  summary(`### Release verification refused\n\n${message}\n`);
  process.exit(2);
};

/** The release was checked and the answer is no. */
const failRelease = (message) => {
  console.error(`\n[RELEASE NOT VERIFIED] ${message}\n`);
  summary(`### Release NOT verified\n\n${message}\n`);
  process.exit(1);
};

const missing = [
  !deploymentId && 'DEPLOYMENT_ID',
  !projectId && 'VERCEL_PROJECT_ID',
  !token && 'VERCEL_TOKEN',
].filter(Boolean);

if (missing.length) {
  // Before touching the network: an unverifiable release is a refusal, not a warning.
  refuse(`missing configuration: ${missing.join(', ')}. Nothing was checked and nothing was rolled back.`);
}

/**
 * One request, one socket (`agent: false`), bounded by its own timeout. Resolves — never throws —
 * so a network failure is a reported refusal rather than an unhandled rejection.
 */
function request(target, { method = 'GET', headers = {}, body = null, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch (error) {
      resolve({ status: 0, headers: {}, text: '', error: `invalid URL: ${error.message}` });
      return;
    }

    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          accept: 'application/json',
          connection: 'close',
          ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
          ...headers,
        },
        agent: false,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers ?? {}, text, error: null }),
        );
      },
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', (error) => resolve({ status: 0, headers: {}, text: '', error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const query = (params) => {
  const search = new URLSearchParams(params);
  if (teamId) search.set('teamId', teamId);
  const text = search.toString();
  return text ? `?${text}` : '';
};

const apiHeaders = { authorization: `Bearer ${token}` };

async function readJson(pathname) {
  const result = await request(`${apiBase}${pathname}`, { headers: apiHeaders });
  let parsed = null;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    parsed = null;
  }
  return { ...result, payload: parsed };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll one deployment until it is live or failed. Returns the last deployment and decision seen;
 * `pending` means the deadline passed, which the caller treats as a failure.
 */
async function waitForReady(id, label, seconds = timeoutSeconds) {
  const deadline = Date.now() + seconds * 1000;
  let deployment = null;
  let decision = { outcome: 'pending', problems: [] };

  while (Date.now() < deadline) {
    const read = await readJson(`/v13/deployments/${encodeURIComponent(id)}${query({})}`);

    if (read.error) {
      console.error(`  [${label}] the Vercel API did not answer: ${read.error}`);
      await sleep(pollSeconds * 1000);
      continue;
    }
    if (read.status !== 200 || !deploymentKey(read.payload)) {
      return {
        deployment,
        decision: {
          outcome: 'failed',
          problems: [
            `the Vercel API answered ${read.status}${
              read.status === 200 ? ' without a deployment id (expected `id` or `uid`)' : ''
            } for ${id}`,
          ],
        },
      };
    }

    deployment = read.payload;
    decision = deploymentDecision(deployment);
    console.log(
      `  [${label}] ${deployment.readyState || deployment.state}${
        decision.problems.length ? ` — ${decision.problems[0]}` : ''
      }`,
    );
    if (decision.outcome !== 'pending') return { deployment, decision };

    await sleep(pollSeconds * 1000);
  }

  return { deployment, decision };
}

console.log(
  `\n  verifying deployment ${deploymentId}${gatedSha ? ` for ${gatedSha.slice(0, 10)}` : ''}\n` +
    `  smoke target:     ${smokeUrl}\n` +
    `  timeout:          ${timeoutSeconds}s (poll every ${pollSeconds}s)\n`,
);

// ── 1. Wait for a state that means traffic moved ──────────────────────────────────────────────
const { deployment, decision } = await waitForReady(deploymentId, 'poll');

if (!deployment) {
  failRelease(
    `the deployment ${deploymentId} could not be read before the ${timeoutSeconds}s deadline ` +
      `(${decision.problems[0] ?? 'no answer'}).`,
  );
}

if (decision.outcome === 'pending') {
  failRelease(
    `the deployment did not reach READY with its alias assigned within ${timeoutSeconds}s ` +
      `(last state: ${deployment.readyState || deployment.state || 'unknown'}). The build may still be ` +
      'running — re-run this workflow, or check the Vercel dashboard. NOT verified.',
  );
}

const deploymentReady = decision.outcome === 'ready';

if (decision.outcome === 'failed') {
  console.error(`\n  ✗ ${decision.problems[0]}`);
  const rollback = rollbackDecision({ deploymentReady, smokeOk: false, previous: null });
  console.error(`  ${rollback.reason}`);
  summary(
    `### Release failed\n\n- commit: \`${gatedSha || 'unknown'}\`\n- deployment: \`${deploymentId}\`\n` +
      `- state: \`${deployment.readyState || deployment.state}\`\n- ${decision.problems[0]}\n- ${rollback.reason}\n`,
  );
  process.exit(1);
}

console.log(`  ✓ deployment READY and its production alias assigned (${deployment.url ?? 'no url'})`);

// ── 2. Prove the production URL serves the app, and serves THIS deployment ────────────────────
//
// The reference is the deployment's own immutable URL: whatever entry bundle it serves is what
// production must serve. Without it, a healthy-looking page cached from the previous deployment
// would pass (see `staleServing` in scripts/lib/deploy-verify.mjs).
/** A deployment `url` field, as an origin to fetch. */
const hostFor = (value) =>
  value
    ? (/^https?:\/\//.test(value) ? value : `${deploymentScheme}://${value}`).replace(/\/+$/, '')
    : null;

const referenceUrl = deployment.url || reportedUrl;
const deploymentHost = hostFor(referenceUrl);

if (!deploymentHost) {
  failRelease(
    "neither the deployment response nor the trigger reported the deployment's own URL, so the entry " +
      'bundle it built cannot be established. Page-shell checks alone do not prove production serves this ' +
      'build — NOT verified, and nothing was rolled back.',
  );
}

// FAIL CLOSED. The entry-bundle comparison is the only check that tells "production serves this build"
// from "production serves a cached copy of the previous one", and every page-shell check passes on the
// cached page. So an unreadable reference is a failure, never a downgrade to shell-only verification.
const referenceRead = await request(`${deploymentHost}/`, {
  headers: { 'cache-control': 'no-cache' },
  timeoutMs: referenceTimeoutMs,
});
const referenceIssues = referenceProblems({
  status: referenceRead.status,
  headers: referenceRead.headers,
  body: referenceRead.text,
  error: referenceRead.error,
});

if (referenceIssues.length) {
  for (const issue of referenceIssues) console.error(`  [smoke] ${issue}`);
  // No rollback here, deliberately: an unreadable reference is a measurement failure, not evidence
  // that production serves the wrong build. Moving the production alias on no evidence would be the
  // more destructive error, so the run refuses and names what is missing.
  failRelease(
    `${referenceIssues[0]}. Production was NOT certified for this deployment and no rollback was attempted. ` +
      (referenceRead.status === 401 || referenceRead.status === 403
        ? 'Vercel Deployment Protection is answering this job: supply an approved bypass credential ' +
          '(for example a Vercel Automation Bypass secret) or verify the deployment by another approved path.'
        : 'Check that the deployment URL answers an HTML page with its /assets/index-<hash>.js bundle, then re-run.'),
  );
}

const deploymentBody = referenceRead.text;
const builtEntry = entryAsset(deploymentBody);
console.log(`  deployment built ${builtEntry}`);

const probeProduction = () =>
  request(`${smokeUrl}/?release=${encodeURIComponent(deploymentId)}`, {
    headers: { accept: 'text/html;q=0.9,*/*;q=0.1', 'cache-control': 'no-cache' },
  });

const smokeProblemsOf = (response) =>
  response.error
    ? [`the production URL could not be fetched: ${response.error}`]
    : smokeProblems(
        {
          status: response.status,
          contentType: String(response.headers['content-type'] ?? ''),
          body: response.text,
          headers: response.headers,
        },
        { markers },
      );

let smoke = await probeProduction();
let problems = smokeProblemsOf(smoke);
let servedWrongBuild = false;

// A promoted deployment can take a moment to be served everywhere. Wait for the entry bundle to
// change, but only within a bounded window: past it, production is serving another build and that
// is a failure, not a slow release.
const aliasDeadline = Date.now() + aliasWaitSeconds * 1000;
while (problems.length === 0 && builtEntry) {
  const stale = staleServing(smoke.text, deploymentBody);
  if (stale.length === 0) break;
  if (Date.now() >= aliasDeadline) {
    problems = stale;
    servedWrongBuild = true;
    break;
  }
  console.log(`  … production still serves the previous build; waiting up to ${aliasWaitSeconds}s for the alias`);
  await sleep(pollSeconds * 1000);
  smoke = await probeProduction();
  problems = smokeProblemsOf(smoke);
}

if (problems.length === 0) {
  console.log(
    `  ✓ ${smokeUrl} serves the app (HTTP 200, app shell present, headers in effect${
      builtEntry ? `, entry ${builtEntry}` : ''
    })`,
  );
  summary(
    `### Released and verified\n\n- commit: \`${gatedSha || 'unknown'}\`\n- deployment: \`${deploymentId}\`\n` +
      `- url: ${smokeUrl}\n- state: READY, alias assigned\n` +
      `- smoke: HTTP 200, app shell and security headers present${builtEntry ? `, entry \`${builtEntry}\` served` : ''}\n`,
  );
  process.exit(0);
}

console.error(
  `\n  ✗ the deployment is live but production ${
    servedWrongBuild ? 'still serves a different build' : 'does not serve this deployment'
  }:`,
);
for (const problem of problems) console.error(`    - ${problem}`);

// ── 3. Contain: return production to the previous promoted deployment ────────────────────────
let previous = null;
// `/v7/deployments` is the version whose reference documents all four filters. The filters are not
// trusted to be exclusive either: `previousPromoted` re-checks target and state client-side.
const list = await readJson(
  `/v7/deployments${query({ projectId, target: 'production', state: 'READY', limit: '10' })}`,
);
if (list.error) console.error(`  [rollback] could not list deployments: ${list.error}`);
else if (list.status !== 200) console.error(`  [rollback] the deployment list answered ${list.status}`);
else previous = previousPromoted(list.payload?.deployments, deploymentId);
const previousId = deploymentKey(previous);

const rollback = rollbackDecision({ deploymentReady, smokeOk: false, previous });
console.error(`  ${rollback.reason}`);

/**
 * What the previous deployment built, or why that cannot be known. A READY rollback target proves the
 * deployment is live in Vercel; it proves nothing about the domain, so its own URL is read for the
 * entry bundle production is supposed to show.
 */
const previousBuild = async () => {
  const host = hostFor(previous?.url);
  if (!host) return { entry: null, why: 'the previous deployment reports no url of its own' };
  const read = await request(`${host}/`, {
    headers: { 'cache-control': 'no-cache' },
    timeoutMs: referenceTimeoutMs,
  });
  const issues = referenceProblems({
    status: read.status,
    headers: read.headers,
    body: read.text,
    error: read.error,
  });
  if (issues.length) return { entry: null, why: issues[0] };
  return { entry: entryAsset(read.text), why: null };
};

/** Poll the production domain until it serves `entry`, or the window closes. */
const confirmRestored = async (entry) => {
  const deadline = Date.now() + aliasWaitSeconds * 1000;
  for (;;) {
    const probe = await probeProduction();
    const problems = probe.error
      ? [`the production URL could not be fetched: ${probe.error}`]
      : restorationProblems({ previousEntry: entry, productionHtml: probe.text });
    if (problems.length === 0) return [];
    if (Date.now() >= deadline) return problems;
    await sleep(pollSeconds * 1000);
  }
};

/**
 * Describe containment only as far as it was MEASURED. Vercel documents that a rollback turns off
 * automatic production-domain assignment, so a READY rollback target can sit behind a domain still
 * serving the bad build. Saying "production was returned to X" from READY alone would be a claim the
 * script never checked — and the one claim an operator must not be given after a bad release.
 */
const containmentReport = async (attempted, restored) => {
  if (restored.decision.outcome !== 'ready') {
    return (
      `the ${attempted} was requested but is not live yet ` +
      `(${restored.decision.problems[0] ?? 'still pending'}); production may still serve the failed build — ` +
      'a human is needed'
    );
  }

  const built = await previousBuild();
  if (!built.entry) {
    return (
      `a ${attempted} is READY, but ${built.why}; the production domain was not observed serving it, so ` +
      'containment is UNCONFIRMED — in Vercel, assign the production domain to a known-good deployment, ' +
      'then re-run verification'
    );
  }

  const problems = await confirmRestored(built.entry);
  if (problems.length === 0) {
    return `production is serving the previous build ${built.entry} after the ${attempted} — containment verified`;
  }

  return (
    `the ${attempted} is READY and built ${built.entry}, but the production domain is not serving it ` +
    `(${problems[0]}). A rollback turns OFF automatic production-domain assignment, so containment is ` +
    'UNCONFIRMED — in Vercel, promote or assign the production domain to a known-good deployment, then ' +
    're-run verification'
  );
};

let containment = rollback.reason;
if (rollback.rollback && previousId) {
  const target = `${apiBase}/v1/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(previousId)}${query({})}`;
  const attempt = await request(target, { method: 'POST', headers: apiHeaders });

  if (attempt.status >= 200 && attempt.status < 300) {
    const restored = await waitForReady(previousId, 'rollback', rollbackTimeoutSeconds);
    containment = await containmentReport(`rollback to ${previousId}`, restored);
  } else {
    // The rollback endpoint refused. Its reference lists a 402 error but Vercel does not document
    // what causes one, so no plan rule is assumed here — only that the supported alternative is to
    // redeploy the previous deployment as production, which becomes a slower rollback rather than an
    // unhandled failure.
    console.error(
      `  [rollback] the rollback endpoint answered ${attempt.status || attempt.error}; redeploying ${previousId}`,
    );
    const redeploy = await request(`${apiBase}/v13/deployments${query({ forceNew: '1' })}`, {
      method: 'POST',
      headers: apiHeaders,
      body: { name: projectName, project: projectId, target: 'production', deploymentId: previousId },
    });

    if (redeploy.status >= 200 && redeploy.status < 300) {
      let restoredId = null;
      try {
        restoredId = JSON.parse(redeploy.text)?.id ?? null;
      } catch {
        restoredId = null;
      }
      if (restoredId) {
        const restored = await waitForReady(restoredId, 'restore', rollbackTimeoutSeconds);
        containment = await containmentReport(`redeploy of ${previousId} (${restoredId})`, restored);
      } else {
        containment = `a redeploy of ${previousId} was accepted without an id, so production serving it is UNCONFIRMED — check the Vercel dashboard`;
      }
    } else {
      containment =
        `production may still serve the failed build: neither the rollback endpoint (${attempt.status}) ` +
        `nor the redeploy fallback (${redeploy.status || redeploy.error}) succeeded. A human is needed.`;
    }
  }
}

console.error(`  [containment] ${containment}`);

summary(
  `### Release NOT verified — production does not serve this deployment\n\n- commit: \`${gatedSha || 'unknown'}\`\n` +
    `- deployment: \`${deploymentId}\` (READY, alias assigned)\n- url: ${smokeUrl}\n` +
    `- problems:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
    `- containment: ${containment}\n`,
);

process.exit(1);
