import type { Customer, Sale, ReminderConfig, BusinessSettings, CropConfig, GeneratedReminder, PaymentStatus } from "@/types";
import { supabase } from "@/lib/supabase";

// ─── Supabase Data Access ─────────────────────────────────────────────────────

export async function loadReminderConfigs(customerId: string): Promise<ReminderConfig[]> {
  try {
    const { data } = await supabase
      .from("reminder_configs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at");
    if (!data) return [];
    return data.map(row => ({
      id: row.id,
      enabled: row.enabled ?? true,
      startDays: row.start_days ?? 1,
      anchor: row.anchor as ReminderConfig["anchor"],
      repeat: row.repeat_type as ReminderConfig["repeat"],
      intervalN: row.interval_n ?? 7,
      intervalUnit: row.interval_unit as ReminderConfig["intervalUnit"],
      escalation: row.escalation ?? [],
      ends: row.ends as ReminderConfig["ends"],
      endsDate: row.ends_date ?? null,
      endsCount: row.ends_count ?? 5,
    }));
  } catch {
    return [];
  }
}

export async function saveReminderConfig(customerId: string, config: ReminderConfig): Promise<void> {
  const payload = {
    customer_id: customerId,
    enabled: config.enabled,
    start_days: config.startDays,
    anchor: config.anchor,
    repeat_type: config.repeat,
    interval_n: config.intervalN,
    interval_unit: config.intervalUnit,
    escalation: config.escalation,
    ends: config.ends,
    ends_date: config.endsDate || null,
    ends_count: config.endsCount,
    updated_at: new Date().toISOString(),
  };

  if (config.id && config.id.length > 0 && !config.id.startsWith("new-")) {
    await supabase.from("reminder_configs").update(payload).eq("id", config.id);
  } else {
    const { id: _id, ...insertPayload } = { ...payload, id: undefined };
    await supabase.from("reminder_configs").insert(insertPayload);
  }
}

export async function deleteReminderConfig(configId: string): Promise<void> {
  await supabase.from("reminder_configs").delete().eq("id", configId);
}

export async function loadCustomerCrops(customerId: string): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("customer_crops")
      .select("crop_name")
      .eq("customer_id", customerId);
    if (!data) return [];
    return data.map(r => r.crop_name);
  } catch {
    return [];
  }
}

export async function saveCustomerCrops(customerId: string, crops: string[]): Promise<void> {
  await supabase.from("customer_crops").delete().eq("customer_id", customerId);
  if (crops.length > 0) {
    await supabase.from("customer_crops").insert(
      crops.map(name => ({ customer_id: customerId, crop_name: name }))
    );
  }
}

export async function loadBusinessSettings(): Promise<BusinessSettings> {
  try {
    const { data } = await supabase.from("business_settings").select("crops").limit(1).single();
    if (data?.crops) return { crops: data.crops };
  } catch {}
  return { crops: [] };
}

export async function saveBusinessSettings(settings: BusinessSettings): Promise<void> {
  const { data: existing } = await supabase.from("business_settings").select("id").limit(1).single();
  if (existing) {
    await supabase.from("business_settings").update({ crops: settings.crops, updated_at: new Date().toISOString() }).eq("id", existing.id);
  } else {
    await supabase.from("business_settings").insert({ crops: settings.crops });
  }
}

export async function loadReminderLogs(customerId?: string): Promise<Array<{ id: string; customerId: string; customerName?: string; configId?: string; tone: string; message: string; channel: string; sentAt: string }>> {
  try {
    let query = supabase.from("reminder_logs").select("*").order("sent_at", { ascending: false });
    if (customerId) query = query.eq("customer_id", customerId);
    const { data } = await query.limit(200);
    if (!data) return [];
    return data.map(r => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      configId: r.config_id,
      tone: r.tone,
      message: r.message,
      channel: r.channel,
      sentAt: r.sent_at,
    }));
  } catch {
    return [];
  }
}

export async function logReminder(customerId: string, customerName: string, configId: string, tone: string, message: string, channel: string): Promise<void> {
  await supabase.from("reminder_logs").insert({
    customer_id: customerId,
    customer_name: customerName,
    config_id: configId,
    tone,
    message,
    channel,
    sent_at: new Date().toISOString(),
  });
}

// ─── Core Engine ──────────────────────────────────────────────────────────────

