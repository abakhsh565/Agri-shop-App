/**
 * selftest.mjs — the proof, and the only part of this build that is worth anything without
 * a language model.
 *
 * Run it with `npm run selftest`. It answers three questions with evidence rather than
 * intention:
 *
 *   1. **Is the permission wall real?** An employee asks for profit and is refused — twice,
 *      by two independent locks — while the owner gets the number.
 *   2. **Are the numbers real?** The assistant's totals are compared against the same rows
 *      read separately, so "the tool agrees with the data" is measured, not asserted.
 *   3. **Is anything kept?** One real question is answered through the deployed handler with
 *      every network call watched: the checks fail if answering writes a row anywhere, and
 *      they report what was read. The conversation is never written down at all, which is a
 *      stricter promise than deleting it after a day.
 *
 * The modules under test are the ones the edge function ships — `supabase/functions/assistant`,
 * imported directly and reached through the same `handle()` the app calls. It needs no API key.
 * That is deliberate: the security-critical half must be runnable on a machine with no budget,
 * because "we will test it when we have a key" is how a permission wall ships unverified.
 *
 * Every check reports PASS, FAIL or UNKNOWN. UNKNOWN is never reported as PASS — this file
 * exists precisely so that an untested claim has somewhere honest to go.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { makeClient, runTool, toolsFor, TOOLS_BY_NAME, helpTopics, money } from "../../supabase/functions/assistant/tools.mjs";
import { askDeterministic, deterministicPlan, guardMoneyTopic, verifyFigures } from "../../supabase/functions/assistant/providers.mjs";
import { handle } from "../../supabase/functions/assistant/handler.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FUNCTION_DIR = path.resolve(HERE, "..", "..", "supabase", "functions", "assistant");

const PASS = "PASS";
const FAIL = "FAIL";
const UNKNOWN = "UNKNOWN";
/** A real problem found in the app rather than in the assistant. Reported, never hidden. */
const FINDING = "FINDING";

function deriveCredentials(phone) {
  const digits = String(phone).replace(/[^0-9]/g, "");
  const e164 = digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
  return {
    e164,
    email: `user-${e164}@agrishop.auth.local`,
    password: `AgriShop-${e164}-2026!`,
  };
}

async function signIn(baseUrl, anonKey, phone) {
  const { e164, email, password } = deriveCredentials(phone);
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.msg || `sign-in failed (${res.status})`);
  return {
    phone: e164,
    userId: json.user?.id,
    token: json.access_token,
    client: makeClient({ baseUrl, anonKey, accessToken: json.access_token }),
  };
}

