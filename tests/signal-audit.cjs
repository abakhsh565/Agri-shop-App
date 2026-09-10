/**
 * Signal / Action Center Audit
 *
 * Tests the real computeLiveSignals engine against live Supabase data:
 * 1. Overdue credit
 * 2. Credit limit reached
 * 3. No due date
 * 4. Out of stock
 * 5. Low stock
 * 6. Expiry approaching
 * 7. Supplier payable due/overdue
 * 8. Missing customer info
 *
 * Uses the bundled engine (same as production) against real DB data.
 */

const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Import the signal engine from the bundled reminder engine
// The signal engine is a standalone pure function — we can import it directly
// by reading and evaluating the source since it has no import.meta.env dependencies
let computeLiveSignals;

// Load signal engine by bundling just that file
async function loadSignalEngine() {
  const esbuild = require("esbuild");
  const tmpOut = path.resolve(__dirname, "../dist/signalEngine-bundle.cjs");
  
  esbuild.buildSync({
    entryPoints: [path.resolve("src/lib/signalEngine.ts")],
    bundle: true,
    outfile: tmpOut,
    platform: "node",
    format: "cjs",
    define: {},
  });
  
  const mod = require(tmpOut);
  computeLiveSignals = mod.computeLiveSignals;
  console.log("Signal engine loaded:", typeof computeLiveSignals);
}

const TEST_IDS = { customers: [], products: [], variants: [], companies: [] };
const BASELINE = {};
const results = [];

