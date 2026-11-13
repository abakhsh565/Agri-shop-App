/**
 * Route → module hierarchy.
 *
 * One metadata source for the whole app. The Back arrow, the hardware back handler and the
 * journey tracker all resolve the reader's workspace, module, module root and canonical parent
 * from here instead of guessing from browser history.
 */

export type WorkspaceId = "admin" | "co-owner" | "employee" | "auth" | "public";
export type NavigationEntryType = "board" | "module-root" | "child";

export interface RouteNavigationMeta {
  workspaceId: WorkspaceId;
  moduleId: string;
  moduleKey: string;
  moduleRootPath: string;
  parentRoute: string | null;
  entryType: NavigationEntryType;
  backBehavior: "hierarchy" | "explicit";
  isBoard: boolean;
}

export const WORKSPACE_BOARDS: Record<"admin" | "co-owner" | "employee", string> = {
  admin: "/admin/dashboard",
  "co-owner": "/co-owner/dashboard",
  employee: "/employee/dashboard",
};

const ADMIN_MODULES: Record<string, string> = {
  dashboard: "/admin/dashboard",
  assistant: "/admin/assistant",
  more: "/admin/more",
  messages: "/admin/messages",
  guide: "/admin/guide",
  search: "/admin/search",
  customers: "/admin/customers",
  products: "/admin/products",
  inventory: "/admin/inventory/catalogue",
  sale: "/admin/sale",
  sales: "/admin/sales",
  purchases: "/admin/purchases",
  payments: "/admin/payments",
  companies: "/admin/companies",
  employees: "/admin/employees",
  reports: "/admin/reports",
  settings: "/admin/settings",
  activity: "/admin/activity",
  "co-owner-approvals": "/admin/co-owner-approvals",
  "ownership-transfer": "/admin/ownership-transfer",
  notifications: "/admin/notifications",
  alerts: "/admin/alerts/reminders",
};

const CO_OWNER_MODULES: Record<string, string> = {
  dashboard: "/co-owner/dashboard",
  approvals: "/co-owner/approvals",
  "ownership-transfer": "/co-owner/ownership-transfer",
  more: "/co-owner/more",
  settings: "/co-owner/settings",
  team: "/co-owner/team",
  sale: "/co-owner/sale",
  sales: "/co-owner/sales",
  products: "/co-owner/products",
  inventory: "/co-owner/products",
  customers: "/co-owner/customers",
  purchases: "/co-owner/purchases",
  companies: "/co-owner/companies",
  reports: "/co-owner/reports",
  finance: "/co-owner/finance",
  activity: "/co-owner/activity",
  notifications: "/co-owner/notifications",
  search: "/co-owner/search",
};

const EMPLOYEE_MODULES: Record<string, string> = {
  dashboard: "/employee/dashboard",
  assistant: "/employee/assistant",
  more: "/employee/more",
  guide: "/employee/guide",
  "my-work": "/employee/my-work",
  search: "/employee/search",
  customers: "/employee/customers",
  products: "/employee/products",
  inventory: "/employee/products",
  stock: "/employee/stock",
  sale: "/employee/sale",
  sales: "/employee/sales",
  purchases: "/employee/purchases",
  companies: "/employee/companies",
  finance: "/employee/finance",
  team: "/employee/team",
  reports: "/employee/reports",
  settings: "/employee/settings",
  activity: "/employee/activity",
  notifications: "/employee/notifications",
};

const MODULE_ROOTS: Record<"admin" | "co-owner" | "employee", Record<string, string>> = {
  admin: ADMIN_MODULES,
  "co-owner": CO_OWNER_MODULES,
  employee: EMPLOYEE_MODULES,
};

