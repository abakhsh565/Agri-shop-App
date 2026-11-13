/**
 * What an audit row is called, and whether it belongs in a business activity history.
 *
 * The labels live here so the branch-wide Activity Log and the per-employee history cannot name
 * the same action two different ways. The map is deliberately the SAME one the Activity Log has
 * always used; nothing about what is recorded changed.
 *
 * `BUSINESS_ACTIONS` is the smaller set the employee history shows: actions with a consequence
 * for the shop's money, stock, people or access. A view change (`branch_selected`) is not one —
 * it records where the owner was looking, not what they did — and profile/contact edits are not
 * in the map at all, so they never reach a screen that claims to show business activity. That is
 * the owner's rule (2026-10-29): minor changes stay out of the audit the owner reads.
 */
export const AUDIT_ACTION_KEYS: Record<string, string> = {
  sale_created: "audit.saleCreated",
  sale_voided: "audit.saleVoided",
  return_processed: "audit.returnProcessed",
  purchase_recorded: "audit.purchaseRecorded",
  customer_payment_recorded: "audit.paymentRecorded",
  supplier_payment_recorded: "audit.paymentRecorded",
  customer_payments_insert: "audit.paymentRecorded",
  supplier_payments_insert: "audit.paymentRecorded",
  stock_adjusted: "audit.stockAdjusted",
  stock_adjustments_insert: "audit.stockAdjusted",
  employee_branch_add: "audit.employeeAdded",
  employee_branch_move: "audit.employeeMoved",
  employee_access_updated: "audit.accessUpdated",
  employee_created: "audit.employeeCreated",
  branch_created: "audit.branchCreated",
  branch_renamed: "audit.branchRenamed",
  branch_archived: "audit.branchArchived",
  membership_access_changed: "audit.accessUpdated",
  role_created: "audit.roleUpdated",
  role_updated: "audit.roleUpdated",
  role_deleted: "audit.roleUpdated",
  location_updated: "audit.locationUpdated",
  // Recorded by the log, but not a business action: switching which branch you are looking at
  // changes nothing in the shop. It stays in the label map for the full Activity Log and is
  // excluded from the employee history below.
  branch_selected: "audit.branchSelected",
};

/** Actions with a business consequence — the only ones an employee history lists. */
const BUSINESS_ACTIONS = new Set(
  Object.keys(AUDIT_ACTION_KEYS).filter((action) => action !== "branch_selected"),
);

/**
 * The dictionary key for an action in a business history, or null when the action has no
 * business consequence (or is not a known action at all, which is exactly the "minor change"
 * case the owner asked to keep out).
 */
export function businessActionLabelKey(action: string): string | null {
  if (!BUSINESS_ACTIONS.has(action)) return null;
  return AUDIT_ACTION_KEYS[action] ?? null;
}
