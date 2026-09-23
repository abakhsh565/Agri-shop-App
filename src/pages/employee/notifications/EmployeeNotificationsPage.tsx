import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useT } from "@/lib/i18n";
import { formatSmartDateTime, translateNotification } from "@/lib/formatters";
import { pkDate, pkDateFromISO, pkToday, pkYesterday } from "@/lib/pkDate";
import {
  Bell, ShoppingCart, CreditCard, RotateCcw, Package,
  AlertTriangle, Info,
} from "lucide-react";

/** Map notification kind to employee route */
function notificationRoute(n: AppNotification): string | null {
  if (n.entity_id) {
    switch (n.kind) {
      case "sale": return "/employee/sales/" + n.entity_id;
      case "return": return "/employee/sales/" + n.entity_id;
      case "payment": return "/employee/sales";
      case "low_stock": return "/employee/products";
      case "stock_adjust": return "/employee/products";
      default: return null;
    }
  }
  switch (n.kind) {
    case "sale": case "return": case "payment": return "/employee/sales";
    case "low_stock": case "stock_adjust": return "/employee/products";
    default: return null;
  }
}

const KIND_ICON: Record<string, any> = {
  sale: ShoppingCart,
  payment: CreditCard,
  return: RotateCcw,
  stock_adjust: Package,
  low_stock: AlertTriangle,
};

type TimeGroup = { key: string; labelKey: string; items: AppNotification[] };

/** Bucket -> i18n key. The bucket name stays stable for grouping; only the
 *  rendered label is translated (it was hardcoded English before). */
const GROUP_KEYS: Record<string, string> = {
  Today: "sales.today",
  Yesterday: "sales.yesterday",
  "This Week": "sales.thisWeek",
  "This Month": "sales.thisMonth",
  Earlier: "notifications.earlier",
};

function groupByTime(items: AppNotification[], now: Date): TimeGroup[] {
  const todayStr = pkDate(now);
  const yesterdayStr = pkYesterday();

  const groups: Record<string, AppNotification[]> = {
    "Today": [],
    "Yesterday": [],
    "This Week": [],
    "This Month": [],
    "Earlier": [],
  };

  for (const n of items) {
    const d = pkDateFromISO(n.created_at);
    if (d === todayStr) groups["Today"].push(n);
    else if (d === yesterdayStr) groups["Yesterday"].push(n);
    else if (d >= pkDate(new Date(now.getTime() - 7 * 86400000))) groups["This Week"].push(n);
    else if (d >= pkDate(new Date(now.getFullYear(), now.getMonth(), 1))) groups["This Month"].push(n);
    else groups["Earlier"].push(n);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => ({ key, labelKey: GROUP_KEYS[key] ?? key, items }));
}

export default function EmployeeNotificationsPage() {
  const navigate = useNavigate();
  const t = useT();
  const { items, loading, ready, load, subscribe, markAllRead } = useNotificationStore();
  const now = useCurrentTime();

  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  const groups = useMemo(() => groupByTime(items, now), [items, now]);

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader
        title={t("dashboard.notifications")}
        
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
            <div key={group.key}>
              <div className="px-4 pt-5 pb-2">
                <p
                  className="ds-section-label"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t(group.labelKey)}
                </p>
              </div>

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
