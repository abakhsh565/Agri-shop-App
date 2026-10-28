import type { BaseUnit, Product, StockStatus } from "@/types";
import { getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { pkDateFromISO, pkToday } from "@/lib/pkDate";

/**
 * What the inventory screens show, derived once.
 *
 * WHY THIS FILE EXISTS. Products & Inventory now has five screens that each state a number about
 * the same shelf: the section's own screen, Stock management, Stock movements, Stock alerts and
 * Expiry alerts. Three judgements decide every one of those numbers — what "low" means, what
 * "expiring" means, and what unit a quantity is said in — and a screen that decides any of them
 * for itself is how the same shelf ends up low on one page and healthy on the next. All three
 * live here; the screens only choose which rows to list.
 *
 * Nothing here reads the network: it works on the products the app has already loaded, which are
 * the working branch's rows (`lib/branchStock`).
 */

/** A judgement the whole app already makes in one place: measured against the pack's own level. */
export function productStockStatus(product: Product): StockStatus {
  return getStockStatus(product.stockQty, productLowStockThreshold(product.variants));
}

export interface StockItem {
  key: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  /** Branch stock of this pack, in the product's own base unit. */
  qty: number;
  baseUnit: BaseUnit;
  threshold: number;
  status: StockStatus;
}

/**
 * One row per pack on the shelf.
 *
 * A pack, not a product: stock is held per pack (a 1 L bottle and a 100 ml bottle of the same
 * spray are different shelves), and every action a shopkeeper takes here — count it, lower it,
 * reorder it — is taken on a pack. The product total is what the *section's* summary counts,
 * because that is the unit the owner asks about.
 */
export function stockItems(products: Product[]): StockItem[] {
  const items: StockItem[] = [];
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      items.push({
        key: `${product.id}-${variant.id}`,
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        qty: variant.stockQty ?? 0,
        baseUnit: product.baseUnit,
        threshold: variant.lowStockThreshold,
        status: getStockStatus(variant.stockQty ?? 0, variant.lowStockThreshold),
      });
    }
  }
  // Worst first: an empty shelf is the thing to act on, and a healthy one can wait at the foot.
  const rank: Record<StockStatus, number> = { out_of_stock: 0, low_stock: 1, in_stock: 2 };
  return items.sort((a, b) => rank[a.status] - rank[b.status] || a.productName.localeCompare(b.productName));
}

export interface InventoryCounts {
  /** Products this branch carries — the catalogue screen's own row count. */
  products: number;
  /** Packs on the shelf — every size and packing the products above are stocked in. */
  packs: number;
  /** Packs with nothing left: the rows the Stock alerts screen lists. */
  out: number;
  /** Packs at or below their own level, still with something to sell. */
  low: number;
  /** Packs whose date is inside the warning window, already expired included. */
  expiring: number;
}

/**
 * The four figures on the Products & Inventory screen.
 *
 * EACH FIGURE COUNTS WHAT ITS SCREEN LISTS. The catalogue screen lists products, so that figure
 * is products; the other three screens list packs, so those figures are packs. Counting a
 * different unit at the top from the one in the list is how a reader opens "12 low" and finds
 * nineteen rows — or, worse, counts nine products twice and believes the shelf is emptier than
 * it is. The numbers here and the rows there are the same thing said twice.
 *
 * The window is `EXPIRY_WARNING_DAYS` (the S9 rule): the same one the business overview and the
 * branch cards use, so "expiring" means one thing in this app. Where those two count products
 * instead of packs, they are answering a business-wide question ("how many products are"), not
 * directing anyone to a shelf.
 */
export function inventoryCounts(products: Product[], todayISO: string = pkToday()): InventoryCounts {
  const items = stockItems(products);
  return {
    products: products.length,
    packs: items.length,
    out: items.filter((item) => item.status === "out_of_stock").length,
    low: items.filter((item) => item.status === "low_stock").length,
    expiring: expiryItems(products, todayISO).length,
  };
}

export interface ExpiryItem {
  key: string;
  productId: string;
  productName: string;
  variantId: string;
  variantName: string;
  /** yyyy-mm-dd as stored on the pack. */
  expiryDate: string;
  /** Whole days from today; negative means the date has already passed. */
  days: number;
  expired: boolean;
}

/**
 * Packs with a date inside the warning window, soonest first.
 *
 * The date lives on the pack (`product_variants.expiry_date`) — this app records one date per
 * pack, not a batch number, so that is what these rows say. Nothing is invented to look more
 * precise than the record: no batch codes, no dates the shop never entered.
 */
export function expiryItems(products: Product[], todayISO: string = pkToday()): ExpiryItem[] {
  const items: ExpiryItem[] = [];
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      if (!variant.expiryDate) continue;
      const days = Math.round(
        (Date.parse(pkDateFromISO(variant.expiryDate)) - Date.parse(todayISO)) / 86_400_000,
      );
      if (days > EXPIRY_WARNING_DAYS) continue;
      items.push({
        key: `${product.id}-${variant.id}`,
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        variantName: variant.name,
        expiryDate: variant.expiryDate,
        days,
        expired: days < 0,
      });
    }
  }
  return items.sort((a, b) => a.days - b.days);
}

/** The pack's unit word, plural — quantities on these screens are never one. */
export function unitWord(baseUnit: BaseUnit, t: (key: string) => string): string {
  if (baseUnit === "kg") return t("products.unitKgs");
  if (baseUnit === "piece") return t("products.unitPieces");
  return t("products.unitLiters");
}

/**
 * A signed quantity as these screens state it: "+20 liters", "−3 bottles".
 *
 * The minus is U+2212 as the reference board draws it, and it is written here rather than
 * repeated per screen so a plus and a minus cannot end up spelled two ways in one list.
 */
export function signedQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 1000) / 1000;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)} ${unit}`;
}
