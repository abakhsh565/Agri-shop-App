import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import type { Sale } from "@/types";
import { Calendar, SlidersHorizontal, Check, ClipboardList, X } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { groupSalesByDateSections } from "@/lib/salesGrouping";
import { pkDate, pkDateFromISO, pkToday, pkYesterday, pkWeekStart, pkMonthStart } from "@/lib/pkDate";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  if (!name) return colors[0];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

type Tab = "all" | "credit" | "paid";
type DateFilter = "today" | "yesterday" | "this_week" | "this_month" | "custom";
type SortKey = "newest" | "oldest" | "highest" | "lowest";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest First" },
  { key: "oldest", label: "Oldest First" },
  { key: "highest", label: "Highest Amount" },
  { key: "lowest", label: "Lowest Amount" },
];

export default function AdminSalesListPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [tab, setTab] = useState<Tab>((state?.tab as Tab) ?? "all");
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(state?.employeeId ?? null);
  const [dateFilter, setDateFilter] = useState<DateFilter>(state?.dateFilter ?? "today");
  const [showDateModal, setShowDateModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Live sales from Supabase (real-time) — loaded + subscribed globally by the layout.
  const allSales: Sale[] = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  const mockEmployees = useEmployeesStore((s) => s.employees);

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  const now = useCurrentTime();
  const today = now;
  const todayStr = pkToday();
  const yesterdayStr = pkYesterday();

  function inDate(sale: Sale) {
    const d = pkDateFromISO(sale.createdAt);
    if (dateFilter === "today")     return d === todayStr;
    if (dateFilter === "yesterday") return d === yesterdayStr;
    if (dateFilter === "this_month") return d >= pkMonthStart();
    if (dateFilter === "this_week") return d >= pkWeekStart();
    if (dateFilter === "custom") {
      if (customFrom && customTo) return d >= customFrom && d <= customTo;
      if (customFrom) return d >= customFrom;
      if (customTo) return d <= customTo;
      return true;
    }
    return true;
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

  const filtered = allSales
    .filter((s) => !s.isVoided && inDate(s))
    .filter(inTab)
    .filter(inQuery)
    .filter((s) => !employeeFilter || s.employeeId === employeeFilter)
    .sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sort === "highest") return b.totalAmount - a.totalAmount;
      return a.totalAmount - b.totalAmount;
    });
  const total     = filtered.reduce((s, x) => s + x.totalAmount, 0);
  const profit    = Math.round(total * 0.2);
  const paidSalesAmount = filtered.filter(s => s.paymentType === "full").reduce((s, x) => s + x.totalAmount, 0);
  const creditSalesAmount = filtered.reduce((s, x) => s + Math.max(0, x.totalAmount - x.amountPaid), 0);

  const DATE_FILTERS: { key: DateFilter; label: string }[] = [
    { key: "today",       label: t("sales.today") },
    { key: "yesterday",   label: t("sales.yesterday") },
    { key: "this_week",   label: t("sales.thisWeek") },
    { key: "this_month",  label: t("sales.thisMonth") ?? "This Month" },
    { key: "custom",      label: t("sales.customFilter") },
  ];

  const todayISO = pkToday();

  function applyCustomDates() {
    setShowDateModal(false);
    setDateFilter("custom");
  }

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

      {/* Summary strip */}
      <div
        className="mx-4 rounded-[var(--radius-tile)] px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--surface-2)" }}
      >
        <p className="text-10 uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
          {summaryLabel}
        </p>
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
          {formatCurrency(total)}
        </p>
      </div>

      {/* ── Paid Sales · Credit Sales · Gross Profit ── */}
      <div className="px-4 pt-3 flex gap-2">
        <div className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1 items-start" style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}>
          <p className="text-10 uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("inline.paid_sales")}
          </p>
          <p className="text-16 font-bold" style={{ color: "var(--brand-dark)" }}>
            {formatCurrency(paidSalesAmount)}
          </p>
        </div>
        <div className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1 items-start" style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}>
          <p className="text-10 uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("inline.credit_sales")}
          </p>
          <p className="text-16 font-bold" style={{ color: "#ef4444" }}>
            {formatCurrency(creditSalesAmount)}
          </p>
        </div>
        <div className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1 items-start" style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}>
          <p className="text-10 uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("admin.grossProfit")}
          </p>
          <p className="text-16 font-bold" style={{ color: "var(--brand-dark)" }}>
            {formatCurrency(profit)}
          </p>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="px-4 pt-3 flex gap-2 items-center">
        <SearchBar
          containerClass="flex-1 min-w-0"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("sales.searchPlaceholder")}
        />
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
          >
            <SlidersHorizontal size={15} style={{ color: "var(--text-primary)" }} />
          </button>
          {showSortMenu && (
            <div
              ref={(el) => {
                if (el && showSortMenu) {
                  const handler = (e: MouseEvent) => { if (!el.parentElement?.contains(e.target as Node)) setShowSortMenu(false); };
                  setTimeout(() => document.addEventListener("click", handler, { once: true }), 0);
                }
              }}
              className="absolute right-0 top-12 w-52 rounded-[var(--radius-card)] shadow-xl overflow-hidden z-50"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => { setSort(opt.key); setShowSortMenu(false); }}
                  className="flex items-center justify-between w-full px-4 py-3.5 text-start transition-colors active:bg-black/5"
                  style={{ borderBottom: "1px solid var(--divider)" }}
                >
                  <span className="text-13 font-medium" style={{ color: sort === opt.key ? "var(--brand-dark)" : "var(--text-primary)" }}>
                    {opt.label}
                  </span>
                  {sort === opt.key && <Check size={16} style={{ color: "var(--brand)" }} />}
                </button>
              ))}
            </div>
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
        ))}      </div>

      {/* Employee filter badge */}
      {employeeFilter && (
        <div className="px-4 pt-2 flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
            {mockEmployees.find((e) => e.id === employeeFilter)?.name ?? t("common.employee")}
            <X size={12} className="inline-block" />
          </span>
          <button onClick={() => setEmployeeFilter(null)} className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {t("common.clearFilter")}
          </button>
        </div>
      )}

      {/* Date filters — horizontally scrollable with fade indicator */}
      <div className="relative">
        <div
          ref={(el) => {
            if (!el) return;
            const update = () => {
              const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
              el.parentElement!.style.setProperty("--show-fade", atEnd ? "0" : "1");
            };
            el.addEventListener("scroll", update, { passive: true });
            update();
          }}
          className="flex gap-2 px-4 py-3 overflow-x-auto"
          style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
        >
          {DATE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                if (key === "custom") {
                  setShowDateModal(true);
                } else {
                  setDateFilter(key);
                }
              }}
              className="h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5"
              style={{
                background: dateFilter === key ? "var(--brand)" : "var(--surface-2)",
                color: dateFilter === key ? "#0a0a0a" : "var(--text-secondary)",
              }}
            >
              {key === "custom" && <Calendar size={12} />}
              {label}
              {key === "custom" && customFrom && (
                <span className="text-9 opacity-70">({customFrom} → {customTo || "..."})</span>
              )}
            </button>
          ))}
        </div>
        {/* Fade indicator on right edge */}
        <div
          className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none transition-opacity"
          style={{
            background: `linear-gradient(to right, transparent, var(--background))`,
            opacity: "var(--show-fade, 1)",
          }}
        />
      </div>

      {/* Custom Date Range Modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowDateModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-t-2xl p-5 pb-8 animate-slide-up"
            style={{ background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.selectDateRange")}</p>
              <button onClick={() => setShowDateModal(false)} className="text-xl" style={{ color: "var(--text-secondary)" }}>×</button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-11 font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.from")}</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  max={todayISO}
                  className="w-full outline-none"
                />
              </div>
              <div className="flex-1">
                <label className="text-11 font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.to")}</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  max={todayISO}
                  min={customFrom || undefined}
                  className="w-full outline-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setCustomFrom(""); setCustomTo(""); setDateFilter("custom"); setShowDateModal(false); }}
                className="flex-1 h-10 rounded-[var(--radius-tile)] text-13 font-semibold"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
              >
                {t("reports.clear")}
              </button>
              <button
                onClick={applyCustomDates}
                className="flex-1 h-10 rounded-[var(--radius-tile)] text-13 font-bold"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {t("reports.apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sales list with date sections */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <ClipboardList size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("sales.noSales")}</p>
          <button
            onClick={() => navigate("/admin/sale")}
            className="h-10 px-5 rounded-full text-13 font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {t("saleSuccess.newSale")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col pb-8">
          {groupSalesByDateSections(filtered, now).map((section) => (
            <div key={section.label} className="mt-4">
              <div className="px-4 mb-2">
                <p className="text-11 font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  {section.label}
                </p>
              </div>
              <ListCard className="mx-4">
                {section.sales.map((sale) => {
                  const cImg = getCustomerImg(sale.customerId);
                  const cBg = initBgColor(sale.customerName);
                  return (
                  <ListRow
                    key={sale.id}
                    onClick={() => navigate(`/admin/sales/${sale.id}`)}
                    tile={cImg ? (
                      <img src={cImg} alt={sale.customerName} className="size-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="size-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: cBg, color: "#fff" }}>
                        {(sale.customerName || '?').charAt(0).toUpperCase()}
                      </div>
                    )}
                    trailing={
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                          {formatCurrency(sale.totalAmount)}
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
                      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatSmartDateTime(sale.createdAt, now, t)}</p>
                      <p className="text-11 font-medium mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("saleDetail.soldBy")}: {sale.employeeName}</p>
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
