// Create isolated test data for the 4 trigger verification.
// Data goes through Supabase REST (authoritative store). Stores pick it up via Realtime.
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://gkswcfljxlutkfdvvqng.supabase.co",
  "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG",
  { auth: { persistSession: false } }
);

const today = new Date();
const todayPk = today.toISOString().slice(0, 10);

// One customer per trigger (so each trigger's data is isolated and identifiable)
const CUSTOMERS = {
  ac: { name: "TriggerTest AC", phone: "03000000011", outstanding: 40000, dueDate: null },
  ad: { name: "TriggerTest AD", phone: "03000000012", outstanding: 30000, dueDate: "2026-09-25" },
  bd: { name: "TriggerTest BD", phone: "03000000013", outstanding: 25000, dueDate: "2026-09-25" },
  bh: { name: "TriggerTest BH", phone: "03000000014", outstanding: 20000, dueDate: "2026-09-25" },
};

async function main() {
  console.log("=== Creating isolated trigger test data ===\n");

  // Step 1: Ensure business_settings has crops for before_harvest
  const { data: existingSettings } = await sb.from("business_settings").select("id, crops").limit(1).single();
  let settingsId = existingSettings?.id;
  if (!settingsId) {
    const { data: ns } = await sb.from("business_settings").insert({ crops: JSON.stringify([
      { name: "Cotton", harvestMonth: 9, harvestDay: 15 },
      { name: "Maize", harvestMonth: 10, harvestDay: 1 },
    ])}).select("id").single();
    settingsId = ns?.id;
    console.log("Created business_settings id:", settingsId?.toString().slice(0, 8));
  } else {
    // Update crops if needed (merge)
    const existingCrops = typeof existingSettings.crops === "string" ? JSON.parse(existingSettings.crops) : existingSettings.crops;
    const hasCotton = existingCrops.some(c => c.name === "Cotton");
    const hasMaize = existingCrops.some(c => c.name === "Maize");
    if (!hasCotton || !hasMaize) {
      const merged = [
        { name: "Cotton", harvestMonth: 9, harvestDay: 15 },
        { name: "Maize", harvestMonth: 10, harvestDay: 1 },
      ];
      await sb.from("business_settings").update({ crops: JSON.stringify(merged), updated_at: new Date().toISOString() }).eq("id", settingsId);
      console.log("Updated business_settings crops");
    } else {
      console.log("business_settings already has Cotton + Maize");
    }
  }

  // Step 2: Create customers
  const created = {};
  for (const [key, c] of Object.entries(CUSTOMERS)) {
    const { data, error } = await sb.from("customers").insert({
      name: c.name,
      phone: c.phone,
      outstanding_balance: c.outstanding,
      due_date: c.dueDate,
      total_purchases: c.outstanding,
      total_paid: 0,
    }).select("id, created_at").single();
    if (error) throw new Error(`Create customer ${key}: ${error.message}`);
    created[key] = data;
    console.log(`Customer ${key}: ${data.id.toString().slice(0, 8)} outstanding=${c.outstanding} dueDate=${c.dueDate || "null"}`);
  }

  // Step 3: Create credit sale for after_credit customer (AC)
  // Use a sale date today so after_credit trigger (startDays=3) fires at today+3
  const acId = created.ac.id;
  const { data: creditSale, error: csError } = await sb.from("sales").insert({
    sale_number: `TRIG-AC-${Date.now()}`,
    customer_id: acId,
    customer_name: CUSTOMERS.ac.name,
    employee_name: "Admin",
    subtotal: 20000,
    total_amount: 20000,
    amount_paid: 0,
    outstanding_balance: 20000,
    payment_type: "credit",
    payment_method: "cash",
    is_voided: false,
    created_at: new Date().toISOString(),
  }).select("id, created_at, customer_id, payment_type, is_voided").single();
  if (csError) throw new Error(`Create credit sale: ${csError.message}`);
  console.log(`Credit sale for AC: ${creditSale.id.toString().slice(0, 8)} date=${creditSale.created_at.slice(0, 10)}`);

  // Step 4: Link crops for before_harvest customer (BH)
  for (const cropName of ["Cotton", "Maize"]) {
    const { error: cropError } = await sb.from("customer_crops").insert({
      customer_id: created.bh.id,
      crop_name: cropName,
    });
    if (cropError && !cropError.message.includes("duplicate")) throw new Error(`Create crop ${cropName}: ${cropError.message}`);
  }
  console.log("Linked Cotton + Maize to BH customer");

  // Step 5: Create reminder configs for each customer
  // Each config is designed so its trigger date is in the future but reachable,
  // OR already due depending on the trigger. We want to verify occurrence creation,
  // so we set startDays such that the trigger date is TODAY or already passed → "due".
  const configs = [
    // after_credit: sale today + 3 days → due if today+3 <= today? No. Use startDays=0 so trigger=today → due.
    { customerKey: "ac", anchor: "after_credit", repeat_type: "once", start_days: 0, ends: "paid", ends_count: 5 },
    // after_due: dueDate 2026-09-25 + 0 days = 2026-09-25 → check: is 09-25 <= today (09-05)? No → scheduled.
    // To make it due NOW, use a past dueDate. Set dueDate to yesterday.
    { customerKey: "ad", anchor: "after_due", repeat_type: "once", start_days: 0, ends: "paid", ends_count: 5 },
    // before_due: dueDate - 0 days = dueDate. Use dueDate = today → due.
    { customerKey: "bd", anchor: "before_due", repeat_type: "once", start_days: 0, ends: "paid", ends_count: 5 },
    // before_harvest: harvest Cotton 2026-09-15 - 5 days = 2026-09-10. Today is 09-05, so scheduled.
    // Use startDays=5 with harvest 09-10 (Cotton harvestDay=10) → 09-10 - 5 = 09-05 = today → due.
    { customerKey: "bh", anchor: "before_harvest", repeat_type: "once", start_days: 5, ends: "paid", ends_count: 5 },
  ];

  const configIds = {};
  for (const cfg of configs) {
    const c = CUSTOMERS[cfg.customerKey];
    const customerId = created[cfg.customerKey].id;
    const { data: configData, error: configError } = await sb.from("reminder_configs").insert({
      customer_id: customerId,
      enabled: true,
      start_days: cfg.start_days,
      anchor: cfg.anchor,
      repeat_type: cfg.repeat_type,
      interval_n: 7,
      interval_unit: "days",
      escalation: [],
      ends: cfg.ends,
      ends_count: cfg.ends_count,
      ends_date: null,
    }).select("id").single();
    if (configError) throw new Error(`Create config ${cfg.anchor} for ${cfg.customerKey}: ${configError.message}`);
    configIds[cfg.anchor] = { id: configData.id, customerKey: cfg.customerKey };
    console.log(`Config ${cfg.anchor} for ${cfg.customerKey}: ${configData.id.toString().slice(0, 8)}`);
  }

  console.log("\n=== Test data created ===");
  console.log("Customer IDs:");
  for (const [key, d] of Object.entries(created)) {
    console.log(`  ${key}: ${d.id.toString()}`);
  }
  console.log("Config IDs:");
  for (const [anchor, cid] of Object.entries(configIds)) {
    console.log(`  ${anchor}: ${cid.id.toString()}`);
  }
  console.log("\nTrigger date analysis (today =", todayPk, "):");
  console.log("  after_credit (AC): sale date", creditSale.created_at.slice(0, 10), "+ 0 days =", creditSale.created_at.slice(0, 10), "→ DUE (== today)");
  console.log("  after_due (AD): dueDate", CUSTOMERS.ad.dueDate || "null", "+ 0 days =", CUSTOMERS.ad.dueDate || "null", "→ need to check");
  console.log("  before_due (BD): dueDate", CUSTOMERS.bd.dueDate, "- 0 days =", CUSTOMERS.bd.dueDate, "→ need to check");
  console.log("  before_harvest (BH): harvest 2026-09-15 - 5 days =", "2026-09-10", "→ SCHEDULED (future)");

  // Adjust AD and BD due dates to make triggers fire today
  // AD: after_due with startDays=0 → trigger = dueDate. Set dueDate = today.
  // BD: before_due with startDays=0 → trigger = dueDate. Set dueDate = today.
  await sb.from("customers").update({ due_date: todayPk, total_purchases: 30000, outstanding_balance: 30000 }).eq("id", created.ad.id);
  await sb.from("customers").update({ due_date: todayPk, total_purchases: 25000, outstanding_balance: 25000 }).eq("id", created.bd.id);
  console.log("\nAdjusted AD and BD due_date to today:", todayPk);
  console.log("  after_due (AD): dueDate", todayPk, "+ 0 =", todayPk, "→ DUE");
  console.log("  before_due (BD): dueDate", todayPk, "- 0 =", todayPk, "→ DUE");

  console.log("\n=== Done. Now navigate the running app to /admin/alerts so the production engine fires. ===");
}

main().catch(err => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
