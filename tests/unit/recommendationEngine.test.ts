import { describe, expect, it } from "vitest";
import {
  KNOWN_CROPS,
  availableStock,
  categoryFitsStage,
  cropStageOf,
  getRecommendationsForCustomer,
  getRecommendationsForProduct,
  isEligible,
  townOf,
  type CustomerCropRecord,
  type RecommendationContext,
  type RecommendationReason,
} from "../../src/lib/recommendationEngine";
import type { Customer, Product, Sale, SaleItem } from "../../src/types";

/**
 * The recommendation engine decides what to suggest off agronomic fit, and then orders what
 * survived by how the customer actually buys. Both halves are pinned here: a case that only
 * checked the order would pass while the engine happily suggested the wrong product for the
 * crop, and a case that only checked eligibility would pass while a farmer with eight acres of
 * cotton was told to buy the same pack size as one with two.
 *
 * Pure functions, no database. `now` is a parameter and the season windows are a fixed table,
 * so every case is deterministic instead of depending on the day the suite runs.
 *
 * The two rules that are easiest to break by accident have their own cases at the end:
 * **nothing is recommended without recorded agronomy** (no invented pests), and **profit margin
 * is not a signal** (changing cost price changes nothing).
 */

const CUSTOMER: Customer = {
  id: "c1",
  name: "Bilal Ahmed",
  phone: "923003333333",
  address: "Main Road, Wazirabad, Gujranwala",
  creditLimit: 50000,
  outstandingBalance: 0,
  totalPurchases: 0,
  totalPaid: 0,
  dueDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "u1",
};

const NEIGHBOUR: Customer = {
  ...CUSTOMER,
  id: "c2",
  name: "Rafiq",
  phone: "923004444444",
  address: "Chak 12, Gujranwala",
};

const FAR_OFF: Customer = {
  ...CUSTOMER,
  id: "c3",
  name: "Saleem",
  phone: "923005555555",
  address: "Bazaar, Multan",
};

function spray(id: string, name: string, company = "Suncrop", stock = 500, cost = 800): Product {
  return {
    id,
    name,
    company,
    category: "spray",
    baseUnit: "piece",
    stockQty: stock,
    variants: [
      {
        id: `v-${id}`,
        productId: id,
        name: "5-KG",
        sellingPrice: 1200,
        costPrice: cost,
        stockQty: stock,
        unitSize: 5,
        qtyStep: 1,
        lowStockThreshold: 5,
      },
    ],
  };
}

function seed(id: string, name: string): Product {
  return { ...spray(id, name), category: "seed" };
}

const LAMBDA = spray("p1", "Lambda");
const OTHER_SPRAY = spray("p2", "Targa", "Bayer");
const SEED = seed("p3", "Cotton Seed");

/** Cotton's spray window is June–September, so 27 September is inside it and 15 January is not. */
const IN_SEASON = new Date("2026-09-27T10:00:00.000Z");
const OUT_OF_SEASON = new Date("2026-01-15T10:00:00.000Z");

/** Planted in July: two months later is September, and the crop is growing, not being taken off. */
const COTTON_GROWING: CustomerCropRecord = { cropName: "Cotton", plantingDate: "2026-07-01" };
/** Planted in February: seven months later the crop is being taken off. */
const COTTON_HARVEST: CustomerCropRecord = { cropName: "Cotton", plantingDate: "2026-02-01" };

function saleOf(customer: Customer, createdAt: string, lines: Array<{ product: Product; qty?: number; variant?: string }>): Sale {
  const items: SaleItem[] = lines.map((line, i) => ({
    id: `i${i}`,
    saleId: `s-${createdAt}`,
    productId: line.product.id,
    productName: line.product.name,
    variantId: `v-${line.product.id}`,
    variantName: line.variant ?? "5-KG",
    qty: line.qty ?? 1,
    unitPrice: 1200,
    unitSize: 5,
    baseUnit: "piece",
    lineTotal: 1200 * (line.qty ?? 1),
  }));
  const total = items.reduce((sum, it) => sum + it.lineTotal, 0);
  return {
    id: `s-${createdAt}`,
    saleNumber: "SALE-1",
    customerId: customer.id,
    customerName: customer.name,
    employeeId: "u1",
    employeeName: "QA Admin",
    items,
    subtotal: total,
    taxAmount: 0,
    totalAmount: total,
    amountPaid: total,
    outstandingBalance: 0,
    paymentType: "full",
    paymentMethod: "cash",
    isVoided: false,
    createdAt,
  };
}

