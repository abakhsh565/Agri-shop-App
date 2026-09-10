// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = "https://gkswcfljxlutkfdvvqng.supabase.co";
var supabaseAnonKey = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";
var supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
});

// src/lib/pkDate.ts
var PKT = "Asia/Karachi";
function pkDate(date) {
  return date.toLocaleDateString("en-CA", { timeZone: PKT });
}
function pkDateFromISO(isoStr) {
  return pkDate(new Date(isoStr));
}

// src/lib/reminderEngine.ts
function pkBusinessDate(now) {
  return pkDate(now ?? /* @__PURE__ */ new Date());
}
function addBusinessDays(dateStr, days) {
  const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00+05:00");
  d.setDate(d.getDate() + days);
  return pkBusinessDate(d);
}
function daysBetweenPk(date1Str, date2Str) {
  const d1 = /* @__PURE__ */ new Date(date1Str + "T00:00:00+05:00");
  const d2 = /* @__PURE__ */ new Date(date2Str + "T00:00:00+05:00");
  return Math.floor((d2.getTime() - d1.getTime()) / 864e5);
}
async function loadReminderConfigs(customerId) {
  try {
    const { data } = await supabase.from("reminder_configs").select("*").eq("customer_id", customerId).order("created_at");
    if (!data) return [];
    return data.map((row) => ({
      id: row.id,
      enabled: row.enabled ?? true,
      startDays: row.start_days ?? 1,
      anchor: row.anchor,
      repeat: row.repeat_type,
      intervalN: row.interval_n ?? 7,
      intervalUnit: row.interval_unit,
      escalation: (() => {
        const raw = typeof row.escalation === "string" ? JSON.parse(row.escalation) : row.escalation ?? [];
        return Array.isArray(raw) ? raw.map((s) => ({
          label: s.label || s.tone || "Stage",
          tone: s.tone || "nudge",
          day: s.day ?? 1
        })) : [];
      })(),
      ends: row.ends,
      endsDate: row.ends_date ?? null,
      endsCount: row.ends_count ?? 5,
      groupId: row.group_id ?? null,
      groupName: row.group_name ?? null
    }));
  } catch {
    return [];
  }
}
async function saveReminderConfig(customerId, config) {
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
    group_id: config.groupId ?? null,
    group_name: config.groupName ?? null,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (config.id && config.id.length > 0 && !config.id.startsWith("new-")) {
    await supabase.from("reminder_configs").update(payload).eq("id", config.id);
    await supabase.from("reminder_occurrences").update({ status: "cancelled", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("config_id", config.id).eq("status", "scheduled");
  } else {
    const { id: _id, ...insertPayload } = { ...payload, id: void 0 };
    const { data } = await supabase.from("reminder_configs").insert(insertPayload).select("id").single();
  }
}
async function deleteReminderConfig(configId) {
  await supabase.from("reminder_occurrences").delete().eq("config_id", configId);
  await supabase.from("reminder_configs").delete().eq("id", configId);
}
async function loadReminderGroups() {
  try {
    const { data } = await supabase.from("reminder_configs").select("group_id, group_name, customer_id, anchor, start_days, repeat_type, interval_n, interval_unit, ends, created_at").not("group_id", "is", null);
    if (!data || data.length === 0) return [];
    const customerIds = [...new Set(data.map((r) => r.customer_id))];
    const { data: custRows } = await supabase.from("customers").select("id, name, outstanding_balance, due_date").in("id", customerIds);
    const custMap = /* @__PURE__ */ new Map();
    (custRows || []).forEach((c) => custMap.set(c.id, c));
    const groupMap = /* @__PURE__ */ new Map();
    for (const row of data) {
      const gId = row.group_id;
      if (!groupMap.has(gId)) {
        groupMap.set(gId, {
          name: row.group_name || "Unnamed Group",
          customerIds: /* @__PURE__ */ new Set(),
          config: {
            triggerType: row.anchor || "before_due",
            startDays: row.start_days || 3,
            repeatType: row.repeat_type || "once",
            intervalN: row.interval_n,
            intervalUnit: row.interval_unit,
            ends: row.ends
          },
          createdAt: row.created_at || ""
        });
      }
      groupMap.get(gId).customerIds.add(row.customer_id);
    }
    return Array.from(groupMap.entries()).map(([id, g]) => ({
      id,
      name: g.name,
      createdAt: g.createdAt,
      customerCount: g.customerIds.size,
      customers: Array.from(g.customerIds).map((cId) => {
        const c = custMap.get(cId);
        return {
          id: cId,
          name: c?.name || "Unknown",
          outstandingBalance: c?.outstanding_balance || 0,
          dueDate: c?.due_date || null
        };
      }),
      config: g.config
    }));
  } catch {
    return [];
  }
}
async function saveReminderGroup(config, customerIds, groupName) {
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
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  await supabase.from("reminder_configs").delete().eq("group_id", groupId);
  const rows = customerIds.map((customerId) => ({
    ...configTemplate,
    customer_id: customerId
  }));
  await supabase.from("reminder_configs").insert(rows);
}
async function deleteReminderGroup(groupId) {
  const { data: configs } = await supabase.from("reminder_configs").select("id").eq("group_id", groupId);
  if (configs && configs.length > 0) {
    const configIds = configs.map((c) => c.id);
    await supabase.from("reminder_occurrences").delete().in("config_id", configIds);
  }
  await supabase.from("reminder_configs").delete().eq("group_id", groupId);
}
function isDuplicateGroupReminder(newConfig, existingConfigs, newGroupName) {
  return existingConfigs.some((existing) => {
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
function isDuplicateReminder(newConfig, existingConfigs) {
  return existingConfigs.some((existing) => {
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
async function loadCustomerCrops(customerId) {
  try {
    const { data } = await supabase.from("customer_crops").select("crop_name").eq("customer_id", customerId);
    if (!data) return [];
    return data.map((r) => r.crop_name);
  } catch {
    return [];
  }
}
async function saveCustomerCrops(customerId, crops) {
  await supabase.from("customer_crops").delete().eq("customer_id", customerId);
  if (crops.length > 0) {
    await supabase.from("customer_crops").insert(
      crops.map((name) => ({ customer_id: customerId, crop_name: name }))
    );
  }
}
async function loadBusinessSettings() {
  try {
    const { data } = await supabase.from("business_settings").select("crops").limit(1).single();
    if (data?.crops) return { crops: typeof data.crops === "string" ? JSON.parse(data.crops) : data.crops };
  } catch {
  }
  return { crops: [] };
}
async function saveBusinessSettings(settings) {
  const { data: existing } = await supabase.from("business_settings").select("id").limit(1).single();
  if (existing) {
    await supabase.from("business_settings").update({ crops: settings.crops, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existing.id);
  } else {
    await supabase.from("business_settings").insert({ crops: settings.crops });
  }
}
async function loadReminderLogs(customerId) {
  try {
    let query = supabase.from("reminder_logs").select("*").order("sent_at", { ascending: false });
    if (customerId) query = query.eq("customer_id", customerId);
    const { data } = await query.limit(200);
    if (!data) return [];
    return data.map((r) => ({
      id: r.id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      configId: r.config_id,
      tone: r.tone,
      message: r.message,
      channel: r.channel,
      sentAt: r.sent_at
    }));
  } catch {
    return [];
  }
}
async function logReminder(customerId, customerName, configId, tone, message, channel) {
  await supabase.from("reminder_logs").insert({
    customer_id: customerId,
    customer_name: customerName,
    config_id: configId,
    tone,
    message,
    channel,
    sent_at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
async function loadOccurrences(configId) {
  const { data } = await supabase.from("reminder_occurrences").select("*").eq("config_id", configId).order("occurrence_number");
  return (data || []).filter(Boolean);
}
async function ensureOccurrence(occ) {
  const { data: existing } = await supabase.from("reminder_occurrences").select("*").eq("occurrence_key", occ.occurrence_key).single();
  if (existing) return existing;
  const { data: inserted, error: insertErr } = await supabase.from("reminder_occurrences").insert({
    config_id: occ.config_id,
    customer_id: occ.customer_id,
    occurrence_number: occ.occurrence_number,
    stage: occ.stage,
    crop_name: occ.crop_name,
    occurrence_key: occ.occurrence_key,
    scheduled_date: occ.scheduled_date,
    status: occ.status,
    tone: occ.tone
  }).select().single();
  if (insertErr) {
    throw new Error(`Failed to persist occurrence ${occ.occurrence_key}: ${insertErr.message}`);
  }
  if (!inserted) {
    throw new Error(`Occurrence insert returned no data for key ${occ.occurrence_key}`);
  }
  return inserted;
}
function getLatestCreditSale(sales, customerId) {
  const customerSales = sales.filter((s) => s.customerId === customerId && s.paymentType !== "full" && !s.isVoided).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return customerSales[0];
}
function getNextHarvestDate(crop, now) {
  const year = now.getFullYear();
  const harvest = new Date(year, crop.harvestMonth - 1, crop.harvestDay || 1);
  if (harvest <= now) harvest.setFullYear(year + 1);
  return harvest;
}
function dateToPkStr(d) {
  const pkNow = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  const y = pkNow.getFullYear();
  const m = String(pkNow.getMonth() + 1).padStart(2, "0");
  const day = String(pkNow.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function computeBaseTriggerDate(config, customer, sale, crop, now) {
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
function isReminderStopped(config, outstanding, fulfilledCount, todayPk) {
  if (outstanding <= 0) return true;
  if (config.ends === "count" && fulfilledCount >= config.endsCount) return true;
  if (config.ends === "date" && config.endsDate && todayPk > config.endsDate) return true;
  return false;
}
function getToneForStage(config, stageIndex) {
  if (config.repeat !== "escalate" || !config.escalation[stageIndex]) return "gentle";
  const step = config.escalation[stageIndex];
  const toneStr = (step.tone || "").toLowerCase();
  if (toneStr.includes("final")) return "final";
  if (toneStr.includes("firmer") || toneStr.includes("hard")) return "firmer";
  return "gentle";
}
function makeOccurrenceKey(configId, occurrenceNumber, stage, cropName) {
  let key = `${configId}_${occurrenceNumber}`;
  if (stage) key += `_${stage}`;
  if (cropName) key += `_${cropName}`;
  return key;
}
function calculatePaymentStatus(customer, now) {
  if (customer.outstandingBalance <= 0) return "paid";
  if (!customer.dueDate) return "no_due_date";
  const todayPk = pkBusinessDate(now);
  const daysOverdue = daysBetweenPk(customer.dueDate, todayPk);
  if (daysOverdue <= 7) return "on_time";
  if (daysOverdue <= 30) return "delayed";
  return "high_risk";
}
var PAYMENT_STATUS_LABELS = {
  on_time: { en: "On Time", ur: "\u0679\u0627\u0626\u0645 \u067E\u0631" },
  delayed: { en: "Delayed", ur: "\u062A\u0627\u062E\u06CC\u0631" },
  high_risk: { en: "High Risk", ur: "\u0632\u06CC\u0627\u062F\u06C1 \u062E\u0637\u0631\u06C1" },
  no_due_date: { en: "No Due Date", ur: "\u06A9\u0648\u0626\u06CC \u0645\u0642\u0631\u0631\u06C1 \u062A\u0627\u0631\u06CC\u062E \u0646\u06C1\u06CC\u06BA" },
  paid: { en: "Paid", ur: "\u0627\u062F\u0627 \u0634\u062F\u06C1" }
};
function getPaymentStatusLabel(status, isUrdu) {
  const labels = PAYMENT_STATUS_LABELS[status];
  if (!labels) return status;
  return isUrdu ? labels.ur : labels.en;
}
function getPaymentStatusColor(status) {
  switch (status) {
    case "on_time":
      return { color: "#3B6D11", bg: "#E3F3D9" };
    case "delayed":
      return { color: "#92400e", bg: "#FEF3C7" };
    case "high_risk":
      return { color: "#A32D2D", bg: "#FCEBEB" };
    case "no_due_date":
      return { color: "#5A5A55", bg: "#F1EFE8" };
    case "paid":
      return { color: "#3B6D11", bg: "#E3F3D9" };
  }
}
async function ensureOccurrencesForConfig(config, customer, sale, cropConfigs, customerCropNames, now) {
  const todayPk = pkBusinessDate(now);
  const existingOccurrences = await loadOccurrences(config.id);
  const activeOccurrences = existingOccurrences.filter((o) => o && o.status !== "cancelled");
  const fulfilledCount = activeOccurrences.filter((o) => o.status === "due" || o.status === "sent" || o.status === "completed").length;
  const stopped = isReminderStopped(config, customer.outstandingBalance, fulfilledCount, todayPk);
  if (stopped && config.repeat !== "escalate") {
    const scheduledToCancel = activeOccurrences.filter((o) => o.status === "scheduled");
    if (scheduledToCancel.length > 0) {
      await supabase.from("reminder_occurrences").update({ status: "cancelled", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).in("id", scheduledToCancel.map((o) => o.id));
    }
    return activeOccurrences.filter((o) => o.status !== "cancelled" && o.status !== "scheduled");
  }
  const baseTriggerDate = computeBaseTriggerDate(config, customer, sale, cropConfigs[0], now);
  const maxOccNum = Math.max(0, ...activeOccurrences.map((o) => o.occurrence_number));
  if (config.repeat === "once") {
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
        tone: "gentle"
      });
      return [occ];
    }
    return activeOccurrences;
  } else if (config.repeat === "interval") {
    if (!baseTriggerDate) return activeOccurrences;
    const intervalDays = config.intervalN || 7;
    const maxFutureOcc = config.ends === "count" ? Math.max(config.endsCount + 5, 10) : 30;
    const results = [...activeOccurrences].filter(Boolean);
    let occNum = maxOccNum || 0;
    while (occNum < maxFutureOcc) {
      occNum++;
      let schedDate;
      if (occNum === 1) {
        schedDate = baseTriggerDate;
      } else {
        schedDate = addBusinessDays(baseTriggerDate, (occNum - 1) * intervalDays);
      }
      if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
      if (daysBetweenPk(todayPk, schedDate) > 90) break;
      const key = makeOccurrenceKey(config.id, occNum, null, null);
      const existing = results.find((o) => o && o.occurrence_key === key);
      if (existing) {
        if (existing.status === "scheduled" && schedDate <= todayPk) {
          await supabase.from("reminder_occurrences").update({ status: "due", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existing.id);
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
        tone: "gentle"
      });
      results.push(occ);
      const fulfilledNow = results.filter((o) => o && (o.status === "due" || o.status === "sent" || o.status === "completed")).length;
      if (config.ends === "count" && fulfilledNow >= config.endsCount) break;
    }
    return results;
  } else if (config.repeat === "escalate") {
    const stages = config.escalation.length > 0 ? config.escalation : [{ label: "Gentle", tone: "gentle nudge", day: config.startDays }];
    if (!baseTriggerDate) return activeOccurrences;
    let anchorDate = null;
    if (config.anchor === "before_harvest") {
      const firstCrop = cropConfigs?.find((c) => customerCropNames.includes(c.name));
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
      let schedDate;
      if (config.anchor.startsWith("before_")) {
        schedDate = addBusinessDays(anchorDate, -stage.day);
      } else {
        schedDate = addBusinessDays(anchorDate, config.startDays + stage.day);
      }
      if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
      const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
      const key = makeOccurrenceKey(config.id, i + 1, stageName, null);
      const existing = results.find((o) => o && o.occurrence_key === key);
      if (existing) {
        if (existing.status === "scheduled" && schedDate <= todayPk) {
          await supabase.from("reminder_occurrences").update({ status: "due", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existing.id);
          existing.status = "due";
        }
        continue;
      }
      if (config.ends === "count" && i + 1 > config.endsCount) break;
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
        tone
      });
      results.push(occ);
    }
    return results;
  } else {
    return activeOccurrences;
  }
}
async function ensureOccurrencesForHarvest(config, customer, cropConfigs, customerCropNames, now) {
  const todayPk = pkBusinessDate(now);
  const existingOccurrences = await loadOccurrences(config.id);
  const activeOccurrences = existingOccurrences.filter((o) => o && o.status !== "cancelled");
  const harvestFulfilledCount = activeOccurrences.filter((o) => o.status === "due" || o.status === "sent" || o.status === "completed").length;
  const harvestStopped = isReminderStopped(config, customer.outstandingBalance, harvestFulfilledCount, todayPk);
  if (harvestStopped && config.repeat !== "escalate") {
    const scheduledToCancel = activeOccurrences.filter((o) => o.status === "scheduled");
    if (scheduledToCancel.length > 0) {
      await supabase.from("reminder_occurrences").update({ status: "cancelled", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).in("id", scheduledToCancel.map((o) => o.id));
    }
    return activeOccurrences.filter((o) => o.status !== "cancelled" && o.status !== "scheduled");
  }
  const results = [...activeOccurrences].filter(Boolean);
  for (const cropName of customerCropNames) {
    const crop = cropConfigs.find((c) => c.name === cropName);
    if (!crop) continue;
    const baseTriggerDate = computeBaseTriggerDate(config, customer, void 0, crop, now);
    if (!baseTriggerDate) continue;
    if (config.repeat === "once") {
      const key = makeOccurrenceKey(config.id, 1, null, cropName);
      const existing = results.find((o) => o && o.occurrence_key === key);
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
          tone: "gentle"
        });
        results.push(occ);
      }
    } else if (config.repeat === "interval") {
      const intervalDays = config.intervalN || 7;
      const maxOccNumForCrop = Math.max(0, ...results.filter((o) => o.crop_name === cropName).map((o) => o.occurrence_number));
      let occNum = maxOccNumForCrop || 0;
      const maxFutureOccHarvest = config.ends === "count" ? Math.max(config.endsCount + 5, 10) : 30;
      while (occNum < maxFutureOccHarvest) {
        occNum++;
        const schedDate = occNum === 1 ? baseTriggerDate : addBusinessDays(baseTriggerDate, (occNum - 1) * intervalDays);
        if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
        if (config.ends === "count" && occNum > config.endsCount) break;
        const key = makeOccurrenceKey(config.id, occNum, null, cropName);
        const existing = results.find((o) => o && o.occurrence_key === key);
        if (existing) {
          if (existing.status === "scheduled" && schedDate <= todayPk) {
            await supabase.from("reminder_occurrences").update({ status: "due", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existing.id);
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
          tone: "gentle"
        });
        results.push(occ);
        if (daysBetweenPk(todayPk, schedDate) > 90) break;
        const harvestFulfilledNow = results.filter((o) => o && (o.status === "due" || o.status === "sent" || o.status === "completed")).length;
        if (config.ends === "count" && harvestFulfilledNow >= config.endsCount) break;
      }
    } else if (config.repeat === "escalate") {
      const stages = config.escalation.length > 0 ? config.escalation : [{ label: "Gentle", tone: "gentle nudge", day: config.startDays }];
      const harvestCrop = cropConfigs?.find((c) => customerCropNames.includes(c.name));
      if (!harvestCrop) return results;
      const harvest = getNextHarvestDate(harvestCrop, now);
      const anchorDate = dateToPkStr(harvest);
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const schedDate = addBusinessDays(anchorDate, -stage.day);
        if (config.ends === "date" && config.endsDate && schedDate > config.endsDate) break;
        if (config.ends === "count" && i + 1 > config.endsCount) break;
        const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
        const key = makeOccurrenceKey(config.id, i + 1, stageName, cropName);
        const existing = results.find((o) => o && o.occurrence_key === key);
        if (existing) {
          if (existing.status === "scheduled" && schedDate <= todayPk) {
            await supabase.from("reminder_occurrences").update({ status: "due", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", existing.id);
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
          tone
        });
        results.push(occ);
      }
    }
  }
  return results;
}
async function generateReminders(input) {
  const { customers, sales, now: nowRef, t } = input;
  const _t = t ?? ((key, params) => {
    let text = key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
      }
    }
    return text;
  });
  const now = nowRef ?? /* @__PURE__ */ new Date();
  const todayPk = pkBusinessDate(now);
  const reminders = [];
  const bizSettings = await loadBusinessSettings();
  for (const customer of customers) {
    if (customer.outstandingBalance <= 0) continue;
    const configs = await loadReminderConfigs(customer.id);
    if (configs.length === 0) continue;
    const customerCropNames = await loadCustomerCrops(customer.id);
    const latestSale = getLatestCreditSale(sales, customer.id);
    for (const config of configs) {
      if (!config.enabled) continue;
      let occurrences;
      if (config.anchor === "before_harvest" && customerCropNames.length > 0) {
        occurrences = await ensureOccurrencesForHarvest(
          config,
          customer,
          bizSettings.crops,
          customerCropNames,
          now
        );
      } else {
        occurrences = await ensureOccurrencesForConfig(
          config,
          customer,
          latestSale,
          bizSettings.crops,
          customerCropNames,
          now
        );
      }
      for (const occ of occurrences) {
        if (occ.status !== "due" && occ.status !== "sent" && occ.status !== "scheduled") continue;
        const triggerDetail = config.anchor === "before_harvest" && occ.crop_name ? _t(config.startDays === 1 ? "reminders.dayBeforeHarvest" : "reminders.daysBeforeHarvest", { n: config.startDays, crop: occ.crop_name }) : config.anchor === "after_credit" ? _t("reminders.daysAfterCredit", { n: config.startDays }) : config.anchor === "after_due" ? _t("reminders.daysAfterDue", { n: config.startDays }) : _t(config.startDays === 1 ? "reminders.dayBeforeDue" : "reminders.daysBeforeDue", { n: config.startDays });
        reminders.push({
          customerId: customer.id,
          customerName: customer.name,
          customerPhone: customer.phone,
          outstanding: customer.outstandingBalance,
          dueDate: customer.dueDate,
          paymentStatus: calculatePaymentStatus(customer, now),
          configId: config.id,
          triggerDate: (/* @__PURE__ */ new Date(occ.scheduled_date + "T00:00:00+05:00")).toISOString(),
          tone: occ.tone || "gentle",
          trigger: config.anchor === "before_harvest" ? "harvest" : config.anchor === "after_credit" ? "credit" : "due_date",
          triggerDetail,
          cropName: occ.crop_name ?? void 0,
          config,
          // Attach occurrence metadata for the UI
          _occurrenceId: occ.id,
          _occurrenceKey: occ.occurrence_key,
          _occurrenceStatus: occ.status
        });
      }
    }
  }
  return reminders;
}
async function markOccurrenceSent(occurrenceId, customerId, customerName, configId, tone, message, channel) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { data: existingOcc } = await supabase.from("reminder_occurrences").select("status, sent_at").eq("id", occurrenceId).single();
  const wasAlreadySent = existingOcc && existingOcc.status === "sent" && existingOcc.sent_at;
  await supabase.from("reminder_occurrences").update({
    status: "sent",
    sent_at: now,
    sent_channel: channel,
    message,
    updated_at: now
  }).eq("id", occurrenceId);
  if (!wasAlreadySent) {
    await supabase.from("reminder_logs").insert({
      customer_id: customerId,
      customer_name: customerName,
      config_id: configId,
      tone,
      message,
      channel,
      sent_at: now
    });
  }
}
function generateReminderMessage(reminder) {
  const name = reminder.customerName.split(" ")[0];
  const amount = "Rs. " + Math.round(reminder.outstanding).toLocaleString("en-PK");
  if (reminder.tone === "gentle") return "Hello " + name + ", this is a friendly reminder that " + amount + " is currently outstanding on your account. Please arrange payment when convenient.";
  if (reminder.tone === "firmer") return "Hello " + name + ", " + amount + " remains outstanding on your account. Please arrange payment at your earliest convenience.";
  return "Hello " + name + ", " + amount + " remains outstanding on your account. Please contact us regarding settlement. Do not ignore this message.";
}
function categorizeReminders(reminders, sentConfigIds, now) {
  const ready = [];
  const future = [];
  const todayPk = pkBusinessDate(now);
  for (const r of reminders) {
    const occKey = r._occurrenceKey || r.configId;
    const occStatus = r._occurrenceStatus;
    if (occStatus === "sent") continue;
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
export {
  calculatePaymentStatus,
  categorizeReminders,
  deleteReminderConfig,
  deleteReminderGroup,
  generateReminderMessage,
  generateReminders,
  getPaymentStatusColor,
  getPaymentStatusLabel,
  isDuplicateGroupReminder,
  isDuplicateReminder,
  loadBusinessSettings,
  loadCustomerCrops,
  loadReminderConfigs,
  loadReminderGroups,
  loadReminderLogs,
  logReminder,
  markOccurrenceSent,
  saveBusinessSettings,
  saveCustomerCrops,
  saveReminderConfig,
  saveReminderGroup
};
