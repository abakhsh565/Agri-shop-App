/**
 * Money off, in one place.
 *
 * A cashier can type a discount two ways — a percentage or a number of rupees — and at two
 * scopes: one line, or the whole bill. All four combinations have to produce the same rupee
 * amount, because that is the only thing the database stores (migration 0322: the client sends
 * amounts, never percentages). Keeping the arithmetic here means the review screen and its
 * guard test cannot disagree about what 10% of 8,000 is.
 */

export type DiscountMode = "percent" | "amount";

/** Rupees and paisa: the app never stores a fraction of a paisa. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A discount is never negative and never larger than the thing it is taken off. A shop may give
 * away the whole bill; it cannot owe the customer money through a discount field.
 */
export function clampToBase(base: number, amount: number): number {
  if (!Number.isFinite(base) || !Number.isFinite(amount) || base <= 0) return 0;
  return roundMoney(Math.max(0, Math.min(base, amount)));
}

/** What a typed percent or rupee amount actually comes off `base`. */
export function discountFor(base: number, mode: DiscountMode, typed: number): number {
  if (!Number.isFinite(typed) || typed <= 0) return 0;
  return clampToBase(base, mode === "percent" ? roundMoney((base * typed) / 100) : typed);
}

/**
 * The percent an existing rupee discount represents — used when the sheet reopens on a sale
 * that already carries one, so the cashier sees what is applied instead of an empty field that
 * would silently clear it.
 */
export function percentOf(base: number, amount: number): number {
  if (!(base > 0) || !Number.isFinite(amount) || amount <= 0) return 0;
  return roundMoney((amount / base) * 100);
}
