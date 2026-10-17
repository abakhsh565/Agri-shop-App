#!/usr/bin/env node
/**
 * probe-two-shop-isolation.mjs — cross-shop isolation, demonstrated behaviourally in QA.
 *
 * WHY THIS EXISTS
 *   Production has exactly one shop, so the tenant boundary there can only be asserted structurally
 *   (policies, grants, the RPC bodies). The question the owner asked — "can one shop's owner read or
 *   write another shop's rows?" — needs two shops and two real sessions to answer. QA has three
 *   shops, each with its own owner, and this script uses two of them.
 *
 * WHAT IT DOES
 *   One transaction, never committed. Two products and two sales (one per shop) are arranged as the
 *   database owner, then every assertion runs through the same path the app uses: `set local role
 *   authenticated` with that user's JWT claims, so `current_shop_id()` / `current_branch_scope()` and
 *   the RLS policies decide — not this script.
 *
 *   The controls are the point. "Shop B sees none of A's rows" proves nothing unless B can see its
 *   own, so each absence is paired with the same query returning 1 for the caller's own row.
 *
 * WHAT IT REFUSES
 *   Any project other than QA. It writes nothing outside its transaction, and rolls back in `finally`
 *   whether the assertions passed or not.
 *
 * Usage: node scripts/dev/probe-two-shop-isolation.mjs [--json <report.json>]
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = process.cwd();
const QA_PROJECT = 'bpybjrjenwccowvtrevu';

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function readQaEnv() {
  const env = {};
  const file = path.join(ROOT, '.env.qa');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('=')) continue;
    const key = line.split('=')[0].trim();
    env[key] = line.split('=').slice(1).join('=').trim().replace(/^\[|\]$/g, '');
  }
  return env;
}

const env = readQaEnv();

// The pooler host is shared, so the project is named by the user string (`postgres.<ref>`) and by
// the API URL — the host alone cannot tell QA from production.
const target = `${env.QA_DB_USER ?? ''} ${env.QA_SUPABASE_URL ?? ''}`;
if (!target.includes(QA_PROJECT) || String(env.QA_SUPABASE_URL ?? '').includes('gkswcfljxlutkfdvvqng')) {
  console.error(`[REFUSED] this probe only runs against QA (${QA_PROJECT}); target is ${target.trim()}`);
  process.exit(2);
}

// Two shops, each with a real owner and its own branch. Chosen from QA's measured state, not created:
// a fixture written by this script could satisfy its own expectations.
const A = {
  label: 'Default Shop',
  shop: '00000000-0000-0000-0000-000000000001',
  branch: 'b17fd67c-44ff-4977-bbb4-79b96abf2edb',
  owner: 'f0000000-0000-0000-0000-000000000001',
  phone: '92300FIN0001',
};
const B = {
  label: 'fdfdfds',
  shop: '1e5f7e4b-7ed0-4787-8148-8f289fc1c107',
  branch: 'ea60cd69-dbfd-4da0-9e2e-957af9f47d68',
  owner: '90000000-0000-0000-0000-0000000000a1',
  phone: '923007700001',
};
const B_EMPLOYEE = '90000000-0000-0000-0000-0000000000a2';
const RUN = `isolation probe ${Date.now()}`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
}

const client = new pg.Client({
  connectionString:
    `postgresql://${env.QA_DB_USER}:${encodeURIComponent(env.QA_DB_PASS)}` +
    `@${env.QA_DB_HOST}:5432/postgres`,
  ssl: { rejectUnauthorized: false },
});

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const asUser = async (user, fn) => {
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: user.owner, role: 'authenticated', phone: user.phone }),
  ]);
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user.owner]);
  await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
  await client.query('set local role authenticated');
  try {
    return await fn();
  } finally {
    await client.query('reset role');
  }
};

/**
 * Runs a statement that must be refused, and reports how.
 *
 * The savepoint is not optional: a refused statement aborts the whole transaction, so without it the
 * first expected refusal would poison every assertion after it (measured the first time this ran).
 */
