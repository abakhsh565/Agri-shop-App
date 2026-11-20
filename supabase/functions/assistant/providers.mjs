/**
 * providers.mjs — the two model layers, and why there are two.
 *
 * Both layers call the same tools and are subject to the same gate. Neither can read a
 * table, and neither is trusted with arithmetic: the rule given to the model is that every
 * number it says must be one it was handed by a tool, quoted as-is.
 *
 *   gemini     — Google Gemini with function calling. Text, voice transcripts and photos.
 *   fallback   — a deterministic keyword router with no model behind it at all.
 *
 * The fallback is not a stub and not a pretend AI. It exists because the half of this system
 * that matters most — who may see what, and the 24-hour purge — has to be runnable and
 * provable on a machine with no API key and no budget, and "we will test it once we have a
 * key" is how a permission wall ships unverified. It answers with the same real numbers from
 * the same tools, and it says plainly that it is the built-in one. It cannot read a photo,
 * and it says that too.
 */
import { Refused, runTool, TOOLS_BY_NAME, toolSpecs, toolsFor } from "./tools.mjs";

export const PROMPT = `You are the assistant inside AgriShop, an inventory and sales app used by one shop.

You are talking to one signed-in person. Everything you say is read aloud by the phone's
speaker as well as shown on screen, so keep answers short, plain and speakable: no markdown,
no bullet lists, no symbols like "Rs." or "%".

THE RULES, IN ORDER OF IMPORTANCE

1. Never state a number you were not given by a tool. Never add, subtract or convert money
   yourself. If a total is wanted, call the tool that totals it. Quote the number exactly as
   the tool gave it.
2. If a tool says a figure is not known, say that. Never fill a gap with an estimate, and
   never treat a missing cost as zero.
3. You can only see what this person may see. If a tool is not in your list, that part of the
   shop is closed to this person: say plainly that their account does not have access to it,
   without guessing at the figure, and without suggesting they find it elsewhere. Do not
   volunteer what their permission is called unless they ask.
4. Money is in rupees. Say "45,250 rupees", never "Rs. 45,250".
5. Answer only what was asked, and nothing around it. The answer is one or two short sentences:
   the figure or the fact first, then at most one clause of what it means. No greeting, no
   repeating their question, no describing what you did or which tool you used, no list of other
   things they could ask, and no offer to help further. If a card already shows the detail, say
   the one sentence it needs rather than reading the card back. Answer in the language they used;
   if they write in Urdu, answer in Urdu.
6. When a tool result carries a screen, offer it at the end in plain words: "You can open it
   from Sales." Never invent a screen.
7. If they ask how to do something, use help_topic and pass on the app's own words. If they
   say they do not understand, explain gently and offer the guide. If the guide has no entry for
   what they asked, answer from WHAT THIS APP DOES below instead — do not call the tool again for
   the same wording, and do not put a card under it.
8. If you are not sure which customer, product or sale they mean, ask. Reading out the wrong
   person's balance is worse than one extra question.

9. A card is the detail of an answer, never decoration. Attach one only when a tool returned the
   figures or rows the person actually asked about, and never call a tool for the purpose of
   producing a card. If a tool has nothing to show, say the sentence and stop — an empty card is
   worse than no card.

WHAT THIS APP DOES, IN ITS OWN TERMS

These are answers to "how does this work" and "can I do this" questions. They need no tool: say
the relevant line plainly in a sentence or two, and name the screen only if the question was where
to find something.

- Sales total is the sum of the sale amounts in the period. A credit sale counts in sales now; the
  money arrives later.
- The app has two profit figures and they are not the same thing, so use the one that was asked
  for. Profit on the Profit report is sales revenue minus the cost of the goods sold, using the
  cost recorded on each line at the time of the sale; margin is that profit divided by revenue.
  Net profit on the Finance screen is net sales minus cost of goods minus the expenses recorded in
  Finance (rent, bills and the like). That is the whole formula: nothing else is subtracted,
  drawings are tracked separately and are not part of it, and no tax is added. If a sold line has
  no recorded cost the report leaves that line out and says the profit is at least that much — a
  missing cost is never treated as zero.
- When somebody asks how a figure is worked out, give exactly the formula above and stop. Do not
  add costs, taxes or adjustments that are not written there, and do not describe a screen that is
  not named there.
- Udhaar (credit): a credit sale adds to that customer's balance; recording a payment reduces it.
  Recording a payment is not a sale and does not change sales totals.
- A sale does not need a customer. A walk-in sale can be recorded on its own, and it is not added
  to anybody's credit balance.
- Stock is what came in through purchases minus what went out through sales, per branch. A product
  can carry a low-stock level; when the count falls to it, the reorder list picks it up.
- Returns and cancellations are recorded against the sale they belong to, and the totals move with
  them.
- Roles: the owner sees the whole shop. A Co-Owner is limited to the branch they are working in.
  An employee sees only the screens and figures their role allows — for example, cost and profit
  need the reports permission, so an employee without it is told their account does not have
  access and that the owner can change it in Roles and access. Never estimate what they may not
  see, and never suggest another screen as a way around it.
- Name only screens that a tool in this conversation named, or that appear in this list: Sales,
  Purchases, Inventory, Customers, Finance, Reports, Roles and access. Never invent a screen or a
  menu path; if you are not sure where something lives, say you are not sure and offer to look it
  up.
- Nothing in the app is destructive without a confirmation step, and the assistant never records
  money or changes stock by itself: it can prepare a draft in the chat for the person to send.
`;

