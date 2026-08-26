import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { PaymentBadge } from "@/components/ui/Badge";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import type { Sale } from "@/types";
import { Search } from "lucide-react";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

type Tab = "all" | "credit" | "paid";
type DateFilter = "today" | "yesterday" | "this_week";

export default function AdminSalesListPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [tab, setTab] = useState<Tab>((state?.tab as Tab) ?? "all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("today");
  const [query, setQuery] = useState("");

  // Live sales from Supabase (real-time) — loaded + subscribed globally by the layout.
  const allSales: Sale[] = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  const now = useCurrentTime();
  const today = now;
  const todayStr = today.toISOString().split("T")[0];
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  function inDate(sale: Sale) {
    const d = sale.createdAt.split("T")[0];
    if (dateFilter === "today")     return d === todayStr;
    if (dateFilter === "yesterday") return d === yesterdayStr;
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return new Date(d) >= weekStart;
  }

  function inTab(sale: Sale) {
    if (tab === "credit") return sale.paymentType !== "full";
    if (tab === "paid")   return sale.paymentType === "full";
    return true;
  }

  function inQuery(sale: Sale) {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      sale.customerName.toLowerCase().includes(q) ||
      sale.employeeName.toLowerCase().includes(q) ||
      sale.saleNumber.toLowerCase().includes(q)
    );
  }

  const inDateAll = allSales.filter((s) => !s.isVoided && inDate(s));
  const filtered  = (inDateAll.length > 0 ? inDateAll : allSales.filter((s) => !s.isVoided)).filter(inTab).filter(inQuery);
  const total     = filtered.reduce((s, x) => s + x.totalAmount, 0);
  const profit    = Math.round(total * 0.2);

  const DATE_FILTERS: { key: DateFilter; label: string }[] = [
    { key: "today",     label: t("sales.today") },
    { key: "yesterday", label: t("sales.yesterday") },
    { key: "this_week", label: t("sales.thisWeek") },
  ];

  const TABS: { key: Tab; label: string }[] = [
    { key: "all",    label: t("sales.all") },
    { key: "credit", label: t("sales.credit") },
    { key: "paid",   label: t("sales.paid") },
  ];

  const summaryLabel =
    tab === "all"    ? t("sales.summaryToday") :
    tab === "credit" ? t("sales.summaryCreditSales") :
                       t("sales.summaryPaidSales");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="flex items-center justify-between px-4 h-11">
        <div className="w-8" />
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.sales")}</p>
        <div className="w-8" />
      </div>

      {/* Summary strip with profit */}
      <div
        className="mx-4 rounded-xl px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--surface-2)" }}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {summaryLabel}
          </p>
          <p className="text-[11px]" style={{ color: "var(--brand-dark)" }}>
            {t("admin.grossProfit")}: {formatCurrency(profit)}
          </p>
        </div>
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          {formatCurrency(total)}
        </p>
      </div>

      {/* Search bar below summary */}
      <div className="px-4 pt-3">
        <div
          className="flex items-center gap-2 h-10 rounded-full px-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, employee, or sale #"
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ color: "var(--text-secondary)" }}>×</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex mt-3 mx-4 gap-6"
        style={{ borderBottom: "1px solid var(--divider)" }}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="pb-2 text-sm transition-colors"
            style={{
              fontWeight: tab === key ? 700 : 400,
              color: tab === key ? "var(--brand-dark)" : "var(--text-secondary)",
              borderBottom: tab === key ? "2px solid var(--brand)" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Date filters */}
      <div className="flex gap-2 px-4 py-3">
        {DATE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDateFilter(key)}
            className="h-8 px-4 rounded-full text-xs font-medium transition-colors"
            style={{
              background: dateFilter === key ? "var(--brand)" : "var(--surface-2)",
              color: dateFilter === key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sales list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2">
          <p className="text-3xl">📋</p>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("sales.noSales")}</p>
        </div>
      ) : (
        <div className="flex flex-col mx-4">
          {filtered.map((sale, i) => {
            const cImg = getCustomerImg(sale.customerId);
            const cBg = initBgColor(sale.customerName);
            return (
            <button
              key={sale.id}
              onClick={() => navigate(`/admin/sales/${sale.id}`)}
              className="flex items-center justify-between py-4 text-left transition-opacity active:opacity-70"
              style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex items-center gap-3">
                {cImg ? (
                  <img src={cImg} alt={sale.customerName} className="size-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="size-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: cBg, color: "#fff" }}>
                    {sale.customerName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now)}</p>
                  <p className="text-xs" style={{ color: "var(--brand-dark)" }}>
                    Est. profit: {formatCurrency(Math.round(sale.totalAmount * 0.2))}
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(sale.totalAmount)}
                </span>
                <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
              </div>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
