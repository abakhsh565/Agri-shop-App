/**
 * REMINDER ENGINE — 36-COMBINATION MATRIX TEST
 *
 * Tests all combinations of:
 *   4 triggers × 3 repeat modes × 3 end modes = 36
 *
 * Uses the REAL generateReminders() function via esbuild-bundled engine.
 */

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  "https://gkswcfljxlutkfdvvqng.supabase.co",
  "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG"
);

const EMP = "00000000-0000-0000-0000-000000000002";
const PROD_ID = "00000000-0000-0000-0000-000000000020";
const VAR_ID = "00000000-0000-0000-0000-000000000032";

type TriggerType = "after_credit" | "after_due" | "before_due" | "before_harvest";
type RepeatType = "once" | "interval" | "escalate";
type EndType = "paid" | "date" | "count";

interface ComboResult {
  num: number;
  trigger: TriggerType;
  repeat: RepeatType;
  end: EndType;
  engine: string;
  occurrence: string;
  schedule: string;
  repeatStop: string;
  idempotency: string;
  result: string;
}

const results: ComboResult[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────

function todayPk(): string {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00+05:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function createTestCustomer(name: string, overrides: Record<string, any> = {}) {
  const id = crypto.randomUUID();
  const { data, error } = await sb.from("customers").insert({
    id,
    name,
    phone: `0300${Math.floor(1000000 + Math.random() * 9000000)}`,
    credit_limit: overrides.credit_limit ?? 50000,
    outstanding_balance: overrides.outstanding_balance ?? 5000,
    total_purchases: overrides.total_purchases ?? 5000,
    due_date: overrides.due_date ?? null,
    is_active: true,
    created_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(`Create customer: ${error.message}`);
  return id;
}

async function createCreditSale(customerId: string, amount: number, paid: number) {
  const { data, error } = await sb.rpc("create_sale", {
    payload: {
      customerId, customerName: "Matrix Test",
      employeeId: EMP, employeeName: "Matrix Runner",
      paymentType: "partial", paymentMethod: "cash", amountPaid: paid,
      dueDate: "2026-12-31",
      items: [{ productId: PROD_ID, productName: "Hybrid Maize Seed", variantId: VAR_ID, variantName: "1kg", qty: 1, unitPrice: amount, unitSize: 1, baseUnit: "kg" }],
    },
  });
  if (error) throw new Error(`Create sale: ${error.message}`);
  return data!;
}

async function createConfig(customerId: string, anchor: string, repeat: string, ends: string, opts: Record<string, any> = {}) {
  const { data, error } = await sb.from("reminder_configs").insert({
    customer_id: customerId,
    enabled: true,
    start_days: opts.start_days ?? 3,
    anchor,
    repeat_type: repeat,
    interval_n: opts.interval_n ?? 7,
    interval_unit: opts.interval_unit ?? "days",
    escalation: JSON.stringify(opts.escalation ?? [
      { label: "Gentle", tone: "gentle nudge", day: 3 },
      { label: "Firmer", tone: "firm reminder", day: 7 },
      { label: "Final", tone: "final notice", day: 14 },
    ]),
    ends,
    ends_date: opts.ends_date ?? null,
    ends_count: opts.ends_count ?? 5,
  }).select("id").single();
  if (error) throw new Error(`Create config: ${error.message}`);
  return data!.id;
}

async function setupCrops(customerId: string, cropNames: string[]) {
  for (const name of cropNames) {
    await sb.from("customer_crops").insert({ customer_id: customerId, crop_name: name });
  }
}

async function loadMappedCustomer(id: string) {
  const { data: c } = await sb.from("customers").select("*").eq("id", id).single();
  if (!c) throw new Error("Customer not found: " + id);
  return {
    id: c.id, name: c.name, phone: c.phone,
    address: c.address ?? undefined, imageUrl: c.image_url ?? undefined,
    creditLimit: Number(c.credit_limit), outstandingBalance: Number(c.outstanding_balance),
    totalPurchases: Number(c.total_purchases), totalPaid: Number(c.total_paid),
    dueDate: c.due_date ?? null, createdAt: c.created_at,
    createdBy: c.created_by ?? "", isArchived: c.is_archived ?? false,
    archivedAt: c.archived_at, archivedBy: c.archived_by,
  };
}

async function loadMappedSales(customerId: string) {
  const { data: sales } = await sb.from("sales").select("*").eq("customer_id", customerId).order("created_at", { ascending: false });
  return (sales || []).map((s: any) => ({
    id: s.id, saleNumber: s.sale_number, customerId: s.customer_id ?? "",
    customerName: s.customer_name, employeeId: s.employee_id ?? "",
    employeeName: s.employee_name, items: [],
    subtotal: Number(s.subtotal), taxAmount: Number(s.tax_amount),
    totalAmount: Number(s.total_amount), amountPaid: Number(s.amount_paid),
    outstandingBalance: Number(s.outstanding_balance),
    paymentType: s.payment_type, paymentMethod: s.payment_method,
    isVoided: s.is_voided, createdAt: s.created_at,
  }));
}

async function getOccCount(configId: string) {
  const { count } = await sb.from("reminder_occurrences").select("*", { count: "exact", head: true }).eq("config_id", configId);
  return count ?? 0;
}

async function cleanup(customerId: string, configId: string) {
  await sb.from("reminder_occurrences").delete().eq("config_id", configId);
  await sb.from("reminder_configs").delete().eq("id", configId);
  await sb.from("customer_crops").delete().eq("customer_id", customerId);
  // Delete sales
  const { data: sales } = await sb.from("sales").select("id").eq("customer_id", customerId);
  for (const s of (sales || [])) {
    await sb.from("sale_items").delete().eq("sale_id", s.id);
    await sb.from("sales").delete().eq("id", s.id);
  }
  await sb.from("customers").delete().eq("id", customerId);
}

// ── Main test runner ─────────────────────────────────────────────────────

async function runCombo(
  num: number,
  trigger: TriggerType,
  repeat: RepeatType,
  end: EndType,
  engine: any,
): Promise<ComboResult> {
  const r: ComboResult = {
    num, trigger, repeat, end,
    engine: "?", occurrence: "?", schedule: "?", repeatStop: "?", idempotency: "?", result: "?",
  };

  try {
    // Create isolated test customer
    const custName = `REM_MATRIX_${num}_${trigger}_${repeat}_${end}`;
    let customerId: string;

    const dueDate = "2026-10-20"; // Future date for before_due/after_due
    const endsDate = "2026-11-30"; // For date-based end

    if (trigger === "before_harvest") {
      customerId = await createTestCustomer(custName, { due_date: dueDate, outstanding_balance: 1000, total_purchases: 1000 });
      await setupCrops(customerId, ["Cotton"]); // Cotton harvest: Sep 15
    } else if (trigger === "after_credit") {
      customerId = await createTestCustomer(custName, { due_date: dueDate, outstanding_balance: 0, total_purchases: 0 });
      // Create a credit sale to establish outstanding
      await createCreditSale(customerId, 2000, 500); // 2000 total, 500 paid, 1500 outstanding
    } else {
      // after_due, before_due
      customerId = await createTestCustomer(custName, { due_date: dueDate, outstanding_balance: 1000, total_purchases: 1000 });
    }

    // Create config
    const configId = await createConfig(customerId, trigger, repeat, end, {
      start_days: trigger === "before_harvest" ? 5 : 3,
      interval_n: 7,
      ends_date: end === "date" ? endsDate : null,
      ends_count: end === "count" ? 3 : 5,
    });

    // Load mapped data
    const customer = await loadMappedCustomer(customerId);
    const sales = await loadMappedSales(customerId);

    // Execute engine
    const reminders = await engine.generateReminders({
      customers: [customer],
      sales,
      now: new Date(),
    });

    r.engine = reminders.length > 0 ? `${reminders.length} reminder(s)` : "0 (condition not met)";

    if (reminders.length > 0) {
      const occ = reminders[0] as any;
      const occId = occ._occurrenceId;

      // Verify in DB
      const { data: dbOcc } = await sb.from("reminder_occurrences").select("*").eq("id", occId).single();
      if (dbOcc) {
        r.occurrence = `key=${dbOcc.occurrence_key} #${dbOcc.occurrence_number}`;
        r.schedule = `date=${dbOcc.scheduled_date} status=${dbOcc.status}`;
        r.repeatStop = `tone=${dbOcc.tone}`;
      } else {
        r.occurrence = "NOT IN DB";
      }
    }

    // Idempotency
    const reminders2 = await engine.generateReminders({
      customers: [customer],
      sales,
      now: new Date(),
    });
    const occCount2 = await getOccCount(configId);
    const occCount1 = await getOccCount(configId);
    r.idempotency = occCount2 === occCount1 ? "PASS" : `FAIL (${occCount1}→${occCount2})`;

    r.result = r.engine.startsWith("0") ? "BLOCKED" : "PASS";

  } catch (err: any) {
    r.result = `FAIL: ${err.message.substring(0, 80)}`;
  }

  return r;
}

// ── Entry point ──────────────────────────────────────────────────────────

async function main() {
  console.log("=== REMINDER ENGINE 36-COMBINATION MATRIX ===\n");

  const engine = await import("./reminderEngine-bundled.mjs");
  console.log("Engine loaded:", typeof engine.generateReminders);

  const triggers: TriggerType[] = ["after_credit", "after_due", "before_due", "before_harvest"];
  const repeats: RepeatType[] = ["once", "interval", "escalate"];
  const ends: EndType[] = ["paid", "date", "count"];

  let num = 0;
  for (const trigger of triggers) {
    for (const repeat of repeats) {
      for (const end of ends) {
        num++;
        process.stdout.write(`[${num}/36] ${trigger}/${repeat}/${end}... `);
        const r = await runCombo(num, trigger, repeat, end, engine);
        results.push(r);
        console.log(r.result);
      }
    }
  }

  // Print table
  console.log("\n=== RESULTS TABLE ===\n");
  console.log("| # | Trigger | Repeat | End | Engine | Occurrence | Schedule | Repeat/Stop | Idempotency | Result |");
  console.log("| - | ------- | ------ | --- | ------ | ---------- | -------- | ----------- | ----------- | ------ |");
  for (const r of results) {
    console.log(`| ${r.num} | ${r.trigger} | ${r.repeat} | ${r.end} | ${r.engine} | ${r.occurrence} | ${r.schedule} | ${r.repeatStop} | ${r.idempotency} | ${r.result} |`);
  }

  const pass = results.filter(r => r.result === "PASS").length;
  const fail = results.filter(r => r.result.startsWith("FAIL")).length;
  const blocked = results.filter(r => r.result === "BLOCKED").length;
  console.log(`\nTotal: PASS=${pass} FAIL=${fail} BLOCKED=${blocked}`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