function context(options: {
  sales?: Sale[];
  products?: Product[];
  crops?: Record<string, CustomerCropRecord[]>;
  customers?: Customer[];
  recordedNeeds?: Record<string, string[]>;
} = {}): RecommendationContext {
  return {
    customers: options.customers ?? [CUSTOMER],
    sales: options.sales ?? [],
    products: options.products ?? [LAMBDA],
    customerCrops: options.crops ?? { [CUSTOMER.id]: [COTTON_GROWING] },
    recordedNeeds: options.recordedNeeds,
  };
}

function keys(reasons: RecommendationReason[]): string[] {
  return reasons.map((r) => r.key);
}

describe("eligibility — agronomic fit decides whether a pair is suggested at all", () => {
  it("says nothing when no crop is recorded for the customer", () => {
    // The whole engine hangs off the crop: with no crop there is no season to be in, and the
    // section is hidden rather than wrong.
    const recs = getRecommendationsForCustomer(CUSTOMER, context({ crops: {} }), IN_SEASON);
    expect(recs).toEqual([]);
    expect(KNOWN_CROPS).toContain("Cotton");
  });

  it("never suggests something that is not on the shelf", () => {
    const empty = spray("p9", "Empty", "Suncrop", 0);
    expect(getRecommendationsForCustomer(CUSTOMER, context({ products: [empty] }), IN_SEASON)).toEqual([]);
    expect(getRecommendationsForProduct(empty, context({ products: [empty] }), IN_SEASON)).toEqual([]);
    expect(availableStock(empty)).toBe(0);
  });

  it("does not suggest out-of-season stock", () => {
    expect(getRecommendationsForCustomer(CUSTOMER, context(), OUT_OF_SEASON)).toEqual([]);
  });

  it("refuses a product whose category this crop never uses", () => {
    // Cotton has no 'other' window: the product is simply not eligible, not merely low rank.
    const misc = { ...spray("p10", "Rope"), category: "other" as const };
    expect(isEligible(misc, COTTON_GROWING, IN_SEASON)).toBe(false);
    expect(getRecommendationsForCustomer(CUSTOMER, context({ products: [misc] }), IN_SEASON)).toEqual([]);
  });

  it("reads the crop stage off the recorded planting date, and only off a recorded date", () => {
    expect(cropStageOf(COTTON_GROWING, IN_SEASON)).toBe("growing");
    expect(cropStageOf(COTTON_HARVEST, IN_SEASON)).toBe("harvest");
    expect(cropStageOf({ cropName: "Cotton" }, IN_SEASON)).toBeNull();
    // A stage is not a guess: with nothing recorded, the gate opens instead of inventing one.
    expect(isEligible(LAMBDA, { cropName: "Cotton" }, IN_SEASON)).toBe(true);
  });

  it("keeps a spray out of a crop that is being harvested, and a seed out of a growing one", () => {
    expect(categoryFitsStage("spray", "harvest")).toBe(false);
    expect(isEligible(LAMBDA, COTTON_HARVEST, IN_SEASON)).toBe(false);
    expect(isEligible(SEED, COTTON_GROWING, IN_SEASON)).toBe(false);
    expect(isEligible(LAMBDA, COTTON_GROWING, IN_SEASON)).toBe(true);
  });
});

