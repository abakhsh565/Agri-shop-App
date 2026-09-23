import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import PullToRefresh from "@/components/ui/PullToRefresh";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { Plus, ChevronRight, SlidersHorizontal, Check, UserRound } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";
import { getCreditHealth, calculateCreditHealth, getCreditHealthStatusColor } from "@/lib/formatters";
import type { Customer } from "@/types";
import { useSalesStore } from "@/stores/salesStore";

type SortKey = "outstanding" | "name" | "recent";

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "outstanding", labelKey: "sale.highestAmount" },
  { key: "name", labelKey: "sale.recentlyAdded" },
  { key: "recent", labelKey: "sale.recentlyAdded" },
];

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899","#ef4444","#10b981"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function sortCustomers(list: Customer[], sort: SortKey): Customer[] {
  const sorted = [...list];
  if (sort === "outstanding") {
    sorted.sort((a, b) => b.outstandingBalance - a.outstandingBalance);
  } else if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  return sorted;
}

export default function CustomersListPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);

  const initialFilter = state?.filter === "credit" ? "credit" : "all";
  const cropFilter = state?.cropFilter as string | undefined;
  const [creditFilter, setCreditFilter] = useState<"all" | "credit">(initialFilter);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("outstanding");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Close sort menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    }
    if (showSortMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSortMenu]);

  // Load customer crops for filtering
  const getCustomerCrops = (customerId: string): string[] => {
    try {
      const raw = localStorage.getItem("customer_crops_" + customerId);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const filtered = customers.filter((c) =>
    (c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)) &&
    !c.isArchived &&
    (creditFilter === "all" || c.outstandingBalance > 0) &&
    (!cropFilter || getCustomerCrops(c.id).includes(cropFilter))
  );

  const sorted = sortCustomers(filtered, sort);
  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingBalance, 0);
  const onCredit = customers.filter((c) => c.outstandingBalance > 0).length;

  async function handleRefresh() {
    await useCustomersStore.getState().load();
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="flex items-center px-4 pt-1 pb-2">
        <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
          {t("customers.title")}
        </p>
      </div>

      {/* Summary strip */}
      <div className="px-4 pb-3">
        <div
          className="rounded-[var(--radius-tile)] px-4 py-3 flex items-center justify-between"
          style={{ background: "var(--surface-2)" }}
        >
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("common.outstanding")}
            </p>
            <p className="text-20 font-bold mt-0.5" style={{ color: "#d97706" }}>
              {formatCurrency(totalOutstanding)}
            </p>
          </div>
          <div className="text-end">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("sale.onCredit")}
            </p>
            <p className="text-20 font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {onCredit} / {customers.length}
            </p>
          </div>
        </div>
      </div>

      {/* Search + Sort */}
      <div className="px-4 pb-3 flex gap-2 items-center">
        <SearchBar
          containerClass="flex-1 min-w-0"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("customers.search")}
        />

        {/* Sort button */}
        <div className="relative" ref={sortMenuRef}>
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            aria-label={t("common.sort")}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
          >
            <SlidersHorizontal size={15} style={{ color: "var(--text-primary)" }} />
          </button>

          {/* Sort dropdown */}
          {showSortMenu && (
            <div
              className="absolute end-0 top-12 w-52 rounded-[var(--radius-card)] shadow-xl overflow-hidden z-50 animate-scale-in"
              style={{ background: "var(--tone-card)" }}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => { setSort(opt.key); setShowSortMenu(false); }}
                  className="flex items-center justify-between w-full px-4 py-3.5 text-start transition-colors active:bg-black/5"
                  style={{ borderBottom: "1px solid var(--divider)" }}
                >
                  <span
                    className="text-13 font-medium"
                    style={{ color: sort === opt.key ? "var(--brand-dark)" : "var(--text-primary)" }}
                  >
                    {t(opt.labelKey as any)}
                  </span>
                  {sort === opt.key && <Check size={16} style={{ color: "var(--brand)" }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 px-4 pb-3 flex-wrap">
        {cropFilter && (
          <div
            className="h-8 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5"
            style={{ background: "var(--brand-light, #d9f99d)", color: "var(--brand-dark, #65a30d)" }}
          >
            {cropFilter}
            <button onClick={() => navigate(".", { state: { ...state, cropFilter: undefined } })} className="ms-0.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
        {[{ key: "all", labelKey: "sale.allCustomers" }, { key: "credit", labelKey: "sale.onCredit" }].map((f) => (
          <button
            key={f.key}
            onClick={() => setCreditFilter(f.key as "all" | "credit")}
            className="h-8 px-4 rounded-full text-xs font-semibold transition-colors"
            style={{
              background: creditFilter === f.key ? "var(--brand)" : "var(--surface-2)",
              color: creditFilter === f.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {t(f.labelKey as any)}
          </button>
        ))}
      </div>

      {/* Customer list */}
      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <UserRound size={32} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-15 font-semibold" style={{ color: "var(--text-primary)" }}>
            {search ? t("sale.noCustomersMatch") : t("sale.noCustomersYet")}
          </p>
          {!search && (
            <p className="text-13" style={{ color: "var(--text-secondary)" }}>
              {t("customers.addNew")}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col px-4 gap-2 pb-24">
          {sorted.map((c) => {
            const bg = initBgColor(c.name);
            const hasDebt = c.outstandingBalance > 0;
            const creditUsed = c.creditLimit > 0
              ? Math.min(100, Math.round((c.outstandingBalance / c.creditLimit) * 100))
              : 0;

            return (
              <button
                key={c.id}
                onClick={() => navigate(`${base}/customers/${c.id}`)}
                className="flex items-center gap-3 p-3 rounded-[var(--radius-card)] text-start transition-all active:scale-[0.98]"
                style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
              >
                {/* Avatar */}
                {c.imageUrl ? (
                  <img
                    src={c.imageUrl}
                    alt={c.name}
                    className="rounded-full shrink-0 size-[46px] object-cover"
                  />
                ) : (
                  <div
                    className="flex items-center justify-center rounded-full shrink-0 size-[46px] text-16 font-bold"
                    style={{ background: bg, color: "#fff" }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-14 font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {c.name}
                  </p>
                  <p className="text-12" style={{ color: "var(--text-secondary)" }}>{c.phone}</p>
                  {/* Credit usage bar + status */}
                  {c.creditLimit > 0 ? (
                    <div className="mt-1.5">
                      <div className="w-full h-1.5 rounded-full" style={{ background: "var(--divider)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${creditUsed}%`,
                            background: creditUsed >= 90 ? "#ef4444" : creditUsed >= 70 ? "#f59e0b" : "#22c55e",
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-10" style={{ color: "var(--text-secondary)" }}>
                          {creditUsed}{t("credit.percentUsed")}
                        </p>
                        {(() => { const sc = useSalesStore.getState().sales.filter((s) => s.customerId === c.id); const scCount = sc.length; const fullTotal = sc.filter((s) => s.paymentType === "full").reduce((a, s) => a + s.totalAmount, 0); const ep = c.totalPaid + fullTotal; const hasCredit = sc.some((s) => s.paymentType !== "full"); const ch = calculateCreditHealth(c, scCount, null, ep, hasCredit); const chColor = getCreditHealthStatusColor(ch.status); const hlKey = ch.status === 'green' ? 'credit.reliable' : ch.status === 'yellow' ? 'credit.caution' : ch.status === 'red' ? 'credit.risk' : ch.status === 'cash_customer' ? 'credit.cashCustomer' : 'credit.notEnoughHistory'; return (<span className="text-9 font-bold px-1.5 py-0.5 rounded-full" style={{ color: chColor, background: chColor + "22" }}>{t(hlKey as any)}</span>); })()}
                      </div>
                    </div>
                  ) : (
                    <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
                      {t("customers.creditLimit")} — {"—"}
                    </p>
                  )}
                </div>

                {/* Right side */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {hasDebt ? (
                    <>
                      <span className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>
                        {formatCurrency(c.outstandingBalance)}
                      </span>
                      <span
                        className="text-10 font-semibold"
                        style={{ color: "#22c55e" }}
                      >
                        {t("customers.outstanding")}
                      </span>
                    </>
                  ) : (
                    <span className="text-11 font-medium" style={{ color: "var(--text-secondary)" }}>
                      {t("customers.noOutstanding")}
                    </span>
                  )}
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Add Customer */}
      <div
        className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate(`${base}/customers/new`)}
            className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-sm font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> {t("customers.addNew")}
          </button>
        </div>
      </div>
    </div>
    </PullToRefresh>
  );
}
