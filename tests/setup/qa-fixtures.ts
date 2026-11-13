/**
 * The shared QA baseline, declared ONCE.
 *
 * WHY THIS FILE EXISTS (measured 2026-10-18)
 *   Two seeders wrote the same eleven rows and restored DIFFERENT columns:
 *
 *     tests/e2e/helpers.ts   customers: name only        products: name + stock      variants: all fields
 *     tests/setup/fixtures.ts customers: all money fields products: name only        variants: name only
 *
 *   So neither was a floor. An E2E lane that paid QA Customer A left the balance changed for an
 *   integration suite (which reads `outstanding_balance`), and an integration suite that sold stock
 *   left the quantity changed for `dashboardScope` / `voidSaleSafety` (which read `stock_qty`).
 *   Whichever suite ran last decided what the next one saw, and both files agreed on the ids — which
 *   is exactly why the drift was invisible: the rows looked shared, the restores were not.
 *
 * THE RULE
 *   A declared row IS the restore. `upsert()` derives both the INSERT column list and the
 *   `ON CONFLICT … DO UPDATE SET` list from the row objects themselves, so a column cannot be
 *   declared and then silently omitted from the restore, and adding one to the declaration puts it
 *   in every seeder at once. `tests/unit/fixtureIdCollision.test.ts` holds an independent copy of
 *   the column contract and fails if this invariant or either seeder's consumption of it breaks.
 *
 * WHAT IS DELIBERATELY NOT RESTORED
 *   Anything the declaration does not name: `created_at`, `last_login_at`, `first_login_at`,
 *   `is_original_owner` on rows that do not declare it, and every row a lane creates. Reseeding
 *   repairs the eleven shared rows' own columns; it is not a table reset, and it never touches
 *   history the system wrote.
 *
 * THE VALUES ARE THE EXISTING ONES. They come from the two seeders this file replaces, which agreed
 * on every value; the ids are unchanged, because specs and cleanup protection key on them
 * (`PROTECTED_QA_IDS`, `QA_FIXTURE_KEEP` phones, `scripts/dev/qa-baseline.json`).
 */

/** The seeded QA tenant every fixture row belongs to. */
export const QA_SHOP_ID = '00000000-0000-0000-0000-000000000001';
/**
 * The fixture shop's sole active standard owner (Khalid Khan, 923001234567).
 *
 * `0280` allows exactly one active owner per shop, so suites that need owner power use this row
 * instead of creating one — and never INSERT/UPDATE/DELETE it. It was dropped from this object in
 * a refactor while the suites kept reading `QA_IDS.owner`; the value then read `undefined`, which
 * reached `@supabase/auth-js` as `createUser({ id: undefined })` and failed twelve integration
 * tests with "Expected parameter to be UUID but is not" instead of their real subject.
 */
export const QA_OWNER_ID = '10000000-0000-0000-0000-000000000003';
/** QA Admin — keep-list account (923009999999). */
export const QA_ADMIN_ID = '10000000-0000-0000-0000-000000000001';
/** QA Employee — keep-list account (923008888888). */
export const QA_EMPLOYEE_ID = '10000000-0000-0000-0000-000000000002';
export const QA_CUSTOMER_A_ID = '20000000-0000-0000-0000-000000000001';
/** Over its credit limit (26000 > 25000) on purpose: the dashboard's Quick Alerts exist because of it. */
export const QA_CUSTOMER_B_ID = '20000000-0000-0000-0000-000000000002';
export const QA_CUSTOMER_C_ID = '20000000-0000-0000-0000-000000000003';
export const QA_PRODUCT_A_ID = '30000000-0000-0000-0000-000000000001';
/** Out of stock on purpose: the dashboard's "out of stock" alert exists because of it. */
export const QA_PRODUCT_B_ID = '30000000-0000-0000-0000-000000000002';
export const QA_VARIANT_A_ID = '40000000-0000-0000-0000-000000000001';
export const QA_VARIANT_B_ID = '40000000-0000-0000-0000-000000000002';
export const QA_COMPANY_A_ID = '50000000-0000-0000-0000-000000000001';

/**
 * The twelve ids, under the names both suites already use (`QA_IDS` re-exports this object, so
 * `QA_IDS.shop` in a spec and `QA_IDS.customerA` in a helper mean the same value as before).
 */
