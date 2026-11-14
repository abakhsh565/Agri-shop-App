#!/usr/bin/env node
/**
 * mark-release.mjs — record that a verified commit is live, in the error reporter's release timeline.
 *
 * WHY THIS EXISTS
 *   Error reporting without a release timeline answers "something is broken". The questions an
 *   operator actually asks are "since when?" and "did it start with the deploy five minutes ago?".
 *   `src/lib/errorReporting.ts` tags every event with the commit the bundle was built from; this
 *   script is the other half — it tells the vendor when that release became production, so first-seen
 *   timestamps can be read against a deploy boundary instead of against guesswork.
 *
 * WHERE IT RUNS
 *   In `release-timeline.yml`, which is triggered by `deploy-production.yml` **concluding success** —
 *   and only for a run whose deployment was verified. It is deliberately not a step inside the deploy
 *   workflow: a marker for a release that never went live would be a timeline that lies, and the
 *   deploy workflow's conclusion has to mean one thing (shipped and verified), so monitoring may not
 *   colour it. A manual deploy is recorded by dispatching `release-timeline.yml` with that sha.
 *
 * FAILING CLOSED, AND VISIBLY
 *   The release has already shipped and been verified by the time this runs, so a vendor outage must
 *   not be reported as a failed release — that is why it does not live in the deploy workflow. Here,
 *   a missing token or a rejected request exits non-zero and writes the reason, so the timeline's own
 *   workflow is red and says "the boundary is missing". That is the difference between "the marker
 *   did not record" and "production is broken".
 *
 * WHAT IT SENDS
 *   Release: `agrishop-app@<commit>` — the same name `vite.config.ts` gives its source-map upload, so
 *   stacks and deploys line up.
 *   Deploy: `{ environment: production, name: <vercel deployment id>, url: <production domain> }`.
 *   Nothing about a customer, a shop, or a request is included. The auth token only ever appears in
 *   the Authorization header and is never printed.
 *
 * IDEMPOTENCY
 *   Re-running a dispatch for the same commit is normal. The release create tolerates "already
 *   exists", and a deploy whose name is already recorded for that environment is skipped, so a retry
 *   adds no duplicate entries to the timeline.
 *
 * Environment:
 *   SENTRY_AUTH_TOKEN   required — an org token with project:releases
 *   SENTRY_ORG          required — organization slug
 *   SENTRY_PROJECT      required — project slug
 *   GATED_SHA           required — the commit that is live (falls back to RELEASE_ID)
 *   SENTRY_ENVIRONMENT  default production
 *   SENTRY_URL          default https://sentry.io (tests point this at a local server)
 *   DEPLOYMENT_ID       optional — the Vercel deployment id, used as the deploy's name
 *   SMOKE_URL           optional — the domain customers use, recorded as the deploy URL
 *   DRY_RUN=1           decide and print only; send nothing
 *
 * Exit codes: 0 = recorded (or dry run); 1 = could not record; 2 = refused (missing configuration).
 */

import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** The release name prefix. Kept in step with src/lib/errorReporting.ts (RELEASE_PREFIX). */
export const RELEASE_PREFIX = 'agrishop-app@';

const SHA = /^[A-Za-z0-9._-]{1,60}$/;

/**
 * Decide what to send. Pure: every input is passed in, so the acceptance rules are testable without
 * a network or an environment.
 */
export function markerPlan(env = {}) {
  const token = String(env.SENTRY_AUTH_TOKEN ?? '').trim();
  const org = String(env.SENTRY_ORG ?? '').trim();
  const project = String(env.SENTRY_PROJECT ?? '').trim();
  const environment = String(env.SENTRY_ENVIRONMENT ?? 'production').trim() || 'production';
  const base = String(env.SENTRY_URL ?? 'https://sentry.io').trim().replace(/\/+$/, '');
  const rawRelease = String(env.GATED_SHA ?? env.RELEASE_ID ?? '').trim();
  const dryRun = String(env.DRY_RUN ?? '') === '1';

  const missing = [
    !token && 'SENTRY_AUTH_TOKEN',
    !org && 'SENTRY_ORG',
    !project && 'SENTRY_PROJECT',
    !rawRelease && 'GATED_SHA',
  ].filter(Boolean);

  if (missing.length) {
    return {
      ok: false,
      code: 2,
      reason: `missing configuration: ${missing.join(', ')}. Nothing was recorded.`,
      requests: [],
      release: null,
      environment,
      dryRun,
    };
  }

  if (!SHA.test(rawRelease)) {
    return {
      ok: false,
      code: 2,
      reason: `GATED_SHA "${rawRelease.slice(0, 80)}" is not a commit-ish value. Nothing was recorded.`,
      requests: [],
      release: null,
      environment,
      dryRun,
    };
  }

  if (!/^https?:\/\//.test(base)) {
    return {
      ok: false,
      code: 2,
      reason: `SENTRY_URL "${base}" is not an http(s) base URL. Nothing was recorded.`,
      requests: [],
      release: null,
      environment,
      dryRun,
    };
  }

  const release = `${RELEASE_PREFIX}${rawRelease}`;
  const projectPath = `/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}`;
  const releasePath = `${projectPath}/releases/${encodeURIComponent(release)}`;
  const deployName = String(env.DEPLOYMENT_ID ?? '').trim() || rawRelease;
  const deployUrl = String(env.SMOKE_URL ?? '').trim();

  return {
    ok: true,
    code: 0,
    reason: `record release ${release} in ${environment}`,
    release,
    environment,
    dryRun,
    token,
    base,
    requests: [
      {
        label: 'create the release (tolerated when it already exists)',
        method: 'POST',
        url: `${base}${projectPath}/releases/`,
        body: { version: release, projects: [project] },
      },
      {
        label: 'list existing deploys for this release',
        method: 'GET',
        url: `${base}${releasePath}/deploys/?per_page=100`,
      },
      {
        label: 'record the deploy',
        method: 'POST',
        url: `${base}${releasePath}/deploys/`,
        body: {
          environment,
          name: deployName,
          ...(deployUrl ? { url: deployUrl } : {}),
        },
        deployName,
      },
    ],
  };
}

