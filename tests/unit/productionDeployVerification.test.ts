/**
 * productionDeployVerification — a release is verified, or it is not a release.
 *
 * WHY THIS FILE EXISTS
 *   The deploy workflow used to report success as soon as Vercel *accepted* the request. Measured
 *   2026-10-18, run 39125119857 was green after 16 seconds while the build was still running, so a
 *   failed build or a page that no longer renders would have been recorded as a production release.
 *   The fix has two halves, and both are tested here:
 *
 *     * pure decisions (`scripts/lib/deploy-verify.mjs`) — what counts as live, what counts as the
 *       app, and whether a rollback is possible;
 *     * the runner (`scripts/deploy/verify-production.mjs`) — driven end to end against a local
 *       fake Vercel API and a local fake production page, including the rollback request.
 *
 * THE CASES THAT MATTER
 *   A READY deployment whose alias has not moved is *pending*, not released. ERROR and CANCELED are
 *   failures. An unknown state is pending, never success. A 200 that serves an error page fails.
 *   A failed build is not rolled back (production never moved); a live-but-wrong build is, and the
 *   run still fails. With no earlier promoted deployment, the script says a human is needed instead
 *   of pretending the previous state was restored.
 *
 * No production credential, project or URL is used: the fake servers stand in for both.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  aliasAssigned,
  deploymentDecision,
  deploymentKey,
  entryAsset,
  previousPromoted,
  referenceProblems,
  restorationProblems,
  rollbackDecision,
  smokeProblems,
  staleServing,
} from '../../scripts/lib/deploy-verify.mjs';

const ROOT = path.resolve(__dirname, '../..');
const DEPLOYMENT = 'dpl_new';
const PREVIOUS = 'dpl_prev';

const APP_PAGE = (withShell = true, entry = 'index-abc.js') =>
  `<!doctype html><html><body>${
    withShell ? `<div id="root"></div><script type="module" src="/assets/${entry}"></script>` : '<h1>Application error</h1>'
  }</body></html>`;

describe('the deployment decision', () => {
  it('calls a deployment released only when it is READY and its alias was assigned', () => {
    expect(deploymentDecision({ readyState: 'READY', aliasAssigned: 1792324524091 })).toEqual({
      outcome: 'ready',
      problems: [],
    });
  });

  it('keeps a READY deployment with no alias pending — traffic has not moved', () => {
    const decision = deploymentDecision({ readyState: 'READY', aliasAssigned: null });
    expect(decision.outcome).toBe('pending');
    expect(decision.problems.join(' ')).toContain('alias');
  });

  it('reads every documented aliasAssigned shape, including the string "false"', () => {
    // Vercel's schema says boolean; its own example returns the string "false", which is truthy.
    expect(aliasAssigned({ aliasAssigned: true })).toBe(true);
    expect(aliasAssigned({ aliasAssigned: 1792324524091 })).toBe(true);
    expect(aliasAssigned({ aliasAssigned: 'true' })).toBe(true);
    expect(aliasAssigned({ aliasAssigned: '1792324524091' })).toBe(true);

    expect(aliasAssigned({ aliasAssigned: false })).toBe(false);
    expect(aliasAssigned({ aliasAssigned: 'false' })).toBe(false);
    expect(aliasAssigned({ aliasAssigned: 0 })).toBe(false);
    expect(aliasAssigned({ aliasAssigned: '0' })).toBe(false);
    expect(aliasAssigned({ aliasAssigned: '' })).toBe(false);
    expect(aliasAssigned({ aliasAssigned: null })).toBe(false);
    expect(aliasAssigned({})).toBe(false);

    expect(deploymentDecision({ readyState: 'READY', aliasAssigned: 'false' }).outcome).toBe('pending');
    expect(deploymentDecision({ readyState: 'READY', aliasAssigned: 'true' }).outcome).toBe('ready');
  });

  it('reads the identifier from either documented field', () => {
    // GET /v13/deployments/{idOrUrl} documents `id`; the v7 list example returns `uid`.
    expect(deploymentKey({ id: 'dpl_a' })).toBe('dpl_a');
    expect(deploymentKey({ uid: 'dpl_b' })).toBe('dpl_b');
    expect(deploymentKey({ uid: 'dpl_b', id: 'dpl_a' })).toBe('dpl_b');
    expect(deploymentKey({})).toBeNull();
  });

  it('treats ERROR and CANCELED as failures, with the state named', () => {
    for (const state of ['ERROR', 'CANCELED']) {
      const decision = deploymentDecision({ readyState: state });
      expect(decision.outcome, state).toBe('failed');
      expect(decision.problems.join(' ')).toContain(state);
    }
  });

  it('treats a build in progress, and an unknown state, as pending — never success', () => {
    for (const state of ['QUEUED', 'BUILDING', 'INITIALIZING', 'SOMETHING_NEW', null]) {
      const decision = deploymentDecision(state === null ? {} : { readyState: state });
      expect(decision.outcome, String(state)).toBe('pending');
    }
  });
});

describe('the smoke check', () => {
  const ok = {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: APP_PAGE(true),
    headers: { 'x-content-type-options': 'nosniff' },
  };

  it('accepts the app shell with the headers vercel.json declares', () => {
    expect(smokeProblems(ok)).toEqual([]);
  });

  it('rejects a non-200 answer, a non-HTML answer, a missing shell and missing headers', () => {
    expect(smokeProblems({ ...ok, status: 500 }).join(' ')).toContain('HTTP 500');
    expect(smokeProblems({ ...ok, contentType: 'application/json' }).join(' ')).toContain('not HTML');
    expect(smokeProblems({ ...ok, body: APP_PAGE(false) }).join(' ')).toContain('does not contain');
    expect(smokeProblems({ ...ok, headers: {} }).join(' ')).toContain('X-Content-Type-Options');
  });

  it('fails a 200 error page — the exact shape that would otherwise pass a status-only check', () => {
    const problems = smokeProblems({ ...ok, body: '<html><body>Internal Server Error</body></html>' });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('does not contain');
    expect(problems.join(' ')).toContain('root');
  });
});

/**
 * The hole this closes was measured, not imagined: on 2026-10-19 a request to production with a fresh
 * random `?release=` value was answered `X-Vercel-Cache: HIT` with `Age: 7729` and the previous
 * build's ETag. Every check above passes on that page. The only thing that distinguishes the new
 * build from the old one is the entry bundle's content hash.
 */
