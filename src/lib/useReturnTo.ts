import { useLocation } from "react-router-dom";

/**
 * Where this screen's leading control should go.
 *
 * A screen has one natural parent — Sales belongs to Settings, a customer's file belongs to the
 * customer list — and that is the right destination when the screen is opened from the menu.
 * It is the wrong one when the screen is opened from another screen that is itself part of the
 * journey: the Reports hub opens Sales, Profit, Customers, Suppliers, Inventory and Activity, and
 * sending the reader back to Settings loses the report they were reading.
 *
 * The caller that knows better passes its own path as router state:
 *
 *   navigate(to, { state: { from: "/admin/settings/hub/reports" } })
 *
 * This prefers that path and falls back to the screen's own parent. Nothing is stored, so a
 * deep link or a cold start behaves exactly as it did before; and only same-origin paths are
 * accepted, so the value cannot become an off-site redirect.
 */
export function useReturnTo(fallback?: string): string | undefined {
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/") ? from : fallback;
}
