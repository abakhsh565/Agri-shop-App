#!/usr/bin/env node
/**
 * Is the scheduled production backup still real?
 *
 * `docs/RECOVERY.md` §9 has carried the same two gaps for as long as the backups have existed:
 *
 *   - nothing noticed a backup that did not happen. A backup workflow that is red, that is green
 *     with no artefact, or that never started at all, looked from the outside exactly like a backup
 *     that worked. The gap between "the last good backup" and "somebody finding out" was unbounded —
 *     it was however long it took a human to wonder;
 *   - the only thing watching the backup was the backup, and a workflow cannot report on its own
 *     absence.
 *
 * This is that missing watcher. It is deliberately NOT part of `backup-database.yml`: a watcher
 * inside the watched thing inherits every failure the watched thing has, including the one that
 * matters most (the run never starting). It reads the Actions API instead, so its evidence is the
 * same evidence an operator would see, and it alerts where a person will actually see it — an issue.
 *
 * What it decides, from the newest completed run of the backup workflow on the default branch:
 *
 *   ok                 success, at least one live artefact, taken within the RPO (+ a slack window
 *                      for cron drift and queue time)
 *   red                the newest completed run did not succeed
 *   missing-artifact   the newest completed run succeeded and left no artefact — or left only
 *                      expired ones. This is the exact defect that shipped for a year: green run,
 *                      QA dump (or nothing at all), and a repository that believed it was covered
 *   stale              the newest good artefact is older than RPO + slack
 *   never-ran          no completed run exists at all, so the coverage is zero and always was
 *   unknown            the watcher could not find out (API error, missing token). Reported as
 *                      unhealthy on purpose: a watcher that cannot see must say so, not stay quiet
 *
 * Exit codes: 0 healthy · 1 unhealthy (alerted) · 2 could not determine (alerted).
 *
 * ── Running it ──────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/check-backup-health.mjs                 # the real check, against GitHub
 *   node scripts/check-backup-health.mjs --dry-run       # decide and print; touch nothing
 *   node scripts/check-backup-health.mjs --simulate stale  # verify the alert path fires
 *
 * `--simulate` exists so the alert can be proved end to end without waiting for a real outage. It
 * uses invented run ids and marks the decision `simulated`, and the issue it opens says so at the
 * top, so a rehearsal can never be mistaken for a real alert. It is never set by the schedule.
 *
 * `--runs-file` / `--artifacts-file` / `--now` feed recorded API payloads instead of calling
 * GitHub, which is what `tests/unit/backupHealthWatchdog.test.ts` uses to pin the decision — the
 * rule is tested, not just the plumbing that feeds it.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The backup workflow this watches. Named here so the watcher cannot silently watch nothing. */
export const BACKUP_WORKFLOW_FILE = 'backup-database.yml';

/** Label on the alert issue. One label means one open issue, so the alert is a state, not a stream. */
export const ALERT_LABEL = 'backup-alert';

/** The RPO of record (`docs/RECOVERY.md` §9), which is also the backup cron's period. */
export const DEFAULT_RPO_HOURS = 24;

/**
 * Extra time before lateness is called lateness: the scheduler's own drift (a cron is not a
 * promise), the job's queue wait and runtime (the backup takes minutes and the verification replays
 * the whole dump), and the watcher's cadence. Without it the watcher would shout every day at the
 * hour the backup is legitimately still running.
 */
export const DEFAULT_SLACK_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Only the run fields a report or an alert uses. The raw API object carries the whole repository
 * payload, and a watcher whose output nobody can read is a watcher nobody checks.
 */
function summarizeRun(run) {
  return {
    id: run.id,
    run_number: run.run_number,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    head_branch: run.head_branch,
    created_at: run.created_at,
    html_url: run.html_url,
  };
}

/**
 * Decide the health of the backup from what the API returned. Pure: no clock, no network, no
 * filesystem — every input is passed in, which is what makes the rule testable and this file's
 * guard meaningful.
 */
