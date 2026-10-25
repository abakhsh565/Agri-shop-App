import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useNotificationStore, type AppNotification } from "@/stores/notificationStore";
import { useThemeStore } from "@/stores/themeStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import PullToRefresh from "@/components/ui/PullToRefresh";
import SetupChecklist from "@/components/ui/SetupChecklist";
import { useCustomersStore } from "@/stores/customersStore";
import { useShopStore } from "@/stores/shopStore";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { generateReminders, calculatePaymentStatus, loadBusinessSettings } from "@/lib/reminderEngine";
import { computeOverdueCreditTotal } from "@/lib/signalEngine";
import { summariseSales, profitDisplay } from "@/lib/profit";
import { summariseMoneyIn, loadCreditPayments, type CreditPaymentRow } from "@/lib/money";
import { useT } from "@/lib/i18n";
import { branchContextLabel } from "@/lib/branchContext";
import { AlertTriangle, TrendingUp, ChevronRight, ChevronDown, TrendingDown, ShoppingCart, Search, Bell, Wallet, CheckCircle2, HandCoins, PackagePlus, Store } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";

function initBgColor(name: string | null | undefined) {
  const safeName = String(name ?? '');
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of safeName) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

/** Map admin notification kind + entity_id → the specific detail page, not a list */
function adminNotifRoute(n: AppNotification): string | null {
  // When entity_id exists → always go to the specific record
  if (n.entity_id) {
    switch (n.kind) {
      case "sale": return "/admin/sales/" + n.entity_id;
      case "return": return "/admin/sales/" + n.entity_id; // return links to original sale
      case "purchase": return "/admin/purchases/" + n.entity_id;
      case "employee": return "/admin/employees/" + n.entity_id;
      case "low_stock": return "/admin/products/" + n.entity_id; // low-stock product detail
      case "stock_adjust": return "/admin/products";
      case "payment": return "/admin/payments"; // no individual payment detail
      default: return null;
    }
  }
  // No entity_id → fall back to the relevant list page
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

type DateFilter = "all" | "today" | "yesterday" | "this_week" | "this_month";

function formatRs(n: number) {
  return "Rs. " + Math.round(n).toLocaleString("en-PK");
}



export default function AdminDashboardPage() {
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const navigate = useNavigate();
  const t = useT();
  const isUrdu = language === "ur";
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [showNotifs, setShowNotifs] = useState(false);
  const { items: allNotifications, unread, load, subscribe, markAllRead, markOneRead, ready: notificationsReady } = useNotificationStore();
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const salesReady = useSalesStore((s) => s.ready);
  const listsReady = salesReady && customersReady;
  const [allReturns, setAllReturns] = useState<{ amount: number; createdAt: string }[]>([]);
  // The udhaar payments, raw rows, so the date pill can filter them without a second query.
  // Loaded through `@/lib/money` so Reports reads the same table exactly the same way.
  const [creditPayments, setCreditPayments] = useState<CreditPaymentRow[]>([]);

  const workingBranchId = useShopStore((s) => s.activeBranchId);
  const switchingBranch = useShopStore((s) => s.switching);
  // Fetch returns + the payments — store raw rows so we can filter by date range
  useEffect(() => {
    let cancelled = false;
    setAllReturns([]); setCreditPayments([]);
    if (!workingBranchId || switchingBranch) return;
    async function fetchReturns() {
      try {
        const { data } = await supabase.from("returns").select("total_refund, created_at");
        if (data && !cancelled) {
          setAllReturns(data.map((r: any) => ({
            amount: Number(r.total_refund || 0),
            createdAt: r.created_at || "",
          })));
        }
      } catch {}
    }
    fetchReturns();
    loadCreditPayments().then((rows) => { if (!cancelled) setCreditPayments(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [workingBranchId, switchingBranch]);

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  const now = useCurrentTime();
  const today = now;
  const activeShopName = useShopStore((s) => s.activeShopName);
  const activeShopId = useShopStore((s) => s.activeShopId);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const displayName = user?.name ?? t("common.owner");
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";
  const todayLabel = today.toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", {
    weekday: "long", day: "numeric", month: "long",
  });

  /**
   * The header is the branch it is describing.
   *
   * The account's OWN branch (the main one it registered with) reads as the person:
   * their name, their photo, and the branch they are in named quietly below. A branch the
   * account ADDED reads as that branch: a branch mark instead of a face, the branch's own
   * name as the loud line, and the fact an owner actually needs about it — how many people
   * work here and how much is on the shelf.
   *
   * Which of the two it is comes from the server (`is_main` on the branch), never from a
   * guess about names. Until the branches have been read the header stays with the person:
   * showing branch chrome and then replacing it would make the screen jump on every open.
   */
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const inAddedBranch = branchesLoaded && !!activeBranch && !activeBranch.isMain;
  // The same sentence the Branches screen puts on a row, from the same derivation.
  const branchContext = activeBranch ? branchContextLabel(t, activeBranch) : null;

  // One read for the whole header, once per session, and only when there is more than one
  // branch to be in: with a single branch the answer is already on screen.
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  /**
   * Home reads ONE branch.
   *
   * The store keeps every branch's events (an owner has to be able to open the
   * Notifications screen and see them all), but this screen is about the branch you are
   * standing in — its sales, its staff, its bell. Mixing two branches into this list is
   * how a figure from Branch A ends up explained by an event from Branch B.
   */
  const notifications = useMemo(
    () => allNotifications.filter((n) => !activeShopId || n.shop_id === activeShopId),
    [allNotifications, activeShopId],
  );

  // Date helpers — use Pakistan local time (Asia/Karachi, UTC+5) for all date comparisons.
  // en-CA locale produces YYYY-MM-DD format.
  const PKT = "Asia/Karachi";
  function pkDate(date: Date): string {
    return date.toLocaleDateString("en-CA", { timeZone: PKT });
  }
  function pkDateFromISO(isoStr: string): string {
    return pkDate(new Date(isoStr));
  }

  const todayStr = pkDate(today);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(today.getDate() - 1);
  const yesterdayStr = pkDate(yesterdayDate);

  function inFilter(s: (typeof mockSales)[0]) {
    return dateInRange(s.createdAt);
  }

  // Generic date-range check — extracts Pakistan local date from any ISO string
  function dateInRange(isoStr: string): boolean {
    if (dateFilter === "all") return true;
    const d = pkDateFromISO(isoStr);
    if (dateFilter === "today") return d === todayStr;
    if (dateFilter === "yesterday") return d === yesterdayStr;
    if (dateFilter === "this_week") {
      // Get Sunday of this week in PKT
      const nowPkt = new Date(today.toLocaleString("en-US", { timeZone: PKT }));
      const dayOfWeek = nowPkt.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
      const sunday = new Date(nowPkt);
      sunday.setDate(nowPkt.getDate() - dayOfWeek);
      return d >= pkDate(sunday);
    }
    // This month: first of current month in PKT
    const monthStart = pkDate(new Date(today.getFullYear(), today.getMonth(), 1));
    return d >= monthStart;
  }

  const allActive = mockSales.filter((s) => !s.isVoided);
  const filtered = dateFilter === "all" ? allActive : allActive.filter(inFilter);

  // Fallback cost lookup, used only for lines the sale-time snapshot could not price. It is
  // built from the products store, which loads ACTIVE products only, so it MUST NOT be the
  // primary source: a deactivated product would silently cost zero and overstate profit.
  const variantCost = new Map<string, number>();
  mockProducts.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));

  const totalSales = filtered.reduce((s, x) => s + x.totalAmount, 0);
  const txCount = filtered.length;
  // Gross profit = sale revenue - recorded line COGS, on the SAME authoritative revenue the
  // reports use: the sale's own stored total_amount (stamped by create_sale). Recomputing
  // the revenue from unit_price * qty looks equivalent but is not — the database rounds each
  // line separately, so the two drift apart on fractional quantities, and Home would then
  // disagree with Reports about the same period. COGS comes from the sale item's own
  // snapshot (taken at sale time), so an item whose product has since been deactivated
  // cannot silently cost zero.
  //
  // The arithmetic itself lives in src/lib/profit.ts so that Home, Sales, the sale record
  // and Reports cannot drift apart again; this screen only decides how to say the result.
  const gross = summariseSales(filtered, (id) => (id ? variantCost.get(id) : undefined));
  const grossProfit = gross.profit;
  const grossProfitDisplay = profitDisplay(gross);
  // Money in — the same date filter as sales, and the same calculation Reports shows. Home
  // prints the udhaar half (the money coming back against old bills); Reports prints the whole
  // picture, including the cash taken at the counter. Neither screen does its own addition.
  const totalReturns = allReturns
    .filter((r) => dateInRange(r.createdAt))
    .reduce((s, r) => s + r.amount, 0);
  const money = summariseMoneyIn({
    sales: allActive,
    payments: creditPayments,
    inPeriod: dateInRange,
  });
  // Overdue = remaining balance of credit whose due date has already passed.
  // Same authoritative calculation as the S1 overdue-credit signals.
  const overdueAmount = computeOverdueCreditTotal(customers);

  // Recent sales — filtered by selected date range, most recent first
  const recentSales = [...filtered]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 3);

  // Alerts — stock of record is the variant; p.stockQty is its derived total.
  const outOfStockCount = mockProducts.filter(p => p.stockQty <= 0).length;
  const totalPayable = mockCompanies.reduce((s, c) => s + c.outstandingPayable, 0);
  
  const [pendingCreditRequests, setPendingCreditRequests] = useState(0);
  const [dueReminders, setDueReminders] = useState<any[]>([]);
  const [bizSettings, setBizSettings] = useState<{crops: any[]}>({crops: []});
  const [customerCropsMap, setCustomerCropsMap] = useState<Record<string, string[]>>({});
  useEffect(() => {
    // Check for pending credit limit requests
    supabase.from("credit_limit_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      .then(({ count }) => setPendingCreditRequests(count || 0))
      .then(() => {}, () => {});
    loadBusinessSettings().then(setBizSettings).catch(() => {});
    // Load all customer crops for harvest alert filtering
    import("@/lib/reminderEngine").then(async (m) => {
      const map: Record<string, string[]> = {};
      for (const c of customers) {
        try { map[c.id] = await m.loadCustomerCrops(c.id); } catch { map[c.id] = []; }
      }
      setCustomerCropsMap(map);
    }).catch(() => {});
  }, [customers.length]);
  function customerCropsHas(customerId: string, cropName: string) {
    return (customerCropsMap[customerId] || []).includes(cropName);
  }
  useEffect(() => { generateReminders({ customers, sales: mockSales }).then(setDueReminders); }, [customers, mockSales]);
  const dueReminderCount = dueReminders.filter(r => new Date(r.triggerDate) <= new Date()).length;
  const creditLimitReached = customers.filter(c => c.outstandingBalance > 0 && c.creditLimit > 0 && c.outstandingBalance >= c.creditLimit).length;
  const delayedCount = customers.filter(c => c.outstandingBalance > 0 && calculatePaymentStatus(c, new Date()) === "delayed").length;
  const highRiskCount = customers.filter(c => c.outstandingBalance > 0 && calculatePaymentStatus(c, new Date()) === "high_risk").length;

  // Employee performance — filtered by selected date filter
  const empStats = mockEmployees.map((emp) => {
    const empSales = filtered.filter((s) => s.employeeId === emp.id);
    const items = empSales.reduce((s, x) => s + x.items.reduce((q, it) => q + it.qty, 0), 0);
    return {
      emp,
      total: empSales.reduce((s, x) => s + x.totalAmount, 0),
      count: empSales.length,
      items,
    };
  }).filter((e) => e.count > 0).sort((a, b) => b.total - a.total);

  const DATE_PILLS: { key: DateFilter; label: string }[] = [
    { key: "all",        label: t("sales.all") ?? "All" },
    { key: "today",      label: t("sales.today") },
    { key: "yesterday",  label: t("sales.yesterday") },
    { key: "this_week",  label: t("sales.thisWeek") },
    { key: "this_month", label: t("sales.thisMonth") },
  ];

  async function handleRefresh() {
    await Promise.all([
      useSalesStore.getState().load(),
      useProductsStore.getState().load(),
      useEmployeesStore.getState().load(),
      useCustomersStore.getState().load(),
      load(),
    ]);
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div
      className="flex flex-col w-full min-h-full relative"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* ── Header — who is working, and which branch ── */}
      {/* No greeting: the two facts on it are the branch this screen is describing and the
          person reading it, and a salutation was a third thing competing with both.
          gap-3.5 (14px) at a 40px mark: the name was sitting almost against the avatar. */}
      <div className="flex items-center gap-3.5 px-4 py-3">
        {/* The account's own branch shows the person; an added branch shows a branch mark.
            Only a face is a control (it opens the profile) — a branch mark is context, so
            it is not a button, and nothing taps through to a profile that is not there. */}
        {inAddedBranch ? (
          /* A branch mark, not a face — and still the way into Settings, exactly as the
             photo is on the account's own branch: the one control that opens the settings
             of whatever this header is describing. Leaving it inert meant a branch's
             settings could only be reached by switching to the main branch first. */
          <button
            onClick={() => navigate("/admin/settings")}
            aria-label={t("settings.title")}
            data-testid="dashboard-branch-settings"
            className="size-10 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            <Store size={19} />
          </button>
        ) : (
          <button
            onClick={() => navigate("/admin/settings")}
            className="size-10 rounded-full flex items-center justify-center font-bold text-14 shrink-0 overflow-hidden transition-transform active:scale-90"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {user?.photoUrl
              ? <img src={user.photoUrl} alt={displayName} className="w-full h-full object-cover" />
              : initials}
          </button>
        )}

        {/* Which branch these figures belong to is also how you move to another one, so the
            whole block opens the branch list: the name is the label AND the control, and the
            chevron beside it is the sign of that — a bare glyph, no button of its own, which
            is how the rest of the app marks a row that leads somewhere. It is still one tap,
            over the name rather than next to it, so nothing about reaching the list changed;
            a plain text block under a chevron is only discoverable BECAUSE the chevron says
            so, which is exactly what it is for. */}
        <button
          type="button"
          onClick={() => openSwitcher()}
          aria-label={t("shop.myShops")}
          data-testid="dashboard-switch-shop"
          className="flex flex-col flex-1 min-w-0 text-start ds-pressable"
        >
          {/* One line, ellipsised. A long name used to wrap this to two lines on a small
              phone and push the whole header taller; `min-w-0` on the parent lets
              `truncate` do its job instead of overflowing. */}
          <span className="flex items-center gap-1 min-w-0 max-w-full">
            <span className="font-bold text-15 leading-tight truncate" style={{ color: "var(--text-primary)" }}>
              {displayName}
            </span>
            <ChevronDown size={15} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
          </span>
          {/* The second line answers the question the first one raises. The person's name
              is the first line on their own branch, so this line names the branch and the
              day. On an added branch the branch is already the first line, so this one
              says what is IN it — the two lines never repeat each other. */}
          <span className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
            {activeBranch?.name ? `${activeBranch.name} · ${todayLabel}` : todayLabel}
          </span>
        </button>

        {/* gap-2.5 (10px), up from 6: the two round buttons are 36px each and were sitting
            almost edge to edge, which read as one wide pill rather than two controls. */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => navigate("/admin/search")}
            aria-label={t("common.search")}
            className="flex items-center justify-center rounded-full size-9 transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Search size={16} style={{ color: "var(--text-primary)" }} />
          </button>
          <button
            onClick={() => setShowNotifs((v) => !v)}
            aria-label={t("common.notifications")}
            className="flex items-center justify-center rounded-full size-9 relative transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Bell size={16} style={{ color: "var(--text-primary)" }} />
            {/* This branch's unread only: the account may run several, and a badge that
                counted another branch's events would send the owner looking here for
                something that is not in this list. The Notifications screen is where
                every branch is counted, and it says so with its own tabs. */}
            {unread(activeShopId) > 0 && (
              <span className="absolute top-1 end-1 bg-red-500 text-white text-8 font-bold rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-[2px]">
                {unread(activeShopId)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Notification overlay ── */}
      {showNotifs && (
        <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setShowNotifs(false)}>
          <div
            className="fixed top-[88px] end-4 w-[280px] rounded-[var(--radius-card)] shadow-2xl overflow-hidden animate-scale-in flex flex-col"
            style={{ zIndex: 61, background: "var(--surface)", border: "1px solid var(--divider)", maxHeight: "360px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — clickable → full notifications page */}
            <button
              onClick={() => { navigate("/admin/notifications"); setShowNotifs(false); }}
              className="px-4 py-3 flex items-center justify-between shrink-0 w-full active:opacity-70 transition-opacity"
              style={{ borderBottom: "1px solid var(--divider)" }}
            >
              <p className="ds-section-label" style={{ color: "var(--text-primary)" }}>
                {t("dashboard.notifications")}
              </p>
              <div className="flex items-center gap-2">
                {unread(activeShopId) > 0 && (
                  <span className="text-10 font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                    {unread(activeShopId)}
                  </span>
                )}
                <span className="text-10 font-semibold" style={{ color: "var(--brand-dark, #65a30d)" }} onClick={(e) => { e.stopPropagation(); markAllRead(); }}>{t("notifications.markAllRead")}</span>
              </div>
            </button>

            {/* Scrollable list */}
            <div className="overflow-y-auto flex-1" style={{ maxHeight: "310px" }}>
              {notificationsReady && notifications.filter(n => !n.read).length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noNotifications") || "No notifications yet"}</p>
                </div>
              ) : (
                (() => {
                  /* Show only unread notifications, grouped by time, max 5 */
                  const unreadNotifs = notifications.filter(n => !n.read).slice(0, 5);
                  if (unreadNotifs.length === 0) return null;
                  const now = new Date();
                  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
                  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

                  const groups: { heading: string; items: typeof notifications }[] = [
                    { heading: t("notifications.groupToday"), items: [] },
                    { heading: t("notifications.groupYesterday"), items: [] },
                    { heading: t("notifications.groupThisWeek"), items: [] },
                    { heading: t("notifications.groupEarlier"), items: [] },
                  ];

                  for (const n of unreadNotifs) {
                    const d = new Date(n.created_at);
                    if (d >= todayStart) groups[0].items.push(n);
                    else if (d >= yesterdayStart) groups[1].items.push(n);
                    else if (d >= weekStart) groups[2].items.push(n);
                    else groups[3].items.push(n);
                  }

                  const nonEmpty = groups.filter(g => g.items.length > 0);
                  const limited = nonEmpty;

                  return limited.map((group) => (
                    <div key={group.heading}>
                      <p className="ds-section-label px-4 pt-3 pb-1" style={{ color: "var(--text-secondary)" }}>
                        {group.heading}
                      </p>
                      {group.items.map((n) => {
                        const route = adminNotifRoute(n);
                        return (
                          <button
                            key={n.id}
                            onClick={() => { markOneRead(n.id); if (route) { navigate(route); } setShowNotifs(false); }}
                            className="w-full text-start px-4 py-3 active:bg-black/5 transition-colors"
                            style={{ borderBottom: "1px solid var(--divider)" }}
                          >
                            <div className="flex items-start gap-2">
                              {!n.read && (
                                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--brand)" }} />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{n.title}</p>
                                {n.body && <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</p>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Time-period filter — controls all figures below ── */}
      <div className="flex gap-2 px-4 pt-1 pb-2 overflow-x-auto no-scrollbar" style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}>
        {DATE_PILLS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDateFilter(key)}
            className="h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition-colors shrink-0"
            style={{
              background: dateFilter === key ? "var(--text-primary)" : "var(--surface-2)",
              color: dateFilter === key ? "var(--background)" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Total Sales card (lime hero): Total Sales · Transactions · Gross Profit ──
          Figures first: this is what a trading owner opens the app for. The setup checklist
          follows it on a shop that cannot trade yet, and is absent once the shop is set up. ── */}
      {/* `data-tour` anchors: the guided tour rings these two real blocks. Additive
          attributes only — nothing here looks or behaves differently because of them. */}
      <div className="px-4 pt-3 animate-fade-in-up" data-tour="home:kpis">
        <button
          className="w-full rounded-[var(--radius-card)] p-5 text-start transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/admin/sales")}
        >
          <p className="ds-section-label mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.totalSales")}
          </p>
          <p className="text-28 font-semibold leading-none" style={{ color: "#0a0a0a" }}>
            {formatRs(totalSales)}
          </p>

          <div className="flex items-end justify-between mt-4">
            <div>
              <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("inline.gross_profit")}
              </p>
              {/* A profit priced without a cost is not a profit, it is a floor. Say which
                  one this is, in the smallest way that still cannot be misread: a figure
                  on its own is exactly what made this number untrustworthy before. */}
              <p className="text-16 font-semibold" style={{ color: "#0a0a0a" }} data-testid="home-gross-profit">
                {grossProfitDisplay.kind === "unknown"
                  ? "—"
                  : grossProfitDisplay.kind === "atLeast"
                    ? `≥ ${formatRs(grossProfit)}`
                    : formatRs(grossProfit)}
              </p>
              {grossProfitDisplay.kind !== "exact" && (
                <p className="text-11 font-medium" style={{ color: "rgba(0,0,0,0.55)" }}>
                  {grossProfitDisplay.kind === "unknown"
                    ? t("profit.addCostToSeeProfit")
                    : t("profit.costMissingOn", { count: String(grossProfitDisplay.unknownLines) })}
                </p>
              )}
            </div>
            <div className="w-px self-stretch mx-3" style={{ background: "rgba(0,0,0,0.15)" }} />
            <div>
              <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("inline.credit_collect")}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-16 font-semibold" style={{ color: "#0a0a0a" }}>{formatRs(money.udhaar)}</p>
                <p className="text-11 font-semibold" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {formatRs(overdueAmount)} {t("inline.overdue")}
                </p>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* ── First-run guidance, directly under the sale card.
          On a shop that cannot trade yet this is what to do next, so it follows the figures
          the owner has just looked at instead of leading the screen. One checklist, the same
          component Settings renders, so a new owner sees the identical three steps in both
          places — and it renders nothing once the shop can trade. ── */}
      <SetupChecklist testId="setup-next-step" className="px-4 pt-4 animate-fade-in-up" />

      {/* ── Summary: Action needed · Follow-ups · Out of stock ── */}
      <div className="px-4 pt-4 flex gap-2 animate-fade-in-up">
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'action', subTab: 'critical' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--tone-card)" }}>
          <p className="text-16 font-bold" style={{ color: (highRiskCount + creditLimitReached) > 0 ? "var(--error)" : "var(--text-secondary)" }}>{highRiskCount + creditLimitReached}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("admin.actionNeeded")}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'followups', subTab: 'ready' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--tone-card)" }}>
          <p className="text-16 font-bold" style={{ color: (delayedCount + dueReminderCount) > 0 ? "var(--warning)" : "var(--text-secondary)" }}>{delayedCount + dueReminderCount}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("inline.follow_ups_x")}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/inventory')} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--tone-card)" }}>
          <p className="text-16 font-bold" style={{ color: outOfStockCount > 0 ? "var(--error)" : "var(--text-secondary)" }}>{outOfStockCount}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("signal.detailOutOfStock")}</p>
        </button>
      </div>

      {/* ── Quick Actions ──
          One glyph, one word, one surface. The three actions used to be flat outlined boxes
          shorter than a list row, which read as fields rather than things to press; the
          primary one is brand-filled and the other two are tone surfaces, the same grammar
          every other card on this screen uses (no outlined boxes anywhere). ── */}
      <div className="px-4 pt-4" data-tour="home:actions">
        <div className="grid grid-cols-3 gap-2.5">
          {([
            { icon: ShoppingCart, label: t("dashboard.newSale"), to: "/admin/sale", primary: true },
            { icon: HandCoins,    label: t("dashboard.recordPayment"), to: "/admin/customers", primary: false },
            // The purchase glyph, not a delivery truck: this button records stock coming in,
            // and it is the same mark the Purchases screens and that FAB already use.
            { icon: PackagePlus,  label: t("admin.purchases") ?? "Purchase", to: "/admin/purchases/new", primary: false },
          ] as const).map(({ icon: Icon, label, to, primary }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="h-14 rounded-[var(--radius-tile)] flex flex-col items-center justify-center gap-1 ds-pressable"
              style={primary
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--tone-card)", color: "var(--text-primary)" }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span className="text-11 font-semibold text-center leading-tight px-1">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Quick Alerts: 3 summary rows with premium card design ── */}
      {(() => {
        const criticalCount = totalPayable > 0 ? 1 : 0;
        const followupCount = dueReminderCount + delayedCount;
        let harvestDays: number | null = null;
        let harvestCustomerCount = 0;
        const nowRef = new Date();
        for (const crop of bizSettings.crops) {
          const harvest = new Date(nowRef.getFullYear(), crop.harvestMonth - 1, crop.harvestDay || 1);
          if (harvest < nowRef) harvest.setFullYear(nowRef.getFullYear() + 1);
          const d = Math.ceil((harvest.getTime() - nowRef.getTime()) / 86400000);
          if (d > 0 && d <= 30 && (harvestDays === null || d < harvestDays)) {
            harvestDays = d;
            harvestCustomerCount = customers.filter(c => c.outstandingBalance > 0 && customerCropsHas(c.id, crop.name)).length;
          }
        }
        const items: { key: string; icon: React.ReactNode; title: string; subtitle: string; action: string; actionColor: string; cardBg: string; onClick: () => void; count: number }[] = [];
        const criticalTotal = highRiskCount + creditLimitReached + criticalCount + pendingCreditRequests;
        if (criticalTotal > 0) {
          const parts: string[] = [];
          if (highRiskCount > 0) parts.push(highRiskCount + (t("inline.high_risk_x")));
          if (creditLimitReached > 0) parts.push(creditLimitReached + (t("inline.credit_limit")));
          if (criticalCount > 0) parts.push(t("inline.supplier"));
          if (pendingCreditRequests > 0) parts.push(pendingCreditRequests + (t("inline.request") + (pendingCreditRequests > 1 ? "s" : "")));
          const urgentTab = highRiskCount > 0 ? "critical" : creditLimitReached > 0 || pendingCreditRequests > 0 ? "warning" : "critical";
          items.push({
            key: "critical",
            icon: <AlertTriangle size={18} />,
            title: t(criticalTotal === 1 ? "dashboard.actionNeeded" : "dashboard.actionsNeeded", { count: criticalTotal }),
            subtitle: parts.join(t("inline.text")),
            action: t("admin.review"),
            actionColor: "var(--error)",
            cardBg: "var(--surface)",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "action", subTab: urgentTab } }),
            count: criticalTotal,
          });
        }
        if (followupCount > 0) {
          const parts: string[] = [];
          if (dueReminderCount > 0) parts.push(dueReminderCount + (t("inline.reminder") + (dueReminderCount !== 1 ? "s" : "")));
          if (delayedCount > 0) parts.push(delayedCount + (t("inline.delayed_x")));
          items.push({
            key: "followups",
            icon: <Bell size={18} />,
            title: t(followupCount === 1 ? "dashboard.followupReady" : "dashboard.followupsReady", { count: followupCount }),
            subtitle: parts.join(t("inline.text_x")),
            action: t("admin.view"),
            actionColor: "var(--warning)",
            cardBg: "var(--surface)",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "followups", subTab: "ready" } }),
            count: followupCount,
          });
        }
        if (harvestDays !== null) {
          items.push({
            key: "harvest",
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>,
            title: t(harvestDays === 1 ? "dashboard.harvestSoon" : "dashboard.harvestSoonPlural", { count: harvestDays }),
            subtitle: harvestCustomerCount > 0 ? harvestCustomerCount + (t("inline.customers_pending")) : "",
            action: "",
            actionColor: "var(--text-secondary)",
            cardBg: "var(--surface)",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "followups", subTab: "ready" } }),
            count: harvestDays,
          });
        }
        if (items.length === 0) return null;
        return (
          <div className="px-4 pt-5">
            {/* A label above one card of rows — the same shape as Recent Sales and every
                other list in the app. It used to be a card wrapping a column of three more
                cards, which is the double surface the rest of the app no longer uses. */}
            <p className="ds-section-label mb-2 px-1" style={{ color: "var(--text-secondary)" }}>
              {t("admin.quickAlerts")}
            </p>
            <ListCard>
              {items.map((item) => (
                <ListRow
                  key={item.key}
                  onClick={item.onClick}
                  tile={
                    <div
                      className="size-9 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        background: item.key === "critical" ? "var(--error-bg)" : item.key === "followups" ? "var(--warning-bg)" : "var(--surface-2)",
                        color: item.key === "critical" ? "var(--error)" : item.key === "followups" ? "var(--warning)" : "var(--text-secondary)",
                      }}
                    >
                      {item.icon}
                    </div>
                  }
                  title={item.title}
                  meta={item.subtitle || undefined}
                  trailing={
                    item.action ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-12 font-semibold" style={{ color: item.actionColor }}>
                          {item.action}
                        </span>
                        <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                      </div>
                    ) : undefined
                  }
                />
              ))}
            </ListCard>
          </div>
        );
      })()}

      {/* ── Employee Performance ── */}
      {empStats.length > 0 && (
        <div className="px-4 pt-5">
          <p className="ds-section-label mb-3" style={{ color: "var(--text-secondary)" }}>
            {t("admin.employeePerformance")}
          </p>
          <ListCard>
            {empStats.map(({ emp, total, count, items }) => (
              <ListRow
                key={emp.id}
                onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id, dateFilter } })}
                tile={
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: initBgColor(emp.name) }}
                  >
                    {(emp.name ?? '?').charAt(0)}
                  </div>
                }
                trailing={
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-sm font-bold" style={{ color: "var(--brand-dark)" }}>{formatRs(total)}</p>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </div>
                }
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                  <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{t(count === 1 ? "dashboard.saleCount" : "dashboard.salesCount", { count })} · {items} {t("common.items")}</p>
                </div>
              </ListRow>
            ))}
          </ListCard>
        </div>
      )}

      {/* ── Recent Sales ── */}
      {!listsReady && (
        <div className="px-4 pt-5">
          <SkeletonList rows={3} tile />
        </div>
      )}
      {listsReady && recentSales.length > 0 && (
        <div className="px-4 pt-5 pb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("dashboard.recentSales") ?? "Recent Sales"}
            </p>
            <button
              onClick={() => navigate("/admin/sales")}
              className="text-12 font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("common.viewAll") ?? "View all"}
            </button>
          </div>
          <ListCard>
            {recentSales.map((sale) => {
              const cImg = getCustomerImg(sale.customerId);
              const cBg = initBgColor(sale.customerName);
              return (
              <ListRow
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                tile={cImg ? (
                  <img src={cImg} alt={sale.customerName} className="size-9 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="size-9 rounded-full shrink-0 flex items-center justify-center text-11 font-bold" style={{ background: cBg, color: "#fff" }}>
                    {(sale.customerName ?? '?').charAt(0).toUpperCase()}
                  </div>
                )}
                trailing={
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                      {formatRs(sale.totalAmount)}
                    </span>
                    {sale.paymentType !== "full" ? (
                      <span className="text-10 font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                        {t("common.creditTag")}
                      </span>
                    ) : (
                      <span className="text-10 font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}>
                        {t("common.paidTag")}
                      </span>
                    )}
                  </div>
                }
              >
                <div className="min-w-0">
                  <p className="text-13 font-bold truncate" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                  <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now)}</p>
                  <p className="text-11 font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("common.soldBy")}: {sale.employeeName}</p>
                </div>
              </ListRow>
              );
            })}
          </ListCard>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
