import type { Customer, Sale, ReminderConfig, ReminderGroup, BusinessSettings, CropConfig, GeneratedReminder, PaymentStatus } from "@/types";
import type { TranslateFn } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import { pkDate, pkDateFromISO } from "@/lib/pkDate";

// ─── Pakistan Business Date Helpers ────────────────────────────────────────────

/** Get Pakistan business date as YYYY-MM-DD string. */
function pkBusinessDate(now?: Date): string {
  return pkDate(now ?? new Date());
}

/** Get the nth business day from a PK date (positive = future, negative = past). */
function addBusinessDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00+05:00");
  d.setDate(d.getDate() + days);
  return pkBusinessDate(d);
}

/** Days between two PK business dates (date2 - date1, positive = date2 is later). */
function daysBetweenPk(date1Str: string, date2Str: string): number {
  const d1 = new Date(date1Str + "T00:00:00+05:00");
  const d2 = new Date(date2Str + "T00:00:00+05:00");
  return Math.floor((d2.getTime() - d1.getTime()) / 86400000);
}

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
      escalation: (() => {
        const raw = typeof row.escalation === "string" ? JSON.parse(row.escalation) : (row.escalation ?? []);
        return Array.isArray(raw) ? raw.map((s: any) => ({
          label: s.label || s.tone || "Stage",
          tone: s.tone || "nudge",
          day: s.day ?? 1,
        })) : [];
      })(),
      ends: row.ends as ReminderConfig["ends"],
      endsDate: row.ends_date ?? null,
      endsCount: row.ends_count ?? 5,
      groupId: row.group_id ?? null,
      groupName: row.group_name ?? null,
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
    // Cancel stale future occurrences when config changes
    await supabase
      .from("reminder_occurrences")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("config_id", config.id)
      .eq("status", "scheduled");
  } else {
    const { id: _id, ...insertPayload } = { ...payload, id: undefined };
    const { data } = await supabase.from("reminder_configs").insert(insertPayload).select("id").single();
    // If a new config was created, the engine will generate occurrences on next run
  }
}

export async function deleteReminderConfig(configId: string): Promise<void> {
  // Delete all occurrences for this config first
  await supabase.from("reminder_occurrences").delete().eq("config_id", configId);
  await supabase.from("reminder_configs").delete().eq("id", configId);
}

// ─── Group-based Reminders ─────────────────────────────────────────────────────

export async function loadReminderGroups(): Promise<ReminderGroup[]> {
  try {
    const { data } = await supabase
      .from("reminder_configs")
      .select("group_id, group_name, customer_id, anchor, start_days, repeat_type, interval_n, interval_unit, ends, created_at")
      .not("group_id", "is", null);
    if (!data || data.length === 0) return [];

    const customerIds = [...new Set((data as any[]).map(r => r.customer_id))];
    const { data: custRows } = await supabase
      .from("customers")
      .select("id, name, outstanding_balance, due_date")
      .in("id", customerIds);
    const custMap = new Map<string, any>();
    (custRows || []).forEach((c: any) => custMap.set(c.id, c));

    const groupMap = new Map<string, { name: string; customerIds: Set<string>; config: any; createdAt: string }>();
    for (const row of data as any[]) {
      const gId = row.group_id;
      if (!groupMap.has(gId)) {
        groupMap.set(gId, {
          name: row.group_name || "Unnamed Group",
          customerIds: new Set(),
          config: {
            triggerType: row.anchor || "before_due",
            startDays: row.start_days || 3,
            repeatType: row.repeat_type || "once",
            intervalN: row.interval_n,
            intervalUnit: row.interval_unit,
            ends: row.ends,
          },
          createdAt: row.created_at || "",
        });
      }
      groupMap.get(gId)!.customerIds.add(row.customer_id);
    }

    return Array.from(groupMap.entries()).map(([id, g]) => ({
      id,
      name: g.name,
      createdAt: g.createdAt,
      customerCount: g.customerIds.size,
      customers: Array.from(g.customerIds).map(cId => {
        const c = custMap.get(cId);
        return {
          id: cId,
          name: c?.name || "Unknown",
          outstandingBalance: c?.outstanding_balance || 0,
          dueDate: c?.due_date || null,
        };
      }),
      config: g.config,
    }));
  } catch {
    return [];
  }
}

