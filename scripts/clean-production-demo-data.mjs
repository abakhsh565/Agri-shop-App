#!/usr/bin/env node
/**
 * clean-production-demo-data.mjs — remove the demo identities and their records from production.
 *
 * WHAT THIS IS FOR (2026-10-18, owner's instruction)
 *   Production `gkswcfljxlutkfdvvqng` was seeded by the early migrations, so it still holds the
 *   demo people (`Yaqoob Malik` / `Ahmed Khan` / `Akram` / `Test QA User`, all on 92300… numbers),
 *   two Supabase logins on those numbers, and the catalog those identities created (6 customers,
 *   4 companies, 6 products, 12 variants, crops, one registration request, 71 storage objects).
 *   None of it is a real shop's work — the transaction tables are empty — and every one of those
 *   phone numbers is a number a real person could own. The owner asked for them gone so that the
 *   only way in is a real OTP to a real phone.
 *
 * WHAT IT KEEPS, AND WHY
 *   The tenant shell — the shop, its branch, its role templates, the 32 permissions and the five
 *   `app_settings` defaults — is configuration the app reads to work, not demo content. Removing
 *   the shop would remove the only route a new owner has into this database: production has no
 *   `approve_shop_request`/`create_shop_for_me`, so a wiped tenant could not be re-created from
 *   the product. Keeping it means the first real sign-in is attached to a working shop.
 *
 * REFUSALS (all hard, before a single delete)
 *   · the connection must be the production project, by ref, not by "the credentials happened to
 *     point somewhere";
 *   · the `public.users` set must be EXACTLY the four demo rows named below — a fifth row means a
 *     real account exists (or was created since this file was written) and the run stops;
 *   · every transaction table must be empty, because this file has no business deleting a sale;
 *   · the counts it will remove must match what it measured, so a surprise row fails the run
 *     instead of being swept up by a broad delete.
 *
 * USAGE (the environment must be named, exactly as the other production writers require)
 *   node scripts/run-with-production-credentials.mjs -- node scripts/clean-production-demo-data.mjs --env production
 *        rehearses: one transaction, every check above, then rolled back
 *   … --env production --apply --confirm CLEAN-PRODUCTION-DEMO-IDENTITIES-2026-10-18
 *        the same statements and checks, committed
 *
 * The confirmation token is not ceremony: `--apply` alone is a flag a hurried run can type, and the
 * purge tool already sets this project's rule that an owner-authorized production write names the
 * decision it is carrying out. PRODUCTION-DEMO-CLEANUP-GUARDED.
 */

import pg from 'pg';
import { readCredentialsFile, defaultCredentialsPath } from './lib/credentials-file.mjs';
import { connectionStringFor, projectRefFromDbUser } from './lib/environments.mjs';

const PRODUCTION_REF = 'gkswcfljxlutkfdvvqng';
const CONFIRMATION = 'CLEAN-PRODUCTION-DEMO-IDENTITIES-2026-10-18';
const APPLY = process.argv.includes('--apply');
const flag = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : process.argv[process.argv.indexOf(hit) + 1] ?? null;
};

const env = flag('env');
if (env !== 'production') {
  // The same refusal the other production writers use, before a credential is looked for.
  console.error('Refusing to run: name the environment: --env production');
  process.exit(2);
}
if (APPLY && flag('confirm') !== CONFIRMATION) {
  // Dry run is the default; a commit must name the decision the owner made.
  console.error(
    `Refusing to apply without the owner-authorized confirmation.\n` +
      `  re-run with: --apply --confirm ${CONFIRMATION}`,
  );
  process.exit(2);
}