describe('serving the deployment, not the previous build', () => {
  it('reads the content-hashed entry bundle out of a page', () => {
    expect(entryAsset(APP_PAGE(true, 'index-COYKpw8G.js'))).toBe('/assets/index-COYKpw8G.js');
    expect(entryAsset('<html></html>')).toBeNull();
    expect(entryAsset(null)).toBeNull();
  });

  it('accepts a page that serves the deployment\'s own entry bundle', () => {
    expect(staleServing(APP_PAGE(true, 'index-new.js'), APP_PAGE(true, 'index-new.js'))).toEqual([]);
  });

  it('reports a healthy-looking page that is still the previous build', () => {
    const problems = staleServing(APP_PAGE(true, 'index-old.js'), APP_PAGE(true, 'index-new.js'));
    expect(problems.join(' ')).toContain('still serving /assets/index-old.js');
    expect(problems.join(' ')).toContain('built /assets/index-new.js');
  });

  it('reports a page with no entry bundle at all', () => {
    expect(staleServing('<div id="root"></div>', APP_PAGE(true, 'index-new.js')).join(' ')).toContain(
      'serves no entry bundle',
    );
  });

  it('makes no claim when the deployment\'s own page could not be read', () => {
    // The runner must refuse before this point (referenceProblems), so a missing reference can never
    // become a pass; this function on its own still reports nothing it cannot see.
    expect(staleServing(APP_PAGE(true, 'index-old.js'), null)).toEqual([]);
  });
});

/**
 * The reference read fails CLOSED. Every case below used to be logged as "the entry-bundle comparison
 * is skipped — only the page checks apply", and a cached previous page passes every page check. So a
 * reference that cannot be established must be a problem, and the runner must fail the release.
 */
