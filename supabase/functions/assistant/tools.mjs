/**
 * tools.mjs — every capability the assistant has, and the wall each one sits behind.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 * ------------------------------------
 * There is no SQL tool and no generic "read anything" tool. The model cannot ask for data;
 * it can only ask for one of the named tools below, each of which names the permission it
 * requires. `runTool` checks that permission twice:
 *
 *   1. against the caller's own permission list — the same `get_my_permissions()` the app
 *      reads, so the assistant never offers a tool the app itself would hide;
 *   2. against the DATABASE, by calling `has_permission(code)` as the caller. The database
 *      is the authority on permissions in this system, so the check is not a list this
 *      server cached: if the list and the database ever disagree, the database wins and the
 *      tool refuses. That is what makes step 1 a convenience rather than the wall.
 *
 * Anything the caller is not allowed to see is a tool that does not exist for them. There is
 * no path by which the model can be talked into reading a table directly, and no number in an
 * answer that did not come out of one of these functions.
 *
 * ONE CHANGE FOR ITS NEW HOME: the help corpus is an imported bundle rather than a file read at
 * start-up, so this module needs no filesystem and runs unchanged in the edge runtime. Everything
 * else uses only `fetch` and `Intl`, and every read goes to PostgREST as the signed-in person.
 *
 * MEASURED, NOT ASSUMED (see `npm run selftest`)
 * ---------------------------------------------
 *   owner    Shop Owner     923001234567  → 32 permissions, everything below answers
 *   employee Sales Employee 923001122334  →  6 permissions, `profit_summary` refuses
 *
 * Those two are the repository's own QA identities (tests/setup/fixtures.ts), not accounts made
 * for the assistant — so the wall is measured on the same people the rest of the app is tested
 * with, which is the only way the result says anything about the app.
 *
 * A NOTE ON WHAT THE DATABASE DOES AND DOES NOT ENFORCE
 * ----------------------------------------------------
 * Row-level security here is *tenant* scoping (`shop_id = current_shop_id()`); it is not
 * scoped by permission. An employee who signs in can read `product_variants` over REST,
 * including `cost_price`, even though they hold no `reports.view` — verified during this
 * build, not guessed. So the tool gate is not decoration: for these reads it is the only
 * permission boundary that exists. Two consequences are baked in below:
 *
 *   • `profit_summary` re-checks in the database before it reads anything, and
 *   • `product_stock` asks for `cost_price` in the SELECT only when the caller holds
 *     `reports.view`, so an employee's request never carries cost out of Postgres at all —
 *     not fetched and hidden, never fetched.
 *
 * That gap in raw table access is a finding about the app, and it is reported as one rather
 * than papered over here.
 */
import HELP_TOPICS from "./help-corpus.mjs";

/** The shop's wall clock. Pakistan is UTC+05:00 all year — there is no DST to get wrong. */
const TZ_MINUTES = 300;
const TZ_LABEL = "Asia/Karachi";

// ─── PostgREST, as the signed-in user ────────────────────────────────────────

export class DataError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * A thin REST client that carries the caller's own token.
 *
 * Deliberately thin: it has no service-role path and no way to send SQL. Every request it
 * can make is one PostgREST request with the user's JWT, so row-level security and
 * `current_shop_id()` apply exactly as they do in the app.
 */
export function makeClient({ baseUrl, anonKey, accessToken }) {
  const url = baseUrl.replace(/\/$/, "");
  const auth = { apikey: anonKey, Authorization: `Bearer ${accessToken}` };

  async function request(pathname, init = {}) {
    const res = await fetch(`${url}/rest/v1/${pathname}`, {
      ...init,
      headers: { ...auth, Accept: "application/json", "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const j = JSON.parse(text);
        detail = j.message || j.hint || j.details || text;
      } catch {}
      throw new DataError(detail.slice(0, 300), res.status);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    baseUrl: url,
    /** `select("sales", "select=sale_number&limit=5")` */
    select: (table, query = "") => request(`${table}${query ? `?${query}` : ""}`),
    rpc: (fn, args = {}) =>
      request(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }),
    /** The database's own answer about one permission code. Boolean, never inferred. */
    async hasPermission(code) {
      const data = await request(`rpc/has_permission?p_code=${encodeURIComponent(code)}`);
      return data === true;
    },
    /** The caller's permissions, as the app reads them. */
    async myPermissions() {
      const data = await request("rpc/get_my_permissions");
      return Array.isArray(data) ? data.filter((c) => typeof c === "string") : [];
    },
  };
}

// ─── time, in the shop's day ─────────────────────────────────────────────────

function shopParts(offsetDays = 0) {
  const shifted = new Date(Date.now() + TZ_MINUTES * 60_000);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  const ymd = shifted.toISOString().slice(0, 10);
  const [y, m, d] = ymd.split("-").map(Number);
  return { ymd, year: y, month: m, day: d };
}

/** Midnight, shop time, as the instant the database compares against. */
function dayStartIso(offsetDays = 0) {
  const { ymd } = shopParts(offsetDays);
  return new Date(`${ymd}T00:00:00.000+05:00`).toISOString();
}

export function resolveRange(input = {}) {
  const key = String(input.range ?? (input.from || input.to ? "custom" : "today")).toLowerCase();
  if (input.from || input.to) {
    const from = input.from ? new Date(`${input.from}T00:00:00.000+05:00`) : null;
    const to = input.to ? new Date(new Date(`${input.to}T00:00:00.000+05:00`).getTime() + 86_400_000) : null;
    if (from && Number.isNaN(from.getTime())) throw new DataError(`unreadable date: ${input.from}`, 400);
    if (to && Number.isNaN(to.getTime())) throw new DataError(`unreadable date: ${input.to}`, 400);
    return {
      key: "custom",
      label: `${input.from ?? "the beginning"} to ${input.to ?? "now"}`,
      fromIso: (from ?? new Date("2000-01-01T00:00:00Z")).toISOString(),
      toIso: (to ?? new Date(Date.now() + 86_400_000)).toISOString(),
    };
  }
  switch (key) {
    case "today":
      return { key, label: "today", fromIso: dayStartIso(0), toIso: dayStartIso(1) };
    case "yesterday":
      return { key, label: "yesterday", fromIso: dayStartIso(-1), toIso: dayStartIso(0) };
    case "week":
    case "this week":
      // "This week" means the last seven days: a shopkeeper asking on Monday morning means
      // the days they have just worked, not a Monday-to-Sunday boundary.
      return { key: "week", label: "the last 7 days", fromIso: dayStartIso(-6), toIso: dayStartIso(1) };
    case "month":
      {
        const { year, month } = shopParts();
        const first = `${year}-${String(month).padStart(2, "0")}-01`;
        return {
          key: "month",
          label: "this month",
          fromIso: new Date(`${first}T00:00:00.000+05:00`).toISOString(),
          toIso: dayStartIso(1),
        };
      }
    case "all":
    case "ever":
      return {
        key: "all",
        label: "all time",
        fromIso: "2000-01-01T00:00:00.000Z",
        toIso: new Date(Date.now() + 86_400_000).toISOString(),
      };
    default:
      return { key: "today", label: "today", fromIso: dayStartIso(0), toIso: dayStartIso(1) };
  }
}

// ─── saying numbers out loud ─────────────────────────────────────────────────

const nf = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 });

/** Rs. 41,350 — the written form. */
export function money(n) {
  return `Rs. ${nf.format(Number(n) || 0)}`;
}

/** 41,350 rupees — the spoken form. A voice reads "Rs." as letters, so it never appears. */
export function spokenMoney(n) {
  // Some call sites hand this an already-formatted figure ("3,500" straight out of the facts)
  // rather than a number. `Number("3,500")` is NaN, and `NaN || 0` quietly turned a spoken
  // three thousand five hundred into "0 rupees" — a wrong number read aloud in a shop, which
  // is the one failure this system exists to prevent. Group separators are stripped first, so
  // both a number and a formatted string are read out as the same figure.
  const value = Number(typeof n === "string" ? n.replace(/,/g, "") : n);
  return `${nf.format(Number.isFinite(value) ? value : 0)} rupees`;
}

export function shopTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unknown time";
  return d.toLocaleString("en-GB", {
    timeZone: TZ_LABEL,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── shared reads ────────────────────────────────────────────────────────────

const SALE_COLUMNS =
  "id,sale_number,customer_id,customer_name_snapshot,customer_phone,employee_name,total_amount,amount_paid,amount_due,payment_type,payment_method,is_voided,created_at";

/**
 * The branch predicate is added explicitly for restricted accounts, even though the database's
 * branch policies also enforce it. An owner has no branch restriction; a Co-Owner or employee
 * must never be handed another branch's rows by a tool that forgot to rely on RLS.
 */
function branchFilter(ctx) {
  if (ctx.seeAllBranches === true || ctx.experience === "owner") return "";
  if (!ctx.branchId) {
    throw new DataError("Your branch could not be read, so I cannot show branch records.", 403);
  }
  return `&branch_id=eq.${encodeURIComponent(ctx.branchId)}`;
}

/** Owners may ask for the whole business; everyone else stays on their active branch. */
function seesAllBranches(ctx) {
  return ctx.seeAllBranches === true || ctx.experience === "owner";
}

/** The branch predicate for a read whose scope may be business-wide or one branch. */
function branchScopedFilter(ctx, allBranches) {
  if (seesAllBranches(ctx)) {
    if (allBranches) return "";
    return ctx.branchId ? `&branch_id=eq.${encodeURIComponent(ctx.branchId)}` : "";
  }
  return branchFilter(ctx);
}

/**
 * A customer, supplier or product is only visible to a restricted account when the database
 * says it belongs to that account's active branch. Tenant RLS alone is not enough: one shop can
 * have several branches, and the app's own branch predicates are the authority here too.
 */
async function recordVisibleInBranch(ctx, kind, id) {
  if (seesAllBranches(ctx)) return true;
  if (!ctx.branchId) return false;
  const [fn, key] =
    kind === "customer"
      ? ["customer_in_branch", "p_customer"]
      : kind === "company"
        ? ["company_in_branch", "p_company"]
        : ["product_in_branch", "p_product"];
  try {
    return (await ctx.client.rpc(fn, { [key]: id, p_branch: ctx.branchId })) === true;
  } catch {
    return false;
  }
}

/** Calendar dates in the shop's day, for the date-typed finance/purchase columns. */
function rangeDates(range) {
  const ymd = (iso) =>
    new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_LABEL });
  return {
    from: ymd(range.fromIso),
    to: ymd(new Date(new Date(range.toIso).getTime() - 1).toISOString()),
  };
}

