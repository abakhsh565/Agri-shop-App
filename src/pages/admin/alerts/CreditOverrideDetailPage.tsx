import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useCustomersStore } from "@/stores/customersStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { AlertTriangle, ChevronRight, CheckCircle2 } from "lucide-react";

export default function CreditOverrideDetailPage() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const customers = useCustomersStore((s) => s.customers);
  const [reviewed, setReviewed] = useState(false);

  const customer = customers.find((c) => c.id === customerId);
  if (!customer) {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title="Credit Override" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Customer not found</p>
        </div>
      </div>
    );
  }

  const utilization = customer.creditLimit > 0
    ? Math.round((customer.outstandingBalance / customer.creditLimit) * 100)
    : 0;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Credit Override" />

      <div className="flex flex-col gap-3 px-4 pt-4 pb-8">
        {/* Warning banner */}
        <div
          className="flex items-start gap-3 rounded-[16px] p-4"
          style={{ background: "#FCEBEB" }}
        >
          <AlertTriangle size={20} color="#A32D2D" className="mt-0.5 shrink-0" />
          <p className="text-[14px] font-medium" style={{ color: "#791F1F", lineHeight: 1.5 }}>
            Credit approved for a customer marked red
          </p>
        </div>

        {/* Override details */}
        <div
          className="rounded-[16px] overflow-hidden"
          style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
        >
          {[
            { label: "Approved by", value: "Yaqoob Malik" },
            {
              label: "Customer",
              value: (
                <span className="flex items-center gap-2">
                  {customer.name}
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "#FEE2E2", color: "#DC2626" }}
                  >
                    Red
                  </span>
                </span>
              ),
            },
            { label: "Amount", value: formatCurrency(customer.outstandingBalance) },
            { label: t("common.when") ?? "When", value: formatSmartDateTime(customer.createdAt, undefined, t) },
          ].map((row, i, arr) => (
            <div
              key={row.label}
              className="flex items-center justify-between px-4 py-3.5"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                {row.label}
              </span>
              <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>

        {/* Why flagged */}
        <div
          className="rounded-[16px] p-4"
          style={{ background: "var(--surface-2)" }}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
            WHY FLAGGED
          </p>
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
            {utilization >= 100
              ? `${customer.name} has reached their credit limit of ${formatCurrency(customer.creditLimit)} with ${formatCurrency(customer.outstandingBalance)} outstanding (${utilization}% utilized).`
              : `${customer.name} has ${formatCurrency(customer.outstandingBalance)} outstanding against a ${formatCurrency(customer.creditLimit)} limit (${utilization}% utilized). Credit health status indicates increased risk.`}
          </p>
        </div>

        {/* View customer profile */}
        <button
          onClick={() => navigate(isUrdu ? `/employees/customers/${customer.id}` : `/admin/customers/${customer.id}`)}
          className="flex items-center justify-between px-4 py-3.5 rounded-[16px]"
          style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
        >
          <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
            View customer profile
          </span>
          <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
        </button>

        {/* Mark as reviewed */}
        {reviewed ? (
          <div className="flex items-center justify-center gap-2 py-3">
            <CheckCircle2 size={18} style={{ color: "var(--brand-dark, #65a30d)" }} />
            <span className="text-[14px] font-medium" style={{ color: "var(--brand-dark, #65a30d)" }}>
              Reviewed
            </span>
          </div>
        ) : (
          <button
            onClick={() => setReviewed(true)}
            className="w-full py-3 text-center"
          >
            <span className="text-[14px] font-medium" style={{ color: "var(--brand-dark, #65a30d)" }}>
              Mark as reviewed
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
