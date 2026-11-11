/**
 * localCiBaseline — the build that turns a production dump into the shipped
 * local-CI artifact must never ship real user data.
 *
 * WHY THIS FILE EXISTS
 *   `sanitizeDump` is the one place that decides what leaves the dump: it
 *   keeps only reference rows, drops auth/shop-requests/storage objects, and
 *   renames the demo shop. If a future change widened the keep list, dropped
 *   the rename, or miscounted a table, the artifact would silently carry
 *   real data into the repo — and `productionDataPolicy` would catch some of
 *   it, but not a renamed shop or a quietly added table. These tests feed the
 *   builder a synthetic dump shaped like the real one (same column counts,
 *   same COPY format) and prove the output contains exactly the reference
 *   rows and nothing else. The negative cases prove the checks are not
 *   vacuous: a short table and an unrenamed shop must both fail loudly.
 */
import { describe, expect, test } from 'vitest';

import {
  EXPECTED_REFERENCE_ROWS,
  measureStructure,
  parseForwardSpec,
  sanitizeDump,
} from '../../scripts/lib/local-ci-baseline.mjs';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SHOP = '00000000-0000-0000-0000-000000000001';
const BRANCH = '00000000-0000-0000-0000-000000000002';

function uuid(n: number): string {
  return `a${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`;
}

function copyBlock(table: string, columns: string[], rows: string[][]): string {
  return `COPY ${table} (${columns.join(', ')}) FROM stdin;\n${rows.map((r) => r.join('\t')).join('\n')}\n\\.\n`;
}

