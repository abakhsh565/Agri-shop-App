import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
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
  const { items, loading, ready, load, subscribe, markAllRead, markManyRead } = useNotificationStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const now = useCurrentTime();

  useEffect(() => {
    load();
    const unsub = subscribe();
    return unsub;
  }, []);

  // ── Which branch am I reading? ────────────────────────────────────────────────
  // An account that runs more than one branch is told about all of them here, because
  // this is the screen whose job is "everything that happened". It is also the only place
  // that can say so: Home is about the branch you are standing in, and its bell counts
  // that branch alone. With a single branch there is nothing to categorise, so the tabs are
  // not drawn at all and the screen reads exactly as it always has.
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const accountRole = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  /** `"all"` or a branch id. Picked when the multi-branch case is on screen. */
  const [tab, setTab] = useState<string>("all");

  const showTabs = accountRole === "admin" && branches.length > 1;
  const activeTab: string = showTabs ? tab : "all";

  const shown = useMemo(
    () => (activeTab === "all" ? items : items.filter((n) => n.shop_id === activeTab)),
    [items, activeTab],
  );

  const groups = useMemo(() => groupByTime(shown, now, t), [shown, now, t]);

  const tabBranch = activeTab === "all" ? null : branches.find((b) => b.id === activeTab) ?? null;
  const unreadShown = shown.filter((n) => !n.read);

  // A branch that was deleted while this screen was open must not leave the screen on a tab
  // that no longer exists — the filter would go on returning nothing with no way to see why.
  useEffect(() => {
    if (activeTab !== "all" && !branches.some((b) => b.id === activeTab)) setTab("all");
  }, [branches, activeTab]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("notifications.title")}
        
        right={
          unreadShown.length > 0 ? (
            <button
              // Marking read applies to what is ON SCREEN. With a branch selected that is
              // that branch; on the all-branches tab it is everything, which is what it
              // always did.
              onClick={() => (activeTab === "all" ? markAllRead() : markManyRead(unreadShown.map((n) => n.id)))}
              className="text-xs font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("notifications.markAllRead")}
            </button>
          ) : null
        }
      />

      {/* One tab per branch, main first, with the number still unread in each — the single
          fact that tells the owner which branch to open. Horizontally scrollable because a
          second branch should not squash the first, and the strip is the app's own pill
          shape rather than a new control. */}
      {showTabs && (
        <div
          className="flex gap-2 px-4 pt-1 pb-1 overflow-x-auto"
          role="tablist"
          aria-label={t("notifications.tabsLabel")}
          data-testid="notifications-branch-tabs"
        >
          {[{ id: "all", name: t("notifications.allBranches") }, ...branches.map((b) => ({ id: b.id, name: b.name }))]
            .map((entry) => {
              const selected = entry.id === activeTab;
              // Counted from the WHOLE set, not from the tab on screen: the point of the
              // number is to point at a branch you are not looking at.
              const unreadHere = items.filter(
                (n) => !n.read && (entry.id === "all" || n.shop_id === entry.id),
              ).length;
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(entry.id)}
                  data-testid={`notifications-tab-${entry.id}`}
                  className="h-8 px-3.5 rounded-full text-12 font-bold shrink-0 flex items-center gap-1.5 ds-pressable"
                  style={{
                    background: selected ? "var(--brand)" : "var(--surface-2)",
                    color: selected ? "#0a0a0a" : "var(--text-secondary)",
                  }}
                >
                  <span className="max-w-[140px] truncate">{entry.name}</span>
                  {unreadHere > 0 && (
                    <span
                      className="text-10 font-bold rounded-full px-1.5"
                      // On the picked pill both the pill and the badge are brand, so the
                      // badge is a dimmer cut of the same colour instead of a second accent.
                      style={{
                        background: selected ? "rgba(0,0,0,0.18)" : "var(--brand)",
                        color: "#0a0a0a",
                      }}
                    >
                      {unreadHere}
                    </span>
                  )}
                </button>
              );
            })}
        </div>
      )}

      {loading && !ready ? (
        <SkeletonList rows={4} tile />
      ) : shown.length === 0 ? (
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
          {/* On a branch tab, "nothing here" is a different sentence from "nothing at all":
              the other branches may be busy, and this one may simply be new. */}
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {tabBranch
              ? t("notifications.branchEmpty", { branch: tabBranch.name })
              : t("notifications.realTimeNotice")}
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
