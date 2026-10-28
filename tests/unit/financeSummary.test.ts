import { describe, expect, it } from "vitest";
import { cashTakenInMonth, movementsInMonth, recentMovements } from "../../src/lib/financeSummary";
import type { LedgerPayment } from "../../src/lib/paymentLedger";

/**
 * The Finance hub's cash figure, pinned down.
 *
 * The trap this covers is the month boundary: `createdAt` is a UTC timestamp and the shop
 * lives in Asia/Karachi (UTC+5), so a sale recorded at 20:00 UTC on the last day of a month is
 * already the first of the next one in Karachi. A string-prefix filter would file it under the
 * wrong month for five hours of every day, and the figure would be quietly wrong rather than
 * obviously broken.
 */
function sale(createdAt: string, amountPaid: number, isVoided = false) {
  return { createdAt, amountPaid, isVoided };
}

describe("cash taken in a PK month", () => {
  it("counts the month's sales and nothing else", () => {
    const sales = [
      sale("2026-10-02T10:00:00Z", 5_000),
      sale("2026-10-19T06:30:00Z", 2_500),
      sale("2026-09-30T10:00:00Z", 9_999),
    ];
    expect(cashTakenInMonth(sales, "2026-10")).toBe(7_500);
  });

  it("puts a late-night sale in the month Karachi is in, not the UTC one", () => {
    // 31 Oct 20:00 UTC is 1 Nov 01:00 in Karachi.
    expect(cashTakenInMonth([sale("2026-10-31T20:00:00Z", 1_000)], "2026-10")).toBe(0);
    expect(cashTakenInMonth([sale("2026-10-31T20:00:00Z", 1_000)], "2026-11")).toBe(1_000);

    // 31 Oct 18:00 UTC is still 31 Oct 23:00 in Karachi.
    expect(cashTakenInMonth([sale("2026-10-31T18:00:00Z", 1_000)], "2026-10")).toBe(1_000);
  });

  it("leaves voided sales out — their money never stayed", () => {
    const sales = [sale("2026-10-03T09:00:00Z", 4_000), sale("2026-10-03T09:05:00Z", 4_000, true)];
    expect(cashTakenInMonth(sales, "2026-10")).toBe(4_000);
  });

  it("is zero for an empty month, not undefined", () => {
    expect(cashTakenInMonth([], "2026-10")).toBe(0);
    expect(cashTakenInMonth([sale("2026-09-01T09:00:00Z", 500)], "2026-10")).toBe(0);
  });
});

describe("money in and out of a month", () => {
  const movement = (createdAt: string, direction: "in" | "out", amount: number): LedgerPayment => ({
    id: `${direction}-${createdAt}-${amount}`,
    direction,
    counterparty: "Ali Traders",
    amount,
    method: "cash",
    note: null,
    createdAt,
  });

  it("adds each direction on its own and never nets them", () => {
    const entries = [
      movement("2026-10-02T09:00:00Z", "in", 12_000),
      movement("2026-10-03T09:00:00Z", "out", 8_000),
      movement("2026-10-04T09:00:00Z", "in", 500),
    ];
    expect(movementsInMonth(entries, "2026-10")).toEqual({ received: 12_500, paid: 8_000 });
  });

  it("uses the Karachi month, like the cash figure beside it", () => {
    const late = [movement("2026-10-31T20:00:00Z", "in", 1_000)];
    expect(movementsInMonth(late, "2026-10")).toEqual({ received: 0, paid: 0 });
    expect(movementsInMonth(late, "2026-11")).toEqual({ received: 1_000, paid: 0 });
  });

  it("is two zeros for an empty month", () => {
    expect(movementsInMonth([], "2026-10")).toEqual({ received: 0, paid: 0 });
  });
});

describe("recent movements", () => {
  const entry = (id: string): LedgerPayment => ({
    id,
    direction: "in",
    counterparty: "Ali Traders",
    amount: 1_000,
    method: "cash",
    note: null,
    createdAt: "2026-10-29T09:00:00Z",
  });

  it("keeps the ledger's own order and takes only what the screen draws", () => {
    const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
    expect(recentMovements(entries).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(recentMovements(entries, 2).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("asks for nothing rather than slicing from the end", () => {
    expect(recentMovements([entry("a")], 0)).toEqual([]);
    expect(recentMovements([entry("a")], -3)).toEqual([]);
  });
});
