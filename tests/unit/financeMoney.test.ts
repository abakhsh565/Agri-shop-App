/**
 * The Finance screen's arithmetic, held still.
 *
 * Three rules the screen prints and must never silently change:
 *   1. Net profit is net sales − cost of goods − RECORDED expenses. The Sales report's profit has
 *      never subtracted a rent bill, and the two must not drift into meaning different things.
 *   2. An unknown figure stays unknown. Null in any term means null out, never a zero that makes
 *      the month look worse (or better) than it is.
 *   3. A trend needs a baseline. A previous period of zero is a first month, not an infinite
 *      improvement, so no percentage is printed.
 *
 * The month window is a Pakistan calendar month, and the previous window ends the day before
 * this one starts — two closed periods, not two rolling thirty-day stretches that overlap.
 */
import { describe, expect, it } from "vitest";
import { monthWindow, netProfitOf, trendPercent } from "../../src/lib/financeEntries";

describe("finance — the period a recorded month covers", () => {
  it("ends the current window on the month's last day and the previous one the day before it", () => {
    expect(monthWindow("2026-10-29")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      prevFrom: "2026-09-01",
      prevTo: "2026-09-30",
    });
  });

  it("crosses a year boundary without borrowing a day", () => {
    expect(monthWindow("2026-01-15")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      prevFrom: "2025-12-01",
      prevTo: "2025-12-31",
    });
  });

  it("gets February right in a leap year", () => {
    expect(monthWindow("2028-02-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
      prevFrom: "2028-01-01",
      prevTo: "2028-01-31",
    });
  });
});

describe("finance — net profit", () => {
  it("subtracts recorded expenses from the sales profit", () => {
    expect(netProfitOf(1_250_000, 790_000, 125_500)).toBe(334_500);
  });

  it("keeps a loss as a loss", () => {
    expect(netProfitOf(50_000, 60_000, 5_000)).toBe(-15_000);
  });

  it("is unknown when any term is unknown, never zero", () => {
    expect(netProfitOf(null, 790_000, 1)).toBeNull();
    expect(netProfitOf(1_000, null, 1)).toBeNull();
    expect(netProfitOf(1_000, 500, null)).toBeNull();
  });
});

describe("finance — the trend against the previous period", () => {
  it("reports the change in whole tenths of a percent", () => {
    expect(trendPercent(334_500, 297_500)).toBe(12.4);
    expect(trendPercent(90, 100)).toBe(-10);
  });

  it("prints nothing when there is no baseline to compare against", () => {
    expect(trendPercent(120, 0)).toBeNull();
    expect(trendPercent(120, null)).toBeNull();
    expect(trendPercent(null, 120)).toBeNull();
  });
});
