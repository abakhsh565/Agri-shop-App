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
  /**
   * Dictionary key for the one line under the label, when the screen draws one. Optional
   * because most hubs are a list of places and the label is enough; the Reports board asks
   * what each report answers before the reader commits a tap.
   */
  hintKey?: string;
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
  // Overview and Branches have no entry here on purpose: both sections are screens rather than
  // lists of jobs (`pages/admin/settings/BusinessOverviewPage` and
  // `pages/admin/settings/AdminBranchesSectionPage`), so there is no generic hub to describe.
  // Keeping a catalogue for a section that no longer renders one would be the drift this file
  // exists to prevent.
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
      //   - Stock values is its own screen (`/inventory/stockvalues`): what the branch holds and
      //     what it is worth. It used to send the reader to Reorder suggestions, which answers
      //     the next question (what to buy) and keeps its own screen, still reachable from More.
      //     It carries the section's other name — the inventory hub used to list it twice, once as
      //     "Stock management" and once as the value row on the business overview — so the route
      //     and the label now say what the screen actually shows (owner's correction, 2026-10-30).
      //   - Expiring products is its own screen (`/alerts/expiry`). It and Low stock both opened
      //     the same alerts screen, so one of the two rows always opened the wrong list.
      // Products is a small menu now (0259): All products, the shop's shelves and its units.
      // The row opens that menu, because the shelves and units have no other door.
      { id: "products", labelKey: "hub.inventory.products", to: "/inventory/catalogue" },
      { id: "variants", labelKey: "hub.inventory.variants", to: "/products" },
      { id: "stock", labelKey: "hub.inventory.stock", to: "/inventory/stockvalues" },
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
      { id: "outstanding", labelKey: "hub.customers.outstanding", to: "/customers/outstanding" },
      // The customer receipt book, not the general payments ledger: this section's rows are
      // about customers, and that ledger also holds supplier money (owner's instruction,
      // 2026-10-30).
      { id: "payments", labelKey: "hub.customers.payments", to: "/customers/payments" },
      { id: "credit-requests", labelKey: "hub.customers.creditRequests", to: "/customers/credit-requests" },
      { id: "reminders", labelKey: "hub.customers.reminders", to: "/customers/reminders" },
    ],
  },
  {
    id: "purchases",
    titleKey: "settings.menu.purchases",
    rows: [
      { id: "suppliers", labelKey: "hub.purchases.suppliers", to: "/companies" },
      { id: "history", labelKey: "hub.purchases.history", to: "/purchases" },
      { id: "new", labelKey: "hub.purchases.new", to: "/purchases/new" },
      // The supplier payments book, not the general payments ledger: this section's rows are
      // about suppliers, and that ledger also holds customer receipts and expenses
      // (owner's instruction, 2026-10-30).
      { id: "payments", labelKey: "hub.purchases.payments", to: "/purchases/payments" },
      { id: "payables", labelKey: "hub.purchases.payables", to: "/companies" },
    ],
  },
  {
    // Finance has its own screen (`pages/admin/finance/AdminFinanceSectionPage`): recorded cash,
    // the two balances, these four jobs and the last payments. The rows stay here because the
    // screen reads its labels and destinations from this catalogue — the section's list and the
    // screen's list cannot drift apart. Each destination is the screen that answers that job:
    //   - Receivables and payables used to open the general customer and supplier lists, which
    //     are address books; the ledgers behind the hub's own two figures are the receipt book
    //     and the payable book.
    id: "finance",
    titleKey: "settings.menu.finance",
    rows: [
      { id: "cash", labelKey: "hub.finance.cash", to: "/payments/cash-position" },
      // ONE money row (owner, 2026-10-31). The statement, the recorded-entry ledger and the
      // payment list were three destinations over the same movements; they are now one screen
      // with filters, and a recorded row opens its correction sheet in place. The form is the
      // screen's single write action, opened from "Record money" rather than a second row.
      { id: "money", labelKey: "money.row", hintKey: "money.rowHint", to: "/settings/hub/finance/money" },
      { id: "receivables", labelKey: "hub.finance.receivables", to: "/settings/overview/customers" },
      { id: "payables", labelKey: "hub.finance.payables", to: "/settings/overview/suppliers" },
      // The owner's own payment diary (0257): customer, supplier and general notes in one book.
      // It is a different job from the chasing reminders under Customers — those message a
      // customer, these remind the owner.
      { id: "reminders", labelKey: "hub.finance.reminders", hintKey: "hub.finance.remindersHint", to: "/settings/hub/finance/reminders" },
    ],
  },
  {
    // Reports is a screen of report destinations (`pages/admin/reports/AdminReportsHubPage`),
    // not the generic row list. It reads this section for its destinations and labels, so the
    // names live in one place; the page owns only the icon, the tile shape and the permission
    // each destination asks for.
    //
    // EVERY ROW IS THE SCREEN THAT ANSWERS THE QUESTION. It used to send all seven at the same
    // general Reports page, which meant five of them opened something that was not what their
    // label said. Sales opens the sales section hub (`/settings/hub/sales`); Profit has its own
    // report (`/reports/profit`); Customers and Suppliers open their ledgers; Inventory opens
    // the stock hub; Activity opens the audit trail. The general Reports page is still reachable
    // at `/reports` and stays the long-form screen.
    id: "reports",
    titleKey: "settings.menu.reports",
    rows: [
      { id: "sales", labelKey: "hub.reports.sales", hintKey: "reports.hub.salesHint", to: "/settings/hub/sales" },
      { id: "detailed", labelKey: "hub.reports.detailed", hintKey: "reports.hub.detailedHint", to: "/reports" },
      { id: "profit", labelKey: "hub.reports.profit", hintKey: "reports.hub.profitHint", to: "/reports/profit" },
      { id: "customers", labelKey: "hub.reports.customers", hintKey: "reports.hub.customersHint", to: "/settings/overview/customers" },
      { id: "suppliers", labelKey: "hub.reports.suppliers", hintKey: "reports.hub.suppliersHint", to: "/settings/overview/suppliers" },
      { id: "inventory", labelKey: "hub.reports.inventory", hintKey: "reports.hub.inventoryHint", to: "/settings/hub/inventory" },
      { id: "activity", labelKey: "hub.reports.activity", hintKey: "reports.hub.activityHint", to: "/activity" },
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
    // Employees & Access is a directory (`pages/admin/people/AdminPeopleHubPage`), not the
    // generic row list. The page reads the three rows below for its "Manage access" group, so
    // the labels and destinations stay one source; the two rows that only described the screen
    // itself (the directory and the invite form) are not repeated there.
    id: "people",
    titleKey: "settings.menu.people",
    rows: [
      { id: "employees", labelKey: "hub.people.employees", to: "/settings/hub/people" },
      { id: "invite", labelKey: "hub.people.invite", to: "/employees/new" },
      { id: "roles", labelKey: "hub.people.roles", hintKey: "people.rolesHint", to: "/settings/roles" },
      { id: "activity", labelKey: "hub.people.activity", hintKey: "people.employeeActivityHint", to: "/settings/hub/people/activity" },
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
