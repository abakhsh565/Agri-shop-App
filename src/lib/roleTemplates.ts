import type { RoleCategory, RoleLevel } from "@/types";

/**
 * System knowledge for Roles & Access.
 *
 * This is a CATALOGUE, not a second permission system. Every code below is a real
 * `permissions.code` and every dashboard key is a real `dashboard_widgets.key`. The
 * recommendation engine only orders and suggests those existing rows; it never creates
 * authority. The database remains the only place a grant is written or enforced.
 */
export interface RoleTemplate {
  id: string;
  /** Canonical English name, used to avoid duplicating a database system role. */
  name: string;
  nameKey: string;
  descriptionKey: string;
  category: RoleCategory;
  level: RoleLevel;
  permissions: string[];
  dashboards: string[];
}

export const ROLE_CATEGORIES: {
  value: RoleCategory;
  labelKey: string;
  modules: string[];
}[] = [
  { value: "sales", labelKey: "roles.category.sales", modules: ["sales", "customers", "returns", "products"] },
  { value: "finance", labelKey: "roles.category.finance", modules: ["payments", "customers", "reports", "settings"] },
  { value: "inventory", labelKey: "roles.category.inventory", modules: ["products", "inventory", "purchases", "companies"] },
  { value: "procurement", labelKey: "roles.category.procurement", modules: ["purchases", "companies", "payments", "products"] },
  { value: "people_hr", labelKey: "roles.category.peopleHr", modules: ["employees", "activity", "reports", "settings"] },
  { value: "operations", labelKey: "roles.category.operations", modules: ["sales", "customers", "products", "inventory", "purchases", "companies"] },
  { value: "business_management", labelKey: "roles.category.businessManagement", modules: ["settings", "employees", "reports", "activity", "alerts"] },
  { value: "other", labelKey: "roles.category.other", modules: [] },
];

export const RESPONSIBILITY_LEVELS: {
  value: RoleLevel;
  labelKey: string;
}[] = [
  { value: "individual_contributor", labelKey: "roles.level.individual" },
  { value: "supervisor", labelKey: "roles.level.supervisor" },
  { value: "manager", labelKey: "roles.level.manager" },
  { value: "department_head", labelKey: "roles.level.head" },
];

