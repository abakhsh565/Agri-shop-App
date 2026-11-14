import type { Company, Purchase } from "@/types";
import { pkDateFromISO } from "@/lib/pkDate";

/**
 * Supplier payables, judged once.
 *
 * Three screens now state something about what the branch owes: the Supplier payments screen,
 * the collection screen behind the overview's payable card, and the Purchases & Suppliers hub.
 * "Overdue", "still inside its date" and "what is outstanding" are the judgements they all
 * make, so they are made here rather than by a second date comparison that would let one screen
 * call a supplier late while another calls them current.
 *
 * Nothing here reads the network. The companies are the working branch's rows, with the payable
 * the database derives for this branch (`get_branch_company_balances`, 0242), and the purchases
 * and payments are the rows the shell and the screens already hold.
 */

/**
 * Days from today (PK) to a timestamp's PK day: positive means still to come, negative means
 * the date has passed.
 */
export function daysUntilDue(dueDate: string, todayISO: string): number {
  return Math.round((Date.parse(pkDateFromISO(dueDate)) - Date.parse(todayISO)) / 86_400_000);
}

/**
 * Does this supplier hold a balance whose date has already passed?
 *
 * A supplier who owes nothing is never overdue, whatever date their last bill carried; a
 * balance with no date cannot be called late without inventing the date.
 */
export function isSupplierOverdue(
  supplier: Pick<Company, "outstandingPayable" | "dueDate">,
  todayISO: string,
): boolean {
  return (
    supplier.outstandingPayable > 0 &&
    supplier.dueDate != null &&
    daysUntilDue(supplier.dueDate, todayISO) < 0
  );
}

export interface SupplierPayableBook {
  /** Everything the branch still owes its suppliers. */
  outstanding: number;
  /** Supplier accounts on the books — archived suppliers are not loaded. */
  accounts: number;
  /** Balances still inside their date. */
  pending: number;
  /** Balances past their date. */
  overdue: number;
}

export function summariseSupplierPayable(
  companies: Company[],
  todayISO: string,
): SupplierPayableBook {
  return {
    outstanding: companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0),
    accounts: companies.length,
    pending: companies.filter(
      (c) => c.outstandingPayable > 0 && !isSupplierOverdue(c, todayISO),
    ).length,
    overdue: companies.filter((c) => isSupplierOverdue(c, todayISO)).length,
  };
}

/**
 * What one purchase cost, as the month figure reads it: the bill, not the residual. A delivery's
 * `outstandingPayable` is its own unpaid remainder at the moment it was recorded, and nothing
 * allocates a later supplier payment to it — so only `totalAmount` answers "what did we buy".
 */
export function purchasesInMonth(
  purchases: Pick<Purchase, "totalAmount" | "createdAt">[],
  month: string,
): number {
  return purchases
    .filter((p) => pkDateFromISO(p.createdAt).startsWith(month))
    .reduce((sum, p) => sum + Math.max(0, p.totalAmount), 0);
}

/** What was handed to suppliers in one PK calendar month ("YYYY-MM"). */
export function supplierPaymentsInMonth(
  payments: { amount: number; createdAt: string }[],
  month: string,
): number {
  return payments
    .filter((p) => pkDateFromISO(p.createdAt).startsWith(month))
    .reduce((sum, p) => sum + Math.max(0, p.amount), 0);
}