/**
 * Which HTTP answers count as success.
 *
 * Sentry answers 201 for a new release and 400/409 with "already exists" for one it knows; both mean
 * the release is named, which is all this step needs. A 401/403 is a token problem and must not be
 * read as success — that is how a marker silently stops working.
 */
export function releaseResponseAccepted(status, body = '') {
  if (status === 200 || status === 201) return true;
  if (status === 409) return true;
  if (status === 400 && /already\s+exists|already\s+been\s+created/i.test(body)) return true;
  return false;
}

/** A deploy is created once; 200/201 are success, anything else is reported. */
export function deployResponseAccepted(status) {
  return status === 200 || status === 201;
}

const summary = (text, env) => {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  } catch {
    /* the summary is a convenience; losing it must not change the result */
  }
};

/** One request, one socket (`agent: false`). Resolves — never throws. */
function request(target, { method = 'GET', headers = {}, body = null, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch (error) {
      resolve({ status: 0, text: '', error: `invalid URL: ${error.message}` });
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
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text, error: null }));
      },
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    req.on('error', (error) => resolve({ status: 0, text: '', error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function main(env = process.env) {
  const plan = markerPlan(env);

  if (!plan.ok) {
    console.error(`\n[RELEASE MARKER REFUSED] ${plan.reason}\n`);
    summary(`### Release marker refused\n\n${plan.reason}\n`, env);
    process.exit(plan.code);
  }

  if (plan.dryRun) {
    console.log(`\n[DRY RUN] ${plan.reason}`);
    for (const step of plan.requests) {
      console.log(`  ${step.method} ${step.url}`);
      if (step.body) console.log(`        ${JSON.stringify(step.body)}`);
    }
    summary(`### Release marker — dry run\n\nWould ${plan.reason}. Nothing was sent.\n`, env);
    process.exit(0);
  }

  const headers = { authorization: `Bearer ${plan.token}` };

  const [create, list] = plan.requests;

  const created = await request(create.url, { method: create.method, headers, body: create.body });
  if (created.error) {
    console.error(`\n[RELEASE MARKER FAILED] the release could not be created: ${created.error}\n`);
    summary(`### Release marker FAILED\n\nCould not create ${plan.release}: ${created.error}\n`, env);
    process.exit(1);
  }
  if (!releaseResponseAccepted(created.status, created.text)) {
    console.error(
      `\n[RELEASE MARKER FAILED] creating ${plan.release} returned HTTP ${created.status}: ${created.text.slice(0, 300)}\n`,
    );
    summary(
      `### Release marker FAILED\n\nCreating ${plan.release} returned HTTP ${created.status}.\n`,
      env,
    );
    process.exit(1);
  }

  const existing = await request(list.url, { method: list.method, headers });
  let alreadyRecorded = false;
  if (!existing.error && existing.status === 200) {
    try {
      const deploys = JSON.parse(existing.text);
      const name = plan.requests[2].deployName;
      alreadyRecorded = Array.isArray(deploys) && deploys.some((deploy) => deploy?.name === name);
    } catch {
      /* an unreadable list is not a reason to skip recording the deploy */
    }
  }

  if (alreadyRecorded) {
    console.log(`\n[RELEASE MARKER] ${plan.release} already has a deploy named ${plan.requests[2].deployName}; nothing to add.`);
    summary(
      `### Release marker\n\n${plan.release} was already recorded as deployed to ${plan.environment}. Nothing was added.\n`,
      env,
    );
    process.exit(0);
  }

  const deploy = plan.requests[2];
  const recorded = await request(deploy.url, { method: deploy.method, headers, body: deploy.body });
  if (recorded.error || !deployResponseAccepted(recorded.status)) {
    const detail = recorded.error || `HTTP ${recorded.status}: ${recorded.text.slice(0, 300)}`;
    console.error(
      `\n[RELEASE MARKER FAILED] the deploy was not recorded (${detail}).\n` +
        `  The release shipped; error events still carry ${plan.release}, so stacks are attributable.\n` +
        `  Only the deploy boundary is missing from the timeline.\n`,
    );
    summary(
      `### Release marker FAILED — deploy boundary missing\n\n${plan.release} shipped but its deploy was not recorded (${detail}). Error events still name the release.\n`,
      env,
    );
    process.exit(1);
  }

  console.log(`\n[RELEASE MARKER] ${plan.release} is now recorded as deployed to ${plan.environment}.`);
  summary(
    `### Release marker\n\n${plan.release} recorded as deployed to ${plan.environment}${deploy.body.url ? ` (${deploy.body.url})` : ''}.\n`,
    env,
  );
  process.exit(0);
}

// Only run when invoked directly; the tests import the pure functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
