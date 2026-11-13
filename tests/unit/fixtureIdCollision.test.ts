/**
 * No two test files may claim the same fixture UUID.
 *
 * WHY THIS EXISTS. Every integration suite seeds its own users/products/roles in
 * the ONE shared QA database, and cleans them up by id or by phone. When two files
 * declare the same identifier, the suites silently become aliases of each other:
 * whichever cleans up first deletes the row the other is still using.
 *
 * That is exactly what happened to `c3000000-…-0001`. `returnIntegrityGuards`
 * declares it as an owner with phone 923009550001, `employeeAccessOverrides`
 * declared it as an owner with phone 923009670099, and because its upsert did not
 * refresh `phone`, the row kept the other suite's number — so this suite's cleanup
 * deleted the row by phone while the other was mid-run. The surviving suite then
 * answered `NOT_AUTHORIZED: tenant access denied` on create_employee for an owner
 * it had just authorized: a test-infrastructure race wearing the product's clothes,
 * intermittent (about 1 run in 4) and easy to misread as a real authorization bug.
 *
 * It reads the declarations out of the files rather than importing them, so it keeps
 * working if a suite is refactored — and a UUID reused deliberately must be moved
 * into a shared fixture module and referenced from there.
 *
 * THE SHARED BASELINE HAS A SECOND CONTRACT (2026-10-18). The eleven seeded rows are declared once in
 * `tests/setup/qa-fixtures.ts`, and both seeders consume it. That module derives its INSERT column list
 * and its `ON CONFLICT … DO UPDATE SET` list from the declared rows, which is what makes "declared" and
 * "restored" the same set — the drift this replaced was `tests/e2e/helpers.ts` restoring product stock
 * but only customer names while `tests/setup/fixtures.ts` restored customer balances but only product
 * names. The block at the bottom holds an INDEPENDENT copy of the column contract and the id values, so
 * dropping a column from the declaration, dropping it from the generated SQL, or letting a seeder
 * restate its own INSERT all fail here rather than drifting silently in the shared database.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  FIXTURE_SQL,
  QA_FIXTURE_COLUMNS,
  QA_FIXTURE_CUSTOMERS,
  QA_FIXTURE_COMPANIES,
  QA_FIXTURE_IDS,
  QA_FIXTURE_PRODUCTS,
  QA_FIXTURE_VARIANTS,
} from '../setup/qa-fixtures';

/** Every .ts under tests/, excluding this guard and generated output. */
function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures' || entry.name === 'results') continue;
      out.push(...testFiles(full));
    } else if (entry.name.endsWith('.ts') && entry.name !== 'fixtureIdCollision.test.ts') {
      out.push(full);
    }
  }
  return out;
}

/** `const X = 'uuid'` / `X: 'uuid'` declarations, which is how fixtures are named here. */
const DECLARATION = /(?:const\s+|let\s+|\b)([A-Z][A-Z0-9_]{2,})\s*[:=]\s*'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/gi;

/**
 * Values that are shared BY DESIGN, and why each one is safe. Anything not listed
 * here must belong to exactly one test file.
 */
const SHARED_ON_PURPOSE = new Map<string, string>([
  // The seeded QA tenant and baseline rows. tests/setup/fixtures.ts and
  // tests/e2e/helpers.ts declare the SAME baseline on purpose — Playwright seeds it
  // through one and vitest through the other, and both must mean the same rows.
  ['00000000-0000-0000-0000-000000000001', 'the QA tenant (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000001', 'QA Admin (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000002', 'QA Employee (seeded baseline)'],
  ['10000000-0000-0000-0000-000000000003', 'QA Owner (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000001', 'QA Customer A (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000002', 'QA Customer B (seeded baseline)'],
  ['20000000-0000-0000-0000-000000000003', 'QA Customer C (seeded baseline)'],
  ['30000000-0000-0000-0000-000000000001', 'QA Product A (seeded baseline)'],
  ['30000000-0000-0000-0000-000000000002', 'QA Product B (seeded baseline)'],
  ['40000000-0000-0000-0000-000000000001', 'QA Variant A (seeded baseline)'],
  ['40000000-0000-0000-0000-000000000002', 'QA Variant B (seeded baseline)'],
  ['50000000-0000-0000-0000-000000000001', 'QA Supplier A (seeded baseline)'],
  // System roles are seeded rows suites REFERENCE; none of them creates or deletes one.
  ['a0000000-0000-0000-0000-000000000001', 'system role: Sales Employee'],
  ['a0000000-0000-0000-0000-000000000003', 'system role: Store Manager'],
  // Not a row at all: the nil UUID is used as a placeholder value in payloads.
  ['00000000-0000-0000-0000-000000000000', 'nil UUID placeholder'],
]);