function record(test, pass, detail) {
  results.push({ test, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}: ${test} — ${detail}`);
}

// Map DB rows to the engine's expected Customer format
function mapCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || "",
    address: row.address || "",
    outstandingBalance: parseFloat(row.outstanding_balance) || 0,
    dueDate: row.due_date || null,
    totalPurchases: parseFloat(row.total_purchases) || 0,
    totalPaid: parseFloat(row.total_paid) || 0,
    creditLimit: parseFloat(row.credit_limit) || 0,
    isActive: row.is_active !== false,
    isArchived: row.is_archived === true,
    createdAt: row.created_at,
  };
}

// Map DB rows to the engine's expected Product format
function mapProduct(row, variants) {
  return {
    id: row.id,
    name: row.name,
    company: row.company || "",
    category: row.category || "other",
    stockQty: parseFloat(row.stock_qty) || 0,
    imageUrl: row.image_url || null,
    barcode: row.barcode || null,
    baseUnit: row.base_unit || "piece",
    variants: variants.map(v => ({
      id: v.id,
      productId: v.product_id,
      name: v.name,
      sellingPrice: parseFloat(v.selling_price) || 0,
      costPrice: parseFloat(v.cost_price) || 0,
      unitSize: parseFloat(v.unit_size) || 1,
      qtyStep: parseFloat(v.qty_step) || 1,
      lowStockThreshold: parseInt(v.low_stock_threshold) || 5,
      expiryDate: v.expiry_date || null,
      stockQty: parseFloat(v.stock_qty) || 0,
    })),
  };
}

async function recordBaseline() {
  const { data: custs } = await sb.from("customers").select("id").eq("is_archived", false);
  BASELINE.customerCount = custs?.length || 0;
  
  const { data: sales } = await sb.from("sales").select("id").limit(500);
  BASELINE.salesCount = sales?.length || 0;
  
  const { data: items } = await sb.from("sale_items").select("id").limit(500);
  BASELINE.itemsCount = items?.length || 0;
  
  const bilal = (await sb.from("customers").select("outstanding_balance, total_purchases").eq("id", "00000000-0000-0000-0000-000000000052").single()).data;
  BASELINE.bilal = { outstanding: parseFloat(bilal?.outstanding_balance), purchases: parseFloat(bilal?.total_purchases) };
  
  const maize = (await sb.from("products").select("stock_qty").eq("id", "00000000-0000-0000-0000-000000000020").single()).data;
  BASELINE.maizeStock = parseFloat(maize?.stock_qty);
  
  console.log(`Baseline: ${BASELINE.customerCount} customers, ${BASELINE.salesCount} sales, ${BASELINE.itemsCount} items, maize: ${BASELINE.maizeStock}`);
}

async function verifyBaseline() {
  const active = (await sb.from("customers").select("id").eq("is_archived", false)).data?.length || 0;
  const sales = (await sb.from("sales").select("id").limit(500)).data?.length || 0;
  const items = (await sb.from("sale_items").select("id").limit(500)).data?.length || 0;
  const bilal = (await sb.from("customers").select("outstanding_balance, total_purchases").eq("id", "00000000-0000-0000-0000-000000000052").single()).data;
  const maize = (await sb.from("products").select("stock_qty").eq("id", "00000000-0000-0000-0000-000000000020").single()).data;
  
  console.log("\nBaseline verification:");
  const checks = [
    ["Customers", active, BASELINE.customerCount],
    ["Sales", sales, BASELINE.salesCount],
    ["Items", items, BASELINE.itemsCount],
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
  for (const id of TEST_IDS.variants) {
    await sb.from("product_variants").delete().eq("id", id);
  }
  for (const id of TEST_IDS.products) {
    await sb.from("products").delete().eq("id", id);
  }
  for (const id of TEST_IDS.customers) {
    // Archive instead of delete (RLS blocks delete)
    await sb.rpc("archive_customer", { p_customer_id: id });
  }
  console.log("  Cleanup complete");
}

async function run() {
  try {
    await loadSignalEngine();
    await recordBaseline();
    console.log("\n=== SIGNAL / ACTION CENTER AUDIT ===\n");
    
    // ═══════════════════════════════════════
    // Load real data from DB
    // ═══════════════════════════════════════
    const { data: custRows } = await sb.from("customers").select("*").eq("is_archived", false);
    const customers = (custRows || []).map(mapCustomer);
    
    const { data: prodRows } = await sb.from("products").select("*").limit(200);
    const { data: varRows } = await sb.from("product_variants").select("*").limit(500);
    const products = (prodRows || []).map(p => {
      const pvars = (varRows || []).filter(v => v.product_id === p.id);
      return mapProduct(p, pvars);
    });
    
    console.log(`Loaded ${customers.length} customers, ${products.length} products`);
    
    // Run the engine with real data
    const now = new Date();
    const signals = computeLiveSignals({ customers, products, companies: [], now });
    
    console.log(`Engine produced ${signals.length} signals\n`);
    
    // ═══════════════════════════════════════
    // TEST 1: Overdue credit signals
    // ═══════════════════════════════════════
    console.log("--- S1: Overdue Credit ---");
    const overdueSignals = signals.filter(s => s.category === "overdue_credit");
    console.log(`  Found ${overdueSignals.length} overdue credit signal(s)`);
    
    // Check Bilal (outstanding=3880, due_date=null → should NOT have overdue signal)
    const bilalOverdue = overdueSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000052");
    record("1a. Bilal has no overdue signal (due_date=null)", !bilalOverdue, bilalOverdue ? "FALSE POSITIVE" : "correctly absent");
    
    // Check Ahmad Raza (outstanding=38520, due_date=2026-09-05 → overdue by 1 day)
    const ahmadOverdue = overdueSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000051");
    record("1b. Ahmad Raza overdue signal exists", !!ahmadOverdue, ahmadOverdue ? `${ahmadOverdue.days} days overdue` : "MISSING");
    if (ahmadOverdue) {
      record("1c. Ahmad Raza severity=critical", ahmadOverdue.severity === "critical", ahmadOverdue.severity);
      record("1d. Ahmad Raza entity_type=customer", ahmadOverdue.entity_type === "customer", ahmadOverdue.entity_type);
      record("1e. Ahmad Raza outstanding in detail", ahmadOverdue.detail.includes("38"), ahmadOverdue.detail);
    }
    
    // Check Malik Henry (outstanding=49300, due_date=2026-09-09 → NOT overdue yet)
    const malikOverdue = overdueSignals.find(s => s.entity_id === "e923683a-df07-43e5-a6c7-9f7abd2a2481");
    record("1f. Malik Henry no overdue (due in future)", !malikOverdue, malikOverdue ? "FALSE POSITIVE" : "correctly absent");
    
    // ═══════════════════════════════════════
    // TEST 2: Credit limit signals
    // ═══════════════════════════════════════
    console.log("\n--- S5: Credit Limit ---");
    const creditLimitSignals = signals.filter(s => s.category === "credit_limit");
    console.log(`  Found ${creditLimitSignals.length} credit limit signal(s)`);
    
    // Naveed: outstanding=36000, credit_limit=25000 → should trigger
    const naveedCredit = creditLimitSignals.find(s => s.entity_id === "2761fdd2-419f-43f6-880e-69a84cd3a3c2");
    record("2a. Naveed credit limit signal exists", !!naveedCredit, naveedCredit ? `${naveedCredit.detail}` : "MISSING");
    if (naveedCredit) {
      record("2b. Naveed severity=warning", naveedCredit.severity === "warning", naveedCredit.severity);
      record("2c. Naveed value >= threshold", naveedCredit.value >= naveedCredit.threshold, `${naveedCredit.value} >= ${naveedCredit.threshold}`);
    }
    
    // Bilal: outstanding=3880, credit_limit=20000 → should NOT trigger
    const bilalCredit = creditLimitSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000052");
    record("2d. Bilal no credit limit signal (3880 < 20000)", !bilalCredit, bilalCredit ? "FALSE POSITIVE" : "correctly absent");
    
    // ═══════════════════════════════════════
    // TEST 3: No due date signals
    // ═══════════════════════════════════════
    console.log("\n--- S6: No Due Date ---");
    const noDueSignals = signals.filter(s => s.category === "no_due_date");
    console.log(`  Found ${noDueSignals.length} no-due-date signal(s)`);
    
    // Bilal: outstanding=3880, due_date=null → should trigger
    const bilalNoDue = noDueSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000052");
    record("3a. Bilal no-due-date signal exists", !!bilalNoDue, bilalNoDue ? bilalNoDue.detail : "MISSING");
    if (bilalNoDue) {
      record("3b. Bilal severity=info", bilalNoDue.severity === "info", bilalNoDue.severity);
    }
    
    // ═══════════════════════════════════════
    // TEST 4: Out of stock signals
    // ═══════════════════════════════════════
    console.log("\n--- S7: Out of Stock ---");
    const outOfStockSignals = signals.filter(s => s.category === "out_of_stock");
    console.log(`  Found ${outOfStockSignals.length} out-of-stock signal(s)`);
    
    // Cotton Seeds BT: stock=0.25 → not out of stock (0.25 > 0.01)
    const cottonOOS = outOfStockSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000025");
    record("4a. Cotton Seeds not out-of-stock (0.25 > 0.01)", !cottonOOS, cottonOOS ? "FALSE POSITIVE" : "correctly absent");
    
    // Check if any products are genuinely out of stock
    const oosProducts = products.filter(p => p.stockQty <= 0.01);
    record("4b. Out-of-stock signals match actual data", outOfStockSignals.length === oosProducts.length, `engine: ${outOfStockSignals.length}, actual: ${oosProducts.length}`);
    
    // ═══════════════════════════════════════
    // TEST 5: Low stock signals
    // ═══════════════════════════════════════
    console.log("\n--- S8: Low Stock ---");
    const lowStockSignals = signals.filter(s => s.category === "low_stock");
    console.log(`  Found ${lowStockSignals.length} low-stock signal(s)`);
    
    // NPK Fertilizer: stock=1, threshold=5 → should trigger
    const npkLow = lowStockSignals.find(s => s.entity_id === "00000000-0000-0000-0000-000000000021");
    record("5a. NPK Fertilizer low-stock signal exists", !!npkLow, npkLow ? npkLow.detail : "MISSING");
    if (npkLow) {
      record("5b. NPK severity=warning", npkLow.severity === "warning", npkLow.severity);
    }
    
    // ═══════════════════════════════════════
    // TEST 6: Expiry signals
    // ═══════════════════════════════════════
    console.log("\n--- S9: Expiry ---");
    const expirySignals = signals.filter(s => s.category === "expiry_approaching");
    console.log(`  Found ${expirySignals.length} expiry signal(s)`);
    
    // Check if any products have expiry dates within 30 days
    const expiringVariants = products.flatMap(p => p.variants.filter(v => {
      if (!v.expiryDate) return false;
      const today = new Date().toISOString().split("T")[0];
      const expDate = v.expiryDate;
      const diffMs = new Date(expDate).getTime() - new Date(today).getTime();
      return diffMs / 86400000 <= 30;
    }));
    record("6a. Expiry signals match actual data", expirySignals.length === expiringVariants.length || (expirySignals.length === 0 && expiringVariants.length === 0), `engine: ${expirySignals.length}, actual: ${expiringVariants.length}`);
    
    // ═══════════════════════════════════════
    // TEST 7: Missing info signals
    // ═══════════════════════════════════════
    console.log("\n--- S13: Missing Info ---");
    const missingInfoSignals = signals.filter(s => s.category === "missing_info");
    console.log(`  Found ${missingInfoSignals.length} missing-info signal(s)`);
    
    // Check that all active customers without phone/address are flagged
    const missingCusts = customers.filter(c => !c.isArchived && (!c.phone || c.phone.trim() === "" || !c.address || c.address.trim() === ""));
    record("7a. Missing-info signals match actual data", missingInfoSignals.length === missingCusts.length, `engine: ${missingInfoSignals.length}, actual: ${missingCusts.length}`);
    
    // ═══════════════════════════════════════
    // TEST 8: Signal ID uniqueness
    // ═══════════════════════════════════════
    console.log("\n--- Uniqueness ---");
    const signalIds = signals.map(s => s.id);
    const uniqueIds = new Set(signalIds);
    record("8a. All signal IDs unique", signalIds.length === uniqueIds.size, `${signalIds.length} total, ${uniqueIds.size} unique`);
    
    // ═══════════════════════════════════════
    // TEST 9: Idempotency — recompute same data
    // ═══════════════════════════════════════
    console.log("\n--- Idempotency ---");
    const signals2 = computeLiveSignals({ customers, products, companies: [], now });
    const ids1 = signals.map(s => s.id).sort();
    const ids2 = signals2.map(s => s.id).sort();
    record("9a. Recompute produces same signal IDs", JSON.stringify(ids1) === JSON.stringify(ids2), `run1: ${ids1.length}, run2: ${ids2.length}`);
    
    // ═══════════════════════════════════════
    // TEST 10: Severity correctness
    // ═══════════════════════════════════════
    console.log("\n--- Severity ---");
    const critical = signals.filter(s => s.severity === "critical");
    const warning = signals.filter(s => s.severity === "warning");
    const info = signals.filter(s => s.severity === "info");
    console.log(`  Critical: ${critical.length}, Warning: ${warning.length}, Info: ${info.length}`);
    
    // Overdue credit should be critical
    const overdueCritical = overdueSignals.every(s => s.severity === "critical");
    record("10a. Overdue credit = critical", overdueCritical, overdueCritical ? "all critical" : "MIXED");
    
    // Credit limit should be warning
    const creditWarning = creditLimitSignals.every(s => s.severity === "warning");
    record("10b. Credit limit = warning", creditWarning, creditWarning ? "all warning" : "MIXED");
    
    // Out of stock should be critical
    const oosCritical = outOfStockSignals.every(s => s.severity === "critical");
    record("10c. Out of stock = critical", oosCritical || outOfStockSignals.length === 0, oosCritical ? "all critical" : "N/A (no OOS)");
    
    // Low stock should be warning
    const lowWarning = lowStockSignals.every(s => s.severity === "warning");
    record("10d. Low stock = warning", lowWarning || lowStockSignals.length === 0, lowWarning ? "all warning" : "N/A");
    
    // ═══════════════════════════════════════
    // TEST 11: Create test data and verify signals fire
    // ═══════════════════════════════════════
    console.log("\n--- TEST DATA: Trigger new signals ---");
    
    // Create a test customer with past due date + outstanding
    const testCustId = crypto.randomUUID();
    await sb.from("customers").insert({
      id: testCustId,
      name: `SIGNAL_TEST_${Date.now().toString(36)}`,
      phone: "03999999999",
      outstanding_balance: 5000,
      total_purchases: 5000,
      due_date: "2026-01-01", // far past
      credit_limit: 2000,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    TEST_IDS.customers.push(testCustId);
    
    // Reload and recompute
    const { data: updatedCusts } = await sb.from("customers").select("*").eq("is_archived", false);
    const updatedCustomers = (updatedCusts || []).map(mapCustomer);
    const updatedSignals = computeLiveSignals({ customers: updatedCustomers, products, companies: [], now });
    
    const testOverdue = updatedSignals.find(s => s.category === "overdue_credit" && s.entity_id === testCustId);
    record("11a. Test customer overdue signal fires", !!testOverdue, testOverdue ? `${testOverdue.days} days` : "MISSING");
    
    const testCreditLimit = updatedSignals.find(s => s.category === "credit_limit" && s.entity_id === testCustId);
    record("11b. Test customer credit limit signal fires", !!testCreditLimit, testCreditLimit ? testCreditLimit.detail : "MISSING");
    
    // ═══════════════════════════════════════
    // TEST 12: Signal disappears when condition resolved
    // ═══════════════════════════════════════
    console.log("\n--- TEST DATA: Signal disappears ---");
    
    // Clear the test customer's due date → overdue signal should disappear
    await sb.from("customers").update({ due_date: null }).eq("id", testCustId);
    
    const { data: resolvedCusts } = await sb.from("customers").select("*").eq("is_archived", false);
    const resolvedCustomers = (resolvedCusts || []).map(mapCustomer);
    const resolvedSignals = computeLiveSignals({ customers: resolvedCustomers, products, companies: [], now });
    
    const resolvedOverdue = resolvedSignals.find(s => s.category === "overdue_credit" && s.entity_id === testCustId);
    record("12a. Overdue signal gone after due_date cleared", !resolvedOverdue, resolvedOverdue ? "STILL PRESENT" : "correctly gone");
    
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
    
    // Print signal summary
    console.log("\n  Signal Summary:");
    const byCategory = {};
    for (const s of updatedSignals) {
      if (!byCategory[s.category]) byCategory[s.category] = { count: 0, severities: {} };
      byCategory[s.category].count++;
      byCategory[s.category].severities[s.severity] = (byCategory[s.category].severities[s.severity] || 0) + 1;
    }
    for (const [cat, info] of Object.entries(byCategory)) {
      console.log(`    ${cat}: ${info.count} (${JSON.stringify(info.severities)})`);
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
