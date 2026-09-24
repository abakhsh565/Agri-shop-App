import { useNavigate } from "react-router-dom";
import {
  Package,
  Building2,
  Users,
  UserCheck,
  ShoppingCart,
  BarChart2,
  Layers,
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
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";

/**
 * The owner suite menu.
 *
 * Rows use the same treatment as Settings — `ListCard` + `ListRow` with a plain thin-stroke
 * leading icon at the icon token's size in `--text-secondary`, and the 52px separator inset
 * that icon implies. They previously carried a per-row coloured square tile, which was the
 * one place in the app that read as a different visual language: the reference uses a
 * coloured tile only for an entity that has a *logo to show*, never as decoration for a
 * navigation row. Matching Settings also means `--icon` now governs these glyphs.
 *
 * `labelKey` is typed as `I18nKey`, so a key that does not exist fails `tsc` instead of
 * silently rendering the raw key; the hardcoded English `label:` fallbacks this file used to
 * carry are gone, since every entry resolves through the dictionary in both languages.
 */
/**
 * `anchor` is the guided tour's handle on this row: the real row element carries
 * `data-tour`, so the tour can ring the row itself instead of approximating where
 * it might be. Additive — it changes nothing about how a row looks or behaves.
 */
interface MenuRow {
  labelKey: I18nKey;
  icon: LucideIcon;
  path: string;
  anchor: string;
}

/**
 * The same twelve rows, grouped by the question they answer.
 *
 * One flat list of twelve was a wall the eye had to read top to bottom to find anything, and
 * the order was the order the features were built in, not the order a shopkeeper thinks in.
 * Each group now carries a title and holds the rows that belong under it:
 *
 *   • **Money** — what came in, what was paid out, what it earned.
 *   • **Stock** — what is on the shelf, how it got there, what to buy next.
 *   • **People** — who buys from you and who sells to you.
 *   • **App** — the guide and the settings.
 *
 * Within a group the rows stay in the order they are used most. Nothing else changed: same
 * labels, same icons, same routes, and every row keeps the `data-tour` anchor the guided tour
 * rings it by.
 */
const GROUPS: Array<{ sectionKey: I18nKey; rows: MenuRow[] }> = [
  {
    sectionKey: "more.groupMoney",
    rows: [
      { labelKey: "admin.payments", icon: CreditCard, path: "/payments", anchor: "more:payments" },
      { labelKey: "admin.dailyCash", icon: Calculator, path: "/payments/daily-cash", anchor: "more:dailyCash" },
      { labelKey: "admin.reports", icon: BarChart2, path: "/reports", anchor: "more:reports" },
    ],
  },
  {
    sectionKey: "more.groupStock",
    rows: [
      { labelKey: "admin.inventory", icon: Layers, path: "/products", anchor: "more:products" },
      { labelKey: "admin.purchases", icon: ShoppingCart, path: "/purchases", anchor: "more:purchases" },
      { labelKey: "admin.stockMovements", icon: History, path: "/inventory/movements", anchor: "more:movements" },
      { labelKey: "admin.reorderSuggestions", icon: AlertTriangle, path: "/inventory/reorder", anchor: "more:reorder" },
      { labelKey: "admin.generateBarcodes", icon: ScanLine, path: "/inventory/barcodes", anchor: "more:barcodes" },
    ],
  },
  {
    sectionKey: "more.groupPeople",
    rows: [
      { labelKey: "admin.customers", icon: UserCheck, path: "/customers", anchor: "more:customers" },
      { labelKey: "admin.companies", icon: Building2, path: "/companies", anchor: "more:companies" },
      { labelKey: "admin.employees", icon: Users, path: "/employees", anchor: "more:employees" },
    ],
  },
  {
    sectionKey: "more.groupApp",
    rows: [
      { labelKey: "edu.guide.title", icon: Compass, path: "/guide", anchor: "more:guide" },
      { labelKey: "admin.settings", icon: Settings, path: "/settings", anchor: "more:settings" },
    ],
  },
];

export default function MoreMenuPage() {
  const navigate = useNavigate();
  const t = useT();
  const base = useShellBase();
  // A chevron points along the reading direction, so in RTL the "onward" direction is
  // left. Mirrored by rotation, which is the pattern this app already uses elsewhere
  // (GroupDetailPage) rather than a second convention.
  const { isRtl } = useDir();

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />

      {/* Top card.
          Three lines with a real hierarchy instead of two loud ones: 12 overline, 18 title, 12
          subtitle. The title was 22 with 13 above it, which put two heavy lines back to back
          and made the card shout over the four group titles below it; 18 keeps it the loudest
          thing on the screen while leaving room for those. Padding 16 rather than 20 and a
          hair more gap after the card, so the groups below get the air instead. */}
      <div className="px-4 pt-3">
        <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--brand)" }}>
          <p className="text-12 font-bold" style={{ color: "rgba(0,0,0,0.6)" }}>
            {t("admin.mainShop")}
          </p>
          <p className="text-18 font-bold mt-0.5" style={{ color: "#0a0a0a" }}>
            {t("admin.ownerSuite")}
          </p>
          <p className="text-12 mt-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.ownerAccess")}
          </p>
        </div>
      </div>

      {/* One titled card per group. The card title is the same section label the rest of the
          app uses above a list, so a group of rows here reads exactly like a group of rows
          anywhere else. */}
      {GROUPS.map((group) => (
        <div key={group.sectionKey} className="px-4 pt-4">
          <ListCard section={t(group.sectionKey)}>
            {group.rows.map(({ labelKey, icon, path, anchor }) => (
              <ListRow
                key={path}
                anchor={anchor}
                icon={icon}
                onClick={() => navigate(`${base}${path}`)}
                title={t(labelKey)}
                trailing={
                  <ChevronRight
                    size={14}
                    className="ds-row-chevron shrink-0"
                    style={{
                      color: "var(--text-secondary)",
                      transform: isRtl ? "rotate(180deg)" : undefined,
                    }}
                  />
                }
              />
            ))}
          </ListCard>
        </div>
      ))}

      <div className="pb-4" />
    </div>
  );
}
