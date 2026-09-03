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
import { useCustomersStore } from "@/stores/customersStore";
import { supabase } from "@/lib/supabase";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { generateReminders, calculatePaymentStatus, loadBusinessSettings } from "@/lib/reminderEngine";
import { useT } from "@/lib/i18n";
import { AlertTriangle, TrendingUp, ChevronRight, TrendingDown, ShoppingCart, Search, Bell, Wallet, CheckCircle2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
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
  const { items: notifications, unread, load, subscribe, markAllRead } = useNotificationStore();
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const customers = useCustomersStore((s) => s.customers);
  const [totalReturns, setTotalReturns] = useState(0);
  const [creditCollected, setCreditCollected] = useState(0);

  // Fetch returns + credit collected for net sales calculation
  useEffect(() => {
    async function fetchReturns() {
      try {
        const { data } = await supabase.from("returns").select("total_refund, created_at");
        if (data) {
          const total = data.reduce((s: number, r: any) => s + Number(r.total_refund || 0), 0);
          setTotalReturns(total);
        }
      } catch {}
    }
    async function fetchCreditCollected() {
      try {
        const { data } = await supabase.from("customer_payments").select("amount");
        if (data) {
          const total = data.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
          setCreditCollected(total);
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
  const displayName = user?.name ?? "Owner";
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";
  const todayLabel = today.toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", {
    weekday: "long", day: "numeric", month: "long",
  });

  // Date helpers
  const todayStr = today.toISOString().split("T")[0];
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  function inFilter(s: (typeof mockSales)[0]) {
    if (dateFilter === "all") return true;
    const d = s.createdAt.split("T")[0];
    if (dateFilter === "today") return d === todayStr;
    if (dateFilter === "yesterday") return d === yesterdayStr;
    if (dateFilter === "this_week") {
      const ws = new Date(); ws.setDate(ws.getDate() - ws.getDay());
      return new Date(d) >= ws;
    }
    const ms = new Date(today.getFullYear(), today.getMonth(), 1);
    return new Date(d) >= ms;
  }

  const allActive = mockSales.filter((s) => !s.isVoided);
  const filtered = dateFilter === "all" ? allActive : allActive.filter(inFilter);

  // Cost lookup for real gross profit (admin-only figure — cost vs selling price).
  const variantCost = new Map<string, number>();
  mockProducts.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));

  const totalSales = filtered.reduce((s, x) => s + x.totalAmount, 0);
  const txCount = filtered.length;
  const paidSales = filtered.reduce((s, x) => s + x.amountPaid, 0);
  const creditSales = filtered
    .filter((s) => s.paymentType !== "full")
    .reduce((s, x) => s + x.totalAmount, 0);
  const grossProfit = filtered.reduce(
    (sum, sale) =>
      sum +
      sale.items.reduce((s, it) => s + (it.unitPrice - (variantCost.get(it.variantId ?? '') ?? 0)) * it.qty, 0),
    0,
  );
  // Outstanding = customer amounts currently owed (a live balance, not period-scoped).
  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingBalance, 0);

  // Recent sales (most recent first) — matches employee dashboard count
  const recentSales = [...allActive]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 3);

  // Alerts
  const lowStockCount = mockProducts.reduce((c, p) => {
    const bad = p.stockQty <= (p.variants[0]?.lowStockThreshold ?? 5);
    return c + (bad ? 1 : 0);
  }, 0);
  const outOfStockCount = mockProducts.filter(p => p.stockQty === 0).length;
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
          className="size-10 rounded-full flex items-center justify-center font-bold text-[14px] shrink-0 overflow-hidden transition-transform active:scale-90"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {user?.photoUrl
            ? <img src={user.photoUrl} alt={displayName} className="w-full h-full object-cover" />
            : initials}
        </button>

        <div className="flex flex-col flex-1 min-w-0">
          <p className="font-bold text-[16px] leading-tight" style={{ color: "var(--text-primary)" }}>
            {t(greetingKey)}, {displayName}
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {todayLabel}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => navigate("/admin/search")}
            className="flex items-center justify-center rounded-full size-9 transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Search size={16} style={{ color: "var(--text-primary)" }} />
          </button>
          <button
            onClick={() => { setShowNotifs((v) => !v); markAllRead(); }}
            className="flex items-center justify-center rounded-full size-9 relative transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Bell size={16} style={{ color: "var(--text-primary)" }} />
            {unread() > 0 && (
              <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] font-bold rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-[2px]">
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
            className="fixed top-[88px] right-4 w-[280px] rounded-[16px] shadow-2xl overflow-hidden animate-scale-in flex flex-col"
            style={{ zIndex: 61, background: "var(--surface)", border: "1px solid var(--divider)", maxHeight: "360px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("dashboard.notifications")}
              </p>
              {notifications.length > 0 && (
                <button onClick={() => { markAllRead(); }} className="text-[11px] font-semibold" style={{ color: "var(--brand-dark, #65a30d)" }}>
                  Mark all read
                </button>
              )}
            </div>

            {/* Scrollable list */}
            <div className="overflow-y-auto flex-1" style={{ maxHeight: "310px" }}>
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noNotifications") || "No notifications yet"}</p>
                </div>
              ) : (
                (() => {
                  /* Group notifications by time period */
                  const now = new Date();
                  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
                  const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - 7);

                  const groups: { heading: string; items: typeof notifications }[] = [
                    { heading: "Today", items: [] },
                    { heading: "Yesterday", items: [] },
                    { heading: "Last week", items: [] },
                    { heading: "Earlier", items: [] },
                  ];

                  for (const n of notifications) {
                    const d = new Date(n.created_at);
                    if (d >= todayStart) groups[0].items.push(n);
                    else if (d >= yesterdayStart) groups[1].items.push(n);
                    else if (d >= weekStart) groups[2].items.push(n);
                    else groups[3].items.push(n);
                  }

                  const nonEmpty = groups.filter(g => g.items.length > 0);
                  // Limit to 5 most recent notifications total
                  let totalCount = 0;
                  const limited: typeof nonEmpty = [];
                  for (const g of nonEmpty) {
                    const remaining = 5 - totalCount;
                    if (remaining <= 0) break;
                    const items = g.items.slice(0, remaining);
                    limited.push({ ...g, items });
                    totalCount += items.length;
                  }

                  return limited.map((group) => (
                    <div key={group.heading}>
                      <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                        {group.heading}
                      </p>
                      {group.items.map((n) => {
                        const route = adminNotifRoute(n);
                        return (
                          <button
                            key={n.id}
                            onClick={() => { if (route) { navigate(route); setShowNotifs(false); } }}
                            className="w-full text-start px-4 py-3 active:bg-black/5 transition-colors"
                            style={{ borderBottom: "1px solid var(--divider)" }}
                          >
                            <div className="flex items-start gap-2">
                              {!n.read && (
                                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--brand)" }} />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{n.title}</p>
                                {n.body && <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</p>}
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

      {/* ── Total Sales card (lime hero): Total Sales · Transactions · Gross Profit ── */}
      <div className="px-4 animate-fade-in-up">
        <button
          className="w-full rounded-[16px] p-5 text-start transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/admin/sales")}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.totalSales")}
          </p>
          <p className="text-[28px] font-semibold leading-none" style={{ color: "#0a0a0a" }}>
            {formatRs(totalSales - totalReturns)}
          </p>

          <div className="flex items-end justify-between mt-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {isUrdu ? "تخمینہ منافع" : "GROSS PROFIT"}
              </p>
              <p className="text-[16px] font-semibold" style={{ color: "#0a0a0a" }}>{formatRs(grossProfit)}</p>
            </div>
            <div className="w-px self-stretch mx-3" style={{ background: "rgba(0,0,0,0.15)" }} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {isUrdu ? "نقد وصولی" : "CREDIT COLLECT"}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-[16px] font-semibold" style={{ color: "#0a0a0a" }}>{formatRs(creditCollected)}</p>
                <p className="text-[11px] font-semibold" style={{ color: "rgba(220,38,38,0.9)" }}>
                  {formatRs(totalOutstanding)} {isUrdu ? "واجب الادا" : "overdue"}
                </p>
              </div>
            </div>
          </div>
        </button>
      </div>

      {/* ── Summary: Action needed · Follow-ups · Out of stock ── */}
      <div className="px-4 pt-4 flex gap-2 animate-fade-in-up">
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'action', subTab: 'urgent' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-[16px] font-bold" style={{ color: (highRiskCount + creditLimitReached) > 0 ? "var(--error)" : "var(--text-secondary)" }}>{highRiskCount + creditLimitReached}</p>
          <p className="text-[10px] font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "عمل درکار" : "Action needed"}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/reminders', { state: { tab: 'followups', subTab: 'ready' } })} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-[16px] font-bold" style={{ color: (delayedCount + dueReminderCount) > 0 ? "var(--warning)" : "var(--text-secondary)" }}>{delayedCount + dueReminderCount}</p>
          <p className="text-[10px] font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "فالو اپ" : "Follow-ups"}</p>
        </button>
        <button onClick={() => navigate('/admin/alerts/inventory')} className="flex-1 flex items-center gap-2.5 py-2.5 px-3 rounded-[10px] active:opacity-70 transition-opacity" style={{ background: "var(--surface-2)" }}>
          <p className="text-[16px] font-bold" style={{ color: outOfStockCount > 0 ? "var(--error)" : "var(--text-secondary)" }}>{outOfStockCount}</p>
          <p className="text-[10px] font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>{isUrdu ? "اسٹاک ختم" : "Out of stock"}</p>
        </button>
      </div>

      {/* ── Quick Actions ── */}
      <div className="px-4 pt-5">
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => navigate("/admin/sale")}
            className="h-12 rounded-full font-bold text-[13px] flex items-center justify-center transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("dashboard.newSale")}
          </button>
          <button
            onClick={() => navigate("/admin/customers")}
            className="h-12 rounded-full font-bold text-[13px] flex items-center justify-center transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            {isUrdu ? "ادائیگی" : "Record Payment"}
          </button>
          <button
            onClick={() => navigate("/admin/purchases/new")}
            className="h-12 rounded-full font-bold text-[13px] flex items-center justify-center transition-transform active:scale-[0.97]"
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
          if (highRiskCount > 0) parts.push(highRiskCount + (isUrdu ? " اعلیٰ خطرہ" : " high-risk"));
          if (creditLimitReached > 0) parts.push(creditLimitReached + (isUrdu ? " کریڈٹ حد" : " credit limit"));
          if (criticalCount > 0) parts.push(isUrdu ? "سپلائر" : "supplier");
          if (pendingCreditRequests > 0) parts.push(pendingCreditRequests + (isUrdu ? " درخواست" : " request" + (pendingCreditRequests > 1 ? "s" : "")));
          const urgentTab = highRiskCount > 0 ? "urgent" : creditLimitReached > 0 || pendingCreditRequests > 0 ? "medium" : "urgent";
          items.push({
            key: "critical",
            icon: <AlertTriangle size={18} />,
            title: isUrdu ? criticalTotal + " عمل درکار" : criticalTotal + " action" + (criticalTotal !== 1 ? "s" : "") + " needed",
            subtitle: parts.join(isUrdu ? " · " : ", "),
            action: isUrdu ? "جائزہ" : "Review",
            actionColor: "#D91313",
            cardBg: "#FFFFFF",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "action", subTab: urgentTab } }),
            count: criticalTotal,
          });
        }
        if (followupCount > 0) {
          const parts: string[] = [];
          if (dueReminderCount > 0) parts.push(dueReminderCount + (isUrdu ? " یاد دہانی" : " reminder" + (dueReminderCount !== 1 ? "s" : "")));
          if (delayedCount > 0) parts.push(delayedCount + (isUrdu ? " تاخیر" : " delayed"));
          items.push({
            key: "followups",
            icon: <Bell size={18} />,
            title: isUrdu ? followupCount + " فالو اپ تیار" : followupCount + " follow-up" + (followupCount !== 1 ? "s" : "") + " ready",
            subtitle: parts.join(isUrdu ? " · " : ", "),
            action: isUrdu ? "دیکھیں" : "View",
            actionColor: "#D97706",
            cardBg: "#FFFFFF",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "followups", subTab: "ready" } }),
            count: followupCount,
          });
        }
        if (harvestDays !== null) {
          items.push({
            key: "harvest",
            icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2" /><line x1="16" x2="16" y1="2" y2="6" /><line x1="8" x2="8" y1="2" y2="6" /><line x1="3" x2="21" y1="10" y2="10" /></svg>,
            title: isUrdu ? "فصل کا موسم " + harvestDays + " دن میں شروع" : "Harvest in " + harvestDays + " day" + (harvestDays !== 1 ? "s" : ""),
            subtitle: harvestCustomerCount > 0 ? harvestCustomerCount + (isUrdu ? " گاہک زیر التوا" : " customers pending") : "",
            action: "",
            actionColor: "#888888",
            cardBg: "#FFFFFF",
            onClick: () => navigate("/admin/alerts/reminders", { state: { tab: "followups", subTab: "ready" } }),
            count: harvestDays,
          });
        }
        if (items.length === 0) return null;
        return (
          <div className="px-4 pt-4">
            <div className="rounded-[16px] p-4 flex flex-col gap-2.5" style={{ background: "#F4F7FA" }}>
              <p className="text-[11px] font-bold uppercase tracking-widest px-1" style={{ color: "#475467" }}>
                {isUrdu ? "فوری اعلانات" : "Quick Alerts"}
              </p>
              {items.map((item) => (
                <button
                  key={item.key}
                  onClick={item.onClick}
                  className="flex items-start gap-3 p-3.5 rounded-[12px] w-full text-start active:opacity-70 transition-opacity"
                  style={{ background: item.cardBg }}
                >
                  <div className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
                    style={{
                      background: item.key === "critical" ? "#FFE9E4" : item.key === "followups" ? "#FEF3C7" : "#F1F5F9",
                      color: item.key === "critical" ? "#D91313" : item.key === "followups" ? "#D97706" : "#888888",
                    }}
                  >
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold" style={{ color: "#0F172A" }}>{item.title}</p>
                    {item.subtitle && <p className="text-[12px] mt-0.5" style={{ color: "#475467" }}>{item.subtitle}</p>}
                  </div>
                  {item.action && (
                    <span className="text-[12px] font-semibold shrink-0 mt-1" style={{ color: item.actionColor }}>
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
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
            {t("admin.employeePerformance")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {empStats.map(({ emp, total, count, items }, i) => (
              <button
                key={emp.id}
                onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id, dateFilter } })}
                className="flex items-center justify-between px-4 py-3 w-full text-start transition-opacity active:opacity-70"
                style={{ borderBottom: i < empStats.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: initBgColor(emp.name) }}
                  >
                    {emp.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{count} {isUrdu ? (count === 1 ? "فروخت" : "فروختیں") : (count === 1 ? "sale" : "sales")} · {items} {isUrdu ? "اشیاء" : "items"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold" style={{ color: "var(--brand-dark)" }}>{formatRs(total)}</p>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Sales ── */}
      {recentSales.length > 0 && (
        <div className="px-4 pt-5 pb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
              {t("dashboard.recentSales") ?? "Recent Sales"}
            </p>
            <button
              onClick={() => navigate("/admin/sales")}
              className="text-[12px] font-semibold"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("common.viewAll") ?? "View all"}
            </button>
          </div>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {recentSales.map((sale, i) => {
              const cImg = getCustomerImg(sale.customerId);
              const cBg = initBgColor(sale.customerName);
              return (
              <button
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                className="flex items-center justify-between px-4 py-3.5 w-full text-start transition-colors active:opacity-70"
                style={{
                  borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none",
                  background: "var(--background)",
                }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {cImg ? (
                    <img src={cImg} alt={sale.customerName} className="size-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="size-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold" style={{ background: cBg, color: "#fff" }}>
                      {sale.customerName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now)}</p>
                    <p className="text-[11px] font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("common.soldBy")}: {sale.employeeName}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatRs(sale.totalAmount)}
                  </span>
                  {sale.paymentType !== "full" ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                      Credit
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }}>
                      Paid
                    </span>
                  )}
                </div>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
