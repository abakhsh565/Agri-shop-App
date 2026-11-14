import type { LucideIcon } from "lucide-react";
import {
  ShoppingCart, Users, Package, BarChart3, Store, Banknote, Factory,
  Undo2, User, TrendingUp, Settings, ClipboardList, Bell, AlertOctagon, Circle,
} from "lucide-react";
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
 *
 * Icons are lucide components rather than glyphs: the design language draws
 * icons as thin monochrome strokes, and an emoji renders in the OS's own
 * colourful style, which cannot follow the theme or the stroke weight.
 */
export const BUSINESS_AREAS: { code: string; Icon: LucideIcon }[] = [
  { code: "sales", Icon: ShoppingCart },
  { code: "customers", Icon: Users },
  { code: "products", Icon: Package },
  { code: "inventory", Icon: BarChart3 },
  { code: "purchases", Icon: Store },
  { code: "payments", Icon: Banknote },
  { code: "companies", Icon: Factory },
  { code: "returns", Icon: Undo2 },
  { code: "employees", Icon: User },
  { code: "reports", Icon: TrendingUp },
  { code: "settings", Icon: Settings },
  { code: "activity", Icon: ClipboardList },
  { code: "notifications", Icon: Bell },
  { code: "alerts", Icon: AlertOctagon },
];

const AREA_CODES = new Set(BUSINESS_AREAS.map((a) => a.code));
const ACTION_CODES = new Set(["view", "create", "edit", "delete", "void", "payments", "supplier", "adjust", "manage", "credit_limit"]);

/** Translated business-area label, falling back to the raw module name if unknown. */
export function usePermissionLabels() {
  const t = useT();
  return {
    areaLabel: (module: string) => (AREA_CODES.has(module) ? t(`area.${module}`) : module),
    actionLabel: (action: string) => (ACTION_CODES.has(action) ? t(`action.${action}`) : action),
    /** Neutral mark rather than a broken glyph when a module is unknown. */
    areaIcon: (module: string): LucideIcon =>
      BUSINESS_AREAS.find((a) => a.code === module)?.Icon ?? Circle,
  };
}
