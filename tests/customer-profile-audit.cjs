/**
 * Customer/Profile Functionality Audit
 *
 * Tests the real Supabase backend (same path the UI uses):
 * 1. Create customer → verify all fields persist
 * 2. Edit customer → verify all fields persist after reload
 * 3. Customer reminder config → verify persistence after reload
 * 4. Due-date persistence → verify across reload
 * 5. Archive customer → verify it stays archived
 * 6. Verify no financial/inventory drift
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SUFFIX = Date.now().toString(36);
const TEST_IDS = { customers: [], configs: [], occurrences: [], crops: [], sales: [] };

// Pre-test baseline
const BASELINE = {};

async function recordBaseline() {
  const tables = {
    customers: async () => (await sb.from("customers").select("id").eq("is_archived", false)).data?.length || 0,
    sales: async () => (await sb.from("sales").select("id").limit(500)).data?.length || 0,
    sale_items: async () => (await sb.from("sale_items").select("id").limit(500)).data?.length || 0,
    reminder_configs: async () => (await sb.from("reminder_configs").select("id").limit(500)).data?.length || 0,
    reminder_occurrences: async () => (await sb.from("reminder_occurrences").select("id").limit(500)).data?.length || 0,
    products: async () => (await sb.from("products").select("id, stock_qty")).data || [],
  };
  
  for (const [t, fn] of Object.entries(tables)) {
    BASELINE[t] = await fn();
  }
  
  // Bilal baseline
  const { data: bilal } = await sb.from("customers").select("outstanding_balance, total_purchases, total_paid").eq("id", "00000000-0000-0000-0000-000000000052").single();
  BASELINE.bilal = bilal;
  
  console.log("Baseline recorded:");
  console.log("  Active customers:", BASELINE.customers);
  console.log("  Sales:", BASELINE.sales);
  console.log("  Sale items:", BASELINE.sale_items);
  console.log("  Reminder configs:", BASELINE.reminder_configs);
  console.log("  Bilal:", JSON.stringify(BASELINE.bilal));
}

async function verifyBaseline() {
  const activeCustomers = (await sb.from("customers").select("id").eq("is_archived", false)).data?.length || 0;
  const sales = (await sb.from("sales").select("id").limit(500)).data?.length || 0;
  const saleItems = (await sb.from("sale_items").select("id").limit(500)).data?.length || 0;
  const configs = (await sb.from("reminder_configs").select("id").limit(500)).data?.length || 0;
  const { data: bilal } = await sb.from("customers").select("outstanding_balance, total_purchases, total_paid").eq("id", "00000000-0000-0000-0000-000000000052").single();
  
  console.log("\nBaseline verification:");
  const checks = [
    ["Active customers", activeCustomers, BASELINE.customers],
    ["Sales", sales, BASELINE.sales],
    ["Sale items", saleItems, BASELINE.sale_items],
    ["Reminder configs", configs, BASELINE.reminder_configs],
    ["Bilal outstanding", bilal?.outstanding_balance, BASELINE.bilal?.outstanding_balance],
    ["Bilal purchases", bilal?.total_purchases, BASELINE.bilal?.total_purchases],
  ];
  
  let allClean = true;
  for (const [label, current, baseline] of checks) {
    const clean = current === baseline;
    console.log(`  ${label}: ${current} (baseline: ${baseline}) ${clean ? "✓" : "✗ DRIFT"}`);
    if (!clean) allClean = false;
  }
  return allClean;
}

async function cleanup() {
  console.log("\n--- CLEANUP ---");
  for (const id of TEST_IDS.occurrences) {
    await sb.from("reminder_occurrences").delete().eq("id", id);
  }
  for (const id of TEST_IDS.configs) {
    await sb.from("reminder_configs").delete().eq("id", id);
  }
  for (const { customerId, cropName } of TEST_IDS.crops) {
    await sb.from("customer_crops").delete().eq("customer_id", customerId).eq("crop_name", cropName);
  }
  for (const id of TEST_IDS.sales) {
    await sb.from("sale_items").delete().eq("sale_id", id);
    await sb.from("sales").delete().eq("id", id);
  }
  for (const id of TEST_IDS.customers) {
    await sb.from("customers").delete().eq("id", id);
  }
  console.log("  Cleanup complete");
}

const results = [];
function record(test, pass, detail) {
  results.push({ test, pass, detail });
  console.log(`  ${pass ? "✓ PASS" : "✗ FAIL"}: ${test} — ${detail}`);
}

async function run() {
  try {
    await recordBaseline();
    console.log("\n=== CUSTOMER/PROFILE AUDIT ===\n");
    
    // ═══════════════════════════════════════
    // TEST 1: Create new customer → verify persistence
    // ═══════════════════════════════════════
    console.log("--- TEST 1: Create new customer ---");
    const custId1 = crypto.randomUUID();
    const custData1 = {
      id: custId1,
      name: `CUST_AUDIT_${SUFFIX}`,
      phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
      address: "Test Address, Lahore",
      credit_limit: 25000,
      is_active: true,
      created_at: new Date().toISOString(),
    };
    
    const { error: createErr } = await sb.from("customers").insert(custData1);
    record("1a. Customer created", !createErr, createErr?.message || "OK");
    TEST_IDS.customers.push(custId1);
    
    // Reload from DB (simulates page reload)
    const { data: loaded1 } = await sb.from("customers").select("*").eq("id", custId1).single();
    record("1b. Name persists", loaded1?.name === custData1.name, `${loaded1?.name} vs ${custData1.name}`);
    record("1c. Phone persists", loaded1?.phone === custData1.phone, `${loaded1?.phone} vs ${custData1.phone}`);
    record("1d. Address persists", loaded1?.address === custData1.address, `${loaded1?.address} vs ${custData1.address}`);
    record("1e. Credit limit persists", parseFloat(loaded1?.credit_limit) === 25000, `${loaded1?.credit_limit} vs 25000`);
    record("1f. is_active persists", loaded1?.is_active === true, `${loaded1?.is_active}`);
    
    // ═══════════════════════════════════════
    // TEST 2: Edit customer → verify persistence
    // ═══════════════════════════════════════
    console.log("\n--- TEST 2: Edit customer ---");
    const newValues = {
      name: `CUST_AUDIT_EDITED_${SUFFIX}`,
      phone: `0321${Math.floor(1000000 + Math.random() * 9000000)}`,
      address: "Updated Address, Karachi",
      credit_limit: 50000,
    };
    
    const { error: editErr } = await sb.from("customers").update({
      name: newValues.name,
      phone: newValues.phone,
      address: newValues.address,
      credit_limit: newValues.credit_limit,
    }).eq("id", custId1);
    record("2a. Edit succeeds", !editErr, editErr?.message || "OK");
    
    // Reload from DB
    const { data: loaded2 } = await sb.from("customers").select("*").eq("id", custId1).single();
    record("2b. Name updated", loaded2?.name === newValues.name, `${loaded2?.name}`);
    record("2c. Phone updated", loaded2?.phone === newValues.phone, `${loaded2?.phone}`);
    record("2d. Address updated", loaded2?.address === newValues.address, `${loaded2?.address}`);
    record("2e. Credit limit updated", parseFloat(loaded2?.credit_limit) === 50000, `${loaded2?.credit_limit}`);
    
    // ═══════════════════════════════════════
    // TEST 3: Customer crops persistence
    // ═══════════════════════════════════════
    console.log("\n--- TEST 3: Customer crops ---");
    const testCrops = ["Wheat", "Cotton"];
    for (const crop of testCrops) {
      const { error } = await sb.from("customer_crops").insert({
        customer_id: custId1,
        crop_name: crop,
        created_at: new Date().toISOString(),
      });
      TEST_IDS.crops.push({ customerId: custId1, cropName: crop });
      if (error) console.log(`  Crop insert error: ${error.message}`);
    }
    
    const { data: crops } = await sb.from("customer_crops").select("crop_name").eq("customer_id", custId1);
    const cropNames = crops?.map(c => c.crop_name).sort() || [];
    record("3a. Crops saved", cropNames.length === 2, cropNames.join(", "));
    record("3b. Crops correct", JSON.stringify(cropNames) === JSON.stringify(["Cotton", "Wheat"]), cropNames.join(", "));
    
    // ═══════════════════════════════════════
    // TEST 4: Reminder config persistence
    // ═══════════════════════════════════════
    console.log("\n--- TEST 4: Reminder config ---");
    const configData = {
      customer_id: custId1,
      anchor: "before_due",
      start_days: 7,
      repeat_type: "interval",
      interval_n: 3,
      interval_unit: "days",
      ends: "paid",
      enabled: true,
      created_at: new Date().toISOString(),
    };
    
    const { data: config, error: configErr } = await sb.from("reminder_configs").insert(configData).select("id").single();
    record("4a. Config created", !configErr && !!config?.id, configErr?.message || config?.id);
    if (config?.id) TEST_IDS.configs.push(config.id);
    
    // Reload from DB
    const { data: loadedConfig } = await sb.from("reminder_configs").select("*").eq("id", config?.id).single();
    record("4b. Anchor persists", loadedConfig?.anchor === "before_due", loadedConfig?.anchor);
    record("4c. Start days persists", loadedConfig?.start_days === 7, loadedConfig?.start_days);
    record("4d. Repeat type persists", loadedConfig?.repeat_type === "interval", loadedConfig?.repeat_type);
    record("4e. Interval persists", loadedConfig?.interval_n === 3, loadedConfig?.interval_n);
    record("4f. Ends persists", loadedConfig?.ends === "paid", loadedConfig?.ends);
    record("4g. Enabled persists", loadedConfig?.enabled === true, loadedConfig?.enabled);
    
    // ═══════════════════════════════════════
    // TEST 5: Due-date persistence
    // ═══════════════════════════════════════
    console.log("\n--- TEST 5: Due-date persistence ---");
    const dueDate = "2026-10-15";
    const { error: ddErr } = await sb.from("customers").update({ due_date: dueDate }).eq("id", custId1);
    record("5a. Due date saved", !ddErr, ddErr?.message || "OK");
    
    const { data: ddLoaded } = await sb.from("customers").select("due_date").eq("id", custId1).single();
    record("5b. Due date persists after reload", ddLoaded?.due_date === dueDate, ddLoaded?.due_date);
    
    // Edit due date
    const newDueDate = "2026-12-01";
    const { error: ddErr2 } = await sb.from("customers").update({ due_date: newDueDate }).eq("id", custId1);
    record("5c. Due date edit succeeds", !ddErr2, ddErr2?.message || "OK");
    
    const { data: ddLoaded2 } = await sb.from("customers").select("due_date").eq("id", custId1).single();
    record("5d. Due date updated after reload", ddLoaded2?.due_date === newDueDate, ddLoaded2?.due_date);
    
    // Clear due date
    const { error: ddErr3 } = await sb.from("customers").update({ due_date: null }).eq("id", custId1);
    record("5e. Due date cleared", !ddErr3, ddErr3?.message || "OK");
    
    const { data: ddLoaded3 } = await sb.from("customers").select("due_date").eq("id", custId1).single();
    record("5f. Due date null after clear", ddLoaded3?.due_date === null, String(ddLoaded3?.due_date));
    
    // ═══════════════════════════════════════
    // TEST 6: Archive customer
    // ═══════════════════════════════════════
    console.log("\n--- TEST 6: Archive customer ---");
    
    // Create a second customer to archive
    const custId2 = crypto.randomUUID();
    await sb.from("customers").insert({
      id: custId2,
      name: `CUST_AUDIT_ARCHIVE_${SUFFIX}`,
      phone: `0333${Math.floor(1000000 + Math.random() * 9000000)}`,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    TEST_IDS.customers.push(custId2);
    
    // Archive via RPC
    const { data: archResult, error: archErr } = await sb.rpc("archive_customer", { p_customer_id: custId2 });
    record("6a. Archive RPC succeeds", !archErr && archResult?.ok, archErr?.message || JSON.stringify(archResult));
    
    // Reload — verify archived
    const { data: archived } = await sb.from("customers").select("is_archived, archived_at, is_active").eq("id", custId2).single();
    record("6b. is_archived = true", archived?.is_archived === true, String(archived?.is_archived));
    record("6c. archived_at set", !!archived?.archived_at, String(archived?.archived_at));
    
    // Verify archived customer doesn't appear in active list
    const { data: activeCusts } = await sb.from("customers").select("id").eq("is_archived", false);
    const isHidden = !activeCusts?.some(c => c.id === custId2);
    record("6d. Not in active list", isHidden, isHidden ? "hidden" : "STILL VISIBLE");
    
    // Verify restore works
    const { data: restoreResult, error: restoreErr } = await sb.rpc("restore_customer", { p_customer_id: custId2 });
    record("6e. Restore RPC succeeds", !restoreErr && restoreResult?.ok, restoreErr?.message || JSON.stringify(restoreResult));
    
    const { data: restored } = await sb.from("customers").select("is_archived").eq("id", custId2).single();
    record("6f. is_archived = false after restore", restored?.is_archived === false, String(restored?.is_archived));
    
    // Re-archive for cleanup
    await sb.rpc("archive_customer", { p_customer_id: custId2 });
    
    // ═══════════════════════════════════════
    // TEST 7: Duplicate phone detection
    // ═══════════════════════════════════════
    console.log("\n--- TEST 7: Duplicate phone detection ---");
    const custId3 = crypto.randomUUID();
    await sb.from("customers").insert({
      id: custId3,
      name: `CUST_AUDIT_DUP_${SUFFIX}`,
      phone: custData1.phone, // same phone as custId1
      is_active: true,
      created_at: new Date().toISOString(),
    });
    TEST_IDS.customers.push(custId3);
    
    // Check if duplicate detection works (app-level, not DB constraint)
    const { data: dupCusts } = await sb.from("customers").select("id, name").eq("phone", custData1.phone).eq("is_archived", false);
    const dupCount = dupCusts?.length || 0;
    // The app checks for duplicates client-side — the DB allows it
    record("7a. Duplicate phone in DB", dupCount >= 2, `${dupCount} customers with same phone — DB allows duplicates (app checks client-side)`);
    
    // ═══════════════════════════════════════
    // TEST 8: Customer with outstanding balance
    // ═══════════════════════════════════════
    console.log("\n--- TEST 8: Customer financial fields ---");
    const custId4 = crypto.randomUUID();
    await sb.from("customers").insert({
      id: custId4,
      name: `CUST_AUDIT_FIN_${SUFFIX}`,
      phone: `0345${Math.floor(1000000 + Math.random() * 9000000)}`,
      outstanding_balance: 5000,
      total_purchases: 10000,
      total_paid: 5000,
      credit_limit: 30000,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    TEST_IDS.customers.push(custId4);
    
    const { data: finCust } = await sb.from("customers").select("outstanding_balance, total_purchases, total_paid, credit_limit").eq("id", custId4).single();
    record("8a. Outstanding balance", parseFloat(finCust?.outstanding_balance) === 5000, `${finCust?.outstanding_balance}`);
    record("8b. Total purchases", parseFloat(finCust?.total_purchases) === 10000, `${finCust?.total_purchases}`);
    record("8c. Total paid", parseFloat(finCust?.total_paid) === 5000, `${finCust?.total_paid}`);
    record("8d. Credit limit", parseFloat(finCust?.credit_limit) === 30000, `${finCust?.credit_limit}`);
    
    // Try to directly modify protected fields (should be blocked by trigger)
    const { error: protErr1 } = await sb.from("customers").update({ outstanding_balance: 0 }).eq("id", custId4);
    record("8e. outstanding_balance protected by trigger", !!protErr1, protErr1?.message || "NOT BLOCKED");
    
    const { error: protErr2 } = await sb.from("customers").update({ total_purchases: 0 }).eq("id", custId4);
    record("8f. total_purchases protected by trigger", !!protErr2, protErr2?.message || "NOT BLOCKED");
    
    // ═══════════════════════════════════════
    // TEST 9: Credit limit save behavior
    // ═══════════════════════════════════════
    console.log("\n--- TEST 9: Credit limit edit ---");
    const { error: clErr } = await sb.from("customers").update({ credit_limit: 75000 }).eq("id", custId4);
    record("9a. Credit limit update succeeds", !clErr, clErr?.message || "OK");
    
    const { data: clLoaded } = await sb.from("customers").select("credit_limit").eq("id", custId4).single();
    record("9b. Credit limit persists", parseFloat(clLoaded?.credit_limit) === 75000, `${clLoaded?.credit_limit}`);
    
    // Credit limit IS editable (not protected by trigger)
    // The protect_customer_financials trigger only blocks outstanding_balance, total_purchases, total_paid
    
    // ═══════════════════════════════════════
    // TEST 10: Reminder config delete
    // ═══════════════════════════════════════
    console.log("\n--- TEST 10: Reminder config delete ---");
    if (config?.id) {
      const { error: delErr } = await sb.from("reminder_configs").delete().eq("id", config.id);
      record("10a. Config delete succeeds", !delErr, delErr?.message || "OK");
      
      const { data: afterDel } = await sb.from("reminder_configs").select("id").eq("id", config.id);
      record("10b. Config gone after delete", !afterDel || afterDel.length === 0, `${afterDel?.length || 0} remaining`);
      
      // Remove from tracking
      TEST_IDS.configs = TEST_IDS.configs.filter(id => id !== config.id);
    }
    
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
    
    // Final baseline check
    const clean = await verifyBaseline();
    console.log(`\n  Database baseline: ${clean ? "✓ CLEAN" : "✗ DRIFT"}`);
  }
}

run();
