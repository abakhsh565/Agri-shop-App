import { useEffect } from "react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useNotificationStore } from "@/stores/notificationStore";
import { useThemeStore } from "@/stores/themeStore";
import {
  Bell, ShoppingCart, CreditCard, RotateCcw, Package,
  AlertTriangle, Users, Truck, Info,
} from "lucide-react";

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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AdminNotificationsPage() {
  const { items, loading, ready, load, subscribe, markAllRead } = useNotificationStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title="Notifications"
        backTo="/admin/dashboard"
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
        <div className="flex flex-col mx-4 mt-2">
          {items.map((n, i) => {
            const Icon = KIND_ICON[n.kind] ?? Info;
            return (
              <div
                key={n.id}
                className="flex items-start gap-3 py-4"
                style={{
                  borderBottom: i < items.length - 1 ? "1px solid var(--divider)" : "none",
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
                    {n.actor_name ? `${n.actor_name} · ` : ""}{timeAgo(n.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