export async function saveReminderGroup(
  config: ReminderConfig,
  customerIds: string[],
  groupName: string,
): Promise<void> {
  const groupId = config.groupId || crypto.randomUUID();
  const configTemplate = {
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
    group_id: groupId,
    group_name: groupName,
    updated_at: new Date().toISOString(),
  };

  await supabase.from("reminder_configs").delete().eq("group_id", groupId);
  const rows = customerIds.map(customerId => ({
    ...configTemplate,
    customer_id: customerId,
  }));
  await supabase.from("reminder_configs").insert(rows);
}

export async function deleteReminderGroup(groupId: string): Promise<void> {
  // Delete occurrences for all configs in this group
  const { data: configs } = await supabase
    .from("reminder_configs").select("id").eq("group_id", groupId);
  if (configs && configs.length > 0) {
    const configIds = configs.map(c => c.id);
    await supabase.from("reminder_occurrences").delete().in("config_id", configIds);
  }
  await supabase.from("reminder_configs").delete().eq("group_id", groupId);
}

export function isDuplicateGroupReminder(
  newConfig: ReminderConfig,
  existingConfigs: ReminderConfig[],
  newGroupName: string,
): boolean {
  return existingConfigs.some(existing => {
    if (existing.groupName !== newGroupName) return false;
    if (existing.anchor !== newConfig.anchor) return false;
    if (existing.startDays !== newConfig.startDays) return false;
    if (existing.repeat !== newConfig.repeat) return false;
    if (existing.intervalN !== newConfig.intervalN) return false;
    if (existing.intervalUnit !== newConfig.intervalUnit) return false;
    if (existing.ends !== newConfig.ends) return false;
    return true;
  });
}

export function isDuplicateReminder(newConfig: ReminderConfig, existingConfigs: ReminderConfig[]): boolean {
  return existingConfigs.some(existing => {
    if (existing.id === newConfig.id) return false;
    if (existing.anchor !== newConfig.anchor) return false;
    if (existing.startDays !== newConfig.startDays) return false;
    if (existing.repeat !== newConfig.repeat) return false;
    if (existing.intervalN !== newConfig.intervalN) return false;
    if (existing.intervalUnit !== newConfig.intervalUnit) return false;
    if (existing.ends !== newConfig.ends) return false;
    if (existing.endsDate !== newConfig.endsDate) return false;
    if (existing.endsCount !== newConfig.endsCount) return false;
    const escA = JSON.stringify(existing.escalation);
    const escB = JSON.stringify(newConfig.escalation);
    if (escA !== escB) return false;
    return true;
  });
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
    const { data } = await supabase.from("business_settings")
      .select("setting_value")
      .eq("setting_key", "crops")
      .limit(1)
      .single();
    if (data?.setting_value) {
      const parsed = typeof data.setting_value === "string" ? JSON.parse(data.setting_value) : data.setting_value;
      return { crops: Array.isArray(parsed) ? parsed : [] };
    }
  } catch {}
  return { crops: [] };
}

