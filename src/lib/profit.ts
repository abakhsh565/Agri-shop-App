import type { SaleItem } from "@/types";

/**
 * Profit is one number the shopkeeper actually decides things on, so it is derived in
 * exactly one place. Home, Sales, the sale record and Reports all call this file.
 *
 * The rule the whole file is built around: **an unknown cost is never a zero cost.**
 * A line whose cost the shop never recorded used to be read as "this item was free",
 * which turns its entire sale price into profit — the flattering reading, and the wrong
 * one. `null` means "not known" all the way through, the totals say how many lines are
 * unknown, and the screens say so instead of quietly inflating the figure.
 */

/** Looks up the live cost of a variant, for lines written before COGS snapshots existed. */
export type LiveCostLookup = (variantId: string | null | undefined) => number | undefined;

/**
 * The same price said three ways: cost, selling price, and the markup on cost between them.
 *
 * A shopkeeper thinks in "25% on cost" as often as in "sell at 500", so every screen that
 * asks for a price asks for both — and the rule is the same on all of them: **the markup is
 * derived from the two prices and never stored**. It is the one of the three that can be
 * computed, so letting it be typed into a database column is how a shop ends up with a row
 * claiming 25% that its own two prices say is 12%.
 *
 * These two functions are the only implementation; the add-product form and the
 * record-stock-purchase form both call them rather than each keeping a copy.
 *
 * Empty string means "no answer", not zero: there is no percentage of a price nobody has
 * entered, and printing 0% next to a price that was never asked for would be an invented fact.
 */
export function markupPercent(cost: number, sell: number): string {
  if (!(cost > 0) || !(sell > 0)) return "";
  // One decimal is the whole useful range here: 25% for 400 → 500, and 12.5% for 400 → 450.
  return String(Math.round(((sell - cost) / cost) * 1000) / 10);
}

/**
 * The percentage moved, so restate the selling price against the cost it was measured on.
 *
 * Returns the typed markup untouched when there is no cost to measure it against — the
 * caller shows a hint saying why the price did not move, because silently ignoring what
 * someone typed reads as the app having lost it.
 */
export function sellingFromMarkup(
  cost: number,
  markup: string
): { sellingPrice: string | null; moved: boolean } {
  const percent = Number(markup);
  if (!(cost > 0) || markup.trim() === "" || !Number.isFinite(percent)) {
    return { sellingPrice: null, moved: false };
  }
  const selling = cost * (1 + percent / 100);
  return { sellingPrice: String(Math.round(selling * 100) / 100), moved: true };
}

/**
 * What one line of a sale cost the shop, or `null` when that is not known.
 *
 * `cogsAmount` is the snapshot taken when the sale was made and is preferred whenever it
 * is usable; a live variant cost is only the fallback for rows written before snapshots
 * existed. A snapshot of 0 is indistinguishable from a cost nobody filled in, so it is
 * read as unknown — see migration 0159, which now writes NULL instead of 0 for a line
 * whose cost was never known, so the database and this file mean the same thing.
 */
export function lineCogs(item: SaleItem, liveCost?: LiveCostLookup): number | null {
  if (item.cogsAmount != null) return item.cogsAmount > 0 ? item.cogsAmount : null;
  const unit = liveCost?.(item.variantId);
  return unit != null && unit > 0 ? unit * item.qty : null;
}

export interface ProfitSummary {
  /** The authoritative revenue: each sale's own stored total, not a re-sum of its lines. */
  revenue: number;
  /** Sum of the line costs that are actually known. Excludes unknown-cost lines. */
  cogs: number;
  /** revenue − cogs. Overstated while `unknownLines` is above zero — the screens say so. */
  profit: number;
  /** profit as a percentage of revenue, rounded. Zero when there is no revenue. */
  margin: number;
  /** Total sale lines counted. */
  lines: number;
  /** How many of those lines have no usable cost recorded. */
  unknownLines: number;
  /** True when every line had a known cost, so `profit` is the real figure. */
  complete: boolean;
}