describe('the deployment reference', () => {
  const readable = {
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: APP_PAGE(true, 'index-new.js'),
    error: null,
  };

  it('accepts a 200 page that exposes the content-hashed entry bundle', () => {
    expect(referenceProblems(readable)).toEqual([]);
  });

  it('reports a deployment behind Vercel Deployment Protection', () => {
    const problems = referenceProblems({
      status: 401,
      headers: { 'www-authenticate': 'Vercel' },
      body: '<html><title>Vercel Authentication</title></html>',
      error: null,
    });
    expect(problems.join(' ')).toContain('Vercel Deployment Protection');
    expect(problems.join(' ')).toContain('HTTP 401');
  });

  it('reports an SSO login page served with 200 as protected, not as a healthy deployment', () => {
    const problems = referenceProblems({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body><a href="https://vercel.com/sso?nonce=1">Log in</a></body></html>',
      error: null,
    });
    expect(problems.join(' ')).toContain('Vercel Deployment Protection');
  });

  it('reports an HTTP error status', () => {
    const problems = referenceProblems({ ...readable, status: 500 });
    expect(problems.join(' ')).toContain('HTTP 500');
  });

  it('reports a timeout or transport failure', () => {
    const problems = referenceProblems({ status: 0, headers: {}, body: '', error: 'timed out after 300ms' });
    expect(problems.join(' ')).toContain('could not be read');
    expect(problems.join(' ')).toContain('timed out after 300ms');
  });

  it('reports a page with no verifiable entry bundle', () => {
    const problems = referenceProblems({
      ...readable,
      body: '<html><body><div id="root"></div></body></html>',
    });
    expect(problems.join(' ')).toContain('no verifiable entry bundle');
  });
});

/** A READY rollback target is not containment: the production domain has to be observed serving it. */
describe('the containment check after a rollback', () => {
  it('accepts only the previous build\'s entry bundle on the production domain', () => {
    expect(
      restorationProblems({ previousEntry: '/assets/index-prev.js', productionHtml: APP_PAGE(true, 'index-prev.js') }),
    ).toEqual([]);
  });

  it('reports the domain still serving the bad build', () => {
    const problems = restorationProblems({
      previousEntry: '/assets/index-prev.js',
      productionHtml: APP_PAGE(true, 'index-bad.js'),
    });
    expect(problems.join(' ')).toContain('still serving /assets/index-bad.js');
    expect(problems.join(' ')).toContain('built /assets/index-prev.js');
  });

  it('reports a domain serving no entry bundle at all', () => {
    const problems = restorationProblems({
      previousEntry: '/assets/index-prev.js',
      productionHtml: '<div id="root"></div>',
    });
    expect(problems.join(' ')).toContain('serves no entry bundle');
  });

  it('reports an unreadable previous deployment as unconfirmed, with the reason', () => {
    const problems = restorationProblems({
      previousEntry: null,
      previousWhy: 'the previous deployment reports no url of its own',
      productionHtml: APP_PAGE(true, 'index-prev.js'),
    });
    expect(problems.join(' ')).toContain('could not be established');
    expect(problems.join(' ')).toContain('reports no url');
  });
});

