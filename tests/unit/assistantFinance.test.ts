import { describe, expect, it } from "vitest";
import { financeDraftFromText, financeRecordPath } from "@/lib/assistantFinance";

describe("assistant finance intent", () => {
  it("reads an explicit cash rent expense", () => {
    expect(financeDraftFromText("Paid 5,000 cash to Malik for rent")).toMatchObject({
      kind: "expense",
      amount: 5000,
      category: "rent",
      method: "cash",
      party: "Malik",
    });
  });

  it("reads income and its method", () => {
    expect(financeDraftFromText("Received 10,000 by bank")).toMatchObject({
      kind: "income",
      amount: 10000,
      category: "other_income",
      method: "bank",
    });
  });

  it("reads an Urdu expense sentence", () => {
    expect(financeDraftFromText("کرایہ 5,000 ادا کیا")).toMatchObject({
      kind: "expense",
      amount: 5000,
      category: "rent",
    });
  });

  it("refuses a sale, which belongs to the stock flow", () => {
    expect(financeDraftFromText("Sold 5,000 rice to Ali")).toBeNull();
  });

  it("refuses a question about spending", () => {
    expect(financeDraftFromText("How much did I spend 5,000 on?")).toBeNull();
  });

  it("allows an explicit add instruction even when phrased as a question", () => {
    expect(financeDraftFromText("Can you add an expense of 1,200 for fuel?")).toMatchObject({
      kind: "expense",
      amount: 1200,
      category: "transport",
    });
  });

  it("does not prepare an entry without an amount", () => {
    expect(financeDraftFromText("Add an expense for rent")).toBeNull();
  });

  it("encodes the existing ledger form address", () => {
    const draft = financeDraftFromText("Paid 5,000 rent");
    expect(draft).not.toBeNull();
    const url = new URL(financeRecordPath("/admin", draft!), "http://localhost");
    expect(url.pathname).toBe("/admin/settings/hub/finance/record");
    expect(url.searchParams.get("kind")).toBe("expense");
    expect(url.searchParams.get("sentence")).toBe("Paid 5,000 rent");
  });
});
