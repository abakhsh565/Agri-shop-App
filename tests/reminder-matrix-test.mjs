/**
 * 36-Combination Reminder Engine Matrix Test
 * Uses Supabase REST API to verify all trigger × repeat × end combinations.
 * 
 * Current date: 2026-09-05 (Pakistan time)
 * 
 * Test data:
 * AC Customer: after_credit, outstanding=40000, dueDate=null, credit sale date=2026-09-05
 * BD Customer: before_due/after_due, outstanding=30000, dueDate=2026-09-25
 * BH Customer: before_harvest, outstanding=20000, dueDate=2026-09-25, Cotton(Sept 15), Maize(Oct 1)
 */

const SUPABASE_URL = "https://gkswcfljxlutkfdvvqng.supabase.co";
const SUPABASE_KEY = "sb_publishable_8YFs0RuSeAkISC3oqj-aUg_uNnSosxG";

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function supabaseQuery(table, select = "*", filters = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;
  for (const [k, v] of Object.entries(filters)) {
    url += `&${k}=${encodeURIComponent(v)}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Query failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function supabaseInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Insert failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function supabaseDelete(table, filters) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = [];
  for (const [k, v] of Object.entries(filters)) {
    params.push(`${k}=eq.${encodeURIComponent(v)}`);
  }
  if (params.length) url += `?${params.join("&")}`;
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Delete failed: ${res.status} ${body}`);
  }
  return res.status;
}

// ---- Helper: date calculations matching the engine ----

function pkBusinessDate(date) {
  // Convert to Pakistan time (UTC+5)
  const pkDate = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return `${pkDate.getUTCFullYear()}-${String(pkDate.getUTCMonth() + 1).padStart(2, "0")}-${String(pkDate.getUTCDate()).padStart(2, "0")}`;
}

function dateToPkStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function addBusinessDays(dateStr, days) {
  const parts = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return dateToPkStr(d);
}

function daysBetweenPk(a, b) {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  const da = new Date(Date.UTC(pa[0], pa[1] - 1, pa[2]));
  const db = new Date(Date.UTC(pb[0], pb[1] - 1, pb[2]));
  return Math.round((db.getTime() - da.getTime()) / (86400 * 1000));
}

function getNextHarvestDate(crop, now) {
  const today = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const year = today.getUTCFullYear();
  let harvest = new Date(Date.UTC(year, crop.harvestMonth - 1, crop.harvestDay));
  if (harvest < today) {
    harvest = new Date(Date.UTC(year + 1, crop.harvestMonth - 1, crop.harvestDay));
  }
  return harvest;
}

function computeBaseTriggerDate(anchor, startDays, dueDate, creditSaleDate, crop) {
  if (anchor === "after_credit" && creditSaleDate) {
    return addBusinessDays(dateToPkStr(new Date(creditSaleDate)), startDays);
  }
  if (anchor === "after_due" && dueDate) {
    return addBusinessDays(dueDate, startDays);
  }
  if (anchor === "before_due" && dueDate) {
    return addBusinessDays(dueDate, -startDays);
  }
  if (anchor === "before_harvest" && crop) {
    const harvest = getNextHarvestDate(crop, new Date());
    return addBusinessDays(dateToPkStr(harvest), -startDays);
  }
  return null;
}

function makeOccurrenceKey(configId, occNum, stage, cropName) {
  let key = `${configId}_${occNum}`;
  if (stage) key += `_${stage}`;
  if (cropName) key += `_${cropName}`;
  return key;
}

// ---- Simulate the engine for a single config ----

