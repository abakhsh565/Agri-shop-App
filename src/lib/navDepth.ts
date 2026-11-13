/**
 * Bottom-tab-bar visibility rule (CR-025, tightened 2026-11-12).
 *
 * The tab bar switches between the app's MAIN SECTIONS. That is the whole of its job, so it is
 * shown on exactly the tab destinations and nowhere else: Home, Sales, Products and More in the
 * admin shell, and the same set of section roots in the employee shell. Every other screen — a
 * section hub opened from More (`/admin/payments`, `/admin/settings`, `/admin/reports`), a
 * detail or form screen (`/admin/sales/:id`, `/admin/inventory/new`), and the focused sale flow —
 * is somewhere you arrived FROM a section and leave with the back control it already draws.
 *
 * WHY IT CHANGED. The rule used to be "two path segments after the shell", which quietly made
 * every hub screen count as a main section: the bar followed the reader into Payments, Companies,
 * Reports and Settings, offering to jump to Home from screens that were already three taps inside
 * the business. Navigation is now one rule everywhere: the bar is the section switcher, the back
 * arrow is the way out.
 *
 * An allowlist, not a depth count, because depth cannot tell a tab from a hub: both are one
 * segment deep. The tab destinations are known here, so they are stated here.
 */
const TAB_ROOTS = new Set([
  // Admin shell — the five slots (Scan is an action beside the pill, not a screen).
  "/admin/dashboard",
  "/admin/sales",
  "/admin/products",
  "/admin/more",
  // Employee shell — the tabs it can show, whatever the account's permissions allow.
  "/employee/dashboard",
  "/employee/sales",
  "/employee/products",
  "/employee/customers",
  "/employee/purchases",
  "/employee/finance",
  "/employee/team",
  "/employee/more",
]);

export function isTopLevel(pathname: string): boolean {
  // Trailing slashes are not a different screen.
  const path = pathname.replace(/\/+$/, "") || "/";
  // The sale flow is a focused multi-step task — no tab bar anywhere inside it.
  const segments = path.split("/").filter(Boolean);
  if (segments[1] === "sale") return false;
  return TAB_ROOTS.has(path);
}
