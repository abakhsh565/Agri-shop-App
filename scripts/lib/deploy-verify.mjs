/**
 * deploy-verify.mjs — the decision that turns "Vercel accepted the request" into "production serves it".
 *
 * WHY THIS EXISTS
 *   `trigger-production.mjs` stops when Vercel accepts the POST. That answer means the build was
 *   *queued*, not that it succeeded and certainly not that production serves it. Measured on
 *   2026-10-18, run 39125119857 was reported `success` in 16 seconds — before the build had finished
 *   — so a Vercel build failure (or a page that no longer renders) would have been recorded as a
 *   release. The workflow has to wait for the deployment, check the production URL, and be able to
 *   put the previous build back.
 *
 * WHY PURE FUNCTIONS
 *   Same reason as `deploy-gate.mjs`: a check that only lives inside a network script is a claim.
 *   These take plain values — a deployment object, an HTTP response description — so the negative
 *   cases (a failed build, an alias that never moved, a page that answers 200 with no app in it)
 *   are exercised without Vercel, without a clock and without production.
 *
 * THE RULES
 *   1. A release is verified only when the deployment reached READY *and* its production alias was
 *      assigned. READY with no alias means traffic has not moved.
 *   2. ERROR and CANCELED are failures. Anything else (QUEUED, BUILDING, INITIALIZING, an unknown
 *      value) is still pending — it is never treated as success, and the caller stops at its own
 *      timeout rather than waiting forever.
 *   3. The served page must be HTML, answer 200, contain the app shell markers, and carry the
 *      security headers `vercel.json` declares. A 200 that serves an error page is not a release.
 *   4. A rollback is only attempted when the new deployment actually went live and the page is
 *      wrong. A build that never promoted left the previous deployment serving; there is nothing
 *      to undo, and calling the rollback API would be noise.
 *   5. A rollback needs a concrete earlier *promoted* production deployment. If there is none, the
 *      release fails and says so — it never pretends the previous state was restored.
 */

export const FAILED_STATES = ['ERROR', 'CANCELED'];
export const PENDING_STATES = ['QUEUED', 'BUILDING', 'INITIALIZING'];

/** The state a deployment object is judged by. `readyState` is the narrower field when present. */
export function deploymentState(deployment) {
  return deployment?.readyState || deployment?.state || null;
}

/**
 * The deployment's identifier, whichever field the response schema uses.
 *
 * `GET /v13/deployments/{idOrUrl}` documents `id` (required) and its example returns `id`; the
 * `GET /v7/deployments` list example returns `uid`. A reader that insists on one spelling fails on
 * the other — on the first real run that would mean a READY deployment reported as unreadable.
 */
export function deploymentKey(deployment) {
  return deployment?.uid || deployment?.id || null;
}

/**
 * Has the production alias actually moved to this deployment?
 *
 * Vercel's response schema types `aliasAssigned` as a boolean, but its own documentation example
 * returns the STRING `"false"` — and that string is truthy, so `if (deployment.aliasAssigned)` would
 * read an unmoved alias as moved and certify a release that production is not serving. Accepted
 * truthy shapes are `true`, a positive number (an assignment timestamp) and the strings `"true"` /
 * a positive numeric string; `false`, `"false"`, `0`, `null`, `''` and anything unrecognised are not.
 */
export function aliasAssigned(deployment) {
  const value = deployment?.aliasAssigned;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'true') return true;
    if (text === '' || text === 'false') return false;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0;
  }
  return false;
}

/**
 * @param {{state?: string|null, readyState?: string|null, aliasAssigned?: number|boolean|string|null}} deployment
 * @returns {{outcome: 'ready'|'failed'|'pending', problems: string[]}}
 */
export function deploymentDecision(deployment) {
  const state = deploymentState(deployment);

  if (state === 'READY') {
    if (!aliasAssigned(deployment)) {
      return {
        outcome: 'pending',
        problems: ['the deployment is READY but no alias was assigned yet, so production traffic has not moved'],
      };
    }
    return { outcome: 'ready', problems: [] };
  }

  if (FAILED_STATES.includes(state)) {
    return {
      outcome: 'failed',
      problems: [`the deployment ended ${state}; production still serves the previous deployment`],
    };
  }

  // Unknown values are pending, not success: a gate that cannot see the state must not certify it.
  return { outcome: 'pending', problems: [] };
}

