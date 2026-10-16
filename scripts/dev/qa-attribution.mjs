#!/usr/bin/env node
/**
 * qa-attribution.mjs — WHAT is in the QA database, and whose is it?
 *
 * WHY THIS EXISTS
 *   `qa.mjs count` answers "how many business rows are there" (687 at the time of writing) but not
 *   "which of them may be deleted". Those are different questions, and the cleanup decision was
 *   waiting on the second: the per-table total cannot distinguish a protected fixture account from
 *   a stale sale, and assuming all 687 are residue is how a QA baseline loses a fixture it cannot
 *   recreate (the sign-in credential lives in `auth.users`).
 *
 *   So this tool attributes every row along four axes, and never judges:
 *     table        — the same 28 business tables `qa.mjs count` covers;
 *     shop/tenant  — resolved through the parent when the table has no shop column
 *                    (`sale_items → sales.shop_id`, `inventory_movements → products.shop_id`, …);
 *     time         — first/last `created_at` per table, plus a per-day histogram for the big ones;
 *     ownership    — the per-suite tags the repo's own cleaner already matches on
 *                    (`DST|PERM|INV|FIN|QA `, phones `92300 977/978/979`, …) versus rows that
 *                    carry no marker at all.
 *
 * THE SAFETY RULE
 *   This script cannot write. It opens a READ ONLY transaction, runs SELECTs against a hard-coded
 *   list of tables and columns, and rolls back. That is structural, not a convention: a future
 *   edit that tries an INSERT/UPDATE/DELETE inside this transaction fails at the database, not at
 *   review time. It also refuses any target that is not the QA project, the same way
 *   `reset-qa-baseline.mjs` does, because an attribution of the production database is not a thing
 *   this repository ever wants to run by accident.
 *
 * USAGE
 *   node scripts/dev/qa-attribution.mjs             # the row attribution
 *   node scripts/dev/qa-attribution.mjs --tenant    # per-shop/tenant readiness: is any shop an
 *                                                   # empty, isolated candidate for a write lane?
 *   node scripts/dev/qa-attribution.mjs --json      # machine-readable (the same data, no prose)
 *
 * Exit status: 0 when the target was QA and every query ran; 1 when the guard refused or the
 * database could not be read. It never exits non-zero because rows EXIST — this is a report, and
 * `qa.mjs count` remains the gate that fails on a non-empty baseline.
 */
import pg from 'pg';
import { BUSINESS_TABLES, QA_FIXTURE_PHONES, QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

const asJson = process.argv.includes('--json');
const tenantMode = process.argv.includes('--tenant');

// ── target guard ─────────────────────────────────────────────
const url = qaDatabaseUrl();
if (!url) {
  console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
  process.exit(1);
}
let targetRef = '';
try {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username || '');
  // Supabase connection strings carry the project ref either as `postgres.<ref>` or in the host.
  targetRef = user.includes('.') ? user.split('.')[1] : (parsed.hostname.match(/^([a-z]{20})\./)?.[1] ?? '');
} catch {
  targetRef = '';
}
if (targetRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(1);
}

/**
 * How each table reaches a shop. A table with no shop column is attributed through the parent the
 * repo itself treats as the owner (`cleanupOwnership.ts` walks the same edges). `audit_events`
 * carries `tenant_id` rather than a shop, and `shop_requests` is a registration request that by
 * definition has no shop yet — both are marked so the report never implies a shop it cannot know.
 */
const SHOP_EXPR = {
  customers: 't.shop_id',
  products: 't.shop_id',
  companies: 't.shop_id',
  sales: 't.shop_id',
  notifications: 't.shop_id',
  purchases: 't.shop_id',
  returns: 't.shop_id',
  credit_limit_requests: '(select c.shop_id from customers c where c.id = t.customer_id)',
  customer_crops: '(select c.shop_id from customers c where c.id = t.customer_id)',
  customer_payments: '(select c.shop_id from customers c where c.id = t.customer_id)',
  payments: '(select c.shop_id from customers c where c.id = t.customer_id)',
  inventory_movements: '(select p.shop_id from products p where p.id = t.product_id)',
  stock_adjustments: '(select p.shop_id from products p where p.id = t.product_id)',
  product_variants: '(select p.shop_id from products p where p.id = t.product_id)',
  sale_items: '(select s.shop_id from sales s where s.id = t.sale_id)',
  sale_submissions: '(select s.shop_id from sales s where s.id = t.sale_id)',
  voids: '(select s.shop_id from sales s where s.id = t.sale_id)',
  return_items: '(select r.shop_id from returns r where r.id = t.return_id)',
  purchase_items: '(select p.shop_id from purchases p where p.id = t.purchase_id)',
  supplier_payments: '(select co.shop_id from companies co where co.id = t.company_id)',
  cash_reconciliations: 't.shop_id',
  daily_cash_reconciliations: 't.shop_id',
  reminder_configs: 't.shop_id',
  reminder_occurrences: 't.shop_id',
  reminder_logs: 't.shop_id',
  price_history: '(select p.shop_id from products p where p.id = t.product_id)',
  activity_log: '(select u.shop_id from users u where u.id = t.user_id)',
  audit_events: 't.tenant_id',
};

