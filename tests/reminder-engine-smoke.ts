import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://gkswcfljxlutkfdvvqng.supabase.co",
  "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG"
);

const TEST_CUST_ID = "310f7641-e048-4d89-b40f-4a3832dfdef0";
const EMP_ID = "00000000-0000-0000-0000-000000000002";
const PROD_ID = "00000000-0000-0000-0000-000000000020";
const VAR_ID = "00000000-0000-0000-0000-000000000032";

async function getOccCount() {
  const { count } = await sb.from("reminder_occurrences").select("*", { count: "exact", head: true });
  return count ?? 0;
}

async function main() {
  console.log("=== REMINDER ENGINE REAL EXECUTION TEST ===\n");

  // ── Step 2: Set up test data ──────────────────────────────────────────
  console.log("--- Step 2: Setup ---");

  // Ensure Test Customer has credit_limit set (required by new enforcement)
  await sb.from("customers").update({ credit_limit: 10000 }).eq("id", TEST_CUST_ID);
  console.log("  Credit limit set to 10000");

  // Ensure Test Customer has outstanding > 0 via credit sale
  const { data: preCust } = await sb.from("customers")
    .select("outstanding_balance").eq("id", TEST_CUST_ID).single();
  
  let saleCreated = false;
  if (!preCust || preCust.outstanding_balance <= 0) {
    console.log("  Creating credit sale (partial payment)...");
    const { data: sale, error: saleErr } = await sb.rpc("create_sale", {
      payload: {
        customerId: TEST_CUST_ID, customerName: "Test Customer",
        employeeId: EMP_ID, employeeName: "Yaqoob Malik",
        paymentType: "partial", paymentMethod: "cash", amountPaid: 100,
        dueDate: "2026-10-15",
        items: [{ productId: PROD_ID, productName: "Hybrid Maize Seed", variantId: VAR_ID, variantName: "1kg", qty: 1, unitPrice: 500, unitSize: 1, baseUnit: "kg" }],
      },
    });
    if (saleErr) { console.log("  Sale error:", saleErr.message); return; }
    console.log("  Sale:", sale!.saleNumber, "total:", sale!.total, "(paid 100, outstanding 400)");
    saleCreated = true;
  } else {
    console.log("  Customer already has outstanding:", preCust.outstanding_balance);
  }

  // Set credit_limit and due_date
  await sb.from("customers").update({ credit_limit: 10000, due_date: "2026-10-15" }).eq("id", TEST_CUST_ID);
  const { data: cust } = await sb.from("customers")
    .select("name, credit_limit, outstanding_balance, due_date").eq("id", TEST_CUST_ID).single();
  console.log("  Customer:", cust!.name, "| limit:", cust!.credit_limit, "| outstanding:", cust!.outstanding_balance, "| due:", cust!.due_date);

  // Create after_due reminder config
  const { data: existingCfg } = await sb.from("reminder_configs")
    .select("id, anchor").eq("customer_id", TEST_CUST_ID).eq("anchor", "after_due").limit(1);

  let configId: string;
  let configCreated = false;
  if (existingCfg && existingCfg.length > 0) {
    configId = existingCfg[0].id;
    console.log("  Using existing config:", configId);
  } else {
    const { data: newCfg, error: cfgErr } = await sb.from("reminder_configs").insert({
      customer_id: TEST_CUST_ID, enabled: true, start_days: 3,
      anchor: "after_due", repeat_type: "once", interval_n: 7, interval_unit: "days",
      escalation: JSON.stringify([{ label: "Gentle", tone: "gentle nudge", day: 3 }]),
      ends: "paid", ends_count: 5,
    }).select("id").single();
    if (cfgErr) { console.log("  Config error:", cfgErr.message); return; }
    configId = newCfg!.id;
    configCreated = true;
    console.log("  Config created:", configId);
  }

  const preOccCount = await getOccCount();
  console.log("  Pre-execution occurrences:", preOccCount);

  // ── Step 3: Execute real generateReminders() ──────────────────────────
  console.log("\n--- Step 3: Execute generateReminders() ---");

  const engine = await import("./reminderEngine-bundled.mjs");
  console.log("  Engine loaded:", typeof engine.generateReminders);

  // Build mapped Customer/Sale objects matching the engine's expected shape
  const { data: custFull } = await sb.from("customers").select("*").eq("id", TEST_CUST_ID).single();
  const { data: sales } = await sb.from("sales").select("*").eq("customer_id", TEST_CUST_ID).order("created_at", { ascending: false });

  const customer = {
    id: custFull!.id, name: custFull!.name, phone: custFull!.phone,
    address: custFull!.address ?? undefined, imageUrl: custFull!.image_url ?? undefined,
    creditLimit: Number(custFull!.credit_limit), outstandingBalance: Number(custFull!.outstanding_balance),
    totalPurchases: Number(custFull!.total_purchases), totalPaid: Number(custFull!.total_paid),
    dueDate: custFull!.due_date ?? null, createdAt: custFull!.created_at,
    createdBy: custFull!.created_by ?? "", isArchived: custFull!.is_archived ?? false,
    archivedAt: custFull!.archived_at, archivedBy: custFull!.archived_by,
  };

  const mappedSales = (sales || []).map((s: any) => ({
    id: s.id, saleNumber: s.sale_number, customerId: s.customer_id ?? "",
    customerName: s.customer_name, employeeId: s.employee_id ?? "",
    employeeName: s.employee_name, items: [],
    subtotal: Number(s.subtotal), taxAmount: Number(s.tax_amount),
    totalAmount: Number(s.total_amount), amountPaid: Number(s.amount_paid),
    outstandingBalance: Number(s.outstanding_balance),
    paymentType: s.payment_type, paymentMethod: s.payment_method,
    isVoided: s.is_voided, createdAt: s.created_at,
  }));

  console.log("  Customer:", customer.name, "| outstanding:", customer.outstandingBalance, "| due:", customer.dueDate);

  const reminders = await engine.generateReminders({
    customers: [customer], sales: mappedSales, now: new Date(),
  });

  console.log("\n  Generated reminders:", reminders.length);
  for (const r of reminders) {
    const anyR = r as any;
    console.log("    -", r.customerName, "| trigger:", r.trigger, "| tone:", r.tone);
    console.log("      triggerDate:", r.triggerDate);
    console.log("      configId:", r.configId);
    console.log("      occurrenceId:", anyR._occurrenceId);
    console.log("      occurrenceKey:", anyR._occurrenceKey);
    console.log("      occurrenceStatus:", anyR._occurrenceStatus);
  }

  // ── Step 4: Verify persistence ────────────────────────────────────────
  console.log("\n--- Step 4: Verify persistence ---");
  const postOccCount = await getOccCount();
  console.log("  Occurrences: " + preOccCount + " → " + postOccCount);

  if (reminders.length > 0) {
    const occId = (reminders[0] as any)._occurrenceId;
    if (occId) {
      const { data: occ } = await sb.from("reminder_occurrences").select("*").eq("id", occId).single();
      if (occ) {
        console.log("  Occurrence verified in DB:");
        console.log("    id:", occ.id);
        console.log("    key:", occ.occurrence_key);
        console.log("    config_id:", occ.config_id);
        console.log("    customer_id:", occ.customer_id);
        console.log("    scheduled_date:", occ.scheduled_date);
        console.log("    status:", occ.status);
        console.log("    tone:", occ.tone);
        console.log("    number:", occ.occurrence_number);
      } else {
        console.log("  WARNING: Occurrence NOT in DB");
      }
    }
  } else {
    console.log("  No reminders generated (trigger condition may not be met)");
  }

  // ── Step 5: Idempotency ──────────────────────────────────────────────
  console.log("\n--- Step 5: Idempotency ---");
  const reminders2 = await engine.generateReminders({
    customers: [customer], sales: mappedSales, now: new Date(),
  });
  const postOccCount2 = await getOccCount();
  console.log("  Second run: " + reminders2.length + " reminders, " + postOccCount2 + " occurrences");
  console.log("  " + (postOccCount2 === postOccCount ? "PASS: no duplicate" : "FAIL: duplicate created"));

  // ── Step 6: Cleanup ───────────────────────────────────────────────────
  console.log("\n--- Step 6: Cleanup ---");
  await sb.from("reminder_occurrences").delete().eq("config_id", configId);
  if (configCreated) {
    await sb.from("reminder_configs").delete().eq("id", configId);
  }
  console.log("  Deleted occurrences" + (configCreated ? " and config" : ""));

  if (saleCreated) {
    const { data: ts } = await sb.from("sales").select("id").eq("customer_id", TEST_CUST_ID).order("created_at", { ascending: false }).limit(1).single();
    if (ts) {
      await sb.from("sale_items").delete().eq("sale_id", ts.id);
      await sb.from("sales").delete().eq("id", ts.id);
      console.log("  Deleted test sale");
    }
  }

  await sb.from("customers").update({ credit_limit: 0, due_date: null }).eq("id", TEST_CUST_ID);
  console.log("  Restored customer");

  const finalOcc = await getOccCount();
  console.log("  Final occurrences:", finalOcc);
  console.log("\n=== COMPLETE ===");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