/**
 * Stock as the branch shelf reports it, not the catalogue's shop-wide legacy quantity.
 * `get_branch_variant_stock` is the same read the app's shelf uses, so a branch-specific
 * answer cannot disagree with the screen it is describing.
 */
async function branchStockRows(ctx) {
  const [stock, variants] = await Promise.all([
    ctx.client.rpc("get_branch_variant_stock"),
    ctx.client.select(
      "product_variants",
      "select=id,product_id,name,sku,selling_price,low_stock_threshold,unit_size,qty_step,expiry_date&is_active=eq.true&order=name&limit=1000",
    ),
  ]);
  const qty = new Map(
    (stock ?? []).map((row) => [row.variant_id, Math.max(Number(row.qty) || 0, 0)]),
  );
  return { qty, variants: variants ?? [] };
}

async function productNames(client, ids) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < unique.length; i += 120) {
    const chunk = unique.slice(i, i + 120);
    const rows = await client.select("products", `select=id,name&id=in.(${chunk.join(",")})`);
    for (const row of rows ?? []) names.set(row.id, row.name);
  }
  return names;
}

async function myBranches(ctx) {
  return (await ctx.client.rpc("get_my_branches")) ?? [];
}

/** The product ids on this branch's shelves, read once rather than one RPC per product. */
async function branchProductIds(ctx) {
  if (seesAllBranches(ctx)) return null;
  const rows = await ctx.client.rpc("get_branch_product_ids");
  return new Set((rows ?? []).map((row) => row.product_id ?? row.id ?? row));
}

const BRANCH_ROUTE = (ctx) =>
  ctx.shell === "employee" ? "/more" : "/settings/branches";
const PEOPLE_ROUTE = (ctx) =>
  ctx.shell === "employee" ? "/team" : "/employees";
const FINANCE_ROUTE = (ctx) =>
  ctx.shell === "employee" ? "/finance" : "/settings/hub/finance";

async function salesInRange(ctx, range, branchId = null) {
  let filter = branchFilter(ctx);
  if (branchId) {
    if (!seesAllBranches(ctx) && branchId !== ctx.branchId) {
      throw new DataError("This account cannot see another branch's sales.", 403);
    }
    filter = `&branch_id=eq.${encodeURIComponent(branchId)}`;
  }
  const rows = await ctx.client.select(
    "sales",
    `select=${SALE_COLUMNS}${filter}&created_at=gte.${range.fromIso}&created_at=lt.${range.toIso}&order=created_at.desc&limit=1000`,
  );
  return (rows ?? []).filter((r) => !r.is_voided);
}

/** One variant row per id, for the live-cost fallback the app uses (0159). */
async function liveCosts(client, variantIds, { allowCost }) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!allowCost || !ids.length) return new Map();
  const columns = allowCost ? "id,cost_price" : "id";
  const rows = await client.select("product_variants", `select=${columns}&id=in.(${ids.join(",")})`);
  return new Map((rows ?? []).map((r) => [r.id, r.cost_price == null ? null : Number(r.cost_price)]));
}

/**
 * Revenue, cost and profit for a set of sales — the app's own arithmetic, ported.
 *
 * Copied in behaviour from `src/lib/profit.ts`, including its central rule: **an unknown
 * cost is never a zero cost.** A line with no recorded cost is counted as unknown, the
 * total says how many lines are unknown, and `display` reports whether the figure is exact,
 * a floor, or absent. Presenting a flattering number here would be the single most damaging
 * thing this assistant could do, because an owner acts on profit.
 */
function summariseProfit(sales, items, live = null) {
  let revenue = 0;
  for (const s of sales) revenue += Number(s.total_amount) || 0;

  let cogs = 0;
  let unknownLines = 0;
  let lines = 0;
  for (const it of items) {
    lines++;
    const snapshot = it.cogs_amount == null ? null : Number(it.cogs_amount);
    let cost = snapshot != null && snapshot > 0 ? snapshot : null;
    if (cost == null && live) {
      const unit = live.get(it.variant_id);
      const qty = Number(it.qty) || 0;
      if (unit != null && unit > 0) cost = unit * qty;
    }
    if (cost == null) unknownLines++;
    else cogs += cost;
  }

  const profit = revenue - cogs;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 100) : 0;
  const known = lines - unknownLines;
  const display =
    unknownLines === 0
      ? { kind: "exact", amount: profit, margin }
      : known === 0
        ? { kind: "unknown", unknownLines }
        : { kind: "atLeast", amount: profit, margin, unknownLines };

  return { revenue, cogs, profit, margin, lines, unknownLines, complete: unknownLines === 0, display };
}

// ─── the catalogue ───────────────────────────────────────────────────────────

/** How a deep link is shaped for the shell this person uses. */
export function routeFor(shell, route) {
  return `${shell === "employee" ? "/employee" : "/admin"}${route}`;
}

