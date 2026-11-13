/**
 * productionBatchGate — the four preconditions that let one batch reach production.
 *
 * `docs/PRODUCTION_MIGRATION_PLAN.md` §7(a) is the owner's decision of 2026-10-16: production may
 * receive a NAMED, VERIFIED batch, and the blanket refusal stays for everything else. That decision
 * is only worth anything if each precondition can fail — so every test below has a passing half and a
 * failing half, and the failing half asserts *which* rule fired, never merely that something did.
 *
 * The gate is pure: it takes the reports, the files and the clock as data and opens nothing. That is
 * what lets the whole rule set be exercised here, in CI, with no credentials and no network — the
 * same property that lets `migrate.mjs` run it before it resolves a credential.
 */

import { describe, expect, test } from 'vitest';

import {
  FRESHNESS_WINDOW_MINUTES,
  describeGate,
  productionBatchGate,
} from '../../scripts/lib/production-batch-gate.mjs';

const NOW = Date.parse('2026-10-16T15:30:00.000Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60000).toISOString();

const FILES = [
  { filename: '0179_cost_price_is_the_owner_s_business.sql', version: '0179', sha256: 'aa11', bytes: 100, mtimeMs: NOW - 120 * 60000 },
  { filename: '0181_audit_rows_are_written_by_the_system_not_by_the_caller.sql', version: '0181', sha256: 'bb22', bytes: 200, mtimeMs: NOW - 120 * 60000 },
];
const BATCH = FILES.map((f) => f.filename);

/** A complete, fresh, internally consistent set: everything the gate wants, nothing more. */
function validInput(overrides: Record<string, unknown> = {}) {
  return {
    batch: [...BATCH],
    entries: FILES.map((f) => ({ ...f })),
    ledgerRows: [] as Array<{ version: string; sha256: string | null }>,
    verification: {
      status: 'PASS',
      exitCode: 0,
      generatedAt: minutesAgo(10),
      baseline: { environment: 'production', sha256Verified: true },
      selection: { resolved: [...BATCH] },
      files: FILES.map((f) => ({ filename: f.filename, version: f.version, sha256: f.sha256, failures: [] })),
    },
    backupManifest: {
      artifact: 'backup-production-gkswcfljxlutkfdvvqng-2026-10-16T15-25-00.sql',
      environment: 'production',
      generatedAt: minutesAgo(5),
      sha256: 'dd33',
      identity: { clusterId: '7666007964130682852' },
    },
    restoreReport: {
      artifact: 'backup-production-gkswcfljxlutkfdvvqng-2026-10-16T15-25-00.sql',
      manifest: { sha256: 'dd33', environment: 'production' },
      verdict: { integrity: true, replay: true, counts: true, structure: true, digests: true, auth: true },
      failures: [],
    },
    restoreReportMtimeMs: NOW - 4 * 60000,
    now: NOW,
    ...overrides,
  };
}

const reasons = (result: { problems: string[] }) => result.problems.join(' | ');

describe('a complete, fresh, matching set passes', () => {
  test('ok, with the whole batch to apply and nothing skipped', () => {
    const result = productionBatchGate(validInput() as never);
    expect(result.problems, reasons(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.toApply.map((e) => e.filename)).toEqual(BATCH);
    expect(result.alreadyRecorded).toEqual([]);
  });

  test('the context records the evidence, so a refusal can be read without the source', () => {
    const result = productionBatchGate(validInput() as never);
    expect(result.context.verification.status).toBe('PASS');
    expect(result.context.backup.sha256).toBe('dd33');
    expect(result.context.restore.verdict.integrity).toBe(true);
    expect(result.context.verificationAgeMinutes).toBeCloseTo(10, 1);
    // The renderer must not claim success for a refused run.
    const lines: string[] = [];
    describeGate(result, { log: (line: string) => lines.push(String(line)) });
    expect(lines.join('\n')).toContain('to apply:');
  });
});

describe('the batch itself: named, canonical, present, ascending, in position', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['no batch at all', { batch: [] }, /no batch named/],
    ['a file named twice', { batch: [BATCH[0], BATCH[0]] }, /same file twice/],
    ['a file that is not in the directory', { batch: [...BATCH, '9999_nope.sql'] }, /not in the migration directory/],
    ['a name without a version', { batch: ['cost_price.sql'] }, /without a 4-digit version/],
    ['the batch in descending order', { batch: [BATCH[1], BATCH[0]] }, /not in ascending version order/],
    [
      'a file before production’s recorded position',
      { batch: ['0016_something.sql'], entries: [...FILES, { filename: '0016_something.sql', version: '0016', sha256: 'cc', bytes: 1, mtimeMs: NOW - 1e7 }] },
      /before production's recorded position/,
    ],
  ];

  for (const [label, override, pattern] of cases) {
    test(`refused: ${label}`, () => {
      const result = productionBatchGate(validInput(override) as never);
      expect(result.ok).toBe(false);
      expect(reasons(result)).toMatch(pattern);
    });
  }

  test('the ascending rule is real, not a wording: a reordered batch is the unverified batch', () => {
    const straight = productionBatchGate(validInput() as never);
    const reversed = productionBatchGate(validInput({ batch: [BATCH[1], BATCH[0]] }) as never);
    expect(straight.ok).toBe(true);
    expect(reversed.ok).toBe(false);
  });
});

