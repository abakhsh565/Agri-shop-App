import type { Customer, Sale, Product } from "@/types";

/**
 * What to suggest next — in both directions, off one set of rules.
 *
 * The engine answers one question two ways: *what does this customer need?* and *who needs
 * this product?* Both run through the same scoring below, so the two screens can never
 * disagree about the same pair. (They used to: each direction had its own copy of the rules,
 * and it had already drifted — the customer side skipped out-of-stock products, the product
 * side did not.)
 *
 * ## Eligibility comes first, and it is agronomic
 *
 * A suggestion is only ever made when the **crop** is known, the product's **category suits
 * that crop**, the **season for it is open right now**, and — when a planting date has been
 * recorded — the **crop is at a stage that category belongs to**. Stock has to be on the shelf,
 * because a recommendation the shop cannot fill is an errand, not a suggestion. A recorded
 * **need** (a pest, a disease, a job the owner named) is evidence too, and it is only ever what
 * somebody wrote down: nothing here infers a pest from the season, from a purchase, or from a
 * product's name. If it is not recorded, no suggestion claims it.
 *
 * ## Behaviour ranks what eligibility let through
 *
 * Among the products that fit the field, the order is decided by what the shop knows about this
 * person's buying: whether they have bought it and how often, how long ago, what else they buy
 * in the same category or from the same company, the brand and pack size they habitually
 * choose, the **acreage** they farm, the town they farm in and what growers there already buy,
 * and how much of it the shop holds. The strongest signal is also the headline "why" a
 * shopkeeper reads on the row.
 *
 * **Profit margin is never read.** A suggestion is what the farmer needs next, not what pays the
 * shop best: `costPrice` appears nowhere in this file, and a test pins that changing it changes
 * nothing about the answer.
 */

export type CropStage = "sowing" | "growing" | "flowering" | "harvest";

/** Months since planting, and the stage each span belongs to. */
const STAGE_WINDOWS: Array<{ months: number; stage: CropStage }> = [
  { months: 1, stage: "sowing" },
  { months: 3, stage: "growing" },
  { months: 5, stage: "flowering" },
];

/** Which product categories are worth offering at each stage of a crop. */
const STAGE_CATEGORIES: Record<CropStage, string[]> = {
  sowing: ["seed", "fertilizer"],
  growing: ["fertilizer", "spray", "pesticide", "herbicide"],
  flowering: ["spray", "pesticide", "herbicide"],
  harvest: ["equipment", "other"],
};

/**
 * What the shop has recorded about one of a customer's crops.
 *
 * `acreage`, `plantingDate` and `expectedHarvest` are real columns on `customer_crops`; the crop
 * form only fills in the name today, so the rest is usually absent. Absent means "not
 * recorded", never "zero" — a stage is never guessed, and no suggestion claims an acreage
 * nobody wrote down.
 */
export interface CustomerCropRecord {
  cropName: string;
  acreage?: number | null;
  plantingDate?: string | null;
  expectedHarvest?: string | null;
}

export interface RecommendationContext {
  customers: Customer[];
  sales: Sale[];
  products: Product[];
  /** Recorded crops per customer, with acreage and dates when they were recorded. */
  customerCrops?: Record<string, CustomerCropRecord[]>;
  /**
   * Recorded needs per customer — a pest, a disease, a named job. Nothing in the schema
   * produces one yet, so this is empty in practice; it is here so that the day something does,
   * it feeds one place. The engine never invents an entry.
   */
  recordedNeeds?: Record<string, string[]>;
}

export type RecommendationReasonKey =
  | "recommendation.missingFromBasket"
  | "recommendation.dueAgain"
  | "recommendation.seasonWindowOpen"
  | "recommendation.stage"
  | "recommendation.recordedNeed"
  | "recommendation.brandMatch"
  | "recommendation.related"
  | "recommendation.farmSize"
  | "recommendation.sameArea"
  | "recommendation.frequent";

export interface RecommendationReason {
  key: RecommendationReasonKey;
  params: Record<string, string>;
}

/** The WhatsApp copy the row's bell sends, chosen by the headline reason. */
export type RecommendationTag = "missing_from_basket" | "due_again" | "season_window_open";

