import type { Customer, Sale, Product, BusinessSettings, CropConfig } from "@/types";

/**
 * Recommendation Engine — suggests products for customers and customers for products.
 *
 * Three signals:
 * 1. Crop match — customer's assigned crops vs product category
 * 2. Basket gaps — what the customer hasn't bought this season
 * 3. Season timing — is the current month within the growing window
 */

interface RecommendationInput {
  customers: Customer[];
  sales: Sale[];
  products: Product[];
}

interface ProductRecommendation {
  product: Product;
  reason: string;
  reasonTag: "missing_from_basket" | "due_again" | "season_window_open";
  cropName: string;
}

interface CustomerRecommendation {
  customer: Customer;
  reason: string;
  reasonTag: "missing_from_basket" | "due_again" | "season_window_open";
  cropName: string;
}

// Crops are loaded from Supabase by the calling component and passed in.
// This keeps the engine synchronous and free of async/Supabase dependencies.

/** Map crop → months when each product category is relevant */
const CROP_SEASON_WINDOWS: Record<string, Record<string, [number, number]>> = {
  Cotton: {
    seed: [2, 4],      // Feb-Apr (sowing)
    fertilizer: [3, 5], // Mar-May
    spray: [6, 9],      // Jun-Sep (growing/pest control)
  },
  Wheat: {
    seed: [10, 11],     // Oct-Nov (sowing)
    fertilizer: [11, 12], // Nov-Dec
    spray: [2, 3],      // Feb-Mar
  },
  Rice: {
    seed: [5, 6],       // May-Jun (sowing)
    fertilizer: [6, 7],  // Jun-Jul
    spray: [7, 9],       // Jul-Sep
  },
  Sugarcane: {
    seed: [2, 3],       // Feb-Mar
    fertilizer: [3, 5],  // Mar-May
    spray: [6, 8],       // Jun-Aug
  },
  Maize: {
    seed: [3, 4],       // Mar-Apr
    fertilizer: [4, 6],  // Apr-Jun
    spray: [5, 8],       // May-Aug
  },
  Tobacco: {
    seed: [11, 12],     // Nov-Dec
    fertilizer: [12, 1], // Dec-Jan
    spray: [2, 4],       // Feb-Apr
  },
};

/** List of known crops the owner can assign to customers. */
export const KNOWN_CROPS: string[] = Object.keys(CROP_SEASON_WINDOWS);

function isCategoryInSeason(category: string, cropName: string, now: Date): boolean {
  const windows = CROP_SEASON_WINDOWS[cropName];
  if (!windows) return false;
  const window = windows[category];
  if (!window) return false;
  const month = now.getMonth() + 1; // 1-indexed
  if (window[0] <= window[1]) {
    return month >= window[0] && month <= window[1];
  }
  // Wraps around year (e.g., Nov-Jan)
  return month >= window[0] || month <= window[1];
}

function getDaysSince(dateStr: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / 86400000);
}

function formatDaysAgo(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return days + " days ago";
}

/**
 * Get product recommendations for a specific customer.
 * Returns products the customer likely needs based on crop + basket gaps + timing.
 */