// The identities production was seeded with. Matched together — a row must match one of these
// exactly (id + phone) or the run refuses, so a real account can never be caught by a LIKE.
const DEMO_USERS = [
  { id: '00000000-0000-0000-0000-000000000002', phone: '923001234567', name: 'Yaqoob Malik' },
  { id: '00000000-0000-0000-0000-000000000003', phone: '923009876543', name: 'Ahmed Khan' },
  { id: 'c333f839-35fb-4723-a07d-7aa960b4c4f3', phone: '923001122334', name: 'Akram' },
  { id: '84deb713-a5d2-4f2b-9faf-ca27c921b93c', phone: '923001999999', name: 'Test QA User' },
];
const DEMO_PHONES = DEMO_USERS.map((u) => u.phone);
// The two Supabase logins are on the demo numbers; one of them (e7cbbff3…) has no `public.users`
// row at all, which is why the login side is listed rather than derived.
const DEMO_LOGINS = DEMO_PHONES;
// Rows the run expects to find. A different number is a refusal, not something to delete.
const EXPECTED = {
  users: 4,
  memberships: 4,
  user_active_shops: 4,
  auth_users: 2,
  auth_identities: 2,
  customers: 6,
  companies: 4,
  products: 6,
  product_variants: 12,
  customer_crops: 0,
  business_settings: 1,
  shop_requests: 4,
  storage_objects: 71,
};
// Tables that must be empty before this is allowed to run at all: if any holds a row, somebody's
// real work exists and "clean the demo data" is no longer a reversal of the seed.
const MUST_BE_EMPTY = [
  'sales', 'sale_items', 'returns', 'return_items', 'voids', 'purchases', 'purchase_items',
  'customer_payments', 'supplier_payments', 'payments', 'inventory_movements',
  'stock_adjustments', 'notifications', 'audit_events', 'sale_submissions',
  'credit_limit_requests', 'cash_reconciliations', 'reminder_logs', 'reminder_occurrences',
  'product_barcodes', 'barcode_registry', 'barcode_history', 'marketplace_listings',
  'branch_responsibility', 'user_permissions', 'app_settings_backup',
];

