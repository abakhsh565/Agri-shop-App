/**
 * The storage authorization lockdown stays locked.
 *
 * 0230 replaced production's demo-mode storage policies — four addressed to role PUBLIC that let any
 * anonymous caller holding the publishable key delete, overwrite or upload every image — with exactly
 * two: public read, and authenticated upload. It also dropped the bucket-wide authenticated
 * UPDATE/DELETE policies, because `src/lib/storage.ts` has no code path that updates or deletes an
 * object (every upload is a fresh random name with `upsert: false`).
 *
 * Every one of those facts is one edit away from silently coming back. These tests read the migration
 * text and fail when:
 *
 *   · 0230 stops dropping any of the PUBLIC write policies (by name or by catalogue sweep),
 *   · 0230 creates anything other than the intended read + upload policies,
 *   · a later migration re-creates an update/delete policy on storage.objects, or a public write,
 *   · the migration's own assertions disappear.
 *
 * The last test is the non-vacuity half: the scanner is shown a synthetic migration that re-opens the
 * hole and must flag it. A guard that only ever sees good files proves nothing.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase/migrations');
const LOCKDOWN = '0230_storage_images_are_read_publicly_and_written_by_no_one_anonymous.sql';
const BUCKETS = 'product-images, employee-photos, company-logos, customer-images';

const read = (file: string) => readFileSync(join(DIR, file), 'utf8');

/** SQL comments explain; they never execute. Both scanners read the executable text only. */
const executable = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

export type StoragePolicy = { name: string; command: string; roles: string[] };

/**
 * Every `create policy … on storage.objects` in a migration, with the command and the roles it is
 * addressed to. A statement with no `TO` clause is addressed to PUBLIC — that default is exactly how
 * `0022` opened the table, so it must be modelled rather than ignored.
 */
export function createdStoragePolicies(sql: string): StoragePolicy[] {
  const text = executable(sql).replace(/\s+/g, ' ');
  const out: StoragePolicy[] = [];
  const re =
    /create\s+policy\s+(?:"([^"]+)"|([a-zA-Z0-9_]+))\s+on\s+storage\.objects\s+for\s+(select|insert|update|delete|all)(?:\s+to\s+([^;]+?))?\s+(?:using|with\s+check)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const roles = (match[4] ?? 'public')
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .filter(Boolean);
    out.push({ name: match[1] ?? match[2], command: match[3].toLowerCase(), roles });
  }
  return out;
}

/** A policy that lets an anonymous caller write: command is a write, and its roles include PUBLIC. */
export function opensAnonymousWrite(sql: string): StoragePolicy[] {
  return createdStoragePolicies(sql).filter(
    (policy) =>
      ['insert', 'update', 'delete', 'all'].includes(policy.command) &&
      policy.roles.some((role) => role === 'public' || role === 'anon' || role === ''),
  );
}

/** Any policy that lets a client update or delete a stored object, whatever role it names. */
export function allowsClientMutation(sql: string): StoragePolicy[] {
  return createdStoragePolicies(sql).filter(
    (policy) =>
      ['update', 'delete', 'all'].includes(policy.command) &&
      policy.roles.some((role) => role !== 'service_role'),
  );
}