export const QA_FIXTURE_IDS = {
  shop: QA_SHOP_ID,
  owner: QA_OWNER_ID,
  admin: QA_ADMIN_ID,
  employee: QA_EMPLOYEE_ID,
  customerA: QA_CUSTOMER_A_ID,
  customerB: QA_CUSTOMER_B_ID,
  customerC: QA_CUSTOMER_C_ID,
  productA: QA_PRODUCT_A_ID,
  productB: QA_PRODUCT_B_ID,
  variantA: QA_VARIANT_A_ID,
  variantB: QA_VARIANT_B_ID,
  companyA: QA_COMPANY_A_ID,
} as const;

/** A declared baseline row: column name → literal value. */
export type QaFixtureRow = Record<string, string | number | boolean>;

/**
 * The keep-list accounts. `phone` is part of the declaration because it is UNIQUE: the collision
 * guard treats a phone as a fixture identity, and an upsert that refreshed the id but not the phone
 * once left a row carrying another suite's number.
 */
export const QA_FIXTURE_USERS: readonly QaFixtureRow[] = [
  {
    id: QA_OWNER_ID,
    name: 'Khalid Khan',
    phone: '923001234567',
    role: 'admin',
    is_original_owner: true,
    is_active: true,
    shop_id: QA_SHOP_ID,
  },
  {
    id: QA_ADMIN_ID,
    name: 'QA Admin',
    phone: '923009999999',
    role: 'admin',
    is_original_owner: true,
    is_active: true,
    shop_id: QA_SHOP_ID,
  },
  {
    id: QA_EMPLOYEE_ID,
    name: 'QA Employee',
    phone: '923008888888',
    role: 'employee',
    is_original_owner: false,
    is_active: true,
    shop_id: QA_SHOP_ID,
  },
];

export const QA_FIXTURE_COMPANIES: readonly QaFixtureRow[] = [
  {
    id: QA_COMPANY_A_ID,
    name: 'QA Supplier A',
    outstanding_payable: 15000,
    total_purchases: 50000,
    shop_id: QA_SHOP_ID,
  },
];

export const QA_FIXTURE_CUSTOMERS: readonly QaFixtureRow[] = [
  {
    id: QA_CUSTOMER_A_ID,
    name: 'QA Customer A',
    phone: '923001111111',
    credit_limit: 50000,
    outstanding_balance: 30000,
    total_purchases: 80000,
    total_paid: 50000,
    shop_id: QA_SHOP_ID,
    created_by: 'QA',
  },
  {
    id: QA_CUSTOMER_B_ID,
    name: 'QA Customer B',
    phone: '923002222222',
    credit_limit: 25000,
    outstanding_balance: 26000,
    total_purchases: 40000,
    total_paid: 14000,
    shop_id: QA_SHOP_ID,
    created_by: 'QA',
  },
  {
    id: QA_CUSTOMER_C_ID,
    name: 'QA Customer C',
    phone: '923003333333',
    credit_limit: 10000,
    outstanding_balance: 0,
    total_purchases: 15000,
    total_paid: 15000,
    shop_id: QA_SHOP_ID,
    created_by: 'QA',
  },
];

export const QA_FIXTURE_PRODUCTS: readonly QaFixtureRow[] = [
  {
    id: QA_PRODUCT_A_ID,
    name: 'QA Product A',
    company_id: QA_COMPANY_A_ID,
    category: 'seed',
    stock_qty: 100,
    shop_id: QA_SHOP_ID,
  },
  {
    id: QA_PRODUCT_B_ID,
    name: 'QA Product B',
    company_id: QA_COMPANY_A_ID,
    category: 'fertilizer',
    stock_qty: 0,
    shop_id: QA_SHOP_ID,
  },
];

export const QA_FIXTURE_VARIANTS: readonly QaFixtureRow[] = [
  {
    id: QA_VARIANT_A_ID,
    product_id: QA_PRODUCT_A_ID,
    name: '1kg',
    selling_price: 500,
    cost_price: 300,
    unit_size: 1,
    low_stock_threshold: 10,
    stock_qty: 100,
  },
  {
    id: QA_VARIANT_B_ID,
    product_id: QA_PRODUCT_B_ID,
    name: '5kg',
    selling_price: 2000,
    cost_price: 1500,
    unit_size: 5,
    low_stock_threshold: 5,
    stock_qty: 0,
  },
];

