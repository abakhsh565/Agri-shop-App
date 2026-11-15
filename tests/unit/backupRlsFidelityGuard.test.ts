/**
 * backupRlsFidelityGuard — the artifact reproduces the RLS state it found, never an assumption.
 *
 * `0315` added `public.login_bridge`: a server-only switch with no policies and no grants for
 * `anon`/`authenticated`, so RLS is deliberately off there. The generator nevertheless wrote
 * `enable row level security` for every table, so the restored copy disagreed with production
 * (`login_bridge.enabled`) and restore verification — the gate's own freshness proof — started
 * failing on every run. The backup is evidence only if restoring it reproduces the source exactly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { rlsStatement, rlsTotals } from '../../scripts/lib/rls-state.mjs';

const ROOT = process.cwd();
const backup = readFileSync(join(ROOT, 'scripts/backup-database.mjs'), 'utf8');
const restoreVerify = readFileSync(join(ROOT, 'scripts/restore-verify.mjs'), 'utf8');

describe('the RLS statement follows the database, not a default', () => {
  test('both states are rendered', () => {
    expect(rlsStatement('login_bridge', false)).toBe(
      'alter table public."login_bridge" disable row level security;',
    );
    expect(rlsStatement('users', true)).toBe('alter table public."users" enable row level security;');
  });

  test('an identifier that needs quoting is quoted, not interpolated raw', () => {
    expect(rlsStatement('odd"name', true)).toBe(
      'alter table public."odd""name" enable row level security;',
    );
  });

  test('the manifest can state how many tables had RLS off, and which', () => {
    const totals = rlsTotals([
      { relname: 'users', relrowsecurity: true },
      { relname: 'login_bridge', relrowsecurity: false },
      { relname: 'app_settings', relrowsecurity: true },
    ]);
    expect(totals).toEqual({ enabled: 2, disabled: 1, disabledTables: ['login_bridge'] });
  });
});

describe('the two scripts carry the rule', () => {
  test('the generator uses the state it read', () => {
    expect(backup).toContain("import { rlsStatement, rlsTotals } from './lib/rls-state.mjs';");
    expect(backup).toMatch(/select c\.relname, c\.relrowsecurity/);
    expect(backup).toMatch(/rlsStatement\(relname, relrowsecurity\)/);
    // The old unconditional emission is what failed the gate; it must not come back. The phrase
    // now lives only in scripts/lib/rls-state.mjs, where it is chosen per table.
    expect(backup).not.toContain('enable row level security');
  });

  test('the verifier refuses to call live drift a restore failure', () => {
    expect(restoreVerify).toContain('source changed during verification');
    expect(restoreVerify).toMatch(/const recheck = await digestFor/);
  });
});
