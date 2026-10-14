/**
 * qaBaselinePolicy.test.ts — the guard for the QA baseline DECLARATION.
 *
 * WHAT IT PROTECTS. `scripts/dev/qa-baseline.json` replaces a gate that demanded `qa:count` = 0. That
 * expectation was unreachable — 552 of the 687 measured rows are `audit_events`, which migration 0181
 * has the SYSTEM write and `cleanupOwnership.ts` deliberately never deletes — so the only way to
 * satisfy it was the cleaner's table-wide `DELETE FROM audit_events`. The replacement is only worth
 * having if it is at least as strict where it matters, and that is what this file pins:
 *
 *   • an undeclared table holding rows FAILS (so the declaration can never grow more permissive by a
 *     new table quietly appearing);
 *   • an `exact` table with MORE rows fails (a lane left something behind) and with FEWER rows also
 *     fails (rows disappeared — the defect the old count read as "cleaner");
 *   • a `zero` table with any row fails;
 *   • a `history` table passes at any size but is reported;
 *   • a fixture identity that is missing, or whose membership is not active, fails;
 *   • the dedicated tenant failing to stay empty fails, because that emptiness is the two write lanes'
 *     premise;
 *   • a table that EXISTS but was not observed fails, so the declaration is never checked against a
 *     partial picture.
 *
 * NON-VACUITY. Every rule is asserted in both directions on the same observation, and the real
 * declaration is checked for internal consistency (no unknown policy, no `exact` entry without a count
 * and a reason) — a guard that cannot fail is not evidence.
 */
import { describe, it, expect } from 'vitest';
import { readDeclaration, classifyBaseline } from '../../scripts/dev/qa-baseline.mjs';
import { QA_PROJECT_REF } from '../../scripts/dev/lib.mjs';
import { ISOLATED_IDENTITIES, SHARED_QA_SHOP_ID } from '../../scripts/dev/qa-tenant.mjs';

/**
 * The dedicated tenant's two phones, taken from the fixture module that owns them rather than typed in
 * again here. `tests/unit/fixtureIdCollision.test.ts` fails when two test files declare the same
 * fixture phone (the second insert would die on `users_phone_key`), and a second literal copy of these
 * numbers in a file that only needs them as DATA for the policy checker is exactly that collision —
 * this file does not insert a row for either identity.
 */
const PHONE_OWNER = ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'owner')!.phone;
const PHONE_EMPLOYEE = ISOLATED_IDENTITIES.find((i) => i.membershipRole === 'employee')!.phone;

const declaration = {
  projectRef: QA_PROJECT_REF,
  policies: {
    audit_events: { policy: 'history', observed: 552, why: 'the system writes them (0181)' },
    customers: { policy: 'exact', expected: 2, why: 'two hand-entered customers' },
    returns: { policy: 'zero', why: 'no lane leaves a return behind' },
  },
  fixtures: {
    users: [{ phone: '923001234567', why: 'the owner every lane signs in with' }],
    requireActiveMembership: true,
    companies: [{ id: '50000000-0000-0000-0000-000000000001', why: 'companyA, FK-referenced' }],
  },
  isolatedTenant: { id: '1e5f7e4b-7ed0-4787-8148-8f289fc1c107', mustBeEmpty: ['products', 'customers'] },
};

/** A clean observation that matches the declaration above exactly. */
function cleanObservation() {
  return {
    tables: { audit_events: 552, customers: 2, returns: 0 },
    absentTables: [],
    fixtures: {
      users: [{ phone: '923001234567', membershipStatus: 'active' }],
      companies: [{ id: '50000000-0000-0000-0000-000000000001' }],
    },
    isolatedTenant: { id: declaration.isolatedTenant.id, found: true, tables: { products: 0, customers: 0 } },
  };
}

describe('QA baseline policy — the matching case', () => {
  it('passes when every row is declared and every fixture is present', () => {
    const result = classifyBaseline(cleanObservation(), declaration);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    // The system-written table is reported, not silently ignored.
    expect(result.notes.join(' ')).toContain('audit_events');
  });
});