describe("ranking — behaviour orders what eligibility let through", () => {
  it("stays quiet about a product bought inside the last month", () => {
    const sales = [saleOf(CUSTOMER, "2026-09-20T09:00:00.000Z", [{ product: LAMBDA }])];
    expect(getRecommendationsForCustomer(CUSTOMER, context({ sales }), IN_SEASON)).toEqual([]);
  });

  it("asks again once a month has passed, and says how long it has been", () => {
    const sales = [saleOf(CUSTOMER, "2026-08-01T09:00:00.000Z", [{ product: LAMBDA }])];
    const recs = getRecommendationsForCustomer(CUSTOMER, context({ sales }), IN_SEASON);
    expect(recs).toHaveLength(1);
    expect(recs[0].tag).toBe("due_again");
    expect(recs[0].reasons[0].params.days).toBe("57 days ago");
  });

  it("ranks the product they keep buying ahead of one they have never bought", () => {
    const sales = [
      saleOf(CUSTOMER, "2026-06-01T09:00:00.000Z", [{ product: LAMBDA }]),
      saleOf(CUSTOMER, "2026-07-01T09:00:00.000Z", [{ product: LAMBDA }]),
    ];
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, products: [LAMBDA, OTHER_SPRAY] }),
      IN_SEASON,
    );
    expect(recs.map((r) => r.subject.id)).toEqual(["p1", "p2"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
    // The second one is still here: the point is order, not a single winner. It is a gap in a
    // category they buy, not an unfamiliar one, and the headline says so.
    expect(recs[1].tag).toBe("missing_from_basket");
  });

  it("calls a product in a category they never buy an open window, not a basket gap", () => {
    const recs = getRecommendationsForCustomer(CUSTOMER, context(), IN_SEASON);
    expect(recs).toHaveLength(1);
    expect(recs[0].tag).toBe("season_window_open");
    expect(recs[0].reasons[0].key).toBe("recommendation.seasonWindowOpen");
  });

  it("calls a gap in a category they already buy a basket gap, and a new category a window", () => {
    const sales = [saleOf(CUSTOMER, "2026-06-01T09:00:00.000Z", [{ product: OTHER_SPRAY }])];
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, products: [LAMBDA, OTHER_SPRAY] }),
      IN_SEASON,
    );
    const lambda = recs.find((r) => r.subject.id === "p1")!;
    expect(lambda.tag).toBe("missing_from_basket");
    // They have bought a Targa before, so Targa is the *familiar* one and Lambda is the gap in
    // the same category — the two get different headlines, which is the whole point of the tag.
    expect(recs.find((r) => r.subject.id === "p2")!.tag).toBe("due_again");
  });

  it("names the brand this customer actually buys", () => {
    const sales = [saleOf(CUSTOMER, "2026-07-01T09:00:00.000Z", [{ product: OTHER_SPRAY }])];
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, products: [LAMBDA, OTHER_SPRAY] }),
      IN_SEASON,
    );
    const lambda = recs.find((r) => r.subject.id === "p1")!;
    expect(keys(lambda.reasons)).toContain("recommendation.related");
    expect(lambda.signals.usualBrand).toBe("Bayer");
  });

  it("prefers the brand a customer habitually buys, all else equal", () => {
    // Bought days ago, so it is not due again — but it is what tells the engine which brand
    // this customer reaches for.
    const sales = [saleOf(CUSTOMER, "2026-09-22T09:00:00.000Z", [{ product: LAMBDA }])];
    const bayer = spray("p4", "Targa Plus", "Bayer");
    const suncrop = spray("p5", "Emax", "Suncrop");
    // The bought product stays in the catalogue: a line whose product nobody can classify tells
    // the engine nothing, so it is correctly ignored rather than guessed at.
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, products: [LAMBDA, bayer, suncrop] }),
      IN_SEASON,
    );
    // Both fit the field and neither has been bought; Suncrop is the brand this customer buys.
    expect(recs.map((r) => r.subject.id)).toEqual(["p5", "p4"]);
    expect(keys(recs[0].reasons)).toContain("recommendation.brandMatch");
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
  });

  it("counts the acreage the shop recorded and never invents one", () => {
    const withAcres = getRecommendationsForCustomer(
      CUSTOMER,
      context({ crops: { [CUSTOMER.id]: [{ ...COTTON_GROWING, acreage: 12 }] } }),
      IN_SEASON,
    );
    expect(keys(withAcres[0].reasons)).toContain("recommendation.farmSize");
    expect(withAcres[0].signals.acreage).toBe(12);

    const without = getRecommendationsForCustomer(CUSTOMER, context(), IN_SEASON);
    expect(keys(without[0].reasons)).not.toContain("recommendation.farmSize");
    expect(without[0].signals.acreage).toBeNull();
  });

  it("demotes thin stock instead of hiding it", () => {
    const thin = spray("p6", "Thin", "Suncrop", 3);
    const plenty = spray("p7", "Plenty", "Suncrop", 400);
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ products: [thin, plenty] }),
      IN_SEASON,
    );
    expect(recs.map((r) => r.subject.id)).toEqual(["p7", "p6"]);
  });

  it("caps both directions at five", () => {
    const many: Product[] = Array.from({ length: 9 }, (_, i) => spray(`p${i + 20}`, `Spray ${i + 20}`));
    expect(getRecommendationsForCustomer(CUSTOMER, context({ products: many }), IN_SEASON)).toHaveLength(5);

    const crowd: Customer[] = Array.from({ length: 9 }, (_, i) => ({
      ...CUSTOMER,
      id: `c${i + 20}`,
      name: `Farmer ${i + 20}`,
    }));
    const crops: Record<string, CustomerCropRecord[]> = {};
    crowd.forEach((c) => (crops[c.id] = [COTTON_GROWING]));
    const recs = getRecommendationsForProduct(
      LAMBDA,
      context({ customers: crowd, crops, products: [LAMBDA] }),
      IN_SEASON,
    );
    expect(recs).toHaveLength(5);
  });
});