/** Tables whose `created_at` is missing or not meaningful for a time window. */
const NO_TIME = new Set(['barcode_history', 'barcode_registry', 'product_barcodes']);

/** Tags the repository's own cleaner matches on — the honest definition of "looks like test data". */
const TAGS = {
  customers: {
    name: /^(Destruct|Perm |Inv |Fin |QA )/,
    phone: /^(92300(DST|PERM|INV|FIN|BRANCH|977|978|979)|925452|92300977|92300978|92300979)/,
  },
  users: { name: /^(Destruct|Perm |Inv |Fin |QA |dhfdhdh)/ },
  products: { name: /(Test Product|Employee Product|QA |Gated Product)/ },
  companies: { name: /^(Destruct|Perm |Inv |Fin |QA )/ },
  sales: { sale_number: /^(DST|PERM|INV|FIN|QA)-/ },
};

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

// ── helpers ──────────────────────────────────────────────────
const iso = (v) => (v instanceof Date ? v.toISOString().replace('.000Z', 'Z') : v ? String(v) : null);
const pad = (s, n) => String(s).padEnd(n);

/**
 * A READ ONLY transaction is the whole write-protection: every statement below is a SELECT, and the
 * database itself would reject anything else for as long as this transaction is open.
 */
let readOnly = true;
async function beginReadOnly() {
  try {
    await client.query('BEGIN READ ONLY');
  } catch (error) {
    readOnly = false;
    console.error(`note: could not open a READ ONLY transaction (${error.message}); continuing with SELECT-only queries`);
  }
}

