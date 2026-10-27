/**
 * What each row of the Settings menu contains.
 *
 * The menu names a part of the business — Sales, Finance, Employees & Access — and opening it
 * shows the jobs inside that part, in the order the work happens: all of them, the new one, the
 * corrections. It is the same shape at both levels: a row that names something and says where it
 * goes, never a control that does two things.
 *
 * ONE SOURCE, TWO READERS. The Settings menu and the hub screens read this file, so a section
 * cannot be listed on the menu with rows the app does not have, and a row cannot drift between
 * the two.
 *
 * DESTINATIONS ARE THE SCREENS THAT EXIST TODAY. Each row points at the screen that already does
 * that work, which is why several rows in one section share a destination while the deeper
 * screens are still being built — a row that opens the right ledger is honest; a row that opens
 * nothing is not. Re-pointing one is a single line here.
 */
export interface HubRow {
  id: string;
  /** Dictionary key for the row's label. */
  labelKey: string;
  /** Route under the shell. */
  to: string;
}

export interface HubSection {
  id: string;
  /** Dictionary key for the section's own name — the same words the menu row uses. */
  titleKey: string;
  rows: HubRow[];
}

export const HUB_SECTIONS: HubSection[] = [
  {
    id: "overview",
    titleKey: "settings.menu.overview",
    rows: [
      { id: "performance", labelKey: "hub.overview.performance", to: "/settings/overview" },
      { id: "branch-comparison", labelKey: "hub.overview.branchComparison", to: "/settings/profile" },
      { id: "financial", labelKey: "hub.overview.financial", to: "/payments" },
      { id: "inventory-health", labelKey: "hub.overview.inventoryHealth", to: "/products" },
      { id: "alerts", labelKey: "hub.overview.alerts", to: "/alerts/reminders" },
    ],
  },
  {
    id: "branches",
    titleKey: "settings.menu.branches",
    rows: [
      // The list itself, as cards: every branch this account may work in, with its own sales
      // figure and the three ways into it. This row used to open the account screen, where the
      // branches were rows at the foot of the page.
      { id: "all", labelKey: "hub.branches.all", to: "/settings/branches" },
      // The Business Overview design as it stood before the redesign — its own screen now, so the
      // two can change independently (owner's instruction, 2026-10-28).
      { id: "details", labelKey: "hub.branches.details", to: "/settings/branch-details" },
      // Reports, not the Business Overview screen. "Branch performance" sent the reader to the
      // business-wide overview, which is the one screen this row is not: the figures a branch is
      // judged by — its sales, profit and stock by period — are gathered in Reports, where the
      // branch reporting and comparison live (owner's correction, 2026-10-28).
      { id: "performance", labelKey: "hub.branches.performance", to: "/reports" },
      { id: "reports", labelKey: "hub.branches.reports", to: "/reports" },
    ],
  },
  {
    id: "sales",
    titleKey: "settings.menu.sales",
    rows: [
      // This section's screen is `pages/admin/sales/AdminSalesSectionPage`, not the generic hub:
      // Sales carries a quick action, today's figures and a search of its own, and Returns and
      // Voided sales open as popups over the ledger rather than as two more screens (owner's
      // instruction, 2026-10-28). The rows below are still the section's catalogue — its screen
      // reads these labels and the New sale destination from here — and `to` is the ledger each
      // job is about, which is where a row would land if the generic hub ever rendered them.
      { id: "all", labelKey: "hub.sales.all", to: "/sales" },
      { id: "new", labelKey: "hub.sales.new", to: "/sale" },
      { id: "returns", labelKey: "hub.sales.returns", to: "/sales" },
      { id: "voided", labelKey: "hub.sales.voided", to: "/sales" },
    ],
  },
  {
    id: "inventory",
    titleKey: "settings.menu.inventory",
    rows: [
      // Like Sales, this section's screen is its own (`pages/admin/inventory/AdminInventorySectionPage`):
      // it carries a quick action, four counts and a search, and it reads these rows for its
      // labels. Each destination is now the screen that does that job:
      //   - Stock management is its own screen (`/inventory/stock`): what the branch holds and
      //     what it is worth. It used to send the reader to Reorder suggestions, which answers
      //     the next question (what to buy) and keeps its own screen, still reachable from More.
      //   - Expiring products is its own screen (`/alerts/expiry`). It and Low stock both opened
      //     the same alerts screen, so one of the two rows always opened the wrong list.
      { id: "products", labelKey: "hub.inventory.products", to: "/products" },
      { id: "variants", labelKey: "hub.inventory.variants", to: "/products" },
      { id: "stock", labelKey: "hub.inventory.stock", to: "/inventory/stock" },
      { id: "movements", labelKey: "hub.inventory.movements", to: "/inventory/movements" },
      { id: "low-stock", labelKey: "hub.inventory.lowStock", to: "/alerts/inventory" },
      { id: "expiring", labelKey: "hub.inventory.expiring", to: "/alerts/expiry" },
    ],
  },
  {
    id: "customers",
    titleKey: "settings.menu.customers",
    rows: [
      { id: "all", labelKey: "hub.customers.all", to: "/customers" },
      { id: "details", labelKey: "hub.customers.details", to: "/customers" },
      { id: "outstanding", labelKey: "hub.customers.outstanding", to: "/customers" },
      { id: "payments", labelKey: "hub.customers.payments", to: "/payments" },
      { id: "credit-requests", labelKey: "hub.customers.creditRequests", to: "/alerts/credit-overrides" },
      { id: "reminders", labelKey: "hub.customers.reminders", to: "/alerts/reminders" },
    ],
  },
  {
    id: "purchases",
    titleKey: "settings.menu.purchases",
    rows: [
      { id: "suppliers", labelKey: "hub.purchases.suppliers", to: "/companies" },
      { id: "history", labelKey: "hub.purchases.history", to: "/purchases" },
      { id: "new", labelKey: "hub.purchases.new", to: "/purchases/new" },
      { id: "payments", labelKey: "hub.purchases.payments", to: "/payments" },
      { id: "payables", labelKey: "hub.purchases.payables", to: "/companies" },
    ],
  },
  {
    id: "finance",
    titleKey: "settings.menu.finance",
    rows: [
      { id: "cash", labelKey: "hub.finance.cash", to: "/payments/daily-cash" },
      { id: "receivables", labelKey: "hub.finance.receivables", to: "/customers" },
      { id: "payables", labelKey: "hub.finance.payables", to: "/companies" },
      { id: "transactions", labelKey: "hub.finance.transactions", to: "/payments" },
    ],
  },
  {
    id: "reports",
    titleKey: "settings.menu.reports",
    rows: [
      { id: "sales", labelKey: "hub.reports.sales", to: "/reports" },
      { id: "profit", labelKey: "hub.reports.profit", to: "/reports" },
      { id: "inventory", labelKey: "hub.reports.inventory", to: "/reports" },
      { id: "credit", labelKey: "hub.reports.credit", to: "/reports" },
      { id: "purchases", labelKey: "hub.reports.purchases", to: "/reports" },
      { id: "branches", labelKey: "hub.reports.branches", to: "/reports" },
      { id: "download", labelKey: "hub.reports.download", to: "/reports" },
    ],
  },
  {
    id: "reminders",
    titleKey: "settings.menu.reminders",
    rows: [
      { id: "approvals", labelKey: "hub.reminders.approvals", to: "/employees/requests" },
      { id: "credit-requests", labelKey: "hub.reminders.creditRequests", to: "/alerts/credit-overrides" },
      { id: "overdue", labelKey: "hub.reminders.overdue", to: "/customers" },
      { id: "stock", labelKey: "hub.reminders.stock", to: "/alerts/inventory" },
      { id: "expiry", labelKey: "hub.reminders.expiry", to: "/alerts/inventory" },
      { id: "notifications", labelKey: "hub.reminders.notifications", to: "/notifications" },
    ],
  },
  {
    id: "people",
    titleKey: "settings.menu.people",
    rows: [
      { id: "employees", labelKey: "hub.people.employees", to: "/employees" },
      { id: "invite", labelKey: "hub.people.invite", to: "/employees/new" },
      { id: "roles", labelKey: "hub.people.roles", to: "/settings/roles" },
      { id: "branches", labelKey: "hub.people.branches", to: "/settings/profile" },
      { id: "activity", labelKey: "hub.people.activity", to: "/activity" },
    ],
  },
  {
    id: "business-profile",
    titleKey: "settings.menu.businessProfile",
    rows: [
      { id: "identity", labelKey: "hub.businessProfile.identity", to: "/settings/business" },
      { id: "contact", labelKey: "hub.businessProfile.contact", to: "/settings/business" },
      { id: "address", labelKey: "hub.businessProfile.address", to: "/settings/business" },
      { id: "branches", labelKey: "hub.businessProfile.branches", to: "/settings/profile" },
    ],
  },
  {
    id: "preferences",
    titleKey: "settings.menu.settings",
    rows: [
      { id: "profile", labelKey: "hub.preferences.profile", to: "/settings/profile" },
      { id: "appearance", labelKey: "hub.preferences.appearance", to: "/settings#settings-preferences" },
      { id: "security", labelKey: "hub.preferences.security", to: "/settings#settings-preferences" },
      { id: "business", labelKey: "hub.preferences.business", to: "/settings/business" },
      { id: "guide", labelKey: "hub.preferences.guide", to: "/guide" },
    ],
  },
];

/** The section behind a route parameter, or null when the address names nothing. */
export function hubSection(sectionId: string | undefined): HubSection | null {
  if (!sectionId) return null;
  return HUB_SECTIONS.find((section) => section.id === sectionId) ?? null;
}
