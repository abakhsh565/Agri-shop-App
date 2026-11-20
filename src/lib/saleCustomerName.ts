import type { Sale } from "@/types";

/**
 * The name to show for a sale's customer: the one on the record now, not the one the bill was
 * written with.
 *
 * WHY THIS EXISTS. `sales.customer_name_snapshot` is a snapshot — it is written once, when the
 * bill is made, and never updated. That is the right thing for the database to keep (a deleted
 * customer, a walk-in, an offline bill all need the name that was on the paper), but the wrong
 * thing for the screen to draw: a shop that corrects a customer's name went on seeing the old one
 * on every bill in the list, next to the corrected name on the customer itself (owner,
 * 2026-11-20).
 *
 * The rule: a sale that belongs to a customer shows that customer's current name; anything else —
 * a walk-in with no id, a customer since deleted — keeps the snapshot, because there is nothing
 * more current to show. The map is built once per render from the customers the screen already
 * holds, so this costs one pass, not one lookup per row.
 */
export function customerNamesById(
  customers: readonly { id: string; name: string }[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const customer of customers) {
    const name = customer.name?.trim();
    if (customer.id && name) names.set(customer.id, name);
  }
  return names;
}

/** The live name for one sale, falling back to the name the bill recorded. */
export function saleCustomerName(
  sale: Pick<Sale, "customerId" | "customerName">,
  namesById: ReadonlyMap<string, string>,
): string {
  const live = sale.customerId ? namesById.get(sale.customerId) : undefined;
  return live || sale.customerName;
}