export const TOOLS = [
  {
    name: "sales_summary",
    title: "Sales totals",
    description:
      "How much was sold, how much was paid at the counter, how much is still owed, and who sold it. Use for 'today's sales', 'sales this week', 'what did I sell yesterday'.",
    permission: "sales.view",
    parameters: {
      type: "object",
      properties: {
        range: {
          type: "string",
          enum: ["today", "yesterday", "week", "month", "all"],
          description: "The period to total. Default today.",
        },
        from: { type: "string", description: "Start date YYYY-MM-DD, when a custom period is asked for." },
        to: { type: "string", description: "End date YYYY-MM-DD, inclusive." },
        branch: { type: "string", description: "Branch name, when the question is about one branch. Owner only; other accounts stay in their active branch." },
      },
    },
    async run(ctx, args) {
      const range = resolveRange(args ?? {});
      const requestedBranch = String(args?.branch ?? "").trim();
      let branch = null;
      if (requestedBranch) {
        const matches = (await myBranches(ctx)).filter((b) =>
          String(b.name ?? "").toLowerCase().includes(requestedBranch.toLowerCase()),
        );
        if (!matches.length) {
          throw new DataError(`I could not find a branch matching "${requestedBranch}".`, 404);
        }
        if (matches.length > 1) {
          throw new DataError(`More than one branch matches "${requestedBranch}". Which one?`, 400);
        }
        branch = matches[0];
      }
      const sales = await salesInRange(ctx, range, branch?.branch_id ?? null);
      let total = 0;
      let paid = 0;
      let credit = 0;
      let biggest = null;
      const byEmployee = new Map();
      for (const s of sales) {
        const amount = Number(s.total_amount) || 0;
        total += amount;
        paid += Number(s.amount_paid) || 0;
        credit += Number(s.amount_due) || 0;
        if (!biggest || amount > Number(biggest.total_amount)) biggest = s;
        const who = s.employee_name || "unknown";
        const prev = byEmployee.get(who) ?? { name: who, count: 0, total: 0 };
        prev.count++;
        prev.total += amount;
        byEmployee.set(who, prev);
      }
      const people = [...byEmployee.values()].sort((a, b) => b.total - a.total);
      const facts = {
        period: range.label,
        scope: branch ? branch.name : seesAllBranches(ctx) ? "all branches" : "current branch",
        branchName: branch?.name ?? null,
        saleCount: sales.length,
        total: nf.format(total),
        paidAtCounter: nf.format(paid),
        stillOwed: nf.format(credit),
        byEmployee: people.map((p) => ({ name: p.name, count: p.count, total: nf.format(p.total) })),
        biggestSale: biggest
          ? { saleNumber: biggest.sale_number, amount: nf.format(Number(biggest.total_amount)), at: shopTime(biggest.created_at) }
          : null,
      };
      const spoken = sales.length
        ? `${range.label === "today" ? "Today" : `For ${range.label}`} ${branch ? branch.name : "the shop"} made ${sales.length} sale${sales.length === 1 ? "" : "s"}, ${spokenMoney(total)} in total. ${spokenMoney(paid)} was taken at the counter and ${spokenMoney(credit)} is still owed.${biggest ? ` The biggest was ${biggest.sale_number} at ${spokenMoney(biggest.total_amount)}.` : ""}`
        : `No sales were recorded ${range.label === "today" ? "today" : `for ${range.label}`}${branch ? ` in ${branch.name}` : ""}.`;
      return {
        title: `Sales ${range.label}${branch ? ` · ${branch.name}` : ""}`,
        spoken,
        facts,
        sources: [{ label: "Sales", route: routeFor(ctx.shell, "/sales") }],
      };
    },
  },

  {
    name: "profit_summary",
    title: "Profit",
    description:
      "Revenue, cost of goods and gross profit for a period, with a margin. Only owners and admins hold this. Use for 'how much profit did I make', 'what is my margin this month'.",
    permission: "reports.view",
    parameters: {
      type: "object",
      properties: {
        range: {
          type: "string",
          enum: ["today", "yesterday", "week", "month", "all"],
          description: "The period to total. Default today.",
        },
        from: { type: "string", description: "Start date YYYY-MM-DD for a custom period." },
        to: { type: "string", description: "End date YYYY-MM-DD, inclusive." },
      },
    },
    async run(ctx, args) {
      // Cost is money: the database is asked again, as the caller, BEFORE any sales, item or
      // cost column is requested. This tool already required reports.view, and this is the
      // second lock — the one that holds even if the first is ever edited by mistake. Checking
      // it after the sale_items read would still refuse the answer, but it would have fetched
      // cogs_amount first; not fetching it is the stronger rule.
      const allowCost = await ctx.client.hasPermission("reports.view");
      if (!allowCost) {
        throw new DataError("This account cannot see cost or profit.", 403);
      }
      const range = resolveRange(args ?? {});
      const sales = await salesInRange(ctx, range);
      const ids = sales.map((s) => s.id);
      let items = [];
      // Chunked: a PostgREST `in.(…)` list with a thousand uuids is a request that fails
      // rather than a request that is slow, and a silent failure here would report profit
      // as pure revenue.
      for (let i = 0; i < ids.length; i += 120) {
        const chunk = ids.slice(i, i + 120);
        const rows = await ctx.client.select(
          "sale_items",
          `select=sale_id,variant_id,product_name,variant_name,qty,line_total,cogs_amount&sale_id=in.(${chunk.join(",")})&limit=2000`,
        );
        items = items.concat(rows ?? []);
      }
      const live = await liveCosts(ctx.client, items.map((i) => i.variant_id), { allowCost: true });
      const summary = summariseProfit(sales, items, live);

      const facts = {
        period: range.label,
        saleCount: sales.length,
        revenue: nf.format(summary.revenue),
        knownCost: nf.format(summary.cogs),
        linesCounted: summary.lines,
        linesWithUnknownCost: summary.unknownLines,
        profitFigureIs: summary.display.kind,
        profit: nf.format(summary.profit),
        marginPercent: summary.margin,
      };
      const spoken =
        summary.display.kind === "exact"
          ? `For ${range.label} revenue was ${spokenMoney(summary.revenue)}, goods cost ${spokenMoney(summary.cogs)}, so the profit was ${spokenMoney(summary.profit)} — a margin of ${summary.margin} percent.`
          : summary.display.kind === "atLeast"
            ? `For ${range.label} revenue was ${spokenMoney(summary.revenue)}. The cost of ${summary.unknownLines} line${summary.unknownLines === 1 ? "" : "s"} was never recorded, so the profit is at least ${spokenMoney(summary.profit)} — the real figure is lower. The margin shown is ${summary.margin} percent.`
            : `I cannot give you a profit figure for ${range.label}: the shop never recorded a cost for any of the ${summary.lines} lines sold. Revenue was ${spokenMoney(summary.revenue)}, and the profit on it is simply not known.`;
      return {
        title: `Profit ${range.label}`,
        spoken,
        facts,
        notes: summary.complete
          ? []
          : [
              `${summary.unknownLines} of ${summary.lines} lines have no recorded cost, so this profit is an upper bound — the app says the same thing on Reports.`,
            ],
        sources: [{ label: "Reports", route: routeFor(ctx.shell, "/reports") }],
      };
    },
  },

  {
    name: "customer_account",
    title: "A customer's account",
    description:
      "What a customer owes, their credit limit, whether they are over it, and what they bought last. Use for 'how much credit does Yaqoob have', 'what was this customer's last purchase', 'is he over his limit'.",
    permission: "customers.view",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer name, or part of it." },
        phone: { type: "string", description: "Customer phone number, or part of it." },
      },
    },
    async run(ctx, args) {
      const term = String(args?.name ?? args?.phone ?? "").trim();
      if (!term) throw new DataError("Which customer? Give a name or a number.", 400);
      const safe = term.replace(/[(),*]/g, "").slice(0, 60);
      const matches = await ctx.client.select(
        "customers",
        `select=id,name,phone,credit_limit,outstanding_balance,total_purchases,total_paid,due_date,is_archived&or=(name.ilike.*${encodeURIComponent(safe)}*,phone.ilike.*${encodeURIComponent(safe)}*)&order=outstanding_balance.desc&limit=10`,
      );
      let rows = matches ?? [];
      if (!seesAllBranches(ctx) && rows.length) {
        const visible = [];
        for (const customer of rows) {
          if (await recordVisibleInBranch(ctx, "customer", customer.id)) visible.push(customer);
        }
        rows = visible;
      }
      if (!rows.length) {
        return {
          title: "No such customer",
          spoken: `I could not find a customer matching "${term}" in this shop.`,
          facts: { query: term, matches: 0 },
          sources: [{ label: "Customers", route: routeFor(ctx.shell, "/customers") }],
        };
      }
      if (rows.length > 1) {
        return {
          title: "Which customer?",
          // Asked rather than guessed: picking the wrong Yaqoob and reading his balance aloud
          // is worse than one extra question.
          spoken: `I found ${rows.length} customers matching "${term}". Which one — ${rows
            .slice(0, 4)
            .map((r) => `${r.name}${r.phone ? `, ${r.phone}` : ""}`)
            .join("; ")}?`,
          facts: {
            ambiguous: true,
            candidates: rows.map((r) => ({
              name: r.name,
              phone: r.phone ?? null,
              owed: nf.format(Number(r.outstanding_balance) || 0),
            })),
          },
          sources: [{ label: "Customers", route: routeFor(ctx.shell, "/customers") }],
        };
      }
      const c = rows[0];
      const owed = Number(c.outstanding_balance) || 0;
      const limit = Number(c.credit_limit) || 0;
      const standing = owed <= 0 ? "clear" : limit > 0 && owed >= limit ? "over limit" : limit > 0 && owed >= limit * 0.8 ? "near the limit" : "within the limit";
      const recent = (
        await ctx.client.select(
          "sales",
          `select=sale_number,total_amount,amount_paid,amount_due,employee_name,customer_name_snapshot,created_at,is_voided&customer_id=eq.${c.id}${branchFilter(ctx)}&order=created_at.desc&limit=5`,
        )
      ) ?? [];
      const last = recent[0];
      const facts = {
        name: c.name,
        phone: c.phone ?? null,
        owes: nf.format(owed),
        creditLimit: nf.format(limit),
        standing,
        totalBoughtEver: nf.format(Number(c.total_purchases) || 0),
        totalPaidEver: nf.format(Number(c.total_paid) || 0),
        dueDate: c.due_date ?? null,
        archived: !!c.is_archived,
        lastPurchase: last
          ? {
              saleNumber: last.sale_number,
              amount: nf.format(Number(last.total_amount)),
              owedOnIt: nf.format(Number(last.amount_due)),
              at: shopTime(last.created_at),
              soldBy: last.employee_name,
            }
          : null,
        recentPurchases: recent.map((sale) => ({
          saleNumber: sale.sale_number,
          amount: nf.format(Number(sale.total_amount)),
          owedOnIt: nf.format(Number(sale.amount_due)),
          at: shopTime(sale.created_at),
          soldBy: sale.employee_name,
        })),
      };
      const spoken = last
        ? `${c.name} owes ${spokenMoney(owed)}${limit > 0 ? `, against a limit of ${spokenMoney(limit)} — he is ${standing}.` : ", and has no credit limit set."} His last purchase was ${last.sale_number} on ${shopTime(last.created_at)}, ${spokenMoney(last.total_amount)}, sold by ${last.employee_name}.`
        : `${c.name} owes ${spokenMoney(owed)}${limit > 0 ? `, against a limit of ${spokenMoney(limit)} — he is ${standing}.` : "."} There is no purchase recorded for him yet.`;
      return {
        title: c.name,
        spoken,
        facts,
        notes: c.is_archived ? ["This customer is archived."] : [],
        sources: [
          { label: `Open ${c.name}`, route: routeFor(ctx.shell, `/customers/${c.id}`) },
          { label: "Purchase history", route: routeFor(ctx.shell, `/customers/${c.id}/purchases`) },
        ],
      };
    },
  },

  {
    name: "product_stock",
    title: "Stock and prices of a product",
    description:
      "How much of a product is on the shelf, per pack, what it sells for, and whether it is running low. Use for 'how much Lambda is left', 'what is the price of Targa'.",
    permission: "products.view",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Product name, or part of it." } },
      required: ["name"],
    },
    async run(ctx, args) {
      const term = String(args?.name ?? "").trim();
      if (!term) throw new DataError("Which product?", 400);
      const safe = term.replace(/[(),*%]/g, "").slice(0, 60);
      // `products` has `company_id`, not `company` — the old column was replaced by a real
      // reference, and asking for the old name makes PostgREST reject the whole read.
      const products = await ctx.client.select(
        "products",
        `select=id,name,company_id,category,barcode,is_active&name=ilike.*${encodeURIComponent(safe)}*&order=name&limit=10`,
      );
      const found = products ?? [];
      const visibleIds = await branchProductIds(ctx);
      const rows = found.filter((product) => !visibleIds || visibleIds.has(product.id));
      if (!rows.length) {
        return {
          title: "No such product",
          spoken: `I could not find a product matching "${term}" in this branch.`,
          facts: { query: term, matches: 0 },
          sources: [{ label: "Products", route: routeFor(ctx.shell, "/products") }],
        };
      }
      // Cost is read only when this account may see money — see the note at the top of this
      // file. An employee's query does not name the column at all.
      const allowCost = await ctx.client.hasPermission("reports.view");
      const branchStock = await branchStockRows(ctx);
      const variants = branchStock.variants.filter((v) => rows.some((p) => p.id === v.product_id));
      let costs = new Map();
      if (allowCost && variants.length) {
        const costRows = await ctx.client.select(
          "product_variants",
          `select=id,cost_price&id=in.(${variants.map((v) => v.id).join(",")})`,
        );
        costs = new Map((costRows ?? []).map((v) => [v.id, v.cost_price == null ? null : Number(v.cost_price)]));
      }
      const byProduct = new Map();
      for (const v of variants) {
        const list = byProduct.get(v.product_id) ?? [];
        list.push(v);
        byProduct.set(v.product_id, list);
      }
      // The supplier's name, when the product is linked to one. Missing is missing: a product
      // with no company is not "by unknown".
      const companyIds = [...new Set(rows.map((p) => p.company_id).filter(Boolean))];
      const companies = new Map();
      if (companyIds.length) {
        const list = await ctx.client.select("companies", `select=id,name&id=in.(${companyIds.join(",")})`);
        for (const c of list ?? []) companies.set(c.id, c.name);
      }
      const shaped = rows.map((p) => ({
        product: p.name,
        company: companies.get(p.company_id) ?? null,
        category: p.category ?? null,
        barcode: p.barcode ?? null,
        packs: (byProduct.get(p.id) ?? []).map((v) => {
          const stock = branchStock.qty.get(v.id) ?? 0;
          return {
            pack: v.name,
            stock,
            unitSize: Number(v.unit_size ?? 1),
            sellingPrice: nf.format(Number(v.selling_price) || 0),
            lowStockThreshold: Number(v.low_stock_threshold ?? 0),
            low: stock <= Number(v.low_stock_threshold ?? 0),
            expiry: v.expiry_date ?? null,
            ...(allowCost ? { costPrice: costs.get(v.id) == null ? null : nf.format(costs.get(v.id)) } : {}),
          };
        }),
      }));
      const first = shaped[0];
      const low = first.packs.filter((p) => p.low);
      const spoken = first.packs.length
        ? `${first.product}${first.company ? ` by ${first.company}` : ""}: ${first.packs
            .map((p) => `${p.pack} has ${p.stock} left at ${spokenMoney(p.sellingPrice)}${p.low ? ", which is low stock" : ""}`)
            .join("; ")}.`
        : `There is no active pack recorded for ${first.product}, so there is no stock to report.`;
      return {
        title: first.product,
        spoken,
        facts: { products: shaped, lowPacks: low.length },
        notes: allowCost ? [] : ["Cost prices are not shown to this account."],
        sources: first.product ? [{ label: first.product, route: routeFor(ctx.shell, `/products/${rows[0].id}`) }] : [],
      };
    },
  },

  {
    name: "low_stock",
    title: "What is running out",
    description:
      "Every pack at or below its low-stock threshold. Use for 'what is running out', 'what do I need to reorder', 'which stock is low'.",
    permission: "inventory.view",
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      const { qty, variants } = await branchStockRows(ctx);
      const low = variants.filter(
        (v) => (qty.get(v.id) ?? 0) <= Number(v.low_stock_threshold ?? 0),
      );
      const names = await productNames(ctx.client, low.map((v) => v.product_id));
      const items = low.map((v) => ({
        product: names.get(v.product_id) ?? "unknown product",
        pack: v.name,
        stock: qty.get(v.id) ?? 0,
        threshold: Number(v.low_stock_threshold ?? 0),
      }));
      const spoken = items.length
        ? `${items.length} pack${items.length === 1 ? " is" : "s are"} at or below the low-stock level. ${items
            .slice(0, 6)
            .map((i) => `${i.product} ${i.pack} is down to ${i.stock}`)
            .join("; ")}.`
        : "Nothing is at or below its low-stock level right now.";
      return {
        title: "Low stock",
        spoken,
        facts: { count: items.length, items: items.slice(0, 40) },
        sources: [{ label: "Reorder suggestions", route: routeFor(ctx.shell, "/inventory/reorder") }],
      };
    },
  },

  {
    name: "sale_lookup",
    title: "One sale, by number or amount",
    description:
      "Find a sale and report when it happened, who sold it, who bought it, what was in it and how much is still owed on it. Use for 'when was the last sale', 'who made the last sale', 'when was this sale generated', 'who generated sale 62727', 'find the 4750 sale', or after reading a number from a receipt photo. Call it with no arguments for the most recent sales.",
    permission: "sales.view",
    parameters: {
      type: "object",
      properties: {
        sale_number: { type: "string", description: "The sale number, e.g. SALE-62727, or just 62727." },
        amount: { type: "number", description: "The total of the sale, when the number is not known." },
        customer: { type: "string", description: "Customer name, to list their recent sales." },
      },
    },
    async run(ctx, args) {
      const wanted = String(args?.sale_number ?? "").trim();
      const amount = args?.amount == null ? null : Number(args.amount);
      const customer = String(args?.customer ?? "").trim();
      let rows = [];
      let how = "";
      // "When was the last sale?" is a complete question, and a tool that answers it with
      // "tell me a sale number" is refusing the easy half of its own job. With nothing to
      // search for, the most recent sales ARE the answer.
      if (!wanted && amount == null && !customer) {
        rows = await ctx.client.select(
          "sales",
          `select=${SALE_COLUMNS}${branchFilter(ctx)}&order=created_at.desc&limit=5`,
        );
        how = "the most recent sales";
      }
      if (wanted) {
        const digits = wanted.replace(/[^0-9]/g, "");
        const term = digits || wanted;
        rows = await ctx.client.select(
          "sales",
          `select=${SALE_COLUMNS}${branchFilter(ctx)}&sale_number=ilike.*${encodeURIComponent(term)}*&order=created_at.desc&limit=10`,
        );
        how = `sale number ${wanted}`;
      } else if (amount != null && Number.isFinite(amount)) {
        rows = await ctx.client.select(
          "sales",
          `select=${SALE_COLUMNS}${branchFilter(ctx)}&total_amount=eq.${amount}&order=created_at.desc&limit=10`,
        );
        how = `a total of ${nf.format(amount)}`;
      } else if (customer) {
        const safe = customer.replace(/[(),*]/g, "").slice(0, 60);
        rows = await ctx.client.select(
          "sales",
          `select=${SALE_COLUMNS}${branchFilter(ctx)}&customer_name_snapshot=ilike.*${encodeURIComponent(safe)}*&order=created_at.desc&limit=5`,
        );
        how = `sales to ${customer}`;
      } else if (!how) {
        throw new DataError("Tell me the sale number or the amount, and I will find it.", 400);
      }
      const found = rows ?? [];
      if (!found.length && how === "the most recent sales") {
        return {
          title: "No sales yet",
          spoken: "No sale has been recorded in this shop yet.",
          facts: { matches: 0 },
          sources: [{ label: "Sales", route: routeFor(ctx.shell, "/sales") }],
        };
      }
      if (!found.length) {
        return {
          title: "No such sale",
          spoken: `I found no sale in this shop matching ${how}.`,
          facts: { searched: how, matches: 0 },
          sources: [{ label: "Sales", route: routeFor(ctx.shell, "/sales") }],
        };
      }
      const items = await ctx.client.select(
        "sale_items",
        `select=sale_id,product_name,variant_name,qty,unit_price,unit_size,base_unit,line_total&sale_id=in.(${found.map((s) => s.id).join(",")})&limit=200`,
      );
      const bySale = new Map();
      for (const it of items ?? []) {
        const list = bySale.get(it.sale_id) ?? [];
        list.push(it);
        bySale.set(it.sale_id, list);
      }
      const shaped = found.map((s) => ({
        saleNumber: s.sale_number,
        when: shopTime(s.created_at),
        soldBy: s.employee_name || "not recorded",
        customer: s.customer_name_snapshot,
        total: nf.format(Number(s.total_amount) || 0),
        paid: nf.format(Number(s.amount_paid) || 0),
        stillOwed: nf.format(Number(s.amount_due) || 0),
        payment: `${s.payment_type ?? ""} ${s.payment_method ?? ""}`.trim(),
        voided: !!s.is_voided,
        lines: (bySale.get(s.id) ?? []).map((it) => ({
          item: `${it.product_name} ${it.variant_name}`.trim(),
          qty: Number(it.qty) || 0,
          unitPrice: nf.format(Number(it.unit_price) || 0),
          lineTotal: nf.format(Number(it.line_total) || 0),
        })),
      }));
      const one = shaped[0];
      const spoken =
        shaped.length === 1
          ? `${one.saleNumber} was made on ${one.when} by ${one.soldBy}, for ${one.customer}. The total was ${spokenMoney(one.total)}.${Number(one.lines.length) ? ` It contained ${one.lines.map((l) => `${l.qty} ${l.item}`).join(", ")}.` : ""}${one.voided ? " This sale was voided." : ""}`
          : `${how === "the most recent sales" ? `The last ${shaped.length} sales` : `I found ${shaped.length} sales matching ${how}`}. The most recent was ${one.saleNumber} on ${one.when}, by ${one.soldBy}, ${spokenMoney(one.total)}, for ${one.customer}.`;
      return {
        title: `Sale ${one.saleNumber}`,
        spoken,
        facts: { searchedFor: how, matches: shaped.length, sales: shaped },
        sources: [
          { label: `Open ${one.saleNumber}`, route: routeFor(ctx.shell, `/sales/${found[0].id}`) },
        ],
      };
    },
  },

  {
    name: "supplier_dues",
    title: "What the shop owes suppliers",
    description:
      "Supplier payables and how much is outstanding. Use for 'how much do I owe the suppliers', 'what is left on Bayer'.",
    permission: "companies.view",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Supplier name, or part of it. Omit for all." } },
    },
    async run(ctx, args) {
      const term = String(args?.name ?? "").trim();
      const safe = term.replace(/[(),*]/g, "").slice(0, 60);
      const filter = safe ? `&name=ilike.*${encodeURIComponent(safe)}*` : "";
      const rows = await ctx.client.select(
        "companies",
        `select=id,name,contact_person,phone,outstanding_payable,due_date,is_active&order=outstanding_payable.desc&limit=100${filter}`,
      );
      const visible = [];
      for (const company of rows ?? []) {
        if (await recordVisibleInBranch(ctx, "company", company.id)) visible.push(company);
      }
      const branchBalances = !seesAllBranches(ctx)
        ? new Map(
            ((await ctx.client.rpc("get_branch_company_balances")) ?? []).map((b) => [
              b.company_id,
              Number(b.outstanding_payable) || 0,
            ]),
          )
        : null;
      const owing = visible
        .map((c) => ({
          ...c,
          branchOwed: branchBalances ? branchBalances.get(c.id) ?? 0 : Number(c.outstanding_payable) || 0,
        }))
        .filter((c) => c.branchOwed > 0);
      const total = owing.reduce((sum, c) => sum + c.branchOwed, 0);
      const spoken = owing.length
        ? `${spokenMoney(total)} is owed to suppliers. ${owing
            .slice(0, 5)
            .map((c) => `${c.name}, ${spokenMoney(c.branchOwed)}`)
            .join("; ")}.`
        : term
          ? `Nothing is owed to a supplier matching "${term}".`
          : "Nothing is owed to any supplier right now.";
      return {
        title: "Supplier dues",
        spoken,
        facts: {
          totalOwed: nf.format(total),
          suppliers: owing.map((c) => ({
            name: c.name,
            owed: nf.format(c.branchOwed),
            phone: c.phone ?? null,
            dueDate: c.due_date ?? null,
          })),
        },
        sources: [{ label: "Suppliers", route: routeFor(ctx.shell, "/companies") }],
      };
    },
  },

  {
    name: "employee_activity",
    title: "What an employee has been doing",
    description:
      "Recent recorded activity, and sales totals by employee. Use for 'what has Ali been doing', 'who is selling the most', 'show me the activity log'.",
    permission: "activity.view",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Employee name, or part of it. Omit for everyone." },
        range: {
          type: "string",
          enum: ["today", "yesterday", "week", "month", "all"],
          description: "The period. Default today.",
        },
      },
    },
    async run(ctx, args) {
      const range = resolveRange(args ?? {});
      const term = String(args?.name ?? "").trim();
      const safe = term.replace(/[(),*]/g, "").slice(0, 60);
      // `activity.view` is the log's permission, not sales.view. The log page does not hand an
      // activity-only role every sale total, so this tool must not either. Ask the database as
      // well as the cached list before any row from `sales` is read.
      const canSeeSales =
        ctx.permissions.includes("sales.view") &&
        (await ctx.client.hasPermission("sales.view").catch(() => false));
      const sales = canSeeSales ? await salesInRange(ctx, range) : [];
      const byEmployee = new Map();
      for (const s of sales) {
        const who = s.employee_name || "not recorded";
        if (safe && !who.toLowerCase().includes(safe.toLowerCase())) continue;
        const prev = byEmployee.get(who) ?? { name: who, count: 0, total: 0 };
        prev.count++;
        prev.total += Number(s.total_amount) || 0;
        byEmployee.set(who, prev);
      }
      const log = await ctx.client.select(
        "activity_log",
        `select=action,entity_type,entity_id,details,created_at,user_id${branchFilter(ctx)}&created_at=gte.${range.fromIso}&created_at=lt.${range.toIso}&order=created_at.desc&limit=200`,
      );
      const people = [...byEmployee.values()].sort((a, b) => b.total - a.total);
      const events = (log ?? []).map((e) => ({
        action: e.action,
        entity: e.entity_type,
        at: shopTime(e.created_at),
        details: e.details && typeof e.details === "object" ? e.details : null,
      }));
      const spoken = people.length
        ? `For ${range.label}: ${people
            .slice(0, 5)
            .map((p) => `${p.name} made ${p.count} sale${p.count === 1 ? "" : "s"} worth ${spokenMoney(p.total)}`)
            .join("; ")}.${events.length ? ` The activity log has ${events.length} entries in that period.` : " The activity log recorded nothing in that period."}`
        : events.length
          ? `The activity log has ${events.length} entries for ${term ? `${term} in ` : ""}${range.label}.`
          : canSeeSales
            ? `There is nothing recorded for ${term ? `${term} in ` : ""}${range.label} — no sales and no activity entries.`
            : `The activity log has no entries for ${term ? `${term} in ` : ""}${range.label}.`;
      return {
        title: "Employee activity",
        spoken,
        facts: {
          period: range.label,
          canSeeSales,
          salesByEmployee: people.map((p) => ({ name: p.name, count: p.count, total: nf.format(p.total) })),
          activityCount: events.length,
          activity: events.slice(0, 40),
        },
        notes: events.length === 0 && people.length > 0
          ? ["The activity log itself has no entries for this period, so this is sales only."]
          : [],
        sources: [{ label: "Activity log", route: routeFor(ctx.shell, "/activity") }],
      };
    },
  },

  {
    name: "branch_overview",
    title: "Branches",
    description:
      "The branches this account can see, where they are, who works there, and (for money roles) each branch's sales, stock value and customer credit. Use for 'which branches do I have', 'where is my shop', 'branch details', 'how is each branch doing'.",
    permission: null,
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      const rows = await myBranches(ctx);
      const showSales = ctx.permissions.includes("sales.view");
      const showInventory = ctx.permissions.includes("reports.view");
      const showCredit = ctx.permissions.includes("customers.view") || ctx.permissions.includes("reports.view");
      const shaped = rows.map((b) => ({
        id: b.branch_id,
        name: b.name,
        address: b.address ?? null,
        isCurrent: b.is_current === true,
        isMain: b.is_main === true,
        employeeCount: b.employee_count == null ? null : Number(b.employee_count),
        productCount: b.product_count == null ? null : Number(b.product_count),
        customerCount: b.customer_count == null ? null : Number(b.customer_count),
        ...(showSales
          ? {
              salesCount: b.sales_count == null ? null : Number(b.sales_count),
              salesTotal: b.sales_total == null ? null : nf.format(Number(b.sales_total)),
            }
          : {}),
        ...(showInventory
          ? {
              inventoryValue: b.inventory_value == null ? null : nf.format(Number(b.inventory_value)),
              inventoryCostIncomplete: b.inventory_cost_incomplete === true,
            }
          : {}),
        ...(showCredit
          ? { creditOutstanding: b.credit_outstanding == null ? null : nf.format(Number(b.credit_outstanding)) }
          : {}),
      }));
      const current = shaped.find((b) => b.isCurrent);
      const spoken = shaped.length
        ? `${shaped.length} branch${shaped.length === 1 ? "" : "es"} are available: ${shaped
            .map((b) => `${b.name}${b.address ? ` at ${b.address}` : ""}${b.isCurrent ? " (current)" : ""}`)
            .join("; ")}.`
        : "No branch is available to this account.";
      return {
        title: `Branches`,
        spoken,
        facts: {
          scope: seesAllBranches(ctx) ? "all branches" : "your branches",
          count: shaped.length,
          currentBranch: current?.name ?? null,
          branches: shaped,
        },
        sources: [{ label: "Branches", route: routeFor(ctx.shell, BRANCH_ROUTE(ctx)) }],
      };
    },
  },

  {
    name: "employee_directory",
    title: "The team",
    description:
      "The people who work in the shop or a branch: names, phone numbers, job titles, roles and which branches they belong to. Use for 'who works here', 'list the employees', 'who is in Branch A', 'what is Ali's number'.",
    permission: "employees.view",
    parameters: {
      type: "object",
      properties: { branch: { type: "string", description: "Branch name or part of it. Omit for every branch this account can see." } },
    },
    async run(ctx, args) {
      const rows = await ctx.client.rpc("get_shop_members");
      const branches = await myBranches(ctx);
      const branchById = new Map(branches.map((b) => [b.branch_id, b.name]));
      const term = String(args?.branch ?? "").trim().toLowerCase();
      const restricted = !seesAllBranches(ctx);
      const allowed = new Set(ctx.branchScope ?? []);
      const people = (rows ?? []).filter((r) => {
        if (r.is_original_owner) return false;
        if (r.membership_role === "owner" || r.membership_role === "co_owner") return false;
        if (restricted) {
          const scope = Array.isArray(r.branch_scope) ? r.branch_scope : [];
          if (scope.length && !scope.some((id) => allowed.has(id))) return false;
        }
        if (!term) return true;
        const names = (Array.isArray(r.branch_scope) ? r.branch_scope : [])
          .map((id) => branchById.get(id) ?? "")
          .join(" ");
        return `${r.name} ${r.phone ?? ""} ${r.job_title ?? ""} ${names}`.toLowerCase().includes(term);
      });
      const shaped = people.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone ?? null,
        role: r.job_title || r.role || "employee",
        status:
          r.membership_status === "pending"
            ? "pending"
            : r.is_active === false
              ? "deactivated"
              : "active",
        branchNames: (Array.isArray(r.branch_scope) ? r.branch_scope : [])
          .map((id) => branchById.get(id) ?? "unknown branch"),
        employeeNumber: r.employee_number ?? null,
      }));
      const spoken = shaped.length
        ? `${shaped.length} employee${shaped.length === 1 ? "" : "s"}${term ? ` matching ${args.branch}` : ""}: ${shaped
            .slice(0, 8)
            .map((p) => `${p.name}${p.role ? `, ${p.role}` : ""}${p.branchNames.length ? ` in ${p.branchNames.join(" and ")}` : " across all branches"}`)
            .join("; ")}.`
        : `No employee${term ? ` matching ${args.branch}` : ""} is visible to this account.`;
      return {
        title: "The team",
        spoken,
        facts: { count: shaped.length, employees: shaped },
        sources: [{ label: "Employees", route: routeFor(ctx.shell, PEOPLE_ROUTE(ctx)) }],
      };
    },
  },

  {
    name: "employee_performance",
    title: "An employee's performance",
    description:
      "One employee's sales, customers, items sold, branch breakdown and recent sales. Use for 'how is Ali selling', 'Ali's performance', 'how many sales did the employee make', 'which products did Ali sell'.",
    permission: "employees.view",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "Employee name, or part of it." } },
      required: ["name"],
    },
    async run(ctx, args) {
      const term = String(args?.name ?? "").trim();
      if (!term) throw new DataError("Which employee? Give a name.", 400);
      const members = (await ctx.client.rpc("get_shop_members")) ?? [];
      const candidates = members.filter(
        (r) =>
          !r.is_original_owner &&
          r.membership_role !== "owner" &&
          r.membership_role !== "co_owner" &&
          String(r.name ?? "").toLowerCase().includes(term.toLowerCase()),
      );
      if (!candidates.length) {
        return {
          title: "No such employee",
          spoken: `I could not find an employee matching "${term}" in this shop.`,
          facts: { query: term, matches: 0 },
          sources: [{ label: "Employees", route: routeFor(ctx.shell, PEOPLE_ROUTE(ctx)) }],
        };
      }
      if (candidates.length > 1) {
        return {
          title: "Which employee?",
          spoken: `I found ${candidates.length} employees matching "${term}". Which one — ${candidates
            .slice(0, 5)
            .map((r) => r.name)
            .join("; ")}?`,
          facts: { ambiguous: true, candidates: candidates.map((r) => ({ name: r.name, phone: r.phone ?? null })) },
          sources: [{ label: "Employees", route: routeFor(ctx.shell, PEOPLE_ROUTE(ctx)) }],
        };
      }
      const target = candidates[0];
      const allowed = new Set(ctx.branchScope ?? []);
      if (!seesAllBranches(ctx)) {
        const scope = Array.isArray(target.branch_scope) ? target.branch_scope : [];
        if (!scope.length || !scope.some((id) => allowed.has(id))) {
          throw new DataError("This account cannot see that employee outside its branch.", 403);
        }
      }
      const perf = await ctx.client.rpc("get_employee_performance", { p_employee_id: target.id });
      if (!perf) throw new DataError("That employee's performance could not be read.", 502);
      const branchRows = (Array.isArray(perf.branches) ? perf.branches : []).filter(
        (b) => seesAllBranches(ctx) || (!!b.branchId && allowed.has(b.branchId)),
      );
      const recent = (Array.isArray(perf.recent) ? perf.recent : []).filter(
        (s) => seesAllBranches(ctx) || (!!s.branchId && allowed.has(s.branchId)),
      );
      // The RPC totals cover the employee's whole membership. Recompute from the branches this
      // caller may read so a restricted account never receives another branch's arithmetic.
      const totals = branchRows.reduce(
        (sum, b) => ({
          salesCount: sum.salesCount + (Number(b.salesCount) || 0),
          revenue: sum.revenue + (Number(b.revenue) || 0),
          itemsSold: sum.itemsSold + (Number(b.itemsSold) || 0),
          customers: sum.customers + (Number(b.customers) || 0),
          todaySales: sum.todaySales + (Number(b.todaySales) || 0),
          todayRevenue: sum.todayRevenue + (Number(b.todayRevenue) || 0),
        }),
        { salesCount: 0, revenue: 0, itemsSold: 0, customers: 0, todaySales: 0, todayRevenue: 0 },
      );
      const items = recent.length
        ? await ctx.client.select(
            "sale_items",
            `select=sale_id,product_name,variant_name,qty,line_total&sale_id=in.(${recent.map((s) => s.id).join(",")})&limit=500`,
          )
        : [];
      const products = new Map();
      for (const item of items ?? []) {
        const name = `${item.product_name} ${item.variant_name ?? ""}`.trim();
        const row = products.get(name) ?? { name, qty: 0, total: 0 };
        row.qty += Number(item.qty) || 0;
        row.total += Number(item.line_total) || 0;
        products.set(name, row);
      }
      const shapedBranches = branchRows.map((b) => ({
        branchName: b.branchName ?? "unknown branch",
        roleName: b.roleName ?? null,
        salesCount: Number(b.salesCount) || 0,
        revenue: nf.format(Number(b.revenue) || 0),
        itemsSold: Number(b.itemsSold) || 0,
        customers: Number(b.customers) || 0,
        todaySales: Number(b.todaySales) || 0,
        todayRevenue: nf.format(Number(b.todayRevenue) || 0),
      }));
      const spoken = totals.salesCount
        ? `${target.name} made ${totals.salesCount} sale${totals.salesCount === 1 ? "" : "s"} worth ${spokenMoney(totals.revenue)}, sold ${totals.itemsSold} items to ${totals.customers} customers${shapedBranches.length ? ` across ${shapedBranches.map((b) => b.branchName).join(" and ")}` : ""}. Today: ${totals.todaySales} sale${totals.todaySales === 1 ? "" : "s"} worth ${spokenMoney(totals.todayRevenue)}.`
        : `${target.name} has no recorded sales in the branches this account can see.`;
      return {
        title: target.name,
        spoken,
        facts: {
          employeeName: target.name,
          phone: target.phone ?? null,
          role: target.job_title || target.role || "employee",
          totals: {
            salesCount: totals.salesCount,
            revenue: nf.format(totals.revenue),
            itemsSold: totals.itemsSold,
            customers: totals.customers,
            todaySales: totals.todaySales,
            todayRevenue: nf.format(totals.todayRevenue),
          },
          branches: shapedBranches,
          recent: recent.slice(0, 10).map((s) => ({
            saleNumber: s.saleNumber ?? s.sale_number ?? null,
            customer: s.customerName ?? null,
            total: nf.format(Number(s.totalAmount) || 0),
            at: s.createdAt ? shopTime(s.createdAt) : null,
            branchName: s.branchName ?? null,
          })),
          products: [...products.values()]
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 10)
            .map((p) => ({ name: p.name, qty: p.qty, total: nf.format(p.total) })),
        },
        sources: [{ label: `${target.name}'s performance`, route: routeFor(ctx.shell, `/employees/${target.id}`) }],
      };
    },
  },

  {
    name: "purchases_overview",
    title: "Purchases",
    description:
      "Stock bought from suppliers in a period: how much was purchased, paid, still owed, and the recent purchase bills. Use for 'purchases today', 'what did I buy this month', 'stock in', 'supplier bills', 'how much do I owe on purchases'.",
    permission: "purchases.view",
    parameters: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["today", "yesterday", "week", "month", "all"], description: "The period. Default today." },
        from: { type: "string", description: "Start date YYYY-MM-DD for a custom period." },
        to: { type: "string", description: "End date YYYY-MM-DD, inclusive." },
        scope: { type: "string", enum: ["current", "all"], description: "Owner only: current branch or the whole business. Default all." },
      },
    },
    async run(ctx, args) {
      const range = resolveRange(args ?? {});
      const all = seesAllBranches(ctx) && args?.scope !== "current";
      const filter = branchScopedFilter(ctx, all);
      const rows = await ctx.client.select(
        "purchases",
        `select=id,purchase_number,company_name,company_id,total_amount,amount_paid,amount_due,status,payment_method,recorded_by_name,created_at${filter}&created_at=gte.${range.fromIso}&created_at=lt.${range.toIso}&order=created_at.desc&limit=500`,
      );
      const list = rows ?? [];
      const total = list.reduce((sum, p) => sum + (Number(p.total_amount) || 0), 0);
      const paid = list.reduce((sum, p) => sum + (Number(p.amount_paid) || 0), 0);
      const owed = list.reduce((sum, p) => sum + (Number(p.amount_due) || 0), 0);
      const bySupplier = new Map();
      for (const p of list) {
        const name = p.company_name || "unknown supplier";
        const row = bySupplier.get(name) ?? { name, count: 0, total: 0, owed: 0 };
        row.count++;
        row.total += Number(p.total_amount) || 0;
        row.owed += Number(p.amount_due) || 0;
        bySupplier.set(name, row);
      }
      const suppliers = [...bySupplier.values()].sort((a, b) => b.total - a.total);
      const spoken = list.length
        ? `For ${range.label}, ${all ? "the business" : "this branch"} recorded ${list.length} purchase${list.length === 1 ? "" : "s"} totalling ${spokenMoney(total)}. ${spokenMoney(paid)} was paid and ${spokenMoney(owed)} is still owed.`
        : `No purchases were recorded ${range.label === "today" ? "today" : `for ${range.label}`}${all ? " in the business" : " in this branch"}.`;
      return {
        title: `Purchases ${range.label}`,
        spoken,
        facts: {
          period: range.label,
          scope: all ? "all branches" : "current branch",
          count: list.length,
          total: nf.format(total),
          paid: nf.format(paid),
          owed: nf.format(owed),
          suppliers: suppliers.map((s) => ({ name: s.name, count: s.count, total: nf.format(s.total), owed: nf.format(s.owed) })),
          purchases: list.slice(0, 25).map((p) => ({
            number: p.purchase_number,
            supplier: p.company_name ?? null,
            total: nf.format(Number(p.total_amount) || 0),
            paid: nf.format(Number(p.amount_paid) || 0),
            owed: nf.format(Number(p.amount_due) || 0),
            status: p.status ?? null,
            at: shopTime(p.created_at),
            recordedBy: p.recorded_by_name ?? null,
          })),
        },
        sources: [
          { label: "Purchases", route: routeFor(ctx.shell, "/purchases") },
          { label: "Suppliers", route: routeFor(ctx.shell, "/companies") },
        ],
      };
    },
  },

  {
    name: "finance_overview",
    title: "Money and finance",
    description:
      "Recorded income, expenses, drawings, net cash, customer receivables and supplier payables for a period. Use for 'expenses this month', 'how much cash came in', 'money in and out', 'receivables', 'payables', 'net position', 'finance summary'.",
    permission: "payments.view",
    parameters: {
      type: "object",
      properties: {
        range: { type: "string", enum: ["today", "yesterday", "week", "month", "all"], description: "The period. Default month." },
        from: { type: "string", description: "Start date YYYY-MM-DD for a custom period." },
        to: { type: "string", description: "End date YYYY-MM-DD, inclusive." },
        scope: { type: "string", enum: ["current", "all"], description: "Owner only: current branch or the whole business. Default all." },
      },
    },
    async run(ctx, args) {
      const range = resolveRange({ ...(args ?? {}), range: args?.range ?? "month" });
      const all = seesAllBranches(ctx) && args?.scope !== "current";
      const filter = branchScopedFilter(ctx, all);
      const dates = rangeDates(range);
      const entries = await ctx.client.select(
        "finance_entries",
        `select=id,kind,amount,occurred_on,category,counterparty,method,note,branch_id,created_at&deleted_at=is.null${filter}&occurred_on=gte.${dates.from}&occurred_on=lte.${dates.to}&order=occurred_on.desc&limit=1000`,
      );
      const rows = entries ?? [];
      const income = rows.filter((e) => e.kind === "income").reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const expense = rows.filter((e) => e.kind === "expense").reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const drawing = rows.filter((e) => e.kind === "drawing").reduce((s, e) => s + (Number(e.amount) || 0), 0);
      let receivables = 0;
      let payables = 0;
      if (all) {
        const [customers, companies] = await Promise.all([
          ctx.client.select("customers", "select=outstanding_balance&is_archived=eq.false&limit=2000"),
          ctx.client.select("companies", "select=outstanding_payable&is_active=eq.true&limit=1000"),
        ]);
        receivables = (customers ?? []).reduce((s, c) => s + (Number(c.outstanding_balance) || 0), 0);
        payables = (companies ?? []).reduce((s, c) => s + (Number(c.outstanding_payable) || 0), 0);
      } else {
        const [customerBalances, companyBalances] = await Promise.all([
          ctx.client.rpc("get_branch_customer_balances"),
          ctx.client.rpc("get_branch_company_balances"),
        ]);
        receivables = (customerBalances ?? []).reduce((s, c) => s + (Number(c.outstanding_balance) || 0), 0);
        payables = (companyBalances ?? []).reduce((s, c) => s + (Number(c.outstanding_payable) || 0), 0);
      }
      const net = income - expense;
      const branches = await myBranches(ctx);
      const branchName = branches.find((b) => b.is_current)?.name ?? null;
      const spoken = `For ${range.label}, ${all ? "the whole business" : branchName ? `the ${branchName} branch` : "this branch"}: income ${spokenMoney(income)}, expenses ${spokenMoney(expense)}, net ${spokenMoney(net)}${drawing ? `, drawings ${spokenMoney(drawing)}` : ""}. Customers owe ${spokenMoney(receivables)} and suppliers are owed ${spokenMoney(payables)}.`;
      return {
        title: `Money ${range.label}`,
        spoken,
        facts: {
          period: range.label,
          scope: all ? "all branches" : branchName || "current branch",
          income: nf.format(income),
          expenses: nf.format(expense),
          drawings: nf.format(drawing),
          net: nf.format(net),
          receivables: nf.format(receivables),
          payables: nf.format(payables),
          entries: rows.slice(0, 25).map((e) => ({
            date: e.occurred_on,
            kind: e.kind,
            amount: nf.format(Number(e.amount) || 0),
            category: e.category ?? null,
            counterparty: e.counterparty ?? null,
            method: e.method ?? null,
          })),
        },
        sources: [{ label: "Money", route: routeFor(ctx.shell, FINANCE_ROUTE(ctx)) }],
      };
    },
  },

  {
    name: "inventory_overview",
    title: "Stock overview",
    description:
      "The active stock in the current branch: product count, stock value (for money roles), low and out-of-stock packs. Use for 'inventory summary', 'how much stock do I have', 'stock value', 'what is low and what is out'.",
    permission: "inventory.view",
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      const { qty, variants } = await branchStockRows(ctx);
      const names = await productNames(ctx.client, variants.map((v) => v.product_id));
      const showValue = ctx.permissions.includes("reports.view");
      let costs = new Map();
      if (showValue && variants.length) {
        const rows = await ctx.client.select(
          "product_variants",
          `select=id,cost_price&id=in.(${variants.map((v) => v.id).join(",")})`,
        );
        costs = new Map((rows ?? []).map((r) => [r.id, Number(r.cost_price) || 0]));
      }
      const items = variants.map((v) => {
        const stock = qty.get(v.id) ?? 0;
        const threshold = Number(v.low_stock_threshold) || 0;
        return {
          product: names.get(v.product_id) ?? "unknown product",
          pack: v.name,
          stock,
          threshold,
          sellingPrice: nf.format(Number(v.selling_price) || 0),
          low: stock <= threshold,
        };
      });
      const low = items.filter((i) => i.low);
      const out = items.filter((i) => i.stock <= 0);
      const value = showValue
        ? variants.reduce((sum, v) => sum + (qty.get(v.id) ?? 0) * (costs.get(v.id) ?? 0), 0)
        : null;
      const branches = await myBranches(ctx);
      const branchName = branches.find((b) => b.is_current)?.name ?? null;
      const spoken = `${branchName ? `The ${branchName} branch has` : "This branch has"} ${items.length} active pack${items.length === 1 ? "" : "s"}${showValue ? ` worth ${spokenMoney(value ?? 0)} at cost` : ""}. ${low.length} ${low.length === 1 ? "is" : "are"} at or below the low-stock level and ${out.length} ${out.length === 1 ? "is" : "are"} out of stock.`;
      return {
        title: "Stock overview",
        spoken,
        facts: {
          scope: "current branch",
          branchName,
          productCount: new Set(variants.map((v) => v.product_id)).size,
          packCount: items.length,
          inventoryValue: value == null ? null : nf.format(value),
          lowCount: low.length,
          outCount: out.length,
          items: items.sort((a, b) => Number(b.low) - Number(a.low) || a.stock - b.stock).slice(0, 40),
        },
        sources: [{ label: "Reorder list", route: routeFor(ctx.shell, "/inventory/reorder") }],
      };
    },
  },

  {
    name: "customer_directory",
    title: "Customers and credit",
    description:
      "Customers visible in the branch, with what each owes, their credit limit and due date. Use for 'who owes me money', 'all customers', 'customer list', 'who has credit', 'outstanding customers', 'receivables'.",
    permission: "customers.view",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["current", "all"], description: "Owner only: current branch or the whole business. Default all." },
        owing: { type: "boolean", description: "Only customers who owe money. Default true." },
      },
    },
    async run(ctx, args) {
      const all = seesAllBranches(ctx) && args?.scope !== "current";
      const owingOnly = args?.owing !== false;
      let rows = [];
      if (all) {
        rows = (await ctx.client.select(
          "customers",
          "select=id,name,phone,credit_limit,outstanding_balance,total_purchases,total_paid,due_date,is_archived&is_archived=eq.false&order=outstanding_balance.desc&limit=1000",
        )) ?? [];
      } else {
        const balances = (await ctx.client.rpc("get_branch_customer_balances")) ?? [];
        const byId = new Map(balances.map((b) => [b.customer_id, b]));
        const ids = balances.map((b) => b.customer_id).filter(Boolean);
        if (ids.length) {
          const found = (await ctx.client.select(
            "customers",
            `select=id,name,phone,credit_limit,outstanding_balance,total_purchases,total_paid,due_date,is_archived&id=in.(${ids.join(",")})&is_archived=eq.false&limit=1000`,
          )) ?? [];
          rows = found.map((c) => ({ ...c, outstanding_balance: byId.get(c.id)?.outstanding_balance ?? c.outstanding_balance }));
        }
      }
      const visible = (owingOnly ? rows.filter((c) => Number(c.outstanding_balance) > 0) : rows).map((c) => {
        const owed = Number(c.outstanding_balance) || 0;
        const limit = Number(c.credit_limit) || 0;
        return {
          id: c.id,
          name: c.name,
          phone: c.phone ?? null,
          owed: nf.format(owed),
          creditLimit: nf.format(limit),
          dueDate: c.due_date ?? null,
          standing: owed <= 0 ? "clear" : limit > 0 && owed >= limit ? "over limit" : limit > 0 && owed >= limit * 0.8 ? "near the limit" : "within the limit",
        };
      });
      const total = visible.reduce((s, c) => s + Number(String(c.owed).replace(/,/g, "")), 0);
      const spoken = visible.length
        ? `${visible.length} customer${visible.length === 1 ? "" : "s"}${all ? " in the business" : " in this branch"} owe ${spokenMoney(total)}. ${visible.slice(0, 6).map((c) => `${c.name}, ${spokenMoney(c.owed)}`).join("; ")}.`
        : `No customer${all ? " in the business" : " in this branch"} owes money right now.`;
      return {
        title: "Customers and credit",
        spoken,
        facts: {
          scope: all ? "all branches" : "current branch",
          count: visible.length,
          totalOwed: nf.format(total),
          customers: visible.slice(0, 50),
        },
        sources: [{ label: "Customers", route: routeFor(ctx.shell, "/customers") }],
      };
    },
  },

  {
    name: "product_catalogue",
    title: "Products and prices",
    description:
      "The shop's products, their suppliers, pack prices and stock in the current branch. Use for 'what do I sell', 'product list', 'all products', 'price list', 'catalogue', 'items I stock'.",
    permission: "products.view",
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      const products = (await ctx.client.select(
        "products",
        "select=id,name,company_id,category,barcode,is_active&is_active=eq.true&order=name&limit=500",
      )) ?? [];
      const visibleIds = await branchProductIds(ctx);
      const visible = products.filter((p) => !visibleIds || visibleIds.has(p.id));
      const kept = visible.slice(0, 200);
      const variants = kept.length
        ? (await ctx.client.select(
            "product_variants",
            `select=id,product_id,name,selling_price,low_stock_threshold,unit_size&is_active=eq.true&product_id=in.(${kept.map((p) => p.id).join(",")})&order=name&limit=1000`,
          )) ?? []
        : [];
      const { qty } = await branchStockRows(ctx);
      const companyIds = [...new Set(kept.map((p) => p.company_id).filter(Boolean))];
      const companies = new Map();
      for (let i = 0; i < companyIds.length; i += 120) {
        const rows = await ctx.client.select("companies", `select=id,name&id=in.(${companyIds.slice(i, i + 120).join(",")})`);
        for (const c of rows ?? []) companies.set(c.id, c.name);
      }
      const byProduct = new Map();
      for (const v of variants) {
        const list = byProduct.get(v.product_id) ?? [];
        list.push(v);
        byProduct.set(v.product_id, list);
      }
      const shaped = kept.map((p) => {
        const packs = (byProduct.get(p.id) ?? []).map((v) => ({
          name: v.name,
          price: nf.format(Number(v.selling_price) || 0),
          stock: qty.get(v.id) ?? 0,
          low: (qty.get(v.id) ?? 0) <= (Number(v.low_stock_threshold) || 0),
        }));
        return {
          id: p.id,
          name: p.name,
          category: p.category ?? null,
          supplier: companies.get(p.company_id) ?? null,
          packs,
          stock: packs.reduce((s, pack) => s + pack.stock, 0),
        };
      });
      const spoken = shaped.length
        ? `${shaped.length} product${shaped.length === 1 ? "" : "s"} are available in this branch: ${shaped.slice(0, 8).map((p) => p.name).join(", ")}${shaped.length > 8 ? " and more" : ""}.`
        : "No products are visible in this branch.";
      return {
        title: "Products and prices",
        spoken,
        facts: { count: shaped.length, products: shaped.slice(0, 60) },
        sources: [{ label: "Products", route: routeFor(ctx.shell, "/products") }],
      };
    },
  },

  {
    name: "my_abilities",
    title: "What this account may do",
    description:
      "The permissions of whoever is asking: which parts of the app they may see and use, and which they may not. Use for 'what can I do', 'can I see reports', 'why can't I do that'.",
    permission: null,
    parameters: { type: "object", properties: {} },
    async run(ctx) {
      // Read straight from the permissions table so the wording matches the app's own
      // screen. Falls back to bare codes: a label is a nicety, the code is the fact.
      let labels = new Map();
      try {
        const rows = await ctx.client.select("permissions", "select=code,label_en,module&order=module");
        labels = new Map((rows ?? []).map((r) => [r.code, { label: r.label_en, module: r.module }]));
      } catch {}
      const all = await ctx.client.select("permissions", "select=code&order=code").catch(() => []);
      const granted = ctx.permissions;
      const denied = (all ?? []).map((r) => r.code).filter((c) => !granted.includes(c));
      const shape = (codes) =>
        codes.map((c) => ({ code: c, label: labels.get(c)?.label ?? c, module: labels.get(c)?.module ?? c.split(".")[0] }));
      const spoken = `This account can do ${granted.length} things and cannot do ${denied.length}. It can: ${shape(granted)
        .map((g) => g.label)
        .join(", ")}.`;
      return {
        title: "What you can do",
        spoken,
        facts: { granted: shape(granted), deniedCount: denied.length },
        notes: denied.length
          ? [`Not permitted for this account: ${shape(denied).map((d) => d.label).join(", ")}.`]
          : [],
        sources: [{ label: "Your settings", route: routeFor(ctx.shell, "/settings") }],
      };
    },
  },

  {
    name: "help_topic",
    title: "How to do something",
    description:
      "Explains a feature or a task in the app's own words: how to record a sale, how credit limits work, how to add a product, what reports show. Use when the user asks how something works or says they do not understand something.",
    permission: null,
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What they want to understand, in their own words." } },
      required: ["query"],
    },
    async run(ctx, args) {
      const query = String(args?.query ?? "").trim();
      const topics = helpTopics().filter(
        // Help is permission-filtered too: an employee is not taught a screen they cannot
        // open, because being told how to use something you are not allowed to touch is
        // just a frustrating answer.
        (t) => !t.requires || ctx.permissions.includes(t.requires),
      );
      const words = expand(tokenise(query));
      const scored = topics
        .map((t) => ({ t, score: scoreTopic(t, words) }))
        // Below this the "match" is one incidental word, and answering it confidently is
        // worse than admitting there is no saved explanation.
        .filter((s) => s.score >= 4)
        // A topic that names a real screen wins a tie, because it can end in the app.
        .sort((a, b) => b.score - a.score || Number(!!b.t.route) - Number(!!a.t.route))
        .slice(0, 3);
      if (!scored.length) {
        return {
          title: "Not sure",
          spoken: `I do not have a saved explanation for "${query}" yet. Ask me about the shop's own numbers — sales, stock, a customer's credit — or name the screen you are stuck on.`,
          facts: { query, topicsMatched: 0, topicCount: topics.length },
          sources: [{ label: "App guide", route: routeFor(ctx.shell, "/guide") }],
        };
      }
      const best = scored[0].t;
      // The steps first when the app has them — a shopkeeper asking "how do I" wants the
      // order of the buttons, and the app already wrote that order down.
      const steps = best.steps ?? [];
      // Read out in the app's own order, so a spoken answer and the guide's numbered list are
      // the same instructions. At most four steps: past that, the person should be looking at
      // the screen, not listening to a list.
      const spoken = [best.title, best.body, ...steps.slice(0, 4)]
        .filter(Boolean)
        .join(". ")
        .replace(/\.\./g, ".");
      return {
        title: best.title,
        // Verbatim from the app's own tutorial text — the assistant does not paraphrase
        // instructions, because a wrong step in a shop costs real time.
        spoken,
        facts: {
          topic: best.title,
          explanation: best.body ?? null,
          steps,
          whatYouCanDo: best.bullets,
          related: scored.slice(1).map((s) => ({ title: s.t.title, explanation: s.t.body ?? null })),
        },
        sources: best.route
          ? [{ label: best.title, route: routeFor(ctx.shell, best.route) }]
          : [{ label: "App guide", route: routeFor(ctx.shell, "/guide") }],
      };
    },
  },
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The tools this account may be offered at all. Used to build the model's tool list. */
export function toolsFor(permissions) {
  return TOOLS.filter((t) => !t.permission || permissions.includes(t.permission));
}

