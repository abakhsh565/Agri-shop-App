/**
 * 36-Combination Matrix — REAL ENGINE EXECUTION
 * 
 * This script imports and executes the ACTUAL reminderEngine.ts code.
 * It does NOT reimplement or simulate the engine.
 * 
 * It creates isolated test data via Supabase REST API,
 * then calls the real generateReminders() function.
 */
import { createClient } from "@supabase/supabase-js";

// ---- Supabase client (same as the app uses) ----
const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ---- Import the REAL engine functions ----
// We import directly from the source files using tsx's TypeScript support
import { generateReminders } from "../src/lib/reminderEngine.js";

// ---- Helper: create test customers via Supabase ----
async function createTestCustomer(name: string, outstanding: number, dueDate: string | null) {
  const { data, error } = await sb
    .from("customers")
    .insert({
      name,
      phone: "03000000000",
      outstanding_balance: outstanding,
      due_date: dueDate,
      total_purchases: outstanding,
      total_paid: 0,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Create customer ${name}: ${error.message}`);
  return data.id;
}

async function createCreditSale(customerId: string, amount: number) {
  // Fetch customer name for the sale
  const { data: cust } = await sb.from("customers").select("name").eq("id", customerId).single();
  const { data, error } = await sb
    .from("sales")
    .insert({
      sale_number: `MATRIX-${Date.now()}`,
      customer_id: customerId,
      customer_name: cust?.name || "Test",
      historical_customer_name: cust?.name || "Test",
      employee_name: "Admin",
      subtotal: amount,
      total_amount: amount,
      amount_paid: 0,
      outstanding_balance: amount,
      payment_type: "credit",
      payment_method: "cash",
      status: "completed",
      is_voided: false,
    })
    .select("id, created_at")
    .single();
  if (error) throw new Error(`Create sale: ${error.message}`);
  return data;
}

async function createCrop(customerId: string, cropName: string) {
  const { error } = await sb.from("customer_crops").insert({
    customer_id: customerId,
    crop_name: cropName,
  });
  if (error && !error.message.includes("duplicate")) throw new Error(`Create crop: ${error.message}`);
}

async function createReminderConfig(customerId: string, config: Record<string, any>) {
  const { data, error } = await sb
    .from("reminder_configs")
    .insert({
      customer_id: customerId,
      enabled: true,
      start_days: config.start_days,
      anchor: config.anchor,
      repeat_type: config.repeat_type,
      interval_n: config.interval_n || 7,
      interval_unit: "days",
      escalation: config.escalation || [],
      ends: config.ends,
      ends_count: config.ends_count || 5,
      ends_date: config.ends_date || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Create config: ${error.message}`);
  return data.id;
}

async function getOccurrences(configId: string) {
  const { data, error } = await sb
    .from("reminder_occurrences")
    .select("id, config_id, occurrence_key, status, scheduled_date, stage, crop_name, occurrence_number, tone")
    .eq("config_id", configId)
    .order("scheduled_date");
  if (error) throw new Error(`Get occurrences: ${error.message}`);
  return data || [];
}

async function deleteOccurrences(configId: string) {
  await sb.from("reminder_occurrences").delete().eq("config_id", configId);
}

async function deleteConfig(configId: string) {
  await deleteOccurrences(configId);
  await sb.from("reminder_configs").delete().eq("id", configId);
}

async function deleteCustomer(customerId: string) {
  // Delete dependent records first
  const { data: configs } = await sb.from("reminder_configs").select("id").eq("customer_id", customerId);
  for (const cfg of configs || []) {
    await deleteOccurrences(cfg.id);
    await sb.from("reminder_configs").delete().eq("id", cfg.id);
  }
  await sb.from("customer_crops").delete().eq("customer_id", customerId);
  await sb.from("reminder_logs").delete().eq("customer_id", customerId);
  await sb.from("sales").delete().eq("customer_id", customerId);
  await sb.from("customers").delete().eq("id", customerId);
}


// ---- Simple translate function ----
function t(key: string, params?: Record<string, string | number>): string {
  if (params) {
    let text = key;
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return text;
  }
  return key;
}

// ---- Main test runner ----
async function main() {
  const today = new Date();
  console.log(`\n=== 36-COMBINATION MATRIX — REAL ENGINE EXECUTION ===`);
  console.log(`Date: ${today.toISOString()}\n`);

  // Crop configuration in business_settings
  const bhCrops = [
    { name: "Cotton", harvestMonth: 9, harvestDay: 15 },
    { name: "Maize", harvestMonth: 10, harvestDay: 1 },
  ];

  // ---- Step 1: Create isolated test customers ----
  console.log("Step 1: Creating isolated test customers...");
  const acId = await createTestCustomer("MatrixTest AC", 40000, null);
  const bdId = await createTestCustomer("MatrixTest BD", 30000, "2026-09-25");
  const bhId = await createTestCustomer("MatrixTest BH", 20000, "2026-09-25");
  console.log(`  AC: ${acId.substring(0,8)}  BD: ${bdId.substring(0,8)}  BH: ${bhId.substring(0,8)}`);

  // ---- Step 2: Create credit sales for AC customer ----
  console.log("Step 2: Creating credit sale for AC customer...");
  const creditSale = await createCreditSale(acId, 20000);
  console.log(`  Sale: ${creditSale.id.substring(0,8)} date: ${creditSale.created_at}`);

  // ---- Step 3: Create crops for BH customer ----
  console.log("Step 3: Creating crops for BH customer...");
  await createCrop(bhId, "Cotton");
  await createCrop(bhId, "Maize");
  console.log("  Cotton + Maize linked");

  // ---- Step 4: Create all 36 reminder configs ----
  console.log("Step 4: Creating 36 reminder configs...");
  const configMap: Record<string, { id: string; anchor: string; repeat: string; ends: string; customerId: string }> = {};
  
  const anchors = ["after_credit", "after_due", "before_due", "before_harvest"];
  const repeats = ["once", "interval", "escalate"];
  const endsList = ["paid", "date", "count"];
  const customerIdMap: Record<string, string> = {
    after_credit: acId,
    after_due: bdId,
    before_due: bdId,
    before_harvest: bhId,
  };
  const startDaysMap: Record<string, number> = {
    after_credit: 3,
    after_due: 2,
    before_due: 2,
    before_harvest: 5,
  };
  const escalationMap: Record<string, any[]> = {
    after_credit: [
      { label: "Gentle", tone: "gentle", day: 3 },
      { label: "Hard", tone: "firmer", day: 6 },
      { label: "Final", tone: "final", day: 10 },
    ],
    after_due: [
      { label: "Gentle", tone: "gentle", day: 2 },
      { label: "Hard", tone: "firmer", day: 5 },
      { label: "Final", tone: "final", day: 8 },
    ],
    before_due: [
      { label: "Gentle", tone: "gentle", day: 2 },
      { label: "Hard", tone: "firmer", day: 4 },
      { label: "Final", tone: "final", day: 6 },
    ],
    before_harvest: [
      { label: "Gentle", tone: "gentle", day: 5 },
      { label: "Hard", tone: "firmer", day: 3 },
      { label: "Final", tone: "final", day: 1 },
    ],
  };

  for (const anchor of anchors) {
    for (const repeat of repeats) {
      for (const ends of endsList) {
        const key = `${anchor}_${repeat}_${ends}`;
        const id = await createReminderConfig(customerIdMap[anchor], {
          start_days: startDaysMap[anchor],
          anchor,
          repeat_type: repeat,
          interval_n: repeat === "interval" ? 2 : 7,
          escalation: repeat === "escalate" ? escalationMap[anchor] : [],
          ends,
          ends_count: ends === "count" ? 3 : 5,
          ends_date: ends === "date" ? "2026-10-31" : null,
        });
        configMap[key] = { id, anchor, repeat, ends, customerId: customerIdMap[anchor] };
      }
    }
  }
  console.log(`  Created ${Object.keys(configMap).length} configs\n`);

  // ---- Step 5: Execute REAL engine ----
  console.log("Step 5: Executing REAL generateReminders()...");
  
  // Only load our test customers + their sales (not ALL customers)
  const { data: testCustomers } = await sb.from("customers").select("*").in("id", [acId, bdId, bhId]);
  const { data: testSales } = await sb.from("sales").select("*").eq("customer_id", acId);
  const { data: settings } = await sb.from("business_settings").select("*").limit(1);
  
  const engineResult = await generateReminders({
    customers: testCustomers || [],
    sales: testSales || [],
    businessSettings: settings?.[0] || { crops: [] },
    now: today,
    t,
  });
  
  console.log(`  Engine returned ${engineResult.length} reminders\n`);

  // ---- Step 6: Read actual DB occurrences ----
  console.log("Step 6: Reading actual occurrences from DB...\n");
  
  const results: any[] = [];
  let pass = 0;
  let fail = 0;

  for (const [key, cfg] of Object.entries(configMap)) {
    const occurrences = await getOccurrences(cfg.id);
    
    // Verify occurrence_key uniqueness for this config
    const keys = occurrences.map(o => o.occurrence_key);
    const uniqueKeys = new Set(keys);
    const keyUnique = keys.length === uniqueKeys.size;
    
    // Verify dates are valid YYYY-MM-DD
    const validDates = occurrences.every(o => /^\d{4}-\d{2}-\d{2}$/.test(o.scheduled_date));
    
    // Verify statuses are valid
    const validStatuses = occurrences.every(o => ["scheduled", "due", "sent", "cancelled"].includes(o.status));
    
    const allOk = keyUnique && validDates && validStatuses;
    if (allOk) pass++;
    else fail++;
    
    results.push({
      anchor: cfg.anchor,
      repeat: cfg.repeat,
      ends: cfg.ends,
      count: occurrences.length,
      uniqueKeys: uniqueKeys.size,
      keyUnique,
      validDates,
      validStatuses,
      firstDate: occurrences[0]?.scheduled_date,
      lastDate: occurrences[occurrences.length - 1]?.scheduled_date,
      result: allOk ? "✅" : "❌",
    });
  }

  // Print matrix
  console.log("| # | Anchor | Repeat | Ends | Count | Keys Unique | Dates | Statuses | Result | Dates Range |");
  console.log("|---|--------|--------|------|-------|-------------|-------|----------|--------|-------------|");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(
      `| ${i + 1} | ${r.anchor} | ${r.repeat} | ${r.ends} | ${r.count} | ${r.keyUnique ? "✅" : "❌"} | ${r.validDates ? "✅" : "❌"} | ${r.validStatuses ? "✅" : "❌"} | ${r.result} | ${r.firstDate} → ${r.lastDate} |`
    );
  }
  console.log(`\nSummary: PASS=${pass} FAIL=${fail} Total=${results.length}`);

  // ---- Step 7: IDEMPOTENCY — run engine again ----
  console.log("\n=== IDEMPOTENCY TEST ===");
  const beforeCounts: Record<string, number> = {};
  for (const [key, cfg] of Object.entries(configMap)) {
    const occs = await getOccurrences(cfg.id);
    beforeCounts[key] = occs.length;
  }
  
  console.log("Running engine again...");
  const engineResult2 = await generateReminders({
    customers: testCustomers || [],
    sales: testSales || [],
    businessSettings: settings?.[0] || { crops: [] },
    now: today,
    t,
  });
  
  let idempotentPass = 0;
  let idempotentFail = 0;
  for (const [key, cfg] of Object.entries(configMap)) {
    const occs = await getOccurrences(cfg.id);
    if (occs.length === beforeCounts[key]) {
      idempotentPass++;
    } else {
      idempotentFail++;
      console.log(`  DUPLICATE: ${key} went from ${beforeCounts[key]} to ${occs.length}`);
    }
  }
  console.log(`Idempotency: PASS=${idempotentPass} FAIL=${idempotentFail}`);
  console.log(`Result: ${idempotentFail === 0 ? "✅ PASS" : "❌ FAIL"}`);

  // ---- Step 8: Cleanup ----
  console.log("\n=== CLEANUP ===");
  for (const [key, cfg] of Object.entries(configMap)) {
    await deleteConfig(cfg.id);
  }
  await deleteCustomer(acId);
  await deleteCustomer(bdId);
  await deleteCustomer(bhId);
  
  // Verify clean
  const { data: remCusts } = await sb.from("customers").select("id").like("name", "MatrixTest%");
  const { data: remConfigs } = await sb.from("reminder_configs").select("id");
  const { data: remOcc } = await sb.from("reminder_occurrences").select("id");
  console.log(`Remaining test customers: ${remCusts?.length || 0}`);
  console.log(`Remaining configs: ${remConfigs?.length || 0}`);
  console.log(`Remaining occurrences: ${remOcc?.length || 0}`);
  console.log(`Cleanup: ${(remCusts?.length || 0) === 0 && (remConfigs?.length || 0) === 0 && (remOcc?.length || 0) === 0 ? "✅ COMPLETE" : "⚠️ RESIDUAL"}`);
}

main().catch(console.error);