async function presentTables() {
  const { rows } = await client.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`,
    [BUSINESS_TABLES],
  );
  return new Set(rows.map((r) => r.relname));
}

async function tableReport(table) {
  const expr = SHOP_EXPR[table];
  const hasTime = !NO_TIME.has(table);
  const total = (await client.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  if (!total) return { table, total: 0 };

  const byShop = expr
    ? (await client.query(`select coalesce(${expr}::text,'(none)') as shop, count(*)::int as n from ${table} t group by 1 order by 2 desc`)).rows
    : [];
  const window = hasTime
    ? (await client.query(`select min(created_at) as first, max(created_at) as last from ${table}`)).rows[0]
    : { first: null, last: null };
  const perDay = hasTime
    ? (await client.query(`select created_at::date as day, count(*)::int as n from ${table} group by 1 order by 1 desc limit 12`)).rows
    : [];
  // Each tag column is its own parameter — a single shared regex would silently test only one
  // column and report every phone-only match as untagged.
  const tagColumns = Object.entries(TAGS[table] ?? {});
  const tagged = tagColumns.length
    ? (await client.query(
        `select count(*)::int as n from ${table} t where ${tagColumns.map(([c], i) => `${c} ~ $${i + 1}`).join(' or ')}`,
        // `String(/re/)` would send the literal slashes; `.source` is the pattern Postgres expects.
        tagColumns.map(([, re]) => re.source),
      )).rows[0].n
    : null;
  return { table, total, byShop, window: { first: iso(window.first), last: iso(window.last) }, perDay, tagged };
}

async function main() {
  await client.connect();
  await beginReadOnly();

  const shops = (await client.query('select id, name, created_at from shops order by created_at')).rows;
  const tenants = (await client.query('select id, name, owner_id, created_at from tenants order by created_at')).rows;
  const users = (await client.query('select id, name, phone, role, shop_id, created_at from users order by created_at')).rows;
  const memberships = (await client.query('select user_id, tenant_id, role, status from memberships')).rows;
  const shopName = (id) => shops.find((s) => s.id === id)?.name ?? (id ? `(unknown ${String(id).slice(0, 8)})` : '(none)');

  if (tenantMode) {
    const perShop = [];
    for (const shop of shops) {
      const counts = {};
      for (const [table, expr] of Object.entries(SHOP_EXPR)) {
        const { rows: existing } = await client.query(
          `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname='public' and c.relkind='r' and c.relname=$1`, [table],
        );
        if (!existing.length) continue;
        const n = (await client.query(`select count(*)::int as n from ${table} t where ${expr} = $1`, [shop.id])).rows[0].n;
        if (n) counts[table] = n;
      }
      const owners = users.filter((u) => u.shop_id === shop.id);
      const business = ['companies', 'products', 'product_variants', 'customers', 'sales', 'sale_items', 'inventory_movements']
        .reduce((sum, t) => sum + (counts[t] ?? 0), 0);
      perShop.push({
        shop: shop.id,
        name: shop.name,
        createdAt: iso(shop.created_at),
        users: owners.map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, membership: memberships.find((m) => m.user_id === u.id)?.status ?? null })),
        rowCounts: counts,
        totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
        // A candidate for a write lane is a shop that (a) already has an owner who can sign in and
        // (b) holds no business rows the lane would have to delete to reach its empty premise.
        isolatedCandidate: owners.length > 0 && business === 0,
      });
    }
    const out = { mode: 'tenant', projectRef: targetRef, readOnly, shops: perShop, tenants };
    if (asJson) console.log(JSON.stringify(out, null, 2));
    else {
      console.log('═══ QA per-shop / per-tenant readiness (read-only)\n');
      for (const s of perShop) {
        console.log(`${s.isolatedCandidate ? 'CANDIDATE' : 'in use   '}  ${pad(s.name, 22)} ${s.shop}`);
        console.log(`           created ${s.createdAt} · rows ${s.totalRows}${Object.keys(s.rowCounts).length ? ` (${Object.entries(s.rowCounts).map(([t, n]) => `${t}:${n}`).join(', ')})` : ''}`);
        for (const u of s.users) console.log(`           user  ${pad(u.name, 20)} ${u.phone} · ${u.role}${u.membership ? ` · membership ${u.membership}` : ' · NO membership'}`);
      }
      console.log(`\n${tenants.length} tenant row(s):`);
      for (const t of tenants) console.log(`  ${pad(t.name, 22)} ${t.id} · owner ${t.owner_id ?? '(none)'} · created ${iso(t.created_at)}`);
    }
    await client.query('ROLLBACK').catch(() => {});
    return;
  }

  const present = await presentTables();
  const tables = [];
  for (const table of BUSINESS_TABLES) if (present.has(table)) tables.push(await tableReport(table));
  const withRows = tables.filter((t) => t.total);
  const total = withRows.reduce((sum, t) => sum + t.total, 0);

  const auditByAction = (await client.query('select action, count(*)::int as n from audit_events group by 1 order by 2 desc limit 15')).rows;
  const auditByActor = (await client.query(
    `select coalesce(u.name, a.actor_name, '(unknown)') as actor, coalesce(u.phone, '(no phone)') as phone, count(*)::int as n
       from audit_events a left join users u on u.id = a.user_id group by 1,2 order by 3 desc limit 15`)).rows;
  const fixtures = users.filter((u) => QA_FIXTURE_PHONES.includes(u.phone));

  const out = {
    mode: 'attribution',
    projectRef: targetRef,
    readOnly,
    total,
    tables: withRows,
    shops: shops.map((s) => ({ id: s.id, name: s.name, createdAt: iso(s.created_at) })),
    tenants,
    fixtures: fixtures.map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role, shop: shopName(u.shop_id) })),
    usersByShop: shops.map((s) => ({ shop: s.name, users: users.filter((u) => u.shop_id === s.id).map((u) => `${u.name} (${u.phone})`).length })),
    auditByAction,
    auditByActor,
  };

  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`═══ QA business-row attribution (read-only) — ${total} row(s) in ${withRows.length} table(s)\n`);
    for (const t of withRows) {
      const shopBits = t.byShop.map((b) => `${shopName(b.shop)}:${b.n}`).join('  ');
      console.log(`${pad(t.table, 28)} ${pad(t.total, 5)} ${t.tagged !== null ? `tagged:${pad(t.tagged, 4)}` : '           '} ${t.window.first ? `${t.window.first} → ${t.window.last}` : ''}`);
      if (shopBits) console.log(`${' '.repeat(29)}${shopBits}`);
    }
    console.log(`\n── fixtures (protected — the keep-list the app signs in with)`);
    for (const f of fixtures) console.log(`  ${pad(f.name, 22)} ${f.phone} · ${f.role} · shop ${f.shop}`);
    console.log(`\n── shops`);
    for (const s of shops) console.log(`  ${pad(s.name, 22)} ${s.id} · created ${iso(s.created_at)}`);
    console.log(`\n── audit_events by action (top 15)`);
    for (const a of auditByAction) console.log(`  ${pad(a.action, 34)} ${a.n}`);
    console.log(`\n── audit_events by actor (top 15)`);
    for (const a of auditByActor) console.log(`  ${pad(a.actor, 24)} ${pad(a.phone, 14)} ${a.n}`);
  }
  await client.query('ROLLBACK').catch(() => {});
}

try {
  await main();
} catch (error) {
  console.error(`attribution failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
