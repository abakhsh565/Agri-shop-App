/**
 * Bottom-tab-bar visibility rule (CR-025).
 *
 * The tab bar belongs on the primary/top-level navigation screens only — the
 * tab destinations and the list roots reached from them (e.g. `/admin/sales`,
 * `/employee/customers`). Once the user drills into a nested/detail/form screen
 * (`/admin/sales/:id`, `/admin/inventory/new`, …) or enters the focused sale
 * flow, the tab bar is hidden so it doesn't follow them through the whole flow.
 *
 * Depth is measured by path segments after the shell prefix: a top-level screen
 * is exactly two segments (`/{shell}/{section}`); three or more means nested.
 */
export function isTopLevel(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  // The sale flow is a focused multi-step task — hide the tab bar throughout it.
  if (segments[1] === "sale") return false;
  return segments.length <= 2;
}
