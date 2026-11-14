/**
 * supplierPayable — the judgements the payables screens and the purchases hub share.
 *
 * These are the figures the owner reads on two screens (Supplier payments and the Purchases &
 * Suppliers hub), so the tests pin the two things that can silently disagree:
 *
 *   - the overdue test, which must treat "owes nothing" and "no date" as not overdue rather than
 *     inventing a date;
 *   - the month boundary, which is a PK calendar month. A purchase made at 20:00 UTC on the last
 *     day of the month is 01:00 on the first of the NEXT month in Pakistan — summing by UTC date
 *     would put it in the wrong month's total.
 */

import { describe, expect, it } from "vitest";
import type { Company } from "@/types";
import {
  daysUntilDue,
  isSupplierOverdue,
  purchasesInMonth,
  summariseSupplierPayable,
  supplierPaymentsInMonth,
} from "@/lib/supplierPayable";

const company = (over: Partial<Company>): Company => ({
  id: "c1",
  name: "Supplier",
  outstandingPayable: 0,
  totalPurchases: 0,
  dueDate: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("daysUntilDue", () => {
  it("counts whole days from today to the due day, both directions", () => {
    expect(daysUntilDue("2026-10-30T10:00:00.000Z", "2026-10-28")).toBe(2);
    expect(daysUntilDue("2026-10-28T10:00:00.000Z", "2026-10-28")).toBe(0);
    expect(daysUntilDue("2026-10-27T10:00:00.000Z", "2026-10-28")).toBe(-1);
  });
});

describe("isSupplierOverdue", () => {
  it("is true only for a balance whose date has passed", () => {
    expect(isSupplierOverdue(company({ outstandingPayable: 500, dueDate: "2026-10-01T00:00:00.000Z" }), "2026-10-28")).toBe(true);
  });

  it("is false on the due day itself — the money is not late yet", () => {
    expect(isSupplierOverdue(company({ outstandingPayable: 500, dueDate: "2026-10-28T00:00:00.000Z" }), "2026-10-28")).toBe(false);
  });

  it("is false for a settled supplier, whatever date their last bill carried", () => {
    expect(isSupplierOverdue(company({ outstandingPayable: 0, dueDate: "2026-01-01T00:00:00.000Z" }), "2026-10-28")).toBe(false);
  });

  it("is false for a balance with no date — the app does not invent one", () => {
    expect(isSupplierOverdue(company({ outstandingPayable: 500, dueDate: null }), "2026-10-28")).toBe(false);
  });
});

describe("summariseSupplierPayable", () => {
  it("sums the branch's payables and splits them by the same overdue test", () => {
    const book = summariseSupplierPayable(
      [
        company({ id: "a", outstandingPayable: 1_000, dueDate: "2026-10-30T00:00:00.000Z" }),
        company({ id: "b", outstandingPayable: 400, dueDate: "2026-10-01T00:00:00.000Z" }),
        company({ id: "c", outstandingPayable: 0, dueDate: null }),
      ],
      "2026-10-28",
    );
    expect(book).toEqual({ outstanding: 1_400, accounts: 3, pending: 1, overdue: 1 });
  });

  it("counts every supplier account, including one that owes nothing", () => {
    const book = summariseSupplierPayable([company({ id: "a" }), company({ id: "b" })], "2026-10-28");
    expect(book.accounts).toBe(2);
    expect(book.outstanding).toBe(0);
  });
});

describe("purchasesInMonth", () => {
  it("sums the bills of the PK month and ignores the rest", () => {
    const total = purchasesInMonth(
      [
        { totalAmount: 100, createdAt: "2026-10-12T17:50:58.000Z" },
        { totalAmount: 250, createdAt: "2026-09-30T10:00:00.000Z" },
        { totalAmount: 50, createdAt: "2026-10-01T00:00:00.000Z" },
      ],
      "2026-10",
    );
    expect(total).toBe(150);
  });

  it("uses the Pakistan day, not UTC — 20:00 UTC on 31 Oct is 1 Nov in Pakistan", () => {
    const rows = [
      { totalAmount: 700, createdAt: "2026-10-31T20:00:00.000Z" },
      { totalAmount: 300, createdAt: "2026-10-31T10:00:00.000Z" },
    ];
    expect(purchasesInMonth(rows, "2026-10")).toBe(300);
    expect(purchasesInMonth(rows, "2026-11")).toBe(700);
  });

  it("never lets a negative bill lower the month's spend", () => {
    expect(
      purchasesInMonth(
        [
          { totalAmount: 100, createdAt: "2026-10-02T00:00:00.000Z" },
          { totalAmount: -40, createdAt: "2026-10-03T00:00:00.000Z" },
        ],
        "2026-10",
      ),
    ).toBe(100);
  });
});

describe("supplierPaymentsInMonth", () => {
  it("sums what was handed to suppliers in the PK month", () => {
    expect(
      supplierPaymentsInMonth(
        [
          { amount: 60_000, createdAt: "2026-10-05T08:00:00.000Z" },
          { amount: 1_000, createdAt: "2026-08-05T08:00:00.000Z" },
          { amount: 40_000, createdAt: "2026-10-20T08:00:00.000Z" },
        ],
        "2026-10",
      ),
    ).toBe(100_000);
  });
});