describe('the rollback target', () => {
  const deployments = [
    { uid: DEPLOYMENT, target: 'production', readyState: 'READY', readySubstate: 'PROMOTED', createdAt: 30 },
    { uid: 'dpl_older', target: 'production', readyState: 'READY', readySubstate: 'PROMOTED', createdAt: 10 },
    { uid: PREVIOUS, target: 'production', readyState: 'READY', readySubstate: 'PROMOTED', createdAt: 20 },
    { uid: 'dpl_unaliased', target: 'production', readyState: 'READY', aliasAssigned: 'false', createdAt: 35 },
    { uid: 'dpl_preview', target: 'preview', readyState: 'READY', readySubstate: 'PROMOTED', createdAt: 40 },
    { uid: 'dpl_failed', target: 'production', readyState: 'ERROR', createdAt: 50 },
    { uid: 'dpl_building', target: 'production', readyState: 'BUILDING', createdAt: 60 },
  ];

  it('picks the newest promoted production deployment that is not the current one', () => {
    expect(previousPromoted(deployments, DEPLOYMENT)?.uid).toBe(PREVIOUS);
  });

  it('never picks the deployment being verified, a preview, or a non-READY one', () => {
    // With the newest excluded, the next newest promoted production deployment is the one below it.
    expect(previousPromoted(deployments, PREVIOUS)?.uid).toBe(DEPLOYMENT);
    expect(previousPromoted([deployments[0], deployments[4], deployments[5], deployments[6]], DEPLOYMENT)).toBeNull();
    // "false" is a string, so a truthiness check would have offered it as a rollback target.
    expect(previousPromoted(deployments, DEPLOYMENT)?.uid).not.toBe('dpl_unaliased');
    expect(previousPromoted(null, DEPLOYMENT)).toBeNull();
  });
});

describe('the rollback decision', () => {
  const previous = { uid: PREVIOUS };

  it('does not roll back a release that is serving', () => {
    expect(rollbackDecision({ deploymentReady: true, smokeOk: true, previous }).rollback).toBe(false);
  });

  it('does not roll back a build that never went live — production still serves the old one', () => {
    const decision = rollbackDecision({ deploymentReady: false, smokeOk: false, previous: null });
    expect(decision.rollback).toBe(false);
    expect(decision.reason).toContain('nothing to roll back');
  });

  it('rolls back a live deployment whose page is wrong, naming the target', () => {
    const decision = rollbackDecision({ deploymentReady: true, smokeOk: false, previous });
    expect(decision.rollback).toBe(true);
    expect(decision.reason).toContain(PREVIOUS);
  });

  it('says a human is needed when no earlier promoted deployment exists', () => {
    const decision = rollbackDecision({ deploymentReady: true, smokeOk: false, previous: null });
    expect(decision.rollback).toBe(false);
    expect(decision.reason).toContain('needs a human');
  });
});

