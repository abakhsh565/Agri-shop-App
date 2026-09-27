import { describe, expect, it } from "vitest";
import { getRecommendationsForCustomer, getRecommendationsForProduct, KNOWN_CROPS } from "../../src/lib/recommendationEngine";
import type { Customer, Product, Sale } from "../../src/types";

/**
 * The recommendation engine is the one feature in the product whose output is invisible
 * when it decides nothing is worth suggesting — both call sites return `null` rather than
 * an empty state, so "no suggestion" and "feature not built" look identical on screen.
 * These cases pin the rules down, including the one that makes the section disappear in
 * the QA shop (a customer who bought the season's product today is deliberately not
 * asked to buy it again).
 *
 * Pure functions, no database: the season windows are a fixed table and `now` is a
 * parameter, so every case is deterministic instead of depending on the day the suite runs.
 */

const CUSTOMER: Customer = {
  id: "c1",
  name: "Bilal Ahmed",
  phone: "923003333333",
  address: "Wazirabad",
  creditLimit: 50000,
  outstandingBalance: 0,
  totalPurchases: 0,
  totalPaid: 0,
  dueDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "u1",
};

const SPRAY: Product = {
  id: "p1",
  name: "Lambda",
  company: "Suncrop",
  category: "spray",
  baseUnit: "piece",
  stockQty: 1194,
  variants: [
    {
      id: "v1",
      productId: "p1",
      name: "5-KG",
      sellingPrice: 1200,
      costPrice: 800,
      stockQty: 1194,
      unitSize: 400,
      qtyStep: 1,
      lowStockThreshold: 5,
    },
  ],
};

/** Cotton's spray window is June–September, so September is inside it and January is not. */
const IN_SEASON = new Date("2026-09-27T10:00:00.000Z");
const OUT_OF_SEASON = new Date("2026-01-15T10:00:00.000Z");

function saleOn(product: Product, createdAt: string): Sale {
  return {
    id: "s1",
    saleNumber: "SALE-1",
    customerId: CUSTOMER.id,
    customerName: CUSTOMER.name,
    employeeId: "u1",
    employeeName: "QA Admin",
    items: [
      {
        id: "i1",
        saleId: "s1",
        productId: product.id,
        productName: product.name,
        variantId: "v1",
        variantName: "5-KG",
        quantity: 1,
        unitPrice: 1200,
        totalPrice: 1200,
        costPrice: 800,
      },
    ],
    subtotal: 1200,
    taxAmount: 0,
    totalAmount: 1200,
    amountPaid: 1200,
    outstandingBalance: 0,
    paymentType: "full",
    paymentMethod: "cash",
    isVoided: false,
    createdAt,
    updatedAt: createdAt,
  } as Sale;
}

const input = (sales: Sale[] = [], products: Product[] = [SPRAY], crops: string[] = ["Cotton"]) => ({
  customers: [CUSTOMER],
  sales,
  products,
  customerCropsMap: { [CUSTOMER.id]: crops },
});

describe("recommendations for a customer", () => {
  it("says nothing when the customer has no crops assigned", () => {
    // The whole engine hangs off the crop: with no crop there is no season to be in, and
    // the section is hidden rather than wrong.
    expect(getRecommendationsForCustomer(CUSTOMER, input([], [SPRAY], []), IN_SEASON)).toEqual([]);
    expect(KNOWN_CROPS).toContain("Cotton");
  });

  it("suggests an in-season product the customer has never bought", () => {
    const recs = getRecommendationsForCustomer(CUSTOMER, input(), IN_SEASON);
    expect(recs).toHaveLength(1);
    expect(recs[0].reasonTag).toBe("missing_from_basket");
    expect(recs[0].cropName).toBe("Cotton");
  });

  it("stays quiet for a product bought today — the case that hides the section in the QA shop", () => {
    const recs = getRecommendationsForCustomer(CUSTOMER, input([saleOn(SPRAY, "2026-09-27T09:00:00.000Z")]), IN_SEASON);
    expect(recs).toEqual([]);
  });

  it("asks again once a month has passed since the last purchase", () => {
    const recs = getRecommendationsForCustomer(CUSTOMER, input([saleOn(SPRAY, "2026-08-01T09:00:00.000Z")]), IN_SEASON);
    expect(recs).toHaveLength(1);
    expect(recs[0].reasonTag).toBe("due_again");
  });

  it("does not suggest out-of-season stock", () => {
    expect(getRecommendationsForCustomer(CUSTOMER, input(), OUT_OF_SEASON)).toEqual([]);
  });

  it("never suggests something that is not on the shelf", () => {
    const empty: Product = { ...SPRAY, id: "p2", stockQty: 0, variants: [{ ...SPRAY.variants[0], id: "v2", productId: "p2", stockQty: 0 }] };
    expect(getRecommendationsForCustomer(CUSTOMER, input([], [empty]), IN_SEASON)).toEqual([]);
  });

  it("caps the list at five products", () => {
    const many: Product[] = Array.from({ length: 9 }, (_, i) => ({
      ...SPRAY,
      id: `p${i + 10}`,
      name: `Spray ${i + 10}`,
      variants: [{ ...SPRAY.variants[0], id: `v${i + 10}`, productId: `p${i + 10}` }],
    }));
    expect(getRecommendationsForCustomer(CUSTOMER, input([], many), IN_SEASON)).toHaveLength(5);
  });
});

describe("recommendations for a product", () => {
  it("finds the customer whose crop is in season for it", () => {
    const recs = getRecommendationsForProduct(SPRAY, input(), IN_SEASON);
    expect(recs.map((r) => r.customer.id)).toEqual([CUSTOMER.id]);
  });

  it("drops a customer who already bought it this season", () => {
    const recs = getRecommendationsForProduct(SPRAY, input([saleOn(SPRAY, "2026-09-27T09:00:00.000Z")]), IN_SEASON);
    expect(recs).toEqual([]);
  });
});
