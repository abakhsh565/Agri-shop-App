#!/usr/bin/env node
/**
 * rehearse-production-flows.mjs — drive the seven write RPCs on production, then undo everything.
 *
 * WHY THIS EXISTS
 *   A migration can be verified against a baseline and still not be callable. The three defects this
 *   walkthrough found on 2026-10-17 were exactly that kind: `create_sale` raised
 *   `column "payload" does not exist`, `process_return` hit a legacy NOT NULL column, and `void_sale`
 *   wrote a table production never received. None of them is visible from a schema diff or from the
 *   migration ledger — only from calling the functions the app calls, in the order the app calls them,
 *   with a real JWT claim set.
 *
 * WHAT IT DOES
 *   One transaction, always rolled back, whose final block asserts that the tables it wrote are empty
 *   again. It signs in the way the app does — `set local role authenticated` with the owner's
 *   `request.jwt.claims` — so authorization, branch stamping and the RPC bodies are all exercised.
 *
 *   The walkthrough, in order: credit sale (balance rises) → `record_customer_payment` (balance falls)
 *   → `process_return` on a second sale (unit restocked, `return_items.qty` readable, which is the
 *   column the sale-detail and return-select screens read) → `void_sale` on a third (stock restored,
 *   `voids` row, `is_voided`) → credit purchase (payable rises) → `record_supplier_payment` (payable
 *   falls). `create_purchase` and `adjust_stock` are covered by the purchase step and by the earlier
 *   batch rehearsal in docs/PRODUCTION_MIGRATION_PLAN.md §5.
 *
 * WHAT IT REFUSES
 *   Any target other than production, and any run that does not say `--env production` out loud (the
 *   credential wrapper hands a password only to a command that names the environment it believes it is
 *   talking to). There is no flag that commits: the rollback is the script, not an option in it.
 *
 * Usage:
 *   node scripts/run-with-production-credentials.mjs -- node scripts/rehearse-production-flows.mjs \
 *        --env production [--json backups/<report>.json]
 *
 * Exit codes: 0 = every step completed and nothing was left behind, 1 = a step failed or a row
 * survived, 2 = refused before connecting.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { readCredentialsFile, defaultCredentialsPath } from './lib/credentials-file.mjs';
import { connectionStringFor, ROOT } from './lib/environments.mjs';

const PRODUCTION_PROJECT = 'gkswcfljxlutkfdvvqng';

const envIndex = process.argv.indexOf('--env');
if (envIndex === -1 || process.argv[envIndex + 1] !== 'production') {
  console.error('[REFUSED] name the environment: --env production');
  process.exit(2);
}
const jsonIndex = process.argv.indexOf('--json');
const jsonOut = jsonIndex === -1 ? null : process.argv[jsonIndex + 1];

const { values } = readCredentialsFile(defaultCredentialsPath());
const user = String(values.PROD_DB_USER ?? '');
if (!user.includes(PRODUCTION_PROJECT)) {
  console.error(`[REFUSED] this rehearsal is only about production (${PRODUCTION_PROJECT}); user is ${user}`);
  process.exit(2);
}

const client = new pg.Client({
  connectionString: connectionStringFor({ environment: 'production', envPrefix: 'PROD', values }),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

const results = [];
const step = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};

const owner = await one(`select id, phone from public.users where is_original_owner limit 1`);
const customer = await one(`select id, name from public.customers order by created_at limit 1`);
const company = await one(`select id, name from public.companies order by created_at limit 1`);
const variant = await one(`select id, product_id, name from public.product_variants order by created_at limit 1`);

const salePayload = (key, qty, price, paid) =>
  JSON.stringify({
    idempotencyKey: key,
    customerId: customer.id,
    customerName: customer.name,
    paymentType: paid >= qty * price ? 'full' : 'credit',
    paymentMethod: 'cash',
    amountPaid: paid,
    items: [
      {
        productId: variant.product_id,
        productName: 'Flow test product',
        variantId: variant.id,
        variantName: variant.name,
        qty,
        unitPrice: price,
        unitSize: 1,
        baseUnit: 'piece',
      },
    ],
  });

/** Each step gets a savepoint, so one refusal is reported with its own message instead of aborting the rest. */
async function inSavepoint(name, fn) {
  await client.query('savepoint flow');
  try {
    await fn();
    await client.query('release savepoint flow');
  } catch (error) {
    step(name, false, { error: error.message });
    await client.query('rollback to savepoint flow');
  }
}

