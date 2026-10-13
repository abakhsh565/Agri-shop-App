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
  assertInsertsOnly,
  fixtureRows,
  refusalReasons,
  targetRefFromUrl,
  writePlan,
} from '../../scripts/dev/qa-tenant.mjs';

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

  it('refuses a tenant that is no longer empty, and allows the same tenant while it is', () => {
    const dirty = refusalReasons({ ...clean, tenantBusinessRows: 1 });
    expect(dirty.join(' ')).toContain('no longer empty');
    // The same input with the row count back at zero is allowed: the rule is the count, not the call.
    expect(refusalReasons({ ...clean, tenantBusinessRows: 0 })).toEqual([]);
  });
});

describe('isolated tenant fixture — what it writes', () => {
  const plan = writePlan();

  it('writes one users row and one memberships row per identity, inside the dedicated tenant', () => {
    expect(plan).toHaveLength(ISOLATED_IDENTITIES.length * 2);
    expect(plan.map((s) => s.table)).toEqual([
      'users', 'users', 'memberships', 'memberships',
    ]);
    for (const row of fixtureRows()) {
      if (row.table === 'memberships') expect(row.values.tenant_id).toBe(ISOLATED_TENANT_ID);
      if (row.table === 'users') expect(row.values.shop_id).toBe(ISOLATED_TENANT_ID);
    }
  });

  it('carries the owner membership the lane signs in with, and the employee its negative case needs', () => {
    const memberships = fixtureRows().filter((r) => r.table === 'memberships').map((r) => r.values.role);
    expect(memberships).toEqual(['owner', 'employee']);
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

  it('is INSERT-only, and the validator rejects what it claims to reject', () => {
    expect(() => assertInsertsOnly(plan)).not.toThrow();
    // Each of these must be refused: a delete, a write outside the two fixture tables, and a
    // statement whose parameter count does not match its placeholders.
    for (const bad of [
      { table: 'users', sql: 'DELETE FROM users WHERE phone = $1', params: ['x'] },
      { table: 'products', sql: 'INSERT INTO products (id) VALUES ($1)', params: ['x'] },
      { table: 'users', sql: 'INSERT INTO users (id) VALUES ($1)', params: [] },
    ]) {
      expect(() => assertInsertsOnly([bad]), JSON.stringify(bad)).toThrow();
    }
  });

  it('refuses an UPDATE hidden inside an otherwise valid INSERT', () => {
    expect(() =>
      assertInsertsOnly([{ table: 'users', sql: 'INSERT INTO users (id) VALUES ($1) /* update */', params: ['x'] }]),
    ).toThrow();
  });
});