describe("location — the same town, never a lookup", () => {
  it("reads the town off the end of a free-text address", () => {
    expect(townOf(CUSTOMER.address)).toBe("Gujranwala");
    expect(townOf(undefined)).toBeNull();
    expect(townOf("")).toBeNull();
  });

  it("adds the neighbourhood reason when a grower in the same town already buys it", () => {
    const sales = [saleOf(NEIGHBOUR, "2026-07-01T09:00:00.000Z", [{ product: LAMBDA }])];
    const crops = { [CUSTOMER.id]: [COTTON_GROWING], [NEIGHBOUR.id]: [COTTON_GROWING], [FAR_OFF.id]: [COTTON_GROWING] };
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, customers: [CUSTOMER, NEIGHBOUR, FAR_OFF], crops, products: [LAMBDA] }),
      IN_SEASON,
    );
    expect(keys(recs[0].reasons)).toContain("recommendation.sameArea");
    expect(recs[0].signals.areaBuyers).toBe(1);
  });

  it("does not claim a neighbourhood it cannot see", () => {
    // Nobody in Gujranwala has bought it, and the customer has no address of their own.
    const recs = getRecommendationsForCustomer(
      { ...CUSTOMER, address: undefined },
      context(),
      IN_SEASON,
    );
    expect(keys(recs[0].reasons)).not.toContain("recommendation.sameArea");
    expect(recs[0].signals.town).toBeNull();
  });
});

describe("the two directions agree", () => {
  it("finds the same pair from either side", () => {
    const sales = [saleOf(CUSTOMER, "2026-07-01T09:00:00.000Z", [{ product: LAMBDA }])];
    const crops = { [CUSTOMER.id]: [COTTON_GROWING] };
    const forCustomer = getRecommendationsForCustomer(CUSTOMER, context({ sales, crops }), IN_SEASON);
    const forProduct = getRecommendationsForProduct(LAMBDA, context({ sales, crops }), IN_SEASON);
    expect(forCustomer.map((r) => r.subject.id)).toEqual(["p1"]);
    expect(forProduct.map((r) => r.subject.id)).toEqual([CUSTOMER.id]);
    expect(forProduct[0].tag).toBe(forCustomer[0].tag);
    expect(keys(forProduct[0].reasons)).toEqual(keys(forCustomer[0].reasons));
  });

  it("drops a customer who already bought the product this season", () => {
    const sales = [saleOf(CUSTOMER, "2026-09-20T09:00:00.000Z", [{ product: LAMBDA }])];
    expect(getRecommendationsForProduct(LAMBDA, context({ sales }), IN_SEASON)).toEqual([]);
  });
});

