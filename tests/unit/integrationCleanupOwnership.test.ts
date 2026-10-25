/**
 * EC2 guard — integration cleanup removes only what the suite owns.
 *
 * WHY THIS FILE EXISTS (Phase-3 exit criterion EC2)
 *   `tests/setup/fixtures.ts` used to export `cleanupTestData()`, which deleted the transactions of
 *   the SHARED baseline rows — every sale, return, void, payment, credit request and movement of
 *   customerA/B/C and productA/B. Five suites called it, so five suites deleted rows they could not
 *   prove they created; a finishing file could wipe a sibling's row mid-assertion (measured: "Sale
 *   not found" on both halves of a concurrent void, an adjustment movement deleted mid-run, a
 *   credit request vanishing between create and approve). Forcing the integration suite serial made
 *   those collisions rarer, not impossible — and it made the sweep invisible instead of wrong.
 *
 * WHAT IS ASSERTED HERE
 *   1. the ownership planner refuses the shared baseline ids, an empty scope, and any value that is
 *      not a bare uuid — so no id can be interpolated into cleanup SQL from anything but a caller's
 *      own constant;
 *   2. every statement it plans is scoped by an owned id, deletes only transactional tables (never
 *      an identity row), and is ordered children-before-parents;
 *   3. no test file under `tests/` issues a DELETE that names a shared identity — as a constant
 *      (`QA_IDS.customerA`) or as an inlined uuid;
 *   4. no test file can fall back to the old behaviour: the sweep is not exported any more, none of
 *      the five suites calls it, and the suite that creates nothing deletes nothing;
 *   5. each rule is shown to fire on a sample of the defect it exists to catch (the same in-memory
 *      mutation style the other guards use), so a passing run cannot be an empty scan.
 *
 * WHAT IS NOT CLAIMED
 *   This is static evidence. It proves what the files say, not what a run does — the integration
 *   suite executes against QA and is deliberately not run from here. Files outside `tests/`
 *   (`scripts/`, `.github/workflows/`) are not in scope; `productionDataPolicy` and
 *   `e2eCleanupOwnership` cover those surfaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { planOwnedTransactionCleanup, SHARED_BASELINE_IDS, isSharedBaselineId } from '../setup/ownedCleanup';
import { QA_FIXTURE_IDS } from '../setup/qa-fixtures';

/** Owned ids for the planner tests. Unique across `tests/` — `fixtureIdCollision.test.ts` holds that. */
const OWNED_CUSTOMER = 'e0e00000-0000-0000-0000-00000000c001';
const OWNED_PRODUCT = 'e0e00000-0000-0000-0000-00000000d001';

/** The shared identities as a file writes them: the constant, or the uuid inlined. */
const SHARED_TOKENS: readonly string[] = [
  ...Object.keys(QA_FIXTURE_IDS).map((name) => `QA_IDS.${name}`),
  ...Object.keys(QA_FIXTURE_IDS).map((name) => `QA_FIXTURE_IDS.${name}`),
  ...SHARED_BASELINE_IDS,
];