async function refused(fn) {
  await client.query('savepoint attempt');
  try {
    await fn();
    await client.query('release savepoint attempt');
    return null;
  } catch (error) {
    await client.query('rollback to savepoint attempt');
    return error.message;
  }
}

const salePayload = (shop, product, variant, variantName, paid) =>
  JSON.stringify({
    idempotencyKey: `${RUN}-${shop.shop}-${Date.now()}-${Math.random()}`,
    customerId: null,
    customerName: `${RUN} walk-in`,
    paymentType: paid > 0 ? 'full' : 'credit',
    paymentMethod: 'cash',
    amountPaid: paid,
    items: [
      {
        productId: product,
        productName: `${RUN} product`,
        variantId: variant,
        variantName,
        qty: 1,
        unitPrice: 100,
        unitSize: 1,
        baseUnit: 'piece',
      },
    ],
  });

await client.connect();
await client.query('begin');
try {
  // ── ARRANGE (as the database owner, so the policies are the only thing under test below) ──
  const productA = 'c0000000-0000-0000-0000-0000000000a1';
  const variantA = 'c0000000-0000-0000-0000-0000000000a2';
  const productB = 'c0000000-0000-0000-0000-0000000000b1';
  const variantB = 'c0000000-0000-0000-0000-0000000000b2';
  await client.query(
    `insert into public.products (id, shop_id, name) values ($1,$2,$3), ($4,$5,$6)`,
    [productA, A.shop, `${RUN} A`, productB, B.shop, `${RUN} B`],
  );
  await client.query(
    `insert into public.product_variants (id, product_id, name, stock_qty, selling_price, is_active)
     values ($1,$2,'1kg',10,100,true), ($3,$4,'1kg',10,100,true)`,
    [variantA, productA, variantB, productB],
  );

  const permissionId = (await one(`select id from public.permissions order by code limit 1`)).id;

  // ── SHOP A: the control session ────────────────────────────────────────────────────────────
  const aSale = await asUser(A, async () => {
    const shop = (await one(`select public.current_shop_id() s`)).s;
    const scope = (await one(`select public.current_branch_scope() s`)).s;
    check('A: current_shop_id() is A', shop === A.shop, { shop });
    check('A: branch scope contains A’s own branch', Array.isArray(scope) && scope.includes(A.branch), { scope });

    const sale = (await one(`select public.create_sale($1::jsonb) r`, [
      salePayload(A, productA, variantA, '1kg', 100),
    ])).r;
    check('A: create_sale completes', !!sale?.id, sale);
    const row = await one(`select branch_id, shop_id from public.sales where id = $1`, [sale.id]);
    check('A: the sale is stamped with A’s shop and branch', row?.shop_id === A.shop && row?.branch_id === A.branch, row);
    return sale;
  });

  const aSeesOwn = await asUser(A, async () => {
    const sale = await one(`select count(*)::int n from public.sales where id = $1`, [aSale.id]);
    const product = await one(`select count(*)::int n from public.products where id = $1`, [productA]);
    return { sale: sale.n, product: product.n };
  });
  check('A: sees its own sale and product (control)', aSeesOwn.sale === 1 && aSeesOwn.product === 1, aSeesOwn);

  // ── SHOP B: the same questions, one shop away ──────────────────────────────────────────────
  const bView = await asUser(B, async () => {
    const shop = (await one(`select public.current_shop_id() s`)).s;
    const foreignSale = (await one(`select count(*)::int n from public.sales where id = $1`, [aSale.id])).n;
    const foreignProduct = (await one(`select count(*)::int n from public.products where id = $1`, [productA])).n;
    const foreignSales = (await one(`select count(*)::int n from public.sales where shop_id = $1`, [A.shop])).n;
    return { shop, foreignSale, foreignProduct, foreignSales };
  });
  check('B: current_shop_id() is B', bView.shop === B.shop, { shop: bView.shop });
  check('B: cannot read A’s sale', bView.foreignSale === 0, { rows: bView.foreignSale });
  check('B: cannot read A’s product', bView.foreignProduct === 0, { rows: bView.foreignProduct });
  check('B: a table-wide count returns no row of A’s', bView.foreignSales === 0, { rows: bView.foreignSales });

  const bWrite = await asUser(B, async () => {
    const updated = await client.query(`update public.products set name = $1 where id = $2`, [`${RUN} hacked`, productA]);
    const insertForeign = await refused(() =>
      client.query(`insert into public.products (shop_id, name) values ($1,$2)`, [A.shop, `${RUN} intruder`]),
    );
    const rpcForeign = await refused(() =>
      client.query(`select public.create_sale($1::jsonb)`, [salePayload(B, productA, variantA, '1kg', 100)]),
    );
    const override = await refused(() =>
      client.query(
        `insert into public.user_permissions (user_id, permission_id, is_override, is_granted)
         values ($1,$2,true,true)`,
        [B_EMPLOYEE, permissionId],
      ),
    );
    const foreignUserUpdate = await client.query(`update public.users set job_title = 'owned' where id = $1`, [A.owner]);
    const ownSale = (await one(`select public.create_sale($1::jsonb) r`, [
      salePayload(B, productB, variantB, '1kg', 100),
    ])).r;
    const ownRow = await one(`select shop_id, branch_id from public.sales where id = $1`, [ownSale.id]);
    return {
      updatedRows: updated.rowCount,
      insertForeign,
      rpcForeign,
      override,
      foreignUserUpdateRows: foreignUserUpdate.rowCount,
      ownSale,
      ownRow,
    };
  });
  check('B: updating A’s product changes no row', bWrite.updatedRows === 0, { rows: bWrite.updatedRows });
  check('B: inserting a row into A is refused by RLS', /row-level security/i.test(bWrite.insertForeign ?? ''), {
    error: bWrite.insertForeign,
  });
  check('B: create_sale against A’s product is refused', bWrite.rpcForeign !== null, { error: bWrite.rpcForeign });
  check('B: a permission override for its own employee is allowed (control)', bWrite.override === null, {
    error: bWrite.override,
  });
  check('B: updating A’s user changes no row', bWrite.foreignUserUpdateRows === 0, { rows: bWrite.foreignUserUpdateRows });
  check('B: create_sale for its own shop completes', !!bWrite.ownSale?.id, bWrite.ownSale);
  check(
    'B: its sale is stamped with B’s shop and branch, never A’s',
    bWrite.ownRow?.shop_id === B.shop && bWrite.ownRow?.branch_id === B.branch,
    bWrite.ownRow,
  );

  // ── A, again: the other direction, so the result is not an artifact of order ───────────────
  const bSeesOwn = await asUser(B, async () =>
    (await one(`select count(*)::int n from public.sales where id = $1`, [bWrite.ownSale.id])).n,
  );
  check('B: sees the sale it just created (the control for every absence above)', bSeesOwn === 1, { rows: bSeesOwn });

  const aAfter = await asUser(A, async () => {
    const bSale = (await one(`select count(*)::int n from public.sales where id = $1`, [bWrite.ownSale.id])).n;
    const bProduct = (await one(`select count(*)::int n from public.products where id = $1`, [productB])).n;
    // A deliberate write against a row A cannot see. Two refusals are both correct here and the
    // detail records which one happened: the platform withholds table-level writes on `sales`
    // (grant refusal, 42501) and RLS would filter it to zero rows if it did not.
    let touchedRows = null;
    const refusedTouch = await refused(async () => {
      touchedRows = (await client.query(`update public.sales set is_voided = true where id = $1`, [bWrite.ownSale.id])).rowCount;
    });
    const overrideB = await refused(() =>
      client.query(
        `insert into public.user_permissions (user_id, permission_id, is_override, is_granted)
         values ($1,$2,true,true)`,
        [B_EMPLOYEE, permissionId],
      ),
    );
    return { bSale, bProduct, touchedRows, refusedTouch, overrideB };
  });

  check('A: cannot read B’s sale', aAfter.bSale === 0, { rows: aAfter.bSale });
  check('A: cannot read B’s product', aAfter.bProduct === 0, { rows: aAfter.bProduct });
  check('A: cannot change B’s sale (refused, or zero rows)', aAfter.refusedTouch !== null || aAfter.touchedRows === 0, {
    error: aAfter.refusedTouch,
    rows: aAfter.touchedRows,
  });
  check('A: a permission override for B’s employee is refused by RLS (0218)', /row-level security/i.test(aAfter.overrideB ?? ''), {
    error: aAfter.overrideB,
  });

  // ── A person who belongs to BOTH shops ────────────────────────────────────────────────────
  //
  // The shape most likely to leak: `10000000-…-0001` holds an active owner membership in A and in B,
  // which is a supported state (0220's wide assertion exists for it). One session must still resolve
  // to ONE shop, and the other shop's rows must stay invisible — not "visible because I am a member".
  const BOTH = { owner: '10000000-0000-0000-0000-000000000001', phone: '923009999999', shop: null };
  const both = await asUser(BOTH, async () => {
    const shop = (await one(`select public.current_shop_id() s`)).s;
    const seenA = (await one(`select count(*)::int n from public.sales where id = $1`, [aSale.id])).n;
    const seenB = (await one(`select count(*)::int n from public.sales where id = $1`, [bWrite.ownSale.id])).n;
    const rowsFor = async (shopId) =>
      (await one(`select count(*)::int n from public.sales where shop_id = $1`, [shopId])).n;
    return { shop, seenA, seenB, aRows: await rowsFor(A.shop), bRows: await rowsFor(B.shop) };
  });
  check(
    'dual member: the session resolves to exactly one of the two shops',
    both.shop === A.shop || both.shop === B.shop,
    { shop: both.shop },
  );
  check(
    'dual member: only the resolved shop’s sale is visible',
    (both.shop === A.shop && both.seenA === 1 && both.seenB === 0) ||
      (both.shop === B.shop && both.seenB === 1 && both.seenA === 0),
    { seenA: both.seenA, seenB: both.seenB, shop: both.shop },
  );
  // QA's own shop already holds rows, so the claim is about the OTHER shop staying empty for this
  // session — paired with the control that the resolved shop still returns its rows.
  check(
    'dual member: a table-wide count returns no row of the shop it did not resolve to',
    both.shop === A.shop ? both.bRows === 0 && both.aRows >= 1 : both.aRows === 0 && both.bRows >= 1,
    { aRows: both.aRows, bRows: both.bRows, shop: both.shop },
  );

  // ── Stock: the RPC that completed actually moved only its own shop's stock ─────────────────
  const stocks = await one(
    `select
       (select stock_qty from public.product_variants where id = $1)::text a,
       (select stock_qty from public.product_variants where id = $2)::text b`,
    [variantA, variantB],
  );
  check("A's sale decremented only A's variant; B's is untouched", Number(stocks.a) === 9 && Number(stocks.b) === 9, stocks);
} catch (error) {
  console.log(`FAIL  probe aborted — ${error.message}${error.where ? ` (at ${error.where})` : ''}${error.code ? ` [${error.code}]` : ''}`);
  process.exitCode = 1;
} finally {
  await client.query('rollback');
  const leftover = await one(
    `select count(*)::int products from public.products where name like $1`,
    [`${RUN}%`],
  );
  check('the probe left no product behind', leftover.products === 0, leftover);
  console.log(`\nROLLED BACK${process.exitCode ? ' (with failures)' : ' — QA unchanged'}`);
}

const report = flag('json');
if (report) {
  fs.writeFileSync(
    path.isAbsolute(report) ? report : path.join(ROOT, report),
    JSON.stringify({ generatedAt: new Date().toISOString(), target: QA_PROJECT, run: RUN, results }, null, 2),
  );
  console.log(`report: ${report}`);
}

await client.end();