describe('0230 — storage images are read publicly and written by no anonymous caller', () => {
  const lockdown = read(LOCKDOWN);

  test('it drops every PUBLIC write policy through a catalogue sweep, not a name list', () => {
    // The sweep is what makes an unknown older name impossible to survive: any policy on
    // storage.objects whose command is a write and whose roles overlap PUBLIC or anon is dropped,
    // whatever it happens to be called. A future 0022-style policy cannot outlive this file.
    const sql = executable(lockdown);
    expect(sql).toMatch(
      /cmd in \('INSERT', 'UPDATE', 'DELETE', 'ALL'\)\s+and \(roles && array\['public', 'anon'\]::name\[\]\)/s,
    );
    expect(sql).toMatch(/execute format\('drop policy if exists %I on storage\.objects'/);
    // The one PUBLIC policy that stays would otherwise be duplicated: the read is kept under its
    // single intended name.
    expect(lockdown).toContain('drop policy if exists "public_all_storage_select"');
  });

  test('it drops the bucket-wide authenticated update and delete policies', () => {
    for (const name of [
      'images auth delete',
      'images auth update',
      'Authenticated users can delete their uploads',
      'Authenticated users can update their uploads',
    ]) {
      expect(lockdown, `${name} is no longer dropped`).toContain(`drop policy if exists "${name}"`);
    }
  });

  test('the only policies it creates are public read and authenticated upload, on the four buckets', () => {
    const created = createdStoragePolicies(lockdown);
    expect(created.map((p) => `${p.name}/${p.command}/${p.roles.join('+')}`).sort()).toEqual([
      'images auth write/insert/authenticated',
      'images public read/select/public',
    ]);
    // Both are restricted to the four image buckets, not to `storage.objects` as a whole.
    const bucketChecks = lockdown.match(/bucket_id = any \(array\['product-images'[^\]]*\]\)/g) ?? [];
    expect(bucketChecks.length).toBeGreaterThanOrEqual(2);
    expect(BUCKETS.split(', ').every((bucket) => lockdown.includes(`'${bucket}'`))).toBe(true);
  });

  test('it asserts the properties instead of assuming them', () => {
    const sql = executable(lockdown);
    expect(sql).toMatch(/raise exception '0230: an anonymous caller can still write storage\.objects/);
    expect(sql).toMatch(/raise exception '0230: an object can still be updated or deleted by a client role/);
    expect(sql).toMatch(/expected exactly one public read and one authenticated upload policy/);
  });

  test('no migration AFTER the lockdown re-opens storage.objects', () => {
    const later = readdirSync(DIR)
      .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file.slice(0, 4) > '0230')
      .sort();
    const offenders: string[] = [];
    for (const file of later) {
      for (const policy of opensAnonymousWrite(read(file))) {
        offenders.push(`${file}: ${policy.name} allows ${policy.command} to ${policy.roles.join('+')}`);
      }
      for (const policy of allowsClientMutation(read(file))) {
        offenders.push(`${file}: ${policy.name} allows clients to ${policy.command}`);
      }
    }
    expect(offenders, `a later migration re-opens storage:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('the scanner itself is not vacuous', () => {
  test('it flags a policy that lets PUBLIC delete, and accepts the intended read policy', () => {
    const bad = `create policy "public_all_storage_delete" on storage.objects
                   for delete using (bucket_id in ('product-images'));`;
    expect(opensAnonymousWrite(bad).map((p) => p.command)).toEqual(['delete']);

    const good = `create policy "images public read" on storage.objects
                    for select to public using (bucket_id = any (array['product-images']));`;
    expect(opensAnonymousWrite(good)).toEqual([]);
    expect(allowsClientMutation(good)).toEqual([]);
  });

  test('a missing TO clause counts as PUBLIC — the default 0022 relied on', () => {
    expect(
      opensAnonymousWrite(`CREATE POLICY "public_all_storage_update" ON storage.objects FOR UPDATE USING (true);`),
    ).toHaveLength(1);
    // 0022 does exactly this today (insert, update and delete — its select policy is a read); the
    // lockdown is what removes the result.
    expect(opensAnonymousWrite(read('0022_fix_all_rls_for_demo.sql')).map((p) => p.command).sort()).toEqual([
      'delete',
      'insert',
      'update',
    ]);
  });

  test('it treats a client-role delete as a mutation even when the policy names authenticated', () => {
    const authenticatedDelete = `create policy "images auth delete" on storage.objects
                                   for delete to authenticated using (bucket_id = 'product-images');`;
    expect(opensAnonymousWrite(authenticatedDelete)).toEqual([]);
    expect(allowsClientMutation(authenticatedDelete).map((p) => p.name)).toEqual(['images auth delete']);
  });

  test('comments cannot hide or invent a policy', () => {
    expect(opensAnonymousWrite(`-- create policy "x" on storage.objects for delete to public using (true);`)).toEqual([]);
  });
});
