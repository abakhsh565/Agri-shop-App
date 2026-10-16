/**
 * backupHealthWatchdog — the backup can only be healthy if something outside the backup says so.
 *
 * `docs/RECOVERY.md` §9 recorded the gap in plain words: nothing noticed a backup that did not
 * happen, so "time to notice" was unbounded. A backup is a claim about what you can restore, and
 * an unobserved claim is not evidence — the repository had a green backup workflow for a year
 * while the only dumps it kept were of the test database, and no check anywhere disagreed.
 *
 * So this file guards the watcher itself:
 *
 *   - the decision, for every state the defect has actually taken: a red run, a green run with no
 *     artefact, a green run whose artefact expired, a backup older than the RPO, and no run at all;
 *   - the boundaries, because "24 h RPO" means 24 h and not "roughly a day" — a check that fires
 *     early is a check that gets muted;
 *   - the wiring: a schedule that exists, a schedule later than the backup it watches, an empty
 *     rehearsal input by default so the automated path can only run the real check;
 *   - the boundary that keeps this honest: the watcher reads the Actions API and holds no database
 *     credential. It must not become one more thing that can reach production, and it must never
 *     be the thing that reports "healthy" because it could not look.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ALERT_LABEL,
  BACKUP_WORKFLOW_FILE,
  DEFAULT_RPO_HOURS,
  DEFAULT_SLACK_HOURS,
  alertBody,
  alertMarker,
  classifyBackupHealth,
  simulatedHealth,
} from '../../scripts/check-backup-health.mjs';

const ROOT = process.cwd();
const WATCHDOG = join(ROOT, '.github/workflows/backup-watchdog.yml');
const watchdogYml = readFileSync(WATCHDOG, 'utf8');
const backupYml = readFileSync(join(ROOT, '.github/workflows', BACKUP_WORKFLOW_FILE), 'utf8');
const script = readFileSync(join(ROOT, 'scripts/check-backup-health.mjs'), 'utf8');

const NOW = Date.parse('2026-10-16T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3600_000).toISOString();

/** A completed run, healthy unless the test says otherwise. */
const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1001,
  name: 'Backup Database (to the environment it names)',
  event: 'schedule',
  status: 'completed',
  conclusion: 'success',
  head_branch: 'main',
  run_number: 36,
  created_at: hoursAgo(3),
  html_url: 'https://github.com/example/agrishop/actions/runs/1001',
  ...over,
});

const liveArtifact = { id: 9, name: 'database-backup-production-36', expired: false };
const expiredArtifact = { id: 9, name: 'database-backup-production-36', expired: true };

const decide = (options: Record<string, unknown> = {}) =>
  classifyBackupHealth({ now: NOW, ...options } as never);

describe('the decision, in the shapes the failure has actually taken', () => {
  test('a green run with a live artefact inside the RPO is the only healthy answer', () => {
    const decision = decide({ runs: [run()], artifactsByRun: { 1001: [liveArtifact] } });
    expect(decision.state).toBe('ok');
    expect(decision.healthy).toBe(true);
    expect(decision.artefactCount).toBe(1);
    expect(decision.summary).toMatch(/within the 24 h RPO/);
  });

  test('a red run is unhealthy, and the artefact question is not asked of it', () => {
    const decision = decide({ runs: [run({ conclusion: 'failure' })], artifactsByRun: { 1001: [liveArtifact] } });
    expect(decision.state).toBe('red');
    expect(decision.healthy).toBe(false);
    expect(decision.summary).toMatch(/older than the RPO allows/);
  });

  test('a cancelled or timed-out run counts as red, not as success', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'startup_failure', 'skipped']) {
      expect(decide({ runs: [run({ conclusion })], artifactsByRun: { 1001: [liveArtifact] } }).state).toBe('red');
    }
  });

  test('a green run with NO artefact is unhealthy — this is the defect, not a healthy backup', () => {
    const decision = decide({ runs: [run()], artifactsByRun: { 1001: [] } });
    expect(decision.state).toBe('missing-artifact');
    expect(decision.healthy).toBe(false);
    expect(decision.summary).toMatch(/green and there is nothing to restore/);
  });

  test('a green run whose only artefact has expired is unhealthy — retention is part of restorability', () => {
    const decision = decide({ runs: [run()], artifactsByRun: { 1001: [expiredArtifact] } });
    expect(decision.state).toBe('missing-artifact');
    expect(decision.healthy).toBe(false);
    expect(decision.summary).toMatch(/has expired/);
  });

  test('an expired artefact beside a live one does not make the backup healthy on its own', () => {
    const p = hoursAgo(30);
    const decision = decide({
      runs: [run({ created_at: p })],
      artifactsByRun: { 1001: [expiredArtifact, liveArtifact] },
    });
    expect(decision.state).toBe('stale');
    expect(decision.artefactCount).toBe(1);
  });

  test('a backup older than RPO + slack is stale, and the summary carries the real age', () => {
    const decision = decide({
      runs: [run({ created_at: hoursAgo(DEFAULT_RPO_HOURS + DEFAULT_SLACK_HOURS + 5) })],
      artifactsByRun: { 1001: [liveArtifact] },
    });
    expect(decision.state).toBe('stale');
    expect(decision.healthy).toBe(false);
    expect(decision.summary).toMatch(/32\.0 h old/);
  });

  test('no completed run at all is "never-ran", which is the worst state, not the default one', () => {
    const decision = decide({ runs: [], artifactsByRun: {} });
    expect(decision.state).toBe('never-ran');
    expect(decision.healthy).toBe(false);
    expect(decision.summary).toMatch(/there never was/);
  });

  test('a run in flight is not a completed run, and is named when it is the only thing there is', () => {
    const decision = decide({
      runs: [run({ status: 'in_progress', conclusion: null })],
      artifactsByRun: {},
    });
    expect(decision.state).toBe('never-ran');
    expect(decision.inFlightRuns).toBe(1);
    expect(decision.summary).toMatch(/a run is in flight/);
  });

  test('an in-flight run does not hide a red one underneath it', () => {
    const decision = decide({
      runs: [run({ id: 2002, status: 'in_progress', conclusion: null, created_at: hoursAgo(0.2) }), run({ conclusion: 'failure' })],
      artifactsByRun: { 1001: [] },
    });
    expect(decision.state).toBe('red');
  });
});

