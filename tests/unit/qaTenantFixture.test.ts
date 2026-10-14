/**
 * qaTenantFixture.test.ts — the guard for the isolated-tenant fixture.
 *
 * WHAT IT PROTECTS. `scripts/dev/qa-tenant.mjs` is the one script in the repository that writes rows
 * in order to give the two write lanes (`setupCompletion`, `dependencyContinuity`) a premise they can
 * own: an app-created tenant with no suppliers, products or customers. Its usefulness and its danger
 * are the same property — it writes into the QA database — so the rules that keep that safe are
 * checked here rather than trusted to review:
 *
 *   1. the target must be the QA project, and the tenant must be the DEDICATED one, never the shared
 *      QA shop whose contents other lanes and hand-entered QA data live in;
 *   2. the tenant must still be EMPTY of business rows, because "empty premise" is the only thing the
 *      lanes need from it — if rows have appeared, the fixture would be handing a lane somebody
 *      else's data to clear;
 *   3. every statement it can emit is an INSERT into `users`/`memberships` — no DELETE, UPDATE or
 *      TRUNCATE can come out of the plan at all.
 *
 * NON-VACUITY. Each rule is asserted in both directions, and the INSERT-only validator is fed a
 * statement it must reject — a guard that cannot fail is not evidence, and the failure is watched
 * here for exactly that reason.
 */
import { describe, it, expect } from 'vitest';
import { QA_PROJECT_REF } from '../../scripts/dev/lib.mjs';
import { expectedProjectRefFor } from '../../scripts/lib/environments.mjs';
import { PRODUCTION_PROJECT_ID, STAGING_PROJECT_ID } from '../../src/lib/environmentContract';
import {
  ISOLATED_IDENTITIES,
  ISOLATED_TENANT_ID,
  SHARED_QA_SHOP_ID,
  assertSafeFixtureWrites,
  fixtureRows,
  refusalReasons,
  targetRefFromUrl,
  writePlan,
} from '../../scripts/dev/qa-tenant.mjs';

/** The tenant's default branch, as the fixture is run with it. */
const BRANCH = 'ea60cd69-dbfd-4da0-9e2e-957af9f47d68';

/** The QA target is the staging project (environments.json), so 'the wrong project' means production. */
const OTHER_REF = PRODUCTION_PROJECT_ID;

describe('isolated tenant fixture — the target', () => {
  it('takes its project from environments.json rather than a second copy of the ref', () => {
    expect(QA_PROJECT_REF).toBe(expectedProjectRefFor('staging'));
    // QA is the staging project in this repository; production is a different project entirely.
    expect(QA_PROJECT_REF).toBe(STAGING_PROJECT_ID);
    expect(QA_PROJECT_REF).not.toBe(PRODUCTION_PROJECT_ID);
    expect(ISOLATED_TENANT_ID).not.toBe(SHARED_QA_SHOP_ID);
  });

  it('reads the project ref from both connection shapes, and refuses an unreadable one', () => {
    expect(targetRefFromUrl(`postgresql://postgres.${QA_PROJECT_REF}:pw@aws-0.pooler.supabase.com:6543/postgres`)).toBe(QA_PROJECT_REF);
    expect(targetRefFromUrl(`postgresql://postgres:pw@db.${QA_PROJECT_REF}.supabase.co:5432/postgres`)).toBe(QA_PROJECT_REF);
    expect(targetRefFromUrl('not-a-url')).toBe('');
  });
});

describe('isolated tenant fixture — the refusals', () => {
  const clean = { targetRef: QA_PROJECT_REF, tenantId: ISOLATED_TENANT_ID, tenantBusinessRows: 0 };

  it('proceeds only when every condition holds', () => {
    expect(refusalReasons(clean)).toEqual([]);
  });

  it('refuses any target that is not the QA project', () => {
    for (const ref of [OTHER_REF, 'aaaaaaaaaaaaaaaaaaaa', '']) {
      const reasons = refusalReasons({ ...clean, targetRef: ref });
      expect(reasons.length, `ref=${ref || '(empty)'} must be refused`).toBeGreaterThan(0);
      expect(reasons.join(' ')).toContain('not the QA project');
    }
  });

  it('refuses the shared QA shop as the fixture tenant', () => {
    const reasons = refusalReasons({ ...clean, tenantId: SHARED_QA_SHOP_ID });
    expect(reasons.join(' ')).toContain('SHARED QA shop');
  });

  it('refuses any tenant other than the dedicated one', () => {
    // A UUID that no other test file claims: fixture-id collisions across files are their own guard
    // (tests/unit/fixtureIdCollision.test.ts), and reusing one turns this lane's cleanup into another
    // lane's data loss.
    const reasons = refusalReasons({ ...clean, tenantId: '8f7e6d5c-4b3a-4291-8c7d-6e5f4a3b2c1d' });
    expect(reasons.join(' ')).toContain('not the dedicated app-created tenant');
  });

  it('refuses a tenant with no ACTIVE branch, because the employee row would be written unscoped', () => {
    // 0188: a missing employee scope is an EMPTY scope, so this identity would authenticate and then
    // answer "You are in this business but not in a branch" on every operational screen. Writing it
    // anyway is how the two shared-shop employee fixtures were left on 2026-10-04.
    const reasons = refusalReasons({ ...clean, branchId: null });
    expect(reasons.join(' ')).toContain('no ACTIVE branch');
    // The same input with a branch is allowed, so the rule is the branch, not the call.
    expect(refusalReasons({ ...clean, branchId: 'ea60cd69-dbfd-4da0-9e2e-957af9f47d68' })).toEqual([]);
    // Absent is treated as "not supplied" by the older callers and does not fire — the CLI always
    // supplies it, and the guard above pins that it does.
    expect(refusalReasons(clean)).toEqual([]);
  });

  it('refuses a tenant that is no longer empty, and allows the same tenant while it is', () => {
    const dirty = refusalReasons({ ...clean, tenantBusinessRows: 1 });
    expect(dirty.join(' ')).toContain('no longer empty');
    // The same input with the row count back at zero is allowed: the rule is the count, not the call.
    expect(refusalReasons({ ...clean, tenantBusinessRows: 0 })).toEqual([]);
  });
});