function simulateEngine(config, customer, creditSaleDate, crops) {
  const now = new Date();
  const todayPk = pkBusinessDate(now);
  const occurrences = [];
  const { id: configId, anchor, repeat_type, interval_n, starts_days, ends, ends_count, ends_date, escalation } = config;

  // For harvest anchor, get the applicable crops
  const cropList = crops || [];

  if (anchor === "before_harvest" && cropList.length > 0) {
    // Harvest path - per crop
    for (const crop of cropList) {
      const baseTrigger = computeBaseTriggerDate(anchor, config.start_days, customer.due_date, creditSaleDate, crop);
      if (!baseTrigger) continue;

      if (repeat_type === "once") {
        const status = baseTrigger <= todayPk ? "due" : "scheduled";
        occurrences.push({
          key: makeOccurrenceKey(configId, 1, null, crop.name),
          scheduled_date: baseTrigger,
          status,
          crop_name: crop.name,
          stage: null,
          occNum: 1
        });
      } else if (repeat_type === "interval") {
        const interval = interval_n || 7;
        const maxOcc = ends === "count" ? Math.max(ends_count + 5, 10) : 30;
        let occNum = 0;
        while (occNum < maxOcc) {
          occNum++;
          const schedDate = occNum === 1 ? baseTrigger : addBusinessDays(baseTrigger, (occNum - 1) * interval);
          if (ends === "date" && ends_date && schedDate > ends_date) break;
          if (ends === "count" && occNum > ends_count) break;
          if (daysBetweenPk(todayPk, schedDate) > 90) break;
          const status = schedDate <= todayPk ? "due" : "scheduled";
          occurrences.push({
            key: makeOccurrenceKey(configId, occNum, null, crop.name),
            scheduled_date: schedDate,
            status,
            crop_name: crop.name,
            stage: null,
            occNum
          });
        }
      } else if (repeat_type === "escalate") {
        const stages = escalation?.length > 0
          ? escalation
          : [{ label: "Gentle", tone: "gentle nudge", day: config.start_days }];
        const harvest = getNextHarvestDate(crop, now);
        const anchorDate = dateToPkStr(harvest);
        
        for (let i = 0; i < stages.length; i++) {
          const stage = stages[i];
          if (ends === "count" && (i + 1) > ends_count) break;
          const schedDate = addBusinessDays(anchorDate, -stage.day);
          if (ends === "date" && ends_date && schedDate > ends_date) break;
          const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
          const status = schedDate <= todayPk ? "due" : "scheduled";
          occurrences.push({
            key: makeOccurrenceKey(configId, i + 1, stageName, crop.name),
            scheduled_date: schedDate,
            status,
            crop_name: crop.name,
            stage: stageName,
            occNum: i + 1
          });
        }
      }
    }
  } else {
    // Non-harvest path
    const baseTrigger = computeBaseTriggerDate(anchor, config.start_days, customer.due_date, creditSaleDate, null);
    if (!baseTrigger) return occurrences;

    if (repeat_type === "once") {
      const status = baseTrigger <= todayPk ? "due" : "scheduled";
      occurrences.push({
        key: makeOccurrenceKey(configId, 1, null, null),
        scheduled_date: baseTrigger,
        status,
        crop_name: null,
        stage: null,
        occNum: 1
      });
    } else if (repeat_type === "interval") {
      const interval = interval_n || 7;
      const maxOcc = ends === "count" ? Math.max(ends_count + 5, 10) : 30;
      let occNum = 0;
      while (occNum < maxOcc) {
        occNum++;
        const schedDate = occNum === 1 ? baseTrigger : addBusinessDays(baseTrigger, (occNum - 1) * interval);
        if (ends === "date" && ends_date && schedDate > ends_date) break;
        if (ends === "count" && occNum > ends_count) break;
        if (daysBetweenPk(todayPk, schedDate) > 90) break;
        const status = schedDate <= todayPk ? "due" : "scheduled";
        occurrences.push({
          key: makeOccurrenceKey(configId, occNum, null, null),
          scheduled_date: schedDate,
          status,
          crop_name: null,
          stage: null,
          occNum
        });
      }
    } else if (repeat_type === "escalate") {
      const stages = escalation?.length > 0
        ? escalation
        : [{ label: "Gentle", tone: "gentle nudge", day: config.start_days }];
      
      let anchorDate = null;
      if (anchor === "before_due" && customer.due_date) anchorDate = customer.due_date;
      else if (anchor === "after_credit" && creditSaleDate) anchorDate = dateToPkStr(new Date(creditSaleDate));
      else if (anchor === "after_due" && customer.due_date) anchorDate = customer.due_date;
      
      if (!anchorDate) return occurrences;

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (ends === "count" && (i + 1) > ends_count) break;
        let schedDate;
        if (anchor.startsWith("before_")) {
          schedDate = addBusinessDays(anchorDate, -stage.day);
        } else {
          schedDate = addBusinessDays(anchorDate, (config.start_days || 1) + stage.day);
        }
        if (ends === "date" && ends_date && schedDate > ends_date) break;
        const stageName = (stage.label || stage.tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
        const status = schedDate <= todayPk ? "due" : "scheduled";
        occurrences.push({
          key: makeOccurrenceKey(configId, i + 1, stageName, null),
          scheduled_date: schedDate,
          status,
          crop_name: null,
          stage: stageName,
          occNum: i + 1
        });
      }
    }
  }

  return occurrences;
}

// ---- Main test runner ----

