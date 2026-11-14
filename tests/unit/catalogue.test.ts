/**
 * The catalogue's own judgements, locked.
 *
 * WHY THIS FILE EXISTS. Four screens now show the shop's shelves and three of them print a
 * count. Whether a seeded shelf is translated, whether a child is listed under its parent, and
 * whether a parent's count includes its children's products are the three answers that must
 * not differ between the Categories list, the category form and Add Product. They are decided
 * in `src/lib/catalogue.ts`; these tests pin the decisions.
 */
import { describe, expect, it } from "vitest";
import {
  categoryDisplayName,
  categoryForKind,
  categoryItemCount,
  categoryRoot,
  orderedCategories,
  subcategoryCount,
  unitLabel,
} from "@/lib/catalogue";
import type { Product, ShopCategory } from "@/types";

const t = (key: string) => `t:${key}`;

function shelf(over: Partial<ShopCategory> & { id: string; name: string }): ShopCategory {
  return {
    parentId: null,
    legacyCategory: null,
    isSystem: false,
    sortOrder: 0,
    ...over,
  };
}

function product(over: Partial<Product> & { id: string }): Product {
  return {
    name: over.id,
    company: "",
    category: "other",
    baseUnit: "kg",
    stockQty: 0,
    variants: [],
    ...over,
  };
}

describe("catalogue naming", () => {
  it("translates a seeded shelf and prints the owner's own name for everything else", () => {
    expect(
      categoryDisplayName(
        { name: "Pesticide", isSystem: true, legacyCategory: "pesticide" },
        t,
      ),
    ).toBe("t:products.category.pesticide");
    expect(
      categoryDisplayName(
        { name: "Keet Nashak", isSystem: false, legacyCategory: "pesticide" },
        t,
      ),
    ).toBe("Keet Nashak");
  });

  it("does not repeat a symbol that is just the name in another case", () => {
    expect(unitLabel({ name: "Liter", symbol: "liter" })).toBe("Liter");
    expect(unitLabel({ name: "Kilogram", symbol: "kg" })).toBe("Kilogram (kg)");
    expect(unitLabel({ name: "Bori", symbol: "bori" })).toBe("Bori");
  });
});

describe("catalogue ordering", () => {
  const seed = shelf({ id: "seed", name: "Seed", isSystem: true, legacyCategory: "seed", sortOrder: 1 });
  const pest = shelf({ id: "pest", name: "Pesticide", isSystem: true, legacyCategory: "pesticide", sortOrder: 2 });
  const powder = shelf({ id: "powder", name: "Insect powder", parentId: "pest", sortOrder: 0 });
  const dust = shelf({ id: "dust", name: "Dust", parentId: "pest", sortOrder: 1 });

  it("puts each child directly under its own parent, in the parent's order", () => {
    expect(orderedCategories([pest, dust, powder, seed]).map((l) => l.category.id)).toEqual([
      "seed",
      "pest",
      "powder",
      "dust",
    ]);
  });

  it("still lists a shelf whose parent is missing rather than hiding it", () => {
    const orphan = shelf({ id: "orphan", name: "Orphan", parentId: "gone" });
    expect(orderedCategories([orphan]).map((l) => l.category.id)).toEqual(["orphan"]);
  });

  it("resolves the root of a child, and the child itself when it is a root", () => {
    expect(categoryRoot(powder, [pest, powder]).id).toBe("pest");
    expect(categoryRoot(pest, [pest, powder]).id).toBe("pest");
  });

  it("counts only direct children as subcategories", () => {
    expect(subcategoryCount(pest, [pest, powder, dust])).toBe(2);
    expect(subcategoryCount(powder, [pest, powder, dust])).toBe(0);
  });
});

describe("catalogue counts", () => {
  const pest = shelf({ id: "pest", name: "Pesticide", isSystem: true, legacyCategory: "pesticide" });
  const powder = shelf({ id: "powder", name: "Insect powder", parentId: "pest" });
  const seed = shelf({ id: "seed", name: "Seed", isSystem: true, legacyCategory: "seed" });

  it("counts a parent's children's products as the parent's own", () => {
    const products = [
      product({ id: "a", categoryId: "pest" }),
      product({ id: "b", categoryId: "powder" }),
      product({ id: "c", categoryId: "seed" }),
    ];
    expect(categoryItemCount(pest, [pest, powder, seed], products)).toBe(2);
    expect(categoryItemCount(powder, [pest, powder, seed], products)).toBe(1);
    expect(categoryItemCount(seed, [pest, powder, seed], products)).toBe(1);
  });

  it("counts a pre-0259 product on the seeded shelf its kind names", () => {
    // No categoryId: the row predates the catalogue, and its kind still says which shelf it is
    // on. Counting it nowhere would make the shelf look emptier than it is.
    const legacy = product({ id: "old", category: "pesticide" });
    expect(categoryItemCount(pest, [pest, powder, seed], [legacy])).toBe(1);
    expect(categoryItemCount(seed, [pest, powder, seed], [legacy])).toBe(0);
  });

  it("finds the seeded shelf for a fixed kind", () => {
    expect(categoryForKind("seed", [pest, powder, seed])?.id).toBe("seed");
    expect(categoryForKind("unknown", [pest, powder, seed])).toBeNull();
  });
});
