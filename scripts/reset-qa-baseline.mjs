/**
 * Reset the QA database to its clean baseline.
 *
 * Mirrors the removal order used by tests/setup/fixtures.ts cleanupTestData()
 * (children before parents), then removes what the suites cannot: ad-hoc QA
 * roles created during manual verification, and orphaned Supabase Auth rows.
 *
 * Orphan auth rows matter: a Supabase Auth user has ONE email, and app-side
 * credentials are derived from the phone. When a suite deletes its `users` row
 * but leaves the auth row behind, every later run that reuses that phone hits
 * "email already registered". Clearing them keeps the QA environment stable.
 *
 * QA project only — the environment guard rejects anything else.
 */
import pg from 'pg';
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.qa', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const PROJECT = (env.QA_DB_USER || '').split('.')[1];
if (PROJECT !== 'bpybjrjenwccowvtrevu') {
  console.error(`Refusing to run: target project is "${PROJECT}", not the QA project.`);
  process.exit(1);
}

// Fixture identities from tests/setup/fixtures.ts
const CUSTOMERS = `('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003')`;
const USERS = `('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')`;
const PRODUCTS = `('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002')`;

// Suites name their own fixtures with a per-suite tag. These patterns match
// ONLY test data; the seeded baseline (Shop Owner, Sales Employee, the three
// demo products and customers) never matches them.
const TEST_USER = `name ~ '^(Destruct|Perm |Inv |Fin |QA |dhfdhdh)'`;
const TEST_CUSTOMER = `name ~ '^(Destruct|Perm |Inv |Fin |QA )' OR phone ~ '^(92300(DST|PERM|INV|FIN|BRANCH|977|978|979)|925452|92300977|92300978|92300979)'`;
const TEST_PRODUCT = `name ~ '(Test Product|Employee Product|QA |Gated Product)'`;
const TEST_SALE = `sale_number ~ '^(DST|PERM|INV|FIN|QA)-'`;

const STATEMENTS = [
  // Reminder subsystem (all rows are test-generated).
  `DELETE FROM reminder_logs`,
  `DELETE FROM reminder_occurrences`,
  `DELETE FROM reminder_configs`,
  // Sale / return / payment history for the QA customers.
  `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${CUSTOMERS})`,
  `DELETE FROM sales WHERE customer_id IN ${CUSTOMERS}`,
  `DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE customer_id IN ${CUSTOMERS})`,
  `DELETE FROM returns WHERE customer_id IN ${CUSTOMERS}`,
  `DELETE FROM voids WHERE sale_id IN (SELECT id FROM sales WHERE customer_id IN ${CUSTOMERS})`,
  `DELETE FROM customer_payments WHERE customer_id IN ${CUSTOMERS}`,
  `DELETE FROM credit_limit_requests WHERE customer_id IN ${CUSTOMERS}`,
  // Inventory + catalogue.
  `DELETE FROM inventory_movements WHERE product_id IN ${PRODUCTS}`,
  `DELETE FROM stock_adjustments WHERE product_id IN ${PRODUCTS}`,
  `DELETE FROM product_variants WHERE product_id IN ${PRODUCTS}`,
  `DELETE FROM products WHERE id IN ${PRODUCTS}`,
  // Company fixtures are shared and referenced by products, so they are kept.
  // (Categories of leftover company rows are removed with their products in a
  // future reset that can also drop dependent product rows safely.)
  `DELETE FROM customers WHERE id IN ${CUSTOMERS}`,
  // People + their access rows.
  `DELETE FROM audit_events WHERE user_id IN ${USERS}`,
  `DELETE FROM user_permissions WHERE user_id IN ${USERS}`,
  `DELETE FROM users WHERE id IN ${USERS}`,
  // NOTE: per-suite fixtures (Perm/Inv/Fin/Destruct/QA customers, products and
  // users) are deliberately NOT removed. Several suites seed them via
  // setupAllFixtures() and rely on them persisting between runs, so deleting
  // them here breaks those suites. Only rows that no suite recreates are reset.
  // Ad-hoc QA roles created during manual verification (never system roles).
  `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE is_system = false AND name ~ '^QA ')`,
  `DELETE FROM roles WHERE is_system = false AND name ~ '^QA '`,
  // Supabase Auth rows whose application user no longer exists.
  `DELETE FROM auth.users a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`,
];

const pool = new pg.Pool({
  host: env.QA_DB_HOST,
  port: 6543,
  database: 'postgres',
  user: env.QA_DB_USER,
  password: env.QA_DB_PASS,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

let removed = 0;
for (const statement of STATEMENTS) {
  try {
    const res = await pool.query(statement);
    if (res.rowCount) removed += res.rowCount;
  } catch (e) {
    console.log(`  skipped: ${statement.slice(0, 58)}… → ${e.message.split('\n')[0].slice(0, 60)}`);
  }
}
console.log(`QA baseline reset — ${removed} rows removed`);

const q = async (s) => (await pool.query(s)).rows;
const [customRoles] = await q(`SELECT count(*)::int AS c FROM roles WHERE is_system = false`);
const [orphans] = await q(`SELECT count(*)::int AS c FROM auth.users a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.id)`);
const [reminders] = await q(`SELECT count(*)::int AS c FROM reminder_configs`);
const [counts] = await q(`SELECT (SELECT count(*) FROM customers)::int AS customers, (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM sales)::int AS sales`);
console.log(`  custom roles: ${customRoles.c}, orphan auth rows: ${orphans.c}, reminder configs: ${reminders.c}`);
console.log(`  customers: ${counts.customers}, products: ${counts.products}, sales: ${counts.sales}`);

await pool.end();
