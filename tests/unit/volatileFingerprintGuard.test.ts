/**
 * volatileFingerprintGuard — a backfill the tool cannot predict is not data damage.
 *
 * The batch that finished red on 2026-11-15 was `0278`–`0308`. Applying it was correct: nine files
 * recorded, no rows lost. The alarm came from `0286`, which fills `users.agri_id` with
 * `generate_agri_id()` — a function that draws from `random()`. A rehearsal inside a rolled-back
 * transaction and the committed apply therefore produce different values for the same row, so their
 * digests differ by construction, and the post-apply check called that "rows changed differently from
 * its rehearsal". A gate that cries damage at an intended backfill is a gate people learn to ignore,
 * which is worse than no gate.
 *
 * What must stay true: excluding a column may never hide rows moving. So the digest is taken over the
 * remaining columns, the row count is still compared, and the primary-key set is compared on its own —
 * a delete, an insert or a swap is visible even though one column is out of scope.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  diffFingerprints,
  fingerprintTable,
  hashableColumns,
  parseVolatileColumns,
} from '../../scripts/lib/data-fingerprint.mjs';

const ROOT = process.cwd();
const migrate = readFileSync(join(ROOT, 'scripts/migrate.mjs'), 'utf8');
const workflow = readFileSync(join(ROOT, '.github/workflows/apply-production-migrations.yml'), 'utf8');
const rehearsal = readFileSync(join(ROOT, 'scripts/lib/data-rehearsal.mjs'), 'utf8');

/** A query stub that records the digest SQL so the projection can be inspected. */
function stubQuery(columns: string[]) {
  const digestSql: string[] = [];
  const query = async (sql: string) => {
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('information_schema.columns')) {
      return { rows: columns.map((column_name) => ({ column_name })) };
    }
    if (sql.includes('count(*)')) return { rows: [{ n: '3' }] };
    if (sql.includes('pg_index')) return { rows: [{ name: 'id' }] };
    if (sql.includes('string_agg(k::text')) return { rows: [{ h: 'key-digest' }] };
    if (sql.includes('row_to_json')) {
      digestSql.push(sql);
      return { rows: [{ h: 'row-digest' }] };
    }
    throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
  };
  return { query, digestSql };
}

describe('a declared volatile column leaves the digest and nothing else does', () => {
  test('the projection drops exactly the declared column', async () => {
    const withExclusion = stubQuery(['id', 'phone', 'agri_id']);
    await fingerprintTable(withExclusion.query as never, 'public.users', null, {
      excludeColumns: ['agri_id'],
    });
    expect(withExclusion.digestSql).toHaveLength(1);
    expect(withExclusion.digestSql[0]).toContain('"id"');
    expect(withExclusion.digestSql[0]).toContain('"phone"');
    expect(withExclusion.digestSql[0]).not.toContain('agri_id');

    // Non-vacuous: without the declaration the same table is digested over its volatile column, which
    // is precisely the comparison that raised the false alarm.
    const withoutExclusion = stubQuery(['id', 'phone', 'agri_id']);
    await fingerprintTable(withoutExclusion.query as never, 'public.users');
    expect(withoutExclusion.digestSql[0]).toContain('"agri_id"');
  });

  test('excluding every column is refused instead of measuring nothing', () => {
    expect(() => hashableColumns(['id', 'agri_id'], ['id', 'agri_id'])).toThrow(/proves nothing/);
    expect(hashableColumns(['id', 'agri_id'], ['agri_id'])).toEqual(['id']);
  });

  test('only protected tables, and a real column shape, are accepted', () => {
    expect(parseVolatileColumns('public.users.agri_id')).toEqual({
      excludeByTable: { 'public.users': ['agri_id'] },
      unknown: [],
    });
    expect(parseVolatileColumns('public.users.agri_id, public.memberships.updated_at')).toEqual({
      excludeByTable: { 'public.users': ['agri_id'], 'public.memberships': ['updated_at'] },
      unknown: [],
    });
    // A table this gate does not watch, a bare table, and a typo are all refused.
    expect(parseVolatileColumns('public.not_protected.col').unknown).toEqual(['public.not_protected.col']);
    expect(parseVolatileColumns('public.users').unknown).toEqual(['public.users']);
    expect(parseVolatileColumns('users.agri_id').unknown).toEqual(['users.agri_id']);
  });
});

