import { useState } from "react";
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
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
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
      case "stock_adjust": return "/admin/inventory"; // no individual adjustment detail
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
    case "low_stock": case "stock_adjust": return "/admin/inventory";
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
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [showNotifs, setShowNotifs] = useState(false);
  const { items: notifications, unread, load, subscribe, markAllRead } = useNotificationStore();
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const customers = useCustomersStore((s) => s.customers);

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
  const totalPayable = mockCompanies.reduce((s, c) => s + c.outstandingPayable, 0);

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
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Owner avatar — taps to profile; uses saved photo when present */}
        <button
          onClick={() => navigate("/admin/settings")}
          className="size-11 rounded-full flex items-center justify-center font-bold text-[15px] shrink-0 overflow-hidden transition-transform active:scale-90"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {user?.photoUrl
            ? <img src={user.photoUrl} alt={displayName} className="w-full h-full object-cover" />
            : initials}
        </button>

        <div className="flex flex-col flex-1 min-w-0">
          <p className="font-bold text-[17px] truncate" style={{ color: "var(--text-primary)" }}>
            {t(greetingKey)}, {displayName}
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {todayLabel}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate("/admin/search")}
            className="flex items-center justify-center rounded-full size-9 transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Search size={15} style={{ color: "var(--text-primary)" }} />
          </button>
          <button
            onClick={() => { setShowNotifs((v) => !v); markAllRead(); }}
            className="flex items-center justify-center rounded-full size-9 relative transition-colors active:opacity-60"
            style={{ background: "var(--surface-2)" }}
          >
            <Bell size={15} style={{ color: "var(--text-primary)" }} />
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
        <div className="absolute inset-0 z-40" onClick={() => setShowNotifs(false)}>
          <div
            className="absolute top-[88px] right-4 w-[280px] rounded-[16px] shadow-2xl overflow-hidden z-50 animate-scale-in"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("dashboard.notifications")}
              </p>
            </div>
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noNotifications")}</p>
              </div>
            ) : (
              notifications.map((n) => {
                const route = adminNotifRoute(n);
                return (
                  <button
                    key={n.id}
                    onClick={() => { if (route) { navigate(route); setShowNotifs(false); } }}
                    className="w-full text-left px-4 py-3 active:bg-black/5 transition-colors"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{n.title}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{n.body}</p>
                  </button>
                );
              })
            )}
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
          className="w-full rounded-[16px] p-5 text-left transition-transform active:scale-[0.98]"
          style={{ background: "var(--brand)" }}
          onClick={() => navigate("/admin/sales")}
        >
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: "rgba(0,0,0,0.55)" }}>
            {t("admin.totalSales")}
          </p>
          <p className="text-[34px] font-bold leading-none mb-4" style={{ color: "#0a0a0a" }}>
            {formatRs(totalSales)}
          </p>
          <div className="flex gap-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("admin.transactions")}
              </p>
              <p className="text-[22px] font-bold" style={{ color: "#0a0a0a" }}>{txCount}</p>
            </div>
            <div className="w-px" style={{ background: "rgba(0,0,0,0.15)" }} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(0,0,0,0.5)" }}>
                {t("admin.grossProfit")} ▲
              </p>
              <p className="text-[22px] font-bold" style={{ color: "#0a0a0a" }}>{formatRs(grossProfit)}</p>
            </div>
          </div>
        </button>
      </div>

      {/* ── Paid Sales · Credit Sales · Outstanding Credits ── */}
      <div className="px-4 pt-3 flex flex-col gap-3 animate-fade-in-up">
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/admin/sales")}
            className="flex-1 rounded-[12px] p-4 flex flex-col gap-2 items-start transition-opacity active:opacity-70"
            style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
          >
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("sales.summaryPaidSales") ?? "Paid Sales"}
            </p>
            <p className="text-[20px] font-bold" style={{ color: "var(--brand-dark)" }}>
              {formatRs(paidSales)}
            </p>
          </button>
          <button
            onClick={() => navigate("/admin/sales")}
            className="flex-1 rounded-[12px] p-4 flex flex-col gap-2 items-start transition-opacity active:opacity-70"
            style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
          >
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("sales.summaryCreditSales") ?? "Credit Sales"}
            </p>
            <p className="text-[20px] font-bold" style={{ color: "#ef4444" }}>
              {formatRs(creditSales)}
            </p>
          </button>
        </div>

        <button
          onClick={() => navigate("/admin/customers", { state: { filter: "credit" } })}
          className="w-full rounded-[12px] p-4 flex items-center justify-between transition-opacity active:opacity-70"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex flex-col gap-1 items-start">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {t("admin.outstandingCredit") ?? "Outstanding Credits"}
            </p>
            <p className="text-[20px] font-bold" style={{ color: "#d97706" }}>
              {formatRs(totalOutstanding)}
            </p>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} />
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
            Payment
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

      {/* ── Quick Alerts ── */}
      <div className="px-4 pt-5">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("admin.quickAlerts")}
        </p>
        <div className="flex flex-col gap-2">
          {lowStockCount > 0 && (
            <button
              onClick={() => navigate("/admin/inventory")}
              className="flex items-center justify-between rounded-[14px] p-4 transition-opacity active:opacity-70"
              style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
            >
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full flex items-center justify-center" style={{ background: "rgba(217,119,6,0.1)" }}>
                  <AlertTriangle size={16} color="#d97706" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.lowStockAlert")}</p>
                  <p className="text-xs" style={{ color: "#d97706" }}>{lowStockCount} products need attention</p>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
            </button>
          )}
          {totalPayable > 0 && (
            <button
              onClick={() => navigate("/admin/companies")}
              className="flex items-center justify-between rounded-[14px] p-4 transition-opacity active:opacity-70"
              style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
            >
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
                  <TrendingUp size={16} color="#ef4444" />
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.supplierPayable")}</p>
                  <p className="text-xs" style={{ color: "#ef4444" }}>{formatCurrency(totalPayable)} total due</p>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
            </button>
          )}
          {lowStockCount === 0 && totalPayable === 0 && (
            <div
              className="rounded-[14px] p-4 flex items-center gap-3"
              style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
            >
              <div className="size-9 rounded-full flex items-center justify-center" style={{ background: "rgba(132,204,22,0.1)" }}>
                <CheckCircle2 size={16} color="#65a30d" />
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>All Clear</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>No low stock or supplier payable alerts right now</p>
              </div>
            </div>
          )}
        </div>
      </div>

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
                className="flex items-center justify-between px-4 py-3 w-full text-left transition-opacity active:opacity-70"
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
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{count} {count === 1 ? "sale" : "sales"} · {items} items</p>
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
                className="flex items-center justify-between px-4 py-3.5 w-full text-left transition-colors active:opacity-70"
                style={{
                  borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none",
                  background: "var(--background)",
                }}
              >
                <div className="flex items-center gap-3">
                  {cImg ? (
                    <img src={cImg} alt={sale.customerName} className="size-9 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="size-9 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold" style={{ background: cBg, color: "#fff" }}>
                      {sale.customerName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now)}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>Sold by: {sale.employeeName}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
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
