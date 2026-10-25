import { Bell, Building2, ClipboardList, Package, ShieldCheck, Users, Wheat, type LucideIcon } from "lucide-react";
import type { I18nKey } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { usePlacementStore, type Screen } from "@/stores/placementStore";

/**
 * The shop-level rows that Settings and the owner suite share.
 *
 * Settings used to carry a copy of five of them (Employees, Companies, Inventory, Roles, Crop
 * configuration), each already reachable from the owner suite, so the same tap existed twice on
 * two screens and the two copies could drift. There is now one row per destination, one place it
 * ships from, and one control that moves it — see `useOwnerRows`.
 *
 * They live in a single module because both screens have to agree about them: the row's label,
 * icon, route, group and default side are stated once, here.
 */

export type SuiteGroup = "money" | "stock" | "people" | "app";

export interface OwnerRow {
  id: string;
  labelKey: I18nKey;
  metaKey?: I18nKey;
  icon: LucideIcon;
  /** Route under the shell, or null when the row opens a sheet rather than a screen. */
  path: string | null;
  /** Which group it sits in when it lives in the owner suite. */
  group: SuiteGroup;
  /** Where it ships before anyone moves it. */
  defaultScreen: Screen;
  /** The guided tour's handle on this row, kept on the row element whichever screen holds it. */
  anchor: string;
}

export const OWNER_ROWS: OwnerRow[] = [
  {
    id: "employees",
    labelKey: "admin.employees",
    // The second line the group rows carry (owner's request, 2026-10-26): every row in
    // Money, Stock and People says what it holds, so two destinations cannot be confused.
    metaKey: "more.hint.employees",
    icon: Users,
    path: "/employees",
    group: "people",
    defaultScreen: "suite",
    anchor: "more:employees",
  },
  {
    id: "companies",
    labelKey: "admin.companies",
    metaKey: "more.hint.companies",
    icon: Building2,
    path: "/companies",
    group: "people",
    defaultScreen: "suite",
    anchor: "more:companies",
  },
  {
    id: "roles",
    labelKey: "settings.rolesAccess",
    metaKey: "more.hint.roles",
    icon: ShieldCheck,
    path: "/settings/roles",
    group: "people",
    defaultScreen: "suite",
    anchor: "more:roles",
  },
  {
    id: "inventory",
    labelKey: "admin.inventory",
    metaKey: "more.hint.inventory",
    icon: Package,
    path: "/products",
    group: "stock",
    defaultScreen: "suite",
    anchor: "more:products",
  },
  {
    // Setup rather than a daily task, but it belongs with the stock it configures — and it is
    // the crops it names that drive both the reminders and what the recommendation engine is
    // allowed to suggest.
    id: "crops",
    labelKey: "common.cropConfiguration",
    metaKey: "common.configureReminder",
    icon: Wheat,
    path: null,
    group: "stock",
    defaultScreen: "suite",
    anchor: "more:crops",
  },
  {
    id: "notifications",
    labelKey: "settings.notifications",
    icon: Bell,
    path: "/notifications",
    group: "app",
    defaultScreen: "settings",
    anchor: "settings:alerts",
  },
  {
    id: "activity",
    labelKey: "settings.activityLog",
    icon: ClipboardList,
    path: "/activity",
    group: "app",
    defaultScreen: "settings",
    anchor: "settings:activity",
  },
];

export const SUITE_GROUP_KEY: Record<SuiteGroup, I18nKey> = {
  money: "more.groupMoney",
  stock: "more.groupStock",
  people: "more.groupPeople",
  app: "more.groupApp",
};

/** The key the arrangement is remembered under: the account, in the shop it is working in. */
export function useOwnerKey(): string {
  const userId = useAuthStore((s) => s.user?.id ?? "anon");
  const shopId = useShopStore((s) => s.activeShopId ?? "no-shop");
  return `${userId}|${shopId}`;
}

export interface OwnerRows {
  owner: string;
  /** Where this row is right now — the owner's choice, or the row's own default. */
  where: (id: string) => Screen;
  rowsOn: (screen: Screen) => OwnerRow[];
  move: (id: string, screen: Screen) => void;
  reset: () => void;
}

/**
 * Where one row is, given an arrangement. The owner's choice wins; otherwise the row's own
 * default. A row the catalogue does not know still resolves — to the suite, which is the
 * screen it came from — rather than disappearing from both screens at once.
 */
export function whereIs(chosen: Record<string, Screen>, id: string): Screen {
  return chosen[id] ?? OWNER_ROWS.find((r) => r.id === id)?.defaultScreen ?? "suite";
}

/**
 * The rows on one screen, in catalogue order.
 *
 * This is the whole of the "one row per destination" rule: a screen is a *filter* over one
 * catalogue, so a row cannot be listed twice and a row cannot go missing. The two screens each
 * render their own half and neither one holds its own copy of the list.
 */
export function rowsOnScreen(chosen: Record<string, Screen>, screen: Screen): OwnerRow[] {
  return OWNER_ROWS.filter((row) => whereIs(chosen, row.id) === screen);
}

/**
 * The owner's arrangement, read from the store and resolved against the catalogue.
 *
 * `where` is the only thing either screen asks: a row renders wherever this says it is, so the
 * two screens cannot both claim the same row.
 */
export function useOwnerRows(): OwnerRows {
  const owner = useOwnerKey();
  const byOwner = usePlacementStore((s) => s.byOwner);
  const moveRow = usePlacementStore((s) => s.move);
  const resetOwner = usePlacementStore((s) => s.resetOwner);
  const chosen = byOwner[owner] ?? {};

  return {
    owner,
    where: (id) => whereIs(chosen, id),
    rowsOn: (screen) => rowsOnScreen(chosen, screen),
    move: (id, screen) => moveRow(owner, id, screen),
    reset: () => resetOwner(owner),
  };
}
