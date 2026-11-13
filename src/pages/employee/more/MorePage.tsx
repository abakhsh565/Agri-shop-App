import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  Compass,
  Landmark,
  LogOut,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  Users,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useAuthStore } from "@/stores/authStore";
import { useT, type I18nKey } from "@/lib/i18n";
import { hasPermission } from "@/lib/tenantContext";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16", "#3b82f6", "#8b5cf6", "#f59e0b", "#06b6d4", "#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

interface MoreRow {
  id: string;
  labelKey: I18nKey;
  icon: LucideIcon;
  path: string;
  show: boolean;
}

/**
 * The employee's module hub. Every row is a permission decision, not a department name: the
 * same salesperson who can take a payment sees Finance, and the one who cannot never does.
 */
export default function MorePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const t = useT();

  const bg = initBgColor(user?.name ?? "U");
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "U";
  const roleLabel = user?.roleName || user?.jobTitle || t("nav.team");

  const groups: Array<{ id: string; headingKey: I18nKey; rows: MoreRow[] }> = [
    {
      id: "work",
      headingKey: "more.group.work",
      rows: [
        { id: "sales", labelKey: "nav.sales", icon: ShoppingCart, path: "/employee/sales", show: hasPermission("sales.view") },
        { id: "products", labelKey: "nav.products", icon: Package, path: "/employee/products", show: hasPermission("products.view") },
        { id: "stock", labelKey: "admin.inventory", icon: Package, path: "/employee/stock", show: hasPermission("products.view") },
        { id: "customers", labelKey: "nav.customers", icon: Users, path: "/employee/customers", show: hasPermission("customers.view") },
        { id: "purchases", labelKey: "nav.purchases", icon: Truck, path: "/employee/purchases", show: hasPermission("purchases.view") },
        { id: "suppliers", labelKey: "more.suppliers", icon: Building2, path: "/employee/companies", show: hasPermission("companies.view") },
        { id: "finance", labelKey: "settings.menu.finance", icon: Landmark, path: "/employee/finance", show: hasPermission("payments.view") },
        { id: "reports", labelKey: "reports.mine", icon: BarChart3, path: "/employee/reports", show: hasPermission("reports.view") || hasPermission("sales.view") || hasPermission("products.view") || hasPermission("customers.view") },
        { id: "team", labelKey: "nav.team", icon: UsersRound, path: "/employee/team", show: hasPermission("employees.view") },
      ],
    },
    {
      id: "account",
      headingKey: "more.group.account",
      rows: [
        { id: "notifications", labelKey: "more.notifications", icon: Bell, path: "/employee/notifications", show: true },
        { id: "activity", labelKey: "settings.activityLog", icon: ClipboardList, path: "/employee/activity", show: hasPermission("activity.view") },
        { id: "settings", labelKey: "settings.title", icon: Settings, path: "/employee/settings", show: true },
        { id: "guide", labelKey: "edu.guide.title", icon: Compass, path: "/employee/guide", show: true },
      ],
    },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-more-page"
    >
      <StatusBar />
      <NavHeader title={t("admin.more")} noBack />

      <div className="px-4 pb-2">
        <div className="rounded-[var(--radius-card)] p-4 flex items-center gap-3" style={{ background: "var(--tone-card)" }}>
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: bg, color: "#fff" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-base font-bold truncate">{user?.name}</p>
              {roleLabel && (
                <span
                  className="text-10 font-bold px-2 py-0.5 rounded-full shrink-0 truncate max-w-[45%]"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  {roleLabel}
                </span>
              )}
            </div>
            <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{user?.phone}</p>
          </div>
        </div>
      </div>

      {groups.map((group) => {
        const rows = group.rows.filter((row) => row.show);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="px-4 pt-3" data-testid={`employee-more-group-${group.id}`}>
            <h2 className="ds-section px-1 mb-2">{t(group.headingKey)}</h2>
            <ListCard>
              {rows.map((row) => {
                const Icon = row.icon;
                return (
                  <ListRow
                    key={row.id}
                    icon={Icon}
                    title={t(row.labelKey)}
                    testId={`employee-more-row-${row.id}`}
                    onClick={() => navigate(row.path)}
                  />
                );
              })}
            </ListCard>
          </section>
        );
      })}

      <div className="px-4 pt-3 pb-8">
        <ListCard>
          <ListRow
            danger
            icon={LogOut}
            title={t("settings.signOut")}
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
          />
        </ListCard>
      </div>
    </div>
  );
}