function getDaysSince(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function getDaysBetween(date1: Date, date2: Date): number {
  return Math.floor((date2.getTime() - date1.getTime()) / 86400000);
}

function getNextHarvestDate(crop: CropConfig, now: Date): Date {
  const year = now.getFullYear();
  const harvest = new Date(year, crop.harvestMonth - 1, crop.harvestDay || 1);
  if (harvest <= now) harvest.setFullYear(year + 1);
  return harvest;
}

function getLatestCreditSale(sales: Sale[], customerId: string): Sale | undefined {
  const customerSales = sales
    .filter(s => s.customerId === customerId && s.paymentType !== "full" && !s.isVoided)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return customerSales[0];
}

function determineTone(config: ReminderConfig, daysElapsed: number): "gentle" | "firmer" | "final" {
  if (config.repeat !== "escalate") return "gentle";
  const sorted = [...config.escalation].sort((a, b) => a.day - b.day);
  let currentTone: "gentle" | "firmer" | "final" = "gentle";
  for (const step of sorted) {
    if (daysElapsed >= step.day) {
      if (step.tone.includes("final")) currentTone = "final";
      else if (step.tone.includes("firmer")) currentTone = "firmer";
      else currentTone = "gentle";
    }
  }
  return currentTone;
}

function getTriggerDate(config: ReminderConfig, customer: Customer, sale: Sale | undefined, crop: CropConfig | undefined, now: Date): Date | null {
  if (config.anchor === "after_credit") {
    if (!sale) return null;
    const trigger = new Date(sale.createdAt);
    trigger.setDate(trigger.getDate() + config.startDays);
    return trigger;
  }
  if (config.anchor === "after_due") {
    if (!customer.dueDate) return null;
    const trigger = new Date(customer.dueDate);
    trigger.setDate(trigger.getDate() + config.startDays);
    return trigger;
  }
  if (config.anchor === "before_due") {
    if (!customer.dueDate) return null;
    const trigger = new Date(customer.dueDate);
    trigger.setDate(trigger.getDate() - config.startDays);
    return trigger;
  }
  if (config.anchor === "before_harvest" && crop) {
    const harvest = getNextHarvestDate(crop, now);
    harvest.setDate(harvest.getDate() - config.startDays);
    return harvest;
  }
  return null;
}

function isReminderStopped(config: ReminderConfig, outstanding: number, sentCount: number): boolean {
  if (outstanding <= 0) return true;
  if (config.ends === "count" && sentCount >= config.endsCount) return true;
  if (config.ends === "date" && config.endsDate && new Date(config.endsDate) < new Date()) return true;
  return false;
}

// ─── Payment Status ───────────────────────────────────────────────────────────

export function calculatePaymentStatus(customer: Customer, now: Date): PaymentStatus {
  if (customer.outstandingBalance <= 0) return "paid";
  if (!customer.dueDate) return "no_due_date";
  const dueDate = new Date(customer.dueDate);
  const daysOverdue = getDaysBetween(dueDate, now);
  if (daysOverdue <= 7) return "on_time";
  if (daysOverdue <= 30) return "delayed";
  return "high_risk";
}

export function getPaymentStatusLabel(status: PaymentStatus): string {
  switch (status) {
    case "on_time": return "On Time";
    case "delayed": return "Delayed";
    case "high_risk": return "High Risk";
    case "no_due_date": return "No Due Date";
    case "paid": return "Paid";
  }
}

export function getPaymentStatusColor(status: PaymentStatus): { color: string; bg: string } {
  switch (status) {
    case "on_time": return { color: "#3B6D11", bg: "#E3F3D9" };
    case "delayed": return { color: "#92400e", bg: "#FEF3C7" };
    case "high_risk": return { color: "#A32D2D", bg: "#FCEBEB" };
    case "no_due_date": return { color: "#5A5A55", bg: "#F1EFE8" };
    case "paid": return { color: "#3B6D11", bg: "#E3F3D9" };
  }
}

// ─── Generate Reminders ───────────────────────────────────────────────────────

interface ReminderEngineInput {
  customers: Customer[];
  sales: Sale[];
  now?: Date;
}

export async function generateReminders(input: ReminderEngineInput): Promise<GeneratedReminder[]> {
  const { customers, sales, now: nowRef } = input;
  const now = nowRef ?? new Date();
  const reminders: GeneratedReminder[] = [];
  const bizSettings = await loadBusinessSettings();

  for (const customer of customers) {
    if (customer.outstandingBalance <= 0) continue;
    const configs = await loadReminderConfigs(customer.id);
    if (configs.length === 0) continue;
    const customerCropNames = await loadCustomerCrops(customer.id);
    const latestSale = getLatestCreditSale(sales, customer.id);

    for (const config of configs) {
      if (!config.enabled) continue;
      let sentCount = 0;
      try {
        const { count } = await supabase
          .from("reminder_logs")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customer.id)
          .eq("config_id", config.id);
        sentCount = count ?? 0;
      } catch {}
      if (isReminderStopped(config, customer.outstandingBalance, sentCount)) continue;

      if (config.anchor === "before_harvest" && customerCropNames.length > 0) {
        for (const cropName of customerCropNames) {
          const crop = bizSettings.crops.find(c => c.name === cropName);
          if (!crop) continue;
          const triggerDate = getTriggerDate(config, customer, latestSale, crop, now);
          if (!triggerDate) continue;
          const isFuture = triggerDate > now;
          const daysElapsed = isFuture ? 0 : getDaysSince(triggerDate.toISOString(), now);
          reminders.push({
            customerId: customer.id, customerName: customer.name,
            customerPhone: customer.phone, outstanding: customer.outstandingBalance,
            dueDate: customer.dueDate, paymentStatus: calculatePaymentStatus(customer, now),
            configId: config.id, tone: determineTone(config, daysElapsed),
            trigger: "harvest", triggerDetail: config.startDays + " days before " + cropName + " harvest",
            cropName, config, triggerDate: triggerDate.toISOString(),
          });
        }
      } else {
        const triggerDate = getTriggerDate(config, customer, latestSale, undefined, now);
        if (!triggerDate) continue;
        const isFuture = triggerDate > now;
        const daysElapsed = isFuture ? 0 : getDaysSince(triggerDate.toISOString(), now);
        const label = config.anchor === "after_credit" ? config.startDays + " days after credit given"
          : config.anchor === "after_due" ? config.startDays + " days after due date"
          : config.startDays + " days before due date";
        reminders.push({
          customerId: customer.id, customerName: customer.name,
          customerPhone: customer.phone, outstanding: customer.outstandingBalance,
          dueDate: customer.dueDate, paymentStatus: calculatePaymentStatus(customer, now),
          configId: config.id, tone: determineTone(config, daysElapsed),
          trigger: config.anchor === "after_credit" ? "credit" : "due_date",
          triggerDetail: label, config, triggerDate: triggerDate.toISOString(),
        });
      }
    }
  }
  return reminders;
}

