import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearch } from "@/lib/searchText";

/**
 * The one comparison the ledger search and the global search share. The point of the test is
 * that the same shop word typed on a phone, in either script, still finds the record.
 */
describe("search text", () => {
  it("finds a name by part of it, in any case", () => {
    expect(matchesSearch("Ka", ["Kashif Ali"])).toBe(true);
    expect(matchesSearch("ali", ["Kashif Ali"])).toBe(true);
    expect(matchesSearch("khan", ["Khan test"])).toBe(true);
    expect(matchesSearch("han", ["Khan test"])).toBe(true);
    expect(matchesSearch("zz", ["Khan test"])).toBe(false);
  });

  it("treats the two Urdu yeh and kaf forms as one letter", () => {
    expect(normalizeSearch("کراچي")).toBe(normalizeSearch("کراچی"));
    expect(normalizeSearch("كتاب")).toBe(normalizeSearch("کتاب"));
  });

  it("ignores diacritics and Arabic/Persian digits", () => {
    expect(normalizeSearch("کِتاب")).toBe("کتاب");
    expect(normalizeSearch("١٢٣")).toBe("123");
    expect(normalizeSearch("۱۲۳")).toBe("123");
  });

  it("requires every word, in any order", () => {
    expect(matchesSearch("season rabi", ["urea supply for rabi season"])).toBe(true);
    expect(matchesSearch("rabi kharif", ["urea supply for rabi season"])).toBe(false);
  });

  it("matches the way money is printed", () => {
    expect(matchesSearch("1,000", ["Rs. 1,000"])).toBe(true);
  });
});
