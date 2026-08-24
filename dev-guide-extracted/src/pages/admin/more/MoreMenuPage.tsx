import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { Package, Building2, Users, ShoppingCart, BarChart2, Layers, CreditCard, Settings } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";

const TILES = [
  { labelKey: "admin.products"  as const, icon: Package,      path: "/admin/products",   color: "#3b82f6" },
  { labelKey: "admin.companies" as const, icon: Building2,    path: "/admin/companies",  color: "#84cc16" },
  { labelKey: "admin.employees" as const, icon: Users,        path: "/admin/employees",  color: "#8b5cf6" },
  { labelKey: "admin.purchases" as const, icon: ShoppingCart, path: "/admin/purchases",  color: "#f59e0b" },
  { labelKey: "admin.reports"   as const, icon: BarChart2,    path: "/admin/reports",    color: "#06b6d4" },
  { labelKey: "admin.inventory" as const, icon: Layers,       path: "/admin/inventory",  color: "#84cc16" },
  { labelKey: "admin.payments"  as const, icon: CreditCard,   path: "/admin/payments",   color: "#10b981" },
  { labelKey: "admin.settings"  as const, icon: Settings,     path: "/admin/settings",   color: "#6b7280" },
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

      {/* Grid */}
      <div className="px-4 pt-4 pb-4 grid grid-cols-2 gap-3">
        {TILES.map(({ labelKey, icon: Icon, path, color }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="flex flex-col items-start gap-3 rounded-[16px] p-4 transition-transform active:scale-[0.97]"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          >
            <div
              className="size-10 rounded-[10px] flex items-center justify-center"
              style={{ background: color + "22" }}
            >
              <Icon size={20} style={{ color }} />
            </div>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t(labelKey)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
