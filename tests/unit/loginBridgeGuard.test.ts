/**
 * loginBridgeGuard — the demo-OTP login bridge may not reach production switched on.
 *
 * WHY THIS EXISTS. `0315` lets a database create the auth identity a real SMS sign-in would have
 * created, because the development stack has no SMS provider and an approved account there was
 * otherwise unsignable ("this number is invited, but its sign-in is not ready yet"). That is only
 * safe while it is a development switch: on any database that signs people in for real, mints a
 * working credential for a number from its public derivation. So the three properties that keep it
 * safe are asserted here, because a later migration could silently take any of them away:
 *
 *   1. The switch arrives OFF — the migration itself never enables it.
 *   2. No migration turns it on. A workflow may, and only the one that builds a demo-OTP bundle:
 *      `deploy-staging.yml` (VITE_OTP_DELIVERY: demo) has to, because that build signs in with the
 *      derived credentials and nothing else creates `auth.users` there; `deploy-production.yml`
 *      signs in with a delivered SMS and must never mention it.
 *   3. The functions stay server-only: SECURITY DEFINER, and EXECUTE revoked from every client role.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const BRIDGE_FILE = '0315_a_demo_login_gets_the_identity_an_sms_login_would.sql';

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const bridge = readFileSync(join(MIGRATIONS, BRIDGE_FILE), 'utf8');
const workflow = (name: string) => {
  const file = join(ROOT, '.github/workflows', name);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

describe('login bridge (0315)', () => {
  test('the switch is created switched off', () => {
    expect(bridge).toMatch(/create table if not exists public\.login_bridge/i);
    expect(bridge).toMatch(/enabled boolean not null default false/i);
    expect(bridge).toMatch(/values\s*\(true,\s*false,/i);
  });

  test('no migration enables it — only the development script may', () => {
    const enablers = files.filter((file) => {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      return /update\s+public\.login_bridge[\s\S]{0,120}enabled\s*=\s*true/i.test(sql) ||
        /insert\s+into\s+public\.login_bridge[\s\S]{0,160}\btrue\b\s*,\s*true/i.test(sql);
    });
    expect(enablers).toEqual([]);
  });

  test('the identity function is definer-only and revoked from every client role', () => {
    const fn = /create or replace function public\.dev_login_identity[\s\S]*?\$fn\$;/i.exec(bridge)?.[0] ?? '';
    expect(fn).toMatch(/security definer/i);
    expect(bridge).toMatch(
      /revoke execute on function public\.dev_login_identity\(text, uuid\) from public, anon, authenticated/i,
    );
  });

  test('only the demo-OTP workflow switches it on, and production never mentions it', () => {
    expect(workflow('deploy-staging.yml')).toMatch(/scripts\/dev\/login-bridge\.mjs enable --remote staging/);
    expect(workflow('deploy-staging.yml')).toMatch(/VITE_OTP_DELIVERY: demo/);
    expect(workflow('deploy-production.yml')).not.toMatch(/login-bridge/i);
  });

  test('a new account gets its login on insert, and a failed bridge cannot break the approval', () => {
    expect(bridge).toMatch(/after insert on public\.users/i);
    expect(bridge).toMatch(/perform public\.dev_login_identity\(new\.phone::text, new\.id\)/i);
    expect(bridge).toMatch(/exception when others then/i);
  });
});
