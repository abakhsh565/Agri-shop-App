/**
 * Group Reminder Audit Test
 *
 * Tests the actual Group Reminder flow:
 * 1. saveLocalGroup() → creates individual reminder_configs in Supabase
 * 2. generateReminders() → processes each config independently
 * 3. Verify occurrences for each member
 * 4. Test idempotency
 * 5. Test member add/remove
 * 6. Test Group vs Individual independence
 *
 * Uses the bundled engine (esbuild) with import.meta.env replaced.
 */

const { createClient } = require("@supabase/supabase-js");
const path = require("path");
const fs = require("fs");

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Engine will be loaded via dynamic import (ESM bundle)
let generateReminders, loadReminderConfigs, ensureOccurrencesForConfig, markOccurrenceSent;

// Test identifiers
const SUFFIX = "GRP_AUDIT_" + Date.now().toString(36);
const CUSTOMER_IDS = [];
const CONFIG_IDS = [];

// Helper to create a test customer with credit sale
async function createTestCustomer(name, creditLimit, outstandingBalance, dueDate) {
  const id = crypto.randomUUID();
  
  // Insert customer
  const { error } = await sb.from("customers").insert({
    id,
    name: `${name}_${SUFFIX}`,
    phone: `0300${Math.floor(Math.random() * 9000000) + 1000000}`,
    outstanding_balance: outstandingBalance,
    total_purchases: outstandingBalance + 1000,
    credit_limit: creditLimit,
    due_date: dueDate,
    is_active: true,
    created_at: new Date().toISOString(),
  });
  
  if (error) throw new Error(`Failed to create customer ${name}: ${error.message}`);
  CUSTOMER_IDS.push(id);
  console.log(`  Created customer ${name}: ${id.substring(0, 8)}...`);
  return id;
}

// Helper to insert a reminder_config directly (simulates what saveLocalGroup does)
async function insertReminderConfig(customerId, config) {
  const { data, error } = await sb.from("reminder_configs").insert({
    customer_id: customerId,
    anchor: config.anchor,
    start_days: config.startDays,
    repeat_type: config.repeatType || "once",
    interval_n: config.intervalN || null,
    interval_unit: config.intervalUnit || null,
    escalation: config.escalation || null,
    ends: config.ends || "paid",
    ends_date: config.endsDate || null,
    ends_count: config.endsCount || null,
    enabled: config.enabled !== false,
    created_at: new Date().toISOString(),
  }).select("id").single();
  
  if (error) throw new Error(`Failed to insert config: ${error.message}`);
  CONFIG_IDS.push(data.id);
  return data.id;
}

// Helper to get the mapped Customer object (same format the real app uses)
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
    createdAt: row.created_at,
  };
}

// Helper to get mapped Sale objects
function mapSale(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    totalAmount: parseFloat(row.total_amount) || 0,
    amountPaid: parseFloat(row.amount_paid) || 0,
    outstandingBalance: parseFloat(row.outstanding_balance) || 0,
    paymentType: row.payment_type,
    paymentMethod: row.payment_method,
    createdAt: row.created_at,
  };
}

// Cleanup helper
async function cleanup() {
  console.log("\n--- CLEANUP ---");
  
  // Delete occurrences for test configs
  if (CONFIG_IDS.length > 0) {
    const { error } = await sb.from("reminder_occurrences").delete().in("config_id", CONFIG_IDS);
    console.log(`  Deleted occurrences: ${error ? error.message : "OK"}`);
  }
  
  // Delete configs
  if (CONFIG_IDS.length > 0) {
    const { error } = await sb.from("reminder_configs").delete().in("id", CONFIG_IDS);
    console.log(`  Deleted configs: ${error ? error.message : "OK"}`);
  }
  
  // Delete test customers (only our test ones)
  for (const id of CUSTOMER_IDS) {
    const { error } = await sb.from("customers").delete().eq("id", id);
    console.log(`  Deleted customer ${id.substring(0, 8)}...: ${error ? error.message : "OK"}`);
  }
  
  console.log("  Cleanup complete");
}

