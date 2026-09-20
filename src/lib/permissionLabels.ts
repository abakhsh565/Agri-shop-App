import { useT } from "@/lib/i18n";

/**
 * Business language for permissions.
 *
 * A shop owner should never read a permission code, a module name as stored, or an
 * action verb that only makes sense in the database. These labels are the single
 * definition of that wording, so every screen that shows access (Add Employee,
 * Employee Detail, Roles & Access) says the same thing in both languages.
 *
 * The areas match `permissions.module` values in the database.
 */
export const BUSINESS_AREAS: { code: string; icon: string }[] = [
  { code: "sales", icon: "🛒" },
  { code: "customers", icon: "👥" },
  { code: "products", icon: "📦" },
  { code: "inventory", icon: "📊" },
  { code: "purchases", icon: "🏪" },
  { code: "payments", icon: "💰" },
  { code: "companies", icon: "🏭" },
  { code: "returns", icon: "↩️" },
  { code: "employees", icon: "👤" },
  { code: "reports", icon: "📈" },
  { code: "settings", icon: "⚙️" },
  { code: "activity", icon: "📋" },
  { code: "notifications", icon: "🔔" },
  { code: "alerts", icon: "🚨" },
];

const AREA_CODES = new Set(BUSINESS_AREAS.map((a) => a.code));
const ACTION_CODES = new Set(["view", "create", "edit", "delete", "void", "payments", "supplier", "adjust", "manage"]);

/** Translated business-area label, falling back to the raw module name if unknown. */
export function usePermissionLabels() {
  const t = useT();
  return {
    areaLabel: (module: string) => (AREA_CODES.has(module) ? t(`area.${module}`) : module),
    actionLabel: (action: string) => (ACTION_CODES.has(action) ? t(`action.${action}`) : action),
    areaIcon: (module: string) => BUSINESS_AREAS.find((a) => a.code === module)?.icon ?? "",
  };
}
