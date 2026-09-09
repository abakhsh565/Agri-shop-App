import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useSalesStore } from "@/stores/salesStore";
import { useThemeStore } from "@/stores/themeStore";
import { formatCurrency, calculateCreditHealth } from "@/lib/formatters";
import { AlertTriangle, ChevronRight } from "lucide-react";

export default function CreditOverridesPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const sales = useSalesStore((s) => s.sales);

  // Find customers with high utilization or poor credit health
  const overrides = customers
    .filter((c) => c.creditLimit > 0 && !c.isArchived)
    .map((c) => {
      const usagePct = Math.round((c.outstandingBalance / c.creditLimit) * 100);
      const customerSales = sales.filter((s) => s.customerId === c.id);
      const salesCount = customerSales.length;
      const fullPaymentSalesTotal = customerSales
        .filter((s) => s.paymentType === "full")
        .reduce((a, s) => a + s.totalAmount, 0);
      const effectivePaid = c.totalPaid + fullPaymentSalesTotal;
      const hasCreditActivity = customerSales.some((s) => s.paymentType !== "full");
      const lastPaymentAt = null;
      const health = calculateCreditHealth(c, salesCount, lastPaymentAt, effectivePaid, hasCreditActivity);
      return { customer: c, usagePct, health, salesCount };
    })
    .filter((o) => o.health.status === "red" || o.usagePct >= 80)
    .sort((a, b) => b.usagePct - a.usagePct);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Credit Overrides" />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Summary banner */}
        <div
          className="rounded-[14px] p-4 flex items-start gap-3"
          style={{ background: "#FCEBEB" }}
        >
          <AlertTriangle size={20} color="#A32D2D" className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[14px] font-medium" style={{ color: "#791F1F" }}>
              {overrides.length} customer{overrides.length !== 1 ? "s" : ""} flagged for review
            </p>
            <p className="text-[12px] mt-1" style={{ color: "#A32D2D", lineHeight: 1.5 }}>
              These customers have high credit utilization or poor repayment history. Review before extending further credit.
            </p>
          </div>
        </div>

        {/* Customer list */}
        {overrides.length === 0 ? (
          <div
            className="rounded-[14px] p-8 flex flex-col items-center gap-3"
            style={{ border: "1px solid var(--divider)" }}
          >
            <div
              className="size-12 rounded-full flex items-center justify-center"
              style={{ background: "#E3F3D9" }}
            >
              <AlertTriangle size={20} color="#3B6D11" />
            </div>
            <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              No credit overrides
            </p>
            <p className="text-xs text-center" style={{ color: "var(--text-secondary)" }}>
              All customers are within acceptable credit limits.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {overrides.map((o) => (
              <button
                key={o.customer.id}
                onClick={() => navigate("/admin/alerts/credit-overrides/" + o.customer.id)}
                className="flex items-center gap-3 rounded-[14px] p-4 transition-opacity active:opacity-70 text-start w-full"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              >
                {o.customer.imageUrl ? (<img src={o.customer.imageUrl} alt="" className="size-10 rounded-full object-cover shrink-0" />) : (<div className="size-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ background: "#FCEBEB", color: "#A32D2D" }}>{o.customer.name.charAt(0).toUpperCase()}</div>)}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {o.customer.name}
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {formatCurrency(o.customer.outstandingBalance)} outstanding · {o.usagePct}% of limit used
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "#FEE2E2", color: "#DC2626" }}
                  >
                    {o.health.headline}
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