describe('rows moving is still visible with a column out of scope', () => {
  const base = {
    table: 'public.users',
    count: 3,
    columns: ['id', 'phone', 'agri_id'],
    excluded: ['agri_id'],
    hashColumns: ['id', 'phone'],
    primaryKey: ['id'],
    digest: 'row-digest',
    keyDigest: 'key-digest',
  };

  test('identical fingerprints pass', () => {
    const diff = diffFingerprints({ 'public.users': base }, { 'public.users': { ...base } }, []);
    expect(diff.ok).toBe(true);
    expect(diff.changed).toEqual([]);
  });

  test('a swapped or deleted row fails on the key set, not on the digest alone', () => {
    const swapped = { ...base, keyDigest: 'other-keys' };
    const diff = diffFingerprints({ 'public.users': base }, { 'public.users': swapped }, []);
    expect(diff.ok).toBe(false);
    expect(diff.changed).toEqual(['public.users']);
    expect(diff.reasons).toEqual([
      { table: 'public.users', reason: 'key-set', before: 3, after: 3 },
    ]);
  });

  test('a row-count change fails before any digest discussion', () => {
    const grown = { ...base, count: 4 };
    const diff = diffFingerprints({ 'public.users': base }, { 'public.users': grown }, []);
    expect(diff.ok).toBe(false);
    expect(diff.reasons[0]).toMatchObject({ reason: 'row-count' });
  });

  test('a content change inside the hashed columns still fails', () => {
    const edited = { ...base, digest: 'edited' };
    const diff = diffFingerprints({ 'public.users': base }, { 'public.users': edited }, []);
    expect(diff.ok).toBe(false);
    expect(diff.reasons[0]).toMatchObject({ reason: 'row-content' });
  });

  test('an approved table still records the change instead of hiding it', () => {
    const edited = { ...base, digest: 'edited' };
    const diff = diffFingerprints({ 'public.users': base }, { 'public.users': edited }, ['public.users']);
    expect(diff.ok).toBe(true);
    expect(diff.allowedChanges).toEqual(['public.users']);
  });
});

describe('the tool and the workflow carry the declaration through', () => {
  test('the apply parses the flag, feeds both sides, and records it', () => {
    expect(migrate).toContain("parseVolatileColumns(flag('volatile-columns'))");
    expect(migrate).toContain('rehearseBatch(gate.toApply, approvals.names, volatile.excludeByTable)');
    expect(migrate).toContain('excludeByTable: volatile.excludeByTable');
    expect(migrate).toContain('volatileColumns: volatile.excludeByTable');
    // The post-apply comparison is the one that alarmed; it must use the same exclusion.
    expect(migrate).toMatch(/previous: rehearsal\.before,\s*\n\s*excludeByTable/);
  });

  test('the rehearsal applies the exclusion on the before side', () => {
    expect(rehearsal).toContain('before = await fingerprint(query, { excludeByTable });');
    expect(rehearsal).toContain('excludeByTable = {},');
  });

  test('the dispatched workflow can declare it', () => {
    expect(workflow).toContain('volatile_columns:');
    expect(workflow).toContain('--volatile-columns');
  });

  test('the batch carries the declaration next to its file list, and prepare prints it', () => {
    const releasePrepare = readFileSync(join(ROOT, 'scripts/dev/release-prepare.mjs'), 'utf8');
    expect(releasePrepare).toContain("volatile.txt");
    expect(releasePrepare).toContain('-f volatile_columns=');

    const declared = readFileSync(
      join(ROOT, 'production-batches/gap-0278-0308/volatile.txt'),
      'utf8',
    )
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line && !line.startsWith('#'));
    expect(declared).toEqual(['public.users.agri_id']);
    expect(parseVolatileColumns(declared.join(',')).unknown).toEqual([]);
  });
});