export function stripSearch(pathWithSearch: string): string {
  return pathWithSearch.split(/[?#]/, 1)[0] || "/";
}

export function normalizePath(pathWithSearch: string): string {
  const path = stripSearch(pathWithSearch).replace(/\/+$/, "");
  return path || "/";
}

export function workspaceForPath(pathWithSearch: string): WorkspaceId {
  const path = normalizePath(pathWithSearch);
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  if (path === "/co-owner" || path.startsWith("/co-owner/")) return "co-owner";
  if (path === "/employee" || path.startsWith("/employee/")) return "employee";
  if (
    path === "/" ||
    path === "/welcome" ||
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/identity")
  ) {
    return "auth";
  }
  return "public";
}

export function isAuthRoute(pathWithSearch: string): boolean {
  return workspaceForPath(pathWithSearch) === "auth";
}

function moduleRootFor(workspace: "admin" | "co-owner" | "employee", segment: string): string {
  return MODULE_ROOTS[workspace][segment] ?? `/${workspace}/${segment}`;
}

/**
 * Settings contains several real module landing pages. Their route is nested under Settings,
 * but their Back boundary is the Board, not Settings; treating them as Settings children made
 * Back walk into an unrelated settings menu.
 */
function sectionModuleFor(
  path: string,
  workspace: "admin" | "co-owner" | "employee",
): { id: string; root: string } | null {
  if (workspace !== "admin") return null;
  const base = "/admin";
  const s = path.slice(base.length).replace(/^\/+/, "").split("/").filter(Boolean);
  if (s[0] !== "settings") return null;

  if (s[1] === "roles") {
    return { id: "people", root: `${base}/settings/hub/people` };
  }
  if (s[1] === "branches" && s[2]) {
    return { id: "branches", root: `${base}/settings/hub/branches` };
  }
  if (s[1] === "overview" && s[2]) {
    return { id: "finance", root: `${base}/settings/hub/finance` };
  }
  if (s[1] === "hub" && s[2]) {
    const section = s[2];
    if (section === "people") return { id: "people", root: `${base}/settings/hub/people` };
    if (section === "finance") return { id: "finance", root: `${base}/settings/hub/finance` };
    if (section === "branches") return { id: "branches", root: `${base}/settings/hub/branches` };
    return { id: `hub-${section}`, root: `${base}/settings/hub/${section}` };
  }
  return null;
}

/**
 * Canonical parent for a nested route, used when the reader arrived by deep link, refresh,
 * bookmark or a new tab and there is no in-app journey to retrace.
 */
export function resolveParentRoute(
  pathWithSearch: string,
  workspace: "admin" | "co-owner" | "employee",
  moduleRootPath: string,
): string {
  const path = normalizePath(pathWithSearch);
  const base = `/${workspace}`;
  const rest = path.slice(base.length).replace(/^\/+/, "");
  const s = rest.split("/").filter(Boolean);
  const root = moduleRootPath;

  if (!s.length) return WORKSPACE_BOARDS[workspace];

  switch (s[0]) {
    case "employees":
    case "team": {
      const list = `${base}/${s[0]}`;
      if (s.length >= 3 && s[1] !== "new") return `${list}/${s[1]}`;
      return list;
    }
    case "customers": {
      const list = `${base}/customers`;
      if (s.length >= 3 && !["new", "outstanding", "payments", "credit-requests", "reminders"].includes(s[1])) {
        return `${list}/${s[1]}`;
      }
      return list;
    }
    case "companies":
      return `${base}/companies`;
    case "purchases":
      return `${base}/purchases`;
    case "sales": {
      const list = `${base}/sales`;
      if (s.length >= 4 && s[1] && s[2] === "return" && s[3] === "confirm") {
        return `${list}/${s[1]}/return`;
      }
      if (s.length >= 3 && s[1] && s[2] === "return") return `${list}/${s[1]}`;
      return list;
    }
    case "sale": {
      const flow = `${base}/sale`;
      if (s[1] === "products" && s[2]) return `${flow}/products`;
      return flow;
    }
    case "inventory": {
      if (workspace === "admin") {
        // The ledger and barcode printer are opened from Products & inventory, not from the
        // catalogue's manage screen.
        if ((s[1] === "movements" || s[1] === "barcodes") && s.length === 2) {
          return `${base}/settings/hub/inventory`;
        }
        if (s[1] === "categories") return `${base}/inventory/categories`;
        if (s[1] === "units") return `${base}/inventory/units`;
      }
      return moduleRootPath;
    }
    case "settings": {
      const settings = `${base}/settings`;
      if (s[1] === "roles") return s[2] ? `${settings}/roles` : moduleRootPath;
      if (s[1] === "branches" && s[2]) return moduleRootPath;
      if (s[1] === "overview") {
        if (s[2] === "customers") {
          if (s[3]) return `${settings}/overview/customers`;
          return moduleRootPath;
        }
        if (s[2] === "suppliers") {
          if (s[3]) return `${settings}/overview/suppliers`;
          return moduleRootPath;
        }
        return moduleRootPath;
      }
      if (s[1] === "hub") {
        if (s[2] === "people") {
          if (s[3] === "activity" && s[4]) return `${settings}/hub/people/activity`;
          if (s[3] === "co-owners") {
            if (!s[4]) return moduleRootPath;
            if (s[5] === "edit") return `${settings}/hub/people/co-owners/${s[4]}`;
            return `${settings}/hub/people/co-owners`;
          }
          return moduleRootPath;
        }
        if (s[2] === "finance" && s[3]) return moduleRootPath;
        return moduleRootPath;
      }
      return settings;
    }
    case "alerts": {
      // The low-stock list and reminder book are opened from their own section screens, not
      // from the alerts landing page.
      if (s[1] === "inventory" && s.length === 2) return `${base}/settings/hub/inventory`;
      if (s[1] === "reminders" && s.length === 2) return `${base}/settings/hub/finance`;
      if (s[1] === "credit-overrides" && s[2]) return `${base}/alerts/credit-overrides`;
      return `${base}/alerts/reminders`;
    }
    case "reports":
      return `${base}/reports`;
    case "payments":
      return `${base}/payments`;
    case "notifications":
      return `${base}/notifications`;
    case "activity":
      return `${base}/activity`;
    case "products":
      return `${base}/products`;
    case "finance":
      return `${base}/finance`;
    case "more":
      return `${base}/more`;
    case "assistant":
      return `${base}/assistant`;
    case "messages":
      return `${base}/messages`;
    case "guide":
      return `${base}/guide`;
    case "search":
      return `${base}/search`;
    case "co-owner-approvals":
      return `${base}/co-owner-approvals`;
    case "approvals":
      return `${base}/approvals`;
    case "stock":
      return `${base}/stock`;
    case "my-work":
      return `${base}/my-work`;
    default:
      return root;
  }
}

export function resolveRouteMeta(pathWithSearch: string): RouteNavigationMeta {
  const path = normalizePath(pathWithSearch);
  const workspace = workspaceForPath(path);

  if (workspace === "auth" || workspace === "public") {
    const parent = path === "/" || path === "/welcome" ? null : workspace === "auth" ? "/login" : null;
    return {
      workspaceId: workspace,
      moduleId: workspace,
      moduleKey: workspace,
      moduleRootPath: workspace === "auth" ? "/login" : "/",
      parentRoute: parent,
      entryType: "child",
      backBehavior: "explicit",
      isBoard: path === "/" || path === "/welcome",
    };
  }

  const board = WORKSPACE_BOARDS[workspace];
  if (path === `/${workspace}` || path === board) {
    return {
      workspaceId: workspace,
      moduleId: "dashboard",
      moduleKey: `${workspace}:dashboard`,
      moduleRootPath: board,
      parentRoute: null,
      entryType: "board",
      backBehavior: "hierarchy",
      isBoard: true,
    };
  }

  const first = path.slice(`/${workspace}`.length).split("/").filter(Boolean)[0] ?? "dashboard";
  const sectionModule = sectionModuleFor(path, workspace);
  const moduleId = sectionModule?.id ?? first;
  const moduleRootPath = sectionModule?.root ?? moduleRootFor(workspace, first);
  // The harvest worklist is opened from Home as a first-class alert destination. It is a
  // read-and-act screen with its own record list, so Back follows the same history rule as a
  // module root rather than dropping into the Action Center the reader never visited.
  const isAlertDestination = workspace === "admin" && path === "/admin/alerts/harvest";
  // The reminder book is the alerts module's root for history, but it is reached from Finance;
  // a cold open should return there rather than dropping the reader on the dashboard.
  const isFinanceReminderBook = workspace === "admin" && path === "/admin/alerts/reminders";
  const entryType: NavigationEntryType =
    path === moduleRootPath || isAlertDestination ? "module-root" : "child";
  const parentRoute =
    entryType === "module-root" && !isFinanceReminderBook
      ? board
      : resolveParentRoute(path, workspace, moduleRootPath);

  return {
    workspaceId: workspace,
    moduleId,
    moduleKey: `${workspace}:${moduleId}`,
    moduleRootPath,
    parentRoute: parentRoute === path ? board : parentRoute,
    entryType,
    backBehavior: "hierarchy",
    isBoard: false,
  };
}
