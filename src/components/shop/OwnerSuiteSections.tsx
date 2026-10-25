import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  UserCheck,
  ShoppingCart,
  BarChart2,
  CreditCard,
  Settings,
  History,
  AlertTriangle,
  Calculator,
  ScanLine,
  ChevronRight,
  Compass,
  type LucideIcon,
} from "lucide-react";
import BusinessSettingsSheet from "@/components/ui/BusinessSettingsSheet";
import { useOwnerRows, type SuiteGroup } from "@/lib/ownerRows";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";

/**
 * Every row the owner suite offers, grouped by the question it answers.
 *
 * This block used to live inside `MoreMenuPage` — the screen that the bottom bar's More tab
 * opened. The tab is gone (Messages took its place) and the rows now ship on the account screen
 * as well, so the block was extracted rather than copied: two screens render it, and one module
 * decides what is in it. A second copy would drift, which is the exact failure the shared
 * `ownerRows` catalogue was introduced to end.
 *
 * Rows use the same treatment as Settings — `ListCard` + `ListRow` with a plain thin-stroke
 * leading icon at the icon token's size in `--text-secondary`, and the 52px separator inset
 * that icon implies. `labelKey` is typed as `I18nKey`, so a key that does not exist fails
 * `tsc` instead of silently rendering the raw key.
 *
 * Each group holds two kinds of row: the ones that always live here (`rows`) and the ones that
 * come from the shared catalogue and can be moved to Settings (`ownerOrder`). `order` names
 * every id the group can show, in the order it reads in, so a catalogue row takes its place
 * among the fixed ones. An id the group forgot falls to the end rather than vanishing.
 */
const GROUPS: Array<{
  group: SuiteGroup;
  sectionKey: I18nKey;
  rows: MenuRow[];
  /** Every row id this group can show, in reading order. */
  order: string[];
}> = [
  {
    group: "money",
    sectionKey: "more.groupMoney",
    rows: [
      { id: "payments", labelKey: "admin.payments", icon: CreditCard, path: "/payments", anchor: "more:payments" },
      { id: "dailyCash", labelKey: "admin.dailyCash", icon: Calculator, path: "/payments/daily-cash", anchor: "more:dailyCash" },
      { id: "reports", labelKey: "admin.reports", icon: BarChart2, path: "/reports", anchor: "more:reports" },
    ],
    order: ["payments", "dailyCash", "reports"],
  },
  {
    group: "stock",
    sectionKey: "more.groupStock",
    rows: [
      { id: "purchases", labelKey: "admin.purchases", icon: ShoppingCart, path: "/purchases", anchor: "more:purchases" },
      { id: "movements", labelKey: "admin.stockMovements", icon: History, path: "/inventory/movements", anchor: "more:movements" },
      { id: "reorder", labelKey: "admin.reorderSuggestions", icon: AlertTriangle, path: "/inventory/reorder", anchor: "more:reorder" },
      { id: "barcodes", labelKey: "admin.generateBarcodes", icon: ScanLine, path: "/inventory/barcodes", anchor: "more:barcodes" },
    ],
    // Inventory leads the group; Crop configuration is setup, so it follows the daily rows.
    order: ["inventory", "purchases", "movements", "reorder", "barcodes", "crops"],
  },
  {
    group: "people",
    sectionKey: "more.groupPeople",
    // Companies and Employees are catalogue rows (they can be moved to Settings), so they are
    // not repeated here — they arrive through `rowsOn("suite")` with their own group.
    rows: [
      { id: "customers", labelKey: "admin.customers", icon: UserCheck, path: "/customers", anchor: "more:customers" },
    ],
    order: ["customers", "companies", "employees", "roles"],
  },
  {
    group: "app",
    sectionKey: "more.groupApp",
    rows: [
      { id: "guide", labelKey: "edu.guide.title", icon: Compass, path: "/guide", anchor: "more:guide" },
      { id: "settings", labelKey: "admin.settings", icon: Settings, path: "/settings", anchor: "more:settings" },
    ],
    order: ["guide", "settings"],
  },
];

/**
 * Where a row sits inside its group. An id the group's `order` does not name keeps the row
 * visible and puts it after the ones that were named, rather than dropping it.
 */
function rankIn(group: (typeof GROUPS)[number], id: string): number {
  const index = group.order.indexOf(id);
  return index === -1 ? group.order.length : index;
}

/**
 * `anchor` is the guided tour's handle on a row: the real row element carries `data-tour`, so
 * the tour can ring the row itself instead of approximating where it might be.
 */
interface MenuRow {
  id: string;
  labelKey: I18nKey;
  icon: LucideIcon;
  path: string;
  anchor: string;
}

export default function OwnerSuiteSections() {
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();
  // A chevron points along the reading direction, so in RTL the "onward" direction is left.
  const { isRtl } = useDir();
  const { rowsOn } = useOwnerRows();
  // Crop configuration is a sheet, not a screen, so it opens here exactly as it opens from
  // Settings — one sheet, whichever screen the row is currently on.
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      {GROUPS.map((group) => {
        // One list per group: the rows that always live here, plus the catalogue rows that are
        // on this screen right now, sorted into the group's own reading order.
        const entries = [
          ...group.rows.map((row) => ({ kind: "route" as const, ...row })),
          ...rowsOn("suite")
            .filter((row) => row.group === group.group)
            .map((row) => ({
              kind: "owner" as const,
              id: row.id,
              labelKey: row.labelKey,
              icon: row.icon,
              path: row.path,
              anchor: row.anchor,
              metaKey: row.metaKey,
            })),
        ].sort((a, b) => rankIn(group, a.id) - rankIn(group, b.id));

        return (
          <div key={group.sectionKey} className="px-4 pt-4">
            <ListCard section={t(group.sectionKey)}>
              {entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <ListRow
                    key={entry.id}
                    anchor={entry.anchor}
                    icon={Icon}
                    // A catalogue row whose `path` is null opens a sheet rather than a screen —
                    // the same sheet Settings opens, so there is one of it in the app.
                    onClick={() => (entry.path ? navigate(`${base}${entry.path}`) : setSheetOpen(true))}
                    title={t(entry.labelKey)}
                    meta={entry.kind === "owner" && entry.metaKey ? t(entry.metaKey) : undefined}
                    trailing={
                      <ChevronRight
                        size={14}
                        className="ds-row-chevron shrink-0"
                        style={{ color: "var(--text-secondary)", transform: isRtl ? "rotate(180deg)" : undefined }}
                      />
                    }
                  />
                );
              })}
            </ListCard>
          </div>
        );
      })}

      {sheetOpen && <BusinessSettingsSheet onClose={() => setSheetOpen(false)} onSave={() => {}} />}
    </>
  );
}