/** Every signal that went into one suggestion, so a screen can show what it was built from. */
export interface RecommendationSignals {
  crop: string;
  stage: CropStage | null;
  acreage: number | null;
  town: string | null;
  timesBought: number;
  daysSinceLastBuy: number | null;
  relatedBuys: number;
  usualBrand: string | null;
  usualPack: string | null;
  areaBuyers: number;
  stockQty: number;
}

interface Suggestion<T> {
  subject: T;
  crop: string;
  tag: RecommendationTag;
  score: number;
  signals: RecommendationSignals;
  /** Ordered: the first one is the headline. Always at least one. */
  reasons: RecommendationReason[];
}

export type ProductRecommendation = Suggestion<Product>;
export type CustomerRecommendation = Suggestion<Customer>;

/** Map crop → months when each product category is relevant. */
export const CROP_SEASON_WINDOWS: Record<string, Record<string, [number, number]>> = {
  Cotton: {
    seed: [2, 4], // Feb-Apr (sowing)
    fertilizer: [3, 5], // Mar-May
    spray: [6, 9], // Jun-Sep (growing/pest control)
  },
  Wheat: {
    seed: [10, 11], // Oct-Nov (sowing)
    fertilizer: [11, 12], // Nov-Dec
    spray: [2, 3], // Feb-Mar
  },
  Rice: {
    seed: [5, 6], // May-Jun (sowing)
    fertilizer: [6, 7], // Jun-Jul
    spray: [7, 9], // Jul-Sep
  },
  Sugarcane: {
    seed: [2, 3], // Feb-Mar
    fertilizer: [3, 5], // Mar-May
    spray: [6, 8], // Jun-Aug
  },
  Maize: {
    seed: [3, 4], // Mar-Apr
    fertilizer: [4, 6], // Apr-Jun
    spray: [5, 8], // May-Aug
  },
  Tobacco: {
    seed: [11, 12], // Nov-Dec
    fertilizer: [12, 1], // Dec-Jan
    spray: [2, 4], // Feb-Apr
  },
};

/** List of known crops the owner can assign to customers. */
export const KNOWN_CROPS: string[] = Object.keys(CROP_SEASON_WINDOWS);

/** The categories this crop has a season for at all — the compatibility half of eligibility. */
export function isCategoryCompatible(category: string, cropName: string): boolean {
  return Boolean(CROP_SEASON_WINDOWS[cropName]?.[category]);
}

export function isCategoryInSeason(category: string, cropName: string, now: Date): boolean {
  const window = CROP_SEASON_WINDOWS[cropName]?.[category];
  if (!window) return false;
  const month = now.getMonth() + 1; // 1-indexed
  if (window[0] <= window[1]) return month >= window[0] && month <= window[1];
  // Wraps around the year (e.g. Nov-Jan)
  return month >= window[0] || month <= window[1];
}