/**
 * @param {{status?: number, contentType?: string|null, body?: string, headers?: Record<string,string>}} response
 * @param {{markers?: string[], requireNosniff?: boolean}} [expectations]
 * @returns {string[]} problems; empty means the page looks like the app
 */
export function smokeProblems(
  { status, contentType, body, headers = {} },
  { markers = ['<div id="root">', '/assets/'], requireNosniff = true } = {},
) {
  const problems = [];

  if (status !== 200) problems.push(`the production URL answered HTTP ${status}, not 200`);
  if (!/text\/html/i.test(contentType || '')) {
    problems.push(`the production URL answered ${contentType || 'no content-type'}, not HTML`);
  }
  for (const marker of markers) {
    if (!String(body ?? '').includes(marker)) {
      problems.push(`the served page does not contain ${JSON.stringify(marker)}`);
    }
  }
  if (requireNosniff && String(headers['x-content-type-options'] ?? '').toLowerCase() !== 'nosniff') {
    problems.push('the response is missing X-Content-Type-Options: nosniff, so vercel.json headers are not in effect');
  }

  return problems;
}

/**
 * The build's entry bundle, e.g. `/assets/index-COYKpw8G.js`.
 *
 * Vite names the entry with a content hash, so two different builds cannot share one. That is what
 * makes it the only reliable way to tell "production serves the deployment" from "production serves
 * a cached copy of the previous deployment".
 */
export function entryAsset(html) {
  const match = String(html ?? '').match(/\/assets\/index-[A-Za-z0-9._-]+\.js/);
  return match ? match[0] : null;
}

/**
 * Is the deployment's own immutable URL readable enough to establish what it built?
 *
 * WHY THIS FAILS CLOSED
 *   The entry-bundle comparison is the only check that distinguishes "production serves this build"
 *   from "production serves a cached copy of the previous one". Treating an unreadable reference as
 *   "no claim either way" meant a protected, timed-out or entry-less deployment URL downgraded the
 *   whole verification to page-shell checks — which a cached previous page passes. So every way the
 *   reference can fail to be established is now a problem, and the caller must fail the release.
 *
 *   A protected deployment is not an invitation to weaken protection: Vercel Deployment Protection
 *   is the correct state for an immutable URL, and the answer is a bypass credential or a
 *   deliberate configuration decision, not an unauthenticated read forced through.
 *
 * @param {{status?: number, headers?: Record<string,string>, body?: string, error?: string|null}} read
 * @returns {string[]} problems; empty means the page exposed a verifiable entry bundle
 */
export function referenceProblems({ status = 0, headers = {}, body = '', error = null } = {}) {
  if (error) {
    return [
      `the deployment's own immutable URL could not be read (${error}), so the entry bundle it ` +
        'built is unknown and production cannot be verified against it',
    ];
  }

  const authenticate = String(headers['www-authenticate'] ?? '').toLowerCase();
  const protectedPage = /vercel\.com\/sso|vercel authentication/i.test(String(body ?? ''));
  if (status === 401 || status === 403 || authenticate.includes('vercel') || protectedPage) {
    return [
      `the deployment's own URL is behind Vercel Deployment Protection (HTTP ${status}); without a ` +
        'bypass credential the bundle it built cannot be read, so production is not verified against it',
    ];
  }

  if (status !== 200) {
    return [
      `the deployment's own URL answered HTTP ${status}, not 200, so the entry bundle it built cannot ` +
        'be established and production cannot be verified against it',
    ];
  }

  const entry = entryAsset(body);
  if (!entry) {
    return [
      "the deployment's own URL served no verifiable entry bundle (/assets/index-<hash>.js); page-shell " +
        'checks alone cannot prove production serves this build',
    ];
  }

  return [];
}