export async function runChecks({ baseUrl, anonKey, ownerPhone, employeePhone }) {
  const checks = [];
  const add = (id, title, status, detail) => {
    checks.push({ id, title, status, detail });
    return status;
  };

  let owner;
  let employee;
  try {
    owner = await signIn(baseUrl, anonKey, ownerPhone);
    employee = await signIn(baseUrl, anonKey, employeePhone);
  } catch (error) {
    add("signin", "Both test accounts can sign in", UNKNOWN, String(error.message));
    return { passed: 0, failed: 0, unknown: 1, checks };
  }
  add("signin", "Both test accounts can sign in", PASS, `owner ${owner.phone} / employee ${employee.phone}`);

  // ── 1. permissions, as the database reports them ───────────────────────────
  const ownerPerms = await owner.client.myPermissions();
  const employeePerms = await employee.client.myPermissions();
  add(
    "permissions.owner",
    "The owner holds the full permission set",
    ownerPerms.includes("reports.view") && ownerPerms.includes("sales.view") && ownerPerms.length >= 30 ? PASS : FAIL,
    `${ownerPerms.length} permissions, reports.view=${ownerPerms.includes("reports.view")}`,
  );
  const employeeHasReports = employeePerms.includes("reports.view");
  add(
    "permissions.employee",
    "The employee holds no reports permission",
    !employeeHasReports && employeePerms.includes("sales.view") ? PASS : FAIL,
    `${employeePerms.length} permissions: ${employeePerms.join(", ")}`,
  );

  // ── 2. the tool list itself is filtered ────────────────────────────────────
  const ownerTools = toolsFor(ownerPerms).map((t) => t.name);
  const employeeTools = toolsFor(employeePerms).map((t) => t.name);
  add(
    "tools.filtered",
    "The profit tool is never offered to the employee",
    ownerTools.includes("profit_summary") && !employeeTools.includes("profit_summary") ? PASS : FAIL,
    `owner ${ownerTools.length} tools / employee ${employeeTools.length} tools (${employeeTools.join(", ")})`,
  );

  const ownerCtx = { client: owner.client, permissions: ownerPerms, shell: "admin", role: "owner", userId: owner.userId };
  const employeeCtx = {
    client: employee.client,
    permissions: employeePerms,
    shell: "employee",
    role: "employee",
    userId: employee.userId,
  };

  // ── 3. lock one: the gate ──────────────────────────────────────────────────
  let gateRefused = false;
  let gateDetail = "";
  try {
    await runTool("profit_summary", employeeCtx, { range: "today" });
    gateDetail = "the tool ran — the gate did not hold";
  } catch (error) {
    gateRefused = !!error.refused;
    gateDetail = gateRefused ? `refused: ${error.message}` : `failed for the wrong reason: ${error.message}`;
  }
  add("gate.refuses", "The gate refuses profit to the employee", gateRefused ? PASS : FAIL, gateDetail);

  // ── 4. lock two: the database ──────────────────────────────────────────────
  // The tool body re-asks the database, so a mistake in the cached list cannot open the door.
  const employeeDbSays = await employee.client.hasPermission("reports.view");
  const ownerDbSays = await owner.client.hasPermission("reports.view");
  add(
    "database.authority",
    "The database holds the same boundary, and agrees with the gate",
    employeeDbSays === false && ownerDbSays === true ? PASS : FAIL,
    `has_permission(reports.view): employee=${employeeDbSays} owner=${ownerDbSays}`,
  );

  let innerRefused = false;
  let innerDetail = "";
  try {
    // Called directly, skipping `runTool` entirely — the model-hallucinated-tool-call case.
    await TOOLS_BY_NAME.get("profit_summary").run(employeeCtx, { range: "today" });
    innerDetail = "the tool body returned cost data to an employee";
  } catch (error) {
    innerRefused = /cannot see cost or profit/i.test(error.message);
    innerDetail = innerRefused ? `the tool body refused: ${error.message}` : `unexpected failure: ${error.message}`;
  }
  add("gate.defence-in-depth", "Even called directly, the profit tool refuses", innerRefused ? PASS : FAIL, innerDetail);

  // ── 5. the honest answer, in words ─────────────────────────────────────────
  const refusedAnswer = await askDeterministic("how much profit did I make today", employeeCtx);
  const leaked = /\d{1,3}(,\d{3})+/.test(refusedAnswer.answer);
  add(
    "answer.no-leak",
    "The employee's spoken answer contains no money figure",
    refusedAnswer.refused && !leaked ? PASS : FAIL,
    `refused=${refusedAnswer.refused} leakedNumber=${leaked} → "${refusedAnswer.answer.slice(0, 120)}"`,
  );

  // ── 5b. a money sentence the account cannot back with a tool is set aside ───
  // Measured during this build: an employee asked for profit, had no profit tool, and the model
  // answered from the sales tool — "no sales were recorded today, so the profit is zero". True by
  // luck on an empty day, and the exact sentence that would have been wrong on a busy one. The
  // guard replaces any cost/profit/margin sentence with the gate's own refusal for accounts that
  // hold no reports permission, and leaves the owner's answer alone.
  const drafted = { answer: "Your profit today was 1,250 rupees, on a margin of 12 percent.", speak: "" };
  const employeeDraft = guardMoneyTopic(drafted, employeeCtx);
  const ownerDraft = guardMoneyTopic(drafted, ownerCtx);
  add(
    "answer.money-guard",
    "A profit sentence an account cannot back with a tool is never shown",
    employeeDraft.refused === true && !/\d/.test(employeeDraft.answer) && ownerDraft === drafted ? PASS : FAIL,
    `employee → "${employeeDraft.answer}" / owner left unchanged: ${ownerDraft === drafted}`,
  );

  const ownerAnswer = await askDeterministic("how much profit did I make today", ownerCtx);
  add(
    "answer.owner",
    "The owner gets a profit answer",
    !ownerAnswer.refused && /profit/i.test(ownerAnswer.answer) ? PASS : FAIL,
    ownerAnswer.answer.slice(0, 200),
  );

  // ── 6. the numbers are the shop's own ──────────────────────────────────────
  const salesToday = await runTool("sales_summary", ownerCtx, { range: "today" });
  const rawSales = await owner.client.select(
    "sales",
    "select=id,sale_number,total_amount,amount_paid,amount_due,is_voided,created_at&order=created_at.desc&limit=1000",
  );
  const shopDayStart = new Date(new Date(Date.now() + 300 * 60_000).toISOString().slice(0, 10) + "T00:00:00.000+05:00");
  const expected = (rawSales ?? []).filter(
    (s) => !s.is_voided && Date.parse(s.created_at) >= shopDayStart.getTime(),
  );
  const expectedTotal = expected.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const toolCount = salesToday.facts.saleCount;
  const toolTotal = Number(String(salesToday.facts.total).replace(/,/g, ""));
  add(
    "numbers.sales",
    "The sales total equals the shop's own rows",
    toolCount === expected.length && Math.abs(toolTotal - expectedTotal) < 0.01 ? PASS : FAIL,
    `tool: ${toolCount} sales / ${money(toolTotal)} — independent count: ${expected.length} sales / ${money(expectedTotal)}`,
  );

  // ── 6b. every figure that is SPOKEN is a figure the tool handed the screen ──
  // The spoken sentence is what the shopkeeper actually hears, so a figure that is not in the
  // records — or one that came out as 0 because a formatted string met `Number()` — is a wrong
  // number read aloud, which is the single worst failure here. This check caught exactly that:
  // a sale's own total was being announced as "0 rupees". Every offered tool is run, and each
  // amount in its sentence has to be one of the amounts the tool itself handed the screen.
  const figuresIn = (value, out = new Set()) => {
    if (value == null) return out;
    if (typeof value === "number") out.add(value);
    else if (typeof value === "string") {
      for (const match of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(Number(match[0].replace(/,/g, "")));
    } else if (Array.isArray(value)) for (const item of value) figuresIn(item, out);
    else if (typeof value === "object") for (const item of Object.values(value)) figuresIn(item, out);
    return out;
  };
  const missingFigures = [];
  let comparedFigures = 0;
  for (const tool of toolsFor(ownerPerms)) {
    let result;
    try {
      result = await runTool(tool.name, ownerCtx, tool.name === "help_topic" ? { query: "how do I record a sale" } : {});
    } catch {
      continue;
    }
    const facts = figuresIn(result.facts);
    for (const match of String(result.spoken).matchAll(/(\d[\d,]*(?:\.\d+)?)\s*rupees/g)) {
      const spoken = Number(match[1].replace(/,/g, ""));
      comparedFigures++;
      if (!facts.has(spoken)) missingFigures.push(`${tool.name} said ${match[1]} (facts hold ${[...facts].join("/") || "nothing"})`);
    }
  }
  add(
    "spoken.figures",
    "Every figure read aloud is one the tool actually returned",
    missingFigures.length ? FAIL : comparedFigures ? PASS : UNKNOWN,
    comparedFigures
      ? `${comparedFigures} spoken figures compared against each tool's own facts${missingFigures.length ? ` — MISSING: ${missingFigures.join("; ")}` : ""}`
      : "this shop has no money figures to compare, so nothing was proven",
  );

  // ── 6c. the name in a compound question is the name ────────────────────────
  // The built-in layer is what answers when the model is unavailable (a free-tier quota is
  // one request away from that), and it once searched for the literal customer "Ahmed Khan owe
  // and  was his last purc" — a question that named whose account it wanted, answered as "no
  // such customer". The name is the part of the sentence before the next clause word.
  const nameCases = [
    ["how much does the customer Ahmed Khan owe and what was his last purchase?", "Ahmed Khan", "customer_account"],
    ["how much credit does Yaqoob have?", "Yaqoob", "customer_account"],
    ["how much do I owe the supplier Syngenta?", "Syngenta", "supplier_dues"],
    ["what is the stock of Lambda?", "Lambda", "product_stock"],
  ];
  const wrongNames = [];
  for (const [question, name, tool] of nameCases) {
    const plan = deterministicPlan(question, ownerCtx);
    if (plan.tool !== tool || (plan.args?.name ?? "") !== name) {
      wrongNames.push(`"${question}" → ${plan.tool}/${plan.args?.name ?? "(no name)"} (wanted ${tool}/${name})`);
    }
  }
  add(
    "names.extracted",
    "The name in the question is the name that gets looked up",
    wrongNames.length ? FAIL : PASS,
    wrongNames.length ? wrongNames.join("; ") : nameCases.map(([q, n]) => `"${n}" from "${q.slice(0, 40)}…"`).join("; "),
  );

  // ── 7. an unknown cost is never a zero cost ────────────────────────────────
  const profit = await runTool("profit_summary", ownerCtx, { range: "all" });
  const unknown = profit.facts.linesWithUnknownCost;
  const kind = profit.facts.profitFigureIs;
  const claimIsHonest =
    (kind === "exact" && unknown === 0) ||
    (kind === "atLeast" && unknown > 0 && /at least/i.test(profit.spoken)) ||
    (kind === "unknown" && /not known|cannot give/i.test(profit.spoken));
  add(
    "profit.honesty",
    "A profit figure built on missing costs says so",
    claimIsHonest ? PASS : FAIL,
    `state=${kind}, unknown lines=${unknown} of ${profit.facts.linesCounted} → "${profit.spoken.slice(0, 150)}"`,
  );

  // ── 7b. a number the model invented is caught, not spoken ──────────────────
  // This guard exists because the live model produced 20,000 for a credit limit the database
  // says is 5,000. The check below is that exact failure, replayed.
  const facts = { customers: [{ name: "Yaqoob", owes: "11,050", creditLimit: "5,000", bought: "43,550" }] };
  const good = verifyFigures("Yaqoob owes 11,050 rupees, against a limit of 5,000 rupees.", facts);
  const bad = verifyFigures("Yaqoob owes 11,050 rupees, against a limit of 20,000 rupees.", facts);
  add(
    "figures.invented",
    "A figure that is not in the records is caught",
    good.ok && !bad.ok && bad.invented.includes("20,000") ? PASS : FAIL,
    `real figures accepted: ${good.ok}; invented 20,000 rejected: ${!bad.ok} (flagged ${JSON.stringify(bad.invented)})`,
  );
  const rounded = verifyFigures("The margin was 28 percent on 12,350.00 rupees.", { margin: 28, profit: 12350 });
  add(
    "figures.formats",
    "The same figure written differently is not flagged",
    rounded.ok ? PASS : FAIL,
    rounded.ok ? "28 and 12,350.00 both matched the tool's own numbers" : `wrongly flagged ${JSON.stringify(rounded.invented)}`,
  );

  // ── 8. nothing is kept ─────────────────────────────────────────────────────
  // The requirement is "no conversation history older than 24 hours". The answer here is that
  // there is no conversation history at all: the transcript lives in the app's memory, and the
  // assistant has nowhere to write one. That claim is only worth something if it is measured, so
  // a real question is answered through the deployed handler with every network call recorded.
  const realFetch = globalThis.fetch;
  const reads = [];
  const writes = [];
  const rpcs = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const method = String(init.method ?? "GET").toUpperCase();
    const data = url.includes("/rest/v1/");
    if (data && url.includes("/rest/v1/rpc/")) {
      // `has_permission` / `get_my_permissions` are reads the gate itself performs.
      if (!/has_permission|get_my_permissions/.test(url)) rpcs.push(`${method} ${url.split("/rest/v1/")[1]}`);
    } else if (data) {
      if (["GET", "HEAD"].includes(method)) reads.push(`${method} ${url.split("/rest/v1/")[1]}`);
      else writes.push(`${method} ${url.split("/rest/v1/")[1]}`);
    } else if (!["GET", "HEAD"].includes(method) && /\/auth\/v1\/token/.test(url)) {
      // A token refresh is the session being kept alive, not the shop's data.
    } else if (!["GET", "HEAD"].includes(method)) {
      writes.push(`${method} ${url}`);
    }
    return realFetch(input, init);
  };
  let askedOk = false;
  let askDetail = "";
  try {
    const response = await handle(
      new Request("http://localhost/assistant", {
        method: "POST",
        headers: { Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "what are today's sales" }),
      }),
      { supabaseUrl: baseUrl, anonKey, geminiKey: "", geminiModel: "" },
    );
    const payload = await response.json();
    askedOk = response.status === 200 && !!payload.answer;
    askDetail = `answered "${String(payload.answer ?? "").slice(0, 90)}…"`;
  } catch (error) {
    askDetail = `the question failed: ${error.message}`;
  } finally {
    globalThis.fetch = realFetch;
  }
  add(
    "kept.no-writes",
    "Answering a question writes nothing to the shop's data",
    !askedOk || reads.length === 0 ? UNKNOWN : writes.length === 0 && rpcs.length === 0 ? PASS : FAIL,
    askedOk
      ? `${askDetail} — ${reads.length} reads, ${writes.length} writes, ${rpcs.length} unknown calls${
          writes.length || rpcs.length ? `: ${[...writes, ...rpcs].join(", ")}` : ` (${reads.slice(0, 4).join(", ")}${reads.length > 4 ? ", …" : ""})`
        }`
      : askDetail,
  );

  // The other half of the same promise: there is no persistence in the shipped code to grow a
  // history later. Comments are stripped first, so this reads the code rather than the prose.
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const KEEPS = /(localStorage|sessionStorage|writeTextFile|Deno\.open|fs\.write|fs\.append|\.kv\.|createClient\(\s*["']|conversations|chat_history|assistant_messages)/;
  const shipped = fs.readdirSync(FUNCTION_DIR).filter((name) => /\.(mjs|ts)$/.test(name));
  const keepers = shipped.filter((name) => KEEPS.test(stripComments(fs.readFileSync(path.join(FUNCTION_DIR, name), "utf8"))));
  add(
    "kept.no-store",
    "The shipped code has nowhere to write a conversation",
    shipped.length === 0 ? UNKNOWN : keepers.length === 0 ? PASS : FAIL,
    keepers.length
      ? `${keepers.join(", ")} can persist something`
      : `${shipped.length} shipped modules read (${shipped.join(", ")}) — none can persist a conversation, and the transcript the app sends back is capped at 8 turns`,
  );

  // ── 9. the help layer, and its permission filter ───────────────────────────
  const ownerHelp = await runTool("help_topic", ownerCtx, { query: "how do I record a sale" });
  const employeeHelp = await runTool("help_topic", employeeCtx, { query: "how do I record a sale" });
  const topicsForEmployee = helpTopics().filter((t) => !t.requires || employeePerms.includes(t.requires));
  const topicsForOwner = helpTopics().filter((t) => !t.requires || ownerPerms.includes(t.requires));
  add(
    "help.loaded",
    "The app's own tutorial text is the help corpus",
    topicsForOwner.length > 10 ? PASS : UNKNOWN,
    `${topicsForOwner.length} topics for the owner, ${topicsForEmployee.length} for the employee (help is permission-filtered too)`,
  );
  add(
    "help.answers",
    "A how-to question gets the app's own words, not an incidental match",
    ownerHelp.facts.topic && /sell|sale/i.test(`${ownerHelp.facts.topic} ${ownerHelp.facts.explanation ?? ""}`) ? PASS : FAIL,
    `topic "${ownerHelp.facts.topic}" → "${ownerHelp.spoken.slice(0, 170)}"`,
  );

  // ── 10. a finding about the app, not about the assistant ───────────────────
  // Measured while building: row-level security here scopes by SHOP, not by permission, so an
  // employee's token can read `product_variants.cost_price` over REST even though they hold no
  // reports permission. The assistant can be exact about this because it never exposes a
  // generic read — but the app itself has the hole, and it is reported as a finding.
  let costReadable = false;
  let costDetail = "";
  try {
    const rows = await employee.client.select("product_variants", "select=id,cost_price&cost_price=not.is.null&limit=1");
    costReadable = Array.isArray(rows) && rows.length > 0;
    costDetail = costReadable
      ? "an employee can read product_variants.cost_price over REST"
      : "no cost rows were readable by the employee";
  } catch (error) {
    costDetail = `the employee's read was refused by the database: ${error.message}`;
  }
  add(
    "app.raw-read-gap",
    "Not a bug in the assistant: the database does not scope raw reads by permission",
    costReadable ? FINDING : PASS,
    costReadable
      ? `${costDetail} — RLS scopes by shop (shop_id = current_shop_id()), not by permission. The assistant never exposes a generic read, so it cannot reach this; the app's own screens use product_variants_public for cost. Close it with a column-level policy or a view if the app itself must be airtight.`
      : costDetail,
  );

  const passed = checks.filter((c) => c.status === PASS).length;
  const failed = checks.filter((c) => c.status === FAIL).length;
  const unproven = checks.filter((c) => c.status === UNKNOWN).length;
  const findings = checks.filter((c) => c.status === FINDING).length;
  return { passed, failed, unknown: unproven, findings, checks };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  // The same environment the server reads, so the test and the server never disagree about
  // which database they are pointing at.
  for (const file of [path.join(HERE, "..", ".env"), path.join(HERE, "..", "..", ".env.local"), path.join(HERE, "..", "..", ".env.qa")]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trim().startsWith("#")) continue;
      const key = line.slice(0, i).trim();
      if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^\[|\]$/g, "");
    }
  }

  const baseUrl = process.env.QA_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const anonKey = process.env.QA_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (!baseUrl || !anonKey) {
    console.error("No Supabase configuration found. Run this from the AgriShop repository root's ai-assistant folder.");
    process.exit(2);
  }

  const ownerPhone = process.env.ASSISTANT_OWNER_PHONE || "923001234567";
  const employeePhone = process.env.ASSISTANT_EMPLOYEE_PHONE || "923001122334";
  console.log(`agrishop-assistant selftest — ${baseUrl}`);
  console.log(`  owner ${ownerPhone}   employee ${employeePhone}\n`);

  const result = await runChecks({ baseUrl, anonKey, ownerPhone, employeePhone });
  const width = Math.max(...result.checks.map((c) => c.title.length));
  for (const c of result.checks) {
    console.log(`  ${c.status.padEnd(8)} ${c.title.padEnd(width)}  ${c.detail}`);
  }
  console.log(
    `\n  ${result.passed} passed, ${result.failed} failed, ${result.unknown} unknown, ${result.findings} finding(s)`,
  );
  console.log(`  model: ${process.env.GEMINI_API_KEY ? process.env.GEMINI_MODEL || "gemini-2.5-flash" : "not used — these checks need no key"}`);
  process.exit(result.failed > 0 ? 1 : 0);
}