await client.query('begin');
try {
  await client.query(`update public.product_variants set stock_qty = 60 where id = $1`, [variant.id]);
  await client.query(`update public.products set stock_qty = 60 where id = $1`, [variant.product_id]);
  await client.query(
    `update public.customers set credit_limit = 10000, outstanding_balance = 0, total_purchases = 0, total_paid = 0 where id = $1`,
    [customer.id],
  );
  await client.query(`update public.companies set outstanding_payable = 0, total_purchases = 0 where id = $1`, [company.id]);

  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: owner.id, role: 'authenticated', phone: owner.phone }),
  ]);
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner.id]);
  await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
  await client.query('set local role authenticated');

  // ── A. a credit sale, then a customer payment against it ────────────────────────────────────
  await inSavepoint('customer payment', async () => {
    const sale = (await one(`select public.create_sale($1::jsonb) r`, [salePayload(`flow-a-${Date.now()}`, 2, 100, 0)])).r;
    const balance = (await one(`select outstanding_balance::text b from public.customers where id = $1`, [customer.id])).b;
    step('create_sale (credit) sets the customer balance', Number(balance) === 200, { balance });

    const payment = (await one(`select public.record_customer_payment($1::jsonb) r`, [
      JSON.stringify({ customerId: customer.id, amount: 50, method: 'cash', notes: 'flow test', idempotency_key: `flow-pay-${Date.now()}` }),
    ])).r;
    const after = await one(`select outstanding_balance::text b, total_paid::text p from public.customers where id = $1`, [customer.id]);
    step('record_customer_payment completes', Number(payment.balanceAfter) === 150 && Number(after.b) === 150 && Number(after.p) === 50, {
      payment,
      after,
    });
  });

  // ── B. a return of one unit ────────────────────────────────────────────────────────────────
  await inSavepoint('return', async () => {
    const sale = (await one(`select public.create_sale($1::jsonb) r`, [salePayload(`flow-r-${Date.now()}`, 2, 100, 200)])).r;
    const item = await one(`select id, product_id, variant_id, unit_price::text p from public.sale_items where sale_id = $1 limit 1`, [sale.id]);
    const stockBefore = Number((await one(`select stock_qty::text s from public.product_variants where id = $1`, [variant.id])).s);
    const ret = (await one(`select public.process_return($1::jsonb) r`, [
      JSON.stringify({
        saleId: sale.id,
        customerId: customer.id,
        customerName: customer.name,
        resolution: 'refund_cash',
        reason: 'flow test',
        idempotency_key: `flow-ret-${Date.now()}`,
        items: [
          {
            saleItemId: item.id,
            productId: item.product_id,
            productName: 'Flow test product',
            variantId: item.variant_id,
            variantName: variant.name,
            qty: 1,
            unitPrice: Number(item.p),
            restock: true,
          },
        ],
      }),
    ])).r;
    const returnRow = await one(`select count(*)::int n from public.returns where id = $1`, [ret.id]);
    const stored = await one(`select qty::text q, qty_to_return::text qt from public.return_items where return_id = $1`, [ret.id]);
    const stock = Number((await one(`select stock_qty::text s from public.product_variants where id = $1`, [variant.id])).s);
    step('process_return completes and restocks', returnRow.n === 1 && stock === stockBefore + 1, { ret, stored, stock });
    step('returned quantity is readable through `qty` (what the screens read)', Number(stored.q) === 1, stored);
  });

  // ── C. a whole sale voided ─────────────────────────────────────────────────────────────────
  await inSavepoint('void', async () => {
    const sale = (await one(`select public.create_sale($1::jsonb) r`, [salePayload(`flow-v-${Date.now()}`, 1, 100, 100)])).r;
    const before = Number((await one(`select stock_qty::text s from public.product_variants where id = $1`, [variant.id])).s);
    await client.query(`select public.void_sale($1, $2, $3)`, [sale.id, 'flow test void', owner.id]);
    const voided = await one(`select is_voided, voided_at is not null as at from public.sales where id = $1`, [sale.id]);
    const voidRow = await one(`select count(*)::int n from public.voids where sale_id = $1`, [sale.id]);
    const after = Number((await one(`select stock_qty::text s from public.product_variants where id = $1`, [variant.id])).s);
    step('void_sale completes and restores stock', voided.is_voided === true && voided.at === true && voidRow.n === 1 && after === before + 1, {
      voided,
      voidRow,
      before,
      after,
    });
  });

  // ── D. a credit purchase, then a supplier payment against it ───────────────────────────────
  await inSavepoint('supplier payment', async () => {
    const purchase = (await one(`select public.create_purchase($1::jsonb) r`, [
      JSON.stringify({
        idempotencyKey: `flow-p-${Date.now()}`,
        companyId: company.id,
        companyName: company.name,
        paymentMethod: 'cash',
        amountPaid: 0,
        note: 'flow test',
        items: [
          { productId: variant.product_id, productName: 'Flow test product', variantId: variant.id, variantName: variant.name, qty: 3, costPrice: 50 },
        ],
      }),
    ])).r;
    const payable = await one(`select outstanding_payable::text p from public.companies where id = $1`, [company.id]);
    step('create_purchase (credit) sets the supplier payable', Number(payable.p) === 150, { purchase, payable });

    const payment = (await one(`select public.record_supplier_payment($1::jsonb) r`, [
      JSON.stringify({ companyId: company.id, amount: 50, method: 'cash', notes: 'flow test', idempotencyKey: `flow-sp-${Date.now()}` }),
    ])).r;
    const after = await one(`select outstanding_payable::text p from public.companies where id = $1`, [company.id]);
    step('record_supplier_payment completes', Number(payment.payableAfter) === 100 && Number(after.p) === 100, { payment, after });
  });
} catch (error) {
  step('the rehearsal ran', false, { error: error.message });
} finally {
  await client.query('rollback');
  const leftovers = await one(`select
      (select count(*)::int from public.sales) sales,
      (select count(*)::int from public.returns) returns,
      (select count(*)::int from public.customer_payments) cp,
      (select count(*)::int from public.supplier_payments) sp,
      (select count(*)::int from public.purchases) purchases,
      (select count(*)::int from public.voids) voids`);
  step('the rehearsal left nothing behind', Object.values(leftovers).every((n) => n === 0), leftovers);
  console.log(`\nROLLED BACK — production rows after: ${JSON.stringify(leftovers)}`);
  await client.end();
}

if (jsonOut) {
  const out = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.writeFileSync(
    out,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), target: PRODUCTION_PROJECT, status: process.exitCode ? 'FAIL' : 'PASS', results },
      null,
      2,
    ),
  );
  console.log(`report: ${out}`);
}