/** One tool call, in the shape both layers produce. */
function traceEntry(name, args, outcome) {
  return { name, args, ...outcome };
}

/**
 * A tool result as a card the chat can draw in place.
 *
 * The detail is never somewhere else. A person asking "what are today's sales" gets the
 * numbers in the conversation, laid out the way the app's own screen lays them out — the
 * question and its answer stay in one column, and a screen link is left as a small extra for
 * the person who does want to go and act on it.
 *
 * `tool` is the key: the chat has one renderer per tool, so the card it draws for
 * `sales_summary` is the sales card and not a generic table of keys.
 */
function scopeInstruction(ctx) {
  if (ctx?.experience === "co_owner") {
    return "This person is a Co-Owner. Their access is limited to the branch they are working in. Never imply they can see another branch or the whole shop.";
  }
  if (ctx?.experience === "employee") {
    return "This person is an employee. Use only the tools their permissions include and the branch they are working in. Never imply wider access.";
  }
  return "This person owns the shop. Do not claim a permission restriction for them.";
}

/**
 * The card for a tool result — or nothing at all.
 *
 * WHY IT CAN RETURN NOTHING. A card is the detail of an answer, not the answer: when a tool has no
 * detail to lay out, drawing one produces the block the owner reported — "Nothing saved for that"
 * with "undefined" under it, taller than the sentence above it. Asked "how to calculate profit?",
 * the model answered correctly and then called `help_topic`, which has no guide entry for that
 * wording; the card was pure noise and contradicted the answer.
 *
 * So a tool result earns a card only when it carries facts the person asked for. An informative
 * emptiness still counts (`low_stock` with nothing running out has facts, and that emptiness is
 * the answer); an absent payload does not.
 *
 * Exported because the unit suite pins exactly this rule, and a rule that only the model can go
 * wrong about is a rule nobody tests.
 */
export function widgetFor(result) {
  if (!result) return null;
  if (result.widget === false) return null;
  const facts = result.facts ?? {};
  if (!Object.keys(facts).length) return null;
  // A guide answer with no matching entry has nothing to lay out; the spoken sentence already says
  // there is no saved explanation, and a card here printed "undefined" beneath it.
  if (result.tool === "help_topic" && !Number(facts.topicsMatched)) return null;
  return {
    tool: result.tool,
    title: result.title ?? "Result",
    facts,
    notes: result.notes ?? [],
    sources: result.sources ?? [],
  };
}

/** Turn a tool result into the small, quotable payload a model is allowed to see. */
function forModel(result) {
  return {
    spoken: result.spoken,
    facts: result.facts ?? {},
    notes: result.notes ?? [],
    screens: (result.sources ?? []).map((s) => s.label),
    period: result.facts?.period ?? null,
  };
}

/** Every number that appeared anywhere in a tool result, as written. */
function numbersIn(value, into = new Set()) {
  if (value == null) return into;
  if (typeof value === "number") {
    into.add(String(value));
    into.add(value.toLocaleString("en-PK"));
    return into;
  }
  if (typeof value === "string") {
    for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      into.add(m[0]);
      into.add(m[0].replace(/,/g, ""));
      // "45,250" and "45250" are the same figure; so are "12,350.00" and "12350".
      const plain = m[0].replace(/,/g, "").replace(/\.0+$/, "");
      into.add(plain);
      into.add(Number(plain).toLocaleString("en-PK"));
    }
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) numbersIn(v, into);
    return into;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) numbersIn(v, into);
  }
  return into;
}

/**
 * The rule "never state a number you were not given", enforced in code rather than requested
 * in a prompt.
 *
 * The prompt alone is not enough, and a live run proved it: asked for a customer's credit
 * limit, the model answered 20,000 where the tool had reported 5,000 — a figure it invented,
 * fluently, in the middle of three correct ones. A shopkeeper cannot tell which of the four
 * came from the ledger, and this is money.
 *
 * So every number in the answer is matched against every number the tools actually returned.
 * If one is not there, the model's sentence is withdrawn and the tool's own sentence is spoken
 * instead — which is exactly what the tool layer already knows how to say, with the real
 * figure in it, and a note explaining why.
 */
export function verifyFigures(answer, toolResults) {
  const allowed = numbersIn(toolResults);
  const said = [...String(answer ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]);
  const invented = [];
  for (const token of said) {
    const plain = token.replace(/,/g, "").replace(/\.0+$/, "");
    if (allowed.has(token) || allowed.has(plain)) continue;
    invented.push(token);
  }
  return { ok: invented.length === 0, invented: [...new Set(invented)] };
}

// ─── the deterministic layer ─────────────────────────────────────────────────

