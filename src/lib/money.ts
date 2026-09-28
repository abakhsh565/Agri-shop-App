import { supabase } from "@/lib/supabase";

/**
 * Money that came in — one definition, in one place.
 *
 * Two screens were reporting "money in" with the same kind of name and different arithmetic,
 * and neither said which question it was answering:
 *
 *   Home      "Credit collect"   Σ `customer_payments.amount`   — udhaar coming back
 *   Reports   "Cash collected"   Σ `sales.amount_paid`          — cash taken at the counter
 *
 * Both read as *the money that came in this period*, and they never overlap, because those are
 * two different events: cash handed over when goods go out, and an old debt being paid off.
 * An owner reading "Cash collected Rs. 4,000" on one screen and "Credit collect Rs. 0" on the
 * other had no way to tell they were both right.
 *
 * So the arithmetic lives here, once, and each figure is named for the question it answers:
 *
 *   `counter`   — taken at the counter when the sale was made (`sales.amount_paid`)
 *   `udhaar`    — an earlier bill being settled (`customer_payments.amount`)
 *   `total`     — the two together: the money that actually came in
 *   `creditGiven` — the unpaid remainder of this period's sales. **Not money in**; it is the
 *                   opposite, and it is here only because Reports already shows it beside the
 *                   others and must not re-derive it.
 *
 * Two boundaries, deliberately:
 *
 *   • **A payment is not a sale, and a sale is not a payment.** `create_sale` never writes
 *     `customer_payments` (verified against the live function), so the two terms can be added
 *     without double-counting — the pre-paid part of a credit sale is `counter`, and only a
 *     later *Record Payment* is `udhaar`.
 *   • **Refunds are not netted off.** Money paid back out on a return is a separate figure on
 *     its own screen; subtracting it here would make "money in" mean "money in, net of
 *     refunds", which is a third question again. If a net figure is ever wanted it needs its
 *     own name.
 */

/** A payment recorded against an old bill. The only date a payment has is when it was entered. */
export interface CreditPaymentRow {
  amount: number;
  createdAt: string;
}

/** The fields of a sale this module reads. Anything more would tie it to the whole Sale shape. */
export interface SaleMoneyRow {
  amountPaid: number;
  outstandingBalance: number;
  createdAt: string;
  /** A voided sale took no money. Excluded here so no caller has to remember to. */
  isVoided?: boolean;
}

export interface MoneyIn {
  /** Cash taken at the counter, when the goods went out. */
  counter: number;
  /** An earlier bill settled — Record Payment. */
  udhaar: number;
  /** Everything that came into the till in the period: `counter + udhaar`. */
  total: number;
  /** This period's sales left unpaid. The opposite of money in. */
  creditGiven: number;
}

export const EMPTY_MONEY_IN: MoneyIn = { counter: 0, udhaar: 0, total: 0, creditGiven: 0 };

/**
 * One period of money in.
 *
 * `inPeriod` decides which rows belong to the period and defaults to everything, so a caller
 * that has already filtered its arrays needs to pass nothing. Voided sales are dropped here
 * regardless, because a sale that was voided never handed over any money.
 */
export function summariseMoneyIn(input: {
  sales: readonly SaleMoneyRow[];
  payments: readonly CreditPaymentRow[];
  inPeriod?: (iso: string) => boolean;
}): MoneyIn {
  const inPeriod = input.inPeriod ?? (() => true);

  let counter = 0;
  let udhaar = 0;
  let creditGiven = 0;

  for (const s of input.sales) {
    if (s.isVoided) continue;
    if (!inPeriod(s.createdAt)) continue;
    counter += Number(s.amountPaid) || 0;
    creditGiven += Number(s.outstandingBalance) || 0;
  }

  for (const p of input.payments) {
    if (!inPeriod(p.createdAt)) continue;
    udhaar += Number(p.amount) || 0;
  }

  return { counter, udhaar, total: counter + udhaar, creditGiven };
}

/**
 * Every udhaar payment this shop has recorded.
 *
 * One query for both screens, so Home and Reports cannot read the same table two ways. It is
 * scoped to the shop by RLS on `customer_payments` (0151, through the customer), not by a
 * filter here — a filter would be a second, weaker copy of that rule.
 */
export async function loadCreditPayments(): Promise<CreditPaymentRow[]> {
  const { data, error } = await supabase
    .from("customer_payments")
    .select("amount, created_at");
  if (error || !data) return [];
  return data.map((p: { amount: unknown; created_at: unknown }) => ({
    amount: Number(p.amount || 0),
    createdAt: (p.created_at as string) || "",
  }));
}
