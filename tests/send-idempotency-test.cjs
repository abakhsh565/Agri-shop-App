const { createClient } = require("@supabase/supabase-js");
const sb = createClient(
  "https://gkswcfljxlutkfdvvqng.supabase.co",
  "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG"
);

// Standalone copy of markOccurrenceSent (same logic as reminderEngine.ts)
async function markOccurrenceSent(occurrenceId, customerId, customerName, configId, tone, message, channel) {
  const now = new Date().toISOString();
  await sb.from("reminder_occurrences").update({
    status: "sent", sent_at: now, sent_channel: channel, message, updated_at: now,
  }).eq("id", occurrenceId);
  await sb.from("reminder_logs").upsert({
    occurrence_id: occurrenceId,
    customer_id: customerId,
    customer_name: customerName,
    config_id: configId,
    tone, message, channel, sent_at: now,
  }, { onConflict: "occurrence_id" });
}

const SUFFIX = String(Date.now()).slice(-6);
const TODAY = "2026-09-05";

async function main() {
  console.log("=== Send Idempotency Test ===");
  
  // Create test customer
  const cust = await sb.from("customers").insert({
    name: "IdemTest " + SUFFIX,
    phone: "0300555555" + SUFFIX,
    outstanding_balance: 3000,
    due_date: TODAY,
    is_active: true,
    created_at: new Date().toISOString(),
  }).select("id").single();
  const customerId = cust.data.id;
  console.log("Customer:", customerId);

  // Create config
  const cfg = await sb.from("reminder_configs").insert({
    customer_id: customerId, anchor: "after_due", start_days: 0,
    repeat_type: "once", enabled: true, created_at: new Date().toISOString(),
  }).select("id").single();
  const configId = cfg.data.id;
  console.log("Config:", configId);

  // Create occurrence
  const occKey = configId + "_1";
  const { data: occ } = await sb.from("reminder_occurrences").insert({
    config_id: configId, customer_id: customerId, occurrence_number: 1,
    stage: null, crop_name: null, occurrence_key: occKey,
    scheduled_date: TODAY, status: "due", tone: "gentle",
    created_at: new Date().toISOString(),
  }).select("*").single();
  const occurrenceId = occ.id;
  console.log("Occurrence:", occurrenceId);

  const customerName = "IdemTest " + SUFFIX;
  const tone = "gentle";
  const message = "Hello " + customerName.split(" ")[0] + ", Rs. 3,000 outstanding. Please pay.";
  const channel = "whatsapp";

  // TEST 1: First send
  console.log("\n--- Test 1: First send ---");
  const logsBefore1 = await sb.from("reminder_logs").select("id").eq("customer_id", customerId);
  console.log("Logs before:", (logsBefore1.data || []).length);

  await markOccurrenceSent(occurrenceId, customerId, customerName, configId, tone, message, channel);
  
  const occAfter1 = await sb.from("reminder_occurrences").select("*").eq("id", occurrenceId).single();
  const logsAfter1 = await sb.from("reminder_logs").select("*").eq("customer_id", customerId).order("sent_at", {ascending:false});
  console.log("Status after send 1:", occAfter1.data.status);
  console.log("sent_at:", occAfter1.data.sent_at);
  console.log("sent_channel:", occAfter1.data.sent_channel);
  console.log("Logs after send 1:", logsAfter1.data ? logsAfter1.data.length : 0);
  if (logsAfter1.data && logsAfter1.data.length > 0) {
    logsAfter1.data.forEach(l => console.log("  Log:", l.id, "channel:", l.channel, "sent_at:", l.sent_at));
  }
  const test1Pass = occAfter1.data.status === "sent" && (logsAfter1.data || []).length === 1;
  console.log("Test 1:", test1Pass ? "PASS" : "FAIL");

  // TEST 2: Second immediate send (should NOT create another log)
  console.log("\n--- Test 2: Second immediate send ---");
  const logsBefore2 = await sb.from("reminder_logs").select("id").eq("customer_id", customerId);
  console.log("Logs before:", (logsBefore2.data || []).length);

  await markOccurrenceSent(occurrenceId, customerId, customerName, configId, tone, message, channel);

  const occAfter2 = await sb.from("reminder_occurrences").select("*").eq("id", occurrenceId).single();
  const logsAfter2 = await sb.from("reminder_logs").select("*").eq("customer_id", customerId).order("sent_at", {ascending:false});
  console.log("Status after send 2:", occAfter2.data.status);
  console.log("Logs after send 2:", logsAfter2.data ? logsAfter2.data.length : 0);
  if (logsAfter2.data && logsAfter2.data.length > 0) {
    logsAfter2.data.forEach(l => console.log("  Log:", l.id, "channel:", l.channel, "sent_at:", l.sent_at));
  }
  const test2Pass = occAfter2.data.status === "sent" && (logsAfter2.data || []).length === 1;
  console.log("Test 2:", test2Pass ? "PASS" : "FAIL");

  // TEST 3: Third send (stress test)
  console.log("\n--- Test 3: Third send (stress) ---");
  await markOccurrenceSent(occurrenceId, customerId, customerName, configId, tone, message, channel);
  const logsAfter3 = await sb.from("reminder_logs").select("*").eq("customer_id", customerId);
  console.log("Logs after send 3:", logsAfter3.data ? logsAfter3.data.length : 0);
  const test3Pass = (logsAfter3.data || []).length === 1;
  console.log("Test 3:", test3Pass ? "PASS" : "FAIL");

  // TEST 4: Different occurrence for same customer should create its own log
  console.log("\n--- Test 4: Different occurrence, same customer ---");
  const occKey2 = configId + "_2";
  const { data: occ2 } = await sb.from("reminder_occurrences").insert({
    config_id: configId, customer_id: customerId, occurrence_number: 2,
    stage: null, crop_name: null, occurrence_key: occKey2,
    scheduled_date: "2026-09-06", status: "due", tone: "firmer",
    created_at: new Date().toISOString(),
  }).select("*").single();
  
  await markOccurrenceSent(occ2.id, customerId, customerName, configId, "firmer", "Different message", "sms");
  const logsAfter4 = await sb.from("reminder_logs").select("*").eq("customer_id", customerId).order("sent_at", {ascending:false});
  console.log("Logs after different occurrence send:", logsAfter4.data ? logsAfter4.data.length : 0);
  if (logsAfter4.data) {
    logsAfter4.data.forEach(l => console.log("  Log:", l.id.slice(0,8), "occurrence_id:", l.occurrence_id ? l.occurrence_id.slice(0,8) : "NULL", "channel:", l.channel, "tone:", l.tone));
  }
  const test4Pass = (logsAfter4.data || []).length === 2;
  console.log("Test 4:", test4Pass ? "PASS" : "FAIL");

  // TEST 5: Different customer should be independent
  console.log("\n--- Test 5: Different customer ---");
  const cust2 = await sb.from("customers").insert({
    name: "IdemTest2 " + SUFFIX,
    phone: "0300666666" + SUFFIX,
    outstanding_balance: 2000,
    due_date: TODAY,
    is_active: true,
    created_at: new Date().toISOString(),
  }).select("id").single();
  const cfg2 = await sb.from("reminder_configs").insert({
    customer_id: cust2.data.id, anchor: "after_due", start_days: 0,
    repeat_type: "once", enabled: true, created_at: new Date().toISOString(),
  }).select("id").single();
  const occKey3 = cfg2.data.id + "_1";
  const { data: occ3 } = await sb.from("reminder_occurrences").insert({
    config_id: cfg2.data.id, customer_id: cust2.data.id, occurrence_number: 1,
    stage: null, crop_name: null, occurrence_key: occKey3,
    scheduled_date: TODAY, status: "due", tone: "gentle",
    created_at: new Date().toISOString(),
  }).select("*").single();
  
  await markOccurrenceSent(occ3.id, cust2.data.id, "IdemTest2 " + SUFFIX, cfg2.data.id, "gentle", "Msg2", "whatsapp");
  const logsAfter5 = await sb.from("reminder_logs").select("*").eq("customer_id", cust2.data.id);
  console.log("Logs for customer 2:", logsAfter5.data ? logsAfter5.data.length : 0);
  const test5Pass = (logsAfter5.data || []).length === 1;
  console.log("Test 5:", test5Pass ? "PASS" : "FAIL");

  // TEST 6: Verify occurrence_id is set on logs
  console.log("\n--- Test 6: Verify occurrence_id on logs ---");
  const allLogs = await sb.from("reminder_logs").select("*").eq("customer_id", customerId).order("sent_at", {ascending:false});
  const hasOccId = allLogs.data && allLogs.data.every(l => l.occurrence_id);
  console.log("All logs have occurrence_id:", hasOccId ? "PASS" : "FAIL");
  console.log("Test 6:", hasOccId ? "PASS" : "FAIL");

  // Summary
  console.log("\n=== Summary ===");
  const allPass = test1Pass && test2Pass && test3Pass && test4Pass && test5Pass && hasOccId;
  console.log("Test 1 (first send → 1 log):", test1Pass ? "PASS" : "FAIL");
  console.log("Test 2 (second send → still 1 log):", test2Pass ? "PASS" : "FAIL");
  console.log("Test 3 (third send → still 1 log):", test3Pass ? "PASS" : "FAIL");
  console.log("Test 4 (different occurrence → own log):", test4Pass ? "PASS" : "FAIL");
  console.log("Test 5 (different customer):", test5Pass ? "PASS" : "FAIL");
  console.log("Test 6 (occurrence_id set):", hasOccId ? "PASS" : "FAIL");
  console.log("\nOverall:", allPass ? "ALL PASSED" : "SOME FAILED");

  console.log("\n=== Cleanup IDs ===");
  console.log("CUSTOMER1:", customerId);
  console.log("CUSTOMER2:", cust2.data.id);
  console.log("CONFIG1:", configId);
  console.log("CONFIG2:", cfg2.data.id);

  if (!allPass) process.exit(1);
}

main().catch(e => { console.error("Test failed:", e); process.exit(1); });
