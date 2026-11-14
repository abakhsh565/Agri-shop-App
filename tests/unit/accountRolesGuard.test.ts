import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * THE RULE THIS PROTECTS
 *
 *   A shop has exactly TWO account roles: `admin` (the owner, who sees and controls
 *   everything) and `employee` (whose reach is the permissions their owner grants).
 *   Anything beyond those two is a ROLE — a per-shop permission bundle in
 *   `roles` + `memberships` — which the owner can create, edit, remove and assign.
 *
 * WHAT WENT WRONG, AND WHY IT COULD COME BACK QUIETLY
 *
 *   `user_role` shipped with a third label, `co_admin`, which was never a distinct job —
 *   it was a second name for the authority `admin` already carried. Because it was never
 *   asked on its own, every check was written as a pair: `role === 'admin' || role ===
 *   'co_admin'` in the app, and `v_caller_role IS DISTINCT FROM 'admin' AND ... IS
 *   DISTINCT FROM 'co_admin'` in the RPCs. Fifteen copies of one rule, in the layer that
 *   decides authorization, is fifteen places for it to drift.
 *
 *   Removing it is therefore not a rename: it is a decision about WHO MAY DO WHAT, and
 *   the failure mode of reintroducing it is silent. A single `|| role === 'co_admin'`
 *   added back to one of the fifteen sites would compile only if the type still allowed
 *   it — and if someone widens the type to make it compile, nothing else objects. That
 *   is the exact shape a guard is for.
 *
 * WHAT IS DELIBERATELY NOT SCANNED
 *
 *   `supabase/migrations/` up to and including 0167 — that history is the record of the
 *   label existing and being removed, and rewriting it would falsify it. Migrations
 *   numbered ABOVE 0167 are scanned, so a re-introduction is caught.
 *
 *   `EMPLOYEE_ONBOARDING_GAP_ANALYSIS.md` is a dated snapshot of the system as it was
 *   discovered. It is read, not executed. (The `dev-guide-extracted/` fork of the app that
 *   used to sit beside it was deleted in the P0 cleanup — it was a stale second copy of
 *   `src/`, not a source this guard needed to exempt.)
 *
 *   `android/**` and `dist-bundle/` are build output, regenerated from `src/`.
 */

const root = path.resolve(__dirname, '..', '..');

/** The migration that removed the label. Anything above this may not name it. */
const REMOVAL_MIGRATION = '0167';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Files under `src/` that still name the removed label. */
function srcOffenders(): string[] {
  const offenders: string[] = [];
  for (const file of walk(path.join(root, 'src'))) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    if (readFileSync(file, 'utf8').includes('co_admin')) {
      offenders.push(path.relative(root, file).replace(/\\/g, '/'));
    }
  }
  return offenders;
}

describe('account roles are admin and employee, and nothing else', () => {
  it('the shipped app never names the removed label', () => {
    expect(
      srcOffenders(),
      'co_admin was removed in migration 0167 — a shop has two account roles. Any account beyond ' +
        'admin/employee is a ROLE (a permission bundle in roles + memberships), not a third role. ' +
        'If this is intentional, it needs a new migration and the type widened deliberately.',
    ).toEqual([]);
  });

  it('UserRole is exactly two members', () => {
    const src = readFileSync(path.join(root, 'src/types/index.ts'), 'utf8');
    const m = src.match(/export type UserRole\s*=\s*([^;]+);/);
    expect(m, 'UserRole declaration not found in src/types/index.ts').toBeTruthy();

    const members = (m![1].match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, '')).sort();
    expect(
      members,
      'the account roles are the two below and only two — see migration 0167',
    ).toEqual(['admin', 'employee']);
  });

  it('no migration numbered after 0167 re-introduces it', () => {
    const dir = path.join(root, 'supabase/migrations');
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const version = file.slice(0, 4);
      if (version <= REMOVAL_MIGRATION) continue;
      if (readFileSync(path.join(dir, file), 'utf8').includes('co_admin')) {
        offenders.push(`supabase/migrations/${file}`);
      }
    }

    expect(
      offenders,
      `these migrations come after ${REMOVAL_MIGRATION}, which removed co_admin, and name it again`,
    ).toEqual([]);
  });

  it('the removal migration exists and proves itself', () => {
    const file = path.join(root, 'supabase/migrations/0167_two_account_roles.sql');
    expect(existsSync(file), '0167_two_account_roles.sql is missing').toBe(true);

    const sql = readFileSync(file, 'utf8');
    // The file must rebuild the type, demote rather than promote, and refuse to be
    // recorded unless the result is what it claims.
    expect(sql).toContain("CREATE TYPE public.user_role AS ENUM ('admin', 'employee')");
    expect(sql).toMatch(/UPDATE users SET role = 'employee' WHERE role::text = 'co_admin'/);
    expect(sql).toContain('0167 FAILED');

    // Nothing may quietly grant the old authority instead of removing it.
    expect(sql).not.toMatch(/SET role = 'admin'[\s\S]{0,80}co_admin/);
  });

  it('a fresh bootstrap creates the two-role enum, not the three-role one', () => {
    const files = [
      'COMPLETE_DATABASE_SETUP.sql',
      'ALL_MIGRATIONS_TO_RUN.sql',
      'scripts/gen-qa.cjs',
      'scripts/generate-qa-sql.cjs',
    ];

    for (const rel of files) {
      const src = readFileSync(path.join(root, rel), 'utf8');
      const enums = src.match(/user_role\s+AS ENUM\s*\(([^)]*)\)|user_role\s+as enum\s*\(([^)]*)\)/gi) ?? [];
      expect(enums.length, `${rel} no longer defines user_role — has it moved?`).toBeGreaterThan(0);

      for (const decl of enums) {
        expect(
          decl.replace(/\s+/g, ' '),
          `${rel} still bootstraps a user_role carrying the removed label`,
        ).not.toContain('co_admin');
      }
    }
  });

  it('the RPC reference snapshot carries only the two roles', () => {
    const rel = 'scripts/rpc-definitions.json';
    const src = readFileSync(path.join(root, rel), 'utf8');
    expect(
      src.includes('co_admin'),
      `${rel} still describes an authorization check against a role that does not exist`,
    ).toBe(false);
  });
});