const { values } = readCredentialsFile(defaultCredentialsPath());
const connectionString = connectionStringFor({ environment: 'production', envPrefix: 'PROD', values });
// The ref comes from the credential itself (`postgres.<ref>`), which is the repository's rule for
// "the credentials say production" — the pooler host carries no ref.
const ref = projectRefFromDbUser(values.PROD_DB_USER) ?? '(unparsed)';
if (!String(values.PROD_DB_USER ?? '').endsWith(PRODUCTION_REF) || ref !== PRODUCTION_REF) {
  console.error(`Refusing to run: credentials name ${ref}, not production (${PRODUCTION_REF}).`);
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const count = async (sql) => Number((await client.query(sql)).rows[0].n);
const scalar = async (sql) => (await client.query(sql)).rows[0]?.n;
const fail = (message) => {
  throw new Error(`REFUSED: ${message}`);
};

console.log(`target: production ${ref}  mode: ${APPLY ? 'APPLY (commits)' : 'REHEARSE (rolls back)'}`);

await client.query('begin');
let committed = false;
try {
  // ── 1. The people must be exactly the demo set ─────────────────────────────
  const users = (await client.query('select id, name, phone from public.users order by phone')).rows;
  if (users.length !== EXPECTED.users) fail(`public.users holds ${users.length} rows, expected ${EXPECTED.users}`);
  for (const row of users) {
    const demo = DEMO_USERS.find((d) => d.id === row.id);
    if (!demo) fail(`public.users holds ${row.id} (${row.name} / ${row.phone}), which is not a demo identity`);
    if (row.phone !== demo.phone) fail(`public.users ${row.id} has phone ${row.phone}, expected ${demo.phone}`);
  }
  const logins = (await client.query('select id, phone from auth.users order by phone')).rows;
  if (logins.length !== EXPECTED.auth_users) fail(`auth.users holds ${logins.length} rows, expected ${EXPECTED.auth_users}`);
  for (const row of logins) {
    if (!DEMO_LOGINS.includes(row.phone)) fail(`auth.users holds ${row.id} on ${row.phone}, which is not a demo number`);
  }

  // ── 2. Nothing that looks like real work may exist ─────────────────────────
  for (const table of MUST_BE_EMPTY) {
    const exists = await scalar(`select to_regclass('public.${table}') is not null as n`);
    if (!exists) continue;
    const n = await count(`select count(*)::int n from public.${table}`);
    if (n > 0) fail(`public.${table} holds ${n} row(s) — real work, not seed data`);
  }

  // ── 3. The rows about to go must be the rows measured ──────────────────────
  const measured = {
    users: users.length,
    memberships: await count('select count(*)::int n from public.memberships'),
    user_active_shops: await count('select count(*)::int n from public.user_active_shops'),
    auth_users: logins.length,
    auth_identities: await count('select count(*)::int n from auth.identities'),
    customers: await count('select count(*)::int n from public.customers'),
    companies: await count('select count(*)::int n from public.companies'),
    products: await count('select count(*)::int n from public.products'),
    product_variants: await count('select count(*)::int n from public.product_variants'),
    customer_crops: await count('select count(*)::int n from public.customer_crops'),
    business_settings: await count('select count(*)::int n from public.business_settings'),
    shop_requests: await count('select count(*)::int n from public.shop_requests'),
    storage_objects: await count('select count(*)::int n from storage.objects'),
  };
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = measured[key];
    if (actual !== expected) fail(`${key}: measured ${actual}, this file expects ${expected}`);
  }
  // The rows in the tables it deletes must all belong to the one seeded tenant, not merely be
  // counted: a row in some other shop is somebody else's work and must stop the run.
  const foreign = await client.query(`
    select 'customers' t, count(*)::int n from public.customers where shop_id <> (select id from public.shops)
    union all
    select 'companies', count(*)::int from public.companies where shop_id <> (select id from public.shops)
    union all
    select 'products', count(*)::int from public.products where shop_id <> (select id from public.shops)
    union all
    select 'memberships', count(*)::int from public.memberships where tenant_id <> (select id from public.shops)`);
  for (const row of foreign.rows) if (row.n > 0) fail(`${row.n} ${row.t} row(s) belong to another shop`);
  // Every row in the catalog was typed during the demo sessions (no sale, payment or return
  // references any of them). They are printed, not matched against a list, so the run says out
  // loud exactly which people and suppliers it is about to remove.
  const catalog = (await client.query(`
    select 'customer' kind, name, phone from public.customers
    union all select 'supplier', name, phone from public.companies
    order by 1, 2`)).rows;
  console.log('catalog rows being removed:');
  for (const row of catalog) console.log(`  ${row.kind.padEnd(8)} ${String(row.name).padEnd(20)} ${row.phone}`);
  console.log('measured:', JSON.stringify(measured));

  // ── 4. The deletes (children first; the FK order is NO ACTION almost everywhere) ──────────
  const steps = [
    ['customer_crops', 'delete from public.customer_crops'],
    ['business_settings', 'delete from public.business_settings'],
    ['product_variants', 'delete from public.product_variants'],
    ['products', 'delete from public.products'],
    ['companies', 'delete from public.companies'],
    ['customers', 'delete from public.customers'],
    ['shop_requests (every registration, demo only)', 'delete from public.shop_requests'],
    ['user_active_shops', 'delete from public.user_active_shops'],
    ['memberships', 'delete from public.memberships'],
    ['users', 'delete from public.users'],
    ['auth identities', 'delete from auth.identities'],
    ['auth one-time tokens', 'delete from auth.one_time_tokens'],
    ['auth sessions', 'delete from auth.sessions'],
    ['auth users (the two demo logins)', 'delete from auth.users'],
    // NOT deleted: storage.objects. Supabase refuses a direct delete there ("Direct deletion from
    // storage tables is not allowed. Use the Storage API instead.") and this process holds the
    // database password, not a service-role key. The 71 demo images stay in their buckets, orphaned
    // — no row references them any more — and are reported as the one remnant below rather than
    // silently half-removed.
  ];
  for (const [label, sql] of steps) {
    const result = await client.query(sql);
    console.log(`  ${String(result.rowCount).padStart(3)}  ${label}`);
  }

  // ── 5. Postconditions: empty where it must be, intact where it must be ──────
  const leftovers = await client.query(`
    select 'users' t, count(*)::int n from public.users
    union all select 'auth.users', count(*)::int from auth.users
    union all select 'auth.identities', count(*)::int from auth.identities
    union all select 'memberships', count(*)::int from public.memberships
    union all select 'user_active_shops', count(*)::int from public.user_active_shops
    union all select 'customers', count(*)::int from public.customers
    union all select 'companies', count(*)::int from public.companies
    union all select 'products', count(*)::int from public.products
    union all select 'product_variants', count(*)::int from public.product_variants
    union all select 'customer_crops', count(*)::int from public.customer_crops
    union all select 'business_settings', count(*)::int from public.business_settings
    union all select 'shop_requests', count(*)::int from public.shop_requests
    union all select 'sales', count(*)::int from public.sales
    union all select 'notifications', count(*)::int from public.notifications
    union all select 'audit_events', count(*)::int from public.audit_events`);
  const nonZero = leftovers.rows.filter((r) => r.n !== 0);
  if (nonZero.length) fail(`postcondition failed: ${nonZero.map((r) => `${r.t}=${r.n}`).join(', ')}`);

  const kept = await client.query(`
    select (select count(*)::int from public.shops) shops,
           (select count(*)::int from public.branches) branches,
           (select count(*)::int from public.roles) roles,
           (select count(*)::int from public.role_permissions) role_permissions,
           (select count(*)::int from public.permissions) permissions,
           (select count(*)::int from public.app_settings) app_settings,
           (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public') functions`);
  console.log('kept:', JSON.stringify(kept.rows[0]));
  if (kept.rows[0].shops !== 1) fail('the tenant shell is gone — production would have no shop');
  if (kept.rows[0].branches < 1) fail('the tenant has no branch');
  if (kept.rows[0].roles < 1) fail('the role templates are gone');
  if (kept.rows[0].permissions !== 32) fail(`permissions changed: ${kept.rows[0].permissions}`);

  // No demo phone may survive in any table that stores one.
  const phoneColumns = (await client.query(`
    select table_schema, table_name, column_name
      from information_schema.columns
     where table_schema in ('public')
       and column_name in ('phone','owner_phone','contact_phone')
       and table_name <> 'users_public'`)).rows;
  const hits = [];
  for (const c of phoneColumns) {
    const n = await count(
      `select count(*)::int n from "${c.table_schema}"."${c.table_name}" where right(regexp_replace(${c.column_name}, '\\D', '', 'g'), 10) = any (array['${DEMO_PHONES.map((p) => p.slice(-10)).join("','")}'])`,
    );
    if (n > 0) hits.push(`${c.table_name}.${c.column_name}=${n}`);
  }
  if (hits.length) fail(`a demo phone survives in: ${hits.join(', ')}`);
  console.log(`demo phone numbers remaining in public tables: 0 (${phoneColumns.length} columns scanned)`);
  console.log(`orphaned demo images still in storage buckets: ${await count('select count(*)::int n from storage.objects')} (Storage API required to delete — see the file header)`);

  // The write surface the app depends on must still be there.
  const rpcs = ['create_sale', 'record_customer_payment', 'process_return', 'void_sale', 'create_purchase', 'record_supplier_payment', 'lookup_user_by_phone', 'get_my_permissions'];
  const present = await client.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname = any ($1)`, [rpcs]);
  if (present.rows.length !== rpcs.length) fail(`missing RPC(s): ${rpcs.filter((r) => !present.rows.some((p) => p.proname === r)).join(', ')}`);
  console.log(`RPCs present: ${present.rows.length}/${rpcs.length}`);

  if (APPLY) {
    await client.query('commit');
    committed = true;
    console.log('COMMITTED');
  } else {
    console.log('REHEARSAL PASSED — rolling back, nothing changed');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (!committed) await client.query('rollback').catch(() => {});
  await client.end();
}