async function main() {
  const todayPk = pkBusinessDate(new Date());
  console.log(`\n=== REMINDER ENGINE 36-COMBINATION MATRIX ===`);
  console.log(`Current PK date: ${todayPk}\n`);

  // Fetch configs
  const configs = await supabaseQuery("reminder_configs", "id,customer_id,anchor,repeat_type,start_days,interval_n,interval_unit,escalation,ends,ends_count,ends_date", { enabled: "eq.true" });
  console.log(`Total configs: ${configs.length}`);

  // Customer data
  const customers = {
    "0f8e846f-7d49-4ef5-acb9-d6f7173d384b": { name: "Matrix AC", due_date: null, outstanding_balance: 40000 },
    "b68c20b8-b2d2-4571-b611-40d6c1fffe23": { name: "Matrix BD", due_date: "2026-09-25", outstanding_balance: 30000 },
    "175b4005-f14c-4d21-a60e-bd4e548794ad": { name: "Matrix BH", due_date: "2026-09-25", outstanding_balance: 20000 },
  };
  
  const creditSaleDate = "2026-09-05T12:50:33.82179+00:00";
  const bhCrops = [
    { name: "Cotton", harvestMonth: 9, harvestDay: 15 },
    { name: "Maize", harvestMonth: 10, harvestDay: 1 },
  ];

  // Fetch actual DB occurrences
  const dbOccurrences = await supabaseQuery("reminder_occurrences", "id,config_id,occurrence_key,status,scheduled_date,stage,crop_name,occurrence_number,tone");

  const results = [];
  let pass = 0, fail = 0, partial = 0;

  for (const config of configs) {
    const customer = customers[config.customer_id];
    if (!customer) {
      results.push({ config: config.id.substring(0,8), anchor: config.anchor, repeat: config.repeat_type, ends: config.ends, result: "SKIP - unknown customer" });
      continue;
    }

    const expected = simulateEngine(config, customer, creditSaleDate, bhCrops);
    const actual = dbOccurrences.filter(o => o.config_id === config.id);
    
    // Compare
    const expectedKeys = new Set(expected.map(o => o.key));
    const actualKeys = new Set(actual.map(o => o.occurrence_key));
    
    const missingFromDB = expected.filter(e => !actualKeys.has(e.key));
    const extraInDB = actual.filter(a => !expectedKeys.has(a.occurrence_key));
    
    let result;
    let evidence = "";
    
    if (missingFromDB.length === 0 && extraInDB.length === 0) {
      // Check statuses match
      let statusMismatches = 0;
      for (const exp of expected) {
        const act = actual.find(a => a.occurrence_key === exp.key);
        if (act && act.status !== exp.status) statusMismatches++;
      }
      
      if (statusMismatches === 0) {
        result = "✅ PASS";
        pass++;
        evidence = `${expected.length} occurrences, all match`;
      } else {
        result = "⚠️ PARTIAL";
        partial++;
        evidence = `${expected.length} occurrences created, ${statusMismatches} status mismatches`;
      }
    } else if (missingFromDB.length > 0 && extraInDB.length === 0) {
      result = "❌ FAIL - missing";
      fail++;
      evidence = `Missing: ${missingFromDB.map(m => m.key + " (" + m.scheduled_date + ")").join(", ")}`;
    } else {
      result = "⚠️ PARTIAL";
      partial++;
      evidence = `Missing: ${missingFromDB.length}, Extra: ${extraInDB.length}`;
    }

    results.push({
      config: config.id.substring(0, 8),
      anchor: config.anchor,
      repeat: config.repeat_type,
      ends: config.ends,
      endsCount: config.ends_count,
      expected: expected.length,
      actual: actual.length,
      result,
      evidence,
      firstDate: expected[0]?.scheduled_date,
      lastDate: expected[expected.length - 1]?.scheduled_date
    });
  }

  // Print table
  console.log(`\n| # | Config | Anchor | Repeat | Ends | Count | Expected | Actual | Result |`);
  console.log(`|---|--------|--------|--------|------|-------|----------|--------|--------|`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`| ${i+1} | ${r.config} | ${r.anchor} | ${r.repeat} | ${r.ends} | ${r.endsCount || "-"} | ${r.expected} | ${r.actual} | ${r.result} |`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`PASS: ${pass}  |  PARTIAL: ${partial}  |  FAIL: ${fail}  |  Total: ${results.length}`);
  
  // Print failures in detail
  if (fail > 0 || partial > 0) {
    console.log(`\n=== FAILURES/PARTIAL DETAILS ===`);
    for (const r of results) {
      if (r.result.includes("FAIL") || r.result.includes("PARTIAL")) {
        console.log(`\nConfig ${r.config} (${r.anchor} × ${r.repeat} × ${r.ends}):`);
        console.log(`  Expected: ${r.expected}  |  Actual: ${r.actual}`);
        console.log(`  Evidence: ${r.evidence}`);
      }
    }
  }
}

main().catch(console.error);
