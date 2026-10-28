import type { Customer } from "@/types";
import { isCreditOverdue } from "@/lib/signalEngine";
import { pkDateFromISO } from "@/lib/pkDate";

/**
 * The customer's credit position, judged once.
 *
 * Six screens now state something about a customer's debt: the Customers & Credit hub, the
 * customers list, outstanding credit, payments, credit requests and reminders. "Overdue" and
 * "not yet due" are the two judgements they all make, so they are made here — by the S1 rule
 * the rest of the app already uses (`isCreditOverdue`), not by a second date comparison that
 * would let one screen call a customer late while another calls them current.
 *
 * Nothing here reads the network. The customers are the working branch's rows, with the money
 * the database derived for this branch (`get_branch_customer_balances`, 0242).
 */

export type CustomerCreditState = "paid" | "overdue" | "not_due" | "no_due_date";

/** Whole days past the due date, or null when nothing is owed or no date was set. */
export function daysOverdue(customer: Customer, todayISO: string): number | null {
  if (customer.outstandingBalance <= 0 || !customer.dueDate) return null;
  const days = Math.floor(
    (Date.parse(todayISO) - Date.parse(pkDateFromISO(customer.dueDate))) / 86_400_000,
  );
  return days > 0 ? days : null;
}

/**
 * Which of the four states this customer is in.
 *
 * `paid` is the absence of a balance, not the absence of a due date: a customer who owes
 * nothing is settled whatever date their old bill carried. A balance with no date is its own
 * state, because the app cannot call it late or current without inventing the date.
 */
export function customerCreditState(customer: Customer, todayISO: string): CustomerCreditState {
  if (customer.outstandingBalance <= 0) return "paid";
  if (isCreditOverdue(customer, todayISO)) return "overdue";
  return customer.dueDate ? "not_due" : "no_due_date";
}

export interface CustomerCollection {
  /** Everything the branch has billed these customers. */
  billed: number;
  /** What has come back, derived from the bill and what is still owed. */
  collected: number;
  /** What is still out. */
  due: number;
  /** Collected as a whole percentage of the bill. */
  progressPct: number;
  /** Accounts in the list, cash and credit alike. */
  accounts: number;
  /** Accounts holding a balance. */
  pending: number;
  /** Accounts past their due date — the S1 rule. */
  overdue: number;
}

/**
 * The collection summary the section is opened for.
 *
 * `collected` is the bill less the remainder, NOT a sum of the payments column: a return lowers
 * the bill without handing back money once taken, so summing payments produced "100,000
 * collected of 0 billed" after a full refund. The bill and the remainder are the two figures the
 * database derives for this branch, and everything else follows from them.
 */
export function summariseCustomerCollection(
  customers: Customer[],
  todayISO: string,
): CustomerCollection {
  const billed = customers.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
  const due = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);
  // A branch whose recorded balance exceeds its billed history still owes that balance; the
  // larger of the two keeps the summary from printing "collected more than was ever billed".
  const total = Math.max(billed, due);
  const collected = Math.max(0, total - due);

  return {
    billed: total,
    collected,
    due,
    progressPct: total > 0 ? Math.round((collected / total) * 100) : 0,
    accounts: customers.length,
    pending: customers.filter((c) => c.outstandingBalance > 0).length,
    overdue: customers.filter((c) => isCreditOverdue(c, todayISO)).length,
  };
}

/**
 * How much of a credit limit is used, as a whole percentage capped at 100.
 *
 * Null when no limit is set: a bar drawn against zero is a measurement of nothing, and the
 * screens show "cash customer" instead.
 */
export function creditUsedPct(customer: Customer): number | null {
  if (customer.creditLimit <= 0) return null;
  return Math.min(100, Math.round((customer.outstandingBalance / customer.creditLimit) * 100));
}