export function toolSpecs(permissions) {
  return toolsFor(permissions).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// ─── the gate ────────────────────────────────────────────────────────────────

export class Refused extends Error {
  constructor(message, { tool, permission }) {
    super(message);
    this.refused = true;
    this.tool = tool;
    this.permission = permission;
  }
}

/**
 * Run one tool, or refuse.
 *
 * The refusal is the product here, not an error path. An employee asking for profit is not a
 * failed request the assistant should work around — it is the boundary doing its job, and
 * the answer they get says so plainly.
 */
export async function runTool(name, ctx, args = {}) {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new Refused(`There is no such capability here: ${name}`, { tool: name });
  // The wording said aloud never contains a permission code. "reports.view" is a fact about
  // the schema, and a shopkeeper reading it has been told something they cannot act on;
  // `permission` rides along on the error so the screen and the tests can still show exactly
  // which rule refused.
  const NOT_ALLOWED = "This account is not allowed to see this part of the shop. The owner can change that in Roles and access.";
  if (tool.permission && !ctx.permissions.includes(tool.permission)) {
    throw new Refused(NOT_ALLOWED, { tool: name, permission: tool.permission });
  }
  if (tool.permission) {
    const database = await ctx.client.hasPermission(tool.permission);
    if (!database) throw new Refused(NOT_ALLOWED, { tool: name, permission: tool.permission });
  }
  const startedAt = Date.now();
  const result = await tool.run(ctx, args);
  return { ...result, tool: name, permission: tool.permission, ms: Date.now() - startedAt };
}

// ─── the app's own help, bundled from the app's own source ───────────────────

/**
 * The help corpus: the app's own tutorials, the words its screens use, each topic carrying the
 * permission its screen needs so help is filtered exactly like data is.
 *
 * The bundle is generated from `src/education/model.ts` + `src/lib/i18n.ts` by
 * `scripts/dev/build-help-corpus.mjs`. Reading the app's TypeScript at run time is a repo-script
 * job, not something a deployed function can do — and a second, hand-written set of instructions
 * is exactly the thing that drifts away from the screens it describes.
 */
export function helpTopics() {
  return HELP_TOPICS;
}

const STOP = new Set([
  "the", "a", "an", "how", "do", "i", "is", "are", "of", "to", "in", "on", "my", "me", "and",
  "for", "what", "why", "can", "not", "it", "this", "that", "with", "app", "does", "work",
]);

/**
 * The words a shopkeeper uses and the words the app's tutorials use are not always the same
 * word. "How do I record a sale" has to reach the topic entitled "Selling an item", and it
 * only does if "sale" can look for "sell".
 */
const SYNONYMS = {
  sale: ["sell", "selling", "sold", "invoice", "bill", "sale"],
  sales: ["sell", "selling", "sold", "invoice", "sale"],
  sell: ["sale", "selling", "sold", "scan"],
  profit: ["margin", "earning", "profit"],
  margin: ["profit", "markup"],
  money: ["payment", "cash", "rupees", "paid"],
  stock: ["inventory", "quantity", "products", "shelf", "pack"],
  inventory: ["stock", "products", "pack"],
  product: ["item", "stock", "products"],
  customer: ["client", "khata", "credit", "account"],
  credit: ["udhaar", "debt", "owing", "limit", "customer"],
  owe: ["credit", "balance", "outstanding", "limit"],
  owes: ["credit", "balance", "outstanding", "limit"],
  owed: ["credit", "balance", "outstanding"],
  supplier: ["company", "payable", "vendor", "purchases"],
  company: ["supplier", "vendor"],
  employee: ["staff", "member", "roles", "permission"],
  permission: ["access", "roles", "allowed", "rights"],
  report: ["reports", "profit", "summary"],
  reminder: ["alert", "due", "notify"],
  barcode: ["scan", "code", "scanner"],
  backup: ["export", "data", "restore"],
  refund: ["return", "returned", "exchange"],
};

function tokenise(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** The query words, plus the words a shopkeeper might have meant instead. */
function expand(words) {
  const out = new Set(words);
  for (const w of words) {
    const key = w.replace(/s$/, "");
    for (const s of SYNONYMS[w] ?? SYNONYMS[key] ?? []) out.add(s);
  }
  return [...out];
}

function scoreTopic(topic, words) {
  const title = String(topic.title ?? "").toLowerCase();
  const body = `${topic.body ?? ""} ${(topic.steps ?? []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const w of words) {
    // A word in the title is what the topic is *about*; the same word in the body may be
    // incidental, so it counts for much less. Without this, "sale" matched the Home overview
    // and the assistant answered a question about selling with a sentence about KPIs.
    const inTitle = title.includes(w);
    const inBody = body.includes(w);
    if (inTitle) score += w.length > 5 ? 6 : 5;
    else if (inBody) score += w.length > 5 ? 2 : 1;
  }
  return score;
}
