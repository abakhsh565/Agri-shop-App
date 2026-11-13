import type { DashboardWidget } from "@/types";

/**
 * The dashboard is derived, never hand-picked (owner's rule, 2026-11-01).
 *
 * A widget's requirements live beside the widget in `dashboard_widgets`
 * (`required_permissions`, migration 0277). A member sees a block only when every one of
 * those permissions is effective for them. The role screen no longer writes
 * `role_dashboards` for employees; it shows this same computation so the preview and the
 * server agree before the role is saved.
 */
export function requiredPermissionsFor(widget: DashboardWidget): string[] {
  const required = (widget.requiredPermissions ?? []).filter(Boolean);
  if (required.length > 0) return required;
  return widget.defaultPermission ? [widget.defaultPermission] : [];
}

/** Does this member hold every permission the block requires? */
export function canSeeWidget(
  widget: DashboardWidget,
  effective: ReadonlySet<string> | Iterable<string>,
): boolean {
  const held = effective instanceof Set ? effective : new Set(effective);
  return requiredPermissionsFor(widget).every((code) => held.has(code));
}

/** The blocks the member can see, in the catalogue's own order. */
export function eligibleWidgets(
  widgets: DashboardWidget[],
  effective: ReadonlySet<string> | Iterable<string>,
): DashboardWidget[] {
  const held = effective instanceof Set ? effective : new Set(effective);
  return widgets.filter((widget) => canSeeWidget(widget, held));
}

/** The keys the role's eligibility resolves to, for the review sentence and tests. */
export function eligibleWidgetKeys(
  widgets: DashboardWidget[],
  effective: ReadonlySet<string> | Iterable<string>,
): string[] {
  return eligibleWidgets(widgets, effective).map((widget) => widget.key);
}

/**
 * Permissions whose grant deserves a deliberate sentence on the role review.
 * The list is about consequence, not about a hidden recommendation: these are the
 * switches that can void a sale, move stock, change a credit limit, employ people,
 * take money, or edit the shop's rules.
 */
export const SENSITIVE_PERMISSION_CODES = new Set([
  "sales.void",
  "customers.delete",
  "customers.credit_limit",
  "products.delete",
  "inventory.adjust",
  "purchases.create",
  "payments.supplier",
  "employees.manage",
  "settings.edit",
  "alerts.manage",
]);

export function isSensitivePermission(code: string): boolean {
  return SENSITIVE_PERMISSION_CODES.has(code);
}
