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
/**
 * Keep only the products this branch actually carries.
 *
 * `product_branches` (0240) records where a product exists: the branch that created it,
 * plus every branch that has moved stock of it. A branch created today has no rows, so its
 * catalogue is empty instead of echoing the whole shop at quantity zero.
 *
 * `null` means the branch read failed. Showing the loaded catalogue is the pre-0240
 * behaviour and is safer than blanking every screen on a failed request.
 */
export function filterProductsForBranch(
  products: Product[],
  productIds: Set<string> | null,
): Product[] {
  if (!productIds) return products;
  return products.filter((product) => productIds.has(product.id));
}

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
