import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useProductsStore } from "@/stores/productsStore";
import { summariseSales, profitDisplay } from "@/lib/profit";
import { useCurrentTime } from "@/lib/useCurrentTime";
import type { Sale } from "@/types";
import {
  Calendar,
  CalendarRange,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  Plus,
  Share2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import NavHeader from "@/components/ui/NavHeader";
import Sheet from "@/components/ui/Sheet";
import { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { groupSalesByDateSections } from "@/lib/salesGrouping";
import { netSalesOf, refundsBySale, useReturns } from "@/lib/salesActivity";
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
  const { state, search } = useLocation();
  const t = useT();
  const { language } = useThemeStore();
  const { addToast } = useUIStore();
  const isUrdu = language === "ur";
  const [tab, setTab] = useState<Tab>((state?.tab as Tab) ?? "all");
  const [employeeFilter, setEmployeeFilter] = useState<string | null>(state?.employeeId ?? null);
  const [dateFilter, setDateFilter] = useState<DateFilter>(state?.dateFilter ?? "today");
  const [showDateModal, setShowDateModal] = useState(false);
  // Which question the sheet is answering: a period, or one buyer. Opening it always starts on
  // the period, because the period is what the pill in the header is showing.
  const [sheetMode, setSheetMode] = useState<"date" | "customer">("date");
  const [customerFilter, setCustomerFilter] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // A search started on the Sales section's screen arrives as `?q=` and lands here, where the
  // searching actually happens — one search field, one implementation.
  const [query, setQuery] = useState(() => new URLSearchParams(search).get("q") ?? "");
  const [sort, setSort] = useState<SortKey>("newest");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // Live sales from Supabase (real-time) — loaded + subscribed globally by the layout.
  const allSales: Sale[] = useSalesStore((s) => s.sales);
  const ready = useSalesStore((s) => s.ready);
  const customers = useCustomersStore((s) => s.customers);
  const mockEmployees = useEmployeesStore((s) => s.employees);
  const products = useProductsStore((s) => s.products);
  // Only a fallback for lines whose cost was never snapshotted; the products store holds
  // active products only, so it must never be the primary source.
  const variantCost = new Map<string, number>();
  products.forEach((p) => p.variants.forEach((v) => variantCost.set(v.id, v.costPrice)));
  const liveCost = (id?: string | null) => (id ? variantCost.get(id) : undefined);

  function getCustomerImg(customerId: string) {
    return customers.find((c) => c.id === customerId)?.imageUrl;
  }

  const now = useCurrentTime();
  // Returns, so the list's net figure is sales less the refunds of those same sales. Read once
  // here and spent once; the rule itself lives in `lib/salesActivity`.
  const { returns } = useReturns();
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
    .filter((s) => !customerFilter || s.customerId === customerFilter)
    .filter((s) => !employeeFilter || s.employeeId === employeeFilter)
    .sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (sort === "highest") return b.totalAmount - a.totalAmount;
      return a.totalAmount - b.totalAmount;
    });
  // Sales less their own refunds — the same reading of "net sales" the Sales section shows.
  const refundMap = refundsBySale(returns);
  const netSales  = netSalesOf(filtered, refundMap);
  // What came back on these same sales, stated rather than netted away, so a period with heavy
  // returns is visible instead of only lowering the headline.
  const returnsAmount = filtered.reduce((sum, sale) => sum + (refundMap.get(sale.id) ?? 0), 0);
  // Real cost of goods, from the same calculation Home, the sale record and Reports use.
  // This read `Math.round(total * 0.2)` — a flat fifth of whatever was sold, which was not
  // anybody's margin: it disagreed with Home and with every sale opened from this list, and
  // it was highest on the sales that cost the shop the most.
  const gross     = summariseSales(filtered, liveCost);
  const profitDisplayState = profitDisplay(gross);
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

  /**
   * The list as shown, as a spreadsheet: the same rows, the same order, the same figures the
   * reader can check against the screen. Nothing is re-fetched, so an export can never disagree
   * with the card above it.
   */
  async function exportSales() {
    setActionsOpen(false);
    try {
      const csv = toCsv<Sale>(
        [
          { label: t("receipt.date"), value: (s) => formatSmartDateTime(s.createdAt) },
          { label: t("sales.saleNumber"), value: (s) => s.saleNumber },
          { label: t("common.customer"), value: (s) => s.customerName },
          { label: t("sales.soldBy"), value: (s) => s.employeeName },
          { label: t("common.total"), value: (s) => s.totalAmount },
          { label: t("common.paid"), value: (s) => s.amountPaid },
          { label: t("common.outstanding"), value: (s) => Math.max(0, s.totalAmount - s.amountPaid) },
        ],
        filtered,
      );
      const outcome = await exportCsv(csvFileName("sales"), csv, t("admin.sales"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  /** The same figures as a sentence, for a message to a partner or a supplier. */
  async function shareSummary() {
    setActionsOpen(false);
    const text =
      `${t("admin.sales")} · ${DATE_FILTERS.find((f) => f.key === dateFilter)?.label ?? ""}\n` +
      `${t("sales.netSales")}: ${formatCurrency(netSales)}\n` +
      `${t("inline.credit_sales")}: ${formatCurrency(creditSalesAmount)}\n` +
      `${t("inline.paid_sales")}: ${formatCurrency(paidSalesAmount)}\n` +
      `${t("hub.sales.salesReturns")}: ${formatCurrency(returnsAmount)}`;
    try {
      const outcome = await exportText(text, t("admin.sales"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Back, the section's name, the overflow. No magnifier: the search field is always on the
          screen, so a second door to it only took a slot the actions needed. */}
      <NavHeader
        title={t("admin.sales")}
        backTo="/admin/settings/hub/sales"
        right={
          <SectionActionsButton
            onClick={() => setActionsOpen(true)}
            label={t("sales.actions")}
            testId="sales-actions"
          />
        }
      />

      {/* The section's name, the period it is answering for, and the one control that changes
          that period. The presets used to be a row of five chips over the list; they now live in
          the date sheet behind this pill and behind the overflow's "Date range", so the period
          is stated once instead of competing with the list for attention. */}
      <div className="px-4 pt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-22 font-bold leading-tight">{t("admin.sales")}</h1>
          <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("sales.pageSubtitle")}
          </p>
          <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
            {filtered.length}{" "}
            {t(filtered.length === 1 ? "sales.transactionOne" : "sales.transactions")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDateModal(true)}
          aria-label={t("sales.dateRange")}
          data-testid="sales-date-pill"
          className="shrink-0 flex items-center gap-1.5 h-9 ps-3 pe-3 rounded-full text-12 font-semibold ds-pressable"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
        >
          <ChevronDown size={13} style={{ color: "var(--text-secondary)" }} />
          {DATE_FILTERS.find((f) => f.key === dateFilter)?.label ?? t("sales.selectedPeriod")}
          <Calendar size={13} style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>

      {/* The period's money first, as one flat card: every label starts at the same left edge as
          the number beneath it and nothing is nested inside a second box. Net sales and the profit
          behind it come first, then the four figures that explain it, two by two. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)" }}
          data-testid="sales-summary"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("sales.netSales")}
          </p>
          <p className="text-26 font-bold mt-1 tabular-nums break-words" data-testid="sales-net">
            {formatCurrency(netSales)}
          </p>
          <p
            className="text-11 font-semibold mt-1"
            data-testid="sales-gross-profit"
            style={{
              color:
                profitDisplayState.kind === "unknown"
                  ? "var(--text-secondary)"
                  : gross.profit >= 0
                    ? "var(--success)"
                    : "var(--error)",
            }}
          >
            {profitDisplayState.kind === "unknown"
              ? t("profit.addCostToSeeProfit")
              : `${profitDisplayState.kind === "atLeast" ? "≥ " : ""}${formatCurrency(Math.round(gross.profit))} ${t("admin.grossProfit").toLowerCase()}`}
          </p>

          <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("inline.credit_sales")}
              </p>
              <p className="text-16 font-bold mt-1 tabular-nums break-words" data-testid="sales-credit">
                {formatCurrency(creditSalesAmount)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("inline.paid_sales")}
              </p>
              <p className="text-16 font-bold mt-1 tabular-nums break-words" data-testid="sales-paid">
                {formatCurrency(paidSalesAmount)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("hub.sales.salesReturns")}
              </p>
              <p className="text-16 font-bold mt-1 tabular-nums break-words" data-testid="sales-returns-total">
                {formatCurrency(returnsAmount)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("sales.outstandingCredit")}
              </p>
              <p className="text-16 font-bold mt-1 tabular-nums break-words">
                {formatCurrency(creditSalesAmount)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search and the sort/filter control on one row under the card, then the three types on the
          next row, inline. The field is always present — there is no search mode to enter and no
          magnifier in the app bar opening a second one. */}
      <div ref={searchWrapRef} className="px-4 pt-3 flex gap-2 items-center">
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
            aria-label={t("common.sort")}
            aria-expanded={showSortMenu}
            data-testid="sales-sort"
            className="size-10 rounded-full flex items-center justify-center shrink-0 active:opacity-70"
            style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
          >
            <SlidersHorizontal size={15} />
          </button>
          {showSortMenu && (
            <div
              ref={(el) => {
                if (el && showSortMenu) {
                  const handler = (e: MouseEvent) => { if (!el.parentElement?.contains(e.target as Node)) setShowSortMenu(false); };
                  setTimeout(() => document.addEventListener("click", handler, { once: true }), 0);
                }
              }}
              className="absolute end-0 top-12 w-52 rounded-[var(--radius-card)] shadow-xl overflow-hidden z-50"
              style={{ background: "var(--tone-card)" }}
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

      {/* The three types, in one line under the search, on the same chip row the customer and
          supplier lists use. It scrolls sideways rather than wrapping, so the row keeps its
          height whatever the language. */}
      <div className="flex gap-2 px-4 pt-3 pb-3 overflow-x-auto no-scrollbar">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            data-testid={`sales-tab-${key}`}
            className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
            style={
              tab === key
                ? { background: "var(--brand)", color: "#0a0a0a" }
                : { background: "var(--surface-2)", color: "var(--text-secondary)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* The narrowed view, stated once, with the way out of it. A filter that is applied but
          invisible is a list that looks wrong. */}
      {(customerFilter || employeeFilter) && (
        <div className="px-4 pb-2 flex flex-wrap items-center gap-2">
          {customerFilter && (
            <span
              className="text-xs font-semibold ps-3 pe-2 py-1.5 rounded-full flex items-center gap-1.5"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
              data-testid="sales-customer-chip"
            >
              {customers.find((c) => c.id === customerFilter)?.name ?? t("common.customer")}
              <button
                type="button"
                onClick={() => setCustomerFilter(null)}
                aria-label={t("common.clear")}
                className="flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {employeeFilter && (
            <span
              className="text-xs font-semibold ps-3 pe-2 py-1.5 rounded-full flex items-center gap-1.5"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
            >
              {mockEmployees.find((e) => e.id === employeeFilter)?.name ?? t("common.employee")}
              <button
                type="button"
                onClick={() => setEmployeeFilter(null)}
                aria-label={t("common.clear")}
                className="flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Custom Date Range Modal — now carrying the five presets as well as the two dates, so the
          period pill in the header and the overflow's "Date range" are the only two doors and
          they open the same sheet. */}
      {/* One sheet, two questions (owner's reference, 2026-10-29): which period, or which
          customer. The five presets and the two dates used to be the only thing here, so narrowing
          to one buyer meant scrolling the list. Choosing Customer swaps the From/To fields out —
          they answer a different question and would only be in the way — and shows the accounts
          themselves; choosing a day swaps them back. */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowDateModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md rounded-t-2xl p-5 pb-8 animate-slide-up"
            style={{ background: "var(--tone-sheet)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>
                {sheetMode === "customer" ? t("common.customer") : t("admin.selectDateRange")}
              </p>
              <button onClick={() => setShowDateModal(false)} className="text-xl" style={{ color: "var(--text-secondary)" }}>×</button>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {DATE_FILTERS.filter((f) => f.key !== "custom").map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDateFilter(key);
                    setShowDateModal(false);
                  }}
                  aria-pressed={sheetMode === "date" && dateFilter === key}
                  data-testid={`sales-date-${key}`}
                  className="h-9 px-4 rounded-full text-12 font-semibold"
                  style={
                    sheetMode === "date" && dateFilter === key
                      ? { background: "var(--brand)", color: "var(--ink-fg)" }
                      : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                  }
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setSheetMode((mode) => (mode === "customer" ? "date" : "customer"))}
                aria-pressed={sheetMode === "customer"}
                data-testid="sales-filter-customer"
                className="h-9 px-4 rounded-full text-12 font-semibold"
                style={
                  sheetMode === "customer"
                    ? { background: "var(--brand)", color: "var(--ink-fg)" }
                    : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                }
              >
                {t("common.customer")}
              </button>
            </div>

            {sheetMode === "customer" ? (
              <>
                <SearchBar
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  onClear={() => setCustomerQuery("")}
                  placeholder={t("customers.search")}
                />
                <div className="mt-3 max-h-[46vh] overflow-y-auto flex flex-col gap-1">
                  {customers
                    .filter((c) => {
                      const term = customerQuery.trim().toLowerCase();
                      return !term || c.name.toLowerCase().includes(term) || c.phone.includes(term);
                    })
                    .slice(0, 40)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomerFilter(c.id);
                          setShowDateModal(false);
                        }}
                        data-testid={`sales-customer-${c.id}`}
                        className="flex items-center justify-between gap-3 px-1 py-3 text-start active:opacity-70"
                        style={{ borderBottom: "1px solid var(--divider)" }}
                      >
                        <span className="min-w-0">
                          <span className="block text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                            {c.name}
                          </span>
                          <span className="block text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                            {c.phone}
                          </span>
                        </span>
                        {customerFilter === c.id && <Check size={16} style={{ color: "var(--brand)" }} />}
                      </button>
                    ))}
                  {customers.length === 0 && (
                    <p className="text-13 py-6 text-center" style={{ color: "var(--text-secondary)" }}>
                      {t("customers.noneFound")}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="ds-section-label mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.from")}</label>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      max={todayISO}
                      className="w-full outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="ds-section-label mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.to")}</label>
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
                    className="flex-1 h-12 rounded-[var(--radius-field)] text-13 font-semibold"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  >
                    {t("reports.clear")}
                  </button>
                  <button
                    onClick={applyCustomDates}
                    className="flex-1 h-12 rounded-[var(--radius-field)] text-13 font-bold"
                    style={{ background: "var(--brand)", color: "#0a0a0a" }}
                  >
                    {t("reports.apply")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* The overflow (owner's correction, 2026-10-29). It used to repeat the type filter that is
          already a visible chip row, which is the one thing a menu must never do. What is left is
          what the screen cannot do in a tap: start a sale, move the period, and take the data out
          — the spreadsheet is the list as shown, and sharing is the same figures as a sentence. */}
      <Sheet
        open={actionsOpen}
        title={t("sales.actions")}
        onClose={() => setActionsOpen(false)}
        closeButton={false}
      >
        <div className="px-4 pt-1">
          <ListRow
            testId="sales-action-new"
            icon={Plus}
            title={t("hub.sales.new")}
            description={t("hub.sales.newHint")}
            onClick={() => {
              setActionsOpen(false);
              navigate("/admin/sale");
            }}
          />
          <ListRow
            testId="sales-action-date"
            icon={CalendarRange}
            title={t("sales.dateRange")}
            description={t("sales.dateRangeHint")}
            onClick={() => {
              setActionsOpen(false);
              setShowDateModal(true);
            }}
          />
          <ListRow
            testId="sales-action-export"
            icon={Download}
            title={t("data.export")}
            description={t("data.exportHint")}
            onClick={() => { void exportSales(); }}
          />
          <ListRow
            testId="sales-action-share"
            icon={Share2}
            title={t("sales.shareReport")}
            description={t("sales.shareReportHint")}
            onClick={() => { void shareSummary(); }}
          />
        </div>
      </Sheet>


      {/* Sales list with date sections */}
      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : filtered.length === 0 ? (
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
          <p className="ds-section-label px-4 mt-4" style={{ color: "var(--text-secondary)" }}>
            {t("sales.transactionList")}
          </p>
          {groupSalesByDateSections(filtered, now).map((section) => (
            <div key={section.label} className="mt-4">
              <div className="px-4 mb-2">
                <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
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