describe('the runner end to end, against a local fake Vercel API and a local production page', () => {
  type Call = { method: string; url: string; body: any };
  const calls: Call[] = [];

  let apiServer: http.Server;
  let smokeServer: http.Server;
  let apiBase = '';
  let smokeUrl = '';

  /** Per-case behaviour, reset before each run. */
  let deploymentState: 'READY' | 'ERROR' | 'BUILDING' = 'READY';
  let aliasAssigned: number | null = 1792324524091;
  let pageOk = true;
  /** The entry bundle the deployment itself serves — the reference production must match. */
  const BUILT_ENTRY = 'index-new.js';
  /** The entry bundle the previous (rollback target) deployment built. */
  const PREVIOUS_ENTRY = 'index-prev.js';
  /** The entry bundle the production domain serves. Differs when the edge still has the old page. */
  let productionEntry = BUILT_ENTRY;
  /** What the deployment object reports as its own host; set once the smoke server has a port. */
  let deploymentUrl = '';
  /** The rollback endpoint's answer: 200 normally, 402 when the plan refuses it. */
  let rollbackStatus = 200;
  /** Which identifier the single-deployment GET returns: the documented `id`, or the legacy `uid`. */
  let idField: 'uid' | 'id' = 'uid';
  /** Whether that GET includes the deployment's own `url` (the docs do not list it). */
  let idResponseIncludesUrl = true;
  /** How the deployment's OWN immutable URL answers — the reference must be readable, or it fails. */
  let referenceMode: 'ok' | 'protected' | 'error' | 'timeout' | 'noBundle' = 'ok';
  /** How the previous deployment's own page answers during the containment check. */
  let previousMode: 'ok' | 'error' = 'ok';

  beforeEach(() => {
    deploymentState = 'READY';
    aliasAssigned = 1792324524091;
    pageOk = true;
    productionEntry = BUILT_ENTRY;
    rollbackStatus = 200;
    idField = 'uid';
    idResponseIncludesUrl = true;
    referenceMode = 'ok';
    previousMode = 'ok';
  });

  beforeAll(async () => {
    apiServer = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => handle(req, res, raw));
    });

    const handle = (req: http.IncomingMessage, res: http.ServerResponse, raw: string) => {
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      calls.push({ method: req.method ?? 'GET', url: req.url ?? '', body });

      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // The redeploy fallback: create a deployment from an existing one. The domain then serves the
      // previous build, which is what containment must be measured against.
      if (req.method === 'POST' && req.url?.startsWith('/v13/deployments')) {
        productionEntry = PREVIOUS_ENTRY;
        send(200, { id: 'dpl_restore', url: 'agri-shop-app.vercel.app', target: 'production' });
        return;
      }

      if (req.url?.startsWith('/v13/deployments/dpl_restore')) {
        send(200, {
          uid: 'dpl_restore',
          target: 'production',
          state: 'READY',
          readyState: 'READY',
          aliasAssigned: 1792324525000,
          createdAt: 200,
        });
        return;
      }

      // The rollback target is polled by id after the rollback is accepted, exactly as the real API
      // answers `GET /v13/deployments/{id}`. Without this route the fake answered 404, the rollback
      // never reached READY, and containment could never be confirmed — the script was right and the
      // double was incomplete.
      if (req.url?.startsWith(`/v13/deployments/${PREVIOUS}`)) {
        send(200, {
          id: PREVIOUS,
          uid: PREVIOUS,
          projectId: 'prj_test',
          target: 'production',
          state: 'READY',
          readyState: 'READY',
          aliasAssigned: 1792324525000,
          createdAt: 50,
        });
        return;
      }

      if (req.url?.startsWith(`/v13/deployments/${DEPLOYMENT}`)) {
        send(200, {
          [idField]: DEPLOYMENT,
          projectId: 'prj_test',
          target: 'production',
          state: deploymentState,
          readyState: deploymentState,
          aliasAssigned,
          createdAt: 100,
          ...(idResponseIncludesUrl ? { url: deploymentUrl } : {}),
        });
        return;
      }

      if (req.url?.startsWith('/v7/deployments')) {
        send(200, {
          deployments: [
            { uid: DEPLOYMENT, target: 'production', readyState: 'READY', readySubstate: 'PROMOTED', createdAt: 100 },
            {
              uid: PREVIOUS,
              target: 'production',
              readyState: 'READY',
              readySubstate: 'PROMOTED',
              createdAt: 50,
              // The containment check reads this deployment's own page to learn what production must serve.
              url: `${deploymentUrl}/previous`,
            },
          ],
        });
        return;
      }

      if (req.url?.startsWith(`/v1/projects/prj_test/rollback/${PREVIOUS}`)) {
        // A successful rollback moves the production domain back to the previous build. The script is
        // only allowed to claim containment once it has observed that on the domain itself.
        if (rollbackStatus === 200) productionEntry = PREVIOUS_ENTRY;
        send(rollbackStatus, rollbackStatus === 200 ? { status: 'ok' } : { error: { message: 'refused' } });
        return;
      }

      send(404, { error: { message: 'unexpected request in the fake API' } });
    };
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
    const apiAddress = apiServer.address();
    apiBase = `http://127.0.0.1:${typeof apiAddress === 'object' && apiAddress ? apiAddress.port : 0}`;

    // One server plays three roles: a request with `?release=` is the production domain (the cached
    // edge), `/previous` is the previous deployment's own URL, and the bare host is THIS deployment's
    // immutable URL — whose answer `referenceMode` controls.
    smokeServer = http.createServer((req, res) => {
      const url = req.url ?? '';
      const production = url.includes('release=');
      const previous = url.startsWith('/previous');

      if (!production && !previous) {
        if (referenceMode === 'timeout') return; // never answers; the client's own timeout must fire
        if (referenceMode === 'protected') {
          res.writeHead(401, { 'content-type': 'text/html', 'www-authenticate': 'Vercel' });
          res.end('<html><title>Vercel Authentication</title></html>');
          return;
        }
        if (referenceMode === 'error') {
          res.writeHead(500, { 'content-type': 'text/html' });
          res.end('<html><body>Internal Server Error</body></html>');
          return;
        }
      }

      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': pageOk ? 'nosniff' : '',
      });

      if (production) {
        res.end(APP_PAGE(pageOk, productionEntry));
        return;
      }
      if (previous) {
        res.end(previousMode === 'ok' ? APP_PAGE(true, PREVIOUS_ENTRY) : APP_PAGE(false));
        return;
      }
      res.end(referenceMode === 'noBundle' ? APP_PAGE(false) : APP_PAGE(true, BUILT_ENTRY));
    });
    await new Promise<void>((resolve) => smokeServer.listen(0, '127.0.0.1', resolve));
    const smokeAddress = smokeServer.address();
    const smokePort = typeof smokeAddress === 'object' && smokeAddress ? smokeAddress.port : 0;
    smokeUrl = `http://127.0.0.1:${smokePort}`;
    deploymentUrl = `127.0.0.1:${smokePort}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => apiServer.close(() => resolve()));
    // The timeout case leaves a socket deliberately unanswered, so it is destroyed rather than waited on.
    smokeServer.closeAllConnections?.();
    await new Promise<void>((resolve) => smokeServer.close(() => resolve()));
  });

  const run = (env: Record<string, string> = {}) =>
    new Promise<{ status: number | null; out: string }>((resolve) => {
      calls.length = 0;
      const child = spawn(process.execPath, ['scripts/deploy/verify-production.mjs'], {
        cwd: ROOT,
        env: {
          ...process.env,
          DEPLOYMENT_ID: DEPLOYMENT,
          GATED_SHA: 'c'.repeat(40),
          VERCEL_API_BASE: apiBase,
          VERCEL_PROJECT_ID: 'prj_test',
          VERCEL_TOKEN: 'test-token',
          SMOKE_URL: smokeUrl,
          DEPLOYMENT_URL_SCHEME: 'http',
          TIMEOUT_SECONDS: '5',
          POLL_SECONDS: '0',
          ALIAS_WAIT_SECONDS: '0',
          REFERENCE_TIMEOUT_MS: '2000',
          GITHUB_STEP_SUMMARY: '',
          ...env,
        },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('close', (status) => resolve({ status, out }));
    });

  it('verifies a READY deployment whose production page serves the app', async () => {
    deploymentState = 'READY';
    aliasAssigned = 1792324524091;
    pageOk = true;

    const { status, out } = await run();
    expect(status, out).toBe(0);
    expect(out).toContain('serves the app');
    expect(out).toContain(`deployment built /assets/${BUILT_ENTRY}`);
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('reads the documented `id` field, not only the legacy `uid`', async () => {
    idField = 'id';

    const { status, out } = await run();
    expect(status, out).toBe(0);
    expect(out).toContain('serves the app');
    expect(out).toContain(`deployment built /assets/${BUILT_ENTRY}`);
  });

  it('uses the trigger-reported url as the reference when the GET response omits url', async () => {
    // The single-deployment response schema documents no `url`. Without the trigger's value the
    // entry-bundle comparison would make no claim, and a cached previous build would pass.
    idResponseIncludesUrl = false;
    productionEntry = 'index-old.js';

    const { status, out } = await run({ DEPLOYMENT_URL: deploymentUrl });
    expect(status, out).toBe(1);
    expect(out).toContain('still serving /assets/index-old.js');
    expect(out).toContain('built /assets/index-new.js');
    expect(out).toContain(`returning production to ${PREVIOUS}`);
  });

  it('fails, and rolls back, when production still serves the previous build', async () => {
    // The measured shape: READY, alias assigned, page 200 + HTML + shell + nosniff — and the old
    // entry bundle, because the edge cache ignores the query string.
    pageOk = true;
    productionEntry = 'index-old.js';

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('still serving /assets/index-old.js');
    expect(out).toContain('built /assets/index-new.js');
    expect(out).toContain(`returning production to ${PREVIOUS}`);
    const rollback = calls.find((call) => call.url.startsWith(`/v1/projects/prj_test/rollback/${PREVIOUS}`));
    expect(rollback?.method).toBe('POST');
  });

  it('fails, and rolls back, when the live page is wrong', async () => {
    deploymentState = 'READY';
    aliasAssigned = 1792324524091;
    pageOk = false;

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain(`returning production to ${PREVIOUS}`);
    const rollback = calls.find((call) => call.url.startsWith(`/v1/projects/prj_test/rollback/${PREVIOUS}`));
    expect(rollback?.method).toBe('POST');
    expect(out).toContain('does not serve this deployment');
    // The production page here has no entry bundle, so the script must not claim the rollback worked.
    expect(out).toContain('UNCONFIRMED');
  });

  it('falls back to redeploying the previous deployment when the rollback endpoint refuses', async () => {
    pageOk = true;
    productionEntry = 'index-old.js';
    rollbackStatus = 402;

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('containment verified');
    expect(out).toContain('redeploy of');
    expect(out).toContain('the rollback endpoint answered 402');
    const redeploy = calls.find(
      (call) => call.method === 'POST' && call.url.startsWith('/v13/deployments?'),
    );
    expect(redeploy?.body?.deploymentId).toBe(PREVIOUS);
    expect(redeploy?.body?.target).toBe('production');
  });

  it('reports a failed build without rolling back — production never moved', async () => {
    deploymentState = 'ERROR';
    aliasAssigned = null;
    pageOk = true;

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('nothing to roll back');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('fails closed when the build outlives the timeout', async () => {
    deploymentState = 'BUILDING';
    aliasAssigned = null;
    pageOk = true;

    const { status, out } = await run({ TIMEOUT_SECONDS: '1', POLL_SECONDS: '1' });
    expect(status, out).toBe(1);
    expect(out).toContain('NOT verified');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('refuses before any request when the credential is missing', async () => {
    deploymentState = 'READY';
    aliasAssigned = 1792324524091;
    pageOk = true;

    const { status, out } = await run({ VERCEL_TOKEN: '' });
    expect(status, out).toBe(2);
    expect(out).toContain('missing configuration');
    expect(calls).toHaveLength(0);
  });

  // ── The reference read fails closed ────────────────────────────────────────────────────────
  // Each of these used to log "the entry-bundle comparison is skipped — only the page checks
  // apply", and a cached previous page passes every page check. None may report a release.

  it('fails closed, without rolling back, when the deployment URL is behind Vercel Deployment Protection', async () => {
    referenceMode = 'protected';

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('Vercel Deployment Protection');
    expect(out).toContain('no rollback was attempted');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('fails closed, without rolling back, when the deployment URL answers an HTTP error', async () => {
    referenceMode = 'error';

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('answered HTTP 500');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('fails closed, without rolling back, when the deployment URL times out', async () => {
    referenceMode = 'timeout';

    const { status, out } = await run({ REFERENCE_TIMEOUT_MS: '300' });
    expect(status, out).toBe(1);
    expect(out).toContain('could not be read');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('fails closed when the deployment page exposes no verifiable entry bundle', async () => {
    referenceMode = 'noBundle';

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('no verifiable entry bundle');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  it('fails closed when neither the deployment nor the trigger reports a url', async () => {
    idResponseIncludesUrl = false;

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('neither the deployment response nor the trigger reported');
    expect(calls.some((call) => call.url.startsWith('/v1/projects'))).toBe(false);
  });

  // ── Containment is measured, not inferred from READY ──────────────────────────────────────

  it('claims containment only after observing the previous build on the production domain', async () => {
    productionEntry = 'index-old.js';
    pageOk = true;

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('containment verified');
    expect(out).toContain(`/assets/${PREVIOUS_ENTRY}`);
  });

  it('reports containment as UNCONFIRMED when the previous deployment cannot be read', async () => {
    productionEntry = 'index-old.js';
    pageOk = true;
    previousMode = 'error';

    const { status, out } = await run();
    expect(status, out).toBe(1);
    expect(out).toContain('UNCONFIRMED');
    expect(out).toContain('was not observed serving it');
    expect(out).not.toContain('containment verified');
  });
});