const RULES = [
  {
    // First, because "how do I record a sale" contains the word "sale" and every other rule
    // below would happily try to answer it with a total instead of the steps.
    tool: "help_topic",
    // A genuine "how do I" or "I do not understand" cue. Note there is no bare "what is"
    // here: "what are today's sales?" is a question about data, not about the app, and
    // routing it to the guide would answer the wrong question politely.
    test: /\b(how (do|to|does|can) i?|where (is|do|can) i|explain|teach me|show me how|tutorial|walk me through|confused|stuck|(do ?n[o']?t|do not) understand|not sure how|guide me)\b/i,
    args: (t) => ({ query: t }),
  },
  {
    tool: "my_abilities",
    test: /\b(what can i|my rights|permissions?|allowed to|can i (see|do|access|open))\b/i,
    args: () => ({}),
  },
  {
    tool: "branch_overview",
    test: /\b(branches?|locations?|shops?)\b/i,
    // "employees in the branch" is a team question, not a branch-directory question.
    unless: /\b(employee|staff|team|performance|sales|purchase)\b/i,
    args: () => ({}),
  },
  {
    // "How is Ali selling" and "employee performance" are one question. It is checked before
    // the generic activity rule so a performance question is not answered with a log page.
    tool: "employee_performance",
    test: /\b(employee|staff|team|worker)\b.*\b(performance|sales|selling|sold)\b|\b(performance|how is .* selling|sales by)\b.*\b(employee|staff|team|worker)\b|\bperformance of\b/i,
    args: (t) => ({ name: findName(t, ["employee", "staff", "of", "for"]) }),
  },
  {
    tool: "employee_directory",
    test: /\b(who works|list (the )?(employees|staff|team)|all (employees|staff)|employees? (list|directory)|team (list|directory)|staff (list|directory)|who is in|employees? (in|at)|staff (in|at)|team (in|at))\b/i,
    args: (t) => ({ branch: findName(t, ["in", "at"]) }),
  },
  {
    tool: "profit_summary",
    // "profit", "margin", "how much did I earn on"
    test: /\b(profit|margin|kamai|munafa)\b/i,
    args: (t) => ({ range: detectRange(t) }),
  },
  {
    tool: "sale_lookup",
    test: /\b(last sale|latest sale|most recent sale|last bill|last receipt|which sale)\b/i,
    args: () => ({}),
  },
  {
    tool: "sales_summary",
    test: /\b(sales?|sold|sale total|revenue|bikri|kitni sale)\b/i,
    args: (t) => ({ range: detectRange(t) }),
  },
  {
    tool: "sale_lookup",
    test: /(sale|receipt|bill|parchi)\b.*\d{3,}|\b\d{4,}\b.*(sale|receipt|bill)/i,
    args: (t) => {
      const number = t.match(/SALE[-\s]?(\d{3,})/i)?.[1] ?? t.match(/\b(\d{4,})\b/)?.[1];
      return number ? { sale_number: String(number) } : {};
    },
  },
  {
    tool: "low_stock",
    test: /\b(low stock|running out|reorder|out of stock|khatam|kam stock)\b/i,
    args: () => ({}),
  },
  {
    tool: "employee_activity",
    test: /\b(employee|staff|activity|audit|worker|mazdoor)\b/i,
    args: (t) => ({ name: "", range: detectRange(t) }),
  },
  {
    tool: "purchases_overview",
    test: /\b(purchases?|stock in|bought from|supplier bills?|bills? from)\b/i,
    args: (t) => ({ range: detectRange(t) }),
  },
  {
    tool: "finance_overview",
    test: /\b(finance|expenses?|expenditure|income|receivables?|payables?|money in|money out|cash flow|net position|drawings?)\b/i,
    args: (t) => ({ range: detectRange(t) }),
  },
  {
    // Before the customer rule: "how much do I owe the suppliers" is a question about the shop's
    // own payables, and the word "owe" used to send it to a customer's account instead — which
    // answered "which customer?" to a question that named a supplier.
    tool: "supplier_dues",
    test: /\b(supplier|company|companies|payable|vendor)s?\b/i,
    args: (t) => ({ name: findName(t, ["supplier", "company", "to"]) }),
  },
  {
    tool: "customer_directory",
    test: /\b(who owes|all customers|customer list|customers list|outstanding customers|receivables|who has credit|which customers|list customers)\b/i,
    args: () => ({}),
  },
  {
    tool: "customer_account",
    // Any name after "customer", or a bare name with an asking-word near it. Not when the
    // sentence is about a supplier, which is the other thing a shop owes.
    test: /\b(customer|khata|udhaar|credit|owes?|balance|last purchase)\b/i,
    unless: /\b(supplier|company|companies|vendor|payable)\b/i,
    args: (t) => ({ name: findName(t, ["customer", "of", "for"]) }),
  },
  {
    tool: "inventory_overview",
    test: /\b(inventory|stock value|stock overview|how much stock|all stock|stock summary)\b/i,
    args: () => ({}),
  },
  {
    tool: "product_catalogue",
    test: /\b(product list|products list|catalogue|all products|what do i sell|item list|price list|items i stock)\b/i,
    args: () => ({}),
  },
  {
    tool: "product_stock",
    test: /\b(stock|how much|left|price of|inventory)\b/i,
    args: (t) => ({ name: findName(t, ["of", "much", "stock", "price"]) }),
  },
];

function detectRange(text) {
  const t = text.toLowerCase();
  if (/\b(yesterday|kal)\b/.test(t)) return "yesterday";
  if (/\b(this week|last 7|week|hafte)\b/.test(t)) return "week";
  if (/\b(this month|month|mahine|mahina)\b/.test(t)) return "month";
  if (/\b(all time|ever|total so far|hamesha)\b/.test(t)) return "all";
  return "today";
}

/**
 * The name in the sentence.
 *
 * "How much credit does Yaqoob have?" names its subject after the verb, and "this customer's
 * last purchase" may name nobody at all. Four readings are tried in order of how much they
 * know, because the alternative — handing the tool an empty name — produces "Which customer?"
 * for a question that plainly said whose.
 *
 * Capitalisation is the signal for a name here: the app's customers and products are written
 * as proper nouns, and no keyword in these questions is capitalised mid-sentence.
 */
const NAME_STOP = new Set([
  "how", "what", "when", "who", "which", "the", "this", "that", "his", "her", "their", "my",
  "today", "yesterday", "please", "tell", "show", "much", "many", "total", "all", "give",
  "and", "but", "does", "did", "is", "are", "was", "were", "last", "next", "now", "left",
  "stock", "credit", "balance", "customer", "product", "sale", "supplier", "employee",
]);

/**
 * The words that END a name.
 *
 * Capturing "the rest of the sentence" as the name looked harmless and was not: "how much does
 * the customer Ahmed Khan owe and what was his last purchase" was searched for as the literal
 * customer "Ahmed Khan owe and  was his last purc", so a question that plainly named whose
 * account it wanted came back as "no such customer". A name is a short run of words; the first
 * clause word after it belongs to the question, not to the person.
 */
const NAME_ENDS = new Set([
  "and", "but", "or", "what", "when", "who", "which", "how", "why", "was", "were", "is", "are",
  "does", "did", "do", "has", "have", "had", "his", "her", "their", "its", "he", "she", "they",
  "the", "owe", "owes", "owed", "purchase", "purchases", "bought", "for", "from", "with", "about",
  "left", "stock", "credit", "balance", "of", "to", "in", "on", "at", "now", "today", "yesterday",
  "please", "tell", "show", "me", "much", "many", "total", "all", "give",
]);

/** At most four words, stopping at the first clause word after the name begins. */
function nameRun(candidate) {
  const kept = [];
  for (const token of String(candidate).trim().split(/\s+/).filter(Boolean)) {
    const clean = token.replace(/[^A-Za-z0-9\u0600-\u06FF'-].*$/, "");
    if (!clean) break;
    if (kept.length && NAME_ENDS.has(clean.toLowerCase())) break;
    kept.push(clean);
    if (kept.length === 4) break;
  }
  return kept.join(" ");
}

function findName(text, words) {
  for (const w of words) {
    const m = text.match(new RegExp(`${w}\\s+(?:the\\s+)?([A-Za-z0-9\\u0600-\\u06FF][\\w\\u0600-\\u06FF .'-]{1,40})`, "i"));
    if (m) {
      const candidate = nameRun(m[1]);
      if (candidate.length > 1) return candidate;
    }
  }
  // "… credit does Yaqoob have", "… of Yaqoob", "… Yaqoob's last purchase".
  const framed = text.match(
    /\b(?:credit|balance|owes?|owe|account|khata|udhaar|bought|purchases?|stock|price|stocked)\b\s*(?:does|of|for|to|is|has)?\s+([A-Z][A-Za-z0-9'.-]{1,30})/,
  );
  if (framed) return framed[1];
  const possessive = text.match(/([A-Z][A-Za-z0-9'.-]{1,30})'s\b/);
  if (possessive && !NAME_STOP.has(possessive[1].toLowerCase())) return possessive[1];
  // Finally, any capitalised word that is not a keyword and not the first word of the
  // sentence — "how much Lambda is left" has nowhere else to look.
  const words2 = text.split(/\s+/);
  for (let i = 1; i < words2.length; i++) {
    const token = words2[i].replace(/[^A-Za-z0-9'.-].*$/, "");
    if (token.length < 3) continue;
    if (!/^[A-Z]/.test(token)) continue;
    if (NAME_STOP.has(token.toLowerCase())) continue;
    return token;
  }
  return "";
}

/**
 * The deterministic answer.
 *
 * It picks one tool by keyword, calls it, and returns the tool's own sentence. When the tool
 * refuses, the refusal is the answer — this layer has no way to route around the gate, which
 * is exactly the property that makes it worth running the security tests against.
 */
export function deterministicPlan(text, ctx) {
  const offered = new Set(toolsFor(ctx.permissions).map((t) => t.name));
  const attempted = [];
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    if (rule.unless?.test(text)) continue;
    // A rule whose tool is not in this person's list is reported as an attempt, so the UI can
    // show honestly that the request was recognised and then refused, rather than pretending
    // the question was never understood.
    attempted.push(rule.tool);
    if (!offered.has(rule.tool)) {
      return { tool: rule.tool, args: rule.args(text), blocked: true };
    }
    return { tool: rule.tool, args: rule.args(text) };
  }
  return { tool: null, attempted };
}

export async function askDeterministic(text, ctx) {
  const plan = deterministicPlan(text, ctx);
  const calls = [];
  if (!plan.tool) {
    return {
      model: "built-in",
      answer:
        "I can answer from this shop's own records: today's sales, profit, purchases, money and expenses, customer credit, a sale's details, stock, branches, employees, suppliers and what you are allowed to do. Ask me one of those, or say which screen you are stuck on.",
      speak: "I can answer from this shop's own records. Ask me about sales, profit, purchases, money, customer credit, stock, branches, employees, or supplier dues.",
      calls,
      sources: [],
      widgets: [],
    };
  }
  try {
    const result = await runTool(plan.tool, ctx, plan.args);
    calls.push(traceEntry(plan.tool, plan.args, { ok: true, ms: result.ms, permission: result.permission }));
    return {
      model: "built-in",
      answer: result.spoken,
      speak: result.spoken,
      calls,
      sources: result.sources ?? [],
      notes: result.notes ?? [],
      facts: result.facts,
      widgets: [widgetFor(result)].filter(Boolean),
    };
  } catch (error) {
    calls.push(traceEntry(plan.tool, plan.args, { ok: false, refused: !!error.refused, permission: error.permission }));
    return {
      model: "built-in",
      answer: error.refused ? `${error.message} I will not guess at a figure.` : error.message,
      speak: error.refused ? `I cannot answer that. ${error.message}` : "Sorry, that did not work.",
      calls,
      sources: [],
      widgets: [],
      refused: !!error.refused,
      permission: error.permission ?? null,
    };
  }
}

// ─── the Gemini layer ────────────────────────────────────────────────────────

const GEMINI_HOST = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Where the model calls go.
 *
 * Google by default, so a plain build behaves exactly as before. Set `ASSISTANT_MODEL_BASE_URL`
 * and the same Gemini wire format is sent somewhere else — a gateway that speaks it.
 *
 * WHY THIS EXISTS. The function's shape is already gateway-friendly without knowing it: it builds
 * `{host}/models/{model}:generateContent?key=…`, and OmniRoute (among others) serves exactly
 * `POST /v1beta/models/{model}:generateContent` and accepts the credential as `?key=`. So routing
 * this app's assistant through a local gateway is a base URL, not a second provider implementation
 * — and there is still one call path, one tool gate and one set of rules.
 *
 * The key and model id keep their `GEMINI_*` names because they are still the credential and the
 * model id; only the host they are sent to changes.
 *
 * Trailing slashes are trimmed because every caller joins this with `/models/…` — a base URL ending
 * in `/` would otherwise produce a double slash that gateways can route differently from the
 * documented path.
 */
function modelHost(baseUrl) {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || GEMINI_HOST;
}

async function callGemini({ apiKey, model, body, baseUrl }) {
  const res = await fetch(`${modelHost(baseUrl)}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message = json?.error?.message ?? `Gemini answered ${res.status}`;
    throw new Error(message);
  }
  return json;
}

/**
 * One question, one tool loop.
 *
 * The loop is bounded at four rounds. A model that keeps calling tools is a model that is not
 * converging, and a shopkeeper waiting on a phone is not the place to find out how long that
 * takes.
 */
export async function askGemini({ apiKey, model, text, ctx, photo, history = [], maxRounds = 4, baseUrl }) {
  const declarations = toolSpecs(ctx.permissions).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const contents = [];
  for (const m of history.slice(-8)) {
    contents.push({ role: m.role === "user" ? "user" : "model", parts: [{ text: String(m.text ?? "") }] });
  }
  const parts = [{ text }];
  if (photo?.data && photo?.mimeType) {
    // A receipt is read by reading it: the image goes to the model, the model comes back with
    // a sale number, and the NUMBER is then looked up by a tool. The model never reports a
    // figure it read off a picture as a fact — it has to find that figure in the database.
    parts.push({ inlineData: { mimeType: photo.mimeType, data: photo.data } });
  }
  contents.push({ role: "user", parts });

  const calls = [];
  const sources = [];
  const widgets = [];
  const toolResults = [];
  let lastText = "";
  /** The most recent successful tool result — the sentence to fall back on. */
  let lastGood = null;

  for (let round = 0; round < maxRounds; round++) {
    const json = await callGemini({
      apiKey,
      model,
      baseUrl,
      body: {
        systemInstruction: {
          parts: [
            {
              text: `${PROMPT}\n${scopeInstruction(ctx)}\nToday is ${new Date().toISOString().slice(0, 10)}.`,
            },
          ],
        },
        contents,
        tools: declarations.length ? [{ functionDeclarations: declarations }] : undefined,
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
      },
    });

    const candidate = json?.candidates?.[0];
    const partsOut = candidate?.content?.parts ?? [];
    const textOut = partsOut
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (textOut) lastText = textOut;

    const wanted = partsOut.filter((p) => p.functionCall);
    if (!wanted.length) {
      const check = verifyFigures(lastText, toolResults);
      if (!check.ok && lastGood) {
        return {
          model,
          answer: lastGood.spoken,
          speak: lastGood.spoken,
          calls,
          widgets,
          sources: dedupeSources(sources.length ? sources : lastGood.sources ?? []),
          notes: [
            `The language model used a figure the records do not contain (${check.invented.join(", ")}), so its wording was set aside and the record's own sentence is shown instead.`,
          ],
        };
      }
      return {
        model,
        answer: lastText || "I could not put that into words.",
        speak: speechify(lastText),
        calls,
        widgets,
        // The screens the tools named, so the sentence the model wrote about "opening it from
        // Sales" is backed by a link that actually goes there.
        sources: dedupeSources(sources),
      };
    }

    contents.push({ role: "model", parts: partsOut });
    const responses = [];
    for (const p of wanted) {
      const { name, args } = p.functionCall;
      try {
        const result = await runTool(name, ctx, args ?? {});
        calls.push(traceEntry(name, args ?? {}, { ok: true, ms: result.ms, permission: result.permission }));
        for (const s of result.sources ?? []) sources.push(s);
        toolResults.push(forModel(result));
        // A card is added only when the tool produced detail; see `widgetFor`.
        const card = widgetFor(result);
        if (card) widgets.push(card);
        if (result.spoken) lastGood = result;
        responses.push({
          functionResponse: { name, response: { ok: true, result: forModel(result), sources: result.sources ?? [] } },
        });
      } catch (error) {
        calls.push(traceEntry(name, args ?? {}, { ok: false, refused: !!error.refused, permission: error.permission }));
        responses.push({
          functionResponse: {
            name,
            response: {
              ok: false,
              refused: !!error.refused,
              permission: error.permission ?? null,
              // The model is told why in words it can pass on, and is told not to work around it.
              message: error.refused
                ? `${error.message} Do not attempt another way to obtain this, and do not estimate it.`
                : `${error.message}. Report that you could not retrieve it.`,
            },
          },
        });
      }
    }
    contents.push({ role: "user", parts: responses });
  }

  const finalCheck = verifyFigures(lastText, toolResults);
  if (!finalCheck.ok && lastGood) {
    return {
      model,
      answer: lastGood.spoken,
      speak: lastGood.spoken,
      calls,
      widgets,
      sources: dedupeSources(sources),
      notes: [
        `The language model used a figure the records do not contain (${finalCheck.invented.join(", ")}), so its wording was set aside and the record's own sentence is shown instead.`,
      ],
    };
  }
  return {
    model,
    answer: lastText || "I could not finish that.",
    speak: speechify(lastText),
    calls,
    widgets,
    sources: dedupeSources(sources),
  };
}

/**
 * GROQ — the fast provider, in the OpenAI wire format.
 *
 * WHY IT EXISTS. Gemini is the fallback now, not the only answer: this path answers the small
 * everyday questions in a fraction of a second, which is what a shopkeeper asking "today's sales"
 * while a customer waits actually needs. Both providers run the SAME tools under the SAME gate and
 * are held to the same rule about numbers — this function is a second transport, never a second
 * set of permissions.
 *
 * The wire format differs from Gemini's in three places, and all three are handled here rather than
 * leaked upward: tools are `{type:"function", function:{…}}`, results come back as `tool_calls` on
 * the assistant message and go back as `role:"tool"` messages carrying the call id, and the system
 * instruction is a plain message instead of `systemInstruction`.
 */
const GROQ_HOST = "https://api.groq.com/openai/v1";

function groqHost(baseUrl) {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  return trimmed || GROQ_HOST;
}

async function callGroq({ apiKey, body, baseUrl }) {
  const res = await fetch(`${groqHost(baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `Groq answered ${res.status}`);
  }
  return json;
}

export async function askGroq({ apiKey, model, text, ctx, photo, history = [], maxRounds = 4, baseUrl }) {
  const tools = toolSpecs(ctx.permissions).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  const messages = [
    {
      role: "system",
      content: `${PROMPT}\n${scopeInstruction(ctx)}\nToday is ${new Date().toISOString().slice(0, 10)}.`,
    },
  ];
  for (const m of history.slice(-8)) {
    messages.push({ role: m.role === "user" ? "user" : "assistant", content: String(m.text ?? "") });
  }
  messages.push({
    role: "user",
    content: photo?.data && photo?.mimeType
      ? [
          { type: "text", text },
          { type: "image_url", image_url: { url: `data:${photo.mimeType};base64,${photo.data}` } },
        ]
      : text,
  });

  const calls = [];
  const sources = [];
  const widgets = [];
  const toolResults = [];
  let lastText = "";
  let lastGood = null;

  for (let round = 0; round < maxRounds; round++) {
    const json = await callGroq({
      apiKey,
      baseUrl,
      body: {
        model,
        messages,
        tools: tools.length ? tools : undefined,
        tool_choice: tools.length ? "auto" : undefined,
        temperature: 0.2,
        max_tokens: 700,
      },
    });

    const message = json?.choices?.[0]?.message ?? {};
    const textOut = String(message.content ?? "").trim();
    if (textOut) lastText = textOut;

    const wanted = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!wanted.length) {
      const check = verifyFigures(lastText, toolResults);
      if (!check.ok && lastGood) {
        return {
          model,
          answer: lastGood.spoken,
          speak: lastGood.spoken,
          calls,
          widgets,
          sources: dedupeSources(sources.length ? sources : lastGood.sources ?? []),
          notes: [
            `The language model used a figure the records do not contain (${check.invented.join(", ")}), so its wording was set aside and the record's own sentence is shown instead.`,
          ],
        };
      }
      return {
        model,
        answer: lastText || "I could not put that into words.",
        speak: speechify(lastText),
        calls,
        widgets,
        sources: dedupeSources(sources),
      };
    }

    messages.push({ role: "assistant", content: message.content ?? "", tool_calls: wanted });
    for (const call of wanted) {
      const name = call?.function?.name ?? "";
      let args = {};
      try {
        args = JSON.parse(String(call?.function?.arguments ?? "{}"));
      } catch {
        args = {};
      }
      try {
        const result = await runTool(name, ctx, args ?? {});
        calls.push(traceEntry(name, args ?? {}, { ok: true, ms: result.ms, permission: result.permission }));
        for (const s of result.sources ?? []) sources.push(s);
        toolResults.push(forModel(result));
        // A card is added only when the tool produced detail; see `widgetFor`.
        const card = widgetFor(result);
        if (card) widgets.push(card);
        if (result.spoken) lastGood = result;
        messages.push({
          role: "tool",
          tool_call_id: call.id ?? name,
          content: JSON.stringify({ ok: true, result: forModel(result), sources: result.sources ?? [] }),
        });
      } catch (error) {
        calls.push(traceEntry(name, args ?? {}, { ok: false, refused: !!error.refused, permission: error.permission }));
        messages.push({
          role: "tool",
          tool_call_id: call.id ?? name,
          content: JSON.stringify({
            ok: false,
            refused: !!error.refused,
            permission: error.permission ?? null,
            message: error.refused
              ? `${error.message} Do not attempt another way to obtain this, and do not estimate it.`
              : `${error.message}. Report that you could not retrieve it.`,
          }),
        });
      }
    }
  }

  const finalCheck = verifyFigures(lastText, toolResults);
  if (!finalCheck.ok && lastGood) {
    return {
      model,
      answer: lastGood.spoken,
      speak: lastGood.spoken,
      calls,
      widgets,
      sources: dedupeSources(sources),
      notes: [
        `The language model used a figure the records do not contain (${finalCheck.invented.join(", ")}), so its wording was set aside and the record's own sentence is shown instead.`,
      ],
    };
  }
  return {
    model,
    answer: lastText || "I could not finish that.",
    speak: speechify(lastText),
    calls,
    widgets,
    sources: dedupeSources(sources),
  };
}

/** The same screen offered twice is one link, and four is as many as a phone screen wants. */
function dedupeSources(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    if (!s?.route || seen.has(s.route)) continue;
    seen.add(s.route);
    out.push(s);
  }
  return out.slice(0, 4);
}

/** Strip what a voice should not read out: markdown, symbols, stray list markers. */
export function speechify(text) {
  return String(text ?? "")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/Rs\.?\s*/g, "")
    .replace(/%/g, " percent")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One entry point, so the caller never has to know which layer answered — except that the
 * UI shows the label, because pretending a keyword router is a language model is a small
 * dishonesty that grows.
 */
/**
 * How long the API itself asked us to wait, when it asked at all.
 *
 * A free-tier quota is per minute, so the first question after a burst can be refused with
 * "please retry in 7s". Waiting that long ONCE is worth it: the alternative is answering a
 * shopkeeper with the built-in layer while the model was merely busy. It is capped at eight
 * seconds, and it only ever applies to a rate limit — a bad key or a malformed request fails
 * immediately rather than making somebody wait for a second attempt that cannot succeed.
 */
function retryDelayMs(message) {
  if (!/quota|rate limit|429|too many requests/i.test(String(message))) return 0;
  const seconds = Number(/retry in ([\d.]+)s/i.exec(String(message))?.[1]);
  if (!Number.isFinite(seconds)) return 3000;
  return Math.min(Math.max(seconds * 1000, 1000), 8000);
}

/**
 * The small model, tried when the configured one cannot answer.
 *
 * Quota on these keys is counted per model per day, and the busy model is usually the good one —
 * so a shopkeeper asking a question should not be handed the keyword layer while a second model on
 * the same key still has room. Measured, not assumed: with the free key supplied for this build,
 * `gemini-2.5-flash` was out of quota and this one answered. The built-in layer is the last
 * resort, not the first answer to somebody else's rate limit.
 */
const FALLBACK_MODEL = "gemini-flash-lite-latest";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A money answer for someone who cannot see money is not shown.
 *
 * WHY THIS EXISTS, MEASURED. An employee asked "how much profit did I make today". Their account
 * has no profit tool, so the model reached for the one it did have — sales — and said "no sales
 * were recorded today, so the profit is zero". That happened to be true because the day was empty;
 * with sales on the books it is exactly the sentence that would have been wrong, because revenue
 * is not profit and the figure the shopkeeper heard would have been one nobody had checked. The
 * instruction to the model already forbids this, and an instruction is not a boundary: a rule that
 * matters is enforced after the model has spoken, where it can be caught.
 *
 * So: if the account holds no `reports.view`, an answer that talks about cost, profit or margin is
 * replaced with the same refusal the tool gate gives, and the verified cards stay on screen — what
 * the person may see is still shown, and the one thing they may not see is not guessed at.
 */
const MONEY_TOPIC = /(profit|margin|cost price|\bcosts?\b|منافع|لاگت)/i;

const MONEY_REFUSAL =
  "This account cannot see cost or profit. The owner can change that in Roles and access.";

export function guardMoneyTopic(answer, ctx) {
  if (ctx?.permissions?.includes("reports.view")) return answer;
  if (!MONEY_TOPIC.test(String(answer?.answer ?? ""))) return answer;
  return {
    ...answer,
    answer: MONEY_REFUSAL,
    speak: `I cannot answer that. ${MONEY_REFUSAL}`,
    refused: true,
    notes: [
      ...(answer.notes ?? []),
      "The answer that was drafted talked about cost or profit, which this account cannot see, so it was set aside.",
    ],
  };
}

/**
 * One model, and the single piece of patience it is owed: a rate limit is waited out once, using
 * the wait the service itself named. Anything else fails immediately — waiting cannot fix a key
 * that is wrong or a model that no longer exists.
 */
async function tryModel({ apiKey, model, text, ctx, photo, history, hasAnother, baseUrl }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await askGemini({ apiKey, model, text, ctx, photo, history, baseUrl });
    } catch (error) {
      const message = String(error?.message ?? "");
      const wait = attempt === 0 ? retryDelayMs(message) : 0;
      if (wait) {
        console.warn(`[assistant] ${model} rate-limited, retrying in ${Math.round(wait / 1000)}s`);
        await delay(wait);
        continue;
      }
      console.warn(
        `[assistant] ${model} unavailable${hasAnother ? ", trying another model" : ""}: ${message.slice(0, 200)}`,
      );
      return null;
    }
  }
  return null;
}

