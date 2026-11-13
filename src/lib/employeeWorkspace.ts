/**
 * Which workspace an employee lands in.
 *
 * The tab bar and the dashboard must answer this the same way. Before this file they each
 * had their own ordering, which classified a Purchase Officer as Finance because recording
 * a supplier payment also needs `payments.view`. The rule below is intentionally about the
 * work a role can DO, not its name or department:
 *
 *   sales > stock work > purchasing > finance > customer work > team
 *
 * `has` is the caller's permission check. It is passed in rather than imported so the same
 * function can be unit-tested without a signed-in session, and so the owner's `*` grant
 * behaves exactly like it does in the shell.
 */
export type EmployeeWorkspace =
  | "sales"
  | "products"
  | "purchases"
  | "finance"
  | "customers"
  | "team";

export function resolveEmployeeWorkspace(has: (code: string) => boolean): EmployeeWorkspace | null {
  if (has("sales.view") && has("sales.create")) return "sales";
  if (has("products.view") && (has("products.edit") || has("inventory.adjust"))) return "products";
  // A purchase officer holds payments.view only to settle a supplier bill. Purchasing is
  // still their job, so it must be chosen before Finance.
  if (has("purchases.create")) return "purchases";
  if (has("payments.view")) return "finance";
  if (has("purchases.view")) return "purchases";
  if (has("customers.view")) return "customers";
  if (has("employees.view")) return "team";
  if (has("sales.view")) return "sales";
  return null;
}
