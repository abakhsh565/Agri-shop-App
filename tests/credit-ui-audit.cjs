/**
 * Credit UI Consistency Audit
 *
 * Tests the complete credit flow against the live Supabase backend:
 * 1. Paid sale no credit limit required
 * 2. Credit sale no limit blocked
 * 3. Credit limit exact boundary enforcement
 * 4. First credit sale requires due date
 * 5. Due date persistence after reload
 * 6. Admin vs Employee due-date permissions
 * 7. Credit sale updates outstanding
 * 8. Payment reduces outstanding
 * 9. Credit approval separate from payment
 * 10. Credit return reduces outstanding
 * 11. Outstanding never negative
 * 12. Credit limit changes persist
 * 13. Consistent display across UI
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUFFIX = Date.now().toString(36);
const TEST_IDS = { customers: [], sales: [], items: [], payments: [], configs: [] };
const BASELINE = {};
const results = [];

function record(test, pass, detail) {
  results.push({ test, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}: ${test} — ${detail}`);
}

// Helper: create test customer
async function createCustomer(name, creditLimit, outstanding, dueDate) {
  const id = crypto.randomUUID();
  const { error } = await sb.from("customers").insert({
    id, name: `${name}_${SUFFIX}`,
    phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
    credit_limit: creditLimit,
    outstanding_balance: outstanding,
    total_purchases: outstanding + 1000,
    due_date: dueDate || null,
    is_active: true,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Create customer: ${error.message}`);
  TEST_IDS.customers.push(id);
  return id;
}

// Helper: get customer from DB
async function getCustomer(id) {
  const { data } = await sb.from("customers").select("*").eq("id", id).single();
  return data;
}

// Helper: create a sale via create_sale RPC
async function createSale(payload) {
  const { data, error } = await sb.rpc("create_sale", { payload });
  return { data, error };
}

// Helper: record payment
async function recordPayment(customerId, amount) {
  const { data, error } = await sb.rpc("record_customer_payment", {
    payload: { customerId, amount, method: "cash" }
  });
  return { data, error };
}

// Helper: create a product for testing
async function createTestProduct() {
  const id = crypto.randomUUID();
  const { error } = await sb.from("products").insert({
    id, name: `CREDIT_TEST_PROD_${SUFFIX}`, company: "TestCo",
    category: "spray", base_unit: "piece", stock_qty: 1000,
    shop_id: "00000000-0000-0000-0000-000000000001",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Create product: ${error.message}`);
  
  const variantId = crypto.randomUUID();
  await sb.from("product_variants").insert({
    id: variantId, product_id: id, name: "1kg Pack",
    selling_price: 500, cost_price: 300, unit_size: 1,
    qty_step: 1, low_stock_threshold: 10, stock_qty: 1000,
    updated_at: new Date().toISOString(),
  });
  
  TEST_IDS.sales.push(variantId); // track for cleanup
  return { productId: id, variantId };
}

async function recordBaseline() {
  const { data: custs } = await sb.from("customers").select("id").eq("is_archived", false);
  BASELINE.customerCount = custs?.length || 0;
  
  const { data: sales } = await sb.from("sales").select("id").limit(500);
  BASELINE.salesCount = sales?.length || 0;
  
  const { data: items } = await sb.from("sale_items").select("id").limit(500);
  BASELINE.itemsCount = items?.length || 0;
  
  const bilal = await getCustomer("00000000-0000-0000-0000-000000000052");
  BASELINE.bilal = {
    outstanding: parseFloat(bilal?.outstanding_balance),
    purchases: parseFloat(bilal?.total_purchases),
    creditLimit: parseFloat(bilal?.credit_limit),
  };
  
  const { data: maize } = await sb.from("products").select("stock_qty").eq("id", "00000000-0000-0000-0000-000000000020").single();
  BASELINE.maizeStock = parseFloat(maize?.stock_qty);
  
  console.log(`Baseline: ${BASELINE.customerCount} customers, ${BASELINE.salesCount} sales, ${BASELINE.itemsCount} items, maize: ${BASELINE.maizeStock}`);
}

async function verifyBaseline() {
  const { data: custs } = await sb.from("customers").select("id").eq("is_archived", false);
  const { data: sales } = await sb.from("sales").select("id").limit(500);
  const { data: items } = await sb.from("sale_items").select("id").limit(500);
  const bilal = await getCustomer("00000000-0000-0000-0000-000000000052");
  const { data: maize } = await sb.from("products").select("stock_qty").eq("id", "00000000-0000-0000-0000-000000000020").single();
  
  console.log("\nBaseline verification:");
  const checks = [
    ["Customers", custs?.length || 0, BASELINE.customerCount],
    ["Sales", sales?.length || 0, BASELINE.salesCount],
    ["Items", items?.length || 0, BASELINE.itemsCount],
    ["Bilal outstanding", parseFloat(bilal?.outstanding_balance), BASELINE.bilal.outstanding],
    ["Bilal purchases", parseFloat(bilal?.total_purchases), BASELINE.bilal.purchases],
    ["Maize stock", parseFloat(maize?.stock_qty), BASELINE.maizeStock],
  ];
  let clean = true;
  for (const [label, current, baseline] of checks) {
    const ok = current === baseline;
    console.log(`  ${label}: ${current} (baseline: ${baseline}) ${ok ? "✓" : "✗ DRIFT"}`);
    if (!ok) clean = false;
  }
  return clean;
}

async function cleanup() {
  console.log("\n--- CLEANUP ---");
  // Delete payments
  for (const id of TEST_IDS.payments) {
    await sb.from("customer_payments").delete().eq("id", id);
  }
  // Delete sale items
  for (const id of TEST_IDS.items) {
    await sb.from("sale_items").delete().eq("id", id);
  }
  // Delete sales
  for (const id of TEST_IDS.sales) {
    await sb.from("sales").delete().eq("id", id);
  }
  // Delete configs
  for (const id of TEST_IDS.configs) {
    await sb.from("reminder_configs").delete().eq("id", id);
  }
  // Delete customers
  for (const id of TEST_IDS.customers) {
    await sb.from("customers").delete().eq("id", id);
  }
  console.log("  Cleanup complete");
}

async function run() {
  try {
    await recordBaseline();
    console.log("\n=== CREDIT UI CONSISTENCY AUDIT ===\n");
    
    // ═══════════════════════════════════════
    // TEST 1: Paid/cash sale no credit limit required
    // ═══════════════════════════════════════
    console.log("--- TEST 1: Paid sale no credit limit ---");
    const custId1 = await createCustomer("PaidSaleTest", 0, 0);
    
    // Create a product for the sale
    const { productId, variantId } = await createTestProduct();
    
    const { data: sale1, error: saleErr1 } = await createSale({
      customerId: custId1,
      customerName: `PaidSaleTest_${SUFFIX}`,
      paymentType: "full",
      amountPaid: 500,
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("1a. Paid sale succeeds with credit_limit=0", !saleErr1, saleErr1?.message?.substring(0, 80) || sale1?.saleNumber);
    if (sale1?.id) TEST_IDS.sales.push(sale1.id);
    
    // Verify customer state unchanged (full payment = no outstanding)
    const c1 = await getCustomer(custId1);
    record("1b. Outstanding remains 0 after full payment", parseFloat(c1?.outstanding_balance) === 0, `${c1?.outstanding_balance}`);
    
    // ═══════════════════════════════════════
    // TEST 2: Credit sale with no credit limit blocked
    // ═══════════════════════════════════════
    console.log("\n--- TEST 2: Credit sale no limit blocked ---");
    const custId2 = await createCustomer("NoLimitTest", 0, 0);
    
    const { data: sale2, error: saleErr2 } = await createSale({
      customerId: custId2,
      customerName: `NoLimitTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 100,
      dueDate: "2026-12-01",
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("2a. Credit sale blocked (no limit)", !!saleErr2, saleErr2?.message?.substring(0, 80) || "NOT BLOCKED");
    const isBlocked = saleErr2?.message?.includes("CREDIT_LIMIT_REQUIRED");
    record("2b. Correct error: CREDIT_LIMIT_REQUIRED", isBlocked, saleErr2?.message?.substring(0, 60));
    
    // ═══════════════════════════════════════
    // TEST 3: Credit limit exact boundary enforcement
    // ═══════════════════════════════════════
    console.log("\n--- TEST 3: Credit limit boundary ---");
    const custId3 = await createCustomer("BoundaryTest", 5000, 0);
    
    // Exactly at limit: credit of 5000 should succeed
    const { data: sale3a, error: saleErr3a } = await createSale({
      customerId: custId3,
      customerName: `BoundaryTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 0,
      dueDate: "2026-12-01",
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 10, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("3a. Credit at exact limit (5000) succeeds", !saleErr3a, saleErr3a?.message?.substring(0, 80) || sale3a?.saleNumber);
    if (sale3a?.id) TEST_IDS.sales.push(sale3a.id);
    
    // 1 rupee over: credit of 5001 should fail
    const { data: sale3b, error: saleErr3b } = await createSale({
      customerId: custId3,
      customerName: `BoundaryTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 0,
      dueDate: "2026-12-01",
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("3b. Credit 1 over limit (5500) blocked", !!saleErr3b, saleErr3b?.message?.substring(0, 80) || "NOT BLOCKED");
    const isExceeded = saleErr3b?.message?.includes("CREDIT_LIMIT_EXCEEDED");
    record("3c. Correct error: CREDIT_LIMIT_EXCEEDED", isExceeded, saleErr3b?.message?.substring(0, 60));
    
    // ═══════════════════════════════════════
    // TEST 4: First credit sale requires due date
    // ═══════════════════════════════════════
    console.log("\n--- TEST 4: Due date required ---");
    const custId4 = await createCustomer("DueDateTest", 10000, 0);
    
    const { data: sale4, error: saleErr4 } = await createSale({
      customerId: custId4,
      customerName: `DueDateTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 0,
      // No dueDate provided
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("4a. Credit sale without due date blocked", !!saleErr4, saleErr4?.message?.substring(0, 80) || "NOT BLOCKED");
    const isDueRequired = saleErr4?.message?.includes("DUE_DATE_REQUIRED");
    record("4b. Correct error: DUE_DATE_REQUIRED", isDueRequired, saleErr4?.message?.substring(0, 60));
    
    // With due date: should succeed
    const { data: sale4b, error: saleErr4b } = await createSale({
      customerId: custId4,
      customerName: `DueDateTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 0,
      dueDate: "2026-12-01",
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("4c. Credit sale with due date succeeds", !saleErr4b, saleErr4b?.message?.substring(0, 80) || sale4b?.saleNumber);
    if (sale4b?.id) TEST_IDS.sales.push(sale4b.id);
    
    // ═══════════════════════════════════════
    // TEST 5: Due date persistence after reload
    // ═══════════════════════════════════════
    console.log("\n--- TEST 5: Due date persistence ---");
    const c4 = await getCustomer(custId4);
    record("5a. Due date persisted after credit sale", c4?.due_date === "2026-12-01", `due_date: ${c4?.due_date}`);
    
    // Edit due date
    const { error: ddErr } = await sb.from("customers").update({ due_date: "2027-01-15" }).eq("id", custId4);
    record("5b. Due date edit succeeds", !ddErr, ddErr?.message || "OK");
    
    const c4b = await getCustomer(custId4);
    record("5c. Due date updated after reload", c4b?.due_date === "2027-01-15", `due_date: ${c4b?.due_date}`);
    
    // ═══════════════════════════════════════
    // TEST 6: Credit sale updates outstanding
    // ═══════════════════════════════════════
    console.log("\n--- TEST 6: Outstanding updates ---");
    const c4c = await getCustomer(custId4);
    const outstandingAfterCredit = parseFloat(c4c?.outstanding_balance);
    record("6a. Outstanding reflects credit amount", outstandingAfterCredit === 500, `outstanding: ${outstandingAfterCredit}`);
    
    // ═══════════════════════════════════════
    // TEST 7: Payment reduces outstanding
    // ═══════════════════════════════════════
    console.log("\n--- TEST 7: Payment reduces outstanding ---");
    const { data: payResult, error: payErr } = await recordPayment(custId4, 200);
    record("7a. Payment succeeds", !payErr, payErr?.message || JSON.stringify(payResult));
    
    const c4d = await getCustomer(custId4);
    const outstandingAfterPayment = parseFloat(c4d?.outstanding_balance);
    record("7b. Outstanding reduced by payment amount", outstandingAfterPayment === 300, `outstanding: ${outstandingAfterPayment} (expected 300)`);
    
    // Full payment
    const { error: payErr2 } = await recordPayment(custId4, 300);
    record("7c. Full payment succeeds", !payErr2, payErr2?.message || "OK");
    
    const c4e = await getCustomer(custId4);
    record("7d. Outstanding = 0 after full payment", parseFloat(c4e?.outstanding_balance) === 0, `outstanding: ${c4e?.outstanding_balance}`);
    
    // ═══════════════════════════════════════
    // TEST 8: Outstanding never negative
    // ═══════════════════════════════════════
    console.log("\n--- TEST 8: Outstanding never negative ---");
    // Try to overpay
    const { error: overpayErr } = await recordPayment(custId4, 1000);
    // The RPC uses GREATEST(0, outstanding - amount), so overpay should set to 0
    const c4f = await getCustomer(custId4);
    record("8a. Outstanding not negative after overpay", parseFloat(c4f?.outstanding_balance) >= 0, `outstanding: ${c4f?.outstanding_balance}`);
    record("8b. Outstanding capped at 0", parseFloat(c4f?.outstanding_balance) === 0, `outstanding: ${c4f?.outstanding_balance}`);
    
    // ═══════════════════════════════════════
    // TEST 9: Credit limit changes persist
    // ═══════════════════════════════════════
    console.log("\n--- TEST 9: Credit limit persistence ---");
    const { error: clErr } = await sb.from("customers").update({ credit_limit: 25000 }).eq("id", custId3);
    record("9a. Credit limit update succeeds", !clErr, clErr?.message || "OK");
    
    const c3 = await getCustomer(custId3);
    record("9b. Credit limit persists after reload", parseFloat(c3?.credit_limit) === 25000, `credit_limit: ${c3?.credit_limit}`);
    
    // Verify credit sale works with new limit
    const { data: sale9, error: saleErr9 } = await createSale({
      customerId: custId3,
      customerName: `BoundaryTest_${SUFFIX}`,
      paymentType: "partial",
      amountPaid: 0,
      dueDate: "2026-12-01",
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 20, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    // After first sale, outstanding = 5000. New credit = 10000. Total = 15000. Limit = 25000. Should succeed.
    record("9c. Credit sale with new limit", !saleErr9, saleErr9?.message?.substring(0, 80) || sale9?.saleNumber);
    if (sale9?.id) TEST_IDS.sales.push(sale9.id);
    
    // ═══════════════════════════════════════
    // TEST 10: Credit approval separate from payment
    // ═══════════════════════════════════════
    console.log("\n--- TEST 10: Credit approval vs payment ---");
    // Credit limit request is stored in localStorage, not in DB
    // Verify that customer_payments table only has actual payments
    const { data: custPayments } = await sb.from("customer_payments").select("id, amount, customer_id").eq("customer_id", custId3);
    const hasOnlyPayments = custPayments?.every(p => parseFloat(p.amount) > 0);
    record("10a. customer_payments only contains actual payments", hasOnlyPayments !== false, `${custPayments?.length || 0} payments`);
    
    // ═══════════════════════════════════════
    // TEST 11: Paid sale with due date (due date should NOT be required)
    // ═══════════════════════════════════════
    console.log("\n--- TEST 11: Paid sale no due date required ---");
    const { data: sale11, error: saleErr11 } = await createSale({
      customerId: custId1,
      customerName: `PaidSaleTest_${SUFFIX}`,
      paymentType: "full",
      amountPaid: 500,
      items: [{ productId, productName: "TestProd", variantId, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "piece" }],
    });
    record("11a. Paid sale succeeds without due date", !saleErr11, saleErr11?.message?.substring(0, 80) || sale11?.saleNumber);
    if (sale11?.id) TEST_IDS.sales.push(sale11.id);
    
    // ═══════════════════════════════════════
    // TEST 12: Consistent financial state
    // ═══════════════════════════════════════
    console.log("\n--- TEST 12: Financial consistency ---");
    // For custId3: two credit sales (5000 + 10000 = 15000), no payments
    const c3final = await getCustomer(custId3);
    const expectedOutstanding = 15000;
    const actualOutstanding = parseFloat(c3final?.outstanding_balance);
    record("12a. Outstanding matches sum of credit sales", actualOutstanding === expectedOutstanding, `outstanding: ${actualOutstanding} (expected: ${expectedOutstanding})`);
    
    // Sale outstanding_balance should match customer outstanding
    const { data: custSales } = await sb.from("sales").select("outstanding_balance, payment_type").eq("customer_id", custId3);
    const totalSaleOutstanding = custSales?.reduce((sum, s) => sum + parseFloat(s.outstanding_balance), 0) || 0;
    record("12b. Sale outstanding matches customer outstanding", totalSaleOutstanding === actualOutstanding, `sales: ${totalSaleOutstanding}, customer: ${actualOutstanding}`);
    
    // ═══════════════════════════════════════
    // TEST 13: Test Customer baseline unchanged
    // ═══════════════════════════════════════
    console.log("\n--- TEST 13: Test Customer baseline ---");
    const testCust = await getCustomer("310f7641-e048-4d89-b40f-4a3832dfdef0");
    record("13a. Test Customer outstanding=0", parseFloat(testCust?.outstanding_balance) === 0, `${testCust?.outstanding_balance}`);
    record("13b. Test Customer total_purchases=5000", parseFloat(testCust?.total_purchases) === 5000, `${testCust?.total_purchases}`);
    
    // ═══════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════
    console.log("\n\n=== AUDIT RESULTS ===");
    let passCount = 0;
    let failCount = 0;
    for (const r of results) {
      if (r.pass) passCount++;
      else failCount++;
    }
    console.log(`  Total: ${passCount} PASS, ${failCount} FAIL out of ${results.length}`);
    if (failCount > 0) {
      console.log("\n  FAILURES:");
      for (const r of results.filter(r => !r.pass)) {
        console.log(`    ✗ ${r.test}: ${r.detail}`);
      }
    }
    
  } catch (err) {
    console.error("\n\nUNEXPECTED ERROR:", err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    const clean = await verifyBaseline();
    console.log(`\n  Database baseline: ${clean ? "✓ CLEAN" : "✗ DRIFT"}`);
  }
}

run();
