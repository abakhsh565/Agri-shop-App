import type { Product } from "@/types";

/**
 * Put the working branch's quantities on the catalogue.
 *
 * The catalogue itself is a shop-level record — a product may be sold in any branch — but
 * `product_variants.stock_qty` is a SHOP total. Rendering it while the account works in one
 * branch made every product look in stock somewhere, even when this branch held none of it.
 * `get_branch_variant_stock()` answers for the active branch; this applies its answer to the
 * already-loaded rows.
 *
 * `null` means the branch read itself failed (for example an APK talking to a database that
 * does not have migration 0238 yet). In that case the shop-wide quantities are left in place:
 * a stale-but-real shelf is safer than blanking every quantity on a failed request.
 *
 * A variant missing from the map genuinely holds nothing here, so it becomes 0 — never the
 * shop total. The product's own total is the sum of those branch quantities, not the value
 * `products.stock_qty` carried.
 */
export function applyBranchStock(
  products: Product[],
  qtyByVariant: Map<string, number> | null,
): Product[] {
  if (!qtyByVariant) return products;

  return products.map((product) => {
    // A catalogue row with no variants has no shelf to speak of; its own number stays.
    if (product.variants.length === 0) return product;

    const variants = product.variants.map((variant) => ({
      ...variant,
      stockQty: qtyByVariant.get(variant.id) ?? 0,
    }));

    return {
      ...product,
      variants,
      stockQty: variants.reduce((sum, variant) => sum + (variant.stockQty ?? 0), 0),
    };
  });
}