describe('QA baseline policy — drift in both directions', () => {
  it('fails when an exact table gains a row, and passes again when it is removed', () => {
    const grown = cleanObservation();
    grown.tables.customers = 3;
    const result = classifyBaseline(grown, declaration);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('customers: 3 row(s), declared 2');
    expect(result.failures.join(' ')).toContain('1 unexplained row(s) appeared');
    expect(classifyBaseline(cleanObservation(), declaration).ok).toBe(true);
  });

  it('fails when rows DISAPPEAR — deleting baseline rows is not cleanup', () => {
    const shrunk = cleanObservation();
    shrunk.tables.customers = 0;
    const result = classifyBaseline(shrunk, declaration);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('DISAPPEARED');
  });

  it('fails when a zero-policy table holds anything', () => {
    const dirty = cleanObservation();
    dirty.tables.returns = 1;
    expect(classifyBaseline(dirty, declaration).failures.join(' ')).toContain('returns: 1 row(s) where the declaration expects none');
  });

  it('fails on a table with rows that the declaration never mentions', () => {
    const undeclared = cleanObservation();
    undeclared.tables.sales = 4;
    const result = classifyBaseline(undeclared, declaration);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('sales: 4 row(s) in a table the declaration does not mention');
  });

  it('fails when a declared table exists but was not observed', () => {
    const partial = cleanObservation();
    delete partial.tables.customers;
    expect(classifyBaseline(partial, declaration).failures.join(' ')).toContain('absent from the observation');
  });

  it('accepts a declared table this database does not have', () => {
    const withAbsent = cleanObservation();
    withAbsent.absentTables = ['price_history'];
    const localDeclaration = {
      ...declaration,
      policies: { ...declaration.policies, price_history: { policy: 'zero', why: 'no flow writes it' } },
    };
    const result = classifyBaseline(withAbsent, localDeclaration);
    expect(result.failures).toEqual([]);
    expect(result.notes.join(' ')).toContain('this database has no such table');
  });

  it('does not bound system-written history, however large it grows', () => {
    const grown = cleanObservation();
    grown.tables.audit_events = 5000;
    expect(classifyBaseline(grown, declaration).ok).toBe(true);
  });
});

describe('QA baseline policy — the fixtures and the lanes\' premise', () => {
  it('fails when a keep-list identity is missing', () => {
    const gone = cleanObservation();
    gone.fixtures.users = [];
    expect(classifyBaseline(gone, declaration).failures.join(' ')).toContain('fixture user 923001234567 is MISSING');
  });

  it('fails when a fixture exists but its membership is not active', () => {
    const pending = cleanObservation();
    pending.fixtures.users = [{ phone: '923001234567', membershipStatus: 'pending' }];
    expect(classifyBaseline(pending, declaration).failures.join(' ')).toContain('not active');
  });

  it('fails when an FK-referenced fixture company is missing', () => {
    const gone = cleanObservation();
    gone.fixtures.companies = [];
    expect(classifyBaseline(gone, declaration).failures.join(' ')).toContain('fixture company');
  });

  it('fails when the dedicated tenant is no longer empty', () => {
    const filled = cleanObservation();
    filled.isolatedTenant.tables.products = 1;
    const result = classifyBaseline(filled, declaration);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain("premise is gone");
  });
});