export async function saveBusinessSettings(settings: BusinessSettings): Promise<void> {
  const { data: existing } = await supabase.from("business_settings")
    .select("id")
    .eq("setting_key", "crops")
    .limit(1)
    .single();
  const value = JSON.stringify(settings.crops);
  if (existing) {
    await supabase.from("business_settings")
      .update({ setting_value: value, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("business_settings")
      .insert({ setting_key: "crops", setting_value: value });
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

// ─── Occurrence Management ─────────────────────────────────────────────────────

interface OccurrenceRow {
  id: string;
  config_id: string;
  customer_id: string;
  occurrence_number: number;
  stage: string | null;
  crop_name: string | null;
  occurrence_key: string;
  scheduled_date: string;
  status: string;
  tone: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  message: string | null;
  created_at: string;
}

/** Load all occurrences for a config. */
async function loadOccurrences(configId: string): Promise<OccurrenceRow[]> {
  const { data } = await supabase
    .from("reminder_occurrences")
    .select("*")
    .eq("config_id", configId)
    .order("occurrence_number");
  return ((data as OccurrenceRow[]) || []).filter(Boolean);
}

/** Get the maximum occurrence number for a config. */
async function getMaxOccurrenceNumber(configId: string): Promise<number> {
  const { data } = await supabase
    .from("reminder_occurrences")
    .select("occurrence_number")
    .eq("config_id", configId)
    .order("occurrence_number", { ascending: false })
    .limit(1)
    .single();
  return data?.occurrence_number ?? 0;
}

/** Upsert an occurrence (insert if not exists by occurrence_key). */
async function ensureOccurrence(occ: {
  config_id: string;
  customer_id: string;
  occurrence_number: number;
  stage: string | null;
  crop_name: string | null;
  occurrence_key: string;
  scheduled_date: string;
  status: string;
  tone: string;
}): Promise<OccurrenceRow> {
  // Try to get existing
  const { data: existing } = await supabase
    .from("reminder_occurrences")
    .select("*")
    .eq("occurrence_key", occ.occurrence_key)
    .single();
  if (existing) return existing as OccurrenceRow;

  // Insert via SECURITY DEFINER RPC (RLS blocks direct anon writes)
  const { data: inserted, error: insertErr } = await supabase.rpc("upsert_reminder_occurrence", { payload: {
    config_id: occ.config_id,
    customer_id: occ.customer_id,
    occurrence_number: occ.occurrence_number,
    stage: occ.stage,
    crop_name: occ.crop_name,
    occurrence_key: occ.occurrence_key,
    scheduled_date: occ.scheduled_date,
    status: occ.status,
    tone: occ.tone,
  }});
  if (insertErr) {
    throw new Error(`Failed to persist occurrence ${occ.occurrence_key}: ${insertErr.message}`);
  }
  if (!inserted) {
    throw new Error(`Occurrence insert returned no data for key ${occ.occurrence_key}`);
  }
  return inserted as OccurrenceRow;
}

// ─── Core Engine Helpers ───────────────────────────────────────────────────────

function getLatestCreditSale(sales: Sale[], customerId: string): Sale | undefined {
  const customerSales = sales
    .filter(s => s.customerId === customerId && s.paymentType !== "full" && !s.isVoided)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return customerSales[0];
}

function getNextHarvestDate(crop: CropConfig, now: Date): Date {
  const year = now.getFullYear();
  const harvest = new Date(year, crop.harvestMonth - 1, crop.harvestDay || 1);
  if (harvest <= now) harvest.setFullYear(year + 1);
  return harvest;
}

function dateToPkStr(d: Date): string {
  // Convert a Date to PK business date string
  const pkNow = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const y = pkNow.getFullYear();
  const m = String(pkNow.getMonth() + 1).padStart(2, "0");
  const day = String(pkNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Compute the base trigger date for a config (ignoring repeat/interval). */
function computeBaseTriggerDate(
  config: ReminderConfig,
  customer: Customer,
  sale: Sale | undefined,
  crop: CropConfig | undefined,
  now: Date,
): string | null {
  const todayPk = pkBusinessDate(now);

  if (config.anchor === "after_credit") {
    if (!sale) return null;
    const saleDatePk = dateToPkStr(new Date(sale.createdAt));
    return addBusinessDays(saleDatePk, config.startDays);
  }
  if (config.anchor === "after_due") {
    if (!customer.dueDate) return null;
    return addBusinessDays(customer.dueDate, config.startDays);
  }
  if (config.anchor === "before_due") {
    if (!customer.dueDate) return null;
    return addBusinessDays(customer.dueDate, -config.startDays);
  }
  if (config.anchor === "before_harvest" && crop) {
    const harvest = getNextHarvestDate(crop, now);
    const harvestPk = dateToPkStr(harvest);
    return addBusinessDays(harvestPk, -config.startDays);
  }
  return null;
}

/** Check if reminder should stop based on end conditions.
 * fulfilledCount = occurrences with status due/sent/completed (NOT scheduled).
 * Scheduled occurrences are future planned reminders and don't count toward limits.
 */
function isReminderStopped(
  config: ReminderConfig,
  outstanding: number,
  fulfilledCount: number,
  todayPk: string,
): boolean {
  // Until paid: stop when outstanding = 0
  if (outstanding <= 0) return true;
  // After X reminders: stop when enough reminders have been due/sent
  if (config.ends === "count" && fulfilledCount >= config.endsCount) return true;
  // Specific date: stop after end date
  if (config.ends === "date" && config.endsDate && todayPk > config.endsDate) return true;
  return false;
}

/** Determine tone for an escalate step based on escalation config. */
function getToneForStage(config: ReminderConfig, stageIndex: number): "gentle" | "firmer" | "final" {
  if (config.repeat !== "escalate" || !config.escalation[stageIndex]) return "gentle";
  const step = config.escalation[stageIndex];
  const toneStr = (step.tone || "").toLowerCase();
  if (toneStr.includes("final")) return "final";
  if (toneStr.includes("firmer") || toneStr.includes("hard")) return "firmer";
  return "gentle";
}

/** Generate the occurrence key — deterministic and unique. */
function makeOccurrenceKey(
  configId: string,
  occurrenceNumber: number,
  stage: string | null,
  cropName: string | null,
): string {
  let key = `${configId}_${occurrenceNumber}`;
  if (stage) key += `_${stage}`;
  if (cropName) key += `_${cropName}`;
  return key;
}

// ─── Payment Status ───────────────────────────────────────────────────────────

export function calculatePaymentStatus(customer: Customer, now: Date): PaymentStatus {
  if (customer.outstandingBalance <= 0) return "paid";
  if (!customer.dueDate) return "no_due_date";
  const todayPk = pkBusinessDate(now);
  const daysOverdue = daysBetweenPk(customer.dueDate, todayPk);
  if (daysOverdue <= 7) return "on_time";
  if (daysOverdue <= 30) return "delayed";
  return "high_risk";
}

const PAYMENT_STATUS_LABELS: Record<string, { en: string; ur: string }> = {
  on_time:      { en: "On Time",      ur: "ٹائم پر" },
  delayed:       { en: "Delayed",       ur: "تاخیر" },
  high_risk:     { en: "High Risk",     ur: "زیادہ خطرہ" },
  no_due_date:   { en: "No Due Date",   ur: "کوئی مقررہ تاریخ نہیں" },
  paid:          { en: "Paid",          ur: "ادا شدہ" },
};

export function getPaymentStatusLabel(status: PaymentStatus, isUrdu?: boolean): string {
  const labels = PAYMENT_STATUS_LABELS[status];
  if (!labels) return status;
  return isUrdu ? labels.ur : labels.en;
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

// ─── Core Engine: Occurrence Generation ───────────────────────────────────────

/**
 * For a given config, determine what occurrences should exist and create any missing ones.
 * Returns all active (non-cancelled) occurrences for this config.
 */
async function ensureOccurrencesForConfig(
  config: ReminderConfig,
  customer: Customer,
  sale: Sale | undefined,
  cropConfigs: CropConfig[],
  customerCropNames: string[],
  now: Date,
): Promise<OccurrenceRow[]> {
  const todayPk = pkBusinessDate(now);
  const existingOccurrences = await loadOccurrences(config.id);
  const activeOccurrences = existingOccurrences.filter(o => o && o.status !== "cancelled");
  // Count only occurrences for THIS specific config
  const fulfilledCount = activeOccurrences.filter(o => o.status === 'due' || o.status === 'sent' || o.status === 'completed').length;

  const stopped = isReminderStopped(config, customer.outstandingBalance, fulfilledCount, todayPk);
  // If stopped and NOT escalate, cancel future scheduled and return early.
  // For escalate, we must still create stage occurrences (they fire at different times).
  if (stopped && config.repeat !== "escalate") {
    const scheduledToCancel = activeOccurrences.filter(o => o.status === "scheduled");
    if (scheduledToCancel.length > 0) {
      await supabase
        .from("reminder_occurrences")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .in("id", scheduledToCancel.map(o => o.id));
    }
    return activeOccurrences.filter(o => o.status !== "cancelled" && o.status !== "scheduled");
  }

  // Determine what occurrences to generate based on repeat type
  const baseTriggerDate = computeBaseTriggerDate(config, customer, sale, cropConfigs[0], now);
  const maxOccNum = Math.max(0, ...activeOccurrences.map(o => o.occurrence_number));

  if (config.repeat === "once") {
    // ONE-TIME: exactly one occurrence
    if (activeOccurrences.length === 0 && baseTriggerDate) {
      const occStatus = baseTriggerDate <= todayPk ? "due" : "scheduled";
      const occ = await ensureOccurrence({
        config_id: config.id,
        customer_id: customer.id,
        occurrence_number: 1,
        stage: null,
        crop_name: null,
        occurrence_key: makeOccurrenceKey(config.id, 1, null, null),
        scheduled_date: baseTriggerDate,
        status: occStatus,
        tone: "gentle",
      });
      return [occ];
    }
    return activeOccurrences;  } else if (config.repeat === "interval") {
    // FIXED INTERVAL: generate occurrences at regular intervals
    // The schedule is deterministic: base + N * intervalN
    if (!baseTriggerDate) return activeOccurrences;

    const intervalDays = config.intervalN || 7;
    // Cap: generate enough occurrences to fill the count limit, plus some buffer
    // The fulfilled-count check will stop creation when enough have been due/sent
    const maxFutureOcc = config.ends === "count" ? Math.max(config.endsCount + 5, 10) : 30;

    const results = [...activeOccurrences].filter(Boolean);
    let occNum = maxOccNum || 0;
    while (occNum < maxFutureOcc) {
      occNum++;
      let schedDate: string;
      if (occNum === 1) {
        schedDate = baseTriggerDate;
      } else {
        schedDate = addBusinessDays(baseTriggerDate, (occNum - 1) * intervalDays);
      }

      // Stop if beyond end date
      if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;

      // Stop if beyond 90 days
      if (daysBetweenPk(todayPk, schedDate) > 90) break;

      const key = makeOccurrenceKey(config.id, occNum, null, null);
      const existing = results.find(o => o && o.occurrence_key === key);
      if (existing) {
        // Update status if scheduled date has passed
        if (existing.status === "scheduled" && schedDate <= todayPk) {
          await supabase
            .from("reminder_occurrences")
            .update({ status: "due", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          existing.status = "due";
        }

        continue;
      }

      const occStatus = schedDate <= todayPk ? "due" : "scheduled";
      const occ = await ensureOccurrence({
        config_id: config.id,
        customer_id: customer.id,
        occurrence_number: occNum,
        stage: null,
        crop_name: null,
        occurrence_key: key,
        scheduled_date: schedDate,
        status: occStatus,
        tone: "gentle",
      });
      results.push(occ);

      // After creating this occurrence, check if we've exceeded the limit
      // Count only due/sent/completed (not scheduled future occurrences)
      const fulfilledNow = results.filter(o => o && (o.status === 'due' || o.status === 'sent' || o.status === 'completed')).length;
      if (config.ends === "count" && fulfilledNow >= config.endsCount) break;
    }

    return results;

  } else if (config.repeat === "escalate") {
    // ESCALATING: one occurrence per stage (gentle → firmer → final)
    // stage.day represents days BEFORE the anchor event (e.g., 15 days before harvest)
    const stages = config.escalation.length > 0
      ? config.escalation
      : [{ label: "Gentle", tone: "gentle nudge", day: config.startDays }];

    if (!baseTriggerDate) return activeOccurrences;

    // Compute anchor date (the event itself, not offset by startDays)
    let anchorDate: string | null = null;
    if (config.anchor === "before_harvest") {
      // Use the first crop for anchor computation
      const firstCrop = cropConfigs?.find(c => customerCropNames.includes(c.name));
      if (firstCrop) {
        const harvest = getNextHarvestDate(firstCrop, now);
        anchorDate = dateToPkStr(harvest);
      }
    } else if (config.anchor === "before_due" && customer.dueDate) {
      anchorDate = customer.dueDate;
    } else if (config.anchor === "after_credit" && sale) {
      anchorDate = dateToPkStr(new Date(sale.createdAt));
    } else if (config.anchor === "after_due" && customer.dueDate) {
      anchorDate = customer.dueDate;
    }
    if (!anchorDate) return activeOccurrences;

    const results = [...activeOccurrences].filter(Boolean);

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageIndex = i;

      // For "before" anchors: stage fires at anchor - stage.day
      // For "after" anchors: stage fires at anchor + startDays + stage.day
      let schedDate: string;
      if (config.anchor.startsWith("before_")) {
        schedDate = addBusinessDays(anchorDate, -stage.day);
      } else {
        schedDate = addBusinessDays(anchorDate, config.startDays + stage.day);
      }

      // Stop if beyond end date
      if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;

      const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
      const key = makeOccurrenceKey(config.id, i + 1, stageName, null);
      const existing = results.find(o => o && o.occurrence_key === key);
      if (existing) {
        if (existing.status === "scheduled" && schedDate <= todayPk) {
          await supabase
            .from("reminder_occurrences")
            .update({ status: "due", updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          existing.status = "due";
        }
        continue;
      }

      // Stop if we'd exceed the count limit
      if (config.ends === "count" && (i + 1) > config.endsCount) break;

      const occStatus = schedDate <= todayPk ? "due" : "scheduled";
      const tone = getToneForStage(config, stageIndex);
      const occ = await ensureOccurrence({
        config_id: config.id,
        customer_id: customer.id,
        occurrence_number: i + 1,
        stage: stageName,
        crop_name: null,
        occurrence_key: key,
        scheduled_date: schedDate,
        status: occStatus,
        tone,
      });
      results.push(occ);
    }

    return results;

  } else {
    return activeOccurrences;
  }
}

/**
 * Same as ensureOccurrencesForConfig but for harvest triggers with multiple crops.
 */
async function ensureOccurrencesForHarvest(
  config: ReminderConfig,
  customer: Customer,
  cropConfigs: CropConfig[],
  customerCropNames: string[],
  now: Date,
): Promise<OccurrenceRow[]> {
  const todayPk = pkBusinessDate(now);
  const existingOccurrences = await loadOccurrences(config.id);
  const activeOccurrences = existingOccurrences.filter(o => o && o.status !== "cancelled");

  const harvestFulfilledCount = activeOccurrences.filter(o => o.status === 'due' || o.status === 'sent' || o.status === 'completed').length;
  const harvestStopped = isReminderStopped(config, customer.outstandingBalance, harvestFulfilledCount, todayPk);
  if (harvestStopped && config.repeat !== "escalate") {
    const scheduledToCancel = activeOccurrences.filter(o => o.status === "scheduled");
    if (scheduledToCancel.length > 0) {
      await supabase
        .from("reminder_occurrences")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .in("id", scheduledToCancel.map(o => o.id));
    }
    return activeOccurrences.filter(o => o.status !== "cancelled" && o.status !== "scheduled");
  }

  const results = [...activeOccurrences].filter(Boolean);

  for (const cropName of customerCropNames) {
    const crop = cropConfigs.find(c => c.name === cropName);
    if (!crop) continue;

    const baseTriggerDate = computeBaseTriggerDate(config, customer, undefined, crop, now);
    if (!baseTriggerDate) continue;

    if (config.repeat === "once") {
      const key = makeOccurrenceKey(config.id, 1, null, cropName);
      const existing = results.find(o => o && o.occurrence_key === key);
      if (!existing) {
        const occStatus = baseTriggerDate <= todayPk ? "due" : "scheduled";
        const occ = await ensureOccurrence({
          config_id: config.id,
          customer_id: customer.id,
          occurrence_number: 1,
          stage: null,
          crop_name: cropName,
          occurrence_key: key,
          scheduled_date: baseTriggerDate,
          status: occStatus,
          tone: "gentle",
        });
        results.push(occ);
      }
    } else if (config.repeat === "interval") {
      const intervalDays = config.intervalN || 7;
      const maxOccNumForCrop = Math.max(0, ...results.filter(o => o.crop_name === cropName).map(o => o.occurrence_number));
      let occNum = maxOccNumForCrop || 0;

      const maxFutureOccHarvest = config.ends === "count" ? Math.max(config.endsCount + 5, 10) : 30;
      while (occNum < maxFutureOccHarvest) {
        occNum++;
        const schedDate = occNum === 1 ? baseTriggerDate : addBusinessDays(baseTriggerDate, (occNum - 1) * intervalDays);
        if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
        if (config.ends === "count" && occNum > config.endsCount) break;

        const key = makeOccurrenceKey(config.id, occNum, null, cropName);
        const existing = results.find(o => o && o.occurrence_key === key);
        if (existing) {
          if (existing.status === "scheduled" && schedDate <= todayPk) {
            await supabase.rpc("update_reminder_occurrence_status", { payload: { occurrence_id: existing.id, status: "due" } });
            existing.status = "due";
          }
          continue;
        }

        const occStatus = schedDate <= todayPk ? "due" : "scheduled";
        const occ = await ensureOccurrence({
          config_id: config.id,
          customer_id: customer.id,
          occurrence_number: occNum,
          stage: null,
          crop_name: cropName,
          occurrence_key: key,
          scheduled_date: schedDate,
          status: occStatus,
          tone: "gentle",
        });
        results.push(occ);
        if (daysBetweenPk(todayPk, schedDate) > 90) break;
        const harvestFulfilledNow = results.filter(o => o && (o.status === 'due' || o.status === 'sent' || o.status === 'completed')).length;
        if (config.ends === "count" && harvestFulfilledNow >= config.endsCount) break;
      }
    } else if (config.repeat === "escalate") {
      const stages = config.escalation.length > 0
        ? config.escalation
        : [{ label: "Gentle", tone: "gentle nudge", day: config.startDays }];

      // Compute anchor date for harvest
      const harvestCrop = cropConfigs?.find(c => customerCropNames.includes(c.name));
      if (!harvestCrop) return results;
      const harvest = getNextHarvestDate(harvestCrop, now);
      const anchorDate = dateToPkStr(harvest);

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const schedDate = addBusinessDays(anchorDate, -stage.day);
        if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
        if (config.ends === "count" && (i + 1) > config.endsCount) break;

        const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
        const key = makeOccurrenceKey(config.id, i + 1, stageName, cropName);
        const existing = results.find(o => o && o.occurrence_key === key);
        if (existing) {
          if (existing.status === "scheduled" && schedDate <= todayPk) {
            await supabase.rpc("update_reminder_occurrence_status", { payload: { occurrence_id: existing.id, status: "due" } });
            existing.status = "due";
          }
          continue;
        }

        const occStatus = schedDate <= todayPk ? "due" : "scheduled";
        const tone = getToneForStage(config, i);
        const occ = await ensureOccurrence({
          config_id: config.id,
          customer_id: customer.id,
          occurrence_number: i + 1,
          stage: stageName,
          crop_name: cropName,
          occurrence_key: key,
          scheduled_date: schedDate,
          status: occStatus,
          tone,
        });
        results.push(occ);
      }
    }
  }

  return results;
}

// ─── Main Engine: generateReminders ───────────────────────────────────────────

interface ReminderEngineInput {
  customers: Customer[];
  sales: Sale[];
  now?: Date;
  t?: TranslateFn;
}

/**
 * Generate reminders using persistent occurrences.
 * Each call ensures occurrences exist, updates their status, and returns active ones.
 * No duplicates are created because occurrence_key is unique.
 */
export async function generateReminders(input: ReminderEngineInput): Promise<GeneratedReminder[]> {
  const { customers, sales, now: nowRef, t } = input;
  const _t = t ?? ((key: string, params?: Record<string, string | number>) => {
    let text = key;
    if (params) { for (const [k, v] of Object.entries(params)) { text = text.replace(new RegExp("\\{" + k + "\\}", "g"), String(v)); } }
    return text;
  });
  const now = nowRef ?? new Date();
  const todayPk = pkBusinessDate(now);
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

      // Ensure occurrences exist for this config
      let occurrences: OccurrenceRow[];
      if (config.anchor === "before_harvest" && customerCropNames.length > 0) {
        occurrences = await ensureOccurrencesForHarvest(
          config, customer, bizSettings.crops, customerCropNames, now,
        );
      } else {
        occurrences = await ensureOccurrencesForConfig(
          config, customer, latestSale, bizSettings.crops, customerCropNames, now,
        );
      }

      // Convert active occurrences to GeneratedReminder objects
      // Include 'scheduled' so future reminders appear in Upcoming
      for (const occ of occurrences) {
        if (occ.status !== "due" && occ.status !== "sent" && occ.status !== "scheduled") continue;

        // For "sent" occurrences, skip if already fully completed
        // (but still show in history - the UI handles this separately)

        const triggerDetail = config.anchor === "before_harvest" && occ.crop_name
          ? _t(config.startDays === 1 ? "reminders.dayBeforeHarvest" : "reminders.daysBeforeHarvest", { n: config.startDays, crop: occ.crop_name })
          : config.anchor === "after_credit"
            ? _t("reminders.daysAfterCredit", { n: config.startDays })
            : config.anchor === "after_due"
              ? _t("reminders.daysAfterDue", { n: config.startDays })
              : _t(config.startDays === 1 ? "reminders.dayBeforeDue" : "reminders.daysBeforeDue", { n: config.startDays });

        reminders.push({
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          outstanding: customer.outstandingBalance,
          dueDate: customer.dueDate,
          paymentStatus: calculatePaymentStatus(customer, now),
          configId: config.id,
          triggerDate: new Date(occ.scheduled_date + "T00:00:00+05:00").toISOString(),
          tone: (occ.tone || "gentle") as "gentle" | "firmer" | "final",
          trigger: config.anchor === "before_harvest" ? "harvest" : config.anchor === "after_credit" ? "credit" : "due_date",
          triggerDetail,
          cropName: occ.crop_name ?? undefined,
          config,
          // Attach occurrence metadata for the UI
          _occurrenceId: occ.id,
          _occurrenceKey: occ.occurrence_key,
          _occurrenceStatus: occ.status,
        } as GeneratedReminder & { _occurrenceId: string; _occurrenceKey: string; _occurrenceStatus: string });
      }
    }
  }
  return reminders;
}

// ─── Send/Mark Occurrence ─────────────────────────────────────────────────────

/** Mark an occurrence as sent. Creates a reminder_log entry. */
export async function markOccurrenceSent(
  occurrenceId: string,
  customerId: string,
  customerName: string,
  configId: string,
  tone: string,
  message: string,
  channel: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Check if this occurrence was already sent.
  // If so, skip the log insert — one occurrence = one send log.
  // The status update below is still idempotent (safe to call again).
  const { data: existingOcc } = await supabase
    .from("reminder_occurrences")
    .select("status, sent_at")
    .eq("id", occurrenceId)
    .single();

  const wasAlreadySent = existingOcc && existingOcc.status === "sent" && existingOcc.sent_at;

  // Update occurrence status via RPC (RLS blocks direct anon writes)
  await supabase.rpc("update_reminder_occurrence_status", { payload: {
    occurrence_id: occurrenceId,
    status: "sent",
    sent_at: now,
    sent_channel: channel,
    message,
  }});

  // Insert exactly one reminder_log per occurrence.
  // Skip if already sent to prevent duplicate logs from double-clicks/retries.
  if (!wasAlreadySent) {
    await supabase.from("reminder_logs").insert({
      customer_id: customerId,
      customer_name: customerName,
      config_id: configId,
      tone,
      message,
      channel,
      sent_at: now,
    });
  }
}

// ─── Message Generation ───────────────────────────────────────────────────────

export function generateReminderMessage(reminder: GeneratedReminder): string {
  const name = reminder.customerName.split(" ")[0];
  const amount = "Rs. " + Math.round(reminder.outstanding).toLocaleString("en-PK");
  if (reminder.tone === "gentle") return "Hello " + name + ", this is a friendly reminder that " + amount + " is currently outstanding on your account. Please arrange payment when convenient.";
  if (reminder.tone === "firmer") return "Hello " + name + ", " + amount + " remains outstanding on your account. Please arrange payment at your earliest convenience.";
  return "Hello " + name + ", " + amount + " remains outstanding on your account. Please contact us regarding settlement. Do not ignore this message.";
}

// ─── Categorization ───────────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function categorizeReminders(
  reminders: GeneratedReminder[],
  sentConfigIds: Set<string>,
  now: Date,
): { ready: GeneratedReminder[]; future: GeneratedReminder[] } {
  const ready: GeneratedReminder[] = [];
  const future: GeneratedReminder[] = [];
  const todayPk = pkBusinessDate(now);

  for (const r of reminders) {
    // Use occurrence key instead of customerId for dedup
    const occKey = (r as any)._occurrenceKey || r.configId;
    const occStatus = (r as any)._occurrenceStatus;

    // Already sent occurrences don't appear in ready/future
    if (occStatus === "sent") continue;

    // Check against the occurrence key for dedup
    if (sentConfigIds.has(occKey)) continue;

    const triggerDay = pkDateFromISO(r.triggerDate);
    if (triggerDay > todayPk) {
      future.push(r);
    } else {
      ready.push(r);
    }
  }
  return { ready, future };
}
