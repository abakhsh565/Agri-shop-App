import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useT } from "@/lib/i18n";
import { formatSmartDateTime, translateNotification } from "@/lib/formatters";
import { pkDate, pkDateFromISO, pkToday, pkYesterday } from "@/lib/pkDate";
import {
  Bell, ShoppingCart, CreditCard, RotateCcw, Package,
  AlertTriangle, Users, Truck, Info,
} from "lucide-react";

/** Map notification kind + entity_id → the correct admin route */
function notificationRoute(n: AppNotification): string | null {
  if (n.entity_id) {
    switch (n.kind) {
      case "sale": return "/admin/sales/" + n.entity_id;
      case "return": return "/admin/sales/" + n.entity_id;
      case "purchase": return "/admin/purchases/" + n.entity_id;
      case "employee": return "/admin/employees/" + n.entity_id;
      case "low_stock": return "/admin/products/" + n.entity_id;
      case "stock_adjust": return "/admin/products";
      case "payment": return "/admin/payments";
      default: return null;
    }
  }
  switch (n.kind) {
    case "sale": return "/admin/sales";
    case "return": return "/admin/sales";
    case "payment": return "/admin/payments";
    case "purchase": return "/admin/purchases";
    case "low_stock": case "stock_adjust": return "/admin/products";
    case "employee": return "/admin/employees";
    default: return null;
  }
}

const KIND_ICON: Record<string, any> = {
  sale: ShoppingCart,
  payment: CreditCard,
  return: RotateCcw,
  stock_adjust: Package,
  low_stock: AlertTriangle,
  employee: Users,
  purchase: Truck,
  system: Info,
};

/** Group notifications by time period */
type TimeGroup = { label: string; items: AppNotification[] };

function groupByTime(items: AppNotification[], now: Date, t: any): TimeGroup[] {
  const todayStr = pkDate(now);
  const yesterdayStr = pkYesterday();

  const groups: Record<string, AppNotification[]> = {
    [t("notifications.groupToday")]: [],
    [t("notifications.groupYesterday")]: [],
    [t("notifications.groupThisWeek")]: [],
    [t("notifications.groupThisMonth")]: [],
    [t("notifications.groupEarlier")]: [],
  };
  const keys = [t("notifications.groupToday"), t("notifications.groupYesterday"), t("notifications.groupThisWeek"), t("notifications.groupThisMonth"), t("notifications.groupEarlier")];

  for (const n of items) {
    const d = pkDateFromISO(n.created_at);
    if (d === todayStr) groups[keys[0]].push(n);
    else if (d === yesterdayStr) groups[keys[1]].push(n);
    else if (d >= pkDate(new Date(now.getTime() - 7 * 86400000))) groups[keys[2]].push(n);
    else if (d >= pkDate(new Date(now.getFullYear(), now.getMonth(), 1))) groups[keys[3]].push(n);
    else groups[keys[4]].push(n);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export default function AdminNotificationsPage() {
  const navigate = useNavigate();
  const { items, loading, ready, load, subscribe, markAllRead } = useNotificationStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const now = useCurrentTime();

  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  const groups = useMemo(() => groupByTime(items, now, t), [items, now, t]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("notifications.title")}
        
        right={
          items.some((n) => !n.read) ? (
            <button
              onClick={markAllRead}
              className="text-xs font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("notifications.markAllRead")}
            </button>
          ) : null
        }
      />

      {loading && !ready ? (
        <SkeletonList rows={4} tile />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center py-20 gap-3 px-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "var(--surface-2)" }}
          >
            <Bell size={22} style={{ color: "var(--text-secondary)" }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("dashboard.noNotifications")}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("notifications.realTimeNotice")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col pb-8">
          {groups.map((group) => (
            <div key={group.label}>
              {/* Group header */}
              <div className="px-4 pt-5 pb-2">
                <p
                  className="ds-section-label"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {group.label}
                </p>
              </div>

              {/* Items */}
              <ListCard className="mx-4">
                {group.items.map((n) => {
                  const Icon = KIND_ICON[n.kind] ?? Info;
                  const tr = translateNotification(n.kind, n.title, n.body, t);
                  return (
                    <ListRow
                      key={n.id}
                      onClick={() => {
                        const route = notificationRoute(n);
                        if (route) navigate(route);
                        markAllRead();
                      }}
                      style={{ opacity: n.read ? 0.6 : 1 }}
                      tile={
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <Icon size={16} style={{ color: "var(--brand)" }} />
                        </div>
                      }
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                            {tr.title}
                          </p>
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                          )}
                        </div>
                        {tr.body && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{tr.body}</p>
                        )}
                        <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                          {formatSmartDateTime(n.created_at, now, t)}
                        </p>
                      </div>
                    </ListRow>
                  );
                })}
              </ListCard>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
