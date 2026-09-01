import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { formatSmartDateTime } from "@/lib/formatters";
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

function groupByTime(items: AppNotification[], now: Date): TimeGroup[] {
  const today = now.toISOString().split("T")[0];
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().split("T")[0];
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(now);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const groups: Record<string, AppNotification[]> = {
    "Today": [],
    "Yesterday": [],
    "This Week": [],
    "This Month": [],
    "Earlier": [],
  };

  for (const n of items) {
    const d = n.created_at.split("T")[0];
    const dt = new Date(n.created_at);
    if (d === today) groups["Today"].push(n);
    else if (d === yesterday) groups["Yesterday"].push(n);
    else if (dt >= weekAgo) groups["This Week"].push(n);
    else if (dt >= monthAgo) groups["This Month"].push(n);
    else groups["Earlier"].push(n);
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
  const now = useCurrentTime();

  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  const groups = useMemo(() => groupByTime(items, now), [items, now]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
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
            No notifications yet
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            New sales, payments, and stock changes will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="flex flex-col pb-8">
          {groups.map((group) => (
            <div key={group.label}>
              {/* Group header */}
              <div className="px-4 pt-5 pb-2">
                <p
                  className="text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {group.label}
                </p>
              </div>

              {/* Items */}
              <div className="flex flex-col mx-4">
                {group.items.map((n, i) => {
                  const Icon = KIND_ICON[n.kind] ?? Info;
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
                            {n.title}
                          </p>
                          {!n.read && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                          )}
                        </div>
                        {n.body && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</p>
                        )}
                        <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
                          {formatSmartDateTime(n.created_at, now)}
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