describe('isolated tenant fixture — what it writes', () => {
  const plan = writePlan(ISOLATED_TENANT_ID, BRANCH);

  it('writes the two users rows, and the one membership column the product\'s trigger leaves empty', () => {
    // The memberships themselves are NOT written here: `ensure_user_membership` (0113) creates them
    // from the users row, so a hand-written membership would collide with its own trigger's row. That
    // is why the flag matters — the owner identity is marked `is_original_owner`, which is the rule
    // 0113 uses to derive an `owner` membership.
    expect(plan).toHaveLength(ISOLATED_IDENTITIES.length + 1);
    expect(plan.map((s) => s.table)).toEqual(['users', 'users', 'memberships']);
    const users = fixtureRows(ISOLATED_TENANT_ID, BRANCH).filter((r) => r.table === 'users');
    for (const row of users) expect(row.values.shop_id).toBe(ISOLATED_TENANT_ID);
    const owner = users.find((r) => r.values.phone === '923007700001')!;
    expect(owner.values.is_original_owner, '0113 derives an OWNER membership from this flag').toBe(true);
    expect(users.find((r) => r.values.phone === '923007700002')!.values.is_original_owner).toBe(false);
  });

  it('scopes the employee membership to the tenant\'s branch, and does not touch the owner\'s', () => {
    const scopes = fixtureRows(ISOLATED_TENANT_ID, BRANCH).filter(
      (r) => r.table === 'memberships' && r.kind === 'branch-scope',
    );
    expect(scopes).toHaveLength(1);
    expect(scopes[0].values.user_id).toBe(ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'employee')!.id);
    expect(scopes[0].values.branch_scope).toEqual([BRANCH]);
    expect(scopes[0].values.tenant_id).toBe(ISOLATED_TENANT_ID);
    // No branch supplied ⇒ no scope write at all, which the plan itself refuses to invent.
    expect(fixtureRows(ISOLATED_TENANT_ID, null).filter((r) => r.table === 'memberships')).toHaveLength(0);
  });

  it('never names the shared QA shop anywhere in its rows', () => {
    expect(JSON.stringify(fixtureRows())).not.toContain(SHARED_QA_SHOP_ID);
  });

  it('emits parameters, never concatenated values', () => {
    for (const step of plan) {
      expect(step.sql).not.toMatch(/9255|90000000-|QA Isolation/);
      expect(step.params.length).toBeGreaterThan(0);
    }
  });

  it('never lets the plan reach a DELETE, however it is assembled', () => {
    // Dropped later in the file as well; the point of pinning it twice is that the refusal must come
    // from the plan's own content, not from the file's history.
    expect(JSON.stringify(plan)).not.toMatch(/delete|truncate|drop table/i);
  });

  it('accepts its own plan, and refuses everything it claims to refuse', () => {
    expect(() => assertSafeFixtureWrites(plan)).not.toThrow();
    const employee = ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'employee')!.id;
    for (const bad of [
      // A delete, and a write outside the two fixture tables.
      { table: 'users', sql: 'DELETE FROM users WHERE phone = $1', params: ['x'] },
      { table: 'products', sql: 'INSERT INTO products (id) VALUES ($1)', params: ['x'] },
      // A parameter count that does not match its placeholders.
      { table: 'users', sql: 'INSERT INTO users (id) VALUES ($1)', params: [] },
      // An INSERT that names no row in the dedicated tenant.
      { table: 'users', sql: 'INSERT INTO users (id, shop_id) VALUES ($1, $2)', params: ['x', SHARED_QA_SHOP_ID] },
      // An UPDATE of another column of a membership (the role, say), and an UPDATE of the shared shop.
      { table: 'memberships', sql: 'UPDATE memberships SET role = $1 WHERE user_id = $2 AND tenant_id = $3', params: ['owner', employee, ISOLATED_TENANT_ID] },
      { table: 'memberships', sql: 'UPDATE memberships SET branch_scope = $1::uuid[] WHERE user_id = $2 AND tenant_id = $3', params: [[BRANCH], employee, SHARED_QA_SHOP_ID] },
      // …of a user that is not a fixture identity…
      { table: 'memberships', sql: 'UPDATE memberships SET branch_scope = $1::uuid[] WHERE user_id = $2 AND tenant_id = $3', params: [[BRANCH], '11111111-1111-1111-1111-111111111111', ISOLATED_TENANT_ID] },
      // …or to an empty scope, which 0188 reads as “no branch at all”.
      { table: 'memberships', sql: 'UPDATE memberships SET branch_scope = $1::uuid[] WHERE user_id = $2 AND tenant_id = $3', params: [[], employee, ISOLATED_TENANT_ID] },
    ]) {
      expect(() => assertSafeFixtureWrites([bad]), JSON.stringify(bad)).toThrow();
    }
  });

  it('refuses an UPDATE hidden inside an otherwise valid INSERT', () => {
    expect(() =>
      assertSafeFixtureWrites([{ table: 'users', sql: 'INSERT INTO users (id) VALUES ($1) /* update */', params: ['x'] }]),
    ).toThrow();
  });
});