/**
 * After a rollback or a redeploy fallback: does production actually serve the previous build?
 *
 * WHY "READY" IS NOT CONTAINMENT
 *   `waitForReady` proves Vercel finished restoring a deployment. It does not prove the production
 *   domain points at it — and a rollback is documented to turn OFF automatic production-domain
 *   assignment (`https://vercel.com/docs/instant-rollback`), so the deployment can be READY while the
 *   domain still serves the bad build. Claiming containment from READY alone would report the one
 *   outcome an operator must not be told after a bad release.
 *
 * @param {{previousEntry?: string|null, previousWhy?: string|null, productionHtml?: string|null}} input
 * @returns {string[]} problems; empty means production serves the previous deployment's entry bundle
 */
export function restorationProblems({ previousEntry = null, previousWhy = null, productionHtml = null } = {}) {
  if (!previousEntry) {
    return [
      'what the previous deployment built could not be established' +
        (previousWhy ? ` (${previousWhy})` : '') +
        ', so production serving it cannot be confirmed',
    ];
  }

  const served = entryAsset(productionHtml);
  if (!served) {
    return [`production serves no entry bundle, so it is not confirmed to serve the previous build (${previousEntry})`];
  }
  if (served !== previousEntry) {
    return [`production is still serving ${served} while the previous deployment built ${previousEntry}`];
  }
  return [];
}

/**
 * Does production serve the build this deployment produced?
 *
 * WHY THIS IS NOT A HEADER CHECK
 *   Measured 2026-10-19: `https://hisaabkitaab.dpdns.org/?release=<fresh random value>` answered
 *   `X-Vercel-Cache: HIT` with `Age: 7729` and the previous build's ETag — Vercel's static cache key
 *   ignores the query string. So a query-string cache-buster cannot prove freshness, and a page that
 *   is 200, HTML, has the SPA shell, and carries `nosniff` would pass the smoke check while it was
 *   still the *previous* release. Rollback would then be skipped on exactly the release that needed
 *   it.
 *
 *   The comparison instead uses the deployment's own immutable URL as the reference: whatever entry
 *   bundle the deployment serves is what production must eventually serve. Same build → nothing to
 *   report. Different (or missing) entry → production has not moved, and the caller waits before
 *   failing.
 *
 * @returns {string[]} problems; empty means production serves the deployment's build. An unreadable
 *   deployment page returns no problems here, so the *caller* is responsible for refusing the
 *   release when the reference could not be read — `referenceProblems` is that gate.
 */
export function staleServing(productionHtml, deploymentHtml) {
  const built = entryAsset(deploymentHtml);
  if (!built) return []; // the deployment's own page was unreadable — no claim either way

  const served = entryAsset(productionHtml);
  if (!served) {
    return [`production serves no entry bundle, so it is not serving the deployment's build (${built})`];
  }
  if (served !== built) {
    return [
      `production is still serving ${served} while the deployment built ${built} — the cached page belongs to the previous deployment`,
    ];
  }
  return [];
}

/**
 * The deployment production should return to: the newest READY, promoted production deployment that
 * is not the one being verified. Returned as-is so the caller can name it; null when there is none.
 */
export function previousPromoted(deployments, currentId) {
  return (
    (Array.isArray(deployments) ? deployments : [])
      .filter((d) => deploymentKey(d) && deploymentKey(d) !== currentId)
      .filter((d) => d.target === 'production')
      .filter((d) => deploymentState(d) === 'READY')
      .filter((d) => d.readySubstate === 'PROMOTED' || aliasAssigned(d))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null
  );
}

/**
 * @param {{deploymentReady: boolean, smokeOk: boolean, previous: object|null}} input
 * @returns {{rollback: boolean, reason: string}}
 */
export function rollbackDecision({ deploymentReady, smokeOk, previous }) {
  if (smokeOk) return { rollback: false, reason: 'the release is serving; no rollback is needed' };

  if (!deploymentReady) {
    return {
      rollback: false,
      reason:
        'the deployment never became live, so production still serves the previous build — there is nothing to roll back',
    };
  }

  const target = deploymentKey(previous);
  if (!target) {
    return {
      rollback: false,
      reason: 'no earlier promoted production deployment is available, so the release needs a human — production may be serving the failed build',
    };
  }

  return { rollback: true, reason: `returning production to ${target}` };
}
