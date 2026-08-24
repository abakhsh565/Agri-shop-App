// Verifies migrations 0003 + 0004 against a real Postgres engine (PGlite/WASM),
// reproducing the LIVE AgriShop schema — most importantly users.role as TEXT
// (the "earlier partial schema" shape that broke the original 0003).
//
// It (1) builds the representative live schema, (2) stubs the Supabase-only
// auth.jwt() so role resolution works, (3) runs the real 0003 and 0004 files
// verbatim, then (4) exercises the RPCs end-to-end (sale decrements stock,
// payment reduces balance, adjust/return, never-negative guard).

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const read = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

async function run(label, sql) {
  try {
    await db.exec(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    console.error(`✗ ${label}\n   ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}

// A mutable JWT the stubbed auth.jwt() reads, so we can simulate the signed-in user.
let CURRENT_PHONE = "923001112222";

try {
  // ---- Supabase-only shims (not part of the app migrations) ----------------
  await run("shim: roles + auth.jwt() + publication", `
    do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
    do $$ begin create role anon; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role; exception when duplicate_object then null; end $$;
    create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('phone', current_setting('app.jwt_phone', true));
    $$;
    do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
  `);
  await db.query(`select set_config('app.jwt_phone', $1, false)`, [CURRENT_PHONE]);

  // ---- MINIMAL PARTIAL live schema — the WORST-CASE that matches the errors --
  // Only what 0005 proved exists (companies/products/product_variants) plus a
  // users table. Deliberately: users.role is TEXT and missing photo_url; products
  // .category is TEXT; product_variants LACKS sku/expiry_date; NO enum types are
  // pre-created; NO view; NO customers/sales/sale_items/notifications tables.
  // If 0003 can build up from THIS, it can handle the real DB.
  await run("MINIMAL partial schema (pre-0001/0002 shape)", `
    create table users (
      id uuid primary key default gen_random_uuid(),
      name text not null, phone text unique not null,
      role text not null default 'employee',          -- TEXT, not the enum
      is_original_owner boolean not null default false,
      is_active boolean not null default true,
      created_at timestamptz not null default now()
      -- NOTE: intentionally missing photo_url / job_title / timestamps / created_by
    );
    create table companies (
      id uuid primary key default gen_random_uuid(), name text not null, contact_person text,
      phone text, address text, logo_url text,
      outstanding_payable numeric(14,2) not null default 0, total_purchases numeric(14,2) not null default 0,
      created_at timestamptz not null default now()
    );
    create table products (
      id uuid primary key default gen_random_uuid(), name text not null, company text not null,
      category text not null default 'other',          -- TEXT, not the enum
      image_url text, created_at timestamptz not null default now()
    );
    create table product_variants (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references products(id) on delete cascade,
      name text not null,
      selling_price numeric(12,2) not null default 0, cost_price numeric(12,2) not null default 0,
      stock_qty integer not null default 0, low_stock_threshold integer not null default 5
      -- NOTE: intentionally missing sku / expiry_date
    );
    -- Seed as 0005 would have: a company, a product, a variant with stock.
    insert into companies (name) values ('Acme Agri');
    with p as (insert into products (name, company, category) values ('Urea','Acme Agri','fertilizer') returning id)
    insert into product_variants (product_id, name, selling_price, cost_price, stock_qty)
      select id, '50kg', 4500, 4000, 10 from p;
  `);

  // ---- THE ACTUAL MIGRATIONS UNDER TEST ------------------------------------
  await run("0003_role_aware_rls.sql", read("0003_role_aware_rls.sql"));
  await run("0004_operational_tables_and_rpcs.sql", read("0004_operational_tables_and_rpcs.sql"));

  // ---- Seed a signed-in admin + a customer, then exercise the RPCs ---------
  // (company/product/variant already exist from the partial-schema setup above.)
  await run("seed admin user + customer", `
    insert into users (name, phone, role, is_original_owner) values ('Owner', '${CURRENT_PHONE}', 'admin', true);
    insert into customers (name, phone, outstanding_balance) values ('Farmer Ali', '923009998877', 0);
  `);

  // Confirm role resolution actually returns admin through the text-cast helper.
  const roleRes = await db.query(`select app_current_role() as role, app_is_admin() as is_admin`);
  console.log(`   app_current_role() => ${roleRes.rows[0].role}, app_is_admin() => ${roleRes.rows[0].is_admin}`);
  if (roleRes.rows[0].role !== "admin" || roleRes.rows[0].is_admin !== true)
    throw new Error("role helper did not resolve admin");

  const variant = (await db.query(`select id from product_variants limit 1`)).rows[0].id;
  const customer = (await db.query(`select id from customers limit 1`)).rows[0].id;

  // create_sale: 3 units on credit -> stock 10->7, customer balance +13500
  const salePayload = JSON.stringify({
    customerId: customer, customerName: "Farmer Ali", paymentType: "credit",
    paymentMethod: "cash", amountPaid: 0, note: "test",
    items: [{ variantId: variant, productId: null, productName: "Urea", variantName: "50kg", qty: 3 }],
  });
  const sale = (await db.query(`select create_sale($1::jsonb) as r`, [salePayload])).rows[0].r;
  const stockAfterSale = (await db.query(`select stock_qty from product_variants where id=$1`, [variant])).rows[0].stock_qty;
  const balAfterSale = (await db.query(`select outstanding_balance from customers where id=$1`, [customer])).rows[0].outstanding_balance;
  console.log(`✓ create_sale => total ${sale.totalAmount}, stock 10->${stockAfterSale}, customer balance ${balAfterSale}`);
  if (stockAfterSale !== 7) throw new Error(`expected stock 7, got ${stockAfterSale}`);

  // record_customer_payment: pay 5000 -> balance 13500 -> 8500
  const payPayload = JSON.stringify({ customerId: customer, amount: 5000, method: "cash", notes: "part" });
  const pay = (await db.query(`select record_customer_payment($1::jsonb) as r`, [payPayload])).rows[0].r;
  console.log(`✓ record_customer_payment => balanceAfter ${pay.balanceAfter}`);
  if (Number(pay.balanceAfter) !== 8500) throw new Error(`expected balance 8500, got ${pay.balanceAfter}`);

  // adjust_stock 'add' 5 -> 7 -> 12
  const adjPayload = JSON.stringify({ variantId: variant, productId: null, productName: "Urea", adjustmentType: "add", qty: 5, reason: "recount" });
  const adj = (await db.query(`select adjust_stock($1::jsonb) as r`, [adjPayload])).rows[0].r;
  console.log(`✓ adjust_stock(add 5) => ${adj.qtyBefore}->${adj.qtyAfter}`);
  if (adj.qtyAfter !== 12) throw new Error(`expected 12, got ${adj.qtyAfter}`);

  // never-negative guard: remove 999 must raise
  try {
    await db.query(`select adjust_stock($1::jsonb) as r`,
      [JSON.stringify({ variantId: variant, adjustmentType: "remove", qty: 999, productName: "Urea" })]);
    throw new Error("expected NEGATIVE_STOCK error, but none was raised");
  } catch (e) {
    if (!/NEGATIVE_STOCK/.test(e.message)) throw e;
    console.log("✓ never-negative guard raised NEGATIVE_STOCK");
  }

  // insufficient-stock guard on sale: sell 9999 must raise
  try {
    await db.query(`select create_sale($1::jsonb) as r`, [JSON.stringify({
      customerName: "X", paymentType: "full", paymentMethod: "cash",
      items: [{ variantId: variant, productName: "Urea", variantName: "50kg", qty: 9999 }],
    })]);
    throw new Error("expected INSUFFICIENT_STOCK error, but none was raised");
  } catch (e) {
    if (!/INSUFFICIENT_STOCK/.test(e.message)) throw e;
    console.log("✓ insufficient-stock guard raised INSUFFICIENT_STOCK");
  }

  // create_product + create_purchase (admin flows), process_return
  const cprod = (await db.query(`select create_product($1::jsonb) as r`, [JSON.stringify({
    name: "Karate", company: "Acme Agri", category: "spray",
    variants: [{ name: "250ml", sellingPrice: 1200, costPrice: 850, stockQty: 4, lowStockThreshold: 5 }],
  })])).rows[0].r;
  console.log(`✓ create_product => ${cprod.id ? "ok" : "FAIL"}`);

  const company = (await db.query(`select id from companies limit 1`)).rows[0].id;
  const newVariant = (await db.query(`select id from product_variants where name='250ml'`)).rows[0].id;
  const cpur = (await db.query(`select create_purchase($1::jsonb) as r`, [JSON.stringify({
    companyId: company, companyName: "Acme Agri", amountPaid: 0, paymentMethod: "cash",
    items: [{ variantId: newVariant, productName: "Karate", variantName: "250ml", qty: 20, costPrice: 850 }],
  })])).rows[0].r;
  const stk = (await db.query(`select stock_qty from product_variants where id=$1`, [newVariant])).rows[0].stock_qty;
  console.log(`✓ create_purchase => payable ${cpur.outstandingPayable}, 250ml stock 4->${stk}`);
  if (stk !== 24) throw new Error(`expected 24, got ${stk}`);

  const saleItemId = (await db.query(`select id from sale_items limit 1`)).rows[0].id;
  const ret = (await db.query(`select process_return($1::jsonb) as r`, [JSON.stringify({
    saleId: sale.id, customerId: customer, customerName: "Farmer Ali", resolution: "credit_note",
    items: [{ saleItemId, variantId: variant, productName: "Urea", variantName: "50kg", qty: 1, unitPrice: 4500, restock: true }],
  })])).rows[0].r;
  console.log(`✓ process_return => ${ret.returnNumber}, refund ${ret.totalRefund}`);

  // ---- Idempotency: re-running both migrations must not error --------------
  await run("0003 re-run (idempotent)", read("0003_role_aware_rls.sql"));
  await run("0004 re-run (idempotent)", read("0004_operational_tables_and_rpcs.sql"));
  // And the RPCs still work after the re-run (helpers/policies intact).
  const stockNow = (await db.query(`select stock_qty from product_variants where id=$1`, [variant])).rows[0].stock_qty;
  const reSale = (await db.query(`select create_sale($1::jsonb) as r`, [JSON.stringify({
    customerName: "Walk-in", paymentType: "full", paymentMethod: "cash",
    items: [{ variantId: variant, productName: "Urea", variantName: "50kg", qty: 1 }],
  })])).rows[0].r;
  console.log(`✓ create_sale after re-run => total ${reSale.totalAmount} (stock was ${stockNow})`);

  console.log("\n=== ALL MIGRATIONS AND RPCs VERIFIED ON A REAL POSTGRES ENGINE ===");
} catch (e) {
  console.error("\nVERIFICATION FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
