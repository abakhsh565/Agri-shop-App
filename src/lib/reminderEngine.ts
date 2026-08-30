import type { Customer, Sale, ReminderConfig, BusinessSettings, CropConfig, GeneratedReminder } from "@/types";

/**
 * Reminder Engine - evaluates all customers and generates due reminders.
 */

interface ReminderEngineInput {
  customers: Customer[];
  sales: Sale[];
  payments: { customerId: string; createdAt: string }[];
  now?: Date;
}

function loadReminderConfig(customerId: string): ReminderConfig | null {
  try { const raw = localStorage.getItem("reminder_config_" + customerId); if (raw) return JSON.parse(raw); } catch {}
  return null;
}

function loadCustomerCrops(customerId: string): string[] {
  try { const raw = localStorage.getItem("customer_crops_" + customerId); if (raw) return JSON.parse(raw); } catch {}
  return [];
}

function loadBusinessSettings(): BusinessSettings {
  try { const raw = localStorage.getItem("business_settings"); if (raw) return JSON.parse(raw); } catch {}
  return { crops: [] };
}

function getDaysSince(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function getNextHarvestDate(crop: CropConfig, now: Date): Date {
  const year = now.getFullYear();
  const harvest = new Date(year, crop.harvestMonth - 1, crop.harvestDay || 1);
  if (harvest < now) harvest.setFullYear(year + 1);
  return harvest;
}

function determineTone(config: ReminderConfig, daysElapsed: number): "gentle" | "firmer" | "final" {
  if (config.repeat !== "escalate") return "gentle";
  const sorted = [...config.escalation].sort((a, b) => b.day - a.day);
  for (const step of sorted) {
    if (daysElapsed >= step.day) {
      if (step.tone.includes("final")) return "final";
      if (step.tone.includes("firmer")) return "firmer";
      return "gentle";
    }
  }
  return "gentle";
}

function getTriggerDate(config: ReminderConfig, sale: Sale | undefined, crop: CropConfig | undefined, now: Date): Date | null {
  if (config.anchor === "after_credit" || config.anchor === "after_due") {
    const baseDate = sale?.createdAt ?? new Date(now.getTime() - 30 * 86400000).toISOString();
    const trigger = new Date(baseDate);
    trigger.setDate(trigger.getDate() + config.startDays);
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

export function generateReminders(input: ReminderEngineInput): GeneratedReminder[] {
  const { customers, sales, now: nowRef } = input;
  const now = nowRef ?? new Date();
  const bizSettings = loadBusinessSettings();
  const reminders: GeneratedReminder[] = [];

  for (const customer of customers) {
    if (customer.outstandingBalance <= 0) continue;
    const config = loadReminderConfig(customer.id);
    if (!config || !config.enabled) continue;
    const customerCropNames = loadCustomerCrops(customer.id);
    const customerSales = sales.filter(s => s.customerId === customer.id);
    const latestSale = customerSales[0];
    let sentCount = 0;
    try { sentCount = JSON.parse(localStorage.getItem("reminder_logs_" + customer.id) || "[]").length; } catch {}
    if (isReminderStopped(config, customer.outstandingBalance, sentCount)) continue;

    if (config.anchor === "before_harvest" && customerCropNames.length > 0) {
      for (const cropName of customerCropNames) {
        const crop = bizSettings.crops.find(c => c.name === cropName);
        if (!crop) continue;
        const triggerDate = getTriggerDate(config, latestSale, crop, now);
        if (!triggerDate || triggerDate > now) continue;
        const daysElapsed = getDaysSince(triggerDate.toISOString(), now);
        const tone = determineTone(config, daysElapsed);
        reminders.push({ customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, outstanding: customer.outstandingBalance, tone, trigger: "harvest", triggerDetail: config.startDays + " days before " + cropName + " harvest", cropName, config });
      }
    } else {
      const triggerDate = getTriggerDate(config, latestSale, undefined, now);
      if (!triggerDate || triggerDate > now) continue;
      const daysElapsed = getDaysSince(triggerDate.toISOString(), now);
      const tone = determineTone(config, daysElapsed);
      const triggerLabel = config.anchor === "after_credit" ? config.startDays + " days after credit given" : config.startDays + " days after due date";
      reminders.push({ customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, outstanding: customer.outstandingBalance, tone, trigger: config.anchor === "after_credit" ? "credit" : "due_date", triggerDetail: triggerLabel, config });
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

/** Seed mock data for testing the reminder system */
export function seedMockReminderData(customers: { id: string; outstandingBalance: number }[]) {
  // 1. Business Settings
  if (!localStorage.getItem("business_settings")) {
    localStorage.setItem("business_settings", JSON.stringify({
      crops: [
        { name: "Cotton", harvestMonth: 9, harvestDay: 3 },
        { name: "Wheat", harvestMonth: 3, harvestDay: 1 },
        { name: "Rice", harvestMonth: 10, harvestDay: 10 },
      ]
    }));
  }
  // 2. Customer crops for customers with outstanding
  const cropSets = [["Cotton", "Wheat"], ["Cotton"], ["Wheat", "Rice"]];
  const outstandingCustomers = customers.filter(c => c.outstandingBalance > 0);
  outstandingCustomers.forEach((c, i) => {
    if (!localStorage.getItem("customer_crops_" + c.id)) {
      localStorage.setItem("customer_crops_" + c.id, JSON.stringify(cropSets[i % cropSets.length]));
    }
  });
  // 3. Reminder configs for all customers with outstanding
  for (const tc of customers.filter(c => c.outstandingBalance > 0)) {
    if (!localStorage.getItem("reminder_config_" + tc.id)) {
      localStorage.setItem("reminder_config_" + tc.id, JSON.stringify({
        enabled: true,
        startDays: 1,
        anchor: "after_credit",
        repeat: "escalate",
        intervalN: 7,
        intervalUnit: "days",
        escalation: [
          { label: "Gentle", tone: "gentle nudge", day: 1 },
          { label: "Firmer", tone: "firmer follow-up", day: 3 },
          { label: "Final notice", tone: "final notice", day: 7 },
        ],
        ends: "paid",
        endsDate: null,
        endsCount: 5,
      }));
    }
  }
}