describe('the verification report is PASS, for THIS batch, against production, recently', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['no report', { verification: null }, /no verification report given/],
    ['a failing report', { verification: { ...validInput().verification, status: 'FAIL' } }, /not PASS/],
    ['an unverifiable report', { verification: { ...validInput().verification, status: 'UNVERIFIABLE' } }, /not PASS/],
    ['a non-zero exit code', { verification: { ...validInput().verification, exitCode: 1 } }, /exited 1, not 0/],
    ['a report against staging', { verification: { ...validInput().verification, baseline: { environment: 'staging', sha256Verified: true } } }, /not production/],
    ['a report whose baseline hash was never verified', { verification: { ...validInput().verification, baseline: { environment: 'production', sha256Verified: false } } }, /did not verify its baseline artifact/],
    ['a report for a different batch (extra file)', { verification: { ...validInput().verification, selection: { resolved: [...BATCH, '0190_x.sql'] } } }, /report-only|different files/],
    ['a report for a different batch (missing file)', { verification: { ...validInput().verification, selection: { resolved: [BATCH[0]] } } }, /batch-only|different files/],
    ['a report with no resolved list', { verification: { ...validInput().verification, selection: {} } }, /no resolved file list/],
    ['a report carrying SQL failures', { verification: { ...validInput().verification, files: [{ filename: BATCH[0], failures: ['boom'] }] } }, /SQL failures/],
    ['a report from long ago', { verification: { ...validInput().verification, generatedAt: minutesAgo(FRESHNESS_WINDOW_MINUTES + 5) } }, /minutes old \(limit/],
    ['a report dated in the future', { verification: { ...validInput().verification, generatedAt: minutesAgo(-30) } }, /dated in the future/],
    ['a report with no timestamp', { verification: { ...validInput().verification, generatedAt: undefined } }, /no readable generatedAt/],
  ];

  for (const [label, override, pattern] of cases) {
    test(`refused: ${label}`, () => {
      const result = productionBatchGate(validInput(override) as never);
      expect(result.ok).toBe(false);
      expect(reasons(result)).toMatch(pattern);
    });
  }

  test('refused: a file whose bytes differ from the hash the report recorded', () => {
    // The subtle one: every name matches, the report is fresh, and the bytes still changed. A verified
    // batch is a batch of verified bytes, so this has to fail.
    const edited = validInput();
    const result = productionBatchGate({
      ...edited,
      entries: edited.entries.map((e, i) => (i === 1 ? { ...e, sha256: 'different-bytes' } : e)),
    } as never);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toMatch(/changed after the verification report was produced/);
    expect(reasons(result)).toContain(FILES[1].filename);
  });

  test('passes: identical bytes with mtimes NEWER than the report (fresh checkout)', () => {
    // Run 42706653163 refused a byte-identical batch because a fresh GitHub Actions checkout sets
    // every file's mtime to the checkout time, after generatedAt. The gate compares content hashes,
    // so mtimes newer than the report are not an edit.
    const freshCheckout = validInput();
    const result = productionBatchGate({
      ...freshCheckout,
      entries: freshCheckout.entries.map((e) => ({ ...e, mtimeMs: NOW - 60_000 })),
    } as never);
    expect(result.problems, reasons(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('refused: a report that records no content hash (old format) — fail closed', () => {
    const noHashes = validInput();
    const result = productionBatchGate({
      ...noHashes,
      verification: {
        ...noHashes.verification,
        files: FILES.map((f) => ({ filename: f.filename, version: f.version, failures: [] })),
      },
    } as never);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toMatch(/records no content hash/);
  });

  test('the freshness window is a parameter, not a constant buried in a comparison', () => {
    const input = validInput({ windowMinutes: 5 });
    expect(productionBatchGate(input as never).ok).toBe(false); // the report is 10 minutes old
    expect(productionBatchGate({ ...input, verification: { ...input.verification, generatedAt: minutesAgo(1) } } as never).ok).toBe(true);
  });
});

describe('the backup exists, is production’s, and is recent', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['no manifest', { backupManifest: null }, /no backup manifest given/],
    ['a backup of another environment', { backupManifest: { ...validInput().backupManifest, environment: 'staging' } }, /not production/],
    ['a manifest with no sha256', { backupManifest: { ...validInput().backupManifest, sha256: undefined } }, /records no sha256/],
    ['an old backup', { backupManifest: { ...validInput().backupManifest, generatedAt: minutesAgo(FRESHNESS_WINDOW_MINUTES + 1) } }, /minutes old \(limit/],
    ['a manifest with no timestamp', { backupManifest: { ...validInput().backupManifest, generatedAt: undefined } }, /no readable generatedAt/],
  ];

  for (const [label, override, pattern] of cases) {
    test(`refused: ${label}`, () => {
      const result = productionBatchGate(validInput(override) as never);
      expect(result.ok).toBe(false);
      expect(reasons(result)).toMatch(pattern);
    });
  }
});

describe('that backup was restored into a throwaway database and passed', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['no restore report', { restoreReport: null }, /no restore-verification report given/],
    ['a report with no verdict', { restoreReport: { artifact: 'x', manifest: { sha256: 'dd33' }, verdict: {} } }, /no verdict/],
    ['a check that failed', { restoreReport: { artifact: 'x', manifest: { sha256: 'dd33' }, verdict: { integrity: true, counts: false } } }, /did not pass: counts/],
    ['recorded failures', { restoreReport: { artifact: 'x', manifest: { sha256: 'dd33' }, verdict: { integrity: true }, failures: [{ error: 'boom' }] } }, /failure\(s\)/],
    ['a report for another artifact', { restoreReport: { artifact: 'other.sql', manifest: { sha256: 'ee44' }, verdict: { integrity: true } } }, /not the backup named here/],
    ['a report with no artifact fingerprint', { restoreReport: { artifact: 'x', manifest: {}, verdict: { integrity: true } } }, /names no artifact sha256/],
    ['an old restore report', { restoreReportMtimeMs: NOW - (FRESHNESS_WINDOW_MINUTES + 1) * 60000 }, /minutes old \(limit/],
  ];

  for (const [label, override, pattern] of cases) {
    test(`refused: ${label}`, () => {
      const result = productionBatchGate(validInput(override) as never);
      expect(result.ok).toBe(false);
      expect(reasons(result)).toMatch(pattern);
    });
  }
});

describe('the ledger decides what is new, and only ever skips what matches', () => {
  test('not read yet → the partition is deferred rather than guessed', () => {
    const result = productionBatchGate(validInput({ ledgerRows: null }) as never);
    expect(result.ok).toBe(true);
    expect(result.context.ledger).toMatch(/not read yet/);
    expect(result.toApply.map((e) => e.filename)).toEqual(BATCH);
  });

  test('already recorded with a matching hash → skipped, not re-applied', () => {
    const result = productionBatchGate(
      validInput({ ledgerRows: [{ version: '0179', sha256: 'aa11' }] }) as never,
    );
    expect(result.ok).toBe(true);
    expect(result.alreadyRecorded.map((e) => e.filename)).toEqual([BATCH[0]]);
    expect(result.toApply.map((e) => e.filename)).toEqual([BATCH[1]]);
  });

  test('a whole batch already recorded → nothing to apply, and that is a pass', () => {
    const result = productionBatchGate(
      validInput({ ledgerRows: FILES.map((f) => ({ version: f.version, sha256: f.sha256 })) }) as never,
    );
    expect(result.ok).toBe(true);
    expect(result.toApply).toEqual([]);
    expect(result.alreadyRecorded).toHaveLength(FILES.length);
  });

  test('refused: recorded with a DIFFERENT hash — an applied file was edited', () => {
    const result = productionBatchGate(validInput({ ledgerRows: [{ version: '0179', sha256: 'zz99' }] }) as never);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toMatch(/already recorded with a different hash/);
  });

  test('refused: recorded without a hash — "already applied" is unprovable', () => {
    const result = productionBatchGate(validInput({ ledgerRows: [{ version: '0179', sha256: null }] }) as never);
    expect(result.ok).toBe(false);
    expect(reasons(result)).toMatch(/without a hash/);
  });
});

describe('every problem is reported, not just the first', () => {
  test('a run that is wrong in three ways says so three times', () => {
    const result = productionBatchGate(
      validInput({ batch: [], verification: null, backupManifest: null, restoreReport: null }) as never,
    );
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThanOrEqual(4);
    expect(reasons(result)).toMatch(/no batch named/);
    expect(reasons(result)).toMatch(/no verification report given/);
    expect(reasons(result)).toMatch(/no backup manifest given/);
    expect(reasons(result)).toMatch(/no restore-verification report given/);
  });
});