function photoUnavailable(note) {
  return {
    model: "built-in",
    answer: "I cannot read a photo just now. Type the sale number written on it and I will look it up.",
    speak: "I cannot read photos just now. Type the sale number on it and I will look it up.",
    calls: [],
    sources: [],
    widgets: [],
    notes: note ? [note] : [],
  };
}

/**
 * One attempt at one provider, with the single piece of patience a rate limit is owed.
 *
 * Groq and Gemini both rate-limit per minute; waiting once, for the delay the service itself
 * named, is cheaper than handing a shopkeeper the keyword layer while the fast model had room.
 */
async function attempt(run, label, hasAnother) {
  for (let round = 0; round < 2; round++) {
    try {
      return await run();
    } catch (error) {
      const message = String(error?.message ?? "");
      const wait = round === 0 ? retryDelayMs(message) : 0;
      if (wait) {
        console.warn(`[assistant] ${label} rate-limited, retrying in ${Math.round(wait / 1000)}s`);
        await delay(wait);
        continue;
      }
      console.warn(`[assistant] ${label} unavailable${hasAnother ? ", trying the next provider" : ""}: ${message.slice(0, 200)}`);
      return null;
    }
  }
  return null;
}

/**
 * The provider order: Groq first because it answers in a fraction of a second, then Gemini, then
 * the built-in layer. Every provider runs the same tools under the same permission gate, so which
 * one answers changes the wording and the latency, never what the person is allowed to see.
 */