describe('the boundary, because an early alarm is a muted one', () => {
  test('exactly at the threshold is still healthy — the slack window is real', () => {
    const atLimit = DEFAULT_RPO_HOURS + DEFAULT_SLACK_HOURS;
    expect(decide({ runs: [run({ created_at: hoursAgo(atLimit) })], artifactsByRun: { 1001: [liveArtifact] } }).state).toBe('ok');
  });

  test('half an hour past it is stale', () => {
    const pastLimit = DEFAULT_RPO_HOURS + DEFAULT_SLACK_HOURS + 0.5;
    expect(decide({ runs: [run({ created_at: hoursAgo(pastLimit) })], artifactsByRun: { 1001: [liveArtifact] } }).state).toBe('stale');
  });

  test('the RPO the watcher judges against is the same 24 hours the documentation and the cron agree on', () => {
    // The backup cron period IS the RPO (tests/unit/backupTargeting.test.ts asserts that pairing).
    // A watcher judging against a different number would either alarm on schedule or never alarm.
    expect(DEFAULT_RPO_HOURS).toBe(24);
    expect(script).toContain('DEFAULT_RPO_HOURS = 24');
    expect(readFileSync(join(ROOT, 'docs/RECOVERY.md'), 'utf8')).toContain('24 hours');
  });
});

describe('the rehearsal can only rehearse', () => {
  test('each simulated fault lands in the state it claims, and is marked simulated', () => {
    for (const [kind, state] of [
      ['red', 'red'],
      ['missing-artifact', 'missing-artifact'],
      ['stale', 'stale'],
      ['never-ran', 'never-ran'],
    ] as const) {
      const decision = simulatedHealth(kind, { now: NOW });
      expect(decision.state, `--simulate ${kind} produced "${decision.state}"`).toBe(state);
      expect(decision.healthy).toBe(false);
      expect(decision.simulated).toBe(true);
      expect(decision.simulation).toBe(kind);
    }
  });

  test('a simulated alert is labelled as one, in the title path and in the body', () => {
    const decision = simulatedHealth('stale', { now: NOW });
    const body = alertBody(decision, { repository: 'example/agrishop', workflowUrl: 'https://github.com/example/agrishop/actions/workflows/backup-database.yml' });
    expect(body).toContain('SIMULATED');
    expect(body).toMatch(/not a real backup failure/);
  });

  test('an unknown rehearsal is refused rather than silently treated as healthy', () => {
    expect(() => simulatedHealth('everything-is-fine', { now: NOW })).toThrow(/unknown simulation/);
  });
});

