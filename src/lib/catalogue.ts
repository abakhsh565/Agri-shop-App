import type { I18nKey } from "@/lib/i18n";
import type { Product, ProductCategory, ShopCategory } from "@/types";

/**
 * What the category and unit catalogue means, derived once.
 *
 * WHY THIS FILE EXISTS. Four screens now show the shop's own shelves — the Categories list, the
 * category form, the Add Product picker and a product's page — and three of them state a count.
 * A shelf's NAME and the number of products on it are judgements, and a screen that decides
 * either for itself is how the same shelf ends up translated on one page and raw on another, or
 * holding four products in one list and six in another. Both live here.
 *
 * The words for the seven seeded shelves are the app's own (`products.category.*`), because the
 * owner never typed them; everything else is the owner's name, printed exactly as typed. That is
 * the whole reason `isSystem` exists.
 */

/** The name this shelf is shown by. */
export function categoryDisplayName(
  category: Pick<ShopCategory, "name" | "isSystem" | "legacyCategory">,
  t: (key: I18nKey) => string,
): string {
  if (category.isSystem && category.legacyCategory) {
    return t(`products.category.${category.legacyCategory}` as I18nKey);
  }
  return category.name;
}

/** The root of a shelf: itself when it is top-level, its parent otherwise. */
export function categoryRoot(
  category: ShopCategory,
  categories: ShopCategory[],
): ShopCategory {
  if (!category.parentId) return category;
  return categories.find((c) => c.id === category.parentId) ?? category;
}

/**
 * Every shelf in reading order: each top-level shelf, then its own children.
 *
 * `parent` is carried beside the shelf so a picker can indent without rebuilding the lookup,
 * and so a row can say "under Pesticide" in its meta line.
 */
export interface CategoryLine {
  category: ShopCategory;
  parent: ShopCategory | null;
}

export function orderedCategories(categories: ShopCategory[]): CategoryLine[] {
  const roots = categories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const lines: CategoryLine[] = [];
  for (const root of roots) {
    lines.push({ category: root, parent: null });
    const children = categories
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    for (const child of children) lines.push({ category: child, parent: root });
  }

  // A shelf whose parent is missing (a stale cache from another shop) is still a shelf: it is
  // listed at the end rather than silently disappearing from the screen that manages it.
  const shown = new Set(lines.map((l) => l.category.id));
  for (const orphan of categories) {
    if (!shown.has(orphan.id)) lines.push({ category: orphan, parent: null });
  }
  return lines;
}

/**
 * How many products this shelf holds, counting its children's products.
 *
 * A product filed before 0259 has no `categoryId`; it is counted on the seeded shelf its kind
 * already names, so a shop that never re-files anything still sees honest numbers.
 */
export function categoryItemCount(
  category: ShopCategory,
  categories: ShopCategory[],
  products: Product[],
): number {
  const ids = new Set<string>([category.id]);
  for (const child of categories) {
    if (child.parentId === category.id) ids.add(child.id);
  }
  return products.filter((product) => {
    if (product.categoryId) return ids.has(product.categoryId);
    return category.isSystem && category.legacyCategory === product.category;
  }).length;
}

/** How many shelves live directly under this one. */
export function subcategoryCount(category: ShopCategory, categories: ShopCategory[]): number {
  return categories.filter((c) => c.parentId === category.id).length;
}

/**
 * The seeded shelf for one of the seven fixed kinds, or none.
 *
 * Used when a product has a kind but no shelf — a row written before 0259, or a draft — so the
 * form can open on the shelf that kind already belongs to rather than on nothing.
 */
export function categoryForKind(
  kind: ProductCategory | string | null | undefined,
  categories: ShopCategory[],
): ShopCategory | null {
  if (!kind) return null;
  return (
    categories.find((c) => !c.parentId && c.isSystem && c.legacyCategory === kind) ?? null
  );
}

/** "Kilogram (kg)" — the one way a unit is named on a screen. */
export function unitLabel(unit: { name: string; symbol: string }): string {
  // "Liter (liter)" is the same word twice; the symbol only earns its brackets when it says
  // something the name does not.
  const same = unit.symbol.trim().toLowerCase() === unit.name.trim().toLowerCase();
  return unit.symbol && !same ? `${unit.name} (${unit.symbol})` : unit.name;
}

/** The symbol a quantity is written with. */
export function unitSymbol(unit: { symbol: string }): string {
  return unit.symbol;
}