export async function ask({
  text,
  ctx,
  photo,
  history,
  apiKey,
  model,
  fallbackModel = FALLBACK_MODEL,
  baseUrl,
  groqKey = "",
  groqModel = "",
  groqBaseUrl = "",
}) {
  const groq = groqKey ? (groqModel || "openai/gpt-oss-120b") : "";

  if (groq) {
    const out = await attempt(
      () => askGroq({ apiKey: groqKey, model: groq, text, ctx, photo, history, baseUrl: groqBaseUrl }),
      groq,
      Boolean(apiKey),
    );
    if (out) return guardMoneyTopic({ ...out, model: groq, photo: !!photo?.data }, ctx);
  }

  if (photo?.data && !apiKey) return photoUnavailable();
  if (apiKey) {
    // The configured model first, then the small one. Both run the same tools under the same gate,
    // so which one answers changes the wording and nothing else.
    const models = [model, fallbackModel].filter((name, index, all) => name && all.indexOf(name) === index);
    for (const [index, name] of models.entries()) {
      // The quota message names metrics and rate-limit dashboards. That is a fact for whoever runs
      // the server, not for the shopkeeper waiting for an answer — so it goes to the log.
      const out = await tryModel({
        apiKey,
        model: name,
        text,
        ctx,
        photo,
        history,
        hasAnother: index < models.length - 1,
        baseUrl,
      });
      if (out) return guardMoneyTopic({ ...out, model: name, photo: !!photo?.data }, ctx);
    }
    // A photo question with no model must not fall through to the keyword router: its default
    // text contains "sale", so it used to answer a receipt photo with today's sales totals.
    if (photo?.data) {
      return photoUnavailable("The writing helper was unavailable, so the photo could not be read.");
    }
    const degraded = await askDeterministic(text, ctx);
    return guardMoneyTopic(
      {
        ...degraded,
        model: "built-in",
        notes: [...(degraded.notes ?? []), "My writing helper is busy, so this answer comes straight from the records."],
      },
      ctx,
    );
  }
  return askDeterministic(text, ctx);
}

export { TOOLS_BY_NAME, Refused };
