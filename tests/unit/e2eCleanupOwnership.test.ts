/**
 * e2eCleanupOwnership — E2E teardown may delete only what the run it belongs to created.
 *
 * WHY THIS IS A GUARD AND NOT A STYLE RULE
 *   Measured on the shared QA database, 2026-10-13: `cleanupFixtures()` deleted 20 business tables
 *   wholesale and swallowed every error. Eight lanes believed to be read-only ran it; the QA
 *   baseline lost exactly the seven rows it targets (3 fixture customers + 2 products + 2 variants)
 *   while the deletes that would have destroyed hundreds of rows failed in silence. The baseline
 *   damage was invisible, and the near-miss was invisible too.
 *
 *   Every case below runs the real `cleanupFixtures()` through an injected statement runner that
 *   models the tables it deletes from, so the evidence is behaviour — including which rows SURVIVE,
 *   which is the half that was never checked before. No QA connection is opened: the test proves the
 *   helper's ownership rules without risking the dataset it is meant to protect.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { cleanupFixtures, trackOwned, trackOwnedObject, type OwnedObject } from '../e2e/helpers';
import {
  createOwnership,
  deleteSql,
  ownedCount,
  planCleanup,
  PROTECTED_QA_IDS,
  type Ownership,
} from '../e2e/cleanupOwnership';

type Row = Record<string, unknown>;

/** A statement runner that models the tables, and refuses anything that is not scoped by id. */
function fakeDb(initial: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(initial));
  const executed: string[] = [];
  const exec = async (sql: string): Promise<unknown[]> => {
    // Grandchildren: `... WHERE <col> IN (SELECT id FROM <parent> WHERE <pcol> IN (...))`.
    const via = /^DELETE FROM ([a-z_]+) WHERE ([a-z_]+) IN \(SELECT id FROM ([a-z_]+) WHERE ([a-z_]+) IN \(([^)]*)\)\)$/.exec(sql);
    if (via) {
      executed.push(sql);
      const [, table, column, parentTable, parentColumn, list] = via;
      const parentIds = new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));
      const ids = new Set(
        (tables[parentTable] ?? [])
          .filter((row) => parentIds.has(String(row[parentColumn] ?? '')))
          .map((row) => String(row.id)),
      );
      tables[table] = (tables[table] ?? []).filter((row) => !ids.has(String(row[column] ?? '')));
      return [];
    }
    const match = /^DELETE FROM ([a-z_]+) WHERE ([a-z_]+) IN \(([^)]*)\)$/.exec(sql);
    if (!match) throw new Error(`UNSCOPED STATEMENT: ${sql}`);
    executed.push(sql);
    const [, table, column, list] = match;
    const ids = new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));
    tables[table] = (tables[table] ?? []).filter((row) => !ids.has(String(row[column] ?? '')));
    return [];
  };
  return {
    exec,
    executed,
    rows: (table: string) => tables[table] ?? [],
    /** Tables whose remaining rows are shared with a pre-existing or other-run dataset. */
    dump: () => tables,
  };
}

const RUN_SALE = 'run-a-sale-1';
const OTHER_RUN_SALE = 'run-b-sale-1';
const OLD_SALE = 'hand-entered-sale-1';

function seeded() {
  return fakeDb({
    sales: [{ id: OLD_SALE }, { id: OTHER_RUN_SALE }, { id: RUN_SALE }],
    sale_items: [
      { id: 'item-old', sale_id: OLD_SALE },
      { id: 'item-other', sale_id: OTHER_RUN_SALE },
      { id: 'item-run', sale_id: RUN_SALE },
    ],
    voids: [{ id: 'void-old', sale_id: OLD_SALE }, { id: 'void-run', sale_id: RUN_SALE }],
    notifications: [{ id: 'notif-old' }, { id: 'notif-other' }, { id: 'notif-run' }],
    customers: [{ id: 'cust-old' }, { id: 'cust-run' }],
    companies: [{ id: PROTECTED_QA_IDS[4] }, { id: 'company-run' }],
    users: PROTECTED_QA_IDS.slice(0, 4).map((id) => ({ id })),
  });
}