/** A synthetic dump shaped like the real one: exact reference-row counts, plus data that must be dropped. */
function syntheticDump(): string {
  const permissions = Array.from({ length: 32 }, (_, i) => [
    uuid(100 + i),
    `PERM_${i}`,
    'sales',
    'view',
    `Label ${i}`,
    '\\N',
    '2026-01-01 00:00:00+00',
  ]);
  const roles = ['Sales Employee', 'Sales Manager', 'Store Manager', 'Inventory Clerk'].map(
    (name, i) => [uuid(200 + i), TENANT, name, '\\N', 't', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'],
  );
  const rolePermissions = Array.from({ length: 59 }, (_, i) => [
    uuid(300 + i),
    uuid(200 + (i % 4)),
    uuid(100 + (i % 32)),
    '2026-01-01 00:00:00+00',
  ]);
  const appSettings = ['low_stock_threshold_default', 'expiry_warning_days', 'void_window_hours', 'credit_limit_override_policy', 'seed_kg_step'].map(
    (key, i) => [uuid(400 + i), SHOP, key, '10', '\\N', '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00'],
  );
  return [
    'CREATE TABLE public.permissions (id uuid, code text);',
    'CREATE TABLE public.roles (id uuid);',
    'CREATE TABLE public.role_permissions (id uuid);',
    'CREATE TABLE public.app_settings (id uuid);',
    'CREATE TABLE public.shops (id uuid, name text);',
    'CREATE TABLE public.branches (id uuid);',
    'CREATE TABLE auth.users (id uuid, encrypted_password text);',
    copyBlock(
      'public.permissions',
      ['id', 'code', 'module', 'action', 'label_en', 'label_ur', 'created_at'],
      permissions,
    ),
    copyBlock(
      'public.roles',
      ['id', 'tenant_id', 'name', 'description', 'is_system', 'created_at', 'updated_at'],
      roles,
    ),
    copyBlock('public.role_permissions', ['id', 'role_id', 'permission_id', 'created_at'], rolePermissions),
    copyBlock(
      'public.app_settings',
      ['id', 'shop_id', 'setting_key', 'setting_value', 'description', 'created_at', 'updated_at'],
      appSettings,
    ),
    copyBlock(
      'public.shops',
      ['id', 'name', 'phone', 'address', 'owner_id', 'created_at', 'join_code', 'marketplace_enabled', 'latitude', 'longitude', 'location_label', 'location_source'],
      [[SHOP, 'Default Shop', '\\N', '\\N', '\\N', '2026-08-24 21:37:09.170551+00', '\\N', 'f', '\\N', '\\N', '\\N', '\\N']],
    ),
    copyBlock(
      'public.branches',
      ['id', 'shop_id', 'name', 'created_at'],
      [[BRANCH, SHOP, 'Default Shop - Main', '2026-01-01 00:00:00+00']],
    ),
    copyBlock('storage.buckets', ['id', 'name', 'public'], [
      ['images', 'images', 't'],
      ['videos', 'videos', 't'],
      ['documents', 'documents', 't'],
      ['avatars', 'avatars', 't'],
    ]),
    // Data that must never reach the artifact.
    copyBlock('auth.users', ['id', 'encrypted_password'], [[uuid(900), 'not-a-real-hash']]),
    copyBlock('public.shop_requests', ['id', 'owner_name'], [[uuid(901), 'Real Person']]),
    copyBlock('storage.objects', ['id', 'bucket_id'], [[uuid(902), 'images']]),
  ].join('\n');
}

describe('sanitizeDump', () => {
  test('keeps exactly the reference rows, drops everything else, renames the demo shop', () => {
    const supplement = 'CREATE TABLE IF NOT EXISTS public.business_areas (id uuid);';
    const { artifact, report, problems } = sanitizeDump(syntheticDump(), supplement);
    expect(problems).toEqual([]);
    expect(report.keptRows).toEqual(EXPECTED_REFERENCE_ROWS);
    expect(artifact).toContain('AgriShop Local Development');
    // The shops row is renamed; the branches row keeps "Default Shop - Main"
    // (a branch name, not the demo shop identity) — so the check is the
    // tab-delimited shop name, not the substring.
    expect(artifact).not.toMatch(/\tDefault Shop\t/);
    // The contract is about DATA, not mentions: the real artifact itself
    // references auth.users and shop_requests inside function bodies. What
    // must never survive is a row block for them — or any of their values.
    expect(artifact).not.toContain('COPY auth.users');
    expect(artifact).not.toContain('COPY public.shop_requests');
    expect(artifact).not.toContain('COPY storage.objects');
    expect(artifact).not.toContain('not-a-real-hash');
    expect(artifact).not.toContain('Real Person');
    expect(artifact).toContain('business_areas');
    // The reference rows survive verbatim as INSERTs.
    expect(artifact).toContain('PERM_0');
    expect(artifact).toContain('Store Manager');
  });

  test('a short reference table is refused, not silently shipped', () => {
    // Drop one whole permission row: 31 rows against an expected 32.
    const lines = syntheticDump().split('\n');
    const idx = lines.findIndex((l) => l.includes('PERM_30'));
    lines.splice(idx, 1);
    const { problems } = sanitizeDump(lines.join('\n'), '');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(/permissions/);
  });

  test('an unrenamed shop is refused', () => {
    const { problems } = sanitizeDump(
      syntheticDump().replace('Default Shop', 'Some Other Shop'),
      '',
    );
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toMatch(/shop/i);
  });
});

describe('measureStructure', () => {
  test('counts public objects and ignores auth-schema ones', () => {
    const artifact = [
      'CREATE TABLE public.a (id uuid);',
      'CREATE TABLE auth.b (id uuid);',
      "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;",
      "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT 'x'::uuid; $$;",
      'CREATE VIEW public.v AS SELECT 1;',
      'CREATE INDEX idx_a ON public.a (id);',
      'CREATE POLICY "p" ON public.a FOR SELECT USING (true);',
      'CREATE TRIGGER trg AFTER INSERT ON public.a FOR EACH ROW EXECUTE FUNCTION public.f();',
    ].join('\n');
    expect(measureStructure(artifact)).toEqual({
      tables: 1,
      functions: 1,
      views: ['v'],
      indexes: 1,
      triggers: 1,
      policies: 1,
    });
  });
});

describe('parseForwardSpec', () => {
  const files = [
    '0009_a.sql',
    '0070_b.sql',
    '0071_c.sql',
    '0075_d.sql',
    '0076_e.sql',
    '0077_f.sql',
    '0078_g.sql',
    '0305_h.sql',
    '0233_i.sql',
    '0234_j.sql',
  ];

  test('expands singles and ranges in the given order', () => {
    const { files: out, problems } = parseForwardSpec('0070,0071,0075-0078,0305,0233-0234', files);
    expect(problems).toEqual([]);
    expect(out).toEqual([
      '0070_b.sql',
      '0071_c.sql',
      '0075_d.sql',
      '0076_e.sql',
      '0077_f.sql',
      '0078_g.sql',
      '0305_h.sql',
      '0233_i.sql',
      '0234_j.sql',
    ]);
  });

  test('refuses duplicates, unknown versions, backwards ranges, and empty specs', () => {
    expect(parseForwardSpec('0070,0070', files).problems.length).toBeGreaterThan(0);
    expect(parseForwardSpec('9999', files).problems.length).toBeGreaterThan(0);
    expect(parseForwardSpec('0078-0075', files).problems.length).toBeGreaterThan(0);
    expect(parseForwardSpec('', files).problems.length).toBeGreaterThan(0);
    expect(parseForwardSpec('abc', files).problems.length).toBeGreaterThan(0);
  });
});
