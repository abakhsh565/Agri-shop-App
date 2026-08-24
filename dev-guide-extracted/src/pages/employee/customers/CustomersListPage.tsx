import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useCustomersStore } from "@/stores/customersStore";
import { formatCurrency, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { Plus, Search, ChevronRight, SlidersHorizontal } from "lucide-react";

type SortMode = "outstanding" | "name" | "recent";

const CREDIT_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  good:      { bg: "rgba(132,204,22,0.12)", dot: "#84cc16",  text: "#65a30d" },
  warning:   { bg: "rgba(245,158,11,0.12)", dot: "#f59e0b",  text: "#d97706" },
  over_limit:{ bg: "rgba(239,68,68,0.12)",  dot: "#ef4444",  text: "#dc2626" },
};

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function CustomersListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const ready = useCustomersStore((s) => s.ready);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("outstanding");
  const [showSort, setShowSort] = useState(false);

  const SORT_OPTIONS: { key: SortMode; label: string }[] = [
    { key: "outstanding", label: isUrdu ? "سب سے زیادہ بقایا" : "Highest Outstanding" },
    { key: "name",        label: isUrdu ? "نام (A-Z)"         : "Name (A–Z)" },
    { key: "recent",      label: isUrdu ? "حالیہ پہلے"        : "Recently Added" },
  ];

  const filtered = customers
    .filter((c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
    )
    .sort((a, b) => {
      if (sort === "outstanding") return b.outstandingBalance - a.outstandingBalance;
      if (sort === "name")        return a.name.localeCompare(b.name);
      return 0;
    });

  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingBalance, 0);
  const withBalance      = customers.filter((c) => c.outstandingBalance > 0).length;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* ── Header ── */}
      <div className="flex items-center px-4 pt-1 pb-2">
        <p className="text-[20px] font-bold" style={{ color: "var(--text-primary)" }}>
          {t("customers.title")}
        </p>
      </div>

      {/* ── Summary strip ── */}
      <div className="px-4 pb-3">
        <div
          className="rounded-[12px] px-4 py-3 flex items-center justify-between"
          style={{ background: "var(--surface-2)" }}
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {isUrdu ? "کل بقایا" : "Total Outstanding"}
            </p>
            <p
              className="text-[18px] font-bold mt-0.5"
              style={{ color: totalOutstanding > 0 ? "#d97706" : "var(--brand-dark)" }}
            >
              {formatCurrency(totalOutstanding)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              {isUrdu ? "ادھار پر گاہک" : "On Credit"}
            </p>
            <p className="text-[18px] font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
              {withBalance} / {customers.length}
            </p>
          </div>
        </div>
      </div>

      {/* ── Search + sort ── */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div
          className="flex items-center gap-2 flex-1 h-10 rounded-full px-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("customers.search")}
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ color: "var(--text-secondary)" }}>×</button>
          )}
        </div>

        {/* Sort button */}
        <div className="relative">
          <button
            onClick={() => setShowSort((v) => !v)}
            className="flex items-center justify-center size-10 rounded-full transition-colors"
            style={{
              background: showSort ? "var(--brand)" : "var(--surface-2)",
              border: "1px solid var(--divider)",
              color: showSort ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            <SlidersHorizontal size={15} />
          </button>
          {showSort && (
            <div
              className="absolute right-0 top-12 w-52 rounded-[12px] overflow-hidden z-20 shadow-xl animate-scale-in"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => { setSort(opt.key); setShowSort(false); }}
                  className="flex items-center justify-between w-full px-4 py-3 text-[13px] font-medium"
                  style={{
                    color: sort === opt.key ? "var(--brand-dark)" : "var(--text-primary)",
                    background: sort === opt.key ? "rgba(132,204,22,0.1)" : "transparent",
                    borderBottom: "1px solid var(--divider)",
                  }}
                >
                  {opt.label}
                  {sort === opt.key && <span style={{ color: "var(--brand-dark)" }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Customer list ── */}
      {!ready ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {t("common.loading")}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <p className="text-4xl">👤</p>
          <p className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("customers.noneFound")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col px-4 gap-3 pb-24">
          {filtered.map((c, i) => {
            const health  = getCreditHealth(c.outstandingBalance, c.creditLimit);
            const clr     = CREDIT_COLORS[health];
            const bg      = initBgColor(c.name);
            const hasDebt = c.outstandingBalance > 0;

            return (
              <button
                key={c.id}
                onClick={() => navigate(`${base}/customers/${c.id}`)}
                className="flex items-center gap-3 p-3 rounded-[14px] text-left transition-all active:scale-[0.98] animate-fade-in-up"
                style={{
                  background: "var(--surface-2)",
                  animationDelay: `${i * 40}ms`,
                }}
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
                    className="flex items-center justify-center rounded-full shrink-0 size-[46px] text-[16px] font-bold"
                    style={{ background: bg, color: "#fff" }}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                    {c.name}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{c.phone}</p>

                  {/* Credit usage bar */}
                  {c.creditLimit > 0 && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="h-1 rounded-full flex-1 max-w-[80px]" style={{ background: "var(--divider)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (c.outstandingBalance / c.creditLimit) * 100)}%`,
                            background: clr.dot,
                          }}
                        />
                      </div>
                      <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        {Math.round((c.outstandingBalance / c.creditLimit) * 100)}%{" "}
                        {isUrdu ? "استعمال" : "used"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right — outstanding + chevron */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {hasDebt ? (
                    <>
                      <span
                        className="text-[13px] font-bold"
                        style={{
                          color: health === "over_limit" ? "#dc2626"
                               : health === "warning"    ? "#d97706"
                               : "var(--text-primary)",
                        }}
                      >
                        {formatCurrency(c.outstandingBalance)}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: clr.bg, color: clr.text }}
                      >
                        {t("customers.outstanding")}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px]" style={{ color: "var(--brand-dark)" }}>
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

      {/* Floating Add Customer — mirrors Add Product, stays above the tab bar */}
      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate(`${base}/customers/new`)}
            className="pointer-events-auto pl-4 pr-5 rounded-full flex items-center gap-2 text-sm font-bold active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> {t("customers.addNew")}
          </button>
        </div>
      </div>
    </div>
  );
}
