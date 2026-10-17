/**
 * migrationDivergenceGuard — a recorded divergence explains one measured difference, never a class.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. `migrate verify` compares each file's sha256 with the hash the
 * database recorded. Some environments legitimately cannot hold the file on disk: staging applied a
 * narrower variant of 0220 and never ran 0224 at all (it is a production-lineage repair). The honest
 * way to say that is a record naming the version, the kind, and BOTH exact hashes — after which the
 * difference is reported as `diverged (recorded: <reason>)` on every run instead of as a failure.
 *
 * The dishonest way — and the one a "skip this version" list always degrades into — is a rule that
 * keeps explaining differences nobody re-measured. So the record is checked against the bytes on both
 * sides every time:
 *
 *   * the ledger's recorded hash must still be the one the record was written for;
 *   * the file's current hash must still be the one the record was written for;
 *   * and a record that no longer matches either is itself a reported problem (`staleDivergences`),
 *     not silence.
 *
 * NON-VACUITY. Every acceptance below is paired with the mutation that must re-open the failure:
 * editing the file after the record, re-recording the ledger after it, and a record for a version
 * that was never applied (or was). A guard that cannot fail is not a guard.
 */

import { describe, expect, test } from 'vitest';

// @ts-expect-error — plain ESM module, no types; the function is exercised as written.
import { compareWithLedger } from '../../scripts/lib/migrations.mjs';

type Entry = { version: string; filename: string; sha256: string };
type Row = { version: string; name?: string; sha256: string | null; source?: string };
type Divergence = {
  version: string;
  kind: 'superseded' | 'not-applicable';
  recorded_sha256: string;
  current_sha256: string;
  reason: string;
};

const entry = (version: string, sha256: string): Entry => ({
  version,
  filename: `${version}_a_file.sql`,
  sha256,
});

const dir = (...entries: Entry[]) => ({ entries, problems: [] });

const APPLIED = 'aaaaaaaaaaaa';
const ON_DISK = 'bbbbbbbbbbbb';
const EDITED_AGAIN = 'cccccccccccc';

const row = (version: string, sha256: string | null): Row => ({ version, name: 'a file', sha256, source: 'applied' });

const superseded = (recorded: string, current: string): Divergence => ({
  version: '0220',
  kind: 'superseded',
  recorded_sha256: recorded,
  current_sha256: current,
  reason: 'QA applied the narrower variant; the inserts are identical and only the assertions differ.',
});

const notApplicable = (current: string): Divergence => ({
  version: '0224',
  kind: 'not-applicable',
  recorded_sha256: '',
  current_sha256: current,
  reason: 'A production-lineage repair whose effect this environment already holds.',
});

describe('without a record, an edited applied file is a failure', () => {
  test('the mismatch is reported as changed', () => {
    // @ts-expect-error — untyped JS result
    const result = compareWithLedger(dir(entry('0220', ON_DISK)), [row('0220', APPLIED)]);
    expect(result.changed.map((c: { version: string }) => c.version)).toEqual(['0220']);
    expect(result.diverged).toEqual([]);
  });
});

describe('a superseded record explains exactly one pair of bytes', () => {
  test('it is accepted while both hashes still hold, and is named rather than hidden', () => {
    const result = compareWithLedger(
      dir(entry('0220', ON_DISK)),
      [row('0220', APPLIED)],
      [superseded(APPLIED, ON_DISK)],
    );
    expect(result.changed).toEqual([]);
    expect(result.staleDivergences).toEqual([]);
    expect(result.diverged.map((d: { version: string; kind: string }) => `${d.version}/${d.kind}`)).toEqual([
      '0220/superseded',
    ]);
  });

  test('editing the file again re-opens the failure — the record cannot cover a new edit', () => {
    const result = compareWithLedger(
      dir(entry('0220', EDITED_AGAIN)),
      [row('0220', APPLIED)],
      [superseded(APPLIED, ON_DISK)],
    );
    expect(result.changed.map((c: { version: string }) => c.version)).toEqual(['0220']);
    expect(result.diverged).toEqual([]);
    expect(result.staleDivergences.map((d: { why: string }) => d.why)).toEqual([
      'the file or the recorded statements changed since the divergence was recorded',
    ]);
  });

  test('re-recording the ledger after the record re-opens the failure too', () => {
    const result = compareWithLedger(
      dir(entry('0220', ON_DISK)),
      [row('0220', EDITED_AGAIN)],
      [superseded(APPLIED, ON_DISK)],
    );
    expect(result.changed).toHaveLength(1);
    expect(result.staleDivergences).toHaveLength(1);
  });

  test('a record that has nothing left to explain is reported as obsolete, not kept quiet', () => {
    const result = compareWithLedger(
      dir(entry('0220', APPLIED)),
      [row('0220', APPLIED)],
      [superseded(APPLIED, APPLIED)],
    );
    expect(result.changed).toEqual([]);
    expect(result.staleDivergences.map((d: { why: string }) => d.why)).toEqual([
      'the file and the ledger agree again; the divergence record is obsolete',
    ]);
  });
});

describe('a not-applicable record stands in for a version this lineage never ran', () => {
  test('the file is not pending, and it is named', () => {
    const result = compareWithLedger(dir(entry('0224', ON_DISK)), [row('0220', APPLIED)], [notApplicable(ON_DISK)]);
    expect(result.pending).toEqual([]);
    expect(result.diverged.map((d: { version: string }) => d.version)).toEqual(['0224']);
  });

  test('editing the file makes it pending again', () => {
    const result = compareWithLedger(dir(entry('0224', EDITED_AGAIN)), [row('0220', APPLIED)], [notApplicable(ON_DISK)]);
    expect(result.pending.map((e: { version: string }) => e.version)).toEqual(['0224']);
    expect(result.staleDivergences).toHaveLength(1);
  });

  test('a version that WAS applied cannot be called not-applicable', () => {
    const result = compareWithLedger(dir(entry('0224', ON_DISK)), [row('0224', ON_DISK)], [notApplicable(ON_DISK)]);
    expect(result.diverged).toEqual([]);
    expect(result.staleDivergences.map((d: { why: string }) => d.why)).toEqual([
      'the file and the ledger agree again; the divergence record is obsolete',
    ]);
  });

  test('a record whose file was deleted is reported', () => {
    const result = compareWithLedger(dir(entry('0220', APPLIED)), [row('0220', APPLIED)], [notApplicable(ON_DISK)]);
    expect(result.staleDivergences).toHaveLength(1);
  });
});
