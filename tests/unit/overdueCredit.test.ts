import { describe, it, expect } from "vitest";
import { computeOverdueCreditTotal, computeLiveSignals, isCreditOverdue } from "@/lib/signalEngine";
import { pkDate } from "@/lib/pkDate";
import type { Customer } from "@/types";

/**
 * Home's "Overdue Amount" must be the system-wide business metric:
 * the remaining unpaid balance of every credit whose due date has passed.
 *
 * It is NOT total customer outstanding, and it is NOT one customer's amount.
 */

const TODAY = new Date("2026-06-15T09:00:00+05:00");
const TODAY_PK = pkDate(TODAY);
const PAST = "2026-06-01";
const FUTURE = "2026-07-01";

/** Minimal Customer shape — only the fields the authoritative test reads. */
function customer(over: Partial<Customer> & { name: string }): Customer {
  return {
    id: `c-${over.name}`,
    phone: "03000000000",
    outstandingBalance: 0,
    dueDate: null,
    isArchived: false,
    creditLimit: 0,
    ...over,
  } as unknown as Customer;
}

describe("computeOverdueCreditTotal — authoritative system-wide overdue amount", () => {
  it("matches the spec example: only remaining, past-due balances are summed", () => {
    const customers = [
      // Credit 10,000, paid 4,000, remaining 6,000, due date passed → include 6,000
      customer({ name: "A", outstandingBalance: 6000, dueDate: PAST }),
      // Credit 5,000, paid 2,000, remaining 3,000, due date passed → include 3,000
      customer({ name: "B", outstandingBalance: 3000, dueDate: PAST }),
      // Credit 8,000, paid 5,000, remaining 3,000, NOT yet due → exclude
      customer({ name: "C", outstandingBalance: 3000, dueDate: FUTURE }),
    ];
    expect(computeOverdueCreditTotal(customers, TODAY)).toBe(9000);
  });

  it("fully paid overdue credit contributes 0", () => {
    expect(
      computeOverdueCreditTotal([customer({ name: "paid", outstandingBalance: 0, dueDate: PAST })], TODAY),
    ).toBe(0);
  });

  it("partially paid overdue credit contributes only the remaining amount", () => {
    expect(
      computeOverdueCreditTotal([customer({ name: "part", outstandingBalance: 6000, dueDate: PAST })], TODAY),
    ).toBe(6000);
  });

  it("unpaid overdue credit contributes the full outstanding amount", () => {
    expect(
      computeOverdueCreditTotal([customer({ name: "unpaid", outstandingBalance: 10000, dueDate: PAST })], TODAY),
    ).toBe(10000);
  });

  it("outstanding but not yet due is excluded", () => {
    expect(
      computeOverdueCreditTotal([customer({ name: "future", outstandingBalance: 5000, dueDate: FUTURE })], TODAY),
    ).toBe(0);
  });

  it("due today is not yet overdue (Due Date < Today)", () => {
    const today = customer({ name: "today", outstandingBalance: 5000, dueDate: TODAY_PK });
    expect(isCreditOverdue(today, TODAY_PK)).toBe(false);
    expect(computeOverdueCreditTotal([today], TODAY)).toBe(0);
  });

  it("aggregates multiple overdue customers", () => {
    const customers = [
      customer({ name: "x", outstandingBalance: 1500, dueDate: PAST }),
      customer({ name: "y", outstandingBalance: 2500, dueDate: "2026-05-20" }),
      customer({ name: "z", outstandingBalance: 1000, dueDate: "2025-12-31" }),
    ];
    expect(computeOverdueCreditTotal(customers, TODAY)).toBe(5000);
  });

  it("a payment made after becoming overdue decreases the overdue amount", () => {
    const before = customer({ name: "pays", outstandingBalance: 6000, dueDate: PAST });
    const afterPayment = { ...before, outstandingBalance: 2000 } as Customer;
    expect(computeOverdueCreditTotal([before], TODAY)).toBe(6000);
    expect(computeOverdueCreditTotal([afterPayment], TODAY)).toBe(2000);
  });

  it("credit with no due date is never overdue", () => {
    expect(
      computeOverdueCreditTotal([customer({ name: "nodue", outstandingBalance: 9000, dueDate: null })], TODAY),
    ).toBe(0);
  });

  it("archived customers are excluded", () => {
    expect(
      computeOverdueCreditTotal(
        [customer({ name: "arch", outstandingBalance: 4000, dueDate: PAST, isArchived: true })],
        TODAY,
      ),
    ).toBe(0);
  });

  it("no overdue balances → 0", () => {
    const customers = [
      customer({ name: "ok", outstandingBalance: 0, dueDate: PAST }),
      customer({ name: "later", outstandingBalance: 7000, dueDate: FUTURE }),
    ];
    expect(computeOverdueCreditTotal(customers, TODAY)).toBe(0);
  });

  it("is the same calculation behind the S1 overdue-credit signals (cannot drift)", () => {
    const customers = [
      customer({ name: "A", outstandingBalance: 10000, dueDate: PAST }),
      customer({ name: "B", outstandingBalance: 2500.5, dueDate: "2026-05-01" }),
      customer({ name: "C", outstandingBalance: 3000, dueDate: FUTURE }),
      customer({ name: "D", outstandingBalance: 0, dueDate: PAST }),
    ];
    const signals = computeLiveSignals({ customers, products: [], now: TODAY }).filter(
      (s) => s.category === "overdue_credit",
    );
    const viaSignals = signals.reduce((sum, s) => sum + (s.value ?? 0), 0);
    expect(signals).toHaveLength(2);
    expect(viaSignals).toBe(computeOverdueCreditTotal(customers, TODAY));
  });
});
