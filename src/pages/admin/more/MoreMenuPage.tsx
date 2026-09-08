import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { Package, Building2, Users, UserCheck, ShoppingCart, BarChart2, Layers, CreditCard, Settings, History, AlertTriangle, Calculator, ScanLine } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";

const TILES = [
  { labelKey: "admin.customers" as const, icon: UserCheck,    path: "/admin/customers",  color: "#3b82f6" },
  { labelKey: "admin.companies" as const, icon: Building2,    path: "/admin/companies",  color: "#84cc16" },
  { labelKey: "admin.employees" as const, icon: Users,        path: "/admin/employees",  color: "#8b5cf6" },
  { labelKey: "admin.purchases" as const, icon: ShoppingCart, path: "/admin/purchases",  color: "#f59e0b" },
  { labelKey: "admin.reports"   as const, icon: BarChart2,    path: "/admin/reports",    color: "#06b6d4" },
  { labelKey: "admin.inventory" as const, icon: Layers,       path: "/admin/products",   color: "#84cc16" },
  { labelKey: "admin.payments"  as const, icon: CreditCard,   path: "/admin/payments",   color: "#10b981" },
  { labelKey: "admin.settings"  as const, icon: Settings,     path: "/admin/settings",   color: "#6b7280" },
  { labelKey: "admin.stockMovements" as any, label: "Stock Movements",  icon: History,       path: "/admin/inventory/movements", color: "#6366f1" },
  { labelKey: "admin.reorderSuggestions" as any, label: "Reorder Suggestions", icon: AlertTriangle, path: "/admin/inventory/reorder",    color: "#d97706" },
  { labelKey: "admin.dailyCash" as any, label: "Daily Cash",       icon: Calculator,    path: "/admin/payments/daily-cash",  color: "#059669" },
  { labelKey: "admin.generateBarcodes" as any, label: "Generate Barcodes", icon: ScanLine,      path: "/admin/inventory/barcodes",   color: "#6366f1" },
];

export default function MoreMenuPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Top card */}
      <div className="px-4 pt-2">
        <div
          className="rounded-[16px] p-5"
          style={{ background: "var(--brand)" }}
        >
          <p className="text-[13px] font-bold" style={{ color: "rgba(0,0,0,0.6)" }}>Main Shop</p>
          <p className="text-[22px] font-bold" style={{ color: "#0a0a0a" }}>{t("admin.ownerSuite")}</p>
          <p className="text-[12px] mt-1" style={{ color: "rgba(0,0,0,0.55)" }}>{t("admin.ownerAccess")}</p>
        </div>
      </div>

      {/* Clean list */}
      <div className="px-4 pt-3 pb-4">
        <div className="rounded-[14px] overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}>
          {TILES.map((tile, idx) => {
            const Icon = tile.icon;
            const displayLabel = "labelKey" in tile ? t(tile.labelKey as any) : (tile as any).label;
            return (
              <button
                key={tile.path}
                onClick={() => navigate(tile.path)}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 transition-opacity active:opacity-70 text-start"
                style={{ borderBottom: idx < TILES.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div
                  className="size-9 rounded-[10px] flex items-center justify-center shrink-0"
                  style={{ background: tile.color + "18" }}
                >
                  <Icon size={18} style={{ color: tile.color }} />
                </div>
                <p className="flex-1 text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>{displayLabel}</p>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
