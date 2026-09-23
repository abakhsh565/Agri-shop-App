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
const MENU: Array<{ labelKey: I18nKey; icon: LucideIcon; path: string }> = [
  { labelKey: "admin.customers", icon: UserCheck, path: "/customers" },
  { labelKey: "admin.companies", icon: Building2, path: "/companies" },
  { labelKey: "admin.employees", icon: Users, path: "/employees" },
  { labelKey: "admin.purchases", icon: ShoppingCart, path: "/purchases" },
  { labelKey: "admin.reports", icon: BarChart2, path: "/reports" },
  { labelKey: "admin.inventory", icon: Layers, path: "/products" },
  { labelKey: "admin.payments", icon: CreditCard, path: "/payments" },
  { labelKey: "admin.settings", icon: Settings, path: "/settings" },
  { labelKey: "admin.stockMovements", icon: History, path: "/inventory/movements" },
  { labelKey: "admin.reorderSuggestions", icon: AlertTriangle, path: "/inventory/reorder" },
  { labelKey: "admin.dailyCash", icon: Calculator, path: "/payments/daily-cash" },
  { labelKey: "admin.generateBarcodes", icon: ScanLine, path: "/inventory/barcodes" },
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

      {/* Top card */}
      <div className="px-4 pt-2">
        <div className="rounded-[var(--radius-card)] p-5" style={{ background: "var(--brand)" }}>
          <p className="text-13 font-bold" style={{ color: "rgba(0,0,0,0.6)" }}>
            {t("admin.mainShop")}
          </p>
          <p className="text-22 font-bold" style={{ color: "#0a0a0a" }}>
            {t("admin.ownerSuite")}
          </p>
          <p className="text-12 mt-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.ownerAccess")}
          </p>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4">
        <ListCard>
          {MENU.map(({ labelKey, icon, path }) => (
            <ListRow
              key={path}
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
    </div>
  );
}
