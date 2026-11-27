import { beforeEach, describe, expect, it } from "vitest";
import { useCartStore } from "@/stores/cartStore";
import { discountFor, percentOf, clampToBase } from "@/lib/discount";
import type { CartItem } from "@/types";

/**
 * Discounts, proved rather than assumed.
 *
 * The review screen can take money off one line or the whole bill, typed as a percent or as
 * rupees. Three things have to hold or the shop loses money quietly:
 *
 *   1. the two ways of typing the same reduction give the same rupees;
 *   2. nothing can reduce a sale below zero, at either scope;
 *   3. a reduction survives an edit that makes it too large — a line's discount follows its own
 *      quantity down, and a bill's discount follows the lines it is taken off.
 */

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: "product-1",
    productName: "Urea",
    variantId: "variant-1",
    variantName: "50 kg",
    qty: 1,
    unitPrice: 500,
    unitSize: 50,
    baseUnit: "kg",
    lineTotal: 500,
    maxQty: 20,
    qtyStep: 1,
    ...overrides,
  };
}

describe("discount arithmetic", () => {
  it("gives the same rupees for 10% and for the amount that percent is worth", () => {
    const base = 8000;
    expect(discountFor(base, "percent", 10)).toBe(800);
    expect(discountFor(base, "amount", 800)).toBe(800);
    expect(discountFor(1250, "percent", 12.5)).toBe(156.25);
  });

  it("rounds to paisa, not to floating-point noise", () => {
    expect(discountFor(999.99, "percent", 33)).toBe(330);
    expect(discountFor(333.33, "percent", 33.3)).toBe(111);
    expect(discountFor(100, "percent", 0.005)).toBe(0.01);
  });

  it("never lets a reduction exceed what it is taken off", () => {
    expect(discountFor(8000, "percent", 150)).toBe(8000);
    expect(discountFor(8000, "amount", 9000)).toBe(8000);
    expect(clampToBase(0, 500)).toBe(0);
    expect(discountFor(8000, "amount", -50)).toBe(0);
  });

  it("states an existing rupee discount as the percent it represents", () => {
    expect(percentOf(8000, 800)).toBe(10);
    expect(percentOf(0, 800)).toBe(0);
    expect(discountFor(8000, "percent", percentOf(8000, 800))).toBe(800);
  });
});

describe("the cart applies a discount where the sale reads it", () => {
  beforeEach(() => {
    useCartStore.setState({ scopeKey: null, carts: {}, customer: null, items: [], discount: 0, drafts: [], draftId: null });
    useCartStore.getState().setScope("tenant-1:owner-1");
  });

  it("takes a bill discount off the lines and reports it as the sale total", () => {
    useCartStore.getState().addItem(line({ qty: 2, lineTotal: 1000 }));
    useCartStore.getState().addItem(line({ variantId: "variant-2", unitPrice: 500, qty: 1, lineTotal: 500 }));

    expect(useCartStore.getState().subtotal()).toBe(1500);
    useCartStore.getState().setDiscount(discountFor(1500, "percent", 10));

    expect(useCartStore.getState().discount).toBe(150);
    expect(useCartStore.getState().total()).toBe(1350);
  });

  it("caps a bill discount at what the lines are worth", () => {
    useCartStore.getState().addItem(line({ qty: 1, lineTotal: 500 }));
    useCartStore.getState().setDiscount(900);

    expect(useCartStore.getState().discount).toBe(500);
    expect(useCartStore.getState().total()).toBe(0);
  });

  it("caps a line discount at the line and keeps the total honest", () => {
    useCartStore.getState().addItem(line({ qty: 2, lineTotal: 1000 }));
    useCartStore.getState().setLineDiscount("variant-1", 1400);

    const [row] = useCartStore.getState().items;
    expect(row.discount).toBe(1000);
    expect(row.lineTotal).toBe(0);
    expect(useCartStore.getState().total()).toBe(0);
  });

  it("follows a line's quantity down instead of leaving a discount bigger than the line", () => {
    useCartStore.getState().addItem(line({ qty: 2, lineTotal: 1000 }));
    useCartStore.getState().setLineDiscount("variant-1", 1000);
    expect(useCartStore.getState().items[0].lineTotal).toBe(0);

    useCartStore.getState().updateQty("variant-1", 1);

    const [row] = useCartStore.getState().items;
    expect(row.qty).toBe(1);
    expect(row.discount).toBe(500);
    expect(row.lineTotal).toBe(0);
    expect(useCartStore.getState().total()).toBe(0);
  });

  it("shrinks a bill discount when the line it covered is removed", () => {
    useCartStore.getState().addItem(line({ qty: 1, lineTotal: 500 }));
    useCartStore.getState().addItem(line({ variantId: "variant-2", qty: 1, unitPrice: 1500, lineTotal: 1500 }));
    useCartStore.getState().setDiscount(1500);
    expect(useCartStore.getState().total()).toBe(500);

    useCartStore.getState().removeItem("variant-2");

    expect(useCartStore.getState().discount).toBe(500);
    expect(useCartStore.getState().total()).toBe(0);
  });

  it("adds a line that already carries a discount without double-counting it", () => {
    useCartStore.getState().addItem(line({ qty: 2, lineTotal: 900, discount: 100 }));
    expect(useCartStore.getState().subtotal()).toBe(900);
    expect(useCartStore.getState().total()).toBe(900);

    useCartStore.getState().setDiscount(discountFor(900, "amount", 300));
    expect(useCartStore.getState().total()).toBe(600);
  });
});
