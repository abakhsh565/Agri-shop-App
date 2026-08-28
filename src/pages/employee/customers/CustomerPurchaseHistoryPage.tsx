import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { PaymentBadge, CreditHealthBadge } from "@/components/ui/Badge";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { formatCurrency, formatDate, getCreditHealth } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";

function initBgColor(name: string) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

type Filter = "all" | "month" | "3months" | "custom";

export default function CustomerPurchaseHistoryPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const allSales = useSalesStore((s) => s.sales);
  const [filter, setFilter] = useState<Filter>("all");
  const [showDateModal, setShowDateModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  if (!customer) return null;

  const sales  = allSales.filter((s) => s.customerId === customerId && !s.isVoided);
  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all",     label: isUrdu ? "تمام خریداری"     : "All" },
    { key: "month",   label: isUrdu ? "اس مہینے"         : "This Month" },
    { key: "3months", label: isUrdu ? "پچھلے 3 مہینے"   : "3 Months" },
    { key: "custom",  label: "Custom" },
  ];

  const todayISO = new Date().toISOString().split("T")[0];

  function inFilter(sale: (typeof sales)[0]) {
    if (filter === "all") return true;
    const d = new Date(sale.createdAt);
    const now = new Date();
    if (filter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (filter === "3months") { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3); return d >= cutoff; }
    if (filter === "custom") {
      const ds = sale.createdAt.split("T")[0];
      if (customFrom && customTo) return ds >= customFrom && ds <= customTo;
      if (customFrom) return ds >= customFrom;
      if (customTo) return ds <= customTo;
      return true;
    }
    return true;
  }

  const filtered = sales.filter(inFilter);
  const totalSalesAmount = filtered.reduce((s, x) => s + x.totalAmount, 0);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("customerProfile.purchaseHistory")}
       
       
      />

      {/* Hero Card — customer image + name */}
      <div className="mx-4 mt-3 rounded-[14px] p-4" style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}>
        <div className="flex items-center gap-3 mb-3">
          {customer.imageUrl ? (
            <img src={customer.imageUrl} alt={customer.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-sm font-bold" style={{ background: initBgColor(customer.name), color: "#fff" }}>
              {customer.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="text-base font-bold truncate" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
              <CreditHealthBadge health={health} />
            </div>
            {customer.phone && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{customer.phone}</p>}
          </div>
        </div>
        <div className="flex gap-6">
          <div>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>
              {t("customers.outstanding")}
            </p>
            <p className="text-sm font-bold" style={{ color: customer.outstandingBalance > 0 ? "#d97706" : "var(--text-primary)" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>
              {t("customers.creditLimit")}
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.creditLimit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>
              Total Sales
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(totalSalesAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 pt-4 pb-2 overflow-x-auto">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => { if (key === "custom") { setShowDateModal(true); } else { setFilter(key); } }}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-semibold whitespace-nowrap transition-colors"
            style={{
              background: filter === key ? "var(--brand)" : "var(--surface-2)",
              color: filter === key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {label}
            {key === "custom" && customFrom && (
              <span className="text-[9px] opacity-70"> ({customFrom}→{customTo || "..."})</span>
            )}
          </button>
        ))}
      </div>

      {/* Custom Date Range Modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowDateModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-t-2xl p-5 pb-8 animate-slide-up" style={{ background: "var(--surface)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>Select Date Range</p>
              <button onClick={() => setShowDateModal(false)} className="text-xl" style={{ color: "var(--text-secondary)" }}>×</button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-secondary)" }}>From</label>
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} max={todayISO} className="w-full h-10 px-3 rounded-xl text-[13px] outline-none" style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }} />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: "var(--text-secondary)" }}>To</label>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} max={todayISO} min={customFrom || undefined} className="w-full h-10 px-3 rounded-xl text-[13px] outline-none" style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); setFilter("custom"); setShowDateModal(false); }} className="flex-1 h-10 rounded-xl text-[13px] font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>Clear</button>
              <button onClick={() => { setShowDateModal(false); setFilter("custom"); }} className="flex-1 h-10 rounded-xl text-[13px] font-bold" style={{ background: "var(--brand)", color: "#0a0a0a" }}>Apply</button>
            </div>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <p className="text-3xl">🧾</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {isUrdu ? "اس مدت میں کوئی خریداری نہیں" : "No purchases in this period"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col mx-4">
          {filtered.map((sale, i) => (
            <button
              key={sale.id}
              onClick={() => navigate(`${base}/sales/${sale.id}`)}
              className="py-4 text-left transition-opacity active:opacity-70"
              style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                    {formatDate(sale.createdAt)}
                  </p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
                    {sale.items.map((it) => it.productName).join(", ")}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {t("sales.soldBy")} {sale.employeeName}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 ml-3">
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(sale.totalAmount)}
                  </span>
                  <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
