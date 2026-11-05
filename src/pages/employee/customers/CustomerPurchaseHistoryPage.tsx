import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import DateField from "@/components/ui/DateField";
import { PaymentBadge, CreditHealthBadge } from "@/components/ui/Badge";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { formatCurrency, formatDate, getCreditHealth } from "@/lib/formatters";
import { pkToday, pkDateFromISO } from "@/lib/pkDate";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useAuthStore } from "@/stores/authStore";
import { useShellBase } from "@/lib/useShellBase";
import { ReceiptText } from "lucide-react";
import { SkeletonList } from "@/components/ui/Skeleton";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

type Filter = "all" | "month" | "3months" | "custom";

export default function CustomerPurchaseHistoryPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const base = useShellBase();
  const { user } = useAuthStore();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customer = useCustomersStore((s) => s.customers.find((c) => c.id === customerId));
  const allSales = useSalesStore((s) => s.sales);
  // Read both stores unconditionally: short-circuiting a hook call is what
  // crashed this screen, since React must see the same hooks every render.
  const salesReady = useSalesStore((s) => s.ready);
  const customersReady = useCustomersStore((s) => s.ready);
  const ready = salesReady && customersReady;
  const [filter, setFilter] = useState<Filter>("all");
  const [showDateModal, setShowDateModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  if (!customer) return ready ? null : <SkeletonList rows={4} />;

  const sales  = allSales.filter((s) => s.customerId === customerId && !s.isVoided);
  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all",     label: t("sales.all") },
    { key: "month",   label: t("sales.thisMonth") },
    { key: "3months", label: t("inline.3_months") },
    { key: "custom",  label: "Custom" },
  ];

  const todayISO = pkToday();

  function inFilter(sale: (typeof sales)[0]) {
    if (filter === "all") return true;
    const d = new Date(sale.createdAt);
    const now = new Date();
    if (filter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    if (filter === "3months") { const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3); return d >= cutoff; }
    if (filter === "custom") {
      const ds = pkDateFromISO(sale.createdAt);
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
        historyBack
        
      />

      {/* Hero Card — customer image + name */}
      <div className="mx-4 mt-3 rounded-[var(--radius-card)] p-4" style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}>
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
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("customers.outstanding")}
            </p>
            <p className="text-sm font-bold" style={{ color: customer.outstandingBalance > 0 ? "#d97706" : "var(--text-primary)" }}>
              {formatCurrency(customer.outstandingBalance)}
            </p>
          </div>
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("customers.creditLimit")}
            </p>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(customer.creditLimit)}
            </p>
          </div>
          <div>
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("admin.totalSales")}
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
              <span className="text-9 opacity-70"> ({customFrom}→{customTo || "..."})</span>
            )}
          </button>
        ))}
      </div>

      {/* Custom Date Range Modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowDateModal(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md rounded-t-2xl p-5 pb-8 animate-slide-up" style={{ background: "var(--tone-sheet)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.selectDateRange")}</p>
              <button onClick={() => setShowDateModal(false)} className="text-xl" style={{ color: "var(--text-secondary)" }}>×</button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="ds-section-label mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.from")}</label>
                <DateField
                  value={customFrom}
                  max={customTo || todayISO}
                  onChange={setCustomFrom}
                  testId="history-from"
                />
              </div>
              <div className="flex-1">
                <label className="ds-section-label mb-1 block" style={{ color: "var(--text-secondary)" }}>{t("admin.to")}</label>
                <DateField
                  value={customTo}
                  min={customFrom || undefined}
                  max={todayISO}
                  onChange={setCustomTo}
                  testId="history-to"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); setFilter("custom"); setShowDateModal(false); }} className="flex-1 h-10 rounded-[var(--radius-tile)] text-13 font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{t("reports.clear")}</button>
              <button onClick={() => { setShowDateModal(false); setFilter("custom"); }} className="flex-1 h-10 rounded-[var(--radius-tile)] text-13 font-bold" style={{ background: "var(--text-primary)", color: "var(--background)" }}>{t("reports.apply")}</button>
            </div>
          </div>
        </div>
      )}

      {!ready ? (
        <SkeletonList rows={4} tile />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-2">
          <ReceiptText size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {t("inline.no_purchases_in_this_period")}
          </p>
        </div>
      ) : (
        <ListCard className="mx-4">
          {filtered.map((sale) => (
            <ListRow
              key={sale.id}
              onClick={() => navigate(`${base}/sales/${sale.id}`)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                    {formatDate(sale.createdAt)}
                  </p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>
                    {sale.items.map((it) => it.productName).join(", ")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 ms-3">
                  <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatCurrency(sale.totalAmount)}
                  </span>
                  <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
                </div>
              </div>
            </ListRow>
          ))}
        </ListCard>
      )}
    </div>
  );
}