describe('cleanup deletes what this run created, and only that', () => {
  test('removes records created by its own run', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);
    trackOwned(ownership, 'sales', RUN_SALE);
    trackOwned(ownership, 'notifications', 'notif-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('sales').map((r) => r.id)).not.toContain(RUN_SALE);
    expect(db.rows('sale_items').map((r) => r.sale_id)).not.toContain(RUN_SALE);
    expect(db.rows('voids').map((r) => r.sale_id)).not.toContain(RUN_SALE);
    expect(db.rows('notifications').map((r) => r.id)).not.toContain('notif-run');
  });

  test('leaves unrelated records in the same tables untouched', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('sales').map((r) => r.id), 'a hand-entered sale is not test data').toContain(OLD_SALE);
    expect(db.rows('sale_items').map((r) => r.sale_id)).toContain(OLD_SALE);
    expect(db.rows('voids').map((r) => r.sale_id)).toContain(OLD_SALE);
    expect(db.rows('notifications').map((r) => r.id)).toEqual(['notif-old', 'notif-other', 'notif-run']);
  });

  test('leaves records owned by another test run untouched', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('sales').map((r) => r.id), "another run's rows are not ours to delete").toContain(
      OTHER_RUN_SALE,
    );
    expect(db.rows('sale_items').map((r) => r.sale_id)).toContain(OTHER_RUN_SALE);
  });

  test('the four fixture accounts and companyA survive even if a lane registers them', async () => {
    const db = seeded();
    const ownership = createOwnership();
    const tracked = [
      ...trackOwned(ownership, 'users', PROTECTED_QA_IDS.slice(0, 4)),
      ...trackOwned(ownership, 'companies', PROTECTED_QA_IDS[4]),
    ];

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(tracked, 'a protected id must never enter the registry').toEqual([]);
    expect(db.rows('users').map((r) => r.id).sort()).toEqual([...PROTECTED_QA_IDS.slice(0, 4)].sort());
    expect(db.rows('companies').map((r) => r.id)).toContain(PROTECTED_QA_IDS[4]);
    expect(db.executed.join('\n'), 'protected-only buckets must produce no statement').not.toMatch(
      /companies|users/,
    );
  });

  test('registering a customer this run created removes its sales and grandchildren, and nobody else\'s', async () => {
    const db = fakeDb({
      customers: [{ id: 'cust-run' }, { id: 'cust-old' }],
      sales: [{ id: 'sale-run', customer_id: 'cust-run' }, { id: 'sale-old', customer_id: 'cust-old' }],
      sale_items: [{ id: 'item-run', sale_id: 'sale-run' }, { id: 'item-old', sale_id: 'sale-old' }],
      customer_payments: [{ id: 'pay-run', customer_id: 'cust-run' }, { id: 'pay-old', customer_id: 'cust-old' }],
      credit_limit_requests: [{ id: 'clr-run', customer_id: 'cust-run' }],
      return_items: [],
      returns: [],
      payments: [],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'customers', 'cust-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('sales').map((r) => r.id)).toEqual(['sale-old']);
    expect(db.rows('sale_items').map((r) => r.id)).toEqual(['item-old']);
    expect(db.rows('customer_payments').map((r) => r.id)).toEqual(['pay-old']);
    expect(db.rows('credit_limit_requests')).toEqual([]);
    expect(db.rows('customers').map((r) => r.id)).toEqual(['cust-old']);
  });

  test('registering a company this run created removes its purchases one hop down, and its own supplier payments', async () => {
    const db = fakeDb({
      companies: [{ id: 'company-run' }, { id: 'company-old' }],
      purchases: [{ id: 'purchase-run', company_id: 'company-run' }, { id: 'purchase-old', company_id: 'company-old' }],
      purchase_items: [
        { id: 'pi-run', purchase_id: 'purchase-run' },
        { id: 'pi-old', purchase_id: 'purchase-old' },
      ],
      supplier_payments: [
        { id: 'sp-run', company_id: 'company-run' },
        { id: 'sp-old', company_id: 'company-old' },
      ],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'companies', 'company-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('purchase_items').map((r) => r.id)).toEqual(['pi-old']);
    expect(db.rows('purchases').map((r) => r.id)).toEqual(['purchase-old']);
    expect(db.rows('supplier_payments').map((r) => r.id)).toEqual(['sp-old']);
    expect(db.rows('companies').map((r) => r.id)).toEqual(['company-old']);
    // The one-hop delete must precede the parent delete, or the FK blocks it. Needles are the
    // START of each statement — a substring match would hit the subquery inside the first one.
    const at = (prefix: string) => db.executed.findIndex((sql) => sql.startsWith(prefix));
    expect(at('DELETE FROM purchase_items')).toBeGreaterThanOrEqual(0);
    expect(at('DELETE FROM purchases WHERE company_id IN')).toBeGreaterThanOrEqual(0);
    expect(at('DELETE FROM purchase_items')).toBeLessThan(at('DELETE FROM purchases WHERE company_id IN'));
    expect(at('DELETE FROM purchases WHERE company_id IN')).toBeLessThan(at('DELETE FROM companies WHERE id IN'));
  });

  test('an override granted to a SHARED user is removed by its own row id, and the shared account stays', async () => {
    // The new path the access-UX lane needed: it grants an access exception to a fixture employee it
    // must never delete. The permission row is owned; the account it hangs off is not.
    const db = fakeDb({
      users: [{ id: PROTECTED_QA_IDS[2] }, { id: 'someone-elses-user' }],
      user_permissions: [
        { id: 'up-run', user_id: PROTECTED_QA_IDS[2] },
        { id: 'up-old', user_id: PROTECTED_QA_IDS[2] },
        { id: 'up-other', user_id: 'someone-elses-user' },
      ],
      memberships: [{ id: 'm-other', user_id: 'someone-elses-user' }],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'user_permissions', 'up-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('user_permissions').map((r) => r.id), 'only the registered row goes').toEqual([
      'up-old',
      'up-other',
    ]);
    expect(db.rows('users').map((r) => r.id)).toEqual([PROTECTED_QA_IDS[2], 'someone-elses-user']);
    expect(db.rows('memberships').map((r) => r.id), 'a membership nobody registered stays').toEqual([
      'm-other',
    ]);
    expect(db.executed.join('\n')).toContain("DELETE FROM user_permissions WHERE id IN ('up-run')");
    expect(db.executed.join('\n'), 'the shared account must never be named').not.toMatch(/DELETE FROM users/);
  });

  test('an owned customer and product are removed, their referenced neighbours are not', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'customers', 'cust-run');
    trackOwned(ownership, 'companies', 'company-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('customers').map((r) => r.id)).toEqual(['cust-old']);
    expect(db.rows('companies').map((r) => r.id)).toEqual([PROTECTED_QA_IDS[4]]);
  });
});

describe('ordering and what ownership is NOT', () => {
  test('children are deleted before their parents (the FK order is part of the contract)', async () => {
    const db = fakeDb({
      sales: [{ id: RUN_SALE }],
      sale_items: [{ id: 'item-run', sale_id: RUN_SALE }],
      voids: [{ id: 'void-run', sale_id: RUN_SALE }],
      sale_submissions: [{ id: 'sub-run', sale_id: RUN_SALE }],
      products: [{ id: 'product-run' }],
      product_variants: [{ id: 'variant-run', product_id: 'product-run' }],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);
    trackOwned(ownership, 'products', 'product-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    const at = (needle: string) => db.executed.findIndex((sql) => sql.includes(needle));
    // Each statement must EXIST as well as come first: `-1 < parentIndex` would pass vacuously.
    for (const child of ['FROM voids', 'FROM sale_items', 'FROM sale_submissions']) {
      expect(at(child), `${child} must be emitted`).toBeGreaterThanOrEqual(0);
      expect(at(child)).toBeLessThan(at('FROM sales'));
    }
    expect(at('FROM product_variants')).toBeGreaterThanOrEqual(0);
    expect(at('FROM product_variants')).toBeLessThan(at('FROM products'));
    expect(db.rows('sales')).toEqual([]);
    expect(db.rows('products')).toEqual([]);
  });

  test('historical audit rows are never touched unless a lane registered them', async () => {
    const db = fakeDb({
      audit_events: [{ id: 'historical-event-1' }, { id: 'historical-event-2' }],
      notifications: [{ id: 'notif-run' }],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'notifications', 'notif-run');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.rows('audit_events').map((r) => r.id)).toEqual(['historical-event-1', 'historical-event-2']);
    expect(db.executed.join('\n'), 'audit_events must not be named at all here').not.toMatch(
      /audit_events/,
    );
  });

  test('a test-flavoured NAME is not ownership — only a registered id is', async () => {
    const db = fakeDb({
      products: [
        { id: 'unregistered-product', name: 'QA Marketplace MUT2PG8O edited' },
        { id: 'registered-product', name: 'K plus' },
      ],
    });
    const ownership = createOwnership();
    trackOwned(ownership, 'products', 'registered-product');

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(
      db.rows('products').map((r) => r.name),
      'filtering by a name prefix would have deleted the first row — and it is not this run’s',
    ).toEqual(['QA Marketplace MUT2PG8O edited']);
  });
});

describe('cleanup fails loudly and repeats safely', () => {
  test('a failed delete is reported with the table and operation, and fails the run', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);
    trackOwned(ownership, 'notifications', 'notif-run');

    const failing = async (sql: string) => {
      if (sql.includes('sale_items')) throw new Error('permission denied for table sale_items');
      return db.exec(sql);
    };

    const error = await cleanupFixtures({ exec: failing, ownership }).then(
      () => null,
      (thrown: Error) => thrown,
    );

    expect(error, 'a swallowed failure is the defect this replaces').not.toBeNull();
    expect(error!.message).toMatch(/sale_items\.sale_id/);
    expect(error!.message).toMatch(/permission denied/);
    expect(error!.message).toMatch(/NOT clean/);
    // Every other step was still attempted: one blocked table must not skip the rest.
    expect(db.executed.join('\n')).toMatch(/DELETE FROM notifications/);
    // The registry survives a failed pass, so a retry can finish the job.
    expect(ownedCount(ownership)).toBe(2);

    await cleanupFixtures({ exec: db.exec, ownership });
    expect(ownedCount(ownership)).toBe(0);
    expect(db.rows('sales').map((r) => r.id)).not.toContain(RUN_SALE);
  });

  test('repeating cleanup is a no-op and damages nothing', async () => {
    const db = seeded();
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', RUN_SALE);

    await cleanupFixtures({ exec: db.exec, ownership });
    const afterFirst = db.executed.length;
    const snapshot = JSON.stringify(db.dump());

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.executed.length, 'a second pass must issue no statements').toBe(afterFirst);
    expect(JSON.stringify(db.dump()), 'unchanged state after the second pass').toBe(snapshot);
  });

  test('an empty registry produces no statements at all', async () => {
    const db = seeded();
    const ownership = createOwnership();

    await cleanupFixtures({ exec: db.exec, ownership });

    expect(db.executed).toEqual([]);
    expect(JSON.stringify(db.dump())).toBe(JSON.stringify(seeded().dump()));
  });

  test('the statement shape can never be table-wide (the runner rejects anything unscoped)', async () => {
    const ownership = createOwnership();
    trackOwned(ownership, 'sales', [RUN_SALE, OTHER_RUN_SALE]);
    const { steps } = planCleanup(ownership);

    for (const step of steps) {
      const sql = deleteSql(step);
      expect(sql).toMatch(/^DELETE FROM [a-z_]+ WHERE [a-z_]+ IN \(/);
      expect(sql).not.toMatch(/DELETE FROM [a-z_]+$/);
    }
    // Non-vacuity: the fake runner does throw on the shape this replaces.
    const db = fakeDb({ sales: [{ id: RUN_SALE }] });
    await expect(db.exec('DELETE FROM sales')).rejects.toThrow(/UNSCOPED STATEMENT/);
  });

  test('storage cleanup removes only objects this run tracked', async () => {
    const objects: OwnedObject[] = [];
    trackOwnedObject(objects, 'product-images', 'run-upload-1.png');
    const removed: string[] = [];

    const storage = {
      'run-upload-1.png': 'ours',
      'someone-elses.png': 'not ours',
    };
    const removeObject = async (object: OwnedObject) => {
      if (!(object.path in storage)) throw new Error('object not found');
      if (!objects.some((o) => o.path === object.path)) throw new Error('UNTRACKED OBJECT REMOVAL');
      removed.push(object.path);
      delete storage[object.path as keyof typeof storage];
    };

    await cleanupFixtures({ exec: async () => [], objects, removeObject });

    expect(removed).toEqual(['run-upload-1.png']);
    expect(Object.keys(storage)).toEqual(['someone-elses.png']);
    expect(objects).toEqual([]);
  });

  test('a storage failure is surfaced too, not ignored', async () => {
    const objects: OwnedObject[] = [];
    trackOwnedObject(objects, 'product-images', 'run-upload-2.png');

    await expect(
      cleanupFixtures({
        exec: async () => [],
        objects,
        removeObject: async () => {
          throw new Error('storage: access denied');
        },
      }),
    ).rejects.toThrow(/storage product-images\/run-upload-2\.png: storage: access denied/);
  });
});

describe('no lane can reach the old behaviour again', () => {
  const e2eDir = join(process.cwd(), 'tests/e2e');

  /**
   * Find every table-wide delete or TRUNCATE in a source file.
   *
   * The first version of this detector matched only a bare `DELETE FROM sales` ending the line, so
   * it did NOT catch the shape that actually shipped — `DELETE FROM ${table}` inside a loop, and
   * `\`DELETE FROM ${table}\`)` with trailing characters. Both are checked below, and the interpolated
   * form is treated as unverifiable rather than skipped: a table name the guard cannot see is exactly
   * where a table-wide delete hides.
   */
  function findUnscopedDeletes(source: string): string[] {
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (they quote the old defect)
      .replace(/^\s*\*.*$/gm, '') // JSDoc continuation lines, when read on their own
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\/.*$/gm, '');
    const found: string[] = [];
    for (const match of stripped.matchAll(/DELETE\s+FROM\s+([a-z_]+|\$\{[^}]+\})/gi)) {
      const rest = stripped.slice((match.index ?? 0) + match[0].length);
      const stop = rest.search(/[`'";\n]/);
      const segment = stop === -1 ? rest : rest.slice(0, stop);
      if (!/\bWHERE\b/i.test(segment)) found.push(`DELETE FROM ${match[1]}`);
    }
    for (const match of stripped.matchAll(/TRUNCATE(?:\s+TABLE)?\s+([a-z_]+|\$\{[^}]+\})/gi)) {
      found.push(`TRUNCATE ${match[1]}`);
    }
    return found;
  }

  test('the detector catches every shape the defect used, and not a scoped delete', () => {
    // The two shapes that shipped verbatim in helpers.ts.
    expect(findUnscopedDeletes('await execSql(`DELETE FROM ${table}`);')).toEqual(['DELETE FROM ${table}']);
    expect(findUnscopedDeletes('for (const t of tables) { await execSql(`DELETE FROM ${t}`); }')).toEqual([
      'DELETE FROM ${t}',
    ]);
    expect(findUnscopedDeletes('await execSql(`TRUNCATE TABLE sales CASCADE`);')).toEqual([
      'TRUNCATE sales',
    ]);
    // ...and does not fire on the scoped replacement, nor on a comment quoting the defect.
    expect(findUnscopedDeletes("await execSql(`DELETE FROM sales WHERE id IN ('a')`);")).toEqual([]);
    expect(findUnscopedDeletes('// it used to run DELETE FROM sales\nconst ok = 1;')).toEqual([]);
    expect(findUnscopedDeletes(' *   business tables (`DELETE FROM sales`, `DELETE FROM audit_events`)')).toEqual([]);
  });

  test('no E2E file issues a table-wide delete or a TRUNCATE', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(e2eDir).filter((f) => f.endsWith('.ts'))) {
      const found = findUnscopedDeletes(readFileSync(join(e2eDir, file), 'utf8'));
      for (const statement of found) offenders.push(`${file}: ${statement}`);
    }
    expect(offenders, 'cleanup must be scoped by owned id').toEqual([]);
  });

  test('no test suppresses a cleanup failure', () => {
    const offenders: string[] = [];
    for (const dir of ['e2e', 'integration', 'setup']) {
      for (const file of readdirSync(join(process.cwd(), 'tests', dir))) {
        if (!file.endsWith('.ts')) continue;
        const source = readFileSync(join(process.cwd(), 'tests', dir, file), 'utf8');
        if (/cleanupFixtures\(\)\s*\.catch/.test(source)) offenders.push(`tests/${dir}/${file}`);
      }
    }
    expect(offenders, 'a suppressed cleanup failure is a run that reports clean while dirty').toEqual(
      [],
    );
  });

  test('every spec that cleans up does so in an after hook, so a failed test still cleans', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(e2eDir).filter((f) => f.endsWith('.spec.ts'))) {
      const source = readFileSync(join(e2eDir, file), 'utf8');
      if (!/await cleanupFixtures\(/.test(source)) continue;
      if (!/after(All|Each)\(/.test(source)) offenders.push(file);
    }
    expect(offenders, 'cleanup outside an after hook never runs when a test fails').toEqual([]);
  });

  test('the vitest teardown refuses a target that is not QA', () => {
    const source = readFileSync(join(process.cwd(), 'tests/setup/global-teardown.ts'), 'utf8');
    // It deletes 34 tables; the sibling cleaner already refuses a non-QA target and this must too.
    expect(source).toMatch(/QA_PROJECT_REF = 'bpybjrjenwccowvtrevu'/);
    expect(source).toMatch(/targetRef !== QA_PROJECT_REF/);
    expect(source).toMatch(/refusing to run/);
    expect(source, 'a reported delete failure must fail the run').toMatch(
      /if \(failures\.length \|\| leftover\.length\)/,
    );
  });
});

/** Sanity: the module under test exports the ids it protects, and protects a non-trivial set. */
describe('the protected set itself', () => {
  test('names the four keep-list accounts and companyA, and is not empty', () => {
    const ownership: Ownership = createOwnership();
    expect(PROTECTED_QA_IDS.length).toBe(5);
    expect(trackOwned(ownership, 'users', PROTECTED_QA_IDS[0])).toEqual([]);
    expect(ownedCount(ownership)).toBe(0);
  });
});
