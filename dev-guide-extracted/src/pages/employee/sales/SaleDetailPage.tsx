import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { PaymentBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { ChevronRight, RotateCcw } from "lucide-react";

export default function SaleDetailPage() {
  const { saleId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const liveSales = useSalesStore((s) => s.sales);
  const sale = liveSales.find((s) => s.id === saleId);

  if (!sale) return (
    <div className="flex flex-col w-full min-h-full items-center justify-center" style={{ background: "var(--background)" }}>
      <p style={{ color: "var(--text-secondary)" }}>Sale not found</p>
    </div>
  );

  const summaryRows = [
    { label: t("sale.subtotal"),             value: formatCurrency(sale.subtotal) },
    { label: t("sales.amountPaid"),          value: formatCurrency(sale.amountPaid) },
    ...(sale.outstandingBalance > 0
      ? [{ label: t("sales.outstandingBalance"), value: formatCurrency(sale.outstandingBalance) }]
      : []),
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("sales.saleDetails")} backLabel={t("sales.title")} backTo="/employee/sales" />

      <div className="flex flex-col gap-4 p-4">
        {/* Customer card */}
        <button
          onClick={() => navigate(`/employee/customers/${sale.customerId}`)}
          className="flex items-center justify-between rounded-[14px] p-4 text-left w-full transition-opacity active:opacity-70"
          style={{ border: "1px solid var(--divider)", background: "var(--surface-2)" }}
        >
          <div>
            <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{formatDateTime(sale.createdAt)}</p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("sales.employee")}: {sale.employeeName}
            </p>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
        </button>

        {/* Items sold */}
        <div>
          <p className="text-xs font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
            {t("sales.itemsSold")}
          </p>
          <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--divider)" }}>
            {sale.items.map((item, i) => (
              <div
                key={item.id}
                className="flex justify-between p-4"
                style={{ borderBottom: i < sale.items.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                    {item.productName} {item.variantName}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(item.unitPrice)} × {item.qty}
                  </p>
                </div>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(item.lineTotal)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Payment summary */}
        <div
          className="rounded-[14px] p-4 flex flex-col gap-2"
          style={{ border: "1px solid var(--divider)" }}
        >
          {summaryRows.map((row) => (
            <div key={row.label} className="flex justify-between">
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{row.label}</span>
              <span
                className="text-sm font-bold"
                style={{ color: row.label === t("sales.outstandingBalance") ? "#d97706" : "var(--text-primary)" }}
              >
                {row.value}
              </span>
            </div>
          ))}
          <div
            className="flex justify-between items-center pt-2 mt-1"
            style={{ borderTop: "1px solid var(--divider)" }}
          >
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {t("sales.method")}: {sale.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer")}
              </p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("sales.status")}</p>
            </div>
            <PaymentBadge type={sale.paymentType} outstandingBalance={sale.outstandingBalance} />
          </div>
        </div>

        {/* Return button */}
        <button
          onClick={() => navigate(`/employee/sales/${sale.id}/return`)}
          className="flex items-center justify-center gap-2 w-full h-12 rounded-full font-semibold text-sm transition-all active:scale-[0.98]"
          style={{ border: "1.5px solid var(--divider)", color: "var(--text-primary)", background: "transparent" }}
        >
          <RotateCcw size={15} />
          {t("sales.return")}
        </button>
      </div>
    </div>
  );
}