export function categoryFitsStage(category: string, stage: CropStage): boolean {
  return STAGE_CATEGORIES[stage].includes(category);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/**
 * Where the crop is now, from the dates that were recorded.
 *
 * `null` means "not recorded", and nothing is built on it: a customer with no planting date is
 * recommended to exactly as before, and the row simply does not claim a stage.
 */
export function cropStageOf(crop: CustomerCropRecord, now: Date): CropStage | null {
  const planted = crop.plantingDate ? new Date(crop.plantingDate) : null;
  if (planted && !Number.isNaN(planted.getTime())) {
    const months = Math.max(0, monthsBetween(planted, now));
    for (const { months: limit, stage } of STAGE_WINDOWS) {
      if (months < limit) return stage;
    }
    return "harvest";
  }
  const harvest = crop.expectedHarvest ? new Date(crop.expectedHarvest) : null;
  if (harvest && !Number.isNaN(harvest.getTime())) {
    // Inside a fortnight of the expected harvest, the crop is being taken off.
    const days = (harvest.getTime() - now.getTime()) / 86400000;
    if (days <= 14) return "harvest";
  }
  return null;
}

/** Units the shop can actually hand over. */
export function availableStock(product: Product): number {
  if (product.variants.length > 0) {
    return product.variants.reduce((sum, v) => sum + Math.max(0, v.stockQty), 0);
  }
  return Math.max(0, product.stockQty);
}

/** City/town off the end of a free-text address. Never a lookup — just the label. */
export function townOf(address?: string | null): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

function getDaysSince(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function fmtDaysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * One customer's buying, read once per direction instead of per product.
 *
 * Brand and pack preference live under the **category** they were chosen in: the pack a farmer
 * prefers for fertiliser's 50kg bags says nothing about which spray bottle they want.
 */
interface CategoryHistory {
  times: number;
  lastAt: string;
  units: number;
  brands: Map<string, number>;
  packs: Map<string, number>;
}

interface BuyerProfile {
  byProduct: Map<string, { times: number; lastAt: string }>;
  byCategory: Map<string, CategoryHistory>;
  /** This customer's own lines, for "what else do they buy" questions. */
  lines: Array<{ productId: string; category: string; company: string; variantName: string; at: string }>;
}

function buildProfile(sales: Sale[], products: Product[]): BuyerProfile {
  const byProduct = new Map<string, { times: number; lastAt: string }>();
  const byCategory = new Map<string, CategoryHistory>();
  const lines: BuyerProfile["lines"] = [];
  const productOf = new Map(products.map((p) => [p.id, p] as const));

  for (const sale of sales) {
    for (const item of sale.items) {
      const product = productOf.get(item.productId);
      if (!product) continue;
      const qty = Math.max(0, item.qty ?? 0);
      lines.push({
        productId: product.id,
        category: product.category,
        company: product.company,
        variantName: item.variantName,
        at: sale.createdAt,
      });

      const bought = byProduct.get(item.productId);
      if (bought) {
        bought.times += 1;
        if (sale.createdAt > bought.lastAt) bought.lastAt = sale.createdAt;
      } else {
        byProduct.set(item.productId, { times: 1, lastAt: sale.createdAt });
      }

      let history = byCategory.get(product.category);
      if (!history) {
        history = {
          times: 0,
          lastAt: sale.createdAt,
          units: 0,
          brands: new Map(),
          packs: new Map(),
        };
        byCategory.set(product.category, history);
      }
      history.times += 1;
      history.units += qty;
      history.brands.set(product.company, (history.brands.get(product.company) ?? 0) + qty);
      history.packs.set(item.variantName, (history.packs.get(item.variantName) ?? 0) + qty);
      if (sale.createdAt > history.lastAt) history.lastAt = sale.createdAt;
    }
  }
  return { byProduct, byCategory, lines };
}

/** The name most units went on, or null when nothing was bought. */
function mostBoughtUnits(map: Map<string, number>): string | null {
  let best: string | null = null;
  let bestQty = 0;
  for (const [name, qty] of map) {
    if (qty > bestQty) {
      best = name;
      bestQty = qty;
    }
  }
  return best;
}

const MIN_DAYS_BEFORE_ASKING_AGAIN = 30;
/** Below this, the shelf is thin: the right product, but not the moment to push it. */
const THIN_STOCK = 10;

/**
 * Everything one eligible product is worth to one customer.
 *
 * The score is **behaviour only**: history, preference, acreage, the neighbourhood and what is
 * on the shelf. Agronomic fit decided *whether* the pair is here at all; it earns no points, so
 * a first-time product that fits the field is never buried by a familiar one that merely fits
 * it slightly better.
 */
function scoreProduct(
  product: Product,
  crop: CustomerCropRecord,
  profile: BuyerProfile,
  ctx: {
    customer: Customer;
    /** The whole shop's sales: the neighbourhood question needs more than this customer's. */
    sales: Sale[];
    customers: Customer[];
    products: Product[];
    now: Date;
    needs: string[];
  },
): { score: number; reasons: RecommendationReason[]; tag: RecommendationTag; signals: Omit<RecommendationSignals, "crop"> } {
  const { customer, sales: allSales, customers, products, now, needs } = ctx;
  const stage = cropStageOf(crop, now);
  const category = product.category;
  const bought = profile.byProduct.get(product.id);
  const timesBought = bought?.times ?? 0;
  const daysSinceLastBuy = bought ? getDaysSince(bought.lastAt, now) : null;
  const history = profile.byCategory.get(category);
  const acreage = crop.acreage && crop.acreage > 0 ? crop.acreage : null;
  const stockQty = availableStock(product);
  const usualBrand = history ? mostBoughtUnits(history.brands) : null;
  const usualPack = history ? mostBoughtUnits(history.packs) : null;
  const town = townOf(customer.address);

  const reasons: RecommendationReason[] = [];
  let score = 0;

  // 1. The headline: why this product fits this crop now.
  let tag: RecommendationTag;
  if (timesBought === 0) {
    // A gap in a category they already buy is a basket gap; a category they never buy is
    // simply a window that is open.
    tag = history ? "missing_from_basket" : "season_window_open";
    reasons.push({
      key: tag === "missing_from_basket" ? "recommendation.missingFromBasket" : "recommendation.seasonWindowOpen",
      params: { crop: crop.cropName },
    });
  } else {
    tag = "due_again";
    score += 30; // they already know this one
    score += Math.min(timesBought, 4) * 4; // and buy it often enough to trust it
    reasons.push({
      key: "recommendation.dueAgain",
      params: { crop: crop.cropName, days: fmtDaysAgo(daysSinceLastBuy ?? 0) },
    });
  }

  // 2. Recorded agronomy. Both of these are facts somebody entered; neither is ever guessed.
  if (stage) {
    reasons.push({ key: "recommendation.stage", params: { crop: crop.cropName, stage } });
  }
  if (needs.length > 0) {
    reasons.push({ key: "recommendation.recordedNeed", params: { need: needs[0] } });
  }

  // 3. Preference, read in the category the product actually belongs to.
  let relatedBuys = 0;
  if (history) {
    // The most recent thing they bought that is related — same category, or the same company.
    // Naming the *product* matters: "Bought Lambda before" is a fact a shopkeeper can check,
    // while naming the company would read as a claim about a brand they may never have bought.
    const relatedLines = profile.lines
      .filter(
        (line) => line.productId !== product.id && (line.category === category || line.company === product.company),
      )
      .sort((a, b) => (a.at < b.at ? 1 : -1));
    relatedBuys = relatedLines.length;
    const named = relatedLines.length > 0 ? products.find((p) => p.id === relatedLines[0].productId) : undefined;
    if (relatedBuys > 0) {
      score += Math.min(relatedBuys * 4, 12);
      if (named) reasons.push({ key: "recommendation.related", params: { related: named.name } });
    }
    if (usualBrand && usualBrand === product.company) {
      score += 12;
      reasons.push({ key: "recommendation.brandMatch", params: { brand: product.company } });
    }
    if (usualPack && product.variants.some((v) => v.name === usualPack)) score += 8;
    if (timesBought >= 3) {
      reasons.push({ key: "recommendation.frequent", params: { count: String(timesBought) } });
    }
  }

  // 4. The farm itself.
  if (acreage) {
    score += 10;
    reasons.push({ key: "recommendation.farmSize", params: { acres: String(acreage), crop: crop.cropName } });
  }

  // 5. The neighbourhood: the same product already going to growers in the customer's town.
  let areaBuyers = 0;
  if (town) {
    for (const other of customers) {
      if (other.id === customer.id) continue;
      if (townOf(other.address) !== town) continue;
      const boughtIt = allSales.some(
        (s) => s.customerId === other.id && !s.isVoided && s.items.some((it) => it.productId === product.id),
      );
      if (boughtIt) areaBuyers += 1;
    }
    if (areaBuyers > 0) {
      score += 6;
      reasons.push({ key: "recommendation.sameArea", params: { town } });
    }
  }

  // Availability is a condition, not a reason. Thin stock is a mild demotion: still the right
  // product, just not the moment to push a hundred of them.
  if (stockQty > 0 && stockQty < THIN_STOCK) score -= 6;

  return {
    score,
    reasons,
    tag,
    signals: {
      stage,
      acreage,
      town,
      timesBought,
      daysSinceLastBuy,
      relatedBuys,
      usualBrand,
      usualPack,
      areaBuyers,
      stockQty,
    },
  };
}

/** Is this product, for this crop, allowed to be suggested at all? */
export function isEligible(product: Product, crop: CustomerCropRecord, now: Date): boolean {
  const category = product.category;
  if (!isCategoryCompatible(category, crop.cropName)) return false;
  if (!isCategoryInSeason(category, crop.cropName, now)) return false;
  if (availableStock(product) <= 0) return false;
  const stage = cropStageOf(crop, now);
  if (stage && !categoryFitsStage(category, stage)) return false;
  return true;
}

function cropsOf(ctx: RecommendationContext, customerId: string): CustomerCropRecord[] {
  return ctx.customerCrops?.[customerId] ?? [];
}

/**
 * One customer's suggestions, best first.
 *
 * A product bought inside the last month is deliberately not suggested again: the section stays
 * quiet rather than nagging someone who already has it in the shed.
 */
export function getRecommendationsForCustomer(
  customer: Customer,
  ctx: RecommendationContext,
  now?: Date,
): ProductRecommendation[] {
  const currentTime = now ?? new Date();
  const crops = cropsOf(ctx, customer.id);
  if (crops.length === 0) return [];

  const sales = ctx.sales.filter((s) => s.customerId === customer.id && !s.isVoided);
  const profile = buildProfile(sales, ctx.products);
  const needs = ctx.recordedNeeds?.[customer.id] ?? [];

  const out: ProductRecommendation[] = [];
  for (const product of ctx.products) {
    const scored = bestCropFor(product, crops, profile, { ...ctx, customer, now: currentTime, needs });
    if (!scored) continue;
    out.push({
      subject: product,
      crop: scored.crop.cropName,
      tag: scored.result.tag,
      score: scored.result.score,
      signals: { ...scored.result.signals, crop: scored.crop.cropName },
      reasons: scored.result.reasons,
    });
  }

  return rank(out);
}

/** One product's likely buyers, best first. A product the shop cannot hand over recommends nobody. */
export function getRecommendationsForProduct(
  product: Product,
  ctx: RecommendationContext,
  now?: Date,
): CustomerRecommendation[] {
  const currentTime = now ?? new Date();
  if (availableStock(product) <= 0) return [];

  const out: CustomerRecommendation[] = [];
  for (const customer of ctx.customers) {
    if (customer.isArchived) continue;
    const crops = cropsOf(ctx, customer.id);
    if (crops.length === 0) continue;

    const sales = ctx.sales.filter((s) => s.customerId === customer.id && !s.isVoided);
    const profile = buildProfile(sales, ctx.products);
    const needs = ctx.recordedNeeds?.[customer.id] ?? [];

    const scored = bestCropFor(product, crops, profile, { ...ctx, customer, now: currentTime, needs });
    if (!scored) continue;
    out.push({
      subject: customer,
      crop: scored.crop.cropName,
      tag: scored.result.tag,
      score: scored.result.score,
      signals: { ...scored.result.signals, crop: scored.crop.cropName },
      reasons: scored.result.reasons,
    });
  }

  return rank(out);
}

/**
 * The crop a product is best matched with, or `null` when it matches none of them — either
 * because no crop passes eligibility, or because the customer bought it inside the last month,
 * which is the case that keeps the section quiet instead of nagging.
 */
function bestCropFor(
  product: Product,
  crops: CustomerCropRecord[],
  profile: BuyerProfile,
  ctx: {
    customers: Customer[];
    sales: Sale[];
    products: Product[];
    customer: Customer;
    now: Date;
    needs: string[];
  },
): { crop: CustomerCropRecord; result: ReturnType<typeof scoreProduct> } | null {
  let best: { crop: CustomerCropRecord; result: ReturnType<typeof scoreProduct> } | null = null;
  for (const crop of crops) {
    if (!isEligible(product, crop, ctx.now)) continue;
    const result = scoreProduct(product, crop, profile, ctx);
    if (!best || result.score > best.result.score) best = { crop, result };
  }
  if (!best) return null;
  const { timesBought, daysSinceLastBuy } = best.result.signals;
  if (timesBought > 0 && daysSinceLastBuy !== null && daysSinceLastBuy < MIN_DAYS_BEFORE_ASKING_AGAIN) {
    return null;
  }
  return best;
}

/** Best first, then whatever the shop holds more of, then by name so the order never wobbles. */
function rank<T extends { name: string }>(rows: Suggestion<T>[]): Suggestion<T>[] {
  return rows
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.signals.stockQty !== a.signals.stockQty) return b.signals.stockQty - a.signals.stockQty;
      return nameOf(a.subject).localeCompare(nameOf(b.subject));
    })
    .slice(0, 5);
}

function nameOf(subject: { name: string }): string {
  return subject.name;
}

