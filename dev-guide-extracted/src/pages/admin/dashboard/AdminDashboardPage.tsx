import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { AlertTriangle, TrendingUp, ChevronRight, TrendingDown, ShoppingCart, Receipt } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";

type DateFilter = "all" | "today" | "yesterday" | "this_week" | "this_month";

function formatRs(n: number) {
  return "Rs. " + Math.round(n).toLocaleString("en-PK");
}

function hashColor(str: string) {
  const colors = ["#16a34a", "#0284c7", "#7c3aed", "#c2410c", "#0f766e", "#b45309"];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export default function AdminDashboardPage() {
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const navigate = useNavigate();
  const t = useT();
  const isUrdu = language === "ur";
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const customers = useCustomersStore((s) => s.customers);

  const today = new Date();
  const hour = today.getHours();
  const greetingKey =
    hour < 12 ? "dashboard.greeting.morning"
    : hour < 17 ? "dashboard.greeting.afternoon"
    : "dashboard.greeting.evening";
  const displayName = user?.name ?? "Owner";
  const initials = user?.name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "OW";
  const todayLabel = today.toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
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

  // Filter sales — fall back to all when date filter returns nothing (dev/demo)
  const allActive = mockSales.filter((s) => !s.isVoided);
  const filtered = (() => {
    if (dateFilter === "all") return allActive;
    const f = allActive.filter(inFilter);
    return f.length > 0 ? f : allActive;
  })();

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
      sale.items.reduce((s, it) => s + (it.unitPrice - (variantCost.get(it.variantId) ?? 0)) * it.qty, 0),
    0,
  );
  // Outstanding = customer amounts currently owed (a live balance, not period-scoped).
  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingBalance, 0);

  // Recent sales (most recent first)
  const recentSales = [...allActive]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 5);

  // Alerts
  const lowStockCount = mockProducts.reduce((c, p) => {
    const bad = p.variants.some((v) => v.stockQty === 0 || v.stockQty <= v.lowStockThreshold);
    return c + (bad ? 1 : 0);
  }, 0);
  const totalPayable = mockCompanies.reduce((s, c) => s + c.outstandingPayable, 0);

  // Employee performance
  const empStats = mockEmployees.map((emp) => ({
    emp,
    total: allActive.filter((s) => s.employeeId === emp.id).reduce((s, x) => s + x.totalAmount, 0),
    count: allActive.filter((s) => s.employeeId === emp.id).length,
  })).filter((e) => e.count > 0).sort((a, b) => b.total - a.total);

  const DATE_PILLS: { key: DateFilter; label: string }[] = [
    { key: "all",        label: t("sales.all") ?? "All" },
    { key: "today",      label: t("sales.today") },
    { key: "yesterday",  label: t("sales.yesterday") },
    { key: "this_week",  label: t("sales.thisWeek") },
    { key: "this_month", label: t("sales.thisMonth") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
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
      </div>

      {/* ── Time-period filter — controls all figures below ── */}
      <div className="flex gap-2 px-4 pt-1 pb-2 overflow-x-auto no-scrollbar">
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
          onClick={() => navigate("/admin/customers")}
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
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          {t("dashboard.quickActions")}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/admin/sale")}
            className="flex-1 h-12 rounded-full font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <ShoppingCart size={15} strokeWidth={2.5} />
            {t("dashboard.newSale")}
          </button>
          <button
            onClick={() => navigate("/admin/companies")}
            className="flex-1 h-12 rounded-full font-bold text-[14px] flex items-center justify-center gap-2 transition-transform active:scale-[0.97]"
            style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
          >
            <TrendingDown size={15} strokeWidth={2} />
            {t("admin.purchases") ?? "Purchases"}
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
        </div>
      </div>

      {/* ── Employee Performance ── */}
      {empStats.length > 0 && (
        <div className="px-4 pt-5">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
            {t("admin.employeePerformance")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {empStats.map(({ emp, total, count }, i) => (
              <button
                key={emp.id}
                onClick={() => navigate(`/admin/employees/${emp.id}`)}
                className="flex items-center justify-between px-4 py-3 w-full text-left transition-opacity active:opacity-70"
                style={{ borderBottom: i < empStats.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: hashColor(emp.name) }}
                  >
                    {emp.name.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{count} {count === 1 ? "sale" : "sales"}</p>
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
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            {recentSales.map((sale, i) => (
              <button
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                className="flex items-center justify-between px-4 py-3 w-full text-left transition-opacity active:opacity-70"
                style={{ borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="size-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--surface-2)" }}>
                    <Receipt size={15} style={{ color: "var(--text-secondary)" }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      {sale.customerName || sale.saleNumber}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
                      {sale.employeeName} · {new Date(sale.createdAt).toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatRs(sale.totalAmount)}</p>
                    {sale.paymentType !== "full" && (
                      <p className="text-[10px] font-semibold" style={{ color: "#ef4444" }}>
                        {t("sales.summaryCreditSales") ?? "Credit"}
                      </p>
                    )}
                  </div>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