/**
 * Four protected starting points. They are deliberately static: a shop may delete one of
 * its seeded roles, and the template list must not disappear with it. Using one copies
 * the configuration into a new business role; the template itself is never written.
 */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "tpl-sales-employee",
    name: "Sales Employee",
    nameKey: "roles.template.salesEmployee",
    descriptionKey: "roles.template.salesEmployeeHint",
    category: "sales",
    level: "individual_contributor",
    permissions: [
      "sales.view",
      "sales.create",
      "customers.view",
      "customers.create",
      "products.view",
      "returns.view",
    ],
    dashboards: ["sales_overview", "customer_outstanding"],
  },
  {
    id: "tpl-sales-supervisor",
    name: "Sales Supervisor",
    nameKey: "roles.template.salesSupervisor",
    descriptionKey: "roles.template.salesSupervisorHint",
    category: "sales",
    level: "supervisor",
    permissions: [
      "sales.view",
      "sales.create",
      "sales.void",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.payments",
      "products.view",
      "returns.view",
      "returns.create",
      "reports.view",
      "alerts.view",
    ],
    dashboards: [
      "sales_overview",
      "revenue_analysis",
      "customer_outstanding",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-sales-manager",
    name: "Sales Manager",
    nameKey: "roles.template.salesManager",
    descriptionKey: "roles.template.salesManagerHint",
    category: "sales",
    level: "manager",
    permissions: [
      "sales.view",
      "sales.create",
      "sales.void",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.payments",
      "customers.credit_limit",
      "products.view",
      "returns.view",
      "returns.create",
      "reports.view",
      "employees.view",
      "alerts.view",
    ],
    dashboards: [
      "sales_overview",
      "revenue_analysis",
      "customer_outstanding",
      "team_performance",
      "profit_loss",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-store-manager",
    name: "Store Manager",
    nameKey: "roles.template.storeManager",
    descriptionKey: "roles.template.storeManagerHint",
    category: "operations",
    level: "manager",
    permissions: [
      "sales.view",
      "customers.view",
      "products.view",
      "products.create",
      "products.edit",
      "inventory.view",
      "inventory.adjust",
      "purchases.view",
      "purchases.create",
      "companies.view",
      "payments.view",
      "payments.supplier",
      "employees.view",
      "alerts.view",
    ],
    dashboards: [
      "sales_overview",
      "inventory_position",
      "supplier_payables",
      "money_movements",
      "team_performance",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-inventory-clerk",
    name: "Inventory Clerk",
    nameKey: "roles.template.inventoryClerk",
    descriptionKey: "roles.template.inventoryClerkHint",
    category: "inventory",
    level: "individual_contributor",
    permissions: [
      "products.view",
      "products.create",
      "products.edit",
      "inventory.view",
      "inventory.adjust",
      "purchases.view",
      "purchases.create",
      "companies.view",
      "companies.create",
      "companies.edit",
      "payments.view",
      "payments.supplier",
      "alerts.view",
    ],
    dashboards: [
      "inventory_position",
      "supplier_payables",
      "expense_analysis",
      "money_movements",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-finance-employee",
    name: "Finance Employee",
    nameKey: "roles.template.financeEmployee",
    descriptionKey: "roles.template.financeEmployeeHint",
    category: "finance",
    level: "individual_contributor",
    permissions: [
      "payments.view",
      "sales.view",
      "customers.view",
      "customers.payments",
      "purchases.view",
      "companies.view",
      "reports.view",
      "alerts.view",
    ],
    dashboards: [
      "money_movements",
      "customer_outstanding",
      "expense_analysis",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-finance-manager",
    name: "Finance Manager",
    nameKey: "roles.template.financeManager",
    descriptionKey: "roles.template.financeManagerHint",
    category: "finance",
    level: "manager",
    permissions: [
      "payments.view",
      "sales.view",
      "payments.supplier",
      "customers.view",
      "customers.edit",
      "customers.payments",
      "customers.credit_limit",
      "purchases.view",
      "companies.view",
      "reports.view",
      "alerts.view",
    ],
    dashboards: [
      "money_movements",
      "customer_outstanding",
      "expense_analysis",
      "profit_loss",
      "supplier_payables",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-inventory-manager",
    name: "Inventory Manager",
    nameKey: "roles.template.inventoryManager",
    descriptionKey: "roles.template.inventoryManagerHint",
    category: "inventory",
    level: "manager",
    permissions: [
      "products.view",
      "products.create",
      "products.edit",
      "inventory.view",
      "inventory.adjust",
      "purchases.view",
      "purchases.create",
      "companies.view",
      "companies.edit",
      "payments.view",
      "reports.view",
      "employees.view",
      "alerts.view",
    ],
    dashboards: [
      "inventory_position",
      "supplier_payables",
      "expense_analysis",
      "team_performance",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-purchase-officer",
    name: "Purchase Officer",
    nameKey: "roles.template.purchaseOfficer",
    descriptionKey: "roles.template.purchaseOfficerHint",
    category: "procurement",
    level: "individual_contributor",
    permissions: [
      "purchases.view",
      "purchases.create",
      "companies.view",
      "companies.create",
      "companies.edit",
      "products.view",
      "inventory.view",
      "payments.view",
      "payments.supplier",
      "alerts.view",
    ],
    dashboards: [
      "supplier_payables",
      "expense_analysis",
      "inventory_position",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-purchase-manager",
    name: "Purchase Manager",
    nameKey: "roles.template.purchaseManager",
    descriptionKey: "roles.template.purchaseManagerHint",
    category: "procurement",
    level: "manager",
    permissions: [
      "purchases.view",
      "purchases.create",
      "companies.view",
      "companies.create",
      "companies.edit",
      "products.view",
      "inventory.view",
      "payments.view",
      "payments.supplier",
      "reports.view",
      "employees.view",
      "alerts.view",
    ],
    dashboards: [
      "supplier_payables",
      "expense_analysis",
      "inventory_position",
      "team_performance",
      "quick_alerts",
    ],
  },
  {
    id: "tpl-credit-officer",
    name: "Credit & Customer Officer",
    nameKey: "roles.template.creditOfficer",
    descriptionKey: "roles.template.creditOfficerHint",
    category: "operations",
    level: "individual_contributor",
    permissions: [
      "sales.view",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.payments",
      "customers.credit_limit",
      "alerts.view",
    ],
    dashboards: [
      "customer_outstanding",
      "sales_overview",
      "quick_alerts",
    ],
  },
];

const BASE_BY_CATEGORY: Record<RoleCategory, string[]> = {
  sales: ["sales.view", "sales.create", "customers.view", "customers.create", "products.view", "returns.view"],
  finance: ["payments.view", "customers.payments", "purchases.view", "reports.view"],
  inventory: ["products.view", "inventory.view", "purchases.view", "companies.view"],
  procurement: ["purchases.view", "companies.view", "products.view"],
  people_hr: ["employees.view", "activity.view"],
  operations: ["sales.view", "customers.view", "products.view", "inventory.view", "purchases.view"],
  business_management: ["settings.view", "reports.view", "employees.view", "activity.view", "alerts.view"],
  other: [],
};

const ELEVATED_BY_CATEGORY: Record<RoleCategory, string[]> = {
  sales: ["sales.void", "customers.edit", "customers.payments", "customers.credit_limit", "returns.create", "reports.view", "employees.view"],
  finance: ["payments.supplier", "customers.edit", "companies.view", "reports.view", "settings.view"],
  inventory: ["products.create", "products.edit", "inventory.adjust", "purchases.create", "companies.create", "companies.edit"],
  procurement: ["purchases.create", "companies.create", "companies.edit", "payments.supplier"],
  people_hr: ["employees.manage", "settings.view", "reports.view"],
  operations: ["inventory.adjust", "purchases.create", "companies.view", "reports.view", "employees.view"],
  business_management: ["settings.edit", "employees.manage", "alerts.manage", "sales.view", "purchases.view"],
  other: [],
};

/**
 * Recommendations are explicit metadata, not guesses from the role's name.
 * A Manager gets the extra actions in the same way a Supervisor does; the level only
 * changes what is SUGGESTED and is never written as authority on its own.
 */
export function recommendationFor(
  category: RoleCategory | null | undefined,
  level: RoleLevel | null | undefined,
): string[] {
  if (!category) return [];
  const base = BASE_BY_CATEGORY[category] ?? [];
  const elevated = level && level !== "individual_contributor"
    ? ELEVATED_BY_CATEGORY[category] ?? []
    : [];
  return [...new Set([...base, ...elevated])];
}

export function categoryModules(category: RoleCategory | null | undefined): string[] {
  if (!category) return [];
  return ROLE_CATEGORIES.find((c) => c.value === category)?.modules ?? [];
}

export function categoryLabelKey(category: RoleCategory | null | undefined): string {
  const found = ROLE_CATEGORIES.find((c) => c.value === category);
  return found ? found.labelKey : "roles.category.other";
}

export function levelLabelKey(level: RoleLevel | null | undefined): string {
  const found = RESPONSIBILITY_LEVELS.find((l) => l.value === level);
  return found ? found.labelKey : "roles.level.individual";
}

/**
 * System-managed dashboard metadata. `defaultPermission` is read from the database as
 * well; this map supplies the human sentence and the data boundary the role screen shows.
 */
export const DASHBOARD_WIDGET_HINTS: Record<string, { hintKey: string; scope: "branch" | "business" }> = {
  sales_overview: { hintKey: "roles.widget.salesOverviewHint", scope: "branch" },
  revenue_analysis: { hintKey: "roles.widget.revenueAnalysisHint", scope: "branch" },
  expense_analysis: { hintKey: "roles.widget.expenseAnalysisHint", scope: "branch" },
  profit_loss: { hintKey: "roles.widget.profitLossHint", scope: "branch" },
  customer_outstanding: { hintKey: "roles.widget.customerOutstandingHint", scope: "branch" },
  inventory_position: { hintKey: "roles.widget.inventoryPositionHint", scope: "branch" },
  supplier_payables: { hintKey: "roles.widget.supplierPayablesHint", scope: "branch" },
  team_performance: { hintKey: "roles.widget.teamPerformanceHint", scope: "branch" },
  money_movements: { hintKey: "roles.widget.moneyMovementsHint", scope: "branch" },
  quick_alerts: { hintKey: "roles.widget.quickAlertsHint", scope: "branch" },
};

/**
 * Optional starting configurations for the new role builder. They are templates, not
 * rows: choosing one copies real permission codes into the shop's own role, which can
 * then be edited without changing any other shop. Finance Manager reuses the existing
 * finance-manager template list rather than duplicating its permissions here.
 */
export interface StartingRoleTemplate {
  id: "staff" | "manager" | "finance_manager";
  nameKey: string;
  descriptionKey: string;
  departmentCode: string;
  category: RoleCategory;
  level: RoleLevel;
  permissions: string[];
}

export const STARTING_ROLES: StartingRoleTemplate[] = [
  {
    id: "staff",
    nameKey: "roles.starter.staff",
    descriptionKey: "roles.starter.staffHint",
    departmentCode: "sales",
    category: "sales",
    level: "individual_contributor",
    permissions: [
      "sales.view",
      "sales.create",
      "customers.view",
      "customers.create",
      "products.view",
      "inventory.view",
    ],
  },
  {
    id: "manager",
    nameKey: "roles.starter.manager",
    descriptionKey: "roles.starter.managerHint",
    departmentCode: "management",
    category: "business_management",
    level: "manager",
    permissions: [
      "sales.view",
      "sales.create",
      "sales.void",
      "customers.view",
      "customers.create",
      "customers.edit",
      "customers.payments",
      "customers.credit_limit",
      "products.view",
      "inventory.view",
      "inventory.adjust",
      "purchases.view",
      "purchases.create",
      "companies.view",
      "payments.view",
      "payments.supplier",
      "returns.view",
      "returns.create",
      "reports.view",
      "employees.view",
      "alerts.view",
    ],
  },
  {
    id: "finance_manager",
    nameKey: "roles.template.financeManager",
    descriptionKey: "roles.template.financeManagerHint",
    departmentCode: "finance",
    category: "finance",
    level: "manager",
    permissions: [...ROLE_TEMPLATES.find((template) => template.id === "tpl-finance-manager")!.permissions],
  },
];

/** The owner is an account identity, never an assignable employee role. */
export function isOwnerRoleName(name: string | null | undefined): boolean {
  const normal = (name ?? "").trim().toLowerCase();
  return normal === "owner" || normal === "business owner" || normal === "shop owner";
}
