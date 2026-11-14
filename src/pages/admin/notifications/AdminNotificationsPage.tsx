import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import BranchKindChip from "@/components/ui/BranchKindChip";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useShopStore } from "@/stores/shopStore";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { formatSmartDateTime, translateNotification } from "@/lib/formatters";
import { pkDate, pkDateFromISO, pkToday, pkYesterday } from "@/lib/pkDate";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import {
  Bell, ShoppingCart, CreditCard, RotateCcw, Package,
  AlertTriangle, Users, Truck, Info,
} from "lucide-react";

/** Map notification kind + entity_id → the correct route in the active shell. */
function notificationRoute(n: AppNotification, base: "/admin" | "/employee" | "/co-owner"): string | null {
  const team = base === "/co-owner" ? `${base}/team` : `${base}/employees`;
  if (n.entity_id) {
    switch (n.kind) {
      case "sale": return `${base}/sales/${n.entity_id}`;
      case "return": return `${base}/sales/${n.entity_id}`;
      case "purchase": return `${base}/purchases/${n.entity_id}`;
      case "employee": return `${team}/${n.entity_id}`;
      case "low_stock": return `${base}/products/${n.entity_id}`;
      case "stock_adjust": return `${base}/products`;
      case "payment": return base === "/co-owner" ? `${base}/customers` : `${base}/payments`;
      default: return null;
    }
  }
  switch (n.kind) {
    case "sale": return `${base}/sales`;
    case "return": return `${base}/sales`;
    case "payment": return base === "/co-owner" ? `${base}/customers` : `${base}/payments`;
    case "purchase": return `${base}/purchases`;
    case "low_stock": case "stock_adjust": return `${base}/products`;
    case "employee": return team;
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
  const base = useShellBase();
  // More and the dashboard both open this screen; direct links fall back to More. The named
  // parent matters because `/notifications` is a two-segment path and has no history frame.
  const returnTo = useReturnTo(`${base}/more`);
  const { items, loading, ready, load, subscribe, markAllRead, markManyRead, forBranch, unreadInBranch } =
    useNotificationStore();
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
  // THE BRANCH YOU ARE STANDING IN DECIDES WHAT THIS SCREEN MAY SHOW (owner's rule,
  // 2026-10-30):
  //
  //   • in an ADDED branch, only that branch's events. Nothing from the main branch leaks in —
  //     an owner who moved to Malik's branch is looking at Malik's shop, not at the business.
  //   • on the MAIN branch, every branch's events, because the main branch IS the business. Each
  //     row that came from another branch names it, so a sale in Malik's shop is never mistaken
  //     for one here. The tabs are the branches themselves — main first — and picking one narrows
  //     the same list to it.
  //
  // Rows the database never attributed to a branch (`branch_id IS NULL`: written before 0197, or
  // about a party rather than a branch) are business-wide facts. They belong to the main view and
  // to no branch tab, so a sub-branch never borrows them.
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const accountRole = useAuthStore((s) => s.user?.role);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const mainBranch = branches.find((b) => b.isMain) ?? null;
  /** Standing in an added branch: this screen must not read the rest of the business. */
  const inSubBranch = !!activeBranch && !activeBranch.isMain;

  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  /** `"all"` (the main branch's view) or a branch id. Picked when the tabs are on screen. */
  const [tab, setTab] = useState<string>("all");

  const showTabs = accountRole === "admin" && !inSubBranch && branches.length > 1;
  const activeTab: string = showTabs ? tab : "all";
  /** The main view: every branch, each row labelled. */
  const isAllView = !inSubBranch && activeTab === "all";

  // The branch id, not the business id. These were compared against `shop_id`, which is the
  // id of the whole business: two different id spaces never meet, so every branch tab was
  // empty and told the owner the branch was quiet while the rows were on the next tab over.
  const shown = useMemo(() => {
    if (inSubBranch && activeBranch) {
      return items.filter((n) => n.branch_id === activeBranch.id);
    }
    return activeTab === "all" ? items : forBranch(activeTab);
  }, [items, inSubBranch, activeBranch, activeTab, forBranch]);

  /** The branch a row happened in, named — the all-branches view has to say which one. */
  const branchName = (n: AppNotification) =>
    n.branch_id ? branches.find((b) => b.id === n.branch_id)?.name ?? null : null;

  const groups = useMemo(() => groupByTime(shown, now, t), [shown, now, t]);

  const tabBranch = isAllView
    ? null
    : inSubBranch
      ? activeBranch
      : branches.find((b) => b.id === activeTab) ?? null;
  const unreadShown = shown.filter((n) => !n.read);

  // A branch that was deleted while this screen was open must not leave the screen on a tab
  // that no longer exists — the filter would go on returning nothing with no way to see why.
  useEffect(() => {
    if (showTabs && activeTab !== "all" && !branches.some((b) => b.id === activeTab)) setTab("all");
  }, [branches, activeTab, showTabs]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("notifications.title")}
        backTo={returnTo}
        right={
          unreadShown.length > 0 ? (
            <button
              // Marking read applies to what is ON SCREEN. With a branch selected that is
              // that branch; on the all-branches tab it is everything, which is what it
              // always did.
              onClick={() => (isAllView ? markAllRead() : markManyRead(unreadShown.map((n) => n.id)))}
              data-testid="notifications-mark-read"
              className="text-xs font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("notifications.markAllRead")}
            </button>
          ) : null
        }
      />

      {/* In an added branch there are no tabs — the screen is that branch — so it says which
          branch, once, where the tabs would have been. Without this the list would look like the
          whole business with half its rows missing. */}
      {inSubBranch && activeBranch && (
        <div className="flex items-center gap-2 px-4 pt-2 pb-1" data-testid="notifications-current-branch">
          <span className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {activeBranch.name}
          </span>
          {branchKind(t, activeBranch.isMain) && (
            <BranchKindChip isMain={activeBranch.isMain} label={branchKind(t, activeBranch.isMain)!} />
          )}
        </div>
      )}

      {/* The branches, main first, with the number still unread in each — the single fact that
          tells the owner which branch to open. The main tab is the whole business; picking a sub
          branch narrows the same list to that branch. Horizontally scrollable because a second
          branch should not squash the first, and the strip is the app's own pill shape. */}
      {showTabs && (
        <div
          className="flex gap-2 px-4 pt-1 pb-1 overflow-x-auto"
          role="tablist"
          aria-label={t("notifications.tabsLabel")}
          data-testid="notifications-branch-tabs"
        >
          {[
            {
              id: "all",
              // Named after the branch it belongs to, not "All branches": on the main branch the
              // business and its branch are the same thing, and the tab reads like the heading
              // the owner asked for — Main first, then the branches they added.
              name: mainBranch?.name ?? t("notifications.allBranches"),
              kind: mainBranch ? branchKind(t, true) : null as string | null,
            },
            ...branches
              .filter((b) => b.id !== mainBranch?.id)
              .map((b) => ({ id: b.id, name: b.name, kind: branchKind(t, b.isMain) })),
          ]
            .map((entry) => {
              const selected = entry.id === activeTab;
              // Counted from the WHOLE set, not from the tab on screen: the point of the
              // number is to point at a branch you are not looking at.
              const unreadHere = entry.id === "all"
                ? items.filter((n) => !n.read).length
                : unreadInBranch(entry.id);
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
                  {entry.kind && (
                    <span className="text-10 font-semibold shrink-0" style={{ opacity: 0.7 }}>{entry.kind}</span>
                  )}
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
                      // The row's own id, so a test can ask which rows a tab is showing without
                      // depending on the words inside them — which are translated.
                      testId={`notification-${n.id}`}
                      onClick={() => {
                        const route = notificationRoute(n, base);
                        if (route) navigate(route);
                        markAllRead();
                      }}
                      style={{ opacity: n.read ? 0.72 : 1 }}
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
                          <p className="text-13 mt-1 leading-snug" style={{ color: "var(--text-primary)" }}>{tr.body}</p>
                        )}
                        <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
                          {/* On the main view the branch is the one fact the row is missing, so a
                              row from ANOTHER branch names it here and nowhere else. The main
                              branch's own rows need no label — they are the context — and rows
                              the database never attributed say nothing rather than a guess. */}
                          {isAllView && n.branch_id !== mainBranch?.id && branchName(n)
                            ? `${branchName(n)} · ${formatSmartDateTime(n.created_at, now, t)}`
                            : formatSmartDateTime(n.created_at, now, t)}
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