/** A value as a SQL literal. Only literal types reach here; there is no caller-supplied text. */
function literal(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`[QA FIXTURE] refusing to seed ${value}`);
    return String(value);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Table and column names come from this file's own literals; reject anything that is not one. */
function assertPlainName(name: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`[QA FIXTURE] refusing to use "${name}" as a table or column name`);
  }
}

/**
 * Build the idempotent upsert for one table.
 *
 * The INSERT column list and the DO UPDATE SET list are BOTH derived from the declared rows: the
 * restore is the declaration. The only column left out of the update is the conflict target itself.
 *
 * Every row must declare exactly the same columns, in the same order. A row that omitted a column
 * would insert NULL for it, which on a fixture column is a stricter seed than intended — so this
 * fails at import time rather than quietly writing a hole.
 */
export function upsertSql(table: string, rows: readonly QaFixtureRow[], conflictTarget = 'id'): string {
  assertPlainName(table);
  assertPlainName(conflictTarget);
  if (!rows.length) throw new Error(`[QA FIXTURE] ${table} has no baseline rows to seed`);

  const columns = Object.keys(rows[0]);
  if (!columns.includes(conflictTarget)) {
    throw new Error(`[QA FIXTURE] ${table} does not declare its conflict target "${conflictTarget}"`);
  }
  for (const column of columns) assertPlainName(column);

  for (const row of rows) {
    const keys = Object.keys(row);
    if (keys.length !== columns.length || keys.some((key, i) => key !== columns[i])) {
      throw new Error(
        `[QA FIXTURE] ${table} rows disagree on their columns: ${columns.join(',')} vs ${keys.join(',')}`,
      );
    }
  }

  const values = rows
    .map((row) => `    (${columns.map((column) => literal(row[column])).join(', ')})`)
    .join(',\n');
  const assignments = columns
    .filter((column) => column !== conflictTarget)
    .map((column) => `      ${column} = EXCLUDED.${column}`)
    .join(',\n');

  return (
    `INSERT INTO ${table} (${columns.join(', ')})\n` +
    `VALUES\n${values}\n` +
    `ON CONFLICT (${conflictTarget}) DO UPDATE SET\n${assignments}`
  );
}

/** The columns each table declares — derived, so it cannot drift from the rows above. */
export const QA_FIXTURE_COLUMNS = {
  users: Object.keys(QA_FIXTURE_USERS[0]),
  companies: Object.keys(QA_FIXTURE_COMPANIES[0]),
  customers: Object.keys(QA_FIXTURE_CUSTOMERS[0]),
  products: Object.keys(QA_FIXTURE_PRODUCTS[0]),
  product_variants: Object.keys(QA_FIXTURE_VARIANTS[0]),
} as const;

const PRODUCTS_SQL = upsertSql('products', QA_FIXTURE_PRODUCTS);
const VARIANTS_SQL = upsertSql('product_variants', QA_FIXTURE_VARIANTS);

/**
 * The statements both seeders run, keyed by the order a lane needs them: users, then companies
 * (products point at one), then customers, then products with their variants.
 *
 * Two suites consume this with different executors — Playwright through the `run_sql` RPC, vitest
 * through the direct admin connection — and that is the only difference between them. Responsi-
 * bilities stay where they were: `tests/e2e/helpers.ts#setupFixtures` remains one call that seeds
 * everything, and `tests/setup/fixtures.ts` keeps its four named functions plus `setupAllFixtures`.
 */
export const FIXTURE_SQL = {
  users: upsertSql('users', QA_FIXTURE_USERS),
  companies: upsertSql('companies', QA_FIXTURE_COMPANIES),
  customers: upsertSql('customers', QA_FIXTURE_CUSTOMERS),
  products: PRODUCTS_SQL,
  productVariants: VARIANTS_SQL,
  /** One statement pair, so the existing single-exec for products + variants is preserved. */
  productsAndVariants: `${PRODUCTS_SQL};\n\n${VARIANTS_SQL};`,
} as const;
