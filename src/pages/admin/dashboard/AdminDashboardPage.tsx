import { useState, useEffect } from "react";
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
import NextStepCard from "@/components/ui/NextStepCard";
import { useCustomersStore } from "@/stores/customersStore";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { generateReminders, calculatePaymentStatus, loadBusinessSettings } from "@/lib/reminderEngine";
import { computeOverdueCreditTotal } from "@/lib/signalEngine";
import { useT } from "@/lib/i18n";
import { AlertTriangle, TrendingUp, ChevronRight, TrendingDown, ShoppingCart, Search, Bell, Wallet, CheckCircle2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";

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
  const { items: notifications, unread, load, subscribe, markAllRead, markOneRead } = useNotificationStore();
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const customers = useCustomersStore((s) => s.customers);
  const [allReturns, setAllReturns] = useState<{ amount: number; createdAt: string }[]>([]);
  const [allPayments, setAllPayments] = useState<{ amount: number; createdAt: string }[]>([]);

  // Fetch returns + credit collected — store raw rows so we can filter by date range
  useEffect(() => {
    async function fetchReturns() {
      try {
        const { data } = await supabase.from("returns").select("total_refund, created_at");
        if (data) {
          setAllReturns(data.map((r: any) => ({
            amount: Number(r.total_refund || 0),
            createdAt: r.created_at || "",
          })));
        }
      } catch {}
    }
    async function fetchCreditCollected() {
      try {
        const { data } = await supabase.from("customer_payments").select("amount, created_at");
        if (data) {
          setAllPayments(data.map((p: any) => ({
            amount: Number(p.amount || 0),
            createdAt: p.created_at || "",
          })));
        }
      } catch {}
    }
    fetchReturns();
    fetchCreditCollected();
  }, []);

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  const now = useCurrentTime();
  const today = now;
  const hour = today.getHours();
  const greetingKey =
    hour < 12 ? "dashboard.greeting.morning"
    : hour < 17 ? "dashboard.greeting.afternoon"
    : "dashboard.greeting.evening";
  const displayName = user?.name ?? t("common.owner");
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";
  const todayLabel = today.toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", {
    weekday: "long", day: "numeric", month: "long",
  });

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

  // Fallback cost lookup, used only for lines recorded before COGS snapshots
  // existed. It is built from the products store, which loads ACTIVE products
  // only, so it MUST NOT be the primary source: a deactivated product would
  // silently cost zero and overstate profit.
  const variantCost = new Map<string, number>();
  mockProducts.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));

  const totalSales = filtered.reduce((s, x) => s + x.totalAmount, 0);
  const txCount = filtered.length;
  // Gross profit = sale revenue - recorded line COGS, on the SAME authoritative
  // revenue the reports use: the sale's own stored total_amount (stamped by
  // create_sale). Recomputing the revenue from unit_price * qty looks equivalent
  // but is not — the database rounds each line separately, so the two drift
  // apart on fractional quantities, and Home would then disagree with Reports
  // about the same period. COGS comes from the sale item's own snapshot (taken at
  // sale time), so an item whose product has since been deactivated cannot
  // silently cost zero; the current variant cost is only a fallback for lines
  // written before COGS snapshots existed.
  const grossProfit = filtered.reduce(
    (sum, sale) =>
      sum +
      (sale.totalAmount -
        sale.items.reduce(
          (s, it) => s + (it.cogsAmount ?? (variantCost.get(it.variantId ?? '') ?? 0) * it.qty),
          0,
        )),
    0,
  );
  // Returns + credit collected — same date filter as sales
  const totalReturns = allReturns
    .filter((r) => dateInRange(r.createdAt))
    .reduce((s, r) => s + r.amount, 0);
  const creditCollected = allPayments
    .filter((p) => dateInRange(p.createdAt))
    .reduce((s, p) => s + p.amount, 0);
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

      {/* ── Greeting header — saved name + current date ── */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        {/* Owner avatar — taps to profile; uses saved photo when present */}
        <button
          onClick={() => navigate("/admin/settings")}
          className="size-10 rounded-full flex items-center justify-center font-bold text-14 shrink-0 overflow-hidden transition-transform active:scale-90"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {user?.photoUrl
            ? <img src={user.photoUrl} alt={displayName} className="w-full h-full object-cover" />
            : initials}
        </button>

        <div className="flex flex-col flex-1 min-w-0">
          <p className="font-bold text-16 leading-tight" style={{ color: "var(--text-primary)" }}>
            {t(greetingKey)}, {displayName}
          </p>
          <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {todayLabel}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
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
            {unread() > 0 && (
              <span className="absolute top-1 right-1 bg-red-500 text-white text-8 font-bold rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-[2px]">
                {unread()}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── Notification overlay ── */}
      {showNotifs && (
        <div className="fixed inset-0" style={{ zIndex: 60 }} onClick={() => setShowNotifs(false)}>
          <div
            className="fixed top-[88px] right-4 w-[280px] rounded-[var(--radius-card)] shadow-2xl overflow-hidden animate-scale-in flex flex-col"
            style={{ zIndex: 61, background: "var(--surface)", border: "1px solid var(--divider)", maxHeight: "360px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — clickable → full notifications page */}
            <button
              onClick={() => { navigate("/admin/notifications"); setShowNotifs(false); }}
              className="px-4 py-3 flex items-center justify-between shrink-0 w-full active:opacity-70 transition-opacity"
              style={{ borderBottom: "1px solid var(--divider)" }}
            >
              <p className="text-12 font-bold uppercase tracking-wider" style={{ color: "var(--text-primary)" }}>
                {t("dashboard.notifications")}
              </p>
              <div className="flex items-center gap-2">
                {unread() > 0 && (
                  <span className="text-10 font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
                    {unread()}
                  </span>
                )}
                <span className="text-10 font-semibold" style={{ color: "var(--brand-dark, #65a30d)" }} onClick={(e) => { e.stopPropagation(); markAllRead(); }}>{t("notifications.markAllRead")}</span>
              </div>
            </button>

            {/* Scrollable list */}
            <div className="overflow-y-auto flex-1" style={{ maxHeight: "310px" }}>
              {notifications.filter(n => !n.read).length === 0 ? (
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
                      <p className="px-4 pt-3 pb-1 text-10 font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
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

      {/* ── First-run guidance: ONE next step, not a checklist. Settings owns completion
          status (all three steps plus a percentage); Home gives a new owner the single
          action that unblocks them, in the graph's own dependency order. It renders
          nothing once the shop can trade, so Home is never nagged by it. ── */}
      <NextStepCard className="px-4 pt-4 animate-fade-in-up" />

      {/* ── Total Sales card (lime hero): Total Sales · Transactions · Gross Profit ── */}
      <div className="px-4 animate-fade-in-up">
        <button
          className="w-full rounded-[var(--radius-card)] p-5 text-start transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/admin/sales")}
        >
          <p className="text-11 font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.totalSales")}
          </p>
          <p className="text-28 font-semibold leading-none" style={{ color: "#0a0a0a" }}>
            {formatRs(totalSales)}
          </p>

          <div className="flex items-end justify-between mt-4">
            <div>
              <p className="text-10 font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("inline.gross_profit")}
              </p>
              <p className="text-16 font-semibold" style={{ color: "#0a0a0a" }}>{formatRs(grossProfit)}</p>
            </div>
            <div className="w-px self-stretch mx-3" style={{ background: "rgba(0,0,0,0.15)" }} />
            <div>
              <p className="text-10 font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("inline.credit_collect")}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-16 font-semibold" style={{ color: "#0a0a0a" }}>{formatRs(creditCollected)}</p>
                <p className="text-11 font-semibold" style={{ color: "rgba(0,0,0,0.5)" }}>
                  {formatRs(overdueAmount)} {t("inline.overdue")}
                </p>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* ── Summary: Action needed · Follow-ups · Out of stock ── */}
      <div className="px-4 pt-4 flex gap-2 animate-fade-in-up">
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'action', subTab: 'critical' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-16 font-bold" style={{ color: (highRiskCount + creditLimitReached) > 0 ? "var(--error)" : "var(--text-secondary)" }}>{highRiskCount + creditLimitReached}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("admin.actionNeeded")}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'followups', subTab: 'ready' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-16 font-bold" style={{ color: (delayedCount + dueReminderCount) > 0 ? "var(--warning)" : "var(--text-secondary)" }}>{delayedCount + dueReminderCount}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("inline.follow_ups_x")}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/inventory')} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[var(--radius-tile)] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-16 font-bold" style={{ color: outOfStockCount > 0 ? "var(--error)" : "var(--text-secondary)" }}>{outOfStockCount}</p>
          <p className="text-10 font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{t("signal.detailOutOfStock")}</p>
        </button>
      </div>

      {/* ── Quick Actions ── */}
      <div className="px-4 pt-5">
        <div className="grid grid-cols-3 gap-2.5">
          <button
            onClick={() => navigate("/admin/sale")}
            className="h-10 rounded-[var(--radius-tile)] font-semibold text-12 flex items-center justify-center transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("dashboard.newSale")}
          </button>
          <button
            onClick={() => navigate("/admin/customers")}
            className="h-10 rounded-[var(--radius-tile)] font-semibold text-12 flex items-center justify-center transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            {t("dashboard.recordPayment")}
          </button>
          <button
            onClick={() => navigate("/admin/purchases/new")}
            className="h-10 rounded-[var(--radius-tile)] font-semibold text-12 flex items-center justify-center transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            {t("admin.purchases") ?? "Purchase"}
          </button>
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
          <div className="px-4 pt-4">
            <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-2.5" style={{ background: "var(--surface-2)" }}>
              <p className="text-11 font-bold uppercase tracking-widest px-1" style={{ color: "var(--text-secondary)" }}>
                {t("admin.quickAlerts")}
              </p>
              {items.map((item) => (
                <button
                  key={item.key}
                  onClick={item.onClick}
                  className="flex items-start gap-3 p-3.5 rounded-[var(--radius-tile)] w-full text-start active:opacity-70 transition-opacity"
                  style={{ background: item.cardBg }}
                >
                  <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                    style={{
                      background: item.key === "critical" ? "var(--error-bg)" : item.key === "followups" ? "var(--warning-bg)" : "var(--surface-2)",
                      color: item.key === "critical" ? "var(--error)" : item.key === "followups" ? "var(--warning)" : "var(--text-secondary)",
                    }}
                  >
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>{item.title}</p>
                    {item.subtitle && <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{item.subtitle}</p>}
                  </div>
                  {item.action && (
                    <span className="text-12 font-semibold shrink-0 mt-1" style={{ color: item.actionColor }}>
                      {item.action}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Employee Performance ── */}
      {empStats.length > 0 && (
        <div className="px-4 pt-5">
          <p className="text-11 font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
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
      {recentSales.length > 0 && (
        <div className="px-4 pt-5 pb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-11 font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
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