// Main test
async function runTests() {
  const results = [];
  
  // Load ESM bundle via dynamic import
  const distUrl = 'file://' + path.resolve(__dirname, '../dist/lib/reminderEngine.mjs').replace(/\\/g, '/');
  const engine = await import(distUrl);
  generateReminders = engine.generateReminders;
  loadReminderConfigs = engine.loadReminderConfigs;
  ensureOccurrencesForConfig = engine.ensureOccurrencesForConfig;
  markOccurrenceSent = engine.markOccurrenceSent;
  console.log('Engine loaded:', typeof generateReminders);
  
  try {
    console.log("=== GROUP REMINDER AUDIT TEST ===\n");
    
    // Get today's Pakistan business date
    const now = new Date();
    const pkOffset = 5 * 60 * 60 * 1000;
    const pkNow = new Date(now.getTime() + pkOffset);
    const todayPk = pkNow.toISOString().split("T")[0];
    console.log(`Today (Pakistan): ${todayPk}`);
    
    // ─── SETUP: Create test customers ───
    console.log("\n--- SETUP: Creating test customers ---");
    
    // Group member 1: has outstanding, due date in past (should get Ready reminder)
    const cid1 = await createTestCustomer("GroupMember1", 50000, 5000, "2026-08-01");
    
    // Group member 2: has outstanding, due date in future (should get Upcoming reminder)
    const cid2 = await createTestCustomer("GroupMember2", 50000, 3000, "2026-12-01");
    
    // Group member 3: NO outstanding (should NOT get reminder)
    const cid3 = await createTestCustomer("GroupMember3", 50000, 0, "2026-09-15");
    
    // Individual customer (not in group, for independence test)
    const cid4 = await createTestCustomer("IndividualCustomer", 30000, 2000, "2026-09-20");
    
    // Fetch created customers from DB to get proper mapped objects
    const { data: custRows } = await sb.from("customers").select("*").in("id", [cid1, cid2, cid3, cid4]);
    const custMap = new Map(custRows.map(r => [r.id, mapCustomer(r)]));
    
    // Create credit sales for group members 1 and 2 (so they have qualifying credit sales)
    const saleDate1 = new Date("2026-07-25T10:00:00+05:00").toISOString();
    const saleDate2 = new Date("2026-08-15T10:00:00+05:00").toISOString();
    
    for (const [customerId, saleDate, amount] of [[cid1, saleDate1, 5000], [cid2, saleDate2, 3000]]) {
      const { data: sale } = await sb.from("sales").insert({
        customer_id: customerId,
        customer_name: `TestGroupMember_${SUFFIX}`,
        total_amount: amount,
        amount_paid: 0,
        outstanding_balance: amount,
        payment_type: "partial",
        status: "completed",
        shop_id: "00000000-0000-0000-0000-000000000001",
        created_at: saleDate,
      }).select("id").single();
      
      if (sale) {
        CONFIG_IDS.push(sale.id); // for cleanup
      }
    }
    
    // ─── TEST 1: Save group reminder configs ───
    console.log("\n--- TEST 1: Save group reminder configs ---");
    const groupConfig = {
      anchor: "before_due",
      startDays: 7,
      repeatType: "once",
      ends: "paid",
      enabled: true,
    };
    
    // Save same config for group members 1 and 2 (simulates saveLocalGroup behavior)
    const configId1 = await insertReminderConfig(cid1, groupConfig);
    const configId2 = await insertReminderConfig(cid2, groupConfig);
    console.log(`  Config 1: ${configId1.substring(0, 8)}...`);
    console.log(`  Config 2: ${configId2.substring(0, 8)}...`);
    
    // Verify configs exist
    const { data: configs1 } = await sb.from("reminder_configs").select("id, customer_id, anchor, start_days").in("id", [configId1, configId2]);
    console.log(`  Configs in DB: ${configs1?.length || 0}`);
    const pass1 = configs1?.length === 2;
    results.push({ test: "1. Group configs saved", pass: pass1, detail: `${configs1?.length || 0} configs` });
    console.log(`  Result: ${pass1 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 2: Run engine — group members with outstanding ───
    console.log("\n--- TEST 2: Run engine for group members ---");
    
    // Fetch sales for these customers
    const { data: salesRows } = await sb.from("sales").select("*").in("customer_id", [cid1, cid2]);
    const salesMapped = (salesRows || []).map(mapSale);
    
    const input1 = { customers: [custMap.get(cid1)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders1 = await generateReminders(input1);
    console.log(`  Member 1 (${custMap.get(cid1)?.name}): ${reminders1.length} reminder(s)`);
    if (reminders1.length > 0) {
      console.log(`    trigger: ${reminders1[0].trigger}, tone: ${reminders1[0].tone}, triggerDate: ${reminders1[0].triggerDate}`);
    }
    
    const input2 = { customers: [custMap.get(cid2)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders2 = await generateReminders(input2);
    console.log(`  Member 2 (${custMap.get(cid2)?.name}): ${reminders2.length} reminder(s)`);
    if (reminders2.length > 0) {
      console.log(`    trigger: ${reminders2[0].trigger}, tone: ${reminders2[0].tone}, triggerDate: ${reminders2[0].triggerDate}`);
    }
    
    // Member 3 should get 0 (no outstanding)
    const input3 = { customers: [custMap.get(cid3)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders3 = await generateReminders(input3);
    console.log(`  Member 3 (${custMap.get(cid3)?.name}): ${reminders3.length} reminder(s) (expected 0 — no outstanding)`);
    
    const pass2 = reminders1.length > 0 && reminders2.length > 0 && reminders3.length === 0;
    results.push({ test: "2. Engine generates for eligible, skips ineligible", pass: pass2, detail: `M1:${reminders1.length} M2:${reminders2.length} M3:${reminders3.length}` });
    console.log(`  Result: ${pass2 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 3: Verify occurrences in DB ───
    console.log("\n--- TEST 3: Verify occurrences in DB ---");
    
    const { data: occs1 } = await sb.from("reminder_occurrences").select("id, config_id, customer_id, occurrence_key, scheduled_date, status, tone, occurrence_number").eq("config_id", configId1);
    const { data: occs2 } = await sb.from("reminder_occurrences").select("id, config_id, customer_id, occurrence_key, scheduled_date, status, tone, occurrence_number").eq("config_id", configId2);
    
    console.log(`  Member 1 occurrences: ${occs1?.length || 0}`);
    occs1?.forEach(o => console.log(`    key: ${o.occurrence_key?.substring(0, 30)}... date: ${o.scheduled_date} status: ${o.status} tone: ${o.tone}`));
    console.log(`  Member 2 occurrences: ${occs2?.length || 0}`);
    occs2?.forEach(o => console.log(`    key: ${o.occurrence_key?.substring(0, 30)}... date: ${o.scheduled_date} status: ${o.status} tone: ${o.tone}`));
    
    const pass3 = (occs1?.length || 0) > 0 && (occs2?.length || 0) > 0;
    results.push({ test: "3. Occurrences persisted for each group member", pass: pass3, detail: `M1:${occs1?.length || 0} M2:${occs2?.length || 0}` });
    console.log(`  Result: ${pass3 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 4: Occurrence keys are unique ───
    console.log("\n--- TEST 4: Occurrence key uniqueness ---");
    const allKeys = [...(occs1 || []), ...(occs2 || [])].map(o => o.occurrence_key);
    const uniqueKeys = new Set(allKeys);
    const pass4 = allKeys.length === uniqueKeys.size;
    results.push({ test: "4. Occurrence keys unique", pass: pass4, detail: `${allKeys.length} keys, ${uniqueKeys.size} unique` });
    console.log(`  Total keys: ${allKeys.length}, Unique: ${uniqueKeys.size}`);
    console.log(`  Result: ${pass4 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 5: Occurrence keys contain correct customer identity ───
    console.log("\n--- TEST 5: Occurrence key contains customer identity ---");
    const key1HasCid1 = allKeys.some(k => k.includes(cid1));
    const key2HasCid2 = allKeys.some(k => k.includes(cid2));
    const pass5 = key1HasCid1 && key2HasCid2;
    results.push({ test: "5. Occurrence keys contain customer ID", pass: pass5, detail: `K1→M1:${key1HasCid1} K2→M2:${key2HasCid2}` });
    console.log(`  Member 1 key contains CID: ${key1HasCid1}`);
    console.log(`  Member 2 key contains CID: ${key2HasCid2}`);
    console.log(`  Result: ${pass5 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 6: Idempotency — run again, no duplicates ───
    console.log("\n--- TEST 6: Idempotency — second run ---");
    const reminders1b = await generateReminders(input1);
    const reminders2b = await generateReminders(input2);
    
    const { data: occs1b } = await sb.from("reminder_occurrences").select("id").eq("config_id", configId1);
    const { data: occs2b } = await sb.from("reminder_occurrences").select("id").eq("config_id", configId2);
    
    console.log(`  Member 1 after 2nd run: ${reminders1b.length} reminder(s), ${occs1b?.length || 0} occurrence(s)`);
    console.log(`  Member 2 after 2nd run: ${reminders2b.length} reminder(s), ${occs2b?.length || 0} occurrence(s)`);
    
    const pass6 = (occs1b?.length || 0) === (occs1?.length || 0) && (occs2b?.length || 0) === (occs2?.length || 0);
    results.push({ test: "6. No duplicate occurrences on re-run", pass: pass6, detail: `M1:${occs1b?.length || 0}==${occs1?.length || 0} M2:${occs2b?.length || 0}==${occs2?.length || 0}` });
    console.log(`  Result: ${pass6 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 7: Member add — add member 4 to group ───
    console.log("\n--- TEST 7: Add member to group ---");
    const configId4 = await insertReminderConfig(cid4, groupConfig);
    console.log(`  Added config for IndividualCustomer: ${configId4.substring(0, 8)}...`);
    
    const input4 = { customers: [custMap.get(cid4)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders4 = await generateReminders(input4);
    console.log(`  Member 4 (${custMap.get(cid4)?.name}): ${reminders4.length} reminder(s)`);
    
    const pass7 = reminders4.length > 0;
    results.push({ test: "7. New group member gets reminders", pass: pass7, detail: `M4:${reminders4.length}` });
    console.log(`  Result: ${pass7 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 8: Member remove — delete member 2's config ───
    console.log("\n--- TEST 8: Remove member from group ---");
    await sb.from("reminder_configs").delete().eq("id", configId2);
    CONFIG_IDS.splice(CONFIG_IDS.indexOf(configId2), 1);
    console.log(`  Deleted config for Member 2`);
    
    const { data: remainingConfigs } = await sb.from("reminder_configs").select("id, customer_id").in("id", [configId1, configId2, configId4]);
    const pass8 = remainingConfigs?.length === 2 && !remainingConfigs?.some(c => c.customer_id === cid2);
    results.push({ test: "8. Removed member has no configs", pass: pass8, detail: `Remaining: ${remainingConfigs?.length || 0}` });
    console.log(`  Remaining configs: ${remainingConfigs?.length || 0}`);
    console.log(`  Member 2 config removed: ${!remainingConfigs?.some(c => c.customer_id === cid2)}`);
    console.log(`  Result: ${pass8 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 9: Group vs Individual independence ───
    console.log("\n--- TEST 9: Group vs Individual independence ---");
    // Member 1 is in group. cid4 was added to group in TEST 7.
    // But cid4 also has an individual config now (the one we just added).
    // Verify they don't interfere.
    
    // Check that each config generates independently
    const input1c = { customers: [custMap.get(cid1)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders1c = await generateReminders(input1c);
    const input4c = { customers: [custMap.get(cid4)], sales: salesMapped, now: new Date("2026-09-06T12:00:00+05:00") };
    const reminders4c = await generateReminders(input4c);
    
    console.log(`  Group member 1: ${reminders1c.length} reminder(s)`);
    console.log(`  Group member 4: ${reminders4c.length} reminder(s)`);
    
    // Both should work independently
    const pass9 = reminders1c.length > 0 && reminders4c.length > 0;
    results.push({ test: "9. Group and individual configs independent", pass: pass9, detail: `M1:${reminders1c.length} M4:${reminders4c.length}` });
    console.log(`  Result: ${pass9 ? "PASS" : "FAIL"}`);
    
    // ─── TEST 10: Occurrence belongs to correct customer ───
    console.log("\n--- TEST 10: Occurrence-customer association ---");
    const { data: allOdds } = await sb.from("reminder_occurrences").select("id, customer_id, config_id").in("config_id", [configId1, configId4]);
    const m1Occs = allOdds?.filter(o => o.customer_id === cid1) || [];
    const m4Occs = allOdds?.filter(o => o.customer_id === cid4) || [];
    const pass10 = m1Occs.length > 0 && m4Occs.length > 0;
    results.push({ test: "10. Each occurrence linked to correct customer", pass: pass10, detail: `M1:${m1Occs.length} M4:${m4Occs.length}` });
    console.log(`  Member 1 occurrences: ${m1Occs.length}`);
    console.log(`  Member 4 occurrences: ${m4Occs.length}`);
    console.log(`  Result: ${pass10 ? "PASS" : "FAIL"}`);
    
    // ─── Summary ───
    console.log("\n\n=== TEST RESULTS ===");
    let passCount = 0;
    for (const r of results) {
      console.log(`  ${r.pass ? "✓" : "✗"} ${r.test} — ${r.detail}`);
      if (r.pass) passCount++;
    }
    console.log(`\n  TOTAL: ${passCount}/${results.length} PASS`);
    
  } catch (err) {
    console.error("\n\nERROR:", err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
    
    // Verify clean
    const { data: remainOdds } = await sb.from("reminder_occurrences").select("id").in("config_id", CONFIG_IDS);
    const { data: remainCfgs } = await sb.from("reminder_configs").select("id").in("id", CONFIG_IDS);
    const { data: remainCusts } = await sb.from("customers").select("id").in("id", CUSTOMER_IDS);
    console.log(`\n  Post-cleanup: ${remainOdds?.length || 0} occurrences, ${remainCfgs?.length || 0} configs, ${remainCusts?.length || 0} customers`);
  }
}

runTests();
