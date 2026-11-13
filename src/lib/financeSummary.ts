import type { Sale } from "@/types";
import type { LedgerPayment } from "@/lib/paymentLedger";
import { pkDateFromISO } from "@/lib/pkDate";

/**
 * The money figures the Finance section states, computed once.
 *
 * WHY THIS FILE EXISTS. Two screens now put a number under the words "recorded cash": the
 * branch overview already reads "cash and recorded payments — taken in this period" from the
 * sales it holds, and the Finance hub reads the same question for one PK month. If each screen
 * wrote its own filter, "this month's cash" could mean one thing on one screen and something
 * else on the next — the exact drift `supplierPayable` and `customerCredit` exist to stop.
 *
 * WHAT "CASH RECORDED" MEANS HERE. It is money the shop actually took on its own sales in the
 * month (`amountPaid`), which is the figure the branch overview calls cash taken. It is NOT a
 * till or bank balance: the app does not record opening balances, so a "position" it printed
 * would be invented. The screens say "collected on this month's sales" under the number so it
 * cannot be read as an account balance.
 *
 * A MONTH IS A PAKISTAN CALENDAR MONTH, and the boundary is why this is a function rather than
 * an inline filter: a sale recorded at 20:00 UTC on 31 October is 1 November in Karachi, and a
 * `createdAt.startsWith(month)` test would file it under the wrong month for five hours a day.
 */

/** What the counter took on one PK calendar month's sales (`month` is "YYYY-MM"). */
export function cashTakenInMonth(
  sales: Pick<Sale, "amountPaid" | "isVoided" | "createdAt">[],
  month: string,
): number {
  return sales
    .filter((sale) => !sale.isVoided && pkDateFromISO(sale.createdAt).startsWith(month))
    .reduce((sum, sale) => sum + Math.max(0, sale.amountPaid), 0);
}

/** The newest recorded payments, in the order the ledger already returns them. */
export function recentMovements(entries: LedgerPayment[], count = 3): LedgerPayment[] {
  return entries.slice(0, Math.max(0, count));
}

/**
 * The two directions of the payments ledger over one PK calendar month.
 *
 * Read together with `cashTakenInMonth` these are the two halves of the cash story: what the
 * counter took on sales, and what moved against credit in each direction. They are kept apart
 * rather than netted, because "we took 84,500 at the counter" and "we received 12,000 against
 * old bills" answer different questions even when they add to the same bank account.
 */
export function movementsInMonth(
  entries: LedgerPayment[],
  month: string,
): { received: number; paid: number } {
  return entries.reduce(
    (totals, entry) => {
      if (!pkDateFromISO(entry.createdAt).startsWith(month)) return totals;
      if (entry.direction === "in") totals.received += Math.max(0, entry.amount);
      else totals.paid += Math.max(0, entry.amount);
      return totals;
    },
    { received: 0, paid: 0 },
  );
}
