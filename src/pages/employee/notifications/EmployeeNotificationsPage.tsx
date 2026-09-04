import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
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

type TimeGroup = { label: string; items: AppNotification[] };

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
    .map(([label, items]) => ({ label, items }));
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
        title="Notifications"
        
        right={
          items.some((n) => !n.read) ? (
            <button
              onClick={markAllRead}
              className="text-xs font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              Mark all read
            </button>
          ) : null
        }
      />

      {loading && !ready ? (
        <div className="flex flex-col items-center py-20 gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading…</p>
        </div>
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
              <div className="px-4 pt-5 pb-2">
                <p
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {group.label}
                </p>
              </div>

              <div className="flex flex-col mx-4">
                {group.items.map((n, i) => {
                  const Icon = KIND_ICON[n.kind] ?? Info;
                  const tr = translateNotification(n.kind, n.title, n.body, t);
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        const route = notificationRoute(n);
                        if (route) navigate(route);
                        markAllRead();
                      }}
                      className="flex items-start gap-3 py-4 w-full text-start active:scale-[0.98] transition-transform"
                      style={{
                        borderBottom: i < group.items.length - 1 ? "1px solid var(--divider)" : "none",
                        opacity: n.read ? 0.6 : 1,
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--surface-2)" }}
                      >
                        <Icon size={16} style={{ color: "var(--brand)" }} />
                      </div>
                      <div className="flex-1 min-w-0">
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
                        <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
                          {formatSmartDateTime(n.created_at, now, t)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