export function generateReminderMessage(reminder: GeneratedReminder): string {
  const name = reminder.customerName.split(" ")[0];
  const amount = "Rs. " + Math.round(reminder.outstanding).toLocaleString("en-PK");
  if (reminder.tone === "gentle") return "Hello " + name + ", this is a friendly reminder that " + amount + " is currently outstanding on your account. Please arrange payment when convenient.";
  if (reminder.tone === "firmer") return "Hello " + name + ", " + amount + " remains outstanding on your account. Please arrange payment at your earliest convenience.";
  return "Hello " + name + ", " + amount + " remains outstanding on your account. Please contact us regarding settlement. Do not ignore this message.";
}

// ─── Helper: split reminders into tabs ────────────────────────────────────────

export function categorizeReminders(
  reminders: GeneratedReminder[], sentConfigIds: Set<string>, now: Date,
): { ready: GeneratedReminder[]; future: GeneratedReminder[] } {
  const ready: GeneratedReminder[] = [];
  const future: GeneratedReminder[] = [];
  for (const r of reminders) {
    if (sentConfigIds.has(r.customerId + "-" + r.configId)) continue;
    const triggerDate = calcTriggerForCategory(r.config, r);
    if (triggerDate && triggerDate > now) future.push(r);
    else ready.push(r);
  }
  return { ready, future };
}

function calcTriggerForCategory(config: ReminderConfig, reminder: GeneratedReminder): Date | null {
  if (config.anchor === "after_due" && reminder.dueDate) {
    const d = new Date(reminder.dueDate); d.setDate(d.getDate() + config.startDays); return d;
  }
  if (config.anchor === "before_due" && reminder.dueDate) {
    const d = new Date(reminder.dueDate); d.setDate(d.getDate() - config.startDays); return d;
  }
  return null;
}