export function getRecommendationsForCustomer(
  customer: Customer,
  input: RecommendationInput & { customerCropsMap?: Record<string, string[]> },
  now?: Date,
): ProductRecommendation[] {
  const { sales, products, customerCropsMap } = input;
  const currentTime = now ?? new Date();
  const customerCrops = customerCropsMap?.[customer.id] ?? [];
  if (customerCrops.length === 0) return [];

  // Get all products this customer has purchased
  const customerSales = sales.filter(s => s.customerId === customer.id && !s.isVoided);
  const purchasedProductIds = new Set<string>();
  const lastPurchaseByProduct = new Map<string, string>(); // productId → last purchase date

  for (const sale of customerSales) {
    for (const item of sale.items) {
      purchasedProductIds.add(item.productId);
      const existing = lastPurchaseByProduct.get(item.productId);
      if (!existing || sale.createdAt > existing) {
        lastPurchaseByProduct.set(item.productId, sale.createdAt);
      }
    }
  }

  const recommendations: ProductRecommendation[] = [];

  for (const product of products) {
    if (product.stockQty <= 0) continue;

    for (const cropName of customerCrops) {
      const category = product.category;

      // Signal 1: Is this product's category relevant to this crop?
      const inSeason = isCategoryInSeason(category, cropName, currentTime);
      const hasNeverBought = !purchasedProductIds.has(product.id);
      const lastBought = lastPurchaseByProduct.get(product.id);
      const daysSinceLastBought = lastBought ? getDaysSince(lastBought, currentTime) : null;

      // Basket gap: customer hasn't bought this product and it's in season
      if (hasNeverBought && inSeason) {
        const variant = product.variants[0];
        const price = variant ? "Rs. " + Math.round(variant.sellingPrice).toLocaleString("en-PK") : "";
        recommendations.push({
          product,
          reason: cropName + " \u00B7 missing from this season\u2019s basket",
          reasonTag: "missing_from_basket",
          cropName,
        });
        break; // One recommendation per product max
      }

      // Due again: customer bought it before, it's in season, and enough time has passed
      if (!hasNeverBought && inSeason && daysSinceLastBought !== null && daysSinceLastBought > 30) {
        recommendations.push({
          product,
          reason: cropName + " \u00B7 due again, last bought " + formatDaysAgo(daysSinceLastBought),
          reasonTag: "due_again",
          cropName,
        });
        break;
      }

      // Season window open: product is in season for this crop, even if they bought it
      if (inSeason && hasNeverBought) {
        recommendations.push({
          product,
          reason: cropName + " \u00B7 growing season window is open",
          reasonTag: "season_window_open",
          cropName,
        });
        break;
      }
    }
  }

  // Prioritize: missing_from_basket > due_again > season_window_open
  const priority = { missing_from_basket: 0, due_again: 1, season_window_open: 2 };
  recommendations.sort((a, b) => priority[a.reasonTag] - priority[b.reasonTag]);

  return recommendations.slice(0, 5); // Max 5 recommendations
}

/**
 * Get customer recommendations for a specific product.
 * Returns customers who likely want this product based on crop + basket gaps + timing.
 */
export function getRecommendationsForProduct(
  product: Product,
  input: RecommendationInput & { customerCropsMap?: Record<string, string[]> },
  now?: Date,
): CustomerRecommendation[] {
  const { customers, sales, customerCropsMap } = input;
  const currentTime = now ?? new Date();
  const category = product.category;

  const recommendations: CustomerRecommendation[] = [];

  for (const customer of customers) {
    if (customer.isArchived) continue;
    const customerCrops = customerCropsMap?.[customer.id] ?? [];
    if (customerCrops.length === 0) continue;

    // Get purchase history for this customer + this product
    const customerSales = sales.filter(s => s.customerId === customer.id && !s.isVoided);
    let hasBought = false;
    let lastBoughtDate: string | null = null;

    for (const sale of customerSales) {
      for (const item of sale.items) {
        if (item.productId === product.id) {
          hasBought = true;
          if (!lastBoughtDate || sale.createdAt > lastBoughtDate) {
            lastBoughtDate = sale.createdAt;
          }
        }
      }
    }

    for (const cropName of customerCrops) {
      const inSeason = isCategoryInSeason(category, cropName, currentTime);
      const daysSinceLastBought = lastBoughtDate ? getDaysSince(lastBoughtDate, currentTime) : null;

      // Missing from basket: never bought, and it's in season
      if (!hasBought && inSeason) {
        recommendations.push({
          customer,
          reason: cropName + " \u00B7 missing from this season\u2019s basket",
          reasonTag: "missing_from_basket",
          cropName,
        });
        break;
      }

      // Due again: bought before, enough time passed, in season
      if (hasBought && inSeason && daysSinceLastBought !== null && daysSinceLastBought > 30) {
        recommendations.push({
          customer,
          reason: cropName + " \u00B7 due again, last bought " + formatDaysAgo(daysSinceLastBought),
          reasonTag: "due_again",
          cropName,
        });
        break;
      }
    }
  }

  const priority = { missing_from_basket: 0, due_again: 1, season_window_open: 2 };
  recommendations.sort((a, b) => priority[a.reasonTag] - priority[b.reasonTag]);

  return recommendations.slice(0, 5);
}