describe('QA baseline policy — the fixtures\' work context', () => {
  const BRANCH = 'b17fd67c-44ff-4977-bbb4-79b96abf2edb';
  const OTHER_SHOP = '88415b7c-975a-41fa-8158-23b63d0cd779';
  const withContext = {
    ...declaration,
    fixtures: {
      ...declaration.fixtures,
      workContext: {
        why: 'the branch the employee fixtures work in, and the shop the owner fixture is working in',
        tenantId: SHARED_QA_SHOP_ID,
        branchId: BRANCH,
        ownerPhone: '923001234567',
        employeePhones: ['923001122334'],
      },
    },
    isolatedTenant: {
      ...declaration.isolatedTenant,
      identities: [
        { phone: PHONE_OWNER, membershipRole: 'owner' },
        { phone: PHONE_EMPLOYEE, membershipRole: 'employee', branchScope: 'required' },
      ],
    },
  };

  function contextObservation() {
    const observed = cleanObservation();
    observed.fixtures.workContext = {
      owner: { shopId: SHARED_QA_SHOP_ID, branchId: BRANCH },
      employees: [{ phone: '923001122334', membership: { role: 'employee', status: 'active', branchScope: [BRANCH] } }],
    };
    observed.isolatedTenant.identities = [
      { phone: PHONE_OWNER, membership: { role: 'owner', status: 'active', branchScope: null } },
      { phone: PHONE_EMPLOYEE, membership: { role: 'employee', status: 'active', branchScope: ['ea60cd69-dbfd-4da0-9e2e-957af9f47d68'] } },
    ];
    return observed;
  }

  it('passes when both the shop the owner works in and the branch the employee may work in are as declared', () => {
    const result = classifyBaseline(contextObservation(), withContext);
    expect(result.failures).toEqual([]);
    expect(result.notes.join(' ')).toContain('as declared');
  });

  it('fails when the owner fixture has been left working in another shop', () => {
    // The observed defect: `user_active_shops` pointed at the other tenant, so every lane signing in as
    // this account read that shop's — empty — screens and blamed the feature under test.
    const moved = contextObservation();
    moved.fixtures.workContext.owner = { shopId: OTHER_SHOP, branchId: BRANCH };
    const result = classifyBaseline(moved, withContext);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('not the declared');
    expect(result.failures.join(' ')).toContain(OTHER_SHOP);
  });

  it('fails when the owner fixture has no active-shop row at all', () => {
    const none = contextObservation();
    none.fixtures.workContext.owner = null;
    expect(classifyBaseline(none, withContext).failures.join(' ')).toContain('no active-shop row');
  });

  it('fails when an employee fixture is present but scoped to no branch (0188: empty means none)', () => {
    for (const scope of [null, []]) {
      const unscoped = contextObservation();
      unscoped.fixtures.workContext.employees = [
        { phone: '923001122334', membership: { role: 'employee', status: 'active', branchScope: scope } },
      ];
      const result = classifyBaseline(unscoped, withContext);
      expect(result.ok, `scope=${JSON.stringify(scope)} must fail`).toBe(false);
      expect(result.failures.join(' ')).toContain('not in a branch');
    }
  });

  it('fails when the dedicated tenant\'s identities are missing, or its employee has no scope', () => {
    const missing = contextObservation();
    missing.isolatedTenant.identities = [];
    expect(classifyBaseline(missing, withContext).failures.join(' ')).toContain('is MISSING');

    const unscopedEmployee = contextObservation();
    unscopedEmployee.isolatedTenant.identities = [
      { phone: PHONE_OWNER, membership: { role: 'owner', status: 'active', branchScope: null } },
      { phone: PHONE_EMPLOYEE, membership: { role: 'employee', status: 'active', branchScope: null } },
    ];
    expect(classifyBaseline(unscopedEmployee, withContext).failures.join(' ')).toContain('no branch scope');
  });
});

describe('the declaration file on disk', () => {
  const real = readDeclaration();

  it('targets the QA project and never the shared shop as the isolated tenant', () => {
    expect(real.projectRef).toBe(QA_PROJECT_REF);
    expect(real.isolatedTenant?.id).toBeTruthy();
    expect(real.isolatedTenant.id).not.toBe(SHARED_QA_SHOP_ID);
  });

  it('records a policy and a reason for every table, and a count for every exact table', () => {
    const policies = Object.entries(real.policies ?? {});
    expect(policies.length).toBeGreaterThan(10);
    for (const [table, rule] of policies) {
      expect(['history', 'exact', 'zero'], `${table} policy`).toContain(rule.policy);
      expect(rule.why, `${table} why`).toBeTruthy();
      if (rule.policy === 'exact') {
        expect(typeof rule.expected, `${table} expected`).toBe('number');
        expect(rule.expected, `${table} expected`).toBeGreaterThan(0);
      }
    }
    // The row that made the zero-row gate unattainable stays classified as history rather than being
    // declared an exact count, which a later run would then trip over.
    expect(real.policies.audit_events.policy).toBe('history');
  });

  it('declares the work context and the dedicated tenant\'s identities, so neither can be dropped silently', () => {
    // Non-vacuity for the new rules: without these the checks above would be skipped by absence rather
    // than satisfied by fact, which is the failure mode a declaration must never have.
    const context = real.fixtures?.workContext;
    expect(context, 'fixtures.workContext must be declared').toBeTruthy();
    expect(context.tenantId).toBeTruthy();
    expect(context.branchId).toBeTruthy();
    expect(context.ownerPhone).toBeTruthy();
    expect(context.employeePhones.length).toBeGreaterThan(0);
    expect(context.why).toBeTruthy();
    const identities = real.isolatedTenant?.identities ?? [];
    expect(identities.map((i: { membershipRole: string }) => i.membershipRole).sort()).toEqual(['employee', 'owner']);
    const employee = identities.find((i: { membershipRole: string }) => i.membershipRole === 'employee');
    expect(employee.branchScope).toBe('required');
  });

  it('declares the four keep-list identities and the FK-referenced supplier fixture', () => {
    const phones = (real.fixtures?.users ?? []).map((u: { phone: string }) => u.phone);
    expect(phones).toEqual(expect.arrayContaining(['923001234567', '923001122334', '923009999999', '923008888888']));
    expect(real.fixtures.requireActiveMembership).toBe(true);
    expect((real.fixtures?.companies ?? []).map((c: { id: string }) => c.id)).toContain('50000000-0000-0000-0000-000000000001');
  });
});