export function classifyBackupHealth({
  runs = [],
  artifactsByRun = {},
  now,
  rpoHours = DEFAULT_RPO_HOURS,
  slackHours = DEFAULT_SLACK_HOURS,
}) {
  const thresholdHours = rpoHours + slackHours;

  const completed = runs
    .filter((run) => run && run.status === 'completed')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const inFlight = runs.filter((run) => run && run.status !== 'completed');

  const base = {
    checkedAt: new Date(now).toISOString(),
    thresholds: { rpoHours, slackHours, thresholdHours },
    completedRuns: completed.length,
    inFlightRuns: inFlight.length,
    simulated: false,
  };

  if (completed.length === 0) {
    return {
      ...base,
      state: 'never-ran',
      healthy: false,
      run: null,
      artefactCount: 0,
      ageHours: null,
      summary:
        inFlight.length > 0
          ? 'No completed run of the backup workflow exists, and a run is in flight — there is no verified backup yet.'
          : 'No completed run of the backup workflow exists. There is no verified backup, and there never was.',
    };
  }

  const latest = completed[0];
  const ageHours = (new Date(now).getTime() - new Date(latest.created_at).getTime()) / HOUR_MS;

  if (latest.conclusion !== 'success') {
    return {
      ...base,
      state: 'red',
      healthy: false,
      run: summarizeRun(latest),
      artefactCount: 0,
      ageHours,
      summary: `The newest completed backup run ended "${latest.conclusion}", so the newest verified backup is older than the RPO allows.`,
    };
  }

  // Expired artefacts do not count: retention is a policy, and a run whose artefact has already
  // been dropped is a run that can no longer restore anything.
  const artifacts = (artifactsByRun[latest.id] ?? []).filter((a) => a && a.expired !== true);

  if (artifacts.length === 0) {
    const all = artifactsByRun[latest.id] ?? [];
    return {
      ...base,
      state: 'missing-artifact',
      healthy: false,
      run: summarizeRun(latest),
      artefactCount: 0,
      ageHours,
      summary:
        all.length > 0
          ? `The newest completed backup run succeeded but every artefact it produced has expired — no restorable backup remains.`
          : 'The newest completed backup run succeeded and published no artefact: the run is green and there is nothing to restore. This is the defect that made a QA dump look like production coverage.',
    };
  }

  if (ageHours > thresholdHours) {
    return {
      ...base,
      state: 'stale',
      healthy: false,
      run: summarizeRun(latest),
      artefactCount: artifacts.length,
      ageHours,
      summary: `The newest verified backup is ${ageHours.toFixed(1)} h old, past the ${rpoHours} h RPO plus ${slackHours} h of slack.`,
    };
  }

  return {
    ...base,
    state: 'ok',
    healthy: true,
    run: summarizeRun(latest),
    artefactCount: artifacts.length,
    ageHours,
    summary: `Verified backup ${ageHours.toFixed(1)} h old with ${artifacts.length} live artefact(s), within the ${rpoHours} h RPO.`,
  };
}

/** The decision for a rehearsed fault. Invented run ids, and the decision says it is simulated. */
export function simulatedHealth(kind, { now }) {
  const at = (hoursAgo) => new Date(new Date(now).getTime() - hoursAgo * HOUR_MS).toISOString();
  const run = (over = {}) => ({
    id: 999000,
    name: 'Backup Database (to the environment it names)',
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    run_number: 999,
    created_at: at(3),
    html_url: 'https://example.invalid/simulated-run',
    ...over,
  });
  const artifact = { id: 1, name: 'database-backup-production-999', expired: false };

  let decision;
  if (kind === 'red') {
    decision = classifyBackupHealth({ runs: [run({ conclusion: 'failure' })], artifactsByRun: {}, now });
  } else if (kind === 'missing-artifact') {
    decision = classifyBackupHealth({ runs: [run()], artifactsByRun: { 999000: [] }, now });
  } else if (kind === 'stale') {
    const old = run({ created_at: at(DEFAULT_RPO_HOURS + DEFAULT_SLACK_HOURS + 6) });
    decision = classifyBackupHealth({ runs: [old], artifactsByRun: { 999000: [artifact] }, now });
  } else if (kind === 'never-ran') {
    decision = classifyBackupHealth({ runs: [], artifactsByRun: {}, now });
  } else {
    throw new Error(`unknown simulation "${kind}" — expected red, missing-artifact, stale or never-ran`);
  }

  return { ...decision, simulated: true, simulation: kind };
}

/** A marker the watcher reads back, so a repeated check comments instead of opening a second issue. */
export function alertMarker(decision) {
  return `<!-- backup-watchdog state=${decision.state} run=${decision.run?.id ?? 'none'} -->`;
}

