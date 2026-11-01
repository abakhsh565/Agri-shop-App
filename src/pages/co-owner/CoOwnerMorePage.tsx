import { useNavigate, useOutletContext } from "react-router-dom";
import {
  BarChart3,
  Bell,
  Building2,
  CheckSquare,
  ClipboardList,
  Landmark,
  Package,
  Settings,
  ShoppingBag,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useT, type I18nKey } from "@/lib/i18n";
import type { CoOwnerAccess } from "@/components/layout/CoOwnerLayout";

interface MoreRow {
  labelKey: I18nKey;
  path: string;
  icon: LucideIcon;
  show: boolean;
}

/**
 * A Co-Owner's module hub. It is built from the grant on the layout, not from a tab list, so a
 * destination can only appear when the grant already allows it. It deliberately contains no
 * Co-Owner or employee-access administration: those stay with the Original Owner.
 */
export default function CoOwnerMorePage() {
  const t = useT();
  const navigate = useNavigate();
  const { access } = useOutletContext<{ access: CoOwnerAccess }>();
  const permissions = new Set(access.permissions);

  const groups: Array<{ id: string; headingKey: I18nKey; rows: MoreRow[] }> = [
    {
      id: "operations",
      headingKey: "more.group.operations",
      rows: [
        { labelKey: "nav.sales", path: "/co-owner/sales", icon: ShoppingBag, show: permissions.has("sales.view") },
        { labelKey: "nav.products", path: "/co-owner/products", icon: Package, show: permissions.has("products.view") },
        { labelKey: "nav.customers", path: "/co-owner/customers", icon: Users, show: permissions.has("customers.view") },
        { labelKey: "nav.purchases", path: "/co-owner/purchases", icon: Truck, show: permissions.has("purchases.view") },
        { labelKey: "more.suppliers", path: "/co-owner/companies", icon: Building2, show: permissions.has("companies.view") },
        { labelKey: "settings.menu.finance", path: "/co-owner/finance", icon: Landmark, show: permissions.has("payments.view") },
        { labelKey: "admin.reports", path: "/co-owner/reports", icon: BarChart3, show: permissions.has("reports.view") },
        { labelKey: "more.notifications", path: "/co-owner/notifications", icon: Bell, show: permissions.has("notifications.view") },
      ],
    },
    {
      id: "people",
      headingKey: "more.group.people",
      rows: [
        { labelKey: "nav.team", path: "/co-owner/team", icon: Users, show: permissions.has("employees.view") },
        { labelKey: "accessRequests.title", path: "/co-owner/employees/requests", icon: UserPlus, show: permissions.has("employees.manage") },
        { labelKey: "coOwner.approvalsTitle", path: "/co-owner/approvals", icon: CheckSquare, show: true },
        { labelKey: "settings.activityLog", path: "/co-owner/activity", icon: ClipboardList, show: permissions.has("activity.view") },
      ],
    },
    {
      id: "account",
      headingKey: "more.group.account",
      rows: [
        { labelKey: "coOwner.settingsTitle", path: "/co-owner/settings", icon: Settings, show: true },
      ],
    },
  ];

  return (
    <div className="px-4 pt-3 pb-6" data-testid="co-owner-more">
      <h1 className="text-18 font-bold">{t("admin.more")}</h1>
      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
        {t("more.subtitle")}
      </p>

      {groups.map((group) => {
        const rows = group.rows.filter((row) => row.show);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="mt-4" data-testid={`co-owner-more-group-${group.id}`}>
            <h2 className="ds-section px-1 mb-2">{t(group.headingKey)}</h2>
            <div
              className="rounded-[var(--radius-tile)] overflow-hidden"
              style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
            >
              {rows.map((row) => {
                const Icon = row.icon;
                return (
                  <button
                    key={row.path}
                    type="button"
                    onClick={() => navigate(row.path)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-12 font-semibold text-start"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <Icon size={15} style={{ color: "var(--text-secondary)" }} />
                    <span className="flex-1 min-w-0 truncate">{t(row.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