/**
 * Every SELECT-shaped read is irrelevant here; this looks for the destructive shape.
 * Comments are stripped first: several files quote the old sweep in prose to explain why they own
 * their ids, and a sentence cannot delete a row.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\*.*$/gm, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

/** DELETE statements in a source file that name a shared identity. */
function sharedIdentitiesInDeletes(source: string): string[] {
  const stripped = stripComments(source);
  const found: string[] = [];
  for (const match of stripped.matchAll(/DELETE\s+FROM\s+([a-z_]+|\$\{[^}]+\})/gi)) {
    const rest = stripped.slice((match.index ?? 0) + match[0].length);
    const stop = rest.search(/[`;]/);
    const statement = match[0] + (stop === -1 ? rest.slice(0, 400) : rest.slice(0, stop));
    const hit = SHARED_TOKENS.find((token) => statement.includes(token));
    if (hit) found.push(`${match[1]} names ${hit}`);
  }
  return found;
}

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

const TEST_DIRS = ['e2e', 'integration', 'setup', 'unit'];

/**
 * Files that hold a shared-identity DELETE as SAMPLE DATA for their own detector, plus how many
 * hits each must produce. The count is asserted, so the exemption cannot quietly cover a new
 * offender: an extra hit fails the test below.
 */
const DETECTOR_SAMPLES: Record<string, number> = {
  'tests/unit/integrationCleanupOwnership.test.ts': 2, // the two samples at the bottom of this file
  'tests/unit/qaFixtureKeepList.test.ts': 1, // the shipped defect its account-delete rule must catch
};

/**
 * Arguments of every call that looks like a remover (`cleanup*`, `delete*`). `deleteFixtureUsers`
 * builds its DELETE internally from the ids it is handed, so a source scan for DELETE statements
 * cannot see it — the call site is the only place that decision is visible.
 */
const deleteCallArguments = (source: string): string[] =>
  [...stripComments(source).matchAll(/\b(?:cleanup|delete)[A-Za-z_]*\s*\(([\s\S]{0,300}?)\)/g)].map((m) => m[1]);

describe('the planner refuses what it cannot prove is owned', () => {
  it('refuses every shared baseline identity, by constant and by uuid', () => {
    for (const id of SHARED_BASELINE_IDS) {
      expect(isSharedBaselineId(id), `${id} must be recognised as the baseline`).toBe(true);
      expect(
        () => planOwnedTransactionCleanup({ customerIds: [id] }),
        `${id} is the shared baseline — cleanup must refuse it`,
      ).toThrow(/shared baseline/);
      expect(() => planOwnedTransactionCleanup({ productIds: [id] })).toThrow(/shared baseline/);
    }
    // The three identities a cleanup is most tempted to sweep: the seeded customers and products.
    for (const id of [
      QA_FIXTURE_IDS.customerA,
      QA_FIXTURE_IDS.customerB,
      QA_FIXTURE_IDS.customerC,
      QA_FIXTURE_IDS.productA,
      QA_FIXTURE_IDS.productB,
    ]) {
      expect(() => planOwnedTransactionCleanup({ customerIds: [id], productIds: [id] })).toThrow(
        /shared baseline/,
      );
    }
  });

  it('refuses a scope that owns nothing — a cleanup with no rows is a sweep in disguise', () => {
    expect(() => planOwnedTransactionCleanup({})).toThrow(/no owned ids/);
    expect(() => planOwnedTransactionCleanup({ customerIds: [], productIds: [] })).toThrow(/no owned ids/);
  });

  it('refuses every value that is not a bare uuid, so nothing can be interpolated through it', () => {
    const notIds = [
      '${table}', // the shape the E2E defect shipped with
      "${customerIds}",
      '',
      '%',
      '*',
      "x' OR '1'='1",
      "c0c00000-0000-0000-0000-000000000001'; DELETE FROM sales; --",
      'all',
    ];
    for (const value of notIds) {
      expect(
        () => planOwnedTransactionCleanup({ customerIds: [value] }),
        `"${value}" is not an owned id and must not reach a statement`,
      ).toThrow(/not a uuid/);
      expect(() => planOwnedTransactionCleanup({ productIds: [value] })).toThrow(/not a uuid/);
    }
  });

  it('de-duplicates an id given twice instead of widening the list', () => {
    const plan = planOwnedTransactionCleanup({ customerIds: [OWNED_CUSTOMER, OWNED_CUSTOMER] });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((sql) => sql.includes(OWNED_CUSTOMER))).toBe(true);
    expect(plan.join(' ').match(new RegExp(OWNED_CUSTOMER, 'g'))!.length).toBe(plan.length);
  });
});

describe('every planned statement is scoped, ordered and transactional', () => {
  const plan = planOwnedTransactionCleanup({ customerIds: [OWNED_CUSTOMER], productIds: [OWNED_PRODUCT] });

  /** The property under test, so the non-vacuity cases below use the same predicate. */
  const scopedToOwnedIds = (statements: readonly string[], owned: readonly string[]) =>
    statements.every(
      (sql) =>
        /^DELETE FROM [a-z_]+ WHERE /.test(sql) &&
        owned.some((id) => sql.includes(id)) &&
        SHARED_BASELINE_IDS.every((id) => !sql.includes(id)),
    );

  const at = (prefix: string) => plan.findIndex((sql) => sql.startsWith(prefix));

  it('is a non-empty list of deletes, each bounded by the owned id it names', () => {
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.filter((sql) => !sql.startsWith('DELETE FROM')).length, 'cleanup must not write').toBe(0);
    expect(scopedToOwnedIds(plan, [OWNED_CUSTOMER, OWNED_PRODUCT])).toBe(true);
    // ...and cannot reach a sibling's rows: no shared identity appears anywhere in the plan.
    expect(SHARED_BASELINE_IDS.some((id) => plan.join(' ').includes(id))).toBe(false);
  });

  it('never deletes an identity row, only the transactions hanging off one', () => {
    const identityTables = ['users', 'customers', 'products', 'product_variants', 'companies', 'shops', 'memberships'];
    const reachable = plan.filter((sql) => identityTables.some((t) => sql.startsWith(`DELETE FROM ${t} `)));
    expect(reachable, 'the row a suite inserted is removed by the suite, by name').toEqual([]);
  });

  it('orders every child before the parent it references', () => {
    const saleItems = at('DELETE FROM sale_items');
    const voids = at('DELETE FROM voids');
    const returnItems = at('DELETE FROM return_items');
    const returns = at('DELETE FROM returns');
    const sales = at('DELETE FROM sales');
    const movementOfSales = plan.findIndex((sql) => sql.startsWith('DELETE FROM inventory_movements') && sql.includes('FROM sales'));
    const movementOfVoids = plan.findIndex((sql) => sql.startsWith('DELETE FROM inventory_movements') && sql.includes('FROM voids'));
    const movementOfReturns = plan.findIndex((sql) => sql.startsWith('DELETE FROM inventory_movements') && sql.includes('FROM returns'));
    const reminderLogs = at('DELETE FROM reminder_logs');
    const reminderOccurrences = at('DELETE FROM reminder_occurrences');
    const reminderConfigs = at('DELETE FROM reminder_configs');

    for (const [name, index] of Object.entries({ saleItems, voids, returnItems, returns, sales, movementOfSales, movementOfVoids, movementOfReturns, reminderLogs, reminderOccurrences, reminderConfigs })) {
      expect(index, `${name} is missing from the plan`).toBeGreaterThanOrEqual(0);
    }
    expect(saleItems).toBeLessThan(sales);
    expect(movementOfSales).toBeLessThan(sales);
    expect(movementOfVoids).toBeLessThan(sales);
    expect(voids).toBeLessThan(sales);
    expect(returnItems).toBeLessThan(returns);
    expect(movementOfReturns).toBeLessThan(returns);
    expect(reminderLogs).toBeLessThan(reminderConfigs);
    expect(reminderOccurrences).toBeLessThan(reminderConfigs);
  });

  it('keeps the product and customer halves separate', () => {
    const productOnly = planOwnedTransactionCleanup({ productIds: [OWNED_PRODUCT] });
    expect(productOnly).toHaveLength(1);
    expect(productOnly[0]).toContain(OWNED_PRODUCT);
    expect(productOnly[0]).not.toContain(OWNED_CUSTOMER);

    const customerOnly = planOwnedTransactionCleanup({ customerIds: [OWNED_CUSTOMER] });
    expect(customerOnly.length).toBeGreaterThan(1);
    expect(customerOnly.some((sql) => sql.includes(OWNED_PRODUCT))).toBe(false);
    expect(customerOnly.some((sql) => sql.startsWith('DELETE FROM sales '))).toBe(true);
  });

  it('the scoping predicate is not vacuous: a widened or reassigned plan fails it', () => {
    // Inject the two failures the predicate exists to catch, in memory, one at a time.
    const whereRemoved = plan.map((sql, i) => (i === 0 ? sql.replace(' WHERE ', ' ') : sql));
    expect(scopedToOwnedIds(whereRemoved, [OWNED_CUSTOMER, OWNED_PRODUCT])).toBe(false);

    const sharedCustomerSwappedIn = plan.map((sql) => sql.replace(OWNED_CUSTOMER, QA_FIXTURE_IDS.customerA));
    expect(scopedToOwnedIds(sharedCustomerSwappedIn, [OWNED_CUSTOMER, OWNED_PRODUCT])).toBe(false);

    const identityRow = [`DELETE FROM customers WHERE id IN ('${OWNED_CUSTOMER}')`];
    expect(scopedToOwnedIds(identityRow, [OWNED_CUSTOMER])).toBe(true); // scoped…
    expect(
      identityRow.some((sql) => sql.startsWith('DELETE FROM customers ')),
      '…which is why the identity-table rule is separate from the scoping rule',
    ).toBe(true);
  });
});

describe('no test file destroys the shared baseline', () => {
  function scanTests(): Record<string, string[]> {
    const hits: Record<string, string[]> = {};
    for (const dir of TEST_DIRS) {
      for (const file of readdirSync(join(process.cwd(), 'tests', dir))) {
        if (!file.endsWith('.ts')) continue;
        const relative = `tests/${dir}/${file}`;
        const found = sharedIdentitiesInDeletes(read(relative));
        if (found.length) hits[relative] = found;
      }
    }
    return hits;
  }

  it('no DELETE in tests/ names a shared identity, directly or inlined', () => {
    const hits = scanTests();
    const offenders = Object.entries(hits).filter(([file]) => !(file in DETECTOR_SAMPLES));
    expect(
      offenders,
      'cleanup must delete the ids a suite created — the baseline rows are restored by reseeding, never removed',
    ).toEqual([]);
  });

  it('every exempted sample file still carries exactly the sample that justifies its exemption', () => {
    const hits = scanTests();
    for (const [file, expected] of Object.entries(DETECTOR_SAMPLES)) {
      expect(hits[file]?.length ?? 0, `${file} no longer carries its sample — remove the exemption`).toBe(expected);
    }
  });

  it('the scan is not vacuous, and a scoped delete is not an offender', () => {
    // The shape the sweep shipped with, verbatim: a shared identity inside a table-wide-ish delete.
    expect(
      sharedIdentitiesInDeletes(
        "await execSqlAsAdmin(`DELETE FROM sales WHERE customer_id IN ('${QA_IDS.customerA}', '${QA_IDS.customerB}')`);",
      ),
    ).not.toEqual([]);
    // An inlined uuid, for a file that never imported the constants.
    expect(
      sharedIdentitiesInDeletes("await sql(`DELETE FROM payments WHERE customer_id = '20000000-0000-0000-0000-000000000003'`);"),
    ).not.toEqual([]);
    // A delete of the suite's own row is the fix, not the defect.
    expect(sharedIdentitiesInDeletes("await execSql(`DELETE FROM customers WHERE id IN ('e0e00000-0000-0000-0000-00000000c001')`);")).toEqual([]);
    // Prose quoting the old sweep is not a statement.
    expect(
      sharedIdentitiesInDeletes("// it used to run DELETE FROM sales WHERE customer_id = '${QA_IDS.customerA}'\nconst ok = 1;"),
    ).toEqual([]);
  });
});

describe('the sweep cannot come back through the callers', () => {
  const SWEPT_SUITES = [
    'tests/integration/createOnceSafety.test.ts',
    'tests/integration/creditRequest.test.ts',
    'tests/integration/customerBalance.test.ts',
    'tests/integration/duplicateActionSafety.test.ts',
    'tests/integration/saleIdempotency.test.ts',
  ];

  it('the shared sweep is not exported any more', () => {
    const fixtures = read('tests/setup/fixtures.ts');
    expect(fixtures, 'cleanupTestData() deleted the baseline’s transactions; it must stay deleted').not.toMatch(
      /export\s+async\s+function\s+cleanupTestData/,
    );
    expect(fixtures, 'the owned cleanup must be the only cleanup the module offers').toContain(
      'export async function cleanupOwnedTransactions',
    );
    // Non-vacuity: the same pattern catches the version that existed.
    expect('export async function cleanupTestData() {').toMatch(/export\s+async\s+function\s+cleanupTestData/);
  });

  it('none of the five suites calls a shared-identity cleanup', () => {
    for (const file of SWEPT_SUITES) {
      const code = stripComments(read(file));
      expect(code, `${file} still calls a shared sweep`).not.toMatch(/\bcleanupTestData\s*\(/);
      expect(code, `${file} still imports a shared sweep`).not.toMatch(/import[^;]*cleanupTestData[^;]*;/);
    }
    // Non-vacuity: the predicate fires on the call shape that was there.
    expect('  await cleanupTestData();').toMatch(/\bcleanupTestData\s*\(/);
  });

  it('no remover is handed a shared identity, by call site or by helper', () => {
    for (const dir of ['integration', 'e2e']) {
      for (const file of readdirSync(join(process.cwd(), 'tests', dir))) {
        if (!file.endsWith('.ts')) continue;
        const relative = `tests/${dir}/${file}`;
        for (const args of deleteCallArguments(read(relative))) {
          expect(
            args,
            `${relative} passes a shared identity to a remover — ownership must be an owned id`,
          ).not.toMatch(/QA_(IDS|FIXTURE_IDS)\./);
        }
      }
    }
    // Non-vacuity: the argument scanner sees both shapes this rule forbids.
    expect(
      deleteCallArguments('await cleanupOwnedTransactions({ customerIds: [QA_IDS.customerA] });').join(' '),
    ).toContain('QA_IDS.customerA');
    expect(deleteCallArguments('await deleteFixtureUsers([QA_IDS.admin, QA_IDS.employee]);').join(' ')).toContain(
      'QA_IDS.admin',
    );
  });

  it('the suites that still clean transactions do it by their own ids', () => {
    for (const file of ['tests/integration/duplicateActionSafety.test.ts', 'tests/integration/saleIdempotency.test.ts']) {
      const code = stripComments(read(file));
      expect(code, `${file} must still remove the transactions it created`).toMatch(/cleanupOwnedTransactions\(/);
      expect(code, `${file} must not fall back to the shared constants for its cleanup`).not.toMatch(
        /cleanupOwnedTransactions\(\s*\{[^}]*QA_(IDS|FIXTURE_IDS)\./,
      );
    }
  });

  it('the suite that owns nothing deletes nothing', () => {
    const balance = stripComments(read('tests/integration/customerBalance.test.ts'));
    expect(balance, 'customerBalance reads the baseline; a delete there is a sweep by another name').not.toMatch(
      /\bDELETE\s+FROM\b/,
    );
    expect(balance, 'it must still restore what it reads').toContain('setupAllFixtures');
    // Non-vacuity: the same predicate fires on a delete.
    expect('await execSqlAsAdmin(`DELETE FROM customers WHERE id = \'x\'`);').toMatch(/\bDELETE\s+FROM\b/);
  });
});
