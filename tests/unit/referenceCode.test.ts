import { describe, expect, it } from "vitest";
import { referenceCode } from "@/lib/referenceCode";

/**
 * The reference code is a promise to the user, not a formatting detail: the same record must read
 * the same on every screen, after every reload, for every user. These lock that down — and lock
 * the shape, because a row that sometimes prints `SL#12` and sometimes `SL#000012` is worse than
 * no code at all.
 */
describe("referenceCode", () => {
  const saleId = "8f14e45f-ea3b-4a4f-9a1e-3a5f0c9a1b77";

  it("is stable for the same record", () => {
    expect(referenceCode("SL", saleId)).toBe(referenceCode("SL", saleId));
  });

  it("reads PREFIX# plus six digits", () => {
    expect(referenceCode("SL", saleId)).toMatch(/^SL#\d{6}$/);
    expect(referenceCode("EMP", "11111111-2222-4333-8444-555555555555")).toMatch(/^EMP#\d{6}$/);
  });

  it("separates records — two ids never fold to one name in a normal list", () => {
    const ids = [
      saleId,
      "11111111-2222-4333-8444-555555555555",
      "2b3c4d5e-6f70-4819-9a1b-2c3d4e5f6071",
      "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    ];
    const codes = new Set(ids.map((id) => referenceCode("SL", id)));
    expect(codes.size).toBe(ids.length);
  });

  it("keeps the prefix as the only way to tell kinds apart", () => {
    expect(referenceCode("SL", saleId)).not.toBe(referenceCode("INV", saleId));
    expect(referenceCode("SL", saleId).slice(0, 2)).toBe("SL");
  });

  it("names a record with no server id instead of printing undefined", () => {
    expect(referenceCode("SL", undefined)).toBe("SL#000000");
    expect(referenceCode("SL", "")).toBe("SL#000000");
  });
});
