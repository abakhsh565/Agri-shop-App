/**
 * deploy-gate.mjs — the decision that stands between a green candidate and production.
 *
 * WHY THIS IS A PURE FUNCTION
 *   The gate that matters is not the one in a comment in a workflow file; it is the one that decides
 *   whether a POST is made. That decision has to be testable with nothing running — no GitHub, no
 *   Vercel, no clock — or it becomes a claim. `scripts/deploy/trigger-production.mjs` is a thin
 *   caller: it resolves the inputs, asks this function, and only then makes a network call.
 *
 * WHAT MUST BE TRUE BEFORE PRODUCTION IS TOUCHED
 *   1. The trigger is a completed CI run, or an explicitly dispatched deployment.
 *   2. That CI run concluded `success` — not `failure`, not `cancelled`, not "still running", and
 *      never a conclusion nobody looked at.
 *   3. The run was on `main`.
 *   4. The SHA being deployed is a full commit id, and it is still `main`'s head. A green run for a
 *      commit that has since been superseded is not permission to deploy that commit.
 *   5. The credential and the project are present. Missing configuration is a refusal, never a
 *      fallback to "whatever Vercel's git integration would have done".
 *
 *   A dry run relaxes only rule 5 — it is the path used to prove the gate itself works, and it
 *   performs no network request at all.
 */

const isSha = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

export const CI_WORKFLOW = 'CI — gates for a candidate commit';

/**
 * @param {object} input
 * @param {'workflow_run'|'workflow_dispatch'} input.event
 * @param {string|null} input.conclusion     the CI run's conclusion (`workflow_run`)
 * @param {string|null} input.headBranch     the branch that run tested
 * @param {string|null} input.gatedSha
 * @param {string|null} input.mainSha
 * @param {boolean} input.tokenPresent
 * @param {string|null} input.projectId
 * @param {boolean} [input.dryRun]
 * @returns {{ok: boolean, problems: string[], deploy: boolean, mode: 'deploy'|'dry-run'|'refused'}}
 */
export function productionDeployDecision({
  event,
  conclusion,
  headBranch,
  gatedSha,
  mainSha,
  tokenPresent,
  projectId,
  dryRun = false,
}) {
  const problems = [];

  if (event !== 'workflow_run' && event !== 'workflow_dispatch') {
    problems.push(
      `unknown trigger ${JSON.stringify(event ?? null)}. Production is deployed by a completed CI run ` +
        'or an explicit dispatch, and by nothing else.',
    );
  }

  // Both triggers answer the same question: is there a green CI run for this commit? A dispatch is a
  // way to *ask* for the deploy, not a way to skip the gate.
  if (conclusion !== 'success') {
    problems.push(
      `the CI run concluded ${JSON.stringify(conclusion ?? null)}, not "success". A failed, cancelled ` +
        'or unfinished candidate never deploys.',
    );
  }
  if (headBranch !== 'main') {
    problems.push(`the CI run tested ${JSON.stringify(headBranch ?? null)}, not "main".`);
  }

  if (!isSha(gatedSha)) {
    problems.push(`the gated commit is not a full 40-character SHA (got ${JSON.stringify(gatedSha ?? null)}).`);
  }
  if (!isSha(mainSha)) {
    problems.push(
      'main\u2019s head could not be resolved, so "this commit is still what main points at" cannot be ' +
        'established. A gate that cannot see the branch refuses.',
    );
  }
  if (isSha(gatedSha) && isSha(mainSha) && gatedSha !== mainSha) {
    problems.push(
      `the gated commit ${gatedSha.slice(0, 10)} is not main's head ${mainSha.slice(0, 10)}. ` +
        'A newer push must be gated before anything is deployed.',
    );
  }

  if (!dryRun) {
    if (!tokenPresent) {
      problems.push(
        'no VERCEL_TOKEN in this run. Missing credentials are a refusal; they are never a reason to let ' +
          'the git integration deploy on its own.',
      );
    }
    if (!projectId) problems.push('no VERCEL_PROJECT_ID. The deployment would not name its project.');
  }

  const ok = problems.length === 0;
  return { ok, problems, deploy: ok && !dryRun, mode: ok ? (dryRun ? 'dry-run' : 'deploy') : 'refused' };
}

/** The Vercel deployment request body — exported so the test asserts the exact bytes. */
export function deploymentBody({ projectId, sha, repoId = '1345429482', name = 'agri-shop-app' }) {
  return {
    name,
    project: projectId,
    target: 'production',
    gitSource: { type: 'github', repoId, ref: 'main', sha },
  };
}
