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

type Filter = "all" | "month" | "3months";

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

  if (!customer) return null;

  const sales  = allSales.filter((s) => s.customerId === customerId && !s.isVoided);
  const health = getCreditHealth(customer.outstandingBalance, customer.creditLimit);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all",     label: isUrdu ? "تمام خریداری"     : "All Purchases" },
    { key: "month",   label: isUrdu ? "اس مہینے"         : "This Month" },
    { key: "3months", label: isUrdu ? "پچھلے 3 مہینے"   : "Last 3 Months" },
  ];

  function inFilter(sale: (typeof sales)[0]) {
    if (filter === "all") return true;
    const d = new Date(sale.createdAt);
    const now = new Date();
    if (filter === "month") return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 3);
    return d >= cutoff;
  }

  const filtered = sales.filter(inFilter);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("customerProfile.purchaseHistory")}
        backLabel={t("customers.title")}
        backTo={`${base}/customers/${customerId}`}
      />

      {/* Customer strip */}
      <div className="mx-4 mt-3 rounded-[14px] p-4" style={{ background: "var(--surface-2)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{customer.name}</p>
          <CreditHealthBadge health={health} />
        </div>
        <div className="flex gap-8">
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
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 pt-4 pb-2 overflow-x-auto">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filter === key ? "var(--brand)" : "var(--surface-2)",
              color: filter === key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

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
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatDate(sale.createdAt)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {sale.items.map((it) => it.productName).join(", ")}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {t("sales.soldBy")} {sale.employeeName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
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