describe('Fixture identity', () => {
  it('never lets two test files declare the same UUID', () => {
    const owners = new Map<string, Set<string>>();

    for (const file of testFiles(path.resolve(process.cwd(), 'tests'))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(DECLARATION)) {
        const [, name, id] = match;
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)!.add(`${rel}:${name}`);
      }
    }

    // Only ACROSS files: one file reusing an id for two of its own names is its
    // own business; two files owning one id is the defect.
    const collisions = [...owners.entries()]
      .filter(([id, where]) => {
        if (SHARED_ON_PURPOSE.has(id)) return false;
        return new Set([...where].map((w) => w.split(':')[0])).size > 1;
      })
      .map(([id, where]) => `${id} → ${[...where].join(', ')}`);

    expect(
      collisions,
      'two test files share a fixture UUID, so one suite\'s cleanup deletes the other\'s rows'
    ).toEqual([]);
  });

  /**
   * The same defect wears a second costume: two files declaring the same PHONE. `users.phone`
   * is unique, so the second file's insert dies on `users_phone_key` instead — and because
   * the suites insert with `ON CONFLICT (id) DO NOTHING`, the conflict arrives on a row the
   * file never names, which reads as an infrastructure error rather than a fixture collision.
   *
   * That is exactly what `tenantBoundarySweep` did on its first run: it reused
   * `923009790001`–`923009790003`, which `branchScopeEnforcement` already owns, and that suite
   * then failed as a whole file (11 tests skipped) while the new one passed. The UUID guard
   * could not see it. Numbers in the reserved QA ranges are literals, so they are checked the
   * same way.
   */
  it('never lets two test files declare the same fixture phone', () => {
    // A phone literal is 11–13 digits starting 92 (or 0 for the local form the app accepts).
    const PHONE = /(?<![0-9])(92[0-9]{9,11})(?![0-9])/g;
    const owners = new Map<string, Set<string>>();

    for (const file of testFiles(path.resolve(process.cwd(), 'tests'))) {
      const source = fs.readFileSync(file, 'utf-8');
      for (const match of source.matchAll(PHONE)) {
        const phone = match[1];
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        if (!owners.has(phone)) owners.set(phone, new Set());
        owners.get(phone)!.add(rel);
      }
    }

    // The four seeded fixture accounts belong to the shared baseline by design; every other
    // number must be declared by exactly one file.
    const SHARED_PHONES = new Set([
      '923001234567', // the QA owner (seeded baseline)
      '923009999999', // QA Admin (seeded baseline)
      '923008888888', // QA Employee (seeded baseline)
      '923001122334', // Sales Employee (seeded baseline)
      // The three seeded QA customers. `helpers.ts` and `tests/setup/fixtures.ts` must mean the
      // same rows (Playwright seeds through one, vitest through the other), and the unit suites
      // that reason about signals/recommendations read the same fixtures rather than seeding
      // their own copies — the same reason the seeded UUIDs are listed above.
      '923001111111', // QA Customer A (seeded baseline)
      '923002222222', // QA Customer B (seeded baseline)
      '923003333333', // QA Customer C (seeded baseline)
    ]);

    const collisions = [...owners.entries()]
      .filter(([phone, files]) => !SHARED_PHONES.has(phone) && files.size > 1)
      .map(([phone, files]) => `${phone} → ${[...files].join(', ')}`)
      .sort();

    expect(
      collisions,
      'two test files share a fixture phone, so the second insert dies on users_phone_key'
    ).toEqual([]);
  });
});

/**
 * The declared contract, restated independently of the module that implements it.
 *
 * If a column is removed from `qa-fixtures.ts` (or from the SQL it generates), this list and the
 * declaration disagree and the guard fails. If a new baseline column is genuinely needed, it is added
 * HERE first — that is the review step that stops a seeder quietly narrowing its restore again.
 */
const BASELINE = [
  {
    table: 'users',
    sql: FIXTURE_SQL.users,
    columns: ['id', 'name', 'phone', 'role', 'is_original_owner', 'is_active', 'shop_id'],
  },
  {
    table: 'companies',
    sql: FIXTURE_SQL.companies,
    columns: ['id', 'name', 'outstanding_payable', 'total_purchases', 'shop_id'],
  },
  {
    table: 'customers',
    sql: FIXTURE_SQL.customers,
    columns: [
      'id',
      'name',
      'phone',
      'credit_limit',
      'outstanding_balance',
      'total_purchases',
      'total_paid',
      'shop_id',
      'created_by',
    ],
  },
  {
    table: 'products',
    sql: FIXTURE_SQL.products,
    columns: ['id', 'name', 'company_id', 'category', 'stock_qty', 'shop_id'],
  },
  {
    table: 'product_variants',
    sql: FIXTURE_SQL.productVariants,
    columns: [
      'id',
      'product_id',
      'name',
      'selling_price',
      'cost_price',
      'unit_size',
      'low_stock_threshold',
      'stock_qty',
    ],
  },
] as const;

