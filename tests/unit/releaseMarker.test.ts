/**
 * The release marker decides what to send to the error reporter's timeline, and it must not be able
 * to send it to the wrong place or twice.
 *
 * The rule that matters operationally is the refusal: a marker that runs with no token would either
 * throw (failing a release that already shipped) or, worse, quietly record nothing while the run
 * looks green. So every missing input is asserted as a refusal with its own name, and the request
 * plan is read field by field — the deploy boundary is the whole point of the step.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  RELEASE_PREFIX,
  deployResponseAccepted,
  markerPlan,
  releaseResponseAccepted,
} from '../../scripts/deploy/mark-release.mjs';

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const base = {
  SENTRY_AUTH_TOKEN: 'sntrys_do_not_print_me',
  SENTRY_ORG: 'agrishop',
  SENTRY_PROJECT: 'app',
  GATED_SHA: '4f9c2ab',
};

describe('what the marker refuses', () => {
  test.each([
    ['SENTRY_AUTH_TOKEN', 'SENTRY_AUTH_TOKEN'],
    ['SENTRY_ORG', 'SENTRY_ORG'],
    ['SENTRY_PROJECT', 'SENTRY_PROJECT'],
    ['GATED_SHA', 'GATED_SHA'],
  ])('missing %s refuses with exit 2', (key, named) => {
    const plan = markerPlan({ ...base, [key]: '' });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe(2);
    expect(plan.reason).toContain(named);
    expect(plan.requests).toEqual([]);
  });

  test('a value that is not a commit-ish is refused, not truncated', () => {
    const plan = markerPlan({ ...base, GATED_SHA: 'not a sha at all' });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe(2);
    expect(plan.reason).toContain('not a commit-ish');
  });

  test('a non-http base URL is refused', () => {
    const plan = markerPlan({ ...base, SENTRY_URL: 'sentry.example.com' });
    expect(plan.ok).toBe(false);
    expect(plan.code).toBe(2);
  });

  test('the reason never contains the token', () => {
    for (const plan of [
      markerPlan({ ...base, SENTRY_ORG: '' }),
      markerPlan({ ...base, SENTRY_URL: 'nope' }),
      markerPlan(base),
    ]) {
      expect(JSON.stringify(plan.reason ?? '')).not.toContain('sntrys_do_not_print_me');
    }
  });
});

describe('what the marker sends', () => {
  test('release and deploy name the same commit the bundle was built from', () => {
    const plan = markerPlan({ ...base, SENTRY_ENVIRONMENT: 'production' });
    expect(plan.ok).toBe(true);
    expect(plan.release).toBe(`${RELEASE_PREFIX}4f9c2ab`);

    const [create, list, deploy] = plan.requests;
    expect(create.method).toBe('POST');
    expect(create.url).toBe('https://sentry.io/api/0/projects/agrishop/app/releases/');
    expect(create.body).toEqual({
      version: `${RELEASE_PREFIX}4f9c2ab`,
      projects: ['app'],
    });

    expect(list.method).toBe('GET');
    expect(list.url).toContain(`/releases/${encodeURIComponent(`${RELEASE_PREFIX}4f9c2ab`)}/deploys/`);

    expect(deploy.method).toBe('POST');
    expect(deploy.body).toMatchObject({ environment: 'production', name: '4f9c2ab' });
  });

  test('the deploy is named by the Vercel deployment and carries the customer domain', () => {
    const plan = markerPlan({
      ...base,
      DEPLOYMENT_ID: 'dpl_abc123',
      SMOKE_URL: 'https://hisaabkitaab.dpdns.org',
    });
    expect(plan.requests[2].body).toMatchObject({
      name: 'dpl_abc123',
      url: 'https://hisaabkitaab.dpdns.org',
    });
  });

  test('a self-hosted base URL has its trailing slashes removed', () => {
    const plan = markerPlan({ ...base, SENTRY_URL: 'https://sentry.internal.example//' });
    expect(plan.ok).toBe(true);
    expect(plan.requests[0].url.startsWith('https://sentry.internal.example/api/0/')).toBe(true);
  });

  test('nothing customer-shaped is in the payload', () => {
    const plan = markerPlan({ ...base, DEPLOYMENT_ID: 'dpl_abc123' });
    const payload = JSON.stringify(plan.requests.map((step) => step.body ?? null));
    // "agrishop" is the product's name, so the check is on words that would name a person or a
    // transaction, not on any substring of the release id.
    expect(payload).not.toMatch(/\bcustomer\b|\bphone\b|\bemail\b|\bbalance\b|\bamount\b|\bsale\b/i);
  });

  test('dry run is decided by the caller, and sends the same plan', () => {
    const plan = markerPlan({ ...base, DRY_RUN: '1' });
    expect(plan.ok).toBe(true);
    expect(plan.dryRun).toBe(true);
    expect(plan.requests).toHaveLength(3);
  });
});

describe('the answers that count as recorded', () => {
  test('a new release and a known release are both success', () => {
    expect(releaseResponseAccepted(201)).toBe(true);
    expect(releaseResponseAccepted(200)).toBe(true);
    expect(releaseResponseAccepted(409)).toBe(true);
    expect(releaseResponseAccepted(400, '{"detail":"Release already exists"}')).toBe(true);
  });

  test('an authentication failure is never success', () => {
    for (const status of [400, 401, 403, 404, 500, 0]) {
      expect(releaseResponseAccepted(status, '{"detail":"Invalid token"}')).toBe(false);
    }
  });

  test('a deploy must have been created', () => {
    expect(deployResponseAccepted(201)).toBe(true);
    expect(deployResponseAccepted(200)).toBe(true);
    expect(deployResponseAccepted(202)).toBe(false);
    expect(deployResponseAccepted(0)).toBe(false);
  });
});

/**
 * Where the marker is wired, which no behavioural test can see.
 *
 * The defect guarded here is a timeline that *lies*: `deploy-production.yml` accepts a manual
 * dispatch and defaults it to `dry_run: true`, which creates no deployment and still concludes
 * `success`. If `release-timeline.yml` recorded every successful deploy run, a rehearsal would be
 * written down as a release.
 */
describe('the timeline only records a run that actually deployed', () => {
  const timeline = read('.github/workflows/release-timeline.yml');
  const deploy = read('.github/workflows/deploy-production.yml');

  test('a deploy dispatch is never recorded — it defaults to a dry run', () => {
    // `dry_run` is the last field of the dispatch input, ~150 characters after its name.
    expect(deploy).toMatch(/dry_run:[\s\S]{0,400}?default: true/);
    expect(timeline).toContain("github.event.workflow_run.event == 'workflow_run'");
  });

  test('a failed deploy is never recorded', () => {
    expect(timeline).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(timeline).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  test('the verification step runs only for a deployment that was created', () => {
    // The same fact the timeline relies on: no deployment id, no verification — and therefore the
    // only run shape that can reach a verified success is one where Vercel was actually asked.
    expect(deploy).toContain("if: steps.trigger.outputs.deployment_id != ''");
  });

  test('the marker is not a step in the deploy workflow', () => {
    expect(deploy).not.toContain('mark-release.mjs');
    expect(deploy).not.toMatch(/continue-on-error:\s*true/);
    expect(timeline).toContain('node scripts/deploy/mark-release.mjs');
  });
});
