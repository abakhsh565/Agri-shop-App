import { describe, expect, it } from 'vitest';

import {
  PROTECTED_TABLES,
  diffFingerprints,
  fingerprintDatabase,
  fingerprintTable,
  normaliseTable,
  parseApprovals,
  parseTable,
} from '../../scripts/lib/data-fingerprint.mjs';

const fp = (count: number, digest: string, columns = ['id']) => ({ table: 'x', count, digest, columns });

describe('the protected table set', () => {
  it('covers accounts, catalogues, every transactional table, and images', () => {
    for (const table of [
      'public.users',
      'public.memberships',
      'public.customers',
      'public.products',
      'public.product_variants',
      'public.sales',
      'public.sale_items',
      'public.returns',
      'public.voids',
      'public.purchases',
      'public.customer_payments',
      'public.supplier_payments',
      'public.inventory_movements',
      'public.companies',
      'public.audit_events',
      'storage.objects',
    ]) {
      expect(PROTECTED_TABLES, table).toContain(table);
    }
  });

  it('accepts a bare table name in --data-change and refuses one it does not protect', () => {
    expect(normaliseTable('customers')).toBe('public.customers');
    const ok = parseApprovals('customers, public.sales');
    expect(ok.names).toEqual(['public.customers', 'public.sales']);
    expect(ok.unknown).toEqual([]);
    const bad = parseApprovals('customers,supabase_migrations.schema_migrations');
    expect(bad.names).toEqual([]);
    expect(bad.unknown).toEqual(['supabase_migrations.schema_migrations']);
  });

  it('parses only schema.table names', () => {
    expect(parseTable('public.sales')).toEqual({ schema: 'public', table: 'sales' });
    expect(parseTable('sales')).toBeNull();
    expect(parseTable('public.sales; drop table users')).toBeNull();
  });
});

describe('the comparison', () => {
  it('passes when nothing moved', () => {
    const before = { 'public.users': fp(3, 'aaa'), 'public.sales': fp(10, 'bbb') };
    const after = { 'public.users': fp(3, 'aaa'), 'public.sales': fp(10, 'bbb') };
    const diff = diffFingerprints(before, after, []);
    expect(diff.ok).toBe(true);
    expect(diff.unexpected).toEqual([]);
  });

  it('catches an inserted row even when the digest would collide', () => {
    const diff = diffFingerprints({ 'public.sales': fp(10, 'bbb') }, { 'public.sales': fp(11, 'bbb') }, []);
    expect(diff.ok).toBe(false);
    expect(diff.unexpected).toEqual(['public.sales']);
  });

  it('catches an UPDATE that leaves the row count alone', () => {
    const diff = diffFingerprints({ 'public.customers': fp(4, 'old') }, { 'public.customers': fp(4, 'new') }, []);
    expect(diff.ok).toBe(false);
    expect(diff.changed).toEqual(['public.customers']);
  });

  it('catches a deleted table, and never treats it as benign', () => {
    const diff = diffFingerprints({ 'public.customers': fp(4, 'old') }, {}, []);
    expect(diff.ok).toBe(false);
    expect(diff.missing).toEqual(['public.customers']);
  });

  it('allows exactly the tables the owner approved, and records them', () => {
    const before = { 'public.users': fp(3, 'a'), 'public.sales': fp(10, 'b') };
    const after = { 'public.users': fp(3, 'a'), 'public.sales': fp(10, 'moved') };
    const diff = diffFingerprints(before, after, ['public.sales']);
    expect(diff.ok).toBe(true);
    expect(diff.allowedChanges).toEqual(['public.sales']);
    expect(diff.unexpected).toEqual([]);
  });

  it('does not let one approval cover a second table', () => {
    const before = { 'public.users': fp(3, 'a'), 'public.sales': fp(10, 'b') };
    const after = { 'public.users': fp(4, 'a2'), 'public.sales': fp(10, 'b2') };
    const diff = diffFingerprints(before, after, ['public.sales']);
    expect(diff.ok).toBe(false);
    expect(diff.unexpected).toEqual(['public.users']);
  });

  it('ignores tables that did not exist before (a new table is not a data change)', () => {
    const diff = diffFingerprints({ 'public.users': fp(0, '') }, { 'public.users': fp(0, ''), 'public.new': fp(0, '') }, []);
    expect(diff.ok).toBe(true);
    expect(diff.appeared).toEqual(['public.new']);
  });
});

describe('the SQL the fingerprint asks for', () => {
  /** A query stub: enough to check the shape, not a database. */
  const stub = (columns: string[], count: string, digest: string, seen: string[]) => async (sql: string) => {
    seen.push(sql);
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('information_schema.columns')) return { rows: columns.map((c) => ({ column_name: c })) };
    if (sql.startsWith('select count(*)')) return { rows: [{ n: count }] };
    return { rows: [{ h: digest }] };
  };

  it('hashes every column, quoted, and orders by the row text so the digest is stable', async () => {
    const seen: string[] = [];
    const result = await fingerprintTable(stub(['id', 'total_paid'], '2', 'hash1', seen), 'public.customers');
    expect(result).toEqual({ table: 'public.customers', count: 2, columns: ['id', 'total_paid'], digest: 'hash1' });
    const hashSql = seen[seen.length - 1];
    expect(hashSql).toContain('"id", "total_paid"');
    expect(hashSql).toContain('order by row_to_json(s)::text');
    expect(hashSql).toContain('md5(');
  });

  it('keeps an additive column out of the "after" digest', async () => {
    const before = { 'public.customers': { table: 'public.customers', count: 2, columns: ['id'], digest: 'd1' } };
    const seen: string[] = [];
    const after = await fingerprintDatabase(stub(['id', 'pin_attempt_count'], '2', 'd1', seen), {
      tables: ['public.customers'],
      previous: before,
    });
    expect(after['public.customers'].columns).toEqual(['id']);
    const hashSql = seen.find((s) => s.includes('md5(')) ?? '';
    expect(hashSql).toContain('"id"');
    expect(hashSql).not.toContain('pin_attempt_count');
  });

  it('reports a table that does not exist as absent, not as zero rows', async () => {
    const query = async (sql: string) =>
      sql.includes('to_regclass') ? { rows: [{ present: false }] } : { rows: [] };
    const result = await fingerprintTable(query, 'public.ghost');
    expect(result.count).toBeNull();
  });
});