/** `INSERT INTO t (a, b)` → ['a', 'b']. */
function insertedColumns(sql: string): string[] {
  const match = /INSERT INTO\s+[a-z_]+\s*\(([^)]*)\)/i.exec(sql);
  if (!match) throw new Error(`no INSERT column list in: ${sql.slice(0, 120)}`);
  return match[1].split(',').map((column) => column.trim()).filter(Boolean);
}

/** The assignments of the conflict-update clause. */
function restoredAssignments(sql: string): string[] {
  const setAt = sql.toUpperCase().lastIndexOf('DO UPDATE SET');
  if (setAt === -1) throw new Error(`no DO UPDATE SET in: ${sql.slice(0, 120)}`);
  return sql
    .slice(setAt + 'DO UPDATE SET'.length)
    .split(',')
    .map((assignment) => assignment.trim())
    .filter(Boolean);
}

describe('the shared QA baseline — declared once, restored completely', () => {
  it('keeps the eleven ids the specs and cleanup protection key on', () => {
    // Restated literally: these values are premises (QA_IDS in specs, PROTECTED_QA_IDS in cleanup,
    // the keep-list phones). A refactor may move where they are declared, never what they are.
    expect(QA_FIXTURE_IDS).toEqual({
      shop: '00000000-0000-0000-0000-000000000001',
      admin: '10000000-0000-0000-0000-000000000001',
      employee: '10000000-0000-0000-0000-000000000002',
      customerA: '20000000-0000-0000-0000-000000000001',
      customerB: '20000000-0000-0000-0000-000000000002',
      customerC: '20000000-0000-0000-0000-000000000003',
      productA: '30000000-0000-0000-0000-000000000001',
      productB: '30000000-0000-0000-0000-000000000002',
      variantA: '40000000-0000-0000-0000-000000000001',
      variantB: '40000000-0000-0000-0000-000000000002',
      companyA: '50000000-0000-0000-0000-000000000001',
    });
  });

  for (const { table, sql, columns } of BASELINE) {
    it(`declares and restores every ${table} column`, () => {
      expect(
        [...QA_FIXTURE_COLUMNS[table as keyof typeof QA_FIXTURE_COLUMNS]],
        `${table}: the canonical declaration no longer holds the agreed columns`,
      ).toEqual([...columns]);

      expect(
        insertedColumns(sql),
        `${table}: the generated INSERT no longer lists the declared columns`,
      ).toEqual([...columns]);

      const assignments = restoredAssignments(sql);
      expect(
        assignments,
        `${table}: a declared column is not restored on conflict — that is the drift this guard exists for`,
      ).toHaveLength(columns.length - 1);
      for (const column of columns.filter((name) => name !== 'id')) {
        expect(assignments, `${table}.${column} is inserted but never restored`).toContain(
          `${column} = EXCLUDED.${column}`,
        );
      }
    });
  }

  it('restores the values the lanes reason about, not just the column names', () => {
    const customerB = QA_FIXTURE_CUSTOMERS.find((row) => row.id === QA_FIXTURE_IDS.customerB)!;
    expect(
      Number(customerB.outstanding_balance),
      'Quick Alerts exists because QA Customer B is over its limit',
    ).toBeGreaterThan(Number(customerB.credit_limit));

    const productB = QA_FIXTURE_PRODUCTS.find((row) => row.id === QA_FIXTURE_IDS.productB)!;
    expect(productB.stock_qty, 'the dashboard out-of-stock alert is this fixture row').toBe(0);

    const variantA = QA_FIXTURE_VARIANTS.find((row) => row.id === QA_FIXTURE_IDS.variantA)!;
    expect(variantA.stock_qty, 'voidSaleSafety restores stock to the declared 100').toBe(100);

    expect(
      QA_FIXTURE_COMPANIES[0].outstanding_payable,
      'doubleTapSafety resets the supplier payable to this value',
    ).toBe(15000);
  });

  it('is consumed by both seeders, and neither restates its own baseline SQL', () => {
    const seeders = [
      { file: 'tests/e2e/helpers.ts', executor: 'execSql' },
      { file: 'tests/setup/fixtures.ts', executor: 'execSqlAsAdmin' },
    ];

    for (const { file, executor } of seeders) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8');

      expect(source, `${file} must import the canonical declaration`).toMatch(
        /import\s*\{[^}]*FIXTURE_SQL[^}]*\}\s*from\s*'\.\.?\/(setup\/)?qa-fixtures'/s,
      );

      for (const key of ['users', 'companies', 'customers', 'productsAndVariants']) {
        expect(source, `${file} must seed ${key} from FIXTURE_SQL.${key}`).toContain(
          `${executor}(FIXTURE_SQL.${key})`,
        );
      }

      expect(
        source,
        `${file} still carries its own baseline INSERT — the two seeders can drift again`,
      ).not.toMatch(/INSERT INTO (users|customers|companies|products|product_variants)\b/i);
    }
  });
});