describe('the alert is actionable and is one issue, not a stream', () => {
  test('the marker identifies state and run, so a repeat check comments instead of opening a second issue', () => {
    const decision = decide({ runs: [run()], artifactsByRun: { 1001: [] } });
    const marker = alertMarker(decision);
    expect(marker).toBe('<!-- backup-watchdog state=missing-artifact run=1001 -->');
    const body = alertBody(decision, {
      repository: 'example/agrishop',
      workflowUrl: 'https://github.com/example/agrishop/actions/workflows/backup-database.yml',
    });
    expect(body).toContain(marker);
  });

  test('the body carries the run, the thresholds and the next step, not just a state name', () => {
    const decision = decide({ runs: [run({ conclusion: 'failure' })], artifactsByRun: {} });
    const body = alertBody(decision, {
      repository: 'example/agrishop',
      workflowUrl: 'https://github.com/example/agrishop/actions/workflows/backup-database.yml',
    });
    expect(body).toContain('https://github.com/example/agrishop/actions/runs/1001');
    expect(body).toMatch(/\| RPO of record \| 24 h \(\+3 h slack = 27 h\) \|/);
    expect(body).toMatch(/re-run it with `environment: production`/);
    expect(body).toContain('docs/RECOVERY.md');
    expect(body).toContain('backup-watchdog.yml');
  });

  test('the alert label is a constant, so the issue cannot be opened without the label that finds it', () => {
    expect(ALERT_LABEL).toBe('backup-alert');
    expect(script).toContain('labels: [ALERT_LABEL]');
    expect(script).toContain(`labels=\${ALERT_LABEL}`);
  });
});

describe('the watcher cannot see into production, and cannot stay quiet about that', () => {
  test('it holds no database credential and touches no database host', () => {
    for (const forbidden of ['PROD_DB_PASS', 'PROD_DB_HOST', 'QA_DB_PASS', 'supabase.co', 'gkswcfljxlutkfdvvqng', "from 'pg'", 'new Client(']) {
      expect(script, `the watcher gained "${forbidden}" — it must read the run's record, never the database`).not.toContain(forbidden);
    }
    expect(watchdogYml, 'the watcher workflow was given a database secret').not.toMatch(/_DB_(HOST|USER|PASS)/);
  });

  test('a watcher that cannot determine the answer reports unhealthy, not healthy', () => {
    // `unknown` is produced on an API error, and is deliberately on the unhealthy side of the
    // exit codes: a blind watcher reporting "ok" is the one outcome that would re-open the gap
    // this file closes.
    expect(script).toMatch(/state: 'unknown'/);
    expect(script).toMatch(/decision\.state === 'unknown' \? 2 : 1/);
    expect(script).toMatch(/a blind watcher must never report health/);
  });
});

describe('the wiring: a schedule, later than the backup it watches, that cannot rehearse itself', () => {
  test('the watchdog is scheduled daily, after the 02:00 UTC backup it judges', () => {
    const cron = watchdogYml.match(/^\s*-\s*cron:\s*'(\S+ \S+ \S+ \S+ \S+)'/m);
    expect(cron, 'the watchdog is not scheduled at all — the gap reopens').toBeTruthy();
    const [minute, hour] = cron![1].split(' ');
    expect(hour, 'the watchdog runs hourly-or-worse; one period must bound detection').not.toBe('*');
    expect(Number(hour), 'the watchdog runs before or with the backup it is watching').toBeGreaterThanOrEqual(3);
    expect(Number(minute)).toBeGreaterThanOrEqual(0);

    // The backup's own cron is asserted in backupTargeting.test.ts; this only pins the separation.
    const backupCron = backupYml.match(/^\s*-\s*cron:\s*'0 2 \* \* \*'/m);
    expect(backupCron, 'the backup schedule moved, so the watchdog position is no longer justified').toBeTruthy();
  });

  test('the automated run can only perform the real check', () => {
    // An empty default means a scheduled run has no fault to inject: rehearsals require a person.
    const input = watchdogYml.match(/simulate:[\s\S]*?default:\s*'(.*)'/);
    expect(input, 'the rehearsal input disappeared').toBeTruthy();
    expect(input![1], 'the rehearsal input has a default, so the schedule could simulate').toBe('');
    expect(watchdogYml).toContain('SIMULATE: ${{ inputs.simulate }}');
    expect(watchdogYml).toMatch(/if \[ -n "\$\{SIMULATE:-\}" \]/);
  });

  test('it has the permissions it needs and no more', () => {
    expect(watchdogYml).toMatch(/permissions:[\s\S]*?issues: write/);
    expect(watchdogYml).toMatch(/permissions:[\s\S]*?actions: read/);
    expect(watchdogYml).toMatch(/permissions:[\s\S]*?contents: read/);
    // Read-only on everything else: it must not be able to change the repository it reports on.
    for (const forbidden of ['contents: write', 'pull-requests: write', 'id-token: write', 'deployments: write']) {
      expect(watchdogYml, `the watcher was granted "${forbidden}"`).not.toContain(forbidden);
    }
  });

  test('the check runs the watcher, and its failure is not swallowed', () => {
    expect(watchdogYml).toContain('node scripts/check-backup-health.mjs');
    for (const swallow of ['continue-on-error', '|| true', '|| echo']) {
      expect(watchdogYml, `"${swallow}" would let a red backup look watched`).not.toContain(swallow);
    }
    expect(watchdogYml).toMatch(/set -euo pipefail/);
  });
});
