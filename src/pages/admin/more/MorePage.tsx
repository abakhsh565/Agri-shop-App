import { useNavigate } from "react-router-dom";
import {
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  Compass,
  CreditCard,
  Landmark,
  LogOut,
  MessageSquare,
  Package,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  ShoppingCart,
  Truck,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT, type I18nKey } from "@/lib/i18n";
import { useAuthStore } from "@/stores/authStore";
import { hasPermission, isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled } from "@/lib/experience";
import { useShellBase } from "@/lib/useShellBase";

interface MoreRow {
  id: string;
  icon: LucideIcon;
  labelKey: I18nKey;
  to: string;
  show: boolean;
  danger?: boolean;
  state?: { from: string };
  onClick?: () => void;
}

/**
 * The owner's business menu.
 *
 * The fifth tab opens this hub instead of Settings. Settings is configuration and account
 * state; the work of the business is grouped here, one door per area, and every door opens
 * the screen that already owned that area. Nothing on this page is a second implementation.
 */
export default function AdminMorePage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  const logout = useAuthStore((s) => s.logout);

  const isOwner = isCurrentUserOwner();
  const canManagePeople = hasPermission("employees.manage");
  const canSettings = hasPermission("settings.view");
  const canSeeCoOwners = isOwner && coOwnerEnabled();

  const chevron = (
    <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
  );

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  const groups: Array<{ id: string; headingKey: I18nKey; rows: MoreRow[] }> = [
    {
      id: "operations",
      headingKey: "more.group.operations",
      rows: [
        {
          id: "customers",
          icon: Users,
          labelKey: "settings.menu.customers",
          to: `${base}/settings/hub/customers`,
          show: hasPermission("customers.view"),
        },
        {
          id: "purchases",
          icon: Truck,
          labelKey: "more.purchases",
          to: `${base}/settings/hub/purchases`,
          show: hasPermission("purchases.view"),
        },
        {
          id: "suppliers",
          icon: Building2,
          labelKey: "more.suppliers",
          to: `${base}/companies`,
          show: hasPermission("companies.view"),
        },
        {
          id: "finance",
          icon: Landmark,
          labelKey: "settings.menu.finance",
          to: `${base}/settings/hub/finance`,
          show: hasPermission("payments.view"),
        },
        {
          id: "reports",
          icon: ClipboardList,
          labelKey: "admin.reports",
          to: `${base}/reports/directory`,
          state: { from: `${base}/more` },
          show: hasPermission("reports.view"),
        },
        {
          id: "alerts",
          icon: CreditCard,
          labelKey: "more.alerts",
          to: `${base}/alerts/reminders`,
          show: hasPermission("alerts.view"),
        },
        {
          id: "notifications",
          icon: Bell,
          labelKey: "more.notifications",
          to: `${base}/notifications`,
          state: { from: `${base}/more` },
          show: hasPermission("notifications.view"),
        },
        {
          id: "messages",
          icon: MessageSquare,
          labelKey: "admin.messages",
          to: `${base}/messages`,
          state: { from: `${base}/more` },
          show: true,
        },
      ],
    },
    {
      id: "people",
      headingKey: "more.group.people",
      rows: [
        {
          id: "employees",
          icon: Users,
          labelKey: "hub.people.employees",
          to: `${base}/settings/hub/people`,
          show: hasPermission("employees.view"),
        },
        {
          id: "access-requests",
          icon: UserPlus,
          labelKey: "accessRequests.title",
          to: `${base}/employees/requests`,
          show: canManagePeople,
        },
        {
          id: "roles",
          icon: ShieldCheck,
          labelKey: "hub.people.roles",
          to: `${base}/settings/roles`,
          show: canManagePeople,
        },
        {
          id: "co-owners",
          icon: UserCog,
          labelKey: "more.coOwnersAccess",
          to: `${base}/settings/hub/people/co-owners`,
          show: canSeeCoOwners,
        },
        {
          id: "activity",
          icon: ClipboardList,
          labelKey: "hub.people.activity",
          to: `${base}/settings/hub/people/activity`,
          show: hasPermission("activity.view"),
        },
      ],
    },
    {
      id: "business",
      headingKey: "more.group.management",
      rows: [
        {
          id: "branches",
          icon: Building2,
          labelKey: "settings.menu.branches",
          to: `${base}/settings/hub/branches`,
          show: canSettings,
        },
      ],
    },
    {
      id: "account",
      headingKey: "more.group.account",
      rows: [
        {
          id: "profile",
          icon: UserCog,
          labelKey: "more.profile",
          to: `${base}/settings/profile`,
          show: canSettings,
        },
        {
          id: "business-profile",
          icon: Building2,
          labelKey: "settings.menu.businessProfile",
          to: `${base}/settings/business`,
          show: canSettings,
        },
        {
          id: "business-settings",
          icon: Settings,
          labelKey: "admin.settings",
          to: `${base}/settings`,
          show: canSettings,
        },
        {
          id: "security",
          icon: ShieldCheck,
          labelKey: "more.security",
          to: `${base}/settings/security`,
          show: canSettings,
        },
        {
          id: "preferences",
          icon: SlidersHorizontal,
          labelKey: "more.preferences",
          to: `${base}/settings/preferences`,
          show: canSettings,
        },
        {
          id: "guide",
          icon: Compass,
          labelKey: "edu.guide.title",
          to: `${base}/guide`,
          show: true,
        },
        {
          id: "logout",
          icon: LogOut,
          labelKey: "settings.signOut",
          to: "",
          show: true,
          danger: true,
          onClick: signOut,
        },
      ],
    },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="admin-more-page"
    >
      <StatusBar />
      <NavHeader title={t("admin.more")} noBack />
      <p className="px-5 pb-1 text-12" style={{ color: "var(--text-secondary)" }}>
        {t("more.subtitle")}
      </p>

      {groups.map((group) => {
        const rows = group.rows.filter((row) => row.show);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} className="px-4 pt-4" data-testid={`more-group-${group.id}`}>
            <h2 className="ds-section px-1 mb-2">{t(group.headingKey)}</h2>
            <ListCard>
              {rows.map((row) => {
                const Icon = row.icon;
                return (
                  <ListRow
                    key={row.id}
                    icon={Icon}
                    title={t(row.labelKey)}
                    danger={row.danger}
                    testId={`more-row-${row.id}`}
                    onClick={row.onClick ?? (() => navigate(row.to, { state: row.state }))}
                    trailing={row.danger ? undefined : chevron}
                  />
                );
              })}
            </ListCard>
          </section>
        );
      })}

      <div className="h-8" />
    </div>
  );
}
