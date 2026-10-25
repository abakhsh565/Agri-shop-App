import { describe, expect, it } from "vitest";
import { applyBranchStock, filterProductsForBranch } from "@/lib/branchStock";
import type { Product, ProductVariant } from "@/types";

/**
 * The product list must show the selected branch's shelf, never the shop's.
 *
 * `product_variants.stock_qty` is a shop total. 0238 answers for the working branch, and
 * `applyBranchStock` is the one place that answer is put on the catalogue. These cases pin
 * the three states that matter: an answered branch read (including the empty answer), a
 * failed read that must fall back rather than blank the screen, and a variant the branch
 * does not hold at all. The last one is the bug the owner reported: a product listed in
 * Main Branch showed "In Stock" because another branch held 503 units.
 */

function variant(id: string, stockQty: number): ProductVariant {
  return {
    id,
    productId: "product-1",
    name: id,
    sellingPrice: 100,
    costPrice: 50,
    stockQty,
    unitSize: 1,
    qtyStep: 1,
    lowStockThreshold: 10,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "K plus",
    company: "",
    category: "pesticide",
    baseUnit: "piece",
    stockQty: 503,
    variants: [variant("v1", 503), variant("v2", 0)],
    ...overrides,
  };
}

describe("branch stock scope", () => {
  it("uses the branch quantity and treats a missing variant as zero, not the shop total", () => {
    const [applied] = applyBranchStock([product()], new Map([["v1", 40]]));

    expect(applied.variants.find((v) => v.id === "v1")?.stockQty).toBe(40);
    expect(applied.variants.find((v) => v.id === "v2")?.stockQty).toBe(0);
    expect(applied.stockQty).toBe(40);
  });

  it("honours an empty branch answer: nothing on this shelf means zero everywhere", () => {
    const [applied] = applyBranchStock([product()], new Map());

    expect(applied.variants.every((v) => v.stockQty === 0)).toBe(true);
    expect(applied.stockQty).toBe(0);
  });

  it("leaves the shop quantities in place only when the branch read failed", () => {
    const [applied] = applyBranchStock([product()], null);

    expect(applied.stockQty).toBe(503);
    expect(applied.variants.find((v) => v.id === "v1")?.stockQty).toBe(503);
  });

  it("does not mutate the loaded rows", () => {
    const original = product();
    applyBranchStock([original], new Map([["v1", 1]]));

    expect(original.stockQty).toBe(503);
    expect(original.variants.find((v) => v.id === "v1")?.stockQty).toBe(503);
  });

  it("leaves a variant-less catalogue row alone", () => {
    const base = product({ variants: [], stockQty: 7 });
    const [applied] = applyBranchStock([base], new Map([["v1", 40]]));

    expect(applied.stockQty).toBe(7);
  });
});

describe("branch catalogue scope", () => {
  const kPlus = product({ id: "product-1", name: "K plus" });
  const lambda = product({ id: "product-2", name: "Lambda", variants: [variant("v3", 8)] });

  it("keeps only the products the branch carries", () => {
    const visible = filterProductsForBranch([kPlus, lambda], new Set(["product-2"]));

    expect(visible.map((p) => p.id)).toEqual(["product-2"]);
  });

  it("empties the catalogue when the branch carries nothing", () => {
    expect(filterProductsForBranch([kPlus, lambda], new Set())).toEqual([]);
  });

  it("keeps the loaded catalogue when the branch read failed", () => {
    expect(filterProductsForBranch([kPlus, lambda], null)).toHaveLength(2);
  });

  it("does not mutate the rows", () => {
    const rows = [kPlus, lambda];
    filterProductsForBranch(rows, new Set(["product-2"]));

    expect(rows).toHaveLength(2);
  });
});
