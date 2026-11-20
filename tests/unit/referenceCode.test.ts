import { describe, expect, it } from "vitest";
import { REFERENCE_PREFIX, referenceCode } from "@/lib/referenceCode";

/**
 * The reference code is a promise to the user, not a formatting detail: the same record must read
 * the same on every screen, after every reload, for every user — and it must read the way the
 * trade writes it (`SAL-001`, `PUR-001`), because these names are spoken over a counter.
 */
describe("referenceCode", () => {
  const saleId = "8f14e45f-ea3b-4a4f-9a1e-3a5f0c9a1b77";

  it("is stable for the same record", () => {
    expect(referenceCode("sale", saleId)).toBe(referenceCode("sale", saleId));
  });

  it("uses the trade's prefixes", () => {
    expect(REFERENCE_PREFIX.invoice).toBe("INV");
    expect(REFERENCE_PREFIX.sale).toBe("SAL");
    expect(REFERENCE_PREFIX.salesOrder).toBe("SO");
    expect(REFERENCE_PREFIX.purchase).toBe("PUR");
    expect(REFERENCE_PREFIX.purchaseOrder).toBe("PO");
    expect(REFERENCE_PREFIX.quotation).toBe("QUO");
    expect(REFERENCE_PREFIX.payment).toBe("PAY");
  });

  it("reads PREFIX- then three digits", () => {
    expect(referenceCode("sale", saleId)).toMatch(/^SAL-\d{3}$/);
    expect(referenceCode("purchase", saleId)).toMatch(/^PUR-\d{3}$/);
    expect(referenceCode("invoice", saleId)).toMatch(/^INV-\d{3}$/);
  });

  it("never reads as SAL-000 — that slot means 'no server identity yet'", () => {
    const codes = Array.from({ length: 200 }, (_, i) =>
      referenceCode("sale", `0000000${i}-0000-4000-8000-000000000000`),
    );
    expect(codes.some((c) => c === "SAL-000")).toBe(false);
  });

  it("spreads records across the range instead of piling on one number", () => {
    const codes = new Set(
      Array.from({ length: 200 }, (_, i) =>
        referenceCode("sale", `${(i * 7919).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`),
      ),
    );
    // 200 ids into 999 slots: a few repeats are expected, but the range must be in use.
    expect(codes.size).toBeGreaterThan(150);
  });

  it("keeps the prefix as the only way to tell kinds apart", () => {
    expect(referenceCode("sale", saleId)).not.toBe(referenceCode("product", saleId));
    expect(referenceCode("sale", saleId).split("-")[0]).toBe("SAL");
    expect(referenceCode("product", saleId).split("-")[0]).toBe("PRD");
  });

  it("names a record with no server id instead of printing undefined", () => {
    expect(referenceCode("sale", undefined)).toBe("SAL-001");
    expect(referenceCode("sale", "")).toBe("SAL-001");
  });
});