export const EMPTY_PROFIT: ProfitSummary = {
  revenue: 0,
  cogs: 0,
  profit: 0,
  margin: 0,
  lines: 0,
  unknownLines: 0,
  complete: true,
};

function summarise(revenue: number, costs: (number | null)[]): ProfitSummary {
  let cogs = 0;
  let unknownLines = 0;
  for (const c of costs) {
    if (c == null) unknownLines++;
    else cogs += c;
  }
  const profit = revenue - cogs;
  return {
    revenue,
    cogs,
    profit,
    margin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
    lines: costs.length,
    unknownLines,
    complete: unknownLines === 0,
  };
}

/**
 * Gross profit for a period, on the same revenue the period's sales add up to.
 *
 * Recomputing revenue from `unitPrice × qty` looks equivalent but is not — the database
 * rounds each line separately, so the two drift apart and the screens disagree about the
 * same period.
 */
export function summariseSales(
  sales: { totalAmount: number; items: SaleItem[] }[],
  liveCost?: LiveCostLookup,
): ProfitSummary {
  let revenue = 0;
  const costs: (number | null)[] = [];
  for (const sale of sales) {
    revenue += sale.totalAmount;
    for (const item of sale.items) costs.push(lineCogs(item, liveCost));
  }
  return summarise(revenue, costs);
}

/**
 * Gross profit on a single sale. Same arithmetic as a period of one, so a sale's own page
 * can never disagree with the list it was opened from.
 */
export function summariseSale(
  sale: { totalAmount: number; items: SaleItem[] },
  liveCost?: LiveCostLookup,
): ProfitSummary {
  return summarise(sale.totalAmount, sale.items.map((item) => lineCogs(item, liveCost)));
}

/**
 * What a screen is allowed to say about a profit figure, decided in one place so Home,
 * Sales, the sale record and Reports all say the same thing.
 *
 * A total built on a missing cost is not a profit the owner can trust, and printing one
 * anyway is how this screen lost their trust to begin with. So:
 *
 *  - `exact`   — every line's cost is known. Show the number.
 *  - `atLeast` — some lines are known, some are not. The number is a floor; label it so.
 *  - `unknown` — no line's cost is known. There is no figure to show, only the reason.
 */
export type ProfitDisplay =
  | { kind: "exact"; amount: number; margin: number }
  | { kind: "atLeast"; amount: number; margin: number; unknownLines: number }
  | { kind: "unknown"; unknownLines: number };

export function profitDisplay(summary: ProfitSummary): ProfitDisplay {
  if (summary.unknownLines === 0) {
    return { kind: "exact", amount: summary.profit, margin: summary.margin };
  }
  const known = summary.lines - summary.unknownLines;
  if (known === 0) return { kind: "unknown", unknownLines: summary.unknownLines };
  return {
    kind: "atLeast",
    amount: summary.profit,
    margin: summary.margin,
    unknownLines: summary.unknownLines,
  };
}

/**
 * The cost that came back with returned goods.
 *
 * A return refunds the customer's price *and* puts the goods back on the shelf, so the
 * cost of those units is no longer consumed by the sale. Deducting the refund while still
 * charging the sale the full cost understates profit by the returned goods' cost.
 *
 * `returnedQty` is keyed `${productName}-${variantName}` — the identity a return line
 * carries, because a return is recorded against the product and pack it came from.
 */
export function refundedCogs(
  sale: { items: SaleItem[] },
  returnedQty: Record<string, number>,
  liveCost?: LiveCostLookup,
): number {
  let refunded = 0;
  for (const item of sale.items) {
    const qty = returnedQty[`${item.productName}-${item.variantName}`] ?? 0;
    if (qty <= 0 || item.qty <= 0) continue;
    const cogs = lineCogs(item, liveCost);
    if (cogs == null) continue;
    // Never credit back more units than the line ever had.
    refunded += (cogs / item.qty) * Math.min(qty, item.qty);
  }
  return refunded;
}
