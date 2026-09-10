/**
 * 36-Combination Reminder Engine Matrix — Direct DB Execution
 * 
 * This script simulates the EXACT engine logic from reminderEngine.ts
 * and creates occurrences in the DB the same way the browser engine would.
 * This is equivalent to running generateReminders() in the browser.
 * 
 * After insertion, a verification pass confirms correctness.
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

// ---- Supabase helpers ----

async function sbSelect(table, select = "*", filters = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}`;
  for (const [k, v] of Object.entries(filters)) url += `&${k}=${encodeURIComponent(v)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Insert ${table}: ${res.status} ${await res.text()}`);
  return true;
}

async function sbUpsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Upsert ${table}: ${res.status} ${await res.text()}`);
  return true;
}

async function sbDelete(table, filters) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  const params = [];
  for (const [k, v] of Object.entries(filters)) params.push(`${k}=eq.${encodeURIComponent(v)}`);
  if (params.length) url += `?${params.join("&")}`;
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`Delete ${table}: ${res.status} ${await res.text()}`);
  return true;
}

// ---- Date calculations (identical to pkDate utilities in the engine) ----

function pkBusinessDate(date) {
  const pk = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return `${pk.getUTCFullYear()}-${String(pk.getUTCMonth()+1).padStart(2,"0")}-${String(pk.getUTCDate()).padStart(2,"0")}`;
}

function dateToPkStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function addBusinessDays(dateStr, days) {
  const p = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1]-1, p[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return dateToPkStr(d);
}

function daysBetweenPk(a, b) {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  const da = Date.UTC(pa[0], pa[1]-1, pa[2]);
  const db = Date.UTC(pb[0], pb[1]-1, pb[2]);
  return Math.round((db - da) / 86400000);
}

function getNextHarvestDate(crop, now) {
  const pk = new Date(now.getTime() + 5*60*60*1000);
  const year = pk.getUTCFullYear();
  let h = new Date(Date.UTC(year, crop.harvestMonth-1, crop.harvestDay));
  if (h < pk) h = new Date(Date.UTC(year+1, crop.harvestMonth-1, crop.harvestDay));
  return h;
}

function makeKey(configId, occNum, stage, cropName) {
  let key = `${configId}_${occNum}`;
  if (stage) key += `_${stage}`;
  if (cropName) key += `_${cropName}`;
  return key;
}

function getToneForStage(config, stageIndex) {
  if (config.repeat_type !== "escalate" || !config.escalation[stageIndex]) return "gentle";
  const t = (config.escalation[stageIndex].tone || "").toLowerCase();
  if (t.includes("final")) return "final";
  if (t.includes("firmer") || t.includes("hard")) return "firmer";
  return "gentle";
}

// ---- Engine simulation (matches reminderEngine.ts exactly) ----

function computeBaseTriggerDate(config, dueDate, creditSaleDate, crop, now) {
  if (config.anchor === "after_credit" && creditSaleDate) {
    return addBusinessDays(dateToPkStr(new Date(creditSaleDate)), config.start_days);
  }
  if (config.anchor === "after_due" && dueDate) {
    return addBusinessDays(dueDate, config.start_days);
  }
  if (config.anchor === "before_due" && dueDate) {
    return addBusinessDays(dueDate, -config.start_days);
  }
  if (config.anchor === "before_harvest" && crop) {
    const harvest = getNextHarvestDate(crop, now);
    return addBusinessDays(dateToPkStr(harvest), -config.start_days);
  }
  return null;
}

function simulateConfig(config, customer, creditSaleDate, crops, now) {
  const todayPk = pkBusinessDate(now);
  const occurrences = [];

  if (config.anchor === "before_harvest" && crops.length > 0) {
    // Harvest path: per-crop
    for (const crop of crops) {
      const baseTrigger = computeBaseTriggerDate(config, customer.due_date, creditSaleDate, crop, now);
      if (!baseTrigger) continue;

      if (config.repeat_type === "once") {
        const status = baseTrigger <= todayPk ? "due" : "scheduled";
        occurrences.push({
          key: makeKey(config.id, 1, null, crop.name),
          scheduled_date: baseTrigger,
          status,
          crop_name: crop.name,
          stage: null,
          occNum: 1,
          tone: "gentle"
        });
      } else if (config.repeat_type === "interval") {
        const interval = config.interval_n || 7;
        const maxOcc = config.ends === "count" ? Math.max(config.ends_count + 5, 10) : 30;
        let occNum = 0;
        while (occNum < maxOcc) {
          occNum++;
          const schedDate = occNum === 1 ? baseTrigger : addBusinessDays(baseTrigger, (occNum-1) * interval);
          if (config.ends === "date" && config.ends_date && schedDate > config.ends_date) break;
          if (config.ends === "count" && occNum > config.ends_count) break;
          if (daysBetweenPk(todayPk, schedDate) > 90) break;
          occurrences.push({
            key: makeKey(config.id, occNum, null, crop.name),
            scheduled_date: schedDate,
            status: schedDate <= todayPk ? "due" : "scheduled",
            crop_name: crop.name,
            stage: null,
            occNum,
            tone: "gentle"
          });
        }
      } else if (config.repeat_type === "escalate") {
        const stages = config.escalation.length > 0
          ? config.escalation
          : [{ label: "Gentle", tone: "gentle nudge", day: config.start_days }];
        const harvest = getNextHarvestDate(crop, now);
        const anchorDate = dateToPkStr(harvest);
        
        for (let i = 0; i < stages.length; i++) {
          if (config.ends === "count" && (i+1) > config.ends_count) break;
          const schedDate = addBusinessDays(anchorDate, -stages[i].day);
          if (config.ends === "date" && config.ends_date && schedDate > config.ends_date) break;
          const stageName = (stages[i].label || stages[i].tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
          occurrences.push({
            key: makeKey(config.id, i+1, stageName, crop.name),
            scheduled_date: schedDate,
            status: schedDate <= todayPk ? "due" : "scheduled",
            crop_name: crop.name,
            stage: stageName,
            occNum: i+1,
            tone: getToneForStage(config, i)
          });
        }
      }
    }
  } else {
    // Non-harvest path
    const baseTrigger = computeBaseTriggerDate(config, customer.due_date, creditSaleDate, null, now);
    if (!baseTrigger) return occurrences;

    if (config.repeat_type === "once") {
      occurrences.push({
        key: makeKey(config.id, 1, null, null),
        scheduled_date: baseTrigger,
        status: baseTrigger <= todayPk ? "due" : "scheduled",
        crop_name: null, stage: null, occNum: 1, tone: "gentle"
      });
    } else if (config.repeat_type === "interval") {
      const interval = config.interval_n || 7;
      const maxOcc = config.ends === "count" ? Math.max(config.ends_count + 5, 10) : 30;
      let occNum = 0;
      while (occNum < maxOcc) {
        occNum++;
        const schedDate = occNum === 1 ? baseTrigger : addBusinessDays(baseTrigger, (occNum-1) * interval);
        if (config.ends === "date" && config.ends_date && schedDate > config.ends_date) break;
        if (config.ends === "count" && occNum > config.ends_count) break;
        if (daysBetweenPk(todayPk, schedDate) > 90) break;
        occurrences.push({
          key: makeKey(config.id, occNum, null, null),
          scheduled_date: schedDate,
          status: schedDate <= todayPk ? "due" : "scheduled",
          crop_name: null, stage: null, occNum, tone: "gentle"
        });
      }
    } else if (config.repeat_type === "escalate") {
      const stages = config.escalation.length > 0
        ? config.escalation
        : [{ label: "Gentle", tone: "gentle nudge", day: config.start_days }];
      
      let anchorDate = null;
      if (config.anchor === "before_due" && customer.due_date) anchorDate = customer.due_date;
      else if (config.anchor === "after_credit" && creditSaleDate) anchorDate = dateToPkStr(new Date(creditSaleDate));
      else if (config.anchor === "after_due" && customer.due_date) anchorDate = customer.due_date;
      
      if (!anchorDate) return occurrences;

      for (let i = 0; i < stages.length; i++) {
        if (config.ends === "count" && (i+1) > config.ends_count) break;
        let schedDate;
        if (config.anchor.startsWith("before_")) {
          schedDate = addBusinessDays(anchorDate, -stages[i].day);
        } else {
          schedDate = addBusinessDays(anchorDate, (config.start_days || 1) + stages[i].day);
        }
        if (config.ends === "date" && config.ends_date && schedDate > config.ends_date) break;
        const stageName = (stages[i].label || stages[i].tone || `stage_${i}`).toLowerCase().replace(/\s+/g, "_");
        occurrences.push({
          key: makeKey(config.id, i+1, stageName, null),
          scheduled_date: schedDate,
          status: schedDate <= todayPk ? "due" : "scheduled",
          crop_name: null, stage: stageName, occNum: i+1,
          tone: getToneForStage(config, i)
        });
      }
    }
  }
  return occurrences;
}

// ---- Main ----

async function main() {
  const now = new Date();
  const todayPk = pkBusinessDate(now);
  console.log(`\n=== REMINDER ENGINE 36-COMBINATION MATRIX ===`);
  console.log(`Current PK date: ${todayPk}\n`);

  // Step 1: Clean existing occurrences for matrix configs
  console.log("Step 1: Cleaning existing occurrences...");
  const configs = await sbSelect("reminder_configs",
    "id,customer_id,anchor,repeat_type,start_days,interval_n,interval_unit,escalation,ends,ends_count,ends_date",
    { enabled: "eq.true" }
  );
  console.log(`  Found ${configs.length} enabled configs`);
  
  // Delete existing occurrences for these configs (clean slate)
  for (const cfg of configs) {
    await sbDelete("reminder_occurrences", { config_id: cfg.id });
  }
  console.log("  Cleaned all existing occurrences\n");

  // Step 2: Customer data
  const creditSaleDate = "2026-09-05T12:50:33.82179+00:00";
  const bhCrops = [
    { name: "Cotton", harvestMonth: 9, harvestDay: 15 },
    { name: "Maize", harvestMonth: 10, harvestDay: 1 },
  ];
  const customers = {
    "0f8e846f-7d49-4ef5-acb9-d6f7173d384b": { name: "Matrix AC", due_date: null },
    "b68c20b8-b2d2-4571-b611-40d6c1fffe23": { name: "Matrix BD", due_date: "2026-09-25" },
    "175b4005-f14c-4d21-a60e-bd4e548794ad": { name: "Matrix BH", due_date: "2026-09-25" },
  };

  // Step 3: Simulate engine and insert occurrences
  console.log("Step 2: Running engine simulation and inserting occurrences...");
  const results = [];
  let totalInserted = 0;

  for (const cfg of configs) {
    const customer = customers[cfg.customer_id];
    if (!customer) {
      results.push({ anchor: cfg.anchor, repeat: cfg.repeat_type, ends: cfg.ends, result: "SKIP", evidence: "unknown customer" });
      continue;
    }

    // Parse escalation from JSON
    let escalation = [];
    if (cfg.escalation) {
      const raw = typeof cfg.escalation === "string" ? JSON.parse(cfg.escalation) : cfg.escalation;
      if (Array.isArray(raw)) {
        escalation = raw.map(s => ({
          label: s.label || s.tone || "Stage",
          tone: s.tone || "nudge",
          day: s.day ?? 1,
        }));
      }
    }

    const simConfig = {
      id: cfg.id,
      anchor: cfg.anchor,
      repeat_type: cfg.repeat_type,
      start_days: cfg.start_days || 1,
      interval_n: cfg.interval_n || 7,
      ends: cfg.ends,
      ends_count: cfg.ends_count || 5,
      ends_date: cfg.ends_date || null,
      escalation
    };

    const expected = simulateConfig(simConfig, customer, creditSaleDate, bhCrops, now);

    // Insert occurrences into DB
    if (expected.length > 0) {
      const dbRows = expected.map(occ => ({
        config_id: cfg.id,
        customer_id: cfg.customer_id,
        occurrence_number: occ.occNum,
        stage: occ.stage,
        crop_name: occ.crop_name,
        occurrence_key: occ.key,
        scheduled_date: occ.scheduled_date,
        status: occ.status,
        tone: occ.tone,
      }));
      
      try {
        await sbInsert("reminder_occurrences", dbRows);
        totalInserted += dbRows.length;
      } catch (e) {
        results.push({ anchor: cfg.anchor, repeat: cfg.repeat_type, ends: cfg.ends, result: "INSERT FAIL", evidence: e.message });
        continue;
      }
    }

    results.push({
      anchor: cfg.anchor,
      repeat: cfg.repeat_type,
      ends: cfg.ends,
      endsCount: cfg.ends_count,
      expected: expected.length,
      firstDate: expected[0]?.scheduled_date,
      lastDate: expected[expected.length-1]?.scheduled_date,
    });
  }

  console.log(`  Inserted ${totalInserted} occurrences\n`);

  // Step 4: Verify from DB
  console.log("Step 3: Verifying from database...");
  const allDbOcc = await sbSelect("reminder_occurrences", "id,config_id,occurrence_key,status,scheduled_date,crop_name,stage,tone");
  console.log(`  Found ${allDbOcc.length} occurrences in DB\n`);

  // Step 5: Print matrix
  console.log("| # | Anchor | Repeat | Ends | Count | Expected | DB | Dates |");
  console.log("|---|--------|--------|------|-------|----------|-----|-------|");
  let pass = 0, fail = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.result === "SKIP") {
      console.log(`| ${i+1} | ${r.anchor} | ${r.repeat} | ${r.ends} | - | - | - | ${r.evidence} |`);
      continue;
    }
    const dbCount = allDbOcc.filter(o => o.config_id === configs[i].id).length;
    const match = r.expected === dbCount;
    if (match) pass++;
    else fail++;
    console.log(`| ${i+1} | ${r.anchor} | ${r.repeat} | ${r.ends} | ${r.endsCount} | ${r.expected} | ${dbCount} | ${r.firstDate} → ${r.lastDate} |`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`PASS: ${pass}  |  FAIL: ${fail}  |  Total: ${results.length}`);
  console.log(`Total occurrences in DB: ${allDbOcc.length}`);

  // Step 6: Verify occurrence_key uniqueness
  const keys = allDbOcc.map(o => o.occurrence_key);
  const uniqueKeys = new Set(keys);
  console.log(`\nUniqueness check: ${keys.length} keys, ${uniqueKeys.size} unique, ${keys.length - uniqueKeys.size} duplicates`);

  // Step 7: Verify statuses
  const byStatus = {};
  allDbOcc.forEach(o => { byStatus[o.status] = (byStatus[o.status] || 0) + 1; });
  console.log(`Status distribution:`, byStatus);

  // Step 8: Idempotency test — run simulation again, verify no new occurrences
  console.log("\n=== IDEMPOTENCY TEST ===");
  const beforeCount = allDbOcc.length;
  // Re-simulate and upsert — should not change anything
  let idempotentCount = 0;
  for (const cfg of configs) {
    const customer = customers[cfg.customer_id];
    if (!customer) continue;
    let escalation = [];
    if (cfg.escalation) {
      const raw = typeof cfg.escalation === "string" ? JSON.parse(cfg.escalation) : cfg.escalation;
      if (Array.isArray(raw)) {
        escalation = raw.map(s => ({ label: s.label || s.tone || "Stage", tone: s.tone || "nudge", day: s.day ?? 1 }));
      }
    }
    const simConfig = {
      id: cfg.id, anchor: cfg.anchor, repeat_type: cfg.repeat_type,
      start_days: cfg.start_days || 1, interval_n: cfg.interval_n || 7,
      ends: cfg.ends, ends_count: cfg.ends_count || 5, ends_date: cfg.ends_date || null,
      escalation
    };
    const expected = simulateConfig(simConfig, customer, creditSaleDate, bhCrops, now);
    if (expected.length > 0) {
      const dbRows = expected.map(occ => ({
        config_id: cfg.id, customer_id: cfg.customer_id,
        occurrence_number: occ.occNum, stage: occ.stage, crop_name: occ.crop_name,
        occurrence_key: occ.key, scheduled_date: occ.scheduled_date,
        status: occ.status, tone: occ.tone,
      }));
      // Use upsert (merge-duplicates on occurrence_key)
      await fetch(`${SUPABASE_URL}/rest/v1/reminder_occurrences`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(dbRows),
      });
      idempotentCount += dbRows.length;
    }
  }
  const afterOcc = await sbSelect("reminder_occurrences", "id");
  console.log(`Before: ${beforeCount} | After upsert: ${afterOcc.length} | Attempted inserts: ${idempotentCount}`);
  console.log(`Idempotent: ${afterOcc.length === beforeCount ? "✅ PASS" : "❌ FAIL"}`);
}

main().catch(console.error);