describe("the two rules that are easy to break by accident", () => {
  it("never claims a pest, a disease or a need that was not recorded", () => {
    const without = getRecommendationsForCustomer(CUSTOMER, context(), IN_SEASON);
    expect(keys(without[0].reasons)).not.toContain("recommendation.recordedNeed");
    expect(JSON.stringify(without[0].reasons)).not.toMatch(/pest|disease|whitefly|weed/i);

    const withNeed = getRecommendationsForCustomer(
      CUSTOMER,
      context({ recordedNeeds: { [CUSTOMER.id]: ["Whitefly on cotton"] } }),
      IN_SEASON,
    );
    const need = withNeed[0].reasons.find((r) => r.key === "recommendation.recordedNeed");
    expect(need?.params.need).toBe("Whitefly on cotton");
  });

  it("reads pesticide and spray as the same shelf, at the same time of year", () => {
    // The form offers "Pesticide"; the season table was written against "spray". Read
    // literally, every product the shop created itself became unmatchable, and the
    // "customers likely to want this" section stayed empty for exactly those products.
    const pesticide: Product = { ...spray("p40", "Karate"), category: "pesticide" };
    expect(isEligible(pesticide, COTTON_GROWING, IN_SEASON)).toBe(true);
    expect(isEligible(pesticide, COTTON_GROWING, OUT_OF_SEASON)).toBe(false);
    expect(categoryFitsStage("pesticide", "growing")).toBe(true);
    expect(categoryFitsStage("pesticide", "harvest")).toBe(false);
    // A crop with no window for either name stays closed to both.
    expect(isEligible(pesticide, { cropName: "Mango" }, IN_SEASON)).toBe(false);

    const twin = spray("p41", "Karate");
    const crops = { [CUSTOMER.id]: [COTTON_GROWING] };
    const asSpray = getRecommendationsForProduct(twin, context({ crops, products: [twin] }), IN_SEASON);
    const asPesticide = getRecommendationsForProduct(pesticide, context({ crops, products: [pesticide] }), IN_SEASON);
    expect(asPesticide.map((r) => r.subject.id)).toEqual(asSpray.map((r) => r.subject.id));
    expect(asPesticide.map((r) => keys(r.reasons))).toEqual(asSpray.map((r) => keys(r.reasons)));

    // And one shelf is one category when reading a customer's history, so a pesticide row is
    // not offered to a spray buyer as something they have never bought.
    const sales = [saleOf(CUSTOMER, "2026-07-01T09:00:00.000Z", [{ product: LAMBDA }])];
    const recs = getRecommendationsForCustomer(
      CUSTOMER,
      context({ sales, products: [LAMBDA, pesticide] }),
      IN_SEASON,
    );
    expect(keys(recs.find((r) => r.subject.id === pesticide.id)!.reasons)).toContain(
      "recommendation.related",
    );
  });

  it("says nothing about profit: cost price is not a signal", () => {
    const cheap = spray("p8", "Cheap", "Suncrop", 500, 100);
    const dear = spray("p30", "Dear", "Suncrop", 500, 1100);
    const base = context({ products: [cheap, dear] });

    const before = getRecommendationsForCustomer(CUSTOMER, base, IN_SEASON);
    // Give the cheap one a fortune of margin and the dear one none: the answer must not move.
    const swapped = context({
      products: [spray("p8", "Cheap", "Suncrop", 500, 5000), spray("p30", "Dear", "Suncrop", 500, 1)],
    });
    const after = getRecommendationsForCustomer(CUSTOMER, swapped, IN_SEASON);

    expect(before.map((r) => r.subject.id)).toEqual(after.map((r) => r.subject.id));
    expect(before.map((r) => r.score)).toEqual(after.map((r) => r.score));
    expect(before.map((r) => keys(r.reasons))).toEqual(after.map((r) => keys(r.reasons)));
  });
});