/** What the operator reads. Short, specific, and it says what to do next. */
export function alertBody(decision, { repository, workflowUrl }) {
  const run = decision.run;
  const lines = [];

  lines.push(alertMarker(decision));
  lines.push('');
  if (decision.simulated) {
    lines.push('> **SIMULATED — not a real backup failure.** This issue was opened by a rehearsed fault');
    lines.push(`> (\`--simulate ${decision.simulation}\`) to verify that the alert path fires. Close it after reading.`);
    lines.push('');
  }
  lines.push(`**${decision.state}** — ${decision.summary}`);
  lines.push('');
  lines.push('| field | value |');
  lines.push('|---|---|');
  lines.push(`| state | \`${decision.state}\` |`);
  lines.push(`| checked at | ${decision.checkedAt} |`);
  lines.push(`| newest completed run | ${run ? `[#${run.run_number}](${run.html_url}) — ${run.conclusion} (${run.event}, ${run.created_at})` : 'none'} |`);
  lines.push(`| live artefacts | ${decision.artefactCount} |`);
  lines.push(`| age | ${decision.ageHours === null ? 'n/a — no run' : `${decision.ageHours.toFixed(1)} h`} |`);
  lines.push(`| RPO of record | ${decision.thresholds.rpoHours} h (+${decision.thresholds.slackHours} h slack = ${decision.thresholds.thresholdHours} h) |`);
  lines.push('');
  lines.push('**What this means:** the newest restorable production backup is older than the agreed objective.');
  lines.push('');
  lines.push('**What to do:**');
  lines.push(`1. Open the failed or empty run: ${workflowUrl}`);
  lines.push('2. Fix the cause — missing credentials, a red verification step, a scheduling outage — and re-run it with `environment: production`.');
  lines.push('3. Confirm the run ends green **and** that it published an artefact.');
  lines.push('4. Re-run this watcher (`Actions → Backup Watchdog → Run workflow`); it closes this issue when the backup is healthy again.');
  lines.push('');
  lines.push(`Policy and procedure: \`docs/RECOVERY.md\` §9 (objectives) and §4 (restore). Watcher: ${workflowUrl.replace(BACKUP_WORKFLOW_FILE, 'backup-watchdog.yml')} in \`${repository}\`.`);
  lines.push('');
  lines.push('_Opened by `scripts/check-backup-health.mjs`. It keeps one open issue for this condition and comments here on repeat checks, so a sustained outage is a thread rather than a flood._');

  return lines.join('\n');
}

// ── the plumbing ────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, simulate: '', branch: 'main', json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[++i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--simulate') args.simulate = value();
    else if (arg === '--branch') args.branch = value();
    else if (arg === '--repo') args.repository = value();
    else if (arg === '--rpo-hours') args.rpoHours = Number(value());
    else if (arg === '--slack-hours') args.slackHours = Number(value());
    else if (arg === '--runs-file') args.runsFile = value();
    else if (arg === '--artifacts-file') args.artifactsFile = value();
    else if (arg === '--now') args.now = value();
    else if (arg === '--json') args.json = value();
    else throw new Error(`unknown argument "${arg}"`);
  }
  return args;
}

function githubClient(token) {
  const call = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'agrishop-backup-watchdog',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
    }
    return response.status === 204 ? null : response.json();
  };
  return { call };
}

async function readHealth({ args, repository, token, now }) {
  if (args.simulate) {
    return { decision: simulatedHealth(args.simulate, { now }), runs: [], artifactsByRun: {} };
  }

  const runs = args.runsFile
    ? JSON.parse(readFileSync(args.runsFile, 'utf8'))
    : (await githubClient(token).call(
        `/repos/${repository}/actions/workflows/${BACKUP_WORKFLOW_FILE}/runs?branch=${encodeURIComponent(args.branch)}&per_page=30`,
      )).workflow_runs ?? [];

  const list = Array.isArray(runs) ? runs : runs.workflow_runs ?? [];
  const completed = list.filter((r) => r.status === 'completed').sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  let artifactsByRun = {};
  if (args.artifactsFile) {
    artifactsByRun = JSON.parse(readFileSync(args.artifactsFile, 'utf8'));
  } else if (completed.length > 0) {
    // Only the newest completed run has to be inspected: the decision is made from it alone.
    const listing = await githubClient(token).call(`/repos/${repository}/actions/runs/${completed[0].id}/artifacts?per_page=100`);
    artifactsByRun = { [completed[0].id]: listing.artifacts ?? [] };
  }

  return {
    decision: classifyBackupHealth({
      runs: list,
      artifactsByRun,
      now,
      rpoHours: args.rpoHours ?? DEFAULT_RPO_HOURS,
      slackHours: args.slackHours ?? DEFAULT_SLACK_HOURS,
    }),
    runs: list,
    artifactsByRun,
  };
}

async function alert({ decision, repository, token, dryRun, workflowUrl }) {
  if (dryRun) return { action: decision.healthy ? 'none (healthy)' : 'would-open-or-comment', issue: null };

  const client = githubClient(token);
  const open = await client.call(`/repos/${repository}/issues?labels=${ALERT_LABEL}&state=open&per_page=10`);
  const existing = (open ?? []).find((issue) => !issue.pull_request) ?? null;
  const marker = alertMarker(decision);

  if (decision.healthy) {
    if (!existing) return { action: 'none (healthy)', issue: null };
    await client.call(`/repos/${repository}/issues/${existing.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `${marker}\n\n**Resolved** — ${decision.summary}\n\nClosing; the watcher reopens a new issue if the backup goes red, empty or stale again.` }),
    });
    await client.call(`/repos/${repository}/issues/${existing.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
    return { action: 'closed', issue: existing.number };
  }

  const body = alertBody(decision, { repository, workflowUrl });
  if (existing) {
    // One issue per condition: comment when the situation changed, stay quiet when it has not.
    if (typeof existing.body === 'string' && existing.body.includes(marker)) {
      return { action: 'unchanged (already reported)', issue: existing.number };
    }
    await client.call(`/repos/${repository}/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    return { action: 'commented', issue: existing.number };
  }

  const title = decision.simulated
    ? `[SIMULATED] Backup watchdog alert — ${decision.state}`
    : `Backup watchdog alert — ${decision.state}`;
  const created = await client.call(`/repos/${repository}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels: [ALERT_LABEL] }),
  });
  return { action: 'opened', issue: created.number };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = args.repository ?? process.env.GITHUB_REPOSITORY ?? '';
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  const now = args.now ? new Date(args.now).getTime() : Date.now();

  if (!repository) throw new Error('no repository — set GITHUB_REPOSITORY or pass --repo owner/name');
  if (!args.dryRun && !args.runsFile && !token) throw new Error('no token — set GH_TOKEN (needs actions:read and issues:write)');

  const workflowUrl = `https://github.com/${repository}/actions/workflows/${BACKUP_WORKFLOW_FILE}`;

  let decision;
  try {
    ({ decision } = await readHealth({ args, repository, token, now }));
  } catch (error) {
    // The watcher cannot see, and that is itself the alarm: a blind watcher must never report health.
    decision = {
      ...classifyBackupHealth({ runs: [], artifactsByRun: {}, now }),
      state: 'unknown',
      healthy: false,
      run: null,
      ageHours: null,
      summary: `The watchdog could not determine backup health: ${error.message}`,
    };
  }

  let outcome = { action: 'not attempted', issue: null };
  try {
    outcome = await alert({ decision, repository, token, dryRun: args.dryRun, workflowUrl });
  } catch (error) {
    decision = { ...decision, healthy: false, state: decision.state === 'unknown' ? 'unknown' : decision.state, unhealthyReason: `alerting failed: ${error.message}` };
    console.error(`::warning::alerting failed: ${error.message}`);
    if (!args.dryRun) {
      console.log(JSON.stringify({ ...decision, alert: { action: 'failed', error: error.message } }, null, 2));
      return 2;
    }
  }

  const report = { ...decision, alert: outcome };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (args.json) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.json, `${text}\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Backup watchdog — ${decision.state}\n\n${decision.simulated ? '**SIMULATED**\n\n' : ''}${decision.summary}\n\n` +
        `- newest completed run: ${decision.run ? `#${decision.run.run_number} (${decision.run.conclusion})` : 'none'}\n` +
        `- live artefacts: ${decision.artefactCount}\n` +
        `- age: ${decision.ageHours === null ? 'n/a' : `${decision.ageHours.toFixed(1)} h`} vs RPO ${decision.thresholds.rpoHours} h (+${decision.thresholds.slackHours} h slack)\n` +
        `- alert: ${outcome.action}${outcome.issue ? ` (#${outcome.issue})` : ''}\n`,
    );
  }

  if (decision.healthy) return 0;
  return decision.state === 'unknown' ? 2 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // `process.exitCode`, not `process.exit()`: exit() while stdout is still flushing truncates the
  // report a human is supposed to read, and libuv complains on Windows. The exit code the workflow
  // gates on is identical either way.
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`::error::backup watchdog failed: ${error.message}`);
      process.exitCode = 2;
    });
}
